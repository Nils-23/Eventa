import { useState, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { doc, setDoc } from 'firebase/firestore';
import { firestore } from '../services/firebase';
import { useAppStore } from './useAppStore';
import Constants from 'expo-constants';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export function usePushNotifications() {
  const [expoPushToken, setExpoPushToken] = useState<string>('');
  const { user } = useAppStore();

  useEffect(() => {
    registerForPushNotificationsAsync().then(token => {
      if (token) {
        setExpoPushToken(token);
        if (user?.uid) {
          saveTokenToFirestore(user.uid, token);
        }
      }
    });

    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      // Handle notification tap here if needed
      console.log('Notification tapped:', response);
    });

    return () => {
      subscription.remove();
    };
  }, [user?.uid]);

  const saveTokenToFirestore = async (userId: string, token: string) => {
    try {
      const userRef = doc(firestore, 'users', userId);
      await setDoc(userRef, { expoPushToken: token }, { merge: true });
    } catch (error) {
      console.error('Error saving push token:', error);
    }
  };

  return { expoPushToken };
}

async function registerForPushNotificationsAsync() {
  let token;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  if (!Device.isDevice) {
    console.log('Must use physical device for real Push Notifications. Using mock token for Simulator.');
    return 'ExponentPushToken[Simulator-Mock-Token]';
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  
  if (finalStatus !== 'granted') {
    console.warn('Failed to get push token for push notification!');
    return;
  }

  try {
    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
      
    token = (
      await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined
      )
    ).data;
  } catch (error) {
    console.error('Error fetching Expo Push Token:', error);
  }

  return token;
}
