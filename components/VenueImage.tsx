import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Image, Animated, ViewStyle, ImageStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  getEventFallbackImage,
  getFallbackImageByType,
  getPlaceholderColor,
  resizeImageUrl,
} from '../utils/venueImageUtils';

// Source width to request per variant, in pixels. These are measured, not
// guessed: against live venue photos, Google Places returns roughly
//   144px → 8KB    400px → 48KB    600px → 95KB    800px → 277KB (avg)
// so the top of the range costs 3x the bytes of 600px for a difference that is
// invisible under a card's scrim. A story-tray bubble was pulling the 800px file
// for a 72pt circle — 97% of those bytes were never seen, which is the bulk of
// why thumbnails felt slow.
const TARGET_WIDTHS = { thumbnail: 216, banner: 400, hero: 600, default: 400 };

// A near-instant stand-in for the big variants: ~1.3KB, so it lands in one round
// trip even on a bad connection. Blurred and scaled up it reads as a soft
// impression of the real photo, which then fades in over it. Pointless for
// thumbnails — those are already only 8KB, so they just load directly.
const PREVIEW_WIDTH = 48;
const PREVIEW_BLUR = 6;

// ─── Recovery policy ─────────────────────────────────────────────────────────
// A mobile image request has a third outcome besides success and error: it can
// simply never come back. A socket stalls behind a lost connection, or the
// loader drops the request while scrolling, and neither onLoad nor onError ever
// fires — so a card that has no other way to give up sits on its placeholder for
// the rest of the session. That is the "stuck blurred" and "loaded earlier, gone
// now" state: nothing about the URL is wrong, the request just never finished.
//
// So every attempt is on a clock. A stalled attempt is retried once (stalls are
// usually per-socket, and the second try lands), then we move to the pooled
// fallback, then we stop and leave the colour block. The timeout is deliberately
// generous — some event posters are ~1MB from origins with no resizing, and
// swapping a real poster for a stock photo too eagerly is the worse failure.
const LOAD_TIMEOUT_MS = 10_000;
const ATTEMPTS_PER_SOURCE = 2;
const RETRY_DELAY_MS = 700;

// The overlay hides the photo until it has loaded, so its removal must not
// depend on an animation completing. The fade is the nicety; the timer is the
// guarantee.
const OVERLAY_FADE_MS = 180;
const OVERLAY_FADE_SAFETY_MS = 600;

interface VenueImageProps {
  venue: {
    id?: string;
    imageUrl?: string;
    type?: string;
    category?: string;
  };
  style?: ViewStyle;
  imageStyle?: ImageStyle;
  isThumbnail?: boolean; // For map markers and ranking list
  isBanner?: boolean; // For info overlay cards
  // For full-bleed Explore feed cards. The dimming + violet tint below exist to keep
  // thumbnails legible against the dark map; at card size they just read as muddy, so
  // hero mode shows the photo at full strength and earns text legibility from a
  // bottom scrim instead.
  isHero?: boolean;
}

// Every image uri that has successfully painted in this app session.
//
// FlatList windowing (Explore runs windowSize={5}) unmounts cards a couple of
// screens away and remounts them on the way back, which resets this component's
// "has it loaded" state — so a photo the user saw thirty seconds ago showed its
// placeholder again while the decoder caught up. It read as a reload even
// though the bytes were already in the platform's HTTP cache.
//
// Remembering the uri is enough to skip straight to the photo on remount. It
// costs a string per image (a few KB for a whole session) and no network,
// storage, or API calls of any kind — the platform image loader still owns the
// actual bytes and its own eviction.
const loadedOnce = new Set<string>();
// Only a guard against a pathological session; venue photo urls number in the
// low hundreds.
const LOADED_MEMORY_LIMIT = 1000;

const rememberLoaded = (uri: string) => {
  if (loadedOnce.size >= LOADED_MEMORY_LIMIT) loadedOnce.clear();
  loadedOnce.add(uri);
};

type Source = {
  raw: string;
  // True once we have fallen through to the pooled stand-in, so a second failure
  // ends the chain instead of looping between the two.
  isFallback: boolean;
  attempt: number;
};

