import { useEffect } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../services/firebase';

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
          // Google Play Install Referrer simulation fallback
          // 1. Check for simulated referrer (from Admin Dashboard Simulation Suite)
          // 2. Check for deep link referral code fallback
          const simulatedReferrer = await AsyncStorage.getItem('simulated_referrer');
          const deepLinkReferrer = await AsyncStorage.getItem('referredBy');
          referralCode = simulatedReferrer || deepLinkReferrer || null;

          if (simulatedReferrer) {
            console.log('[ReferralTracker] Using simulated Android referrer:', simulatedReferrer);
          }
        } else {
          // On iOS, first-open attribution relies on server-side IP + User-Agent match.
          // However, if the user opened the app directly via deep link, we pass it.
          const deepLinkReferrer = await AsyncStorage.getItem('referredBy');
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
        await AsyncStorage.removeItem('referredBy');

      } catch (error) {
        console.error('[ReferralTracker] Error tracking first open install:', error);
      }
    };

    trackFirstOpen();
  }, []);
};
