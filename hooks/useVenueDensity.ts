import { useEffect, useState } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { ref, onValue } from 'firebase/database';
import { firestore, realtimeDB } from '../services/firebase';

// ─── Types ────────────────────────────────────────────────────────────────────
export type ActivityLevel = 'None' | 'Low' | 'Medium' | 'High' | 'Crazy';

export interface VenueWithDensity {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  description: string;
  userCount: number;
  activityLevel: ActivityLevel;
  activityColor: string;
}

interface RawLocation {
  latitude: number;
  longitude: number;
  timestamp: number;
  user_id: string;
}

interface RawVenue {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  description: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────
const VENUE_RADIUS_METERS = 200;
const STALE_MS = 2 * 60 * 60 * 1000; // 2 hours

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
  if (count <= 3)  return 'Low';
  if (count <= 10) return 'Medium';
  if (count <= 25) return 'High';
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

/** Cross-reference venues × active user locations — returns sorted array */
function computeDensity(
  venues: RawVenue[],
  locations: Record<string, RawLocation>,
): VenueWithDensity[] {
  const now = Date.now();

  // Filter to only active (non-stale) user locations
  const activeLocations = Object.values(locations).filter(
    (loc) =>
      loc.latitude &&
      loc.longitude &&
      now - loc.timestamp < STALE_MS,
  );

  const result: VenueWithDensity[] = venues.map((venue) => {
    const userCount = activeLocations.filter(
      (loc) =>
        haversineMeters(
          venue.latitude, venue.longitude,
          loc.latitude, loc.longitude,
        ) <= VENUE_RADIUS_METERS,
    ).length;

    const activityLevel = toActivityLevel(userCount);
    return {
      ...venue,
      userCount,
      activityLevel,
      activityColor: toActivityColor(activityLevel),
    };
  });

  // Sort descending by user count (highest activity first)
  return result.sort((a, b) => b.userCount - a.userCount);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export const useVenueDensity = () => {
  const [venues, setVenues] = useState<VenueWithDensity[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Keep mutable refs so both listeners always have the latest snapshot
  // without creating new subscriptions on every state change
  const venuesRef = { current: [] as RawVenue[] };
  const locationsRef = { current: {} as Record<string, RawLocation> };

  const recalculate = () => {
    const result = computeDensity(venuesRef.current, locationsRef.current);
    setVenues(result);
    setIsLoading(false);
  };

  useEffect(() => {
    // ── 1️⃣  Firestore venues listener ─────────────────────────────────────
    const venueQuery = query(collection(firestore, 'venues'));
    const unsubVenues = onSnapshot(
      venueQuery,
      (snap) => {
        venuesRef.current = snap.docs.map((doc) => ({
          id: doc.id,
          ...(doc.data() as Omit<RawVenue, 'id'>),
        }));
        recalculate();
      },
      (err) => console.error('[useVenueDensity] Firestore error:', err),
    );

    // ── 2️⃣  Realtime DB locations listener ────────────────────────────────
    const locRef = ref(realtimeDB, 'locations');
    const unsubLocations = onValue(
      locRef,
      (snap) => {
        locationsRef.current = snap.exists()
          ? (snap.val() as Record<string, RawLocation>)
          : {};
        recalculate();
      },
      (err) => console.error('[useVenueDensity] RTDB error:', err),
    );

    return () => {
      unsubVenues();
      unsubLocations();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { venues, isLoading };
};
