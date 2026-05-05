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

// ─── Weight from user count ───────────────────────────────────────────────────
// Maps user count to a 0–1 weight using a log scale so the full colour
// gradient is used meaningfully across the range 1 → 100+.
//   1–5   users → ~0.05–0.20  (cool blue)
//   10–30 users → ~0.30–0.50  (green/yellow)
//   50    users → ~0.70       (orange)
//   100+  users → ~0.90–1.0   (red / white core)
function userCountToWeight(count: number): number {
  if (count <= 0) return 0;
  const w = Math.log1p(count) / Math.log1p(100); // saturates at ~100 users
  return Math.min(1.0, Math.max(0.05, w));        // floor ensures visibility
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
): HeatPoint[] {
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

    points.push({
      latitude: venue.latitude,   // ← only venue coords ever touch the map
      longitude: venue.longitude,
      weight: userCountToWeight(userCount),
    });
  }

  return points;
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

    const points = computeVenueHeatPoints(
      venuesRef.current,
      realLocBuffer.current,
      simLocBuffer.current,
      includeSimulated,
    );

    setHeatPoints(points);
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
