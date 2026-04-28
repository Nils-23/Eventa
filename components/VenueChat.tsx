import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Keyboard
} from 'react-native';
import { X, Send } from 'lucide-react-native';
import { ref, onValue, push, set } from 'firebase/database';
import { realtimeDB } from '../services/firebase';
import { useAppStore } from '../hooks/useAppStore';
import { fetchUsername } from '../services/userService';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

interface Message {
  id: string;
  user_id: string;
  username: string;
  message: string;
  timestamp: number;
}

interface VenueChatProps {
  isVisible: boolean;
  onClose: () => void;
  venueId: string;
  venueName: string;
}

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

export const VenueChat: React.FC<VenueChatProps> = ({ isVisible, onClose, venueId, venueName }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const { user } = useAppStore();
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    if (!isVisible || !venueId) return;

    setIsLoading(true);
    const chatRef = ref(realtimeDB, `venue_chats/${venueId}`);
    
    const unsubscribe = onValue(chatRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        const now = Date.now();
        
        const parsedMessages: Message[] = Object.keys(data)
          .map(key => ({
            id: key,
            ...data[key]
          }))
          // Filter out messages older than 24 hours
          .filter(msg => now - msg.timestamp < TWENTY_FOUR_HOURS)
          // Sort by timestamp ascending
          .sort((a, b) => a.timestamp - b.timestamp);
          
        setMessages(parsedMessages);
      } else {
        setMessages([]);
      }
      setIsLoading(false);
    }, (error) => {
      console.error("Error fetching chat:", error);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [isVisible, venueId]);

  const handleSend = async () => {
    if (!inputText.trim() || !user || !venueId) return;

    setIsSending(true);
    Keyboard.dismiss();

    try {
      const username = await fetchUsername(user.uid);
      const chatRef = ref(realtimeDB, `venue_chats/${venueId}`);
      const newMessageRef = push(chatRef);
      
      await set(newMessageRef, {
        user_id: user.uid,
        username,
        message: inputText.trim(),
        timestamp: Date.now()
      });

      // Register the interaction in the user's active chats list
      const userChatRef = ref(realtimeDB, `user_chats/${user.uid}/${venueId}`);
      await set(userChatRef, {
        venueName: venueName,
        lastInteractionTime: Date.now()
      });

      setInputText('');
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    } catch (error) {
      console.error("Error sending message:", error);
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Could not send message. Try again.'
      });
    } finally {
      setIsSending(false);
    }
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isMe = item.user_id === user?.uid;
    return (
      <View style={[styles.messageContainer, isMe ? styles.myMessage : styles.otherMessage]}>
        {!isMe && <Text style={styles.username}>{item.username}</Text>}
        <View style={[styles.messageBubble, isMe ? styles.myBubble : styles.otherBubble]}>
          <Text style={styles.messageText}>{item.message}</Text>
          <Text style={[styles.timeText, isMe ? styles.myTimeText : styles.otherTimeText]}>
            {formatTime(item.timestamp)}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <Modal
      visible={isVisible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView 
        style={styles.modalOverlay} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.chatContainer, { paddingTop: insets.top, paddingBottom: insets.bottom || 20 }]}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.venueName}>{venueName}</Text>
              <Text style={styles.subtitle}>Live Chat (24h)</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <X color="#FFF" size={24} />
            </TouchableOpacity>
          </View>

          {/* Messages */}
          {isLoading ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator color="#00FFCC" size="large" />
            </View>
          ) : messages.length === 0 ? (
            <View style={styles.centerContainer}>
              <Text style={styles.emptyText}>No recent messages.</Text>
              <Text style={styles.emptySubText}>Be the first to say something!</Text>
            </View>
          ) : (
            <FlatList
              ref={flatListRef}
              data={messages}
              keyExtractor={item => item.id}
              renderItem={renderMessage}
              contentContainerStyle={styles.messagesList}
              onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
              onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
            />
          )}

          {/* Input Area */}
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.textInput}
              placeholder="Ask about the vibe..."
              placeholderTextColor="#888"
              value={inputText}
              onChangeText={setInputText}
              maxLength={200}
              multiline
            />
            <TouchableOpacity 
              style={[styles.sendButton, (!inputText.trim() || isSending) && styles.sendButtonDisabled]}
              onPress={handleSend}
              disabled={!inputText.trim() || isSending}
            >
              {isSending ? (
                <ActivityIndicator color="#000" size="small" />
              ) : (
                <Send color={inputText.trim() ? "#000" : "#888"} size={20} />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: '#121212',
  },
  chatContainer: {
    flex: 1,
    backgroundColor: '#121212',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  venueName: {
    color: '#00FFCC',
    fontSize: 20,
    fontWeight: 'bold',
  },
  subtitle: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  closeButton: {
    padding: 8,
    backgroundColor: '#333',
    borderRadius: 20,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  emptySubText: {
    color: '#888',
    fontSize: 14,
  },
  messagesList: {
    padding: 16,
    paddingBottom: 20,
  },
  messageContainer: {
    marginBottom: 16,
    maxWidth: '80%',
  },
  myMessage: {
    alignSelf: 'flex-end',
  },
  otherMessage: {
    alignSelf: 'flex-start',
  },
  username: {
    color: '#AAA',
    fontSize: 12,
    marginBottom: 4,
    marginLeft: 4,
  },
  messageBubble: {
    padding: 12,
    borderRadius: 20,
  },
  myBubble: {
    backgroundColor: '#FF00CC',
    borderBottomRightRadius: 4,
  },
  otherBubble: {
    backgroundColor: '#333',
    borderBottomLeftRadius: 4,
  },
  messageText: {
    color: '#FFF',
    fontSize: 15,
    lineHeight: 20,
  },
  timeText: {
    fontSize: 10,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  myTimeText: {
    color: 'rgba(255,255,255,0.7)',
  },
  otherTimeText: {
    color: '#888',
  },
  inputContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#333',
    alignItems: 'center',
    backgroundColor: '#1E1E1E',
  },
  textInput: {
    flex: 1,
    backgroundColor: '#333',
    color: '#FFF',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: 12,
    fontSize: 15,
    maxHeight: 100,
  },
  sendButton: {
    backgroundColor: '#00FFCC',
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  sendButtonDisabled: {
    backgroundColor: '#444',
  }
});
