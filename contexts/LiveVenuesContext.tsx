import React, { createContext, useContext, useEffect, useState, useRef, useMemo, useCallback } from 'react';
import * as Location from 'expo-location';
import { collection, onSnapshot, query, doc, getDoc } from 'firebase/firestore';
import { ref } from 'firebase/database';
import { subscribeToRTDB } from '../utils/firebaseUtils';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, firestore, realtimeDB } from '../services/firebase';
import { resolveVenueImages } from '../utils/venueImageUtils';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppStore } from '../hooks/useAppStore';


// ─── Types (re-exported so consumers don't need to change) ────────────────────
export type ActivityLevel = 'None' | 'Low' | 'Medium' | 'High' | 'Crazy';
export type VenueTrend = 'rising' | 'falling' | 'stable';

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
  ticketLink?: string;
  price?: string;
  expirationDate?: number; // timestamp in ms
  startDate?: number; // timestamp in ms
  userCount: number;
  activityLevel: ActivityLevel;
  activityColor: string;
  distanceKm: number | null;
  // Whether the crowd grew/shrank vs 10–35 minutes ago; assigned in processData
  // from the rolling count history (absent on cache-restored venues).
  trend?: VenueTrend;
  hidden?: boolean;
  overrideDate?: string;
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
  simPopularityScore?: number;
  type?: 'Club' | 'Bar' | 'Activity' | 'Event';
  ticketLink?: string;
  price?: string;
  expirationDate?: number;
  startDate?: number;
  hidden?: boolean;
  overrideDate?: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────
const VENUE_RADIUS_METERS = 200;
const STALE_MS = 2 * 60 * 60 * 1000; // 2 hours (real users)
// Simulated users are heartbeated every 15s by the engine; if the engine stops,
// their counts must fade quickly rather than freeze at (say) 1am levels for 2 hours.
const SIM_STALE_MS = 10 * 60 * 1000;
const REFRESH_RATE_MS = 2000;

// Heat normalization: weights are scaled to 0..1 against the busiest venue so
// the full gradient renders (hottest venue = red core, everything else spreads
// down the spectrum). The floor stops a quiet afternoon from painting a
// 10-person bar red just because it happens to be the daily maximum.
const HEAT_REF_FLOOR = 50;

// Trend detection: sample each venue's count at most once a minute, keep 35
// minutes of history, and compare against the oldest sample that is at least
// 10 minutes old.
const TREND_SAMPLE_MS = 60 * 1000;
const TREND_WINDOW_MS = 35 * 60 * 1000;
const TREND_MIN_AGE_MS = 10 * 60 * 1000;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toActivityLevel(count: number): 'Crazy' | 'High' | 'Medium' | 'Low' | 'None' {
  if (count >= 90) return 'Crazy';
  if (count >= 50) return 'High';
  if (count >= 25) return 'Medium';
  if (count > 0) return 'Low';
  return 'None';
}

function toActivityColor(level: 'Crazy' | 'High' | 'Medium' | 'Low' | 'None'): string {
  switch (level) {
    case 'Crazy':
      return '#FF2D55'; // Vibrant Neon Red-Pink
    case 'High':
      return '#FF9500'; // Vibrant Neon Orange
    case 'Medium':
      return '#FFCC00'; // Vibrant Neon Yellow
    case 'Low':
      return '#4CD964'; // Vibrant Neon Green
    case 'None':
      return '#8E8E93'; // Neutral gray
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
      va.trend !== vb.trend ||
      va.activityLevel !== vb.activityLevel ||
      va.distanceKm !== vb.distanceKm ||
      va.imageUrl !== vb.imageUrl ||
      va.hidden !== vb.hidden ||
      va.name !== vb.name ||
      va.latitude !== vb.latitude ||
      va.longitude !== vb.longitude ||
      va.ticketLink !== vb.ticketLink ||
      va.price !== vb.price
    ) {
      return false;
    }
  }
  return true;
}

export function getDefaultCapacity(type?: 'Club' | 'Bar' | 'Activity' | 'Event'): number {
  if (!type) return 100;
  switch (type) {
    case 'Club': return 100;
    case 'Bar': return 50;
    case 'Activity': return 75;
    case 'Event': return 150;
    default: return 100;
  }
}

