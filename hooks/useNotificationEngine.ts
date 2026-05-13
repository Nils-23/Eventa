import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { get, ref } from 'firebase/database';
import { collection, getDocs } from 'firebase/firestore';
import { realtimeDB, firestore } from '../services/firebase';
import { getDistanceInMeters } from '../utils/locationUtils';
import { useAppStore } from './useAppStore';
import { useLiveVenues } from './useLiveVenues';

const VENUE_RADIUS_METERS = 200;
const STALE_MS = 2 * 60 * 60 * 1000; // 2 hours
const CRAZY_THRESHOLD = 75; // > 75 users
const THROTTLE_MS = 2 * 60 * 60 * 1000; // 2 hours cool-down per venue

// Configure notifications to show even when app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export const useNotificationEngine = () => {
  const { user } = useAppStore();
  const throttleRef = useRef<Record<string, number>>({});

  useEffect(() => {
    // Only run if user is logged in
    if (!user) return;

    // Request permissions
    const requestPermissions = async () => {
      const { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') {
        await Notifications.requestPermissionsAsync();
      }
    };
    requestPermissions();

    const checkDensity = async () => {
      try {
        const now = Date.now();
        
        // 1. Fetch LiveVenues
        const venuesSnap = await getDocs(collection(firestore, 'venues'));
        if (venuesSnap.empty) return;
        const venues = venuesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

        // 2. Fetch real user locations
        const locsSnap = await get(ref(realtimeDB, 'locations'));
        const realLocs = locsSnap.exists() ? locsSnap.val() : {};

        // 3. Fetch simulated user locations
        const simLocsSnap = await get(ref(realtimeDB, 'simulated_locations'));
        const simLocs = simLocsSnap.exists() ? simLocsSnap.val() : {};

        const allLocs = { ...realLocs, ...simLocs };

        // 4. Filter stale locations
        const activeLocations = Object.values(allLocs).filter((loc: any) => 
          loc.latitude && loc.longitude && (now - loc.timestamp < STALE_MS)
        );

        // 5. Evaluate venues
        for (const venue of venues) {
          const userCount = activeLocations.filter((loc: any) => {
            if (loc.venueId) {
              return loc.venueId === venue.id;
            }
            return getDistanceInMeters(venue.latitude, venue.longitude, loc.latitude, loc.longitude) <= VENUE_RADIUS_METERS;
          }).length;

          if (userCount > CRAZY_THRESHOLD) {
            const lastNotified = throttleRef.current[venue.id] || 0;
            
            // If we haven't notified for this venue recently
            if (now - lastNotified > THROTTLE_MS) {
              
              // Trigger local notification
              await Notifications.scheduleNotificationAsync({
                content: {
                  title: `🔥 Crazy vibes at ${venue.name} right now!`,
                  body: `Over ${userCount} people are there. Check it out!`,
                  data: { venueId: venue.id },
                },
                trigger: null, // Send immediately
              });

              // Update throttle
              throttleRef.current[venue.id] = now;
            }
          }
        }
      } catch (error: any) {
        const msg = error?.message || '';
        if (!msg.includes('Permission denied') && !msg.includes('insufficient permissions')) {
          console.warn('Error in Notification Engine:', error);
        }
      }
    };

    // Run once initially, then every 30 seconds
    checkDensity();
    const intervalId = setInterval(checkDensity, 30000);

    return () => clearInterval(intervalId);
  }, [user]);
};
