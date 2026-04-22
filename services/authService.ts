import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, firestore } from './firebase';
import { User, GoogleAuthProvider, signInWithCredential, OAuthProvider, PhoneAuthProvider, ApplicationVerifier, AuthError } from 'firebase/auth';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

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
  const prefixes = ['VibeHunter', 'EventGoer', 'PartyStarter', 'NightOwl', 'DayTripper'];
  const numbers = Math.floor(1000 + Math.random() * 9000);
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  return `${prefix}_${numbers}`;
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
      await setDoc(userRef, {
        user_id: user.uid,
        username: generateRandomUsername(),
        created_at: serverTimestamp(),
        last_active: serverTimestamp(),
      });
      console.log('New user created successfully!');
    } else {
      // Existing user - update last_active
      await setDoc(userRef, {
        last_active: serverTimestamp(),
      }, { merge: true });
    }
  } catch (error) {
    console.error('Error in checkAndCreateUser:', error);
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
    if (!userInfo.data?.idToken) {
      throw new Error('No ID token present!');
    }

    const credential = GoogleAuthProvider.credential(userInfo.data.idToken);
    const userCredential = await signInWithCredential(auth, credential);
    
    await checkAndCreateUser(userCredential.user);
    return userCredential.user;
  } catch (error: any) {
    console.error('Google Sign-In Error:', error);
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
      console.error('Apple Sign-In Error:', error);
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
    console.error('Phone OTP Confirm Error:', error);
    throw error;
  }
};
