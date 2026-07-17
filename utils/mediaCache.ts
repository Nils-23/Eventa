import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';

// In-memory cache mapping remote URLs to local cached filepaths synchronously
const memoryCache: Record<string, string> = {};

/**
 * Returns the cached filepath synchronously if it exists in memory.
 */
export const getCachedMediaUriSync = (url: string | undefined | null): string | null => {
  if (!url) return null;
  if (url.startsWith('file://') || url.startsWith('content://') || url.startsWith('assets/')) {
    return url;
  }
  return memoryCache[url] || null;
};

/**
 * Generates a unique SHA-256 hash for a given URL and appends the extension.
 * The "media2_" prefix versions the cache: the old scheme downloaded straight
 * to this path, so half-written files from interrupted downloads may exist
 * under "media_" — those must never be picked up again (black-screen videos).
 */
export const getCachedFilePath = async (url: string): Promise<string> => {
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    url
  );
  // Extract extension, cleaning up any query parameters
  let extension = url.split('.').pop()?.split('?')[0] || '';
  if (!extension || extension.length > 5) {
    extension = 'bin';
  }
  return `${FileSystem.cacheDirectory}media2_${hash}.${extension}`;
};

// One download per URL, shared by the viewer's direct fetch and the prefetch
// queue. Without this, both saw "not cached" and wrote to the SAME final path
// concurrently — interleaved writes produced permanently corrupt files.
const inFlight: Record<string, Promise<string> | undefined> = {};

// Downloads into a temp file and atomically moves it into place, so the final
// cache path only ever holds COMPLETE files. The old direct-to-path download
// meant an exists() check passed for half-written videos — the player got a
// truncated MP4 (no moov atom) and rendered a silent black screen.
const downloadToCache = async (url: string): Promise<string> => {
  const cachedUri = await getCachedFilePath(url);
  const fileInfo = await FileSystem.getInfoAsync(cachedUri);
  if (fileInfo.exists) {
    memoryCache[url] = cachedUri;
    return cachedUri;
  }

  const tmpUri = `${cachedUri}.tmp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const downloadResult = await FileSystem.downloadAsync(url, tmpUri);

  const finalInfo = await FileSystem.getInfoAsync(cachedUri);
  if (finalInfo.exists) {
    // Another racer finished first; keep theirs, drop ours.
    FileSystem.deleteAsync(downloadResult.uri, { idempotent: true }).catch(() => {});
  } else {
    await FileSystem.moveAsync({ from: downloadResult.uri, to: cachedUri });
  }
  memoryCache[url] = cachedUri;
  return cachedUri;
};

const getOrDownload = (url: string): Promise<string> => {
  const existing = inFlight[url];
  if (existing) return existing;
  const p = downloadToCache(url).finally(() => {
    delete inFlight[url];
  });
  inFlight[url] = p;
  return p;
};

/**
 * Returns a local uri for a given remote URL, caching it if not cached.
 */
export const getCachedMediaUri = async (url: string): Promise<string> => {
  if (!url) return '';
  if (url.startsWith('file://') || url.startsWith('content://') || url.startsWith('assets/')) {
    return url;
  }

  if (memoryCache[url]) {
    return memoryCache[url];
  }

  try {
    return await getOrDownload(url);
  } catch (error) {
    console.warn('[MediaCache] Failed to get cached URI:', url, error);
    return url; // Fallback to remote URL
  }
};

/**
 * Prefetch media from a remote URL in the background.
 */
export const prefetchMedia = async (url: string): Promise<void> => {
  if (!url || url.startsWith('file://') || url.startsWith('content://') || url.startsWith('assets/')) {
    return;
  }

  try {
    if (memoryCache[url]) {
      return;
    }
    await getOrDownload(url);
  } catch (error) {
    // Fail silently on prefetch
  }
};

// Bounded-concurrency prefetch queue. Unbounded parallel downloads (every
// active story at once, videos included) saturate the connection and starve
// the story the user actually tapped — the main "stories take long to load"
// complaint. Queue order is submission order, so callers should pass URLs
// most-likely-viewed first.
const MAX_CONCURRENT_PREFETCH = 3;
const pendingQueue: string[] = [];
const queuedUrls = new Set<string>();
let activeDownloads = 0;

const pumpPrefetchQueue = (): void => {
  while (activeDownloads < MAX_CONCURRENT_PREFETCH && pendingQueue.length > 0) {
    const url = pendingQueue.shift()!;
    activeDownloads++;
    prefetchMedia(url).finally(() => {
      queuedUrls.delete(url);
      activeDownloads--;
      pumpPrefetchQueue();
    });
  }
};

/**
 * Prefetches multiple media URLs in the background, a few at a time.
 */
export const prefetchStoriesMedia = (urls: string[]): void => {
  urls.forEach((url) => {
    if (url && !memoryCache[url] && !queuedUrls.has(url)) {
      queuedUrls.add(url);
      pendingQueue.push(url);
    }
  });
  pumpPrefetchQueue();
};
