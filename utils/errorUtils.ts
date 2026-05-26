/**
 * utils/errorUtils.ts
 *
 * Helper functions to map raw developer errors/codes into user-friendly messages.
 */

export const getFriendlyErrorMessage = (error: any): string => {
  if (!error) return 'An unexpected error occurred. Please try again.';

  const code = error.code || '';
  const message = error.message || '';

  // 1. Google Sign-In Error translation
  if (
    message.includes('NETWORK_ERROR') || 
    code === 'NETWORK_ERROR' || 
    message.includes('ApiException: 7') ||
    message.includes('network error')
  ) {
    return 'Network connection error. Please make sure your device is connected to the internet and try again.';
  }
  if (
    message.includes('DEVELOPER_ERROR') || 
    code === 'DEVELOPER_ERROR' || 
    message.includes('ApiException: 10')
  ) {
    return 'Configuration error. Please try again later or use another sign-in option.';
  }
  if (
    message.includes('PLAY_SERVICES_NOT_AVAILABLE') || 
    code === 'PLAY_SERVICES_NOT_AVAILABLE'
  ) {
    return 'Google Play Services are not available on this device.';
  }
  if (
    message.includes('INTERNAL_ERROR') || 
    code === 'INTERNAL_ERROR' || 
    message.includes('ApiException: 8')
  ) {
    return 'An internal Google Sign-In error occurred. Please try again.';
  }

  // 2. Firebase Auth Errors translation
  switch (code) {
    case 'auth/invalid-phone-number':
      return 'Invalid phone number format. Please enter a valid number with country code (e.g., +254...).';
    case 'auth/too-many-requests':
      return 'Too many login attempts. Please wait a few minutes and try again.';
    case 'auth/invalid-verification-code':
      return 'Invalid verification code. Please check your SMS and try again.';
    case 'auth/session-expired':
      return 'Verification session has expired. Please request a new OTP.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact support.';
    case 'auth/network-request-failed':
      return 'Network connection failed. Please check your internet connection and try again.';
    case 'auth/internal-error':
      return 'An internal service error occurred. Please try again later.';
    default:
      break;
  }

  // 3. General network connectivity errors
  if (
    message.includes('Network request failed') || 
    message.includes('network connection') ||
    message.includes('Failed to connect') ||
    message.includes('ConnectException')
  ) {
    return 'Failed to connect. Please check your internet connection and try again.';
  }

  // Fallback to error message, but sanitise if it contains stack trace patterns or specific codes
  if (message.includes('FirebaseError') || message.includes('com.google.android.gms')) {
    return 'A service connection issue occurred. Please check your connection and try again.';
  }

  return message || 'Something went wrong. Please try again.';
};
