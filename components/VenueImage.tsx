import React, { useState } from 'react';
import { StyleSheet, View, Image, ActivityIndicator, ViewStyle, ImageStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { getEventFallbackImage, getFallbackImageByType } from '../utils/venueImageUtils';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Fallback if imageUrl is empty or failed to load. LiveVenuesContext already
  // resolves a varied fallback for anything it feeds us; this covers the runtime
  // case (a URL that 404s or times out mid-session) and callers that pass a raw
  // venue. Seeding on the venue id keeps a run of failures from collapsing into
  // the same photo repeated down the feed.
  const uri =
    error || !venue.imageUrl
      ? venue.type === 'Event' && venue.id
        ? getEventFallbackImage(venue.id, venue.category)
        : getFallbackImageByType(venue.type, venue.id)
      : venue.imageUrl;

  // Reset loading and error states when the source image URL changes
  React.useEffect(() => {
    setLoading(true);
    setError(false);
  }, [venue.imageUrl]);

  return (
    <View style={[styles.container, isThumbnail && styles.thumbnailContainer, style]}>
      <Image
        source={{ uri }}
        style={[
          styles.image,
          isThumbnail && styles.thumbnailImage,
          { opacity: isHero ? 1 : isThumbnail ? 0.85 : 0.75 },
          imageStyle
        ]}
        resizeMode="cover"
        onLoad={() => setLoading(false)}
        onError={() => {
          setError(true);
          setLoading(false);
        }}
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

      {/* Loading state indicator */}
      {loading && (
        <View style={StyleSheet.absoluteFillObject}>
          <ActivityIndicator size="small" color="#00FFCC" style={styles.loader} />
        </View>
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
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
