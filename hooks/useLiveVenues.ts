import { useEffect, useState, useRef } from 'react';
import * as Location from 'expo-location';
import { collection, onSnapshot, query, doc, getDoc } from 'firebase/firestore';
import { ref, onValue } from 'firebase/database';
import Toast from 'react-native-toast-message';
import { firestore, realtimeDB } from '../services/firebase';

// ─── Types ────────────────────────────────────────────────────────────────────
export type ActivityLevel = 'None' | 'Low' | 'Medium' | 'High' | 'Crazy';

export interface LiveVenue {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  description: string;
  simulatedUsersCount?: number;
  
  // Computed live data
  userCount: number;
  activityLevel: ActivityLevel;
  activityColor: string;
  distanceKm: number | null; // null if user location unknown
}

export interface HeatPoint {
  latitude: number;
  longitude: number;
  weight: number;
}

interface RawLocation {
  latitude: number;
  longitude: number;
  timestamp: number;
  user_id: string;
  venueId?: string;
}

interface RawVenue {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  description: string;
  simulatedUsersCount?: number;
}

// ─── Config ───────────────────────────────────────────────────────────────────
const VENUE_RADIUS_METERS = 200;
const STALE_MS = 2 * 60 * 60 * 1000; // 2 hours
const REFRESH_RATE_MS = 2000; // Throttle heatmap/list updates to max once every 2 seconds

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Haversine distance in metres between two lat/lng points */
function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6_371_000; // Earth radius in metres
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toActivityLevel(count: number): ActivityLevel {
  if (count === 0) return 'None';
  if (count <= 25) return 'Low';
  if (count <= 50) return 'Medium';
  if (count <= 75) return 'High';
  return 'Crazy';
}

function toActivityColor(level: ActivityLevel): string {
  switch (level) {
    case 'Crazy':  return '#FF0055';
    case 'High':   return '#FF5E00';
    case 'Medium': return '#00FFCC';
    case 'Low':    return '#4169E1';
    default:       return '#555555';
  }
}

// Generate deterministic gaussian offset for heatmap blobs
function getVenueScatter(venueId: string): { dx: number; dy: number }[] {
  // A simple deterministic pseudo-random generator based on venue ID
  let seed = 0;
  for (let i = 0; i < venueId.length; i++) {
    seed += venueId.charCodeAt(i);
  }
  
  const random = () => {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  };

  const points = [];
  for (let i = 0; i < 80; i++) { // Fixed 80 points
    const u = random();
    const v = random();
    const radius = Math.sqrt(-2.0 * Math.log(u));
    const theta = 2.0 * Math.PI * v;
    points.push({ dx: radius * Math.cos(theta), dy: radius * Math.sin(theta) });
  }
  return points;
}

