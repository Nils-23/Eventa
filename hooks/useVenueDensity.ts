import { useEffect, useState, useRef } from 'react';
import * as Location from 'expo-location';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { ref, onValue } from 'firebase/database';
import Toast from 'react-native-toast-message';
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
  distanceKm: number | null; // null if user location unknown
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

/** Cross-reference venues × active user locations — returns sorted array */
function computeDensity(
  venues: RawVenue[],
  locations: Record<string, RawLocation>,
  userLat: number | null,
  userLng: number | null,
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
      (loc) => {
        if (loc.venueId) {
          return loc.venueId === venue.id;
        }
        return haversineMeters(
          venue.latitude, venue.longitude,
          loc.latitude, loc.longitude,
        ) <= VENUE_RADIUS_METERS;
      }
    ).length;

    const distanceKm =
      userLat !== null && userLng !== null
        ? Math.round(haversineMeters(userLat, userLng, venue.latitude, venue.longitude)) / 1000
        : null;

    const activityLevel = toActivityLevel(userCount);
    return {
      ...venue,
      userCount,
      activityLevel,
      activityColor: toActivityColor(activityLevel),
      distanceKm,
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
  const venuesRef = useRef<RawVenue[]>([]);
  const locationsRef = useRef<Record<string, RawLocation>>({});
  const simulatedLocationsRef = useRef<Record<string, RawLocation>>({});
  const userPosRef = useRef<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });

  const recalculate = () => {
    const combinedLocations = {
      ...locationsRef.current,
      ...simulatedLocationsRef.current,
    };
    const result = computeDensity(
      venuesRef.current,
      combinedLocations,
      userPosRef.current.lat,
      userPosRef.current.lng,
    );
    setVenues(result);
    setIsLoading(false);
  };

  useEffect(() => {
    // ── 0️⃣  User location watcher ──────────────────────────────────────────
    let locationSub: Location.LocationSubscription | null = null;
    Location.getForegroundPermissionsAsync().then(({ status }) => {
      if (status !== 'granted') return;
      Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 15000, distanceInterval: 20 },
        (loc) => {
          userPosRef.current = { lat: loc.coords.latitude, lng: loc.coords.longitude };
          recalculate();
        },
      ).then((sub) => { locationSub = sub; });
    });

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
      (err) => {
        console.error('[useVenueDensity] Firestore error:', err);
        Toast.show({
          type: 'error',
          text1: 'Sync Error',
          text2: 'Could not fetch venues. Check your connection.',
        });
      },
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
      (err) => {
        console.error('[useVenueDensity] RTDB error:', err);
        Toast.show({
          type: 'error',
          text1: 'Live Sync Lost',
          text2: 'Reconnecting to the Realtime Database...',
        });
      },
    );

    // ── 3️⃣  Realtime DB simulated locations listener ──────────────────────
    const simLocRef = ref(realtimeDB, 'simulated_locations');
    const unsubSimLocations = onValue(
      simLocRef,
      (snap) => {
        simulatedLocationsRef.current = snap.exists()
          ? (snap.val() as Record<string, RawLocation>)
          : {};
        recalculate();
      },
      (err) => {
        console.error('[useVenueDensity] RTDB sim error:', err);
      },
    );

    return () => {
      if (locationSub) locationSub.remove();
      unsubVenues();
      unsubLocations();
      unsubSimLocations();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { venues, isLoading };
};
