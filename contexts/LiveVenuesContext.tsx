import React, { createContext, useContext, useEffect, useState, useRef, useMemo } from 'react';
import * as Location from 'expo-location';
import { collection, onSnapshot, query, doc, getDoc } from 'firebase/firestore';
import { ref, onValue } from 'firebase/database';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, firestore, realtimeDB } from '../services/firebase';
import { resolveVenueImages } from '../utils/venueImageUtils';
import AsyncStorage from '@react-native-async-storage/async-storage';


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
  isOverride?: boolean;
  maxCapacity?: number;
  type?: 'Club' | 'Bar' | 'Activity' | 'Event';
  expirationDate?: number; // timestamp in ms
  startDate?: number; // timestamp in ms
  userCount: number;
  activityLevel: ActivityLevel;
  activityColor: string;
  distanceKm: number | null;
  hidden?: boolean;
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
  isOverride?: boolean;
  maxCapacity?: number;
  type?: 'Club' | 'Bar' | 'Activity' | 'Event';
  expirationDate?: number;
  startDate?: number;
  hidden?: boolean;
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
function areVenuesEqual(a: LiveVenue[], b: LiveVenue[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const va = a[i];
    const vb = b[i];
    if (
      va.id !== vb.id ||
      va.userCount !== vb.userCount ||
      va.activityLevel !== vb.activityLevel ||
      va.distanceKm !== vb.distanceKm ||
      va.imageUrl !== vb.imageUrl ||
      va.hidden !== vb.hidden ||
      va.name !== vb.name ||
      va.latitude !== vb.latitude ||
      va.longitude !== vb.longitude
    ) {
      return false;
    }
  }
  return true;
}

export function getDefaultCapacity(type?: 'Club' | 'Bar' | 'Activity' | 'Event'): number {
  if (!type) return 100;
  switch (type) {
    case 'Club': return 250;
    case 'Bar': return 100;
    case 'Activity': return 200;
    case 'Event': return 500;
    default: return 100;
  }
}