// ── Rotating hot-venue ranking ────────────────────────────────────────────
// Mirrors functions/index.js exactly: which venue is "hot" reshuffles every
// 3h slot via a seeded random draw per (venue, slot). Deterministic, so the
// client and cloud functions always agree on the same hot venue, but the
// winner rotates slot to slot instead of one venue staying hot all night.
const HOT_ROTATION_SLOT_MS = 3 * 60 * 60 * 1000;

function seededUnitRandom(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function getRotatingHotScore(venue: RawVenue, nowMs: number = Date.now()): number {
  const slot = Math.floor(nowMs / HOT_ROTATION_SLOT_MS);
  const base = venue.simPopularityScore !== undefined ? venue.simPopularityScore : 0.5;
  const roll = seededUnitRandom(`${venue.id}|hot|${slot}`);
  return 0.3 * base + 0.7 * roll;
}

export function getDynamicTargetCount(venue: RawVenue, allVenues?: RawVenue[]): number {
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

  const nairobiDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(now);
  const isOverride = venue.isOverride === true && venue.overrideDate === nairobiDateStr;
  if (isOverride) {
    return venue.simulatedUsersCount !== undefined ? venue.simulatedUsersCount : 20;
  }

  // Determine tier within category (Default: 10% hot, 30% medium, 60% low)
  let tier: 'hot' | 'medium' | 'low' = 'low';
  if (allVenues && Array.isArray(allVenues)) {
    const categoryVenues = allVenues.filter(v => v.type === venue.type);
    if (categoryVenues.length > 0) {
      const sorted = [...categoryVenues].sort(
        (a, b) => getRotatingHotScore(b) - getRotatingHotScore(a)
      );
      const rankIndex = sorted.findIndex(v => v.id === venue.id);
      if (rankIndex !== -1) {
        const percentile = rankIndex / sorted.length;
        if (percentile < 0.10) {
          tier = 'hot';
        } else if (percentile < 0.40) {
          tier = 'medium';
        } else {
          tier = 'low';
        }
      }
    }
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
      if (tier === 'hot') count = 90;
      else if (tier === 'medium') count = 40;
      else count = 20;
    } else if (hour >= 21 || hour < 4) {
      if (tier === 'hot') count = 50;
      else if (tier === 'medium') count = 25;
      else count = 10;
    } else {
      if (tier === 'hot') count = 10;
      else if (tier === 'medium') count = 4;
      else count = 0;
    }
  } else if (venue.type === 'Activity') {
    if (hour >= 19 || hour < 6) {
      if (tier === 'hot') count = 3;
      else if (tier === 'medium') count = 1;
      else count = 0;
    } else {
      const isWeekend = ['Sat', 'Sun'].includes(weekday);
      if (isWeekend) {
        if (tier === 'hot') count = 75;
        else if (tier === 'medium') count = 35;
        else count = 10;
      } else {
        if (tier === 'hot') count = 35;
        else if (tier === 'medium') count = 20;
        else count = 5;
      }
    }
  } else if (venue.type === 'Event') {
    const nowMs = Date.now();
    const isOngoing = venue.startDate && venue.expirationDate && (nowMs >= venue.startDate && nowMs <= venue.expirationDate);
    if (isOngoing) {
      if (hour >= 9 && hour < 22) {
        if (tier === 'hot') count = 150;
        else if (tier === 'medium') count = 80;
        else count = 30;
      } else {
        if (tier === 'hot') count = 40;
        else if (tier === 'medium') count = 20;
        else count = 5;
      }
    } else {
      count = 0;
    }
  } else {
    if (tier === 'hot') count = 40;
    else if (tier === 'medium') count = 20;
    else count = 5;
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
        (loc) => loc.latitude && loc.longitude && now - loc.timestamp < SIM_STALE_MS
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

  // Heat contribution decays linearly with the age of the last location ping,
  // so hot zones visibly cool down as people leave instead of holding 1am
  // intensity until the hard staleness cliff evicts them.
  const heatWeightMap: Record<string, number> = {};
  const addHeat = (venueId: string, loc: RawLocation, staleMs: number) => {
    const decay = 1 - (now - loc.timestamp) / staleMs;
    if (decay > 0) {
      heatWeightMap[venueId] = (heatWeightMap[venueId] || 0) + decay;
    }
  };

  for (const loc of realActiveLocs) {
    let venueId = loc.venueId;
    if (!venueId) {
      for (const venue of venues) {
        if (haversineMeters(venue.latitude, venue.longitude, loc.latitude, loc.longitude) <= VENUE_RADIUS_METERS) {
          venueId = venue.id;
          break;
        }
      }
    }
    if (venueId) {
      realCountsMap[venueId] = (realCountsMap[venueId] || 0) + 1;
      addHeat(venueId, loc, STALE_MS);
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
    if (!venueId) {
      for (const venue of venues) {
        if (haversineMeters(venue.latitude, venue.longitude, loc.latitude, loc.longitude) <= VENUE_RADIUS_METERS) {
          venueId = venue.id;
          break;
        }
      }
    }
    if (venueId) {
      simCountsMap[venueId] = (simCountsMap[venueId] || 0) + 1;
      addHeat(venueId, loc, SIM_STALE_MS);
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

    // Quantize to 10m: metre-level precision made every GPS jitter produce a
    // "changed" venues array (areVenuesEqual compares distanceKm), cascading
    // re-renders and map-marker re-rasterization app-wide for no visible change.
    const distanceKm =
      userLat !== null && userLng !== null
        ? Math.round(haversineMeters(userLat, userLng, venue.latitude, venue.longitude) / 10) * 10 / 1000
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

    let simUserCount = 0;
    if (includeSimulated) {
      simUserCount = rtdbSimCount;
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

    const heatWeight = heatWeightMap[venue.id] || 0;
    if (heatWeight > 0) {
      // Raw decayed weight for now; normalized to 0..1 below once the max is known
      heatPoints.push({
        latitude: venue.latitude,
        longitude: venue.longitude,
        weight: heatWeight,
      });
    }
  }

  // Normalize heat to 0..1 against the busiest venue (see HEAT_REF_FLOOR).
  // Weights are quantized to 0.05 steps: decay advances on every recompute, and
  // an ever-changing weight would push a new points array (and a native tile
  // cache wipe) across the bridge every 2 seconds for no visible change.
  if (heatPoints.length > 0) {
    const maxHeat = heatPoints.reduce((max, p) => Math.max(max, p.weight), HEAT_REF_FLOOR);
    for (const p of heatPoints) {
      p.weight = Math.max(0.05, Math.round((p.weight / maxHeat) * 20) / 20);
      hashStr += `${p.latitude},${p.longitude}:${p.weight};`;
    }

    // Calibration anchor: a max-weight point that pins the KDE normalization
    // scale, so a lone low-weight venue can't be auto-normalized up to a red
    // core. Parked at the south pole and kept permanently off-screen by the
    // map's pan boundaries (see MapScreen's onMapReady).
    heatPoints.push({
      latitude: -85,
      longitude: 0,
      weight: 1,
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
  // Idempotently starts the single shared GPS watcher. Screens that request
  // location permission at runtime call this after a grant, since the watcher
  // can't start while permission is still denied.
  ensureLocationWatch: () => void;
}

const LiveVenuesContext = createContext<LiveVenuesContextValue>({
  venues: [],
  heatPoints: [],
  isLoading: true,
  scheduledVenues: [],
  ensureLocationWatch: () => {},
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
          const parsed = JSON.parse(cachedLive);
          setVenues(parsed);
          venuesRef.current = parsed; // Sync ref immediately to allow stale-while-revalidate background loading
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
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  const locationWatchPendingRef = useRef(false);
  // Rolling per-venue count samples used to derive the rising/falling trend
  const countHistoryRef = useRef<Record<string, { t: number; count: number }[]>>({});
  const simConfigRef = useRef({ enabled: true, threshold: 100 });
  const hasRealLocsLoadedRef = useRef(false);
  const hasSimLocsLoadedRef = useRef(false);

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

    // Wait until locations and simulated locations have loaded at least once (or fallback fires)
    const isReady = hasRealLocsLoadedRef.current && hasSimLocsLoadedRef.current;
    if (!isReady) {
      isProcessingRef.current = false;
      return;
    }

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

      // Attach the crowd trend: compare each venue's count against the oldest
      // history sample that is 10–35 minutes old. Needs a meaningful jump in
      // both absolute (≥3 people) and relative (≥20%) terms to leave 'stable'.
      const nowT = Date.now();
      for (const v of result.venues) {
        const hist = countHistoryRef.current[v.id] ?? (countHistoryRef.current[v.id] = []);
        if (hist.length === 0 || nowT - hist[hist.length - 1].t >= TREND_SAMPLE_MS) {
          hist.push({ t: nowT, count: v.userCount });
        }
        while (hist.length > 0 && nowT - hist[0].t > TREND_WINDOW_MS) {
          hist.shift();
        }
        const past = hist.find((s) => nowT - s.t >= TREND_MIN_AGE_MS);
        let trend: VenueTrend = 'stable';
        if (past) {
          const threshold = Math.max(3, past.count * 0.2);
          if (v.userCount - past.count >= threshold) trend = 'rising';
          else if (past.count - v.userCount >= threshold) trend = 'falling';
        }
        v.trend = trend;
      }

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

  // Single shared GPS watcher: this provider consumes it for distance/heat
  // recomputes and mirrors coords into the app store for screens (MapScreen).
  // Idempotent — safe to call from anywhere, including after a late permission
  // grant; a no-op if the watch is already running or permission is denied.
  const ensureLocationWatch = useCallback(() => {
    if (locationSubRef.current || locationWatchPendingRef.current) return;
    locationWatchPendingRef.current = true;
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 15000, distanceInterval: 20 },
          (loc) => {
            userPosRef.current = { lat: loc.coords.latitude, lng: loc.coords.longitude };
            useAppStore.getState().setUserLocation({
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
            });
            requestRecalculate();
          }
        );
        if (locationSubRef.current) {
          // Another caller won the race while we awaited — keep theirs
          sub.remove();
        } else {
          locationSubRef.current = sub;
        }
      } catch (e) {
        console.warn('[LiveVenuesContext] Location watch error:', e);
      } finally {
        locationWatchPendingRef.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      // Only show the loading spinner if we don't have cached data to display
      if (venuesRef.current.length === 0) {
        setIsLoading(true);
      }

      // 4-second safety fallback to prevent hanging in loading state if network is poor
      const fallbackTimer = setTimeout(() => {
        console.log('[LiveVenuesContext] Network load fallback triggered.');
        hasRealLocsLoadedRef.current = true;
        hasSimLocsLoadedRef.current = true;
        requestRecalculate();
      }, 4000);

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

      // 1. User location watcher (shared app-wide via the store)
      ensureLocationWatch();

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
      const unsubLocs = subscribeToRTDB(
        ref(realtimeDB, 'locations'),
        (snap) => {
          locationsRef.current = snap.exists() ? snap.val() : {};
          hasRealLocsLoadedRef.current = true;
          requestRecalculate();
        },
        (e) => console.warn('[LiveVenuesContext] Locations listener error:', e)
      );

      // 4. Simulated locations listener
      const unsubSimLocs = subscribeToRTDB(
        ref(realtimeDB, 'simulated_locations'),
        (snap) => {
          simLocationsRef.current = snap.exists() ? snap.val() : {};
          hasSimLocsLoadedRef.current = true;
          requestRecalculate();
        },
        (e) => console.warn('[LiveVenuesContext] SimLocations listener error:', e)
      );

      // Store cleanup functions to be called when auth changes or component unmounts
      return () => {
        if (locationSubRef.current) {
          locationSubRef.current.remove();
          locationSubRef.current = null;
        }
        unsubVenues();
        unsubLocs();
        unsubSimLocs();
        clearTimeout(fallbackTimer);
        hasRealLocsLoadedRef.current = false;
        hasSimLocsLoadedRef.current = false;
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
    ensureLocationWatch,
  }), [venues, heatPoints, isLoading, scheduledVenues, ensureLocationWatch]);

  return (
    <LiveVenuesContext.Provider value={contextValue}>
      {children}
    </LiveVenuesContext.Provider>
  );
};
