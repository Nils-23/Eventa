import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import * as Location from 'expo-location';
import { collection, onSnapshot, query, doc, getDoc } from 'firebase/firestore';
import { ref, onValue } from 'firebase/database';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, firestore, realtimeDB } from '../services/firebase';
import { resolveVenueImages } from '../utils/venueImageUtils';


// ─── Types (re-exported so consumers don't need to change) ────────────────────
export type ActivityLevel = 'None' | 'Low' | 'Medium' | 'High' | 'Crazy';

export interface LiveVenue {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  description: string;
  imageUrl?: string;
  googleImageUrl?: string;
  customImageUrl?: string;
  address?: string;
  simulatedUsersCount?: number;
  type?: 'Club' | 'Bar' | 'Festival' | 'Event';
  expirationDate?: number; // timestamp in ms
  startDate?: number; // timestamp in ms
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
  imageUrl?: string;
  googleImageUrl?: string;
  customImageUrl?: string;
  address?: string;
  simulatedUsersCount?: number;
  type?: 'Club' | 'Bar' | 'Festival' | 'Event';
  expirationDate?: number;
  startDate?: number;
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
  includeSimulated: boolean,
  resolvedImages: Record<string, string>
): { venues: LiveVenue[]; scheduledVenues: LiveVenue[]; heatPoints: HeatPoint[]; hash: string } {
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
  const scheduledVenues: LiveVenue[] = [];
  const heatPoints: HeatPoint[] = [];
  let hashStr = '';

  for (const venue of venues) {
    if (!venue.latitude || !venue.longitude) continue;

    // Filter out expired venues (like Festivals)
    if (venue.expirationDate && venue.expirationDate < now) {
      continue;
    }

    const distanceKm =
      userLat !== null && userLng !== null
        ? Math.round(haversineMeters(userLat, userLng, venue.latitude, venue.longitude)) / 1000
        : null;

    const resolvedImageUrl = venue.customImageUrl || venue.googleImageUrl || venue.imageUrl || resolvedImages[venue.id];

    // Filter out future scheduled events/festivals that haven't started yet
    if ((venue.type === 'Festival' || venue.type === 'Event') && venue.startDate && venue.startDate > now) {
      scheduledVenues.push({
        ...venue,
        imageUrl: resolvedImageUrl,
        userCount: 0,
        activityLevel: 'None',
        activityColor: toActivityColor('None'),
        distanceKm,
      });
      continue;
    }

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

    const activityLevel = toActivityLevel(userCount);
    liveVenues.push({
      ...venue,
      imageUrl: resolvedImageUrl,
      userCount,
      activityLevel,
      activityColor: toActivityColor(activityLevel),
      distanceKm,
    });

    if (userCount > 0) {
      hashStr += `${venue.id}:${userCount};`;
      
      // Fixed layers and pre-allocated weight percentages:
      // - Core (Center): 1 point, 10% weight
      // - Inner Ring (25m): 6 points, 20% weight
      // - Middle Ring (60m): 12 points, 30% weight
      // - Outer Ring (100m): 18 points, 40% weight
      
      // 1. Core (Center)
      heatPoints.push({ 
        latitude: venue.latitude, 
        longitude: venue.longitude, 
        weight: userCount * 0.10 
      });
      
      // 2. Concentric Rings
      const rings = [
        { radius: 25, points: 6, percent: 0.20 },
        { radius: 60, points: 12, percent: 0.30 },
        { radius: 100, points: 18, percent: 0.40 }
      ];

      for (const ring of rings) {
        const ringWeight = (userCount * ring.percent) / ring.points;
        for (let i = 0; i < ring.points; i++) {
          const angle = (i / ring.points) * Math.PI * 2;
          const latOffset = (ring.radius * Math.cos(angle)) / 111111;
          const lngOffset =
            (ring.radius * Math.sin(angle)) / (111111 * Math.cos((venue.latitude * Math.PI) / 180));
          
          heatPoints.push({ 
            latitude: venue.latitude + latOffset, 
            longitude: venue.longitude + lngOffset, 
            weight: ringWeight 
          });
        }
      }
    }
  }

  // 3. Global Density Calibration Anchor Point
  // Add a hidden anchor point with high weight (e.g. 120) at a remote coordinate (0, 0)
  // to cap the maximum normalization scale. This prevents low-occupancy venues
  // from reaching the density required for a red core.
  if (heatPoints.length > 0) {
    heatPoints.push({
      latitude: 0,
      longitude: 0,
      weight: 120
    });
  }

  scheduledVenues.sort((a, b) => (a.startDate ?? 0) - (b.startDate ?? 0));
  liveVenues.sort((a, b) => b.userCount - a.userCount);
  return { venues: liveVenues, scheduledVenues, heatPoints, hash: hashStr };
}

// ─── Context ──────────────────────────────────────────────────────────────────
interface LiveVenuesContextValue {
  venues: LiveVenue[];
  heatPoints: HeatPoint[];
  isLoading: boolean;
  scheduledVenues: LiveVenue[];
}

const LiveVenuesContext = createContext<LiveVenuesContextValue>({
  venues: [],
  heatPoints: [],
  isLoading: true,
  scheduledVenues: [],
});

export const useLiveVenuesContext = () => useContext(LiveVenuesContext);

// ─── Provider ─────────────────────────────────────────────────────────────────
export const LiveVenuesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [venues, setVenues] = useState<LiveVenue[]>([]);
  const [scheduledVenues, setScheduledVenues] = useState<LiveVenue[]>([]);
  const [heatPoints, setHeatPoints] = useState<HeatPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [resolvedImages, setResolvedImages] = useState<Record<string, string>>({});

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

  useEffect(() => {
    if (venuesRef.current.length > 0) {
      requestRecalculate();
    }
  }, [resolvedImages]);

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
        includeSimulated,
        resolvedImages
      );

      setVenues(result.venues);
      setScheduledVenues(result.scheduledVenues);
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
    // Wait for Firebase Auth to resolve before attaching any listeners
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (!user) {
        // Not authenticated — clear data and wait
        venuesRef.current = [];
        locationsRef.current = {};
        simLocationsRef.current = {};
        setIsLoading(false);
        return;
      }

      setIsLoading(true);

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
          const rawVenues = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RawVenue, 'id'>) }));
          venuesRef.current = rawVenues;

          // Asynchronously resolve venue images and update state to re-trigger calculations
          resolveVenueImages(rawVenues).then((imgMap) => {
            setResolvedImages((prev) => {
              // Only update if there are new images resolved to avoid loops
              const hasNew = Object.keys(imgMap).some(k => prev[k] !== imgMap[k]);
              if (!hasNew) return prev;
              return { ...prev, ...imgMap };
            });
          });

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

      // Store cleanup functions to be called when auth changes or component unmounts
      return () => {
        if (locationSub) locationSub.remove();
        unsubVenues();
        unsubLocs();
        unsubSimLocs();
      };
    });

    return () => {
      unsubAuth();
    };
  }, []);


  return (
    <LiveVenuesContext.Provider value={{ venues, heatPoints, isLoading, scheduledVenues }}>
      {children}
    </LiveVenuesContext.Provider>
  );
};
