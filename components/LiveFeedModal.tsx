import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ref, query, limitToLast, onValue } from 'firebase/database';
import { realtimeDB } from '../services/firebase';
import { LiveVenue } from '../contexts/LiveVenuesContext';
import { StoryData } from '../services/storyService';
import { MessageSquare, Users, Camera, X, Radio, ChevronRight, TrendingUp } from 'lucide-react-native';

interface LiveFeedModalProps {
  isVisible: boolean;
  onClose: () => void;
  venues: LiveVenue[];
  stories: StoryData[];
  onOpenChat: (venueId: string, venueName: string) => void;
  onOpenStories: (venue: LiveVenue) => void;
  onFocusVenue: (venue: LiveVenue) => void;
}

interface FeedItem {
  id: string;
  type: 'chat' | 'crowd' | 'story';
  venueId: string;
  venueName: string;
  title: string;
  subtitle: string;
  timestamp: number;
  icon: 'chat' | 'crowd' | 'story';
  color: string;
  venueObj: LiveVenue;
}

export const LiveFeedModal: React.FC<LiveFeedModalProps> = ({
  isVisible,
  onClose,
  venues,
  stories,
  onOpenChat,
  onOpenStories,
  onFocusVenue,
}) => {
  const insets = useSafeAreaInsets();
  const pulseAnim = useRef(new Animated.Value(0.4)).current;
  const [latestMessages, setLatestMessages] = useState<Record<string, { username: string; message: string; timestamp: number }>>({});
  const [loadingChats, setLoadingChats] = useState(true);

  // Pulsing animation for the "LIVE" status dots
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.0,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.3,
          duration: 1200,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  // Fetch the single latest chat message for each live venue in real-time
  useEffect(() => {
    if (!isVisible || venues.length === 0) return;

    setLoadingChats(true);
    let activeListeners = 0;
    const unsubscribes: (() => void)[] = [];

    venues.forEach((venue) => {
      const chatRef = query(ref(realtimeDB, `venue_chats/${venue.id}`), limitToLast(1));
      activeListeners++;

      const unsub = onValue(chatRef, (snapshot) => {
        if (snapshot.exists()) {
          const val = snapshot.val();
          const keys = Object.keys(val);
          if (keys.length > 0) {
            const lastMsgKey = keys[0];
            const msg = val[lastMsgKey];
            setLatestMessages((prev) => ({
              ...prev,
              [venue.id]: {
                username: msg.username || 'Someone',
                message: msg.message || '',
                timestamp: msg.timestamp || Date.now(),
              },
            }));
          }
        }
        activeListeners--;
        if (activeListeners <= 0) {
          setLoadingChats(false);
        }
      }, () => {
        activeListeners--;
        if (activeListeners <= 0) {
          setLoadingChats(false);
        }
      });

      unsubscribes.push(unsub);
    });

    // Fallback if no active listeners complete or snapshot empty
    const timer = setTimeout(() => {
      setLoadingChats(false);
    }, 2000);

    return () => {
      clearTimeout(timer);
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [isVisible, venues]);

  // Aggregate feeds
  const feedItems = React.useMemo(() => {
    const items: FeedItem[] = [];
    const now = Date.now();
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

    // 1. Chat Activity Feed Items
    Object.entries(latestMessages).forEach(([venueId, msg]) => {
      const venue = venues.find((v) => v.id === venueId);
      if (!venue) return;

      // Only show chat activity if the message was sent in the last 24h
      if (now - msg.timestamp < TWENTY_FOUR_HOURS) {
        items.push({
          id: `chat_${venueId}_${msg.timestamp}`,
          type: 'chat',
          venueId: venueId,
          venueName: venue.name,
          title: `CHAT ACTIVITY AT ${venue.name.toUpperCase()}`,
          subtitle: `${msg.username}: "${msg.message}"`,
          timestamp: msg.timestamp,
          icon: 'chat',
          color: '#00FFCC', // Neon Teal
          venueObj: venue,
        });
      }
    });

    // 2. Crowd Density Feed Items
    venues.forEach((venue) => {
      if (venue.activityLevel === 'Crazy' || venue.activityLevel === 'High') {
        items.push({
          id: `crowd_${venue.id}`,
          type: 'crowd',
          venueId: venue.id,
          venueName: venue.name,
          title: `${venue.userCount} ${venue.userCount === 1 ? 'USER' : 'USERS'} ACTIVE AT ${venue.name.toUpperCase()}`,
          subtitle: `${venue.name} is currently ${venue.activityLevel.toLowerCase()}.`,
          timestamp: now, // Always brand as 'Live Now'
          icon: 'crowd',
          color: venue.activityColor || '#FF00CC', // Neon status color
          venueObj: venue,
        });
      }
    });

    // 3. New Stories Feed Items
    const storiesByVenue: Record<string, StoryData[]> = {};
    stories.forEach((story) => {
      if (!story.venue_id) return;
      if (!storiesByVenue[story.venue_id]) {
        storiesByVenue[story.venue_id] = [];
      }
      storiesByVenue[story.venue_id].push(story);
    });

    Object.entries(storiesByVenue).forEach(([venueId, venueStories]) => {
      const venue = venues.find((v) => v.id === venueId);
      if (!venue || venueStories.length === 0) return;

      // Find the latest story timestamp
      const sortedStories = [...venueStories].sort((a, b) => b.created_at - a.created_at);
      const latestStory = sortedStories[0];

      items.push({
        id: `story_${venueId}_${latestStory.created_at}`,
        type: 'story',
        venueId: venueId,
        venueName: venue.name,
        title: `NEW STORIES AT ${venue.name.toUpperCase()}`,
        subtitle: `Watch ${venueStories.length} active ${venueStories.length === 1 ? 'story' : 'stories'} from the vibe.`,
        timestamp: latestStory.created_at,
        icon: 'story',
        color: '#FF00CC', // Neon Pink
        venueObj: venue,
      });
    });

    // Sort:
    // 1. Interactions (chat, story) come before passive presence (crowd)
    // 2. Within interactions, sort by timestamp (newest first)
    // 3. Within crowd, sort by userCount (highest first)
    return items.sort((a, b) => {
      const isInteraction = (type: string) => type === 'chat' || type === 'story';
      const aIsInt = isInteraction(a.type);
      const bIsInt = isInteraction(b.type);

      if (aIsInt && !bIsInt) return -1;
      if (!aIsInt && bIsInt) return 1;

      if (aIsInt && bIsInt) {
        return b.timestamp - a.timestamp;
      }

      const aCount = a.venueObj.userCount || 0;
      const bCount = b.venueObj.userCount || 0;
      return bCount - aCount;
    });
  }, [latestMessages, venues, stories]);

  const formatTimeAgo = (timestamp: number, type: 'chat' | 'crowd' | 'story') => {
    if (type === 'crowd') return 'LIVE';

    const diffMs = Date.now() - timestamp;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return '1d ago';
  };

  const handleItemPress = (item: FeedItem) => {
    onClose();
    // Micro-delay to let the Live Feed modal slide out before transitioning
    setTimeout(() => {
      if (item.type === 'chat') {
        onOpenChat(item.venueId, item.venueName);
      } else if (item.type === 'story') {
        onOpenStories(item.venueObj);
      } else if (item.type === 'crowd') {
        onFocusVenue(item.venueObj);
      }
    }, 250);
  };

  const renderIcon = (type: 'chat' | 'crowd' | 'story', color: string) => {
    const size = 18;
    switch (type) {
      case 'chat':
        return <MessageSquare color={color} size={size} />;
      case 'crowd':
        return <Users color={color} size={size} />;
      case 'story':
        return <Camera color={color} size={size} />;
    }
  };

  return (
    <Modal
      visible={isVisible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
      statusBarTranslucent={true}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContainer, { paddingTop: insets.top, paddingBottom: insets.bottom || 20 }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.titleContainer}>
              <Animated.View style={[styles.liveIndicator, { opacity: pulseAnim }]} />
              <Radio color="#FF00CC" size={24} style={styles.headerIcon} />
              <Text style={styles.headerTitle}>Live Now Feed</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <X color="#FFF" size={22} />
            </TouchableOpacity>
          </View>

          {/* Activity Stream */}
          {loadingChats && feedItems.length === 0 ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator color="#FF00CC" size="large" />
              <Text style={styles.loadingText}>Fetching real-time updates...</Text>
            </View>
          ) : feedItems.length === 0 ? (
            <View style={styles.centerContainer}>
              <TrendingUp color="#666" size={48} style={{ marginBottom: 16 }} />
              <Text style={styles.emptyTitle}>The city is quiet right now</Text>
              <Text style={styles.emptySubtitle}>Be the first to post a story or start a chat to heat things up!</Text>
            </View>
          ) : (
            <FlatList
              data={feedItems}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.feedCard, { borderLeftColor: item.color }]}
                  onPress={() => handleItemPress(item)}
                  activeOpacity={0.8}
                >
                  <View style={styles.cardHeader}>
                    <View style={[styles.iconCircle, { backgroundColor: item.color + '1A', borderColor: item.color + '33' }]}>
                      {renderIcon(item.type, item.color)}
                    </View>
                    <View style={styles.cardTitles}>
                      <Text style={[styles.cardTitle, { color: item.color }]} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={styles.cardSubtitle} numberOfLines={2}>
                        {item.subtitle}
                      </Text>
                    </View>
                    <View style={styles.metaColumn}>
                      {item.type === 'crowd' ? (
                        <View style={styles.liveTag}>
                          <Animated.View style={[styles.pulseDot, { opacity: pulseAnim }]} />
                          <Text style={styles.liveTagText}>LIVE</Text>
                        </View>
                      ) : (
                        <Text style={styles.timeText}>
                          {formatTimeAgo(item.timestamp, item.type)}
                        </Text>
                      )}
                      <ChevronRight color="#444" size={16} />
                    </View>
                  </View>
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(10, 5, 20, 0.96)', // Deep purple-black blur backplate
  },
  modalContainer: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#251535',
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  liveIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FF00CC',
    marginRight: 8,
  },
  headerIcon: {
    marginRight: 8,
    shadowColor: '#FF00CC',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
  },
  headerTitle: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  closeButton: {
    padding: 8,
    backgroundColor: '#2A2A2A',
    borderRadius: 20,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  loadingText: {
    color: '#888',
    marginTop: 12,
    fontSize: 14,
  },
  emptyTitle: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
  },
  feedCard: {
    backgroundColor: '#161122', // Deep premium violet card
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2A1A3A',
    borderLeftWidth: 4,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  cardTitles: {
    flex: 1,
    marginRight: 8,
  },
  cardTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  cardSubtitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 18,
  },
  metaColumn: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  timeText: {
    color: '#666',
    fontSize: 11,
    fontWeight: '600',
    alignSelf: 'center',
  },
  liveTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 0, 85, 0.15)',
    borderColor: 'rgba(255, 0, 85, 0.3)',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: 'center',
  },
  pulseDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#FF0055',
    marginRight: 4,
  },
  liveTagText: {
    color: '#FF0055',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