export function getDynamicTargetCount(venue: RawVenue): number {
  const now = new Date();
  const nairobiParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Nairobi',
    weekday: 'short',
    hour: 'numeric',
    hour12: false
  }).formatToParts(now);

  let weekday = 'Mon';
  let hour = 12;

  nairobiParts.forEach(p => {
    if (p.type === 'weekday') weekday = p.value;
    if (p.type === 'hour') hour = parseInt(p.value, 10);
  });

  const isOverride = venue.isOverride === true;
  if (isOverride) {
    return venue.simulatedUsersCount !== undefined ? venue.simulatedUsersCount : 20;
  }

  const isNightlifePeak = (day: string, hr: number) => {
    if (hr >= 21) {
      return ['Fri', 'Sat', 'Sun'].includes(day);
    } else if (hr < 4) {
      return ['Sat', 'Sun', 'Mon'].includes(day);
    }
    return false;
  };

  let count = 0;
  if (venue.type === 'Club' || venue.type === 'Bar') {
    if (isNightlifePeak(weekday, hour)) {
      count = 55;
    } else if (hour >= 21 || hour < 4) {
      count = 25;
    } else {
      count = 3;
    }
  } else if (venue.type === 'Activity') {
    if (hour >= 19 || hour < 6) {
      count = 2;
    } else {
      const isWeekend = ['Sat', 'Sun'].includes(weekday);
      let base = isWeekend ? 45 : 20;
      if (hour >= 11 && hour <= 16) {
        base += 15;
      }
      count = base;
    }
  } else if (venue.type === 'Event') {
    const nowMs = Date.now();
    const isOngoing = venue.startDate && venue.expirationDate && (nowMs >= venue.startDate && nowMs <= venue.expirationDate);
    if (isOngoing) {
      if (hour >= 9 && hour < 22) {
        count = 50;
      } else {
        count = 5;
      }
    } else {
      count = 0;
    }
  } else {
    count = 20;
  }

  const maxCapacity = venue.maxCapacity !== undefined ? venue.maxCapacity : getDefaultCapacity(venue.type);
  count = Math.min(count, maxCapacity);

  if (venue.type === 'Activity' && (hour >= 19 || hour < 6)) {
    count = Math.min(count, 5);
  }
  if ((venue.type === 'Club' || venue.type === 'Bar') && isNightlifePeak(weekday, hour)) {
    count = Math.max(count, 20);
  }

  return Math.max(0, count);
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

  // Optimized Pre-Aggregation Maps (O(L) indexing)
  const realCountsMap: Record<string, number> = {};
  const simCountsMap: Record<string, number> = {};

  for (const loc of realActiveLocs) {
    if (loc.venueId) {
      realCountsMap[loc.venueId] = (realCountsMap[loc.venueId] || 0) + 1;
    } else {
      for (const venue of venues) {
        if (haversineMeters(venue.latitude, venue.longitude, loc.latitude, loc.longitude) <= VENUE_RADIUS_METERS) {
          realCountsMap[venue.id] = (realCountsMap[venue.id] || 0) + 1;
          break;
        }
      }
    }
  }

  for (const loc of simActiveLocs) {
    let venueId = loc.venueId;
    if (!venueId && loc.user_id && loc.user_id.startsWith('sim_')) {
      const parts = loc.user_id.split('_');
      if (parts.length >= 4) {
        venueId = parts.slice(1, -2).join('_');
      }
    }

    if (venueId) {
      simCountsMap[venueId] = (simCountsMap[venueId] || 0) + 1;
    } else {
      for (const venue of venues) {
        if (haversineMeters(venue.latitude, venue.longitude, loc.latitude, loc.longitude) <= VENUE_RADIUS_METERS) {
          simCountsMap[venue.id] = (simCountsMap[venue.id] || 0) + 1;
          break;
        }
      }
    }
  }

  for (const venue of venues) {
    if (!venue.latitude || !venue.longitude) continue;

    // Filter out hidden venues
    if (venue.hidden === true) {
      continue;
    }

    // Filter out expired venues (like Activities)
    if (venue.expirationDate && venue.expirationDate < now) {
      continue;
    }

    const distanceKm =
      userLat !== null && userLng !== null
        ? Math.round(haversineMeters(userLat, userLng, venue.latitude, venue.longitude)) / 1000
        : null;

    const resolvedImageUrl = venue.customImageUrl || venue.googleImageUrl || venue.imageUrl || resolvedImages[venue.id];

    // Filter out future scheduled events/activities that haven't started yet
    if ((venue.type === 'Activity' || venue.type === 'Event') && venue.startDate && venue.startDate > now) {
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

    const realUserCount = realCountsMap[venue.id] || 0;
    const rtdbSimCount = simCountsMap[venue.id] || 0;

    const isEngineActive = simActiveLocs.length > 0;
    let simUserCount = 0;
    if (includeSimulated) {
      if (isEngineActive) {
        simUserCount = rtdbSimCount;
      } else {
        simUserCount = getDynamicTargetCount(venue);
      }
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
      
      // Add a single high-precision heatmap point centered on the venue
      heatPoints.push({ 
        latitude: venue.latitude, 
        longitude: venue.longitude, 
        weight: userCount
      });
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

  useEffect(() => {
    const loadCachedVenues = async () => {
      try {
        const cachedLive = await AsyncStorage.getItem('cached_live_venues');
        const cachedScheduled = await AsyncStorage.getItem('cached_scheduled_venues');
        if (cachedLive) {
          setVenues(JSON.parse(cachedLive));
        }
        if (cachedScheduled) {
          setScheduledVenues(JSON.parse(cachedScheduled));
        }
        if (cachedLive || cachedScheduled) {
          setIsLoading(false);
        }
      } catch (err) {
        console.warn('[LiveVenuesContext] Error loading cache:', err);
      }
    };
    loadCachedVenues();
  }, []);

  const venuesRef = useRef<RawVenue[]>([]);
  const locationsRef = useRef<Record<string, RawLocation>>({});
  const simLocationsRef = useRef<Record<string, RawLocation>>({});
  const userPosRef = useRef<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });
  const simConfigRef = useRef({ enabled: true, threshold: 100 });

  const isProcessingRef = useRef(false);
  const pendingUpdateRef = useRef(false);
  const lastHashRef = useRef('');
  const lastWriteTimeRef = useRef<number>(0);
  const lastWrittenLiveRef = useRef<string>('');
  const lastWrittenScheduledRef = useRef<string>('');

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

      setVenues((prev) => {
        if (areVenuesEqual(prev, result.venues)) {
          return prev;
        }
        return result.venues;
      });

      setScheduledVenues((prev) => {
        if (areVenuesEqual(prev, result.scheduledVenues)) {
          return prev;
        }
        return result.scheduledVenues;
      });

      setIsLoading(false);

      const nowTime = Date.now();
      if (nowTime - lastWriteTimeRef.current > 30000) {
        const liveStr = JSON.stringify(result.venues);
        const scheduledStr = JSON.stringify(result.scheduledVenues);
        if (liveStr !== lastWrittenLiveRef.current || scheduledStr !== lastWrittenScheduledRef.current) {
          lastWriteTimeRef.current = nowTime;
          lastWrittenLiveRef.current = liveStr;
          lastWrittenScheduledRef.current = scheduledStr;
          AsyncStorage.setItem('cached_live_venues', liveStr).catch(() => {});
          AsyncStorage.setItem('cached_scheduled_venues', scheduledStr).catch(() => {});
        }
      }

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


  const contextValue = useMemo(() => ({
    venues,
    heatPoints,
    isLoading,
    scheduledVenues,
  }), [venues, heatPoints, isLoading, scheduledVenues]);

  return (
    <LiveVenuesContext.Provider value={contextValue}>
      {children}
    </LiveVenuesContext.Provider>
  );
};
