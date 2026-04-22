import { useEffect } from 'react';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { ref, set } from 'firebase/database';
import Toast from 'react-native-toast-message';
import { realtimeDB } from '../services/firebase';
import { useAppStore } from './useAppStore';

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

        // 2. Request background permission
        const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
        const hasBackground = bgStatus === 'granted';

        if (hasBackground) {
          // ── Background tracking via OS-managed task ───────────────────────
          const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)
            .catch(() => false);

          if (!alreadyRunning) {
            await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
              accuracy: Location.Accuracy.Balanced,
              timeInterval: 15000,       // 15 seconds
              distanceInterval: 10,      // or 10 m moved
              deferredUpdatesInterval: 15000,
              deferredUpdatesDistance: 10,
              showsBackgroundLocationIndicator: false, // no iOS status-bar pill
              foregroundService: {
                // Required on Android to keep the task alive in the background
                notificationTitle: 'Eventa',
                notificationBody: 'Tracking your location for the heatmap.',
                notificationColor: '#00FFCC',
              },
              pausesUpdatesAutomatically: false,
            });
            console.log('[Location] Background tracking started.');
          }
        } else {
          // ── Foreground-only fallback ──────────────────────────────────────
          Toast.show({
            type: 'info',
            text1: 'Background Tracking Disabled',
            text2: 'Your heatmap contribution halts when app is minimised.',
          });
          
          await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.Balanced, timeInterval: 15000, distanceInterval: 10 },
            (loc) => {
              const userLocationRef = ref(realtimeDB, `locations/${user.uid}`);
              set(userLocationRef, {
                latitude: loc.coords.latitude,
                longitude: loc.coords.longitude,
                timestamp: loc.timestamp,
                user_id: user.uid,
              }).catch(console.error);
            }
          );
        }
      } catch (err) {
        console.error('[Location] Failed to start tracking:', err);
      }
    };

    startTracking();

    // Cleanup: stop the background task when user signs out
    return () => {
      (global as any).__eventaUserId = null;
      Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)
        .then((running) => {
          if (running) Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
        })
        .catch(() => {});
    };
  }, [user]);
};
