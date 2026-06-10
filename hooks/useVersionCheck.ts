import { useState, useEffect } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { doc, getDoc } from 'firebase/firestore';
import { firestore } from '../services/firebase';

export interface VersionStatus {
  showPrompt: boolean;
  isForced: boolean;
  updateUrl: string;
  latestVersion: string;
}

export function useVersionCheck() {
  const [status, setStatus] = useState<VersionStatus>({
    showPrompt: false,
    isForced: false,
    updateUrl: '',
    latestVersion: '',
  });
  const [isLoading, setIsLoading] = useState(true);

  const isVersionOlder = (current: string, target: string): boolean => {
    const currentParts = current.split('.').map(Number);
    const targetParts = target.split('.').map(Number);

    for (let i = 0; i < Math.max(currentParts.length, targetParts.length); i++) {
      const currentPart = currentParts[i] || 0;
      const targetPart = targetParts[i] || 0;

      if (currentPart < targetPart) return true;
      if (currentPart > targetPart) return false;
    }
    return false;
  };

  useEffect(() => {
    const checkAppVersion = async () => {
      try {
        const configDocRef = doc(firestore, 'settings', 'app_config');
        const configSnap = await getDoc(configDocRef);

        if (configSnap.exists()) {
          const config = configSnap.data();
          const currentVersion = Constants.expoConfig?.version || '1.0.0';
          const latestVersion = config.latestVersion || '1.0.0';
          const minimumVersion = config.minimumVersion || '1.0.0';

          const androidUrl = config.androidUrl || '';
          const iosUrl = config.iosUrl || '';
          const updateUrl = Platform.OS === 'ios' ? iosUrl : androidUrl;

          if (isVersionOlder(currentVersion, minimumVersion)) {
            setStatus({
              showPrompt: true,
              isForced: true,
              updateUrl,
              latestVersion,
            });
          } else if (isVersionOlder(currentVersion, latestVersion)) {
            setStatus({
              showPrompt: true,
              isForced: false,
              updateUrl,
              latestVersion,
            });
          }
        }
      } catch (error) {
        console.warn('[useVersionCheck] Version check failed:', error);
      } finally {
        setIsLoading(false);
      }
    };

    checkAppVersion();
  }, []);

  return { ...status, isLoading };
}
