import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, firestore } from './firebase';
import { User, GoogleAuthProvider, signInWithCredential, OAuthProvider, PhoneAuthProvider, ApplicationVerifier, AuthError, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Configure Google Sign in
// IMPORTANT: You will need to replace this with your actual Web Client ID from Firebase Console later
GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_FIREBASE_WEB_CLIENT_ID || 'dummy-web-client-id.apps.googleusercontent.com',
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
});

/**
 * Generates a random username based on a Vibe
 */
export const generateRandomUsername = (): string => {
  const prefixes = [
    'NightOwl', 'PartyAnimal', 'VibeCheck', 'Raver', 'ClubHopper', 
    'MidnightRider', 'NeonSoul', 'BassDrop', 'GrooveMaster', 'MoonlightViber',
    'StarGazer', 'RhythmJunkie', 'VibeChaser', 'BeatRider'
  ];
  const numbers = Math.floor(1000 + Math.random() * 9000);
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  return `${prefix}${numbers}`;
};

/**
 * Checks if user exists in Firestore, and if not, creates a new profile.
 */
export const checkAndCreateUser = async (user: User) => {
  try {
    const userRef = doc(firestore, 'users', user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      // First time login - create account
      const referredBy = await AsyncStorage.getItem('referredBy');
      const userData: any = {
        user_id: user.uid,
        username: generateRandomUsername(),
        created_at: serverTimestamp(),
        last_active: serverTimestamp(),
        points: 0,
        hasAttendedFirstVenue: false,
      };
      if (referredBy) {
        userData.referredBy = referredBy;
      }
      await setDoc(userRef, userData);
      if (referredBy) {
        await AsyncStorage.removeItem('referredBy');
      }
      console.log('New user created successfully!');
    } else {
      const data = userSnap.data();
      if (data?.suspended) {
        await auth.signOut();
        throw new Error('ACCOUNT_SUSPENDED');
      }
      // Existing user - update last_active
      await setDoc(userRef, {
        last_active: serverTimestamp(),
      }, { merge: true });
    }
  } catch (error: any) {
    if (error.message !== 'ACCOUNT_SUSPENDED') {
      console.error('Error in checkAndCreateUser:', error);
    }
    throw error;
  }
};

/**
 * Handles Google Login flow
 */
export const handleGoogleLogin = async () => {
  try {
    await GoogleSignin.hasPlayServices();
    const userInfo = await GoogleSignin.signIn();

    // User cancelled — idToken will be absent. Treat as a silent no-op.
    if (!userInfo.data?.idToken) {
      return null;
    }

    const credential = GoogleAuthProvider.credential(userInfo.data.idToken);
    const userCredential = await signInWithCredential(auth, credential);
    
    await checkAndCreateUser(userCredential.user);
    return userCredential.user;
  } catch (error: any) {
    // SIGN_IN_CANCELLED is thrown when the user dismisses the Google sheet.
    // Also guard against the statusCode-based cancellation from older SDK versions.
    const isCancellation =
      error?.code === 'SIGN_IN_CANCELLED' ||
      error?.code === statusCodes?.SIGN_IN_CANCELLED ||
      error?.message?.includes('cancelled') ||
      error?.message?.includes('canceled') ||
      error?.message?.includes('No ID token');

    if (isCancellation) {
      // Silently ignore — user just changed their mind
      return null;
    }

    if (error.message !== 'ACCOUNT_SUSPENDED') {
      console.warn('Google Sign-In Error:', error);
    }
    throw error;
  }
};


/**
 * Handles Apple Login flow
 */
export const handleAppleLogin = async () => {
  try {
    const nonce = Math.random().toString(36).substring(2, 15);
    const hashedNonce = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      nonce
    );

    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });

    if (!credential.identityToken) {
      throw new Error('No identity token provided by Apple');
    }

    const provider = new OAuthProvider('apple.com');
    const firebaseCredential = provider.credential({
      idToken: credential.identityToken,
      rawNonce: nonce,
    });

    const userCredential = await signInWithCredential(auth, firebaseCredential);
    
    await checkAndCreateUser(userCredential.user);
    return userCredential.user;
  } catch (error: any) {
    if (error.code !== 'ERR_REQUEST_CANCELED') {
      if (error.message !== 'ACCOUNT_SUSPENDED') {
        console.error('Apple Sign-In Error:', error);
      }
      throw error;
    }
  }
};
/**
 * Handles generating OTP via Firebase and Recaptcha
 */
export const handlePhoneLoginStart = async (
  phoneNumber: string,
  verifier: ApplicationVerifier
): Promise<string> => {
  try {
    const phoneProvider = new PhoneAuthProvider(auth);
    const verificationId = await phoneProvider.verifyPhoneNumber(phoneNumber, verifier);
    return verificationId;
  } catch (error: any) {
    console.error('Phone Sign-In Start Error:', error);
    throw error;
  }
};

/**
 * Handles Confirming OTP for Phone Login
 */
export const handlePhoneOTPConfirm = async (
  verificationId: string,
  code: string
) => {
  try {
    const credential = PhoneAuthProvider.credential(verificationId, code);
    const userCredential = await signInWithCredential(auth, credential);
    await checkAndCreateUser(userCredential.user);
    return userCredential.user;
  } catch (error: any) {
    if (error.message !== 'ACCOUNT_SUSPENDED') {
      console.error('Phone OTP Confirm Error:', error);
    }
    throw error;
  }
};

/**
 * Handles the special bypass login for Apple review / testers.
 * Signs in using a dedicated email/password tester account.
 * Creates the user if it doesn't exist yet in Firebase.
 */
export const handleSpecialBypassLogin = async () => {
  const email = 'apple-tester@eventas.live';
  const password = 'AppleTester0990!';
  try {
    let userCredential;
    try {
      userCredential = await signInWithEmailAndPassword(auth, email, password);
    } catch (loginError: any) {
      // If user doesn't exist, create the account
      if (loginError.code === 'auth/user-not-found' || loginError.code === 'auth/invalid-credential') {
        try {
          userCredential = await createUserWithEmailAndPassword(auth, email, password);
        } catch (createError: any) {
          if (createError.code === 'auth/email-already-in-use') {
            // Already exists, throw the original login error (likely wrong password)
            throw loginError;
          }
          throw createError;
        }
      } else {
        throw loginError;
      }
    }
    await checkAndCreateUser(userCredential.user);
    return userCredential.user;
  } catch (error: any) {
    console.error('Special Bypass Login Error:', error);
    throw error;
  }
};
