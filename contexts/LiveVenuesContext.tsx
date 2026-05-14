import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import * as Location from 'expo-location';
import { collection, onSnapshot, query, doc, getDoc } from 'firebase/firestore';
import { ref, onValue } from 'firebase/database';
import { firestore, realtimeDB } from '../services/firebase';

// ─── Types (re-exported so consumers don't need to change) ────────────────────
export type ActivityLevel = 'None' | 'Low' | 'Medium' | 'High' | 'Crazy';

export interface LiveVenue {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  description: string;
  address?: string;
  simulatedUsersCount?: number;
  userCount: number;
  activityLevel: ActivityLevel;
  activityColor: string;
  distanceKm: number | null;
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
  address?: string;
  simulatedUsersCount?: number;
}

// ─── Config ───────────────────────────────────────────────────────────────────
const VENUE_RADIUS_METERS = 200;
const STALE_MS = 2 * 60 * 60 * 1000; // 2 hours
const REFRESH_RATE_MS = 2000;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
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

function computeLiveData(
  venues: RawVenue[],
  realLocations: Record<string, RawLocation>,
  simLocations: Record<string, RawLocation>,
  userLat: number | null,
  userLng: number | null,
  includeSimulated: boolean
): { venues: LiveVenue[]; heatPoints: HeatPoint[]; hash: string } {
  const now = Date.now();

  const realActiveLocs = Object.values(realLocations).filter(
    (loc) => loc.latitude && loc.longitude && now - loc.timestamp < STALE_MS
  );

  const simActiveLocs: RawLocation[] = [];
  if (includeSimulated) {
    simActiveLocs.push(
      ...Object.values(simLocations).filter(
        (loc) => loc.latitude && loc.longitude && now - loc.timestamp < STALE_MS
      )
    );
  }

  const liveVenues: LiveVenue[] = [];
  const heatPoints: HeatPoint[] = [];
  let hashStr = '';

  for (const venue of venues) {
    if (!venue.latitude || !venue.longitude) continue;

    const realUserCount = realActiveLocs.filter((loc) => {
      if (loc.venueId) return loc.venueId === venue.id;
      return haversineMeters(venue.latitude, venue.longitude, loc.latitude, loc.longitude) <= VENUE_RADIUS_METERS;
    }).length;

    const rtdbSimCount = simActiveLocs.filter((loc) => {
      if (loc.venueId) return loc.venueId === venue.id;
      return haversineMeters(venue.latitude, venue.longitude, loc.latitude, loc.longitude) <= VENUE_RADIUS_METERS;
    }).length;

    const isEngineActive = simActiveLocs.length > 0;
    let simUserCount = 0;
    if (includeSimulated) {
      const customAdminCount = venue.simulatedUsersCount !== undefined ? venue.simulatedUsersCount : 20;
      simUserCount = isEngineActive ? Math.max(rtdbSimCount, customAdminCount) : customAdminCount;
    }

    const userCount = realUserCount + simUserCount;
    const distanceKm =
      userLat !== null && userLng !== null
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

    if (userCount > 0) {
      hashStr += `${venue.id}:${userCount};`;
      const baseWeight = userCount;
      heatPoints.push({ latitude: venue.latitude, longitude: venue.longitude, weight: baseWeight });
      const numRings = Math.min(20, Math.floor(userCount / 20));
      for (let ring = 1; ring <= numRings; ring++) {
        const ringRadiusMeters = ring * 12;
        const numPointsInRing = ring * 6;
        const ringWeight = baseWeight * Math.pow(0.85, ring);
        for (let i = 0; i < numPointsInRing; i++) {
          const angle = (i / numPointsInRing) * Math.PI * 2;
          const latOffset = (ringRadiusMeters * Math.cos(angle)) / 111111;
          const lngOffset =
            (ringRadiusMeters * Math.sin(angle)) / (111111 * Math.cos((venue.latitude * Math.PI) / 180));
          heatPoints.push({ latitude: venue.latitude + latOffset, longitude: venue.longitude + lngOffset, weight: ringWeight });
        }
      }
    }
  }

  liveVenues.sort((a, b) => b.userCount - a.userCount);
  return { venues: liveVenues, heatPoints, hash: hashStr };
}

