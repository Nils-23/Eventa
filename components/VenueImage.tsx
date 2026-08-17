import React, { useState } from 'react';
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

export const VenueImage: React.FC<VenueImageProps> = ({
  venue,
  style,
  imageStyle,
  isThumbnail = false,
  isBanner = false,
  isHero = false,
}) => {
  const [error, setError] = useState(false);
  // Drives the fade so a photo arriving late eases in over the placeholder
  // instead of popping. Starts opaque-zero on every new source.
  const fadeAnim = React.useRef(new Animated.Value(0)).current;

  // Fallback if imageUrl is empty or failed to load. LiveVenuesContext already
  // resolves a varied fallback for anything it feeds us; this covers the runtime
  // case (a URL that 404s or times out mid-session) and callers that pass a raw
  // venue. Seeding on the venue id keeps a run of failures from collapsing into
  // the same photo repeated down the feed.
  const rawUri =
    error || !venue.imageUrl
      ? venue.type === 'Event' && venue.id
        ? getEventFallbackImage(venue.id, venue.category)
        : getFallbackImageByType(venue.type, venue.id)
      : venue.imageUrl;

  const variant = isThumbnail ? 'thumbnail' : isHero ? 'hero' : isBanner ? 'banner' : 'default';
  const uri = resizeImageUrl(rawUri, TARGET_WIDTHS[variant]);

  // Only worth a second request where the full image is genuinely heavy, and
  // only when the URL actually supports server-side sizing — if resizeImageUrl
  // left it untouched (an unrecognised host) the "preview" would be the very
  // same full-size file, so requesting it would double the cost for nothing.
  const previewUri = resizeImageUrl(rawUri, PREVIEW_WIDTH);
  const usePreview = variant !== 'thumbnail' && previewUri !== rawUri;

  // Painted on the first frame, before a single byte is fetched, and left in
  // place underneath the photo. This is what makes a card never blank: the
  // fallback images are themselves remote Unsplash URLs, so they are no faster
  // than the real photo and cannot serve as the instant state. The spinner this
  // replaces was actively counterproductive — a spinner reads as "slow", while a
  // filled block reads as "loaded, detail arriving".
  const placeholderColor = getPlaceholderColor(venue.id || venue.type || rawUri);

  // Where the fade lands. Each variant dims differently to stay legible against
  // the map, but a caller can override it (the stories tray wants full strength
  // inside its ring) — and since opacity is animated here, that override has to
  // become the fade's end value or it would be silently discarded.
  const callerOpacity = (imageStyle as { opacity?: number } | undefined)?.opacity;
  const restingOpacity =
    typeof callerOpacity === 'number'
      ? callerOpacity
      : isHero ? 1 : isThumbnail ? 0.85 : 0.75;

  // Reset fade and error state when the source image URL changes
  React.useEffect(() => {
    setError(false);
    fadeAnim.setValue(0);
  }, [venue.imageUrl, fadeAnim]);

  const handleLoad = () => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
  };

  return (
    <View style={[styles.container, isThumbnail && styles.thumbnailContainer, style]}>
      {/* Instant, local, always present. Everything composites on top of it. */}
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: placeholderColor }]} />

      {/* ~1.3KB stand-in that arrives long before the full photo. Deliberately
          not animated: it should appear the moment it lands, not ease in. */}
      {usePreview && (
        <Image
          source={{ uri: previewUri }}
          // Absolutely positioned: the full-size image below stays in normal
          // flow and is what gives the container its height, so a second
          // in-flow child would stack under it instead of behind it.
          style={[StyleSheet.absoluteFillObject, imageStyle, { opacity: restingOpacity }]}
          resizeMode="cover"
          blurRadius={PREVIEW_BLUR}
        />
      )}

      <Animated.Image
        source={{ uri }}
        style={[
          styles.image,
          isThumbnail && styles.thumbnailImage,
          imageStyle,
          // Must come last: this is the animated form of whatever opacity the
          // variant or the caller asked for, and it has to win over the static
          // value in imageStyle rather than be overwritten by it.
          {
            opacity: fadeAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0, restingOpacity],
            }),
          },
        ]}
        resizeMode="cover"
        onLoad={handleLoad}
        onError={() => setError(true)}
      />

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
