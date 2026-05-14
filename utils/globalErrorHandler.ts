/**
 * globalErrorHandler.ts
 *
 * Attaches global error interception to React Native's ErrorUtils.
 * Must be imported at the very top of index.ts before anything else.
 *
 * Catches:
 *   - Unhandled synchronous JavaScript errors (fatal & non-fatal)
 *   - Unhandled Promise rejections
 *
 * Instead of crashing the app or showing a RedBox, errors are:
 *   - Logged to the console (dev only)
 *   - Silently swallowed so the UI remains intact
 *   - Surfaced to the user via a Toast notification (non-intrusive)
 */

// We use a lazy import of Toast to avoid circular dependency issues at boot time
let _toastReady = false;

// Defer Toast availability until after the module graph has settled
setTimeout(() => {
  _toastReady = true;
}, 500);

function showErrorToast(message?: string) {
  if (!_toastReady) return;
  try {
    // Dynamic import to avoid issues at module load time
    const Toast = require('react-native-toast-message').default;
    Toast.show({
      type: 'error',
      text1: 'Something went wrong',
      text2: message || 'Please try again.',
      visibilityTime: 3000,
    });
  } catch {
    // Toast itself is unavailable — silently do nothing
  }
}

// ─── 1. Override React Native's global error handler ─────────────────────────
const defaultHandler = ErrorUtils.getGlobalHandler();

ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
  // Always log in dev for debugging
  if (__DEV__) {
    console.error(`[GlobalErrorHandler] ${isFatal ? 'FATAL' : 'Non-fatal'} error:`, error);
  }

  // Show user-friendly toast
  showErrorToast();

  // For non-fatal errors, we do NOT forward to the default handler
  // to prevent the app from crashing. For fatal errors in dev, we still
  // forward so the developer sees the RedBox.
  if (isFatal && __DEV__) {
    defaultHandler(error, isFatal);
  }
});

// ─── 2. Intercept unhandled Promise rejections ────────────────────────────────
// React Native bundles a polyfill for Promise that exposes this hook
const originalHandler = (global as any).onunhandledrejection;
(global as any).onunhandledrejection = (event: any) => {
  if (__DEV__) {
    console.warn('[GlobalErrorHandler] Unhandled Promise rejection:', event?.reason);
  }
  showErrorToast();
  // Don't call originalHandler — prevents crash/warning overlay
};

export {}; // Ensure this file is treated as a module