// ─── Context ──────────────────────────────────────────────────────────────────
interface LiveVenuesContextValue {
  venues: LiveVenue[];
  heatPoints: HeatPoint[];
  isLoading: boolean;
}

const LiveVenuesContext = createContext<LiveVenuesContextValue>({
  venues: [],
  heatPoints: [],
  isLoading: true,
});

export const useLiveVenuesContext = () => useContext(LiveVenuesContext);

// ─── Provider ─────────────────────────────────────────────────────────────────
export const LiveVenuesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [venues, setVenues] = useState<LiveVenue[]>([]);
  const [heatPoints, setHeatPoints] = useState<HeatPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const venuesRef = useRef<RawVenue[]>([]);
  const locationsRef = useRef<Record<string, RawLocation>>({});
  const simLocationsRef = useRef<Record<string, RawLocation>>({});
  const userPosRef = useRef<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });
  const simConfigRef = useRef({ enabled: true, threshold: 100 });

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

    try {
      const activeRealCount = Object.values(locationsRef.current).filter(
        (loc) => Date.now() - loc.timestamp < STALE_MS
      ).length;

      const includeSimulated =
        simConfigRef.current.enabled && activeRealCount < simConfigRef.current.threshold;

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

      if (result.hash !== lastHashRef.current) {
        lastHashRef.current = result.hash;
        setHeatPoints(result.heatPoints);
      }
    } catch (e) {
      // Silent fail — keep existing data intact
      console.warn('[LiveVenuesContext] processData error:', e);
      setIsLoading(false);
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
    getDoc(doc(firestore, 'settings', 'simulation'))
      .then((docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          simConfigRef.current = {
            enabled: data.enabled ?? true,
            threshold: data.threshold ?? 100,
          };
          requestRecalculate();
        }
      })
      .catch((e) => console.warn('[LiveVenuesContext] Failed to load sim config:', e));

    // 1. User location watcher
    let locationSub: Location.LocationSubscription | null = null;
    Location.getForegroundPermissionsAsync()
      .then(({ status }) => {
        if (status !== 'granted') return;
        return Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 15000, distanceInterval: 20 },
          (loc) => {
            userPosRef.current = { lat: loc.coords.latitude, lng: loc.coords.longitude };
            requestRecalculate();
          }
        ).then((sub) => {
          locationSub = sub;
        });
      })
      .catch((e) => console.warn('[LiveVenuesContext] Location watch error:', e));

    // 2. Venues listener
    const unsubVenues = onSnapshot(
      query(collection(firestore, 'venues')),
      (snap) => {
        venuesRef.current = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RawVenue, 'id'>) }));
        requestRecalculate();
      },
      (e) => console.warn('[LiveVenuesContext] Venues snapshot error:', e)
    );

    // 3. Real locations listener
    const unsubLocs = onValue(
      ref(realtimeDB, 'locations'),
      (snap) => {
        locationsRef.current = snap.exists() ? snap.val() : {};
        requestRecalculate();
      },
      (e) => console.warn('[LiveVenuesContext] Locations listener error:', e)
    );

    // 4. Simulated locations listener
    const unsubSimLocs = onValue(
      ref(realtimeDB, 'simulated_locations'),
      (snap) => {
        simLocationsRef.current = snap.exists() ? snap.val() : {};
        requestRecalculate();
      },
      (e) => console.warn('[LiveVenuesContext] SimLocations listener error:', e)
    );

    return () => {
      if (locationSub) locationSub.remove();
      unsubVenues();
      unsubLocs();
      unsubSimLocs();
    };
  }, []);

  return (
    <LiveVenuesContext.Provider value={{ venues, heatPoints, isLoading }}>
      {children}
    </LiveVenuesContext.Provider>
  );
};