// ─── Master Computation Engine ────────────────────────────────────────────────
function computeLiveData(
  venues: RawVenue[],
  realLocations: Record<string, RawLocation>,
  simLocations: Record<string, RawLocation>,
  userLat: number | null,
  userLng: number | null,
  includeSimulated: boolean
): { venues: LiveVenue[], heatPoints: HeatPoint[], hash: string } {
  const now = Date.now();

  // 1. Filter active locations
  const realActiveLocs = Object.values(realLocations).filter(
    (loc) => loc.latitude && loc.longitude && now - loc.timestamp < STALE_MS
  );

  const simActiveLocs: RawLocation[] = [];
  if (includeSimulated) {
    simActiveLocs.push(...Object.values(simLocations).filter(
      (loc) => loc.latitude && loc.longitude && now - loc.timestamp < STALE_MS
    ));
  }

  const liveVenues: LiveVenue[] = [];
  const heatPoints: HeatPoint[] = [];
  let hashStr = '';

  for (const venue of venues) {
    if (!venue.latitude || !venue.longitude) continue;

    // 2. Count Real Users
    const realUserCount = realActiveLocs.filter((loc) => {
      if (loc.venueId) return loc.venueId === venue.id;
      return haversineMeters(venue.latitude, venue.longitude, loc.latitude, loc.longitude) <= VENUE_RADIUS_METERS;
    }).length;

    // 3. Count RTDB Simulated Users
    const rtdbSimCount = simActiveLocs.filter((loc) => {
      if (loc.venueId) return loc.venueId === venue.id;
      return haversineMeters(venue.latitude, venue.longitude, loc.latitude, loc.longitude) <= VENUE_RADIUS_METERS;
    }).length;

    // 4. Enforce Mathematical Baseline
    const baselineSimCount = venue.simulatedUsersCount !== undefined ? venue.simulatedUsersCount : 20;

    // 5. Calculate Total
    const simUserCount = Math.max(rtdbSimCount, baselineSimCount);
    const userCount = realUserCount + simUserCount;

    // Build Venue List item
    const distanceKm = userLat !== null && userLng !== null
      ? Math.round(haversineMeters(userLat, userLng, venue.latitude, venue.longitude)) / 1000
      : null;

    const activityLevel = toActivityLevel(userCount);
    
    liveVenues.push({
      ...venue,
      userCount,
      activityLevel,
      activityColor: toActivityColor(activityLevel),
      distanceKm,
    });

    // Build Heatmap Points
    if (userCount > 0) {
      hashStr += `${venue.id}:${userCount};`;
      const numScattered = 80; 
      const spreadMeters = 40; 
      const pointWeight = Math.log10(Math.max(10, userCount * 10)) * 10;
      const scatterOffsets = getVenueScatter(venue.id);

      for (let i = 0; i < numScattered; i++) {
        const offset = scatterOffsets[i];
        const latOffset = (offset.dx * spreadMeters) / 111111;
        const lngOffset = (offset.dy * spreadMeters) / (111111 * Math.cos(venue.latitude * Math.PI / 180));

        heatPoints.push({
          latitude: venue.latitude + latOffset,
          longitude: venue.longitude + lngOffset,
          weight: pointWeight
        });
      }
    }
  }

  // Sort venues descending by user count (highest activity first)
  liveVenues.sort((a, b) => b.userCount - a.userCount);

  return { venues: liveVenues, heatPoints, hash: hashStr };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export const useLiveVenues = () => {
  const [venues, setVenues] = useState<LiveVenue[]>([]);
  const [heatPoints, setHeatPoints] = useState<HeatPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Mutable refs for latest data
  const venuesRef = useRef<RawVenue[]>([]);
  const locationsRef = useRef<Record<string, RawLocation>>({});
  const simLocationsRef = useRef<Record<string, RawLocation>>({});
  const userPosRef = useRef<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });
  const simConfigRef = useRef({ enabled: true, threshold: 100 });
  
  // Throttle tracking
  const isProcessingRef = useRef(false);
  const pendingUpdateRef = useRef(false);
  const lastHashRef = useRef('');

  const requestRecalculate = () => {
    if (isProcessingRef.current) {
      pendingUpdateRef.current = true;
      return;
    }
    processData();
  };

  const processData = () => {
    isProcessingRef.current = true;

    // Determine if we should include RTDB simulated users based on threshold
    const activeRealCount = Object.values(locationsRef.current).filter(
      loc => Date.now() - loc.timestamp < STALE_MS
    ).length;

    const includeSimulated = 
      simConfigRef.current.enabled && 
      activeRealCount < simConfigRef.current.threshold;

    const result = computeLiveData(
      venuesRef.current,
      locationsRef.current,
      simLocationsRef.current,
      userPosRef.current.lat,
      userPosRef.current.lng,
      includeSimulated
    );

    setVenues(result.venues);
    setIsLoading(false);

    // Only update heatPoints if hash actually changed (prevents native bridge tile wipes)
    if (result.hash !== lastHashRef.current) {
      lastHashRef.current = result.hash;
      setHeatPoints(result.heatPoints);
    }

    setTimeout(() => {
      isProcessingRef.current = false;
      if (pendingUpdateRef.current) {
        pendingUpdateRef.current = false;
        processData();
      }
    }, REFRESH_RATE_MS);
  };

  useEffect(() => {
    // 0. Load Simulation Config
    getDoc(doc(firestore, 'settings', 'simulation')).then(docSnap => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        simConfigRef.current = {
          enabled: data.enabled ?? true,
          threshold: data.threshold ?? 100
        };
        requestRecalculate();
      }
    });

    // 1. User location watcher
    let locationSub: Location.LocationSubscription | null = null;
    Location.getForegroundPermissionsAsync().then(({ status }) => {
      if (status !== 'granted') return;
      Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 15000, distanceInterval: 20 },
        (loc) => {
          userPosRef.current = { lat: loc.coords.latitude, lng: loc.coords.longitude };
          requestRecalculate();
        },
      ).then((sub) => { locationSub = sub; });
    });

    // 2. Venues listener
    const unsubVenues = onSnapshot(query(collection(firestore, 'venues')), (snap) => {
      venuesRef.current = snap.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as Omit<RawVenue, 'id'>),
      }));
      requestRecalculate();
    });

    // 3. Real locations listener
    const unsubLocs = onValue(ref(realtimeDB, 'locations'), (snap) => {
      locationsRef.current = snap.exists() ? snap.val() : {};
      requestRecalculate();
    });

    // 4. Simulated locations listener
    const unsubSimLocs = onValue(ref(realtimeDB, 'simulated_locations'), (snap) => {
      simLocationsRef.current = snap.exists() ? snap.val() : {};
      requestRecalculate();
    });

    return () => {
      if (locationSub) locationSub.remove();
      unsubVenues();
      unsubLocs();
      unsubSimLocs();
    };
  }, []);

  return { venues, heatPoints, isLoading };
};
