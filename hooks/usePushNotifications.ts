import { useState, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { doc, setDoc } from 'firebase/firestore';
import { firestore } from '../services/firebase';
import { useAppStore } from './useAppStore';
import { useLiveVenues } from './useLiveVenues';
import { useNavigation } from '@react-navigation/native';
import Constants from 'expo-constants';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export function usePushNotifications() {
  const [expoPushToken, setExpoPushToken] = useState<string>('');
  const { user, setSelectedMapVenue } = useAppStore();
  const navigation = useNavigation<any>();
  const { venues } = useLiveVenues();
  const venuesRef = useRef(venues);

  useEffect(() => {
    venuesRef.current = venues;
  }, [venues]);

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
      console.log('Notification tapped:', response);
      const data = response.notification.request.content.data;
      if (data?.venueId) {
        const venue = venuesRef.current.find(v => v.id === data.venueId);
        if (venue) {
          setSelectedMapVenue(venue);
          navigation.navigate('Main', { screen: 'Map' });
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, [user?.uid, navigation, setSelectedMapVenue]);

  const saveTokenToFirestore = async (userId: string, token: string) => {
    try {
      const userRef = doc(firestore, 'users', userId);
      await setDoc(userRef, { expoPushToken: token }, { merge: true });
    } catch (error) {
      console.warn('Error saving push token:', error);
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
      Constants?.expoConfig?.extra?.eas?.projectId ??
      Constants?.easConfig?.projectId ??
      '97c28f7f-bc55-49da-a7d8-7bcccc4fa3e2';
      
    token = (
      await Notifications.getExpoPushTokenAsync({ projectId })
    ).data;

  } catch (error: any) {
    // On free Apple Developer accounts, aps-environment entitlement is not available.
    // Push notifications will be unavailable but the app functions normally.
    if (error?.message?.includes('aps-environment')) {
      console.log('Push notifications unavailable: requires a paid Apple Developer account.');
    } else {
      console.warn('Error fetching Expo Push Token:', error);
    }
  }

  return token;
}
