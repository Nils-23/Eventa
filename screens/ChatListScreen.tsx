import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MessageCircle, ChevronRight } from 'lucide-react-native';
import { ref } from 'firebase/database';
import { subscribeToRTDB } from '../utils/firebaseUtils';
import { realtimeDB } from '../services/firebase';
import { useAppStore } from '../hooks/useAppStore';
import { VenueChat } from '../components/VenueChat';

interface ActiveChat {
  venueId: string;
  venueName: string;
  lastInteractionTime: number;
}

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

export const ChatListScreen = () => {
  const [activeChats, setActiveChats] = useState<ActiveChat[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // State for the VenueChat Modal
  const [isChatVisible, setIsChatVisible] = useState(false);
  const [selectedVenue, setSelectedVenue] = useState<{ id: string; name: string } | null>(null);

  const user = useAppStore((s) => s.user);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!user) {
      setIsLoading(false);
      return;
    }

    const chatsRef = ref(realtimeDB, `user_chats/${user.uid}`);
    const unsubscribe = subscribeToRTDB(chatsRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        const now = Date.now();

        const parsedChats: ActiveChat[] = Object.keys(data)
          .map(key => ({
            venueId: key,
            venueName: data[key].venueName,
            lastInteractionTime: data[key].lastInteractionTime,
          }))
          // Keep only chats active within the last 24h
          .filter(chat => now - chat.lastInteractionTime < TWENTY_FOUR_HOURS)
          // Sort most recently interacted first
          .sort((a, b) => b.lastInteractionTime - a.lastInteractionTime);

        setActiveChats(parsedChats);
      } else {
        setActiveChats([]);
      }
      setIsLoading(false);
    }, (error) => {
      console.error("Error fetching chat list:", error);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  const openChat = (chat: ActiveChat) => {
    setSelectedVenue({ id: chat.venueId, name: chat.venueName });
    setIsChatVisible(true);
  };

  const formatTimeAgo = (timestamp: number) => {
    const minutes = Math.floor((Date.now() - timestamp) / 60000);
    if (minutes < 60) return `${minutes || 1}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  const renderChatItem = ({ item }: { item: ActiveChat }) => (
    <TouchableOpacity 
      style={styles.chatCard} 
      onPress={() => openChat(item)}
      activeOpacity={0.7}
    >
      <View style={styles.iconContainer}>
        <MessageCircle color="#FF00CC" size={24} />
      </View>
      <View style={styles.chatInfo}>
        <Text style={styles.venueName}>{item.venueName}</Text>
        <Text style={styles.timeText}>Active {formatTimeAgo(item.lastInteractionTime)}</Text>
      </View>
      <ChevronRight color="#444" size={20} />
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Live Chats</Text>
        <Text style={styles.subtitle}>Conversations expire after 24h</Text>
      </View>

      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator color="#00FFCC" size="large" />
        </View>
      ) : activeChats.length === 0 ? (
        <View style={styles.centerContainer}>
          <MessageCircle color="#333" size={64} />
          <Text style={styles.emptyTitle}>No Active Chats</Text>
          <Text style={styles.emptyText}>
            Join a venue's live chat to start talking to people nearby.
          </Text>
        </View>
      ) : (
        <FlatList
          data={activeChats}
          keyExtractor={(item) => item.venueId}
          renderItem={renderChatItem}
          contentContainerStyle={styles.listContent}
        />
      )}

      {selectedVenue && (
        <VenueChat
          isVisible={isChatVisible}
          onClose={() => setIsChatVisible(false)}
          venueId={selectedVenue.id}
          venueName={selectedVenue.name}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#00FFCC',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFF',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    lineHeight: 20,
  },
  listContent: {
    padding: 16,
  },
  chatCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(26,26,26,0.8)',
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,0,204,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  chatInfo: {
    flex: 1,
  },
  venueName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFF',
    marginBottom: 4,
  },
  timeText: {
    fontSize: 13,
    color: '#888',
  },
});
