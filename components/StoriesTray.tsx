import React, { useMemo } from 'react';
import { View, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Plus } from 'lucide-react-native';
import { LiveVenue } from '../contexts/LiveVenuesContext';
import { StoryData } from '../services/storyService';
import { VenueImage } from './VenueImage';
import { useAppStore } from '../hooks/useAppStore';

// Normalize a story's created_at (Firestore Timestamp | number | string) to epoch ms.
const toMs = (ts: any): number => {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  if (typeof ts === 'string') {
    const d = Date.parse(ts);
    return isNaN(d) ? 0 : d;
  }
  return 0;
};

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
  const viewedStories = useAppStore((s) => s.viewedStories);

  // Venues that currently have active stories (busiest first) plus each venue's newest story
  // timestamp — used to tell whether the user has already seen that venue's latest story.
  const { storyVenues, latestTsByVenue } = useMemo(() => {
    const latestTs: Record<string, number> = {};
    for (const s of stories) {
      if (!s.venue_id) continue;
      const ms = toMs(s.created_at);
      if (ms > (latestTs[s.venue_id] || 0)) latestTs[s.venue_id] = ms;
    }
    const withStories = venues
      .filter((v) => latestTs[v.id] !== undefined)
      .sort((a, b) => b.userCount - a.userCount);
    return { storyVenues: withStories, latestTsByVenue: latestTs };
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
        </TouchableOpacity>

        {storyVenues.map((v) => {
          // Viewed = user opened this venue's stories after its newest story was posted.
          const viewed = viewedStories[v.id] !== undefined && viewedStories[v.id] >= (latestTsByVenue[v.id] || 0);
          return (
          <TouchableOpacity
            key={v.id}
            style={styles.item}
            activeOpacity={0.8}
            onPress={() => onOpenVenueStories(v)}
          >
            <View style={[styles.ring, viewed ? styles.viewedRing : styles.storyRing]}>
              {/* VenueImage guarantees a picture: it falls back to a type-based image both
                  when imageUrl is missing AND when the URL fails to load — so a story bubble
                  never renders blank (this is what the raw <Image> got wrong). */}
              <VenueImage
                venue={{ imageUrl: v.imageUrl, type: v.type }}
                style={styles.thumb}
                imageStyle={{ opacity: 1 }}
                isThumbnail
              />
            </View>
          </TouchableOpacity>
          );
        })}
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
  viewedRing: {
    // Already-seen: drop the vivid pink for a muted grey, like Instagram's viewed state.
    borderColor: '#555',
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
});