export const VenueImage: React.FC<VenueImageProps> = ({
  venue,
  style,
  imageStyle,
  isThumbnail = false,
  isBanner = false,
  isHero = false,
}) => {
  const variant = isThumbnail ? 'thumbnail' : isHero ? 'hero' : isBanner ? 'banner' : 'default';

  // The stand-in for a venue with no usable photo. Deterministic per venue, so a
  // run of failures doesn't collapse into the same picture repeated down a feed.
  // LiveVenuesContext already assigns varied fallbacks for anything it feeds us;
  // this covers callers that pass a raw venue, and any URL that dies at runtime.
  const fallbackRaw =
    venue.type === 'Event' && venue.id
      ? getEventFallbackImage(venue.id, venue.category)
      : getFallbackImageByType(venue.type, venue.id);

  const primaryRaw = venue.imageUrl || null;

  // What this component will ask for on its very first frame. Computed up here
  // so the state initialisers below can ask whether it has already been seen.
  const initialUri = resizeImageUrl(primaryRaw ?? fallbackRaw, TARGET_WIDTHS[variant]);
  const seenBefore = loadedOnce.has(initialUri);

  const [source, setSource] = useState<Source>({
    raw: primaryRaw ?? fallbackRaw,
    isFallback: !primaryRaw,
    attempt: 0,
  });
  // What the props said last time we (re)started the chain. Comparing during
  // render rather than in an effect is what keeps this correct: an effect that
  // resets "has it loaded" runs *after* the native loader may already have
  // reported success, so a cached image could report onLoad and then be marked
  // unloaded again — permanently invisible, since nothing reloads a decoded
  // image. Deriving it in render leaves no such window.
  const [propUri, setPropUri] = useState<string | null>(primaryRaw);
  // The exact uri that has actually painted. Plain committed state, never an
  // animated value: what the user sees must survive a native view being recycled
  // or an animation being dropped.
  const [loadedUri, setLoadedUri] = useState<string | null>(seenBefore ? initialUri : null);

  if (propUri !== primaryRaw) {
    setPropUri(primaryRaw);
    setSource({ raw: primaryRaw ?? fallbackRaw, isFallback: !primaryRaw, attempt: 0 });
    setLoadedUri(null);
  }

  const uri = resizeImageUrl(source.raw, TARGET_WIDTHS[variant]);

  // Only worth a second request where the full image is genuinely heavy, and
  // only when the URL actually supports server-side sizing — if resizeImageUrl
  // left it untouched (an unrecognised host) the "preview" would be the very
  // same full-size file, so requesting it would double the cost for nothing.
  const previewUri = resizeImageUrl(source.raw, PREVIEW_WIDTH);
  const usePreview = variant !== 'thumbnail' && previewUri !== source.raw;

  // The session registry counts as loaded: a remounted card should draw its
  // photo, not rewind to the placeholder it already came out of.
  const loaded = loadedUri === uri || loadedOnce.has(uri);

  // Painted on the first frame, before a single byte is fetched, and left in
  // place underneath the photo. This is what makes a card never blank: the
  // fallback images are themselves remote Unsplash URLs, so they are no faster
  // than the real photo and cannot serve as the instant state. The spinner this
  // replaces was actively counterproductive — a spinner reads as "slow", while a
  // filled block reads as "loaded, detail arriving".
  const placeholderColor = getPlaceholderColor(venue.id || venue.type || source.raw);

  // Where the photo rests. Each variant dims differently to stay legible against
  // the map, but a caller can override it (the stories tray wants full strength
  // inside its ring).
  const callerOpacity = (imageStyle as { opacity?: number } | undefined)?.opacity;
  const restingOpacity =
    typeof callerOpacity === 'number'
      ? callerOpacity
      : isHero ? 1 : isThumbnail ? 0.85 : 0.75;

  // Advance the recovery chain: retry, then fall back, then stop. Returning the
  // same object on the last step is load-bearing — it leaves state untouched, so
  // the watchdog effect below does not re-arm and we stop burning requests on a
  // venue that has nothing left to show.
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failCurrentSource = useCallback(() => {
    setSource((prev) => {
      if (prev.attempt + 1 < ATTEMPTS_PER_SOURCE) {
        return { ...prev, attempt: prev.attempt + 1 };
      }
      if (!prev.isFallback) {
        return { raw: fallbackRaw, isFallback: true, attempt: 0 };
      }
      return prev;
    });
  }, [fallbackRaw]);

  const handleError = useCallback(() => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    // A moment of air before retrying: an immediate re-request usually hits the
    // same dropped connection.
    retryTimer.current = setTimeout(failCurrentSource, RETRY_DELAY_MS);
  }, [failCurrentSource]);

  useEffect(() => () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
  }, []);

  // Watchdog for the silent case: an attempt that reports neither success nor
  // failure inside the window is treated as failed.
  useEffect(() => {
    if (loaded) return;
    const timer = setTimeout(failCurrentSource, LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [uri, source.attempt, loaded, failCurrentSource]);

  // The placeholder layer fades out once the photo is up. `overlayHidden` is the
  // committed state that actually removes it; the animation only makes that
  // removal pretty. If the animation is dropped — a recycled native view, a
  // backgrounded app — the timer still clears the overlay, so a photo can never
  // end up hidden behind a placeholder that forgot to leave.
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const [overlayHidden, setOverlayHidden] = useState(seenBefore);

  useEffect(() => {
    if (!loaded) {
      overlayOpacity.setValue(1);
      setOverlayHidden(false);
      return;
    }
    const safety = setTimeout(() => setOverlayHidden(true), OVERLAY_FADE_SAFETY_MS);
    Animated.timing(overlayOpacity, {
      toValue: 0,
      duration: OVERLAY_FADE_MS,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setOverlayHidden(true);
    });
    return () => clearTimeout(safety);
  }, [loaded, overlayOpacity]);

  return (
    <View style={[styles.container, isThumbnail && styles.thumbnailContainer, style]}>
      {/* Instant, local, always present. Everything composites on top of it, and
          it is what remains if every source in the chain fails. */}
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: placeholderColor }]} />

      {/* The photo. Its opacity is a plain style value, never animated: the one
          thing that must not depend on an animation running is whether the
          picture is visible at all.
          `key` forces a fresh native view per attempt, so a retry re-requests
          instead of reusing the view that just failed. */}
      <Image
        key={`${uri}#${source.attempt}`}
        source={{ uri }}
        style={[
          styles.image,
          isThumbnail && styles.thumbnailImage,
          imageStyle,
          { opacity: restingOpacity },
        ]}
        resizeMode="cover"
        onLoad={() => {
          rememberLoaded(uri);
          setLoadedUri(uri);
        }}
        onError={handleError}
      />

      {!overlayHidden && (
        <Animated.View
          style={[StyleSheet.absoluteFillObject, { opacity: overlayOpacity }]}
          pointerEvents="none"
        >
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: placeholderColor }]} />
          {/* ~1.3KB stand-in that arrives long before the full photo. Deliberately
              not animated in: it should appear the moment it lands. */}
          {usePreview && (
            <Image
              source={{ uri: previewUri }}
              style={[StyleSheet.absoluteFillObject, imageStyle, { opacity: restingOpacity }]}
              resizeMode="cover"
              blurRadius={PREVIEW_BLUR}
            />
          )}
        </Animated.View>
      )}

      {/* Cyberpunk Theme Duo-tone Overlay Tint */}
      {!isHero && <View style={[styles.colorTint, isThumbnail && styles.thumbnailTint]} />}

      {/* Bottom gradient fade for banner cards (blends image into card background) */}
      {isBanner && (
        <LinearGradient
          colors={['transparent', 'rgba(18, 18, 18, 0.4)', 'rgba(26, 26, 26, 0.95)']}
          style={StyleSheet.absoluteFillObject}
        />
      )}

      {/* Hero scrim: transparent over the top two-thirds so the photo carries the card,
          then a hard falloff that the title/meta line sits on. */}
      {isHero && (
        <LinearGradient
          colors={['rgba(0,0,0,0.35)', 'transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.92)']}
          locations={[0, 0.32, 0.68, 1]}
          style={StyleSheet.absoluteFillObject}
        />
      )}

    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    backgroundColor: '#1A1A1A',
    overflow: 'hidden',
  },
  thumbnailContainer: {
    backgroundColor: '#1A1A1A',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  colorTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(90, 0, 150, 0.12)', // Subtle neon violet/indigo tint overlay
    mixBlendMode: 'multiply' as any, // Try to apply blend if supported, or standard overlay tint
  },
  thumbnailTint: {
    backgroundColor: 'rgba(90, 0, 150, 0.08)',
  },
});
