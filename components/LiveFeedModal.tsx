import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ref, query, limitToLast, onValue } from 'firebase/database';
import { realtimeDB } from '../services/firebase';
import { LiveVenue } from '../contexts/LiveVenuesContext';
import { StoryData } from '../services/storyService';
import { MessageSquare, X, ChevronRight } from 'lucide-react-native';

interface LiveFeedModalProps {
  isVisible: boolean;
  onClose: () => void;
  venues: LiveVenue[];
  stories?: StoryData[];
  onOpenChat: (venueId: string, venueName: string) => void;
  onOpenStories?: (venue: LiveVenue) => void;
  onFocusVenue?: (venue: LiveVenue) => void;
}

interface ChatFeedItem {
  id: string;
  venueId: string;
  venueName: string;
  latestMessage: string;
  latestUsername: string;
  timestamp: number;
  venueObj: LiveVenue;
}

export const LiveFeedModal: React.FC<LiveFeedModalProps> = ({
  isVisible,
  onClose,
  venues,
  onOpenChat,
}) => {
  const insets = useSafeAreaInsets();
  const [latestMessages, setLatestMessages] = useState<Record<string, { username: string; message: string; timestamp: number }>>({});
  const [loadingChats, setLoadingChats] = useState(true);

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

    // Fallback if no active listeners complete
    const timer = setTimeout(() => {
      setLoadingChats(false);
    }, 2000);

    return () => {
      clearTimeout(timer);
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [isVisible, venues]);

  // Filter and sort chat items in the last 24 hours
  const activeChats = React.useMemo(() => {
    const items: ChatFeedItem[] = [];
    const now = Date.now();
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

    Object.entries(latestMessages).forEach(([venueId, msg]) => {
      const venue = venues.find((v) => v.id === venueId);
      if (!venue) return;

      // Only show chat if the message was sent in the last 24h
      if (now - msg.timestamp < TWENTY_FOUR_HOURS) {
        items.push({
          id: venueId,
          venueId: venueId,
          venueName: venue.name,
          latestMessage: msg.message,
          latestUsername: msg.username,
          timestamp: msg.timestamp,
          venueObj: venue,
        });
      }
    });

    // Sort: newest messages first
    return items.sort((a, b) => b.timestamp - a.timestamp);
  }, [latestMessages, venues]);

  const formatTimeAgo = (timestamp: number) => {
    const diffMs = Date.now() - timestamp;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return '1d ago';
  };

  const handleItemPress = (item: ChatFeedItem) => {
    onClose();
    // Micro-delay to let the modal slide out before opening chat modal
    setTimeout(() => {
      onOpenChat(item.venueId, item.venueName);
    }, 250);
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
              <MessageSquare color="#00FFCC" size={24} style={styles.headerIcon} />
              <Text style={styles.headerTitle}>Active Chats</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <X color="#FFF" size={22} />
            </TouchableOpacity>
          </View>

          {/* Chat List */}
          {loadingChats && activeChats.length === 0 ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator color="#00FFCC" size="large" />
              <Text style={styles.loadingText}>Fetching active chats...</Text>
            </View>
          ) : activeChats.length === 0 ? (
            <View style={styles.centerContainer}>
              <MessageSquare color="#444" size={48} style={{ marginBottom: 16 }} />
              <Text style={styles.emptyTitle}>No Active Chats</Text>
              <Text style={styles.emptySubtitle}>No messages have been sent in the last 24 hours. Be the first to start a conversation!</Text>
            </View>
          ) : (
            <FlatList
              data={activeChats}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.feedCard}
                  onPress={() => handleItemPress(item)}
                  activeOpacity={0.8}
                >
                  <View style={styles.cardHeader}>
                    <View style={styles.iconCircle}>
                      <MessageSquare color="#00FFCC" size={18} />
                    </View>
                    <View style={styles.cardTitles}>
                      <Text style={styles.cardTitle} numberOfLines={1}>
                        {item.venueName}
                      </Text>
                      <Text style={styles.cardSubtitle} numberOfLines={2}>
                        {item.latestUsername}: "{item.latestMessage}"
                      </Text>
                    </View>
                    <View style={styles.metaColumn}>
                      <Text style={styles.timeText}>
                        {formatTimeAgo(item.timestamp)}
                      </Text>
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
    backgroundColor: 'rgba(10, 5, 20, 0.96)', // Deep premium purple-black backplate
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
    gap: 10,
  },
  headerIcon: {
    shadowColor: '#00FFCC',
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
    backgroundColor: '#161122',
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2A1A3A',
    borderLeftWidth: 4,
    borderLeftColor: '#00FFCC',
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
    borderColor: 'rgba(0, 255, 252, 0.2)',
    backgroundColor: 'rgba(0, 255, 252, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  cardTitles: {
    flex: 1,
    marginRight: 8,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 4,
  },
  cardSubtitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  metaColumn: {
    alignItems: 'center',
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
});
