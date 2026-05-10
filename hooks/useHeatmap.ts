import { useEffect, useState, useRef } from 'react';
import { ref, onValue } from 'firebase/database';
import { doc, onSnapshot, collection, query } from 'firebase/firestore';
import { realtimeDB, firestore } from '../services/firebase';

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
  latitude: number;
  longitude: number;
}

interface SimulationConfig {
  enabled: boolean;
  threshold: number;
}

// ─── Config ─────────────────────────────────────────────────────────────────
const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours
const REFRESH_RATE_MS = 15000;

// Radius used to assign users to venues (must match useVenueDensity)
const VENUE_RADIUS_METERS = 200;

// ─── Haversine distance (metres) ─────────────────────────────────────────────
function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// No longer need userCountToWeight, native KDE handles intensity based on point frequency

const MAX_SCATTER_POINTS = 500;
const venueScatterCache = new Map<string, { z0: number, z1: number }[]>();

function getVenueScatter(venueId: string): { z0: number, z1: number }[] {
  if (!venueScatterCache.has(venueId)) {
    const offsets = [];
    for (let i = 0; i < MAX_SCATTER_POINTS; i++) {
      const u1 = Math.max(0.0001, Math.random());
      const u2 = Math.random();
      const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
      const z1 = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);
      offsets.push({ z0, z1 });
    }
    venueScatterCache.set(venueId, offsets);
  }
  return venueScatterCache.get(venueId)!;
}

// ─── Core compute: venue-centred heat ────────────────────────────────────────
// PRIVACY NOTE: Individual user locations are NEVER included in the output.
// Only venue coordinates are used. User locations are only used internally
// to count how many people are near each venue.
function computeVenueHeatPoints(
  venues: RawVenue[],
  realLocs: Record<string, RawLocation>,
  simLocs: Record<string, RawLocation>,
  includeSimulated: boolean,
): { points: HeatPoint[], hash: string } {
  const now = Date.now();

  // Build a filtered list of active user locations (used only for counting)
  const activeLocs: RawLocation[] = [];
  for (const loc of Object.values(realLocs)) {
    if (loc.latitude && loc.longitude && now - loc.timestamp < STALE_THRESHOLD_MS) {
      activeLocs.push(loc);
    }
  }
  if (includeSimulated) {
    for (const loc of Object.values(simLocs)) {
      if (loc.latitude && loc.longitude && now - loc.timestamp < STALE_THRESHOLD_MS) {
        activeLocs.push(loc);
      }
    }
  }

  const points: HeatPoint[] = [];
  let hashStr = '';

  for (const venue of venues) {
    if (!venue.latitude || !venue.longitude) continue;

    // Count users within the venue radius — locations are discarded after this
    const userCount = activeLocs.filter(loc => {
      if (loc.venueId) {
        return loc.venueId === venue.id;
      }
      return haversineMeters(venue.latitude, venue.longitude, loc.latitude, loc.longitude)
        <= VENUE_RADIUS_METERS;
    }).length;

    // Only render venues that have at least one active user
    if (userCount === 0) continue;

    const count = Math.max(1, userCount);
    
    // Add to our hash string to detect state changes
    hashStr += `${venue.id}:${count};`;

    // 1. Add a heavy central core point
    points.push({
      latitude: venue.latitude,
      longitude: venue.longitude,
      weight: count
    });

    // 2. Generate a Gaussian scatter of points around the venue
    // The native Heatmap uses Kernel Density Estimation (KDE). 
    // By providing a cluster of points instead of just one, we bypass the 
    // maximum radius limits and create large, seamless blobs that scale with users.
    const numScattered = Math.min(count * 4, 400); // Generate up to 400 points
    
    // Spread massively based on crowd size so large venues (e.g., 500 users) 
    // are visible even from very far zoom levels.
    // Base 50m, +3 meters per user. 500 users = 1550m spread (1.5km).
    const spreadMeters = 50 + (count * 3); 

    // We distribute the total weight among the scattered points 
    // so the blob remains intensely colored without overwhelming the KDE center
    const pointWeight = Math.max(1, Math.floor(count / 10));

    const scatterOffsets = getVenueScatter(venue.id);

    for (let i = 0; i < numScattered; i++) {
      // Use cached Gaussian offsets so the point cloud is perfectly stable across renders
      const { z0, z1 } = scatterOffsets[i];
      
      const latOffset = z0 * (spreadMeters / 111320);
      const lngOffset = z1 * (spreadMeters / (111320 * Math.cos((venue.latitude * Math.PI) / 180)));

      points.push({
        latitude: venue.latitude + latOffset,
        longitude: venue.longitude + lngOffset,
        weight: pointWeight
      });
    }
  }

  return { points, hash: hashStr };
}

