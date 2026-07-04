import React, { useState } from 'react';
import { StyleSheet, View, Image, ActivityIndicator, ViewStyle, ImageStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { getFallbackImageByType } from '../utils/venueImageUtils';

interface VenueImageProps {
  venue: {
    imageUrl?: string;
    type?: string;
  };
  style?: ViewStyle;
  imageStyle?: ImageStyle;
  isThumbnail?: boolean; // For map markers and ranking list
  isBanner?: boolean; // For info overlay cards
}

export const VenueImage: React.FC<VenueImageProps> = ({
  venue,
  style,
  imageStyle,
  isThumbnail = false,
  isBanner = false,
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Fallback to type-based image if imageUrl is empty or failed to load
  const uri = error || !venue.imageUrl ? getFallbackImageByType(venue.type) : venue.imageUrl;

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
          { opacity: isThumbnail ? 0.85 : 0.75 },
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
      <View style={[styles.colorTint, isThumbnail && styles.thumbnailTint]} />

      {/* Bottom gradient fade for banner cards (blends image into card background) */}
      {isBanner && (
        <LinearGradient
          colors={['transparent', 'rgba(18, 18, 18, 0.4)', 'rgba(26, 26, 26, 0.95)']}
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
