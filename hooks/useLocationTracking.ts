import { useEffect } from 'react';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { ref, set } from 'firebase/database';
import { realtimeDB } from '../services/firebase';
import { useAppStore } from './useAppStore';
import Toast from 'react-native-toast-message';

// ─── Background Task Name ─────────────────────────────────────────────────────
export const LOCATION_TASK_NAME = 'eventa-background-location';

// ─── Global task definition (must be at module top-level) ─────────────────────
// NOTE: This runs in a separate JS context when backgrounded. Firebase is
// initialised again via the singleton guard in firebase.ts so it's safe.
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }: TaskManager.TaskManagerTaskBody<{ locations: Location.LocationObject[] }>) => {
  if (error) {
    console.error('[BG Location Task]', error);
    return;
  }
  if (!data) return;

  const { locations } = data;
  const location = locations[0];
  if (!location) return;

  // We can't use the Zustand store here (different context), so we read
  // the user UID that we stashed in the task options when we registered it.
  try {
    const taskOptions = await Location.getBackgroundPermissionsAsync();
    // The task options userId is threaded through via a shared module ref.
    const userId = (global as any).__eventaUserId;
    if (!userId) return;

    const userLocationRef = ref(realtimeDB, `locations/${userId}`);
    await set(userLocationRef, {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      timestamp: location.timestamp,
      user_id: userId,
    });
  } catch (err) {
    console.error('[BG Location Task] Firebase write failed:', err);
  }
});

// ─── Hook ─────────────────────────────────────────────────────────────────────
export const useLocationTracking = () => {
  const { user } = useAppStore();

  useEffect(() => {
    if (!user) return;

    // Stash the UID globally so the background task can access it
    (global as any).__eventaUserId = user.uid;

    let locationSub: Location.LocationSubscription | null = null;

    const startTracking = async () => {
      try {
        // 1. Request foreground permission first (Android requirement)
        const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
        if (fgStatus !== 'granted') {
          Toast.show({
            type: 'error',
            text1: 'Location Required',
            text2: 'Please allow location permission to discover nearby venues.',
          });
          return;
        }

        // Always start foreground watcher for reliable UI updates while the app is open
        locationSub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 15000, distanceInterval: 10 },
          (loc) => {
            const userLocationRef = ref(realtimeDB, `locations/${user.uid}`);
            set(userLocationRef, {
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
              timestamp: loc.timestamp,
              user_id: user.uid,
            }).catch((e) => console.warn('[Location] Failed to write foreground location to RTDB:', e));
          }
        );

        // 2. Request background permission
        let hasBackground = false;
        try {
          const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
          hasBackground = bgStatus === 'granted';
        } catch (bgErr: any) {
          console.warn(
            '[Location] Background permission request skipped/failed (possibly missing ACCESS_BACKGROUND_LOCATION in AndroidManifest):',
            bgErr.message || bgErr
          );
        }

        if (hasBackground) {
          // ── Background tracking via OS-managed task ───────────────────────
          const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)
            .catch(() => false);

          if (!alreadyRunning) {
            await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
              accuracy: Location.Accuracy.Low,         // Low power / accuracy
              timeInterval: 300000,                      // 5 minutes
              distanceInterval: 500,                    // 500 meters
              deferredUpdatesInterval: 300000,
              deferredUpdatesDistance: 500,
              showsBackgroundLocationIndicator: false,   // no iOS status-bar pill
              foregroundService: {
                // Required on Android to keep the task alive in the background
                notificationTitle: 'Eventas',
                notificationBody: 'Updating your location for venue discovery when you move.',
                notificationColor: '#00FFCC',
              },
              pausesUpdatesAutomatically: true,         // Allow OS to pause updates when user is stationary
            });
            console.log('[Location] Background tracking started.');
          }
        } else {
          // ── Foreground-only fallback ──────────────────────────────────────
          console.log('[Location] Background permission not granted or supported, using foreground watcher only.');
        }
      } catch (err) {
        console.warn('[Location] Failed to start tracking:', err);
      }
    };

    startTracking();

    // Cleanup: stop the background task when user signs out
    return () => {
      (global as any).__eventaUserId = null;
      if (locationSub) {
        locationSub.remove();
      }
      Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)
        .then((running) => {
          if (running) Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
        })
        .catch(() => {});
    };
  }, [user]);
};
