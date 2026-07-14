import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Image, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Plus } from 'lucide-react-native';
import { LiveVenue } from '../contexts/LiveVenuesContext';
import { StoryData } from '../services/storyService';

interface StoriesTrayProps {
  venues: LiveVenue[];
  stories: StoryData[];
  canAddStory: boolean;
  onAddStory: () => void;
  onOpenVenueStories: (venue: LiveVenue) => void;
}

export const StoriesTray: React.FC<StoriesTrayProps> = ({
  venues,
  stories,
  canAddStory,
  onAddStory,
  onOpenVenueStories,
}) => {
  const insets = useSafeAreaInsets();

  // Venues that currently have active stories, busiest first. This is the whole point of the
  // tray: a one-tap, always-visible way into stories now that pins are hidden.
  const storyVenues = useMemo(() => {
    const withStories = new Set(stories.map((s) => s.venue_id).filter(Boolean));
    return venues
      .filter((v) => withStories.has(v.id))
      .sort((a, b) => b.userCount - a.userCount);
  }, [venues, stories]);

  return (
    <View style={[styles.container, { top: insets.top + 10 }]} pointerEvents="box-none">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {/* Add-your-story bubble (absorbs the old Add Story button). */}
        <TouchableOpacity style={styles.item} activeOpacity={0.8} onPress={onAddStory}>
          <View style={[styles.ring, styles.addRing, !canAddStory && styles.addRingDisabled]}>
            <View style={styles.addInner}>
              <Plus color={canAddStory ? '#00FFCC' : '#777'} size={24} />
            </View>
          </View>
          <Text style={styles.label} numberOfLines={1}>
            Your Story
          </Text>
        </TouchableOpacity>

        {storyVenues.map((v) => (
          <TouchableOpacity
            key={v.id}
            style={styles.item}
            activeOpacity={0.8}
            onPress={() => onOpenVenueStories(v)}
          >
            <View style={[styles.ring, styles.storyRing]}>
              {v.imageUrl ? (
                <Image source={{ uri: v.imageUrl }} style={styles.thumb} />
              ) : (
                <View style={[styles.thumb, styles.thumbFallback]}>
                  <Text style={styles.thumbFallbackText}>{v.name?.charAt(0)?.toUpperCase() ?? '?'}</Text>
                </View>
              )}
            </View>
            <Text style={styles.label} numberOfLines={1}>
              {v.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 10,
  },
  content: {
    // flexGrow + center keeps the bubbles centered as a group while they fit the screen
    // (so a lone "Your Story" sits dead-center and slides left as venues are added), then
    // scrolls normally once the row overflows — with nothing clipped at the edges.
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 14,
    gap: 14,
    alignItems: 'center',
  },
  item: {
    alignItems: 'center',
    width: 66,
  },
  ring: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    // Lift the bubbles off the map for legibility.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 4,
  },
  storyRing: {
    borderColor: '#FF00CC',
  },
  addRing: {
    borderColor: '#00FFCC',
  },
  addRingDisabled: {
    borderColor: '#555',
  },
  addInner: {
    width: 53,
    height: 53,
    borderRadius: 27,
    backgroundColor: 'rgba(10, 10, 10, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: {
    width: 53,
    height: 53,
    borderRadius: 27,
    backgroundColor: '#222',
  },
  thumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbFallbackText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  label: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 5,
    maxWidth: 66,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});
