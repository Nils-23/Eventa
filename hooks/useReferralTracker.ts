import { useEffect } from 'react';
import { Platform, NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../services/firebase';

/**
 * Reads the Google Play Install Referrer (Android only). This is the reliable way
 * to attribute a brand-new install: inviteRedirect appends `&referrer=<code>` to the
 * Play Store URL, and Google Play surfaces that value here on first launch.
 *
 * Returns the raw referrer token only if it matches our referral-code shape
 * (a bare Firebase UID or creator code). Organic installs return
 * "utm_source=google-play&utm_medium=organic", which is rejected. Safe no-op if the
 * native module isn't linked yet (Expo Go / before a native rebuild) or on iOS.
 */
const readPlayInstallReferrer = (): Promise<string | null> =>
  new Promise((resolve) => {
    if (Platform.OS !== 'android' || !NativeModules.PlayInstallReferrer) {
      return resolve(null);
    }
    try {
      // Lazy require so the native EventEmitter is only constructed when present.
      const { PlayInstallReferrer } = require('react-native-play-install-referrer');
      let settled = false;
      const done = (value: string | null) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      // Guard against the callback never firing (e.g. Play Store unavailable).
      const timer = setTimeout(() => done(null), 4000);
      PlayInstallReferrer.getInstallReferrerInfo((info: any, error: any) => {
        clearTimeout(timer);
        if (error || !info || !info.installReferrer) return done(null);
        const raw = String(info.installReferrer).trim();
        done(/^[A-Za-z0-9_-]+$/.test(raw) ? raw : null);
      });
    } catch {
      resolve(null);
    }
  });

/**
 * Hook to track app installations on first open.
 * Evaluates attribution parameters and logs them via a secure Cloud Function.
 */
export const useReferralTracker = () => {
  useEffect(() => {
    const trackFirstOpen = async () => {
      try {
        // Check if install was already successfully registered
        const isRegistered = await AsyncStorage.getItem('isInstallRegistered');
        if (isRegistered === 'true') {
          return; // Already registered install on this device, skip
        }

        // Get or generate deviceId (persistent device UUID)
        let deviceId = await AsyncStorage.getItem('deviceId');
        if (!deviceId) {
          deviceId = Crypto.randomUUID();
          await AsyncStorage.setItem('deviceId', deviceId);
        }

        // Capture referral attribution
        let referralCode: string | null = null;

        if (Platform.OS === 'android') {
          // Android attribution priority:
          // 1. Simulated referrer (Admin Dashboard Simulation Suite)
          // 2. Deep link referral code (existing user opened an App Link)
          // 3. Google Play Install Referrer (reliable for brand-new installs)
          const simulatedReferrer = await AsyncStorage.getItem('simulated_referrer');
          const deepLinkReferrer = await AsyncStorage.getItem('creatorReferralCode');
          const playReferrer = await readPlayInstallReferrer();
          referralCode = simulatedReferrer || deepLinkReferrer || playReferrer || null;

          if (simulatedReferrer) {
            console.log('[ReferralTracker] Using simulated Android referrer:', simulatedReferrer);
          } else if (!deepLinkReferrer && playReferrer) {
            console.log('[ReferralTracker] Using Google Play Install Referrer:', playReferrer);
          }
        } else {
          // On iOS, first-open attribution relies on server-side IP + User-Agent match.
          // However, if the user opened the app directly via deep link, we pass it.
          const deepLinkReferrer = await AsyncStorage.getItem('creatorReferralCode');
          referralCode = deepLinkReferrer || null;
        }

        console.log('[ReferralTracker] Initiating install registration...', {
          deviceId,
          referralCode,
          os: Platform.OS,
        });

        // Invoke Cloud Function for install validation
        const registerInstallFn = httpsCallable(functions, 'registerInstall');
        const response = await registerInstallFn({
          deviceId,
          referralCode,
          deviceDetails: {
            brand: Device.brand || 'unknown',
            model: Device.modelName || 'unknown',
            osName: Device.osName || Platform.OS,
            osVersion: Device.osVersion || 'unknown',
            isDevice: Device.isDevice ?? true,
          },
        });

        const result: any = response.data;
        console.log('[ReferralTracker] Install registration finished:', result);

        // Mark install as registered so subsequent app launches skip validation
        await AsyncStorage.setItem('isInstallRegistered', 'true');

        // Clean up temporary AsyncStorage attribution values
        if (Platform.OS === 'android') {
          await AsyncStorage.removeItem('simulated_referrer');
        }
        await AsyncStorage.removeItem('creatorReferralCode');

      } catch (error) {
        console.error('[ReferralTracker] Error tracking first open install:', error);
      }
    };

    trackFirstOpen();
  }, []);
};
