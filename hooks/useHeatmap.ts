import { useEffect, useState, useRef, useCallback } from 'react';
import { ref, onValue } from 'firebase/database';
import { realtimeDB } from '../services/firebase';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface HeatCell {
  latitude: number;
  longitude: number;
  density: number;   // 1 = low, up to N users per cell
  radius: number;    // metres — grows with density
  color: string;     // interpolated blue → red
}

interface RawLocation {
  latitude: number;
  longitude: number;
  timestamp: number;
  user_id: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────
// Each grid cell is this many decimal degrees (~111 m per 0.001°)
const GRID_SIZE = 0.003; // ~330 m grid cell
const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // ignore users inactive > 2 hours

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Snap a coordinate to its grid-cell centre */
function snapToGrid(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

/**
 * Map a density count to a colour on a blue → cyan → green → yellow → red gradient.
 * thresholds: [1–2] blue, [3–5] cyan, [6–10] green, [11–20] yellow, [21+] red
 */
function densityToColor(density: number): string {
  if (density <= 2)  return 'rgba(65, 105, 225, 0.55)';  // blue
  if (density <= 5)  return 'rgba(0, 200, 200, 0.60)';   // cyan
  if (density <= 10) return 'rgba(0, 200, 80, 0.60)';    // green
  if (density <= 20) return 'rgba(255, 200, 0, 0.65)';   // yellow
  return               'rgba(255, 40, 40, 0.70)';        // red (Crazy!)
}

/** Radius in metres — bigger cells for denser areas so they visually blend */
function densityToRadius(density: number): number {
  if (density <= 2)  return 90;
  if (density <= 5)  return 130;
  if (density <= 10) return 180;
  if (density <= 20) return 250;
  return 350;
}

/** Convert raw locations map into bucketed HeatCells */
function buildHeatCells(raw: Record<string, RawLocation>): HeatCell[] {
  const now = Date.now();
  const buckets = new Map<string, { lat: number; lng: number; count: number }>();

  for (const entry of Object.values(raw)) {
    // Skip stale / malformed entries
    if (!entry.latitude || !entry.longitude) continue;
    if (now - entry.timestamp > STALE_THRESHOLD_MS) continue;

    const lat = snapToGrid(entry.latitude);
    const lng = snapToGrid(entry.longitude);
    const key = `${lat.toFixed(6)}_${lng.toFixed(6)}`;

    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      buckets.set(key, { lat, lng, count: 1 });
    }
  }

  return Array.from(buckets.values()).map(({ lat, lng, count }) => ({
    latitude: lat,
    longitude: lng,
    density: count,
    radius: densityToRadius(count),
    color: densityToColor(count),
  }));
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export const useHeatmap = () => {
  const [heatCells, setHeatCells] = useState<HeatCell[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Keep the unsubscribe function in a ref so we can clean it up
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const locationsRef = ref(realtimeDB, 'locations');

    // onValue fires immediately with the snapshot and then on every change
    const unsubscribe = onValue(
      locationsRef,
      (snapshot) => {
        setIsLoading(false);
        if (!snapshot.exists()) {
          setHeatCells([]);
          return;
        }
        const raw = snapshot.val() as Record<string, RawLocation>;
        // Run bucketing off the render thread as a micro-task
        Promise.resolve().then(() => {
          setHeatCells(buildHeatCells(raw));
        });
      },
      (error) => {
        console.error('[useHeatmap] Firebase read error:', error);
        setIsLoading(false);
      }
    );

    unsubscribeRef.current = unsubscribe;
    return () => unsubscribe();
  }, []);

  return { heatCells, isLoading };
};
