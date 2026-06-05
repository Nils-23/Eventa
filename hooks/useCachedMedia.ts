import { useState, useEffect } from 'react';
import { getCachedMediaUri, getCachedMediaUriSync } from '../utils/mediaCache';

export const useCachedMedia = (url: string | undefined | null) => {
  const initialUri = getCachedMediaUriSync(url);
  const [cachedUri, setCachedUri] = useState<string | null>(initialUri);
  const [isLoading, setIsLoading] = useState(!initialUri);

  useEffect(() => {
    if (!url) {
      setCachedUri(null);
      setIsLoading(false);
      return;
    }

    const syncUri = getCachedMediaUriSync(url);
    if (syncUri) {
      setCachedUri(syncUri);
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);

    getCachedMediaUri(url)
      .then((uri) => {
        if (isMounted) {
          setCachedUri(uri);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        console.warn('[useCachedMedia] Hook error caching URL:', url, err);
        if (isMounted) {
          setCachedUri(url); // Fallback to remote URL
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [url]);

  return { cachedUri, isLoading };
};
