import { Query, onValue, Unsubscribe } from 'firebase/database';

/**
 * Safely subscribes to a Firebase Realtime Database reference/query.
 * Automatically retries the subscription with exponential backoff if it fails
 * (e.g. Permission Denied) which commonly occurs during startup before auth state is fully synced.
 */
export function subscribeToRTDB(
  queryRef: Query,
  callback: (snapshot: any) => void,
  errorCallback?: (error: any) => void,
  maxRetries = 5,
  delayMs = 300
): () => void {
  let unsubscribe: Unsubscribe | null = null;
  let isCancelled = false;
  let retryCount = 0;
  let timer: NodeJS.Timeout | null = null;

  const startListener = () => {
    if (isCancelled) return;

    unsubscribe = onValue(
      queryRef,
      (snapshot) => {
        retryCount = 0; // Reset on success
        callback(snapshot);
      },
      (error) => {
        console.warn(`[RTDB-Subscribe] Error: ${error.message}`);
        
        if (unsubscribe) {
          unsubscribe();
        }

        if (isCancelled) return;

        if (retryCount < maxRetries) {
          retryCount++;
          const backoff = delayMs * Math.pow(1.5, retryCount - 1);
          console.log(`[RTDB-Subscribe] Retrying in ${backoff}ms (Attempt ${retryCount}/${maxRetries})...`);
          timer = setTimeout(startListener, backoff);
        } else {
          console.error(`[RTDB-Subscribe] Max retries reached.`);
          if (errorCallback) {
            errorCallback(error);
          }
        }
      }
    );
  };

  startListener();

  return () => {
    isCancelled = true;
    if (unsubscribe) {
      unsubscribe();
    }
    if (timer) {
      clearTimeout(timer);
    }
  };
}