// ─── Hook ────────────────────────────────────────────────────────────────────
export const useHeatmap = () => {
  const [heatPoints, setHeatPoints] = useState<HeatPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const venuesRef = useRef<RawVenue[]>([]);
  const realLocBuffer = useRef<Record<string, RawLocation>>({});
  const simLocBuffer = useRef<Record<string, RawLocation>>({});
  const simulationConfig = useRef<SimulationConfig>({ enabled: false, threshold: 50 });
  const realUserCountRef = useRef(0);
  const initialLoadDone = useRef(false);
  const lastCountsHash = useRef<string>('');

  const processBuffer = () => {
    const now = Date.now();
    // Count active real users to decide whether simulation should blend in
    let realCount = 0;
    for (const loc of Object.values(realLocBuffer.current)) {
      if (loc.latitude && loc.longitude && now - loc.timestamp < STALE_THRESHOLD_MS) {
        realCount++;
      }
    }
    realUserCountRef.current = realCount;

    const includeSimulated =
      simulationConfig.current.enabled &&
      realCount < simulationConfig.current.threshold;

    const { points, hash } = computeVenueHeatPoints(
      venuesRef.current,
      realLocBuffer.current,
      simLocBuffer.current,
      includeSimulated,
    );

    // Only trigger a React state update (and Native Bridge crossing) if the 
    // actual crowd sizes have changed. This prevents the native map from 
    // infinitely flushing its tile cache due to rapid Firebase location updates.
    if (hash !== lastCountsHash.current) {
      lastCountsHash.current = hash;
      setHeatPoints(points);
    }
  };

  useEffect(() => {
    // 1. Simulation config
    const configUnsub = onSnapshot(doc(firestore, 'settings', 'simulation'), snap => {
      if (snap.exists()) {
        const d = snap.data();
        simulationConfig.current = {
          enabled: d.enabled ?? false,
          threshold: d.threshold ?? 50,
        };
        processBuffer();
      }
    });

    // 2. Venues — we need their coordinates to centre heat on them
    const venueUnsub = onSnapshot(query(collection(firestore, 'venues')), snap => {
      venuesRef.current = snap.docs.map(d => ({
        id: d.id,
        latitude: d.data().latitude,
        longitude: d.data().longitude,
      }));
      if (initialLoadDone.current) processBuffer();
    });

    // 3. Real user locations (used only for counting — never plotted)
    const locRef = ref(realtimeDB, 'locations');
    const locUnsub = onValue(locRef, snap => {
      setIsLoading(false);
      realLocBuffer.current = snap.exists() ? snap.val() : {};
      if (!initialLoadDone.current) {
        initialLoadDone.current = true;
      }
      processBuffer();
    }, err => {
      console.error('[useHeatmap] Firebase error:', err);
      setIsLoading(false);
    });

    // 4. Simulated locations (also only for counting)
    const simRef = ref(realtimeDB, 'simulated_locations');
    const simUnsub = onValue(simRef, snap => {
      simLocBuffer.current = snap.exists() ? snap.val() : {};
      processBuffer();
    }, err => {
      console.error('[useHeatmap] Sim locations error:', err);
    });

    // 5. Periodic refresh
    const timer = setInterval(processBuffer, REFRESH_RATE_MS);

    return () => {
      configUnsub();
      venueUnsub();
      locUnsub();
      simUnsub();
      clearInterval(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { heatPoints, isLoading };
};
