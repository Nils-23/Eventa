import { initializeApp, getApps, getApp } from 'firebase/app';
// @ts-ignore
import { initializeAuth, getAuth, getReactNativePersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getDatabase } from 'firebase/database';
import { getStorage } from 'firebase/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  databaseURL: process.env.EXPO_PUBLIC_FIREBASE_DATABASE_URL,
};

// Capture whether Firebase has already been initialized BEFORE we call initializeApp.
const alreadyInitialized = getApps().length > 0;

// Initialize Firebase only if it hasn't been initialized already
const app = alreadyInitialized ? getApp() : initializeApp(firebaseConfig);

// Use AsyncStorage persistence so the user stays logged in across app restarts.
// initializeAuth must only be called once on the first initialization;
// subsequent module evaluations (e.g. Expo hot-reload) use getAuth() instead.
export const auth = alreadyInitialized
  ? getAuth(app)
  : initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });

export const firestore = getFirestore(app);
export const realtimeDB = getDatabase(app);
export const storage = getStorage(app);

export default app;
