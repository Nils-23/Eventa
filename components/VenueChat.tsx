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
  Keyboard,
  PanResponder,
  Animated,
  TouchableWithoutFeedback,
  Alert,
  Image
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { X, Send, CornerUpLeft, Trash2, Flag, Smile } from 'lucide-react-native';
import { ref, push, set, remove } from 'firebase/database';
import { subscribeToRTDB } from '../utils/firebaseUtils';
import { doc, getDoc, updateDoc, increment } from 'firebase/firestore';
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { realtimeDB, firestore, storage } from '../services/firebase';
import { useAppStore } from '../hooks/useAppStore';
import { fetchUsername, hideUser } from '../services/userService';
import { checkAndUnlockAchievements, ACHIEVEMENTS } from '../services/achievementService';
import { createReport } from '../services/reportService';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import * as Icons from 'lucide-react-native';
import { getFriendlyErrorMessage } from '../utils/errorUtils';

interface Message {
  id: string;
  user_id: string;
  username: string;
  message: string;
  timestamp: number;
  type?: 'text' | 'sticker' | 'custom_sticker';
  activeBadge?: string;
  reactions?: Record<string, Record<string, string>>; // emoji -> userId -> username
  replyTo?: {
    messageId: string;
    username: string;
    message: string;
  };
}

interface VenueChatProps {
  isVisible: boolean;
  onClose: () => void;
  venueId: string;
  venueName: string;
}

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

const CHAT_SUGGESTIONS = [
  "What's the vibe? 🔥",
  "Is it packed tonight? 🕺",
  "Who's already here? 👀",
  "How's the music? 🎵",
  "Drinks flowing? 🍻"
];

const REACTION_EMOJIS = ['❤️', '🔥', '😂', '👍', '😮', '🍻'];

interface SwipeableMessageProps {
  children: React.ReactNode;
  onSwipe: () => void;
  isMe: boolean;
}

const SwipeableMessage: React.FC<SwipeableMessageProps> = ({ children, onSwipe, isMe }) => {
  const translateX = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        // Track horizontal swipe to the right, ignore vertical scrolling
        return Math.abs(gestureState.dx) > 10 && Math.abs(gestureState.dy) < 8 && gestureState.dx > 0;
      },
      onPanResponderMove: (evt, gestureState) => {
        const newX = Math.max(0, Math.min(80, gestureState.dx));
        translateX.setValue(newX);
      },
      onPanResponderRelease: (evt, gestureState) => {
        if (gestureState.dx > 50) {
          onSwipe();
        }
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
          tension: 40,
          friction: 6,
        }).start();
      },
    })
  ).current;

  return (
    <View style={styles.swipeContainer}>
      <Animated.View style={[styles.replyIconContainer, {
        opacity: translateX.interpolate({
          inputRange: [0, 40],
          outputRange: [0, 1],
          extrapolate: 'clamp',
        }),
        transform: [
          {
            scale: translateX.interpolate({
              inputRange: [0, 40],
              outputRange: [0.6, 1.0],
              extrapolate: 'clamp',
            }),
          },
        ],
      }]}>
        <CornerUpLeft color="#00FFCC" size={16} />
      </Animated.View>
      <Animated.View
        {...panResponder.panHandlers}
        style={{ transform: [{ translateX }] }}
      >
        {children}
      </Animated.View>
    </View>
  );
};

const CURATED_STICKERS = [
  '🎉', '🔥', '🍻', '🍹', '💃', '🕺',
  '🎧', '👑', '✨', '💯', '👾', '🦄',
  '🍕', '🎈', '🤩', '🍾', '🌮', '🙌'
];

const FloatingSticker: React.FC<{ sticker: string }> = ({ sticker }) => {
  const floatAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, {
          toValue: -6,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(floatAnim, {
          toValue: 0,
          duration: 1200,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [floatAnim]);

  return (
    <Animated.View style={{ transform: [{ translateY: floatAnim }] }}>
      <Text style={styles.stickerText}>{sticker}</Text>
    </Animated.View>
  );
};

const FloatingCustomSticker: React.FC<{ uri: string }> = ({ uri }) => {
  const floatAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, {
          toValue: -6,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(floatAnim, {
          toValue: 0,
          duration: 1200,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [floatAnim]);

  return (
    <Animated.View style={{ transform: [{ translateY: floatAnim }] }}>
      <Image source={{ uri }} style={styles.customStickerImage} />
    </Animated.View>
  );
};

export const VenueChat: React.FC<VenueChatProps> = ({ isVisible, onClose, venueId, venueName }) => {
  const [shouldRender, setShouldRender] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMessageForReaction, setSelectedMessageForReaction] = useState<Message | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [activeBadge, setActiveBadge] = useState<string | null>(null);
  const [sendAsSimulated, setSendAsSimulated] = useState(false);
  const [isStickerPickerVisible, setIsStickerPickerVisible] = useState(false);
  const [isUploadingCustom, setIsUploadingCustom] = useState(false);
  
  const { user, hiddenUsers, setHiddenUsers, isAdmin, updateLastViewedChat } = useAppStore();
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    if (isVisible && venueId) {
      updateLastViewedChat(venueId);
    }
  }, [isVisible, venueId, messages.length, updateLastViewedChat]);



  useEffect(() => {
    if (isVisible) {
      const timer = setTimeout(() => {
        setShouldRender(true);
      }, 150);
      return () => clearTimeout(timer);
    } else {
      setShouldRender(false);
    }
  }, [isVisible]);

  useEffect(() => {
    if (isVisible && user?.uid && shouldRender) {
      const userDocRef = doc(firestore, 'users', user.uid);
      getDoc(userDocRef)
        .then((docSnap) => {
          if (docSnap.exists()) {
            setActiveBadge(docSnap.data().activeBadge || null);
          }
        })
        .catch((err) => {
          console.warn('[VenueChat] Failed to fetch active badge:', err);
        });
    }
  }, [isVisible, user?.uid, shouldRender]);

  useEffect(() => {
    const showSubscription = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => {
        setKeyboardVisible(true);
        setIsStickerPickerVisible(false);
      }
    );
    const hideSubscription = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardVisible(false)
    );

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!isVisible || !venueId || !shouldRender) return;

    setIsLoading(true);
    const chatRef = ref(realtimeDB, `venue_chats/${venueId}`);
    
    const unsubscribe = subscribeToRTDB(chatRef, (snapshot) => {
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
  }, [isVisible, venueId, shouldRender]);

  const handleSend = async () => {
    const textToSend = inputText.trim();
    if (!textToSend || !user || !venueId) return;

    // Clear input immediately to make chat feel extremely snappy and responsive
    setInputText('');
    const previousReplyTo = replyingTo;
    setReplyingTo(null);
    setIsSending(true);

    try {
      let senderId = user.uid;
      let senderName = '';
      let senderBadge: string | null = activeBadge;

      if (isAdmin && sendAsSimulated) {
        const randomNum = Math.floor(1000 + Math.random() * 9000);
        senderId = `sim_admin_${Date.now()}_${randomNum}`;
        senderName = await fetchUsername(senderId);
        senderBadge = null; // Simulated users don't get the admin's active badge
      } else {
        senderName = await fetchUsername(user.uid);
      }

      const chatRef = ref(realtimeDB, `venue_chats/${venueId}`);
      const newMessageRef = push(chatRef);
      
      await set(newMessageRef, {
        user_id: senderId,
        username: senderName,
        message: textToSend,
        type: 'text',
        timestamp: Date.now(),
        ...(senderBadge ? { activeBadge: senderBadge } : {}),
        ...(previousReplyTo ? {
          replyTo: {
            messageId: previousReplyTo.id,
            username: previousReplyTo.username,
            message: previousReplyTo.message
          }
        } : {})
      });
      
      // Update stats and check achievements in the background only for the actual admin account
      if (!sendAsSimulated) {
        const userDocRef = doc(firestore, 'users', user.uid);
        updateDoc(userDocRef, { chatMessageCount: increment(1) })
          .then(() => checkAndUnlockAchievements(user.uid))
          .catch((err) => console.warn('[VenueChat] Failed to update user message count/achievements:', err));
      }

      // Register the interaction in the user's active chats list (non-blocking)
      const userChatRef = ref(realtimeDB, `user_chats/${user.uid}/${venueId}`);
      set(userChatRef, {
        venueName: venueName,
        lastInteractionTime: Date.now()
      }).catch((err) => console.warn('[VenueChat] Failed to update user_chats:', err));

      // Register the user as an active member of this venue's chat (non-blocking)
      const venueMemberRef = ref(realtimeDB, `venue_members/${venueId}/${user.uid}`);
      set(venueMemberRef, {
        lastInteractionTime: Date.now()
      }).catch((err) => console.warn('[VenueChat] Failed to update venue_members:', err));

      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    } catch (error) {
      console.warn("Error sending message:", error);
      // Restore input text and replyingState if sending fails
      setInputText(textToSend);
      setReplyingTo(previousReplyTo);
      Toast.show({
        type: 'error',
        text1: 'Message Failed',
        text2: getFriendlyErrorMessage(error)
      });
    } finally {
      setIsSending(false);
    }
  };

  const sendSticker = async (sticker: string) => {
    if (!user || !venueId) return;

    setIsStickerPickerVisible(false);
    const previousReplyTo = replyingTo;
    setReplyingTo(null);

    try {
      let senderId = user.uid;
      let senderName = '';
      let senderBadge: string | null = activeBadge;

      if (isAdmin && sendAsSimulated) {
        const randomNum = Math.floor(1000 + Math.random() * 9000);
        senderId = `sim_admin_${Date.now()}_${randomNum}`;
        senderName = await fetchUsername(senderId);
        senderBadge = null;
      } else {
        senderName = await fetchUsername(user.uid);
      }

      const chatRef = ref(realtimeDB, `venue_chats/${venueId}`);
      const newMessageRef = push(chatRef);
      
      await set(newMessageRef, {
        user_id: senderId,
        username: senderName,
        message: sticker,
        type: 'sticker',
        timestamp: Date.now(),
        ...(senderBadge ? { activeBadge: senderBadge } : {}),
        ...(previousReplyTo ? {
          replyTo: {
            messageId: previousReplyTo.id,
            username: previousReplyTo.username,
            message: previousReplyTo.message
          }
        } : {})
      });
      
      if (!sendAsSimulated) {
        const userDocRef = doc(firestore, 'users', user.uid);
        updateDoc(userDocRef, { chatMessageCount: increment(1) })
          .then(() => checkAndUnlockAchievements(user.uid))
          .catch((err) => console.warn('[VenueChat] Failed to update user message count/achievements:', err));
      }

      const userChatRef = ref(realtimeDB, `user_chats/${user.uid}/${venueId}`);
      set(userChatRef, {
        venueName: venueName,
        lastInteractionTime: Date.now()
      }).catch((err) => console.warn('[VenueChat] Failed to update user_chats:', err));

      const venueMemberRef = ref(realtimeDB, `venue_members/${venueId}/${user.uid}`);
      set(venueMemberRef, {
        lastInteractionTime: Date.now()
      }).catch((err) => console.warn('[VenueChat] Failed to update venue_members:', err));

      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    } catch (error) {
      console.warn("Error sending sticker:", error);
      setReplyingTo(previousReplyTo);
      Toast.show({
        type: 'error',
        text1: 'Message Failed',
        text2: getFriendlyErrorMessage(error)
      });
    }
  };

  const sendCustomSticker = async (downloadUrl: string) => {
    if (!user || !venueId) return;

    setIsStickerPickerVisible(false);
    const previousReplyTo = replyingTo;
    setReplyingTo(null);

    try {
      let senderId = user.uid;
      let senderName = '';
      let senderBadge: string | null = activeBadge;

      if (isAdmin && sendAsSimulated) {
        const randomNum = Math.floor(1000 + Math.random() * 9000);
        senderId = `sim_admin_${Date.now()}_${randomNum}`;
        senderName = await fetchUsername(senderId);
        senderBadge = null;
      } else {
        senderName = await fetchUsername(user.uid);
      }

      const chatRef = ref(realtimeDB, `venue_chats/${venueId}`);
      const newMessageRef = push(chatRef);
      
      await set(newMessageRef, {
        user_id: senderId,
        username: senderName,
        message: downloadUrl,
        type: 'custom_sticker',
        timestamp: Date.now(),
        ...(senderBadge ? { activeBadge: senderBadge } : {}),
        ...(previousReplyTo ? {
          replyTo: {
            messageId: previousReplyTo.id,
            username: previousReplyTo.username,
            message: previousReplyTo.message
          }
        } : {})
      });
      
      if (!sendAsSimulated) {
        const userDocRef = doc(firestore, 'users', user.uid);
        updateDoc(userDocRef, { chatMessageCount: increment(1) })
          .then(() => checkAndUnlockAchievements(user.uid))
          .catch((err) => console.warn('[VenueChat] Failed to update user message count/achievements:', err));
      }

      const userChatRef = ref(realtimeDB, `user_chats/${user.uid}/${venueId}`);
      set(userChatRef, {
        venueName: venueName,
        lastInteractionTime: Date.now()
      }).catch((err) => console.warn('[VenueChat] Failed to update user_chats:', err));

      const venueMemberRef = ref(realtimeDB, `venue_members/${venueId}/${user.uid}`);
      set(venueMemberRef, {
        lastInteractionTime: Date.now()
      }).catch((err) => console.warn('[VenueChat] Failed to update venue_members:', err));

      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    } catch (error) {
      console.warn("Error sending custom sticker:", error);
      setReplyingTo(previousReplyTo);
      Toast.show({
        type: 'error',
        text1: 'Message Failed',
        text2: getFriendlyErrorMessage(error)
      });
    }
  };

  const handleCustomStickerUpload = async () => {
    if (!user || !venueId) return;

    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Toast.show({
          type: 'error',
          text1: 'Permission Denied',
          text2: 'Gallery access is required to upload custom stickers.'
        });
        return;
      }

      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      };

      const result = await ImagePicker.launchImageLibraryAsync(options);

      if (!result.canceled && result.assets.length > 0) {
        setIsUploadingCustom(true);
        const uri = result.assets[0].uri;

        // Upload to Firebase Storage
        const fileExtension = uri.split('.').pop() || 'jpg';
        const fileName = `chat_stickers/${user.uid}_${Date.now()}.${fileExtension}`;
        const stRef = storageRef(storage, fileName);

        const response = await fetch(uri);
        const blob = await response.blob();

        const uploadTask = await uploadBytesResumable(stRef, blob);
        const downloadUrl = await getDownloadURL(uploadTask.ref);

        // Send Custom Sticker
        await sendCustomSticker(downloadUrl);
      }
    } catch (error) {
      console.warn('Custom Sticker Upload Error:', error);
      Toast.show({
        type: 'error',
        text1: 'Upload Failed',
        text2: getFriendlyErrorMessage(error),
      });
    } finally {
      setIsUploadingCustom(false);
    }
  };

  const toggleReaction = async (messageId: string, emoji: string) => {
    if (!user || !venueId) return;
    try {
      const username = await fetchUsername(user.uid);
      const reactionRef = ref(realtimeDB, `venue_chats/${venueId}/${messageId}/reactions/${emoji}/${user.uid}`);
      
      const message = messages.find(m => m.id === messageId);
      const userReacted = message?.reactions?.[emoji]?.[user.uid];

      if (userReacted) {
        await set(reactionRef, null);
      } else {
        await set(reactionRef, username);
      }
    } catch (error) {
      console.warn("Failed to toggle reaction:", error);
    }
  };

  const handleDeleteMessage = (messageId: string) => {
    if (!user || !venueId) return;
    
    Alert.alert(
      "Delete Message",
      "Are you sure you want to delete this message permanently? This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Delete", 
          style: "destructive",
          onPress: async () => {
            try {
              const messageRef = ref(realtimeDB, `venue_chats/${venueId}/${messageId}`);
              await remove(messageRef);
              setSelectedMessageForReaction(null);
              Toast.show({
                type: 'success',
                text1: 'Deleted',
                text2: 'Message deleted successfully.'
              });
            } catch (error) {
              console.warn("Failed to delete message:", error);
              Toast.show({
                type: 'error',
                text1: 'Error',
                text2: 'Failed to delete message.'
              });
            }
          }
        }
      ]
    );
  };

  const handleHideUserPrompt = (targetUserId: string, username: string) => {
    setSelectedMessageForReaction(null);
    if (!user) return;

    Alert.alert(
      "Hide User",
      `Are you sure you want to hide ${username}? Content from this user will no longer be shown to you.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Hide User",
          style: "destructive",
          onPress: async () => {
            try {
              await hideUser(user.uid, targetUserId);
              setHiddenUsers([...hiddenUsers, targetUserId]);
              Toast.show({
                type: 'success',
                text1: 'User Hidden',
                text2: `You will no longer see content from ${username}.`
              });
            } catch (error) {
              console.warn("Failed to hide user:", error);
              Toast.show({
                type: 'error',
                text1: 'Error',
                text2: 'Failed to hide user.'
              });
            }
          }
        }
      ]
    );
  };

  const handleReportMessage = (msg: Message) => {
    if (!user || !venueId) return;

    Alert.alert(
      "Report Message",
      "Why are you reporting this message?",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Inappropriate Content", 
          onPress: () => submitMessageReport(msg, "Inappropriate Content")
        },
        { 
          text: "Harassment / Bullying", 
          onPress: () => submitMessageReport(msg, "Harassment or Bullying")
        },
        { 
          text: "Spam / Scams", 
          onPress: () => submitMessageReport(msg, "Spam or scams")
        },
        { 
          text: "Hate Speech", 
          onPress: () => submitMessageReport(msg, "Hate Speech")
        }
      ]
    );
  };

  const submitMessageReport = async (msg: Message, reason: string) => {
    if (!user) return;
    setSelectedMessageForReaction(null);
    try {
      await createReport(
        user.uid,
        msg.user_id,
        'chat',
        msg.id,
        msg.message,
        venueId,
        reason
      );
      Toast.show({
        type: 'success',
        text1: 'Report Submitted',
        text2: 'Thank you. We will review this message.'
      });
    } catch (error) {
      console.warn("Failed to submit message report:", error);
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Failed to submit report. Please try again.'
      });
    }
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const renderReplyHeader = (message: Message, isMe: boolean) => {
    if (!message.replyTo) return null;
    return (
      <View style={[styles.replyBubbleHeader, isMe ? styles.myReplyHeader : styles.otherReplyHeader]}>
        <CornerUpLeft size={10} color="#AAA" style={{ marginRight: 4 }} />
        <Text style={styles.replyHeaderUser} numberOfLines={1}>{message.replyTo.username}</Text>
        <Text style={styles.replyHeaderText} numberOfLines={1}>{message.replyTo.message}</Text>
      </View>
    );
  };

  const renderReactions = (message: Message, isMe: boolean) => {
    if (!message.reactions) return null;
    const entries = Object.entries(message.reactions);
    if (entries.length === 0) return null;

    return (
      <View style={[styles.reactionsRow, isMe ? { alignSelf: 'flex-end' } : { alignSelf: 'flex-start' }]}>
        {entries.map(([emoji, userMap]) => {
          const userIds = Object.keys(userMap);
          if (userIds.length === 0) return null;
          const hasReacted = user ? userIds.includes(user.uid) : false;
          
          return (
            <TouchableOpacity 
              key={emoji}
              style={[
                styles.reactionCapsule,
                hasReacted && styles.reactionCapsuleActive
              ]}
              onPress={() => toggleReaction(message.id, emoji)}
            >
              <Text style={styles.reactionEmoji}>{emoji}</Text>
              <Text style={[styles.reactionCount, hasReacted && styles.reactionCountActive]}>
                {userIds.length}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isMe = item.user_id === user?.uid;
    const badgeObj = item.activeBadge ? ACHIEVEMENTS.find(a => a.id === item.activeBadge) : null;
    // @ts-ignore dynamic icon
    const BadgeIcon = badgeObj ? Icons[badgeObj.iconName] : null;
    const isSticker = item.type === 'sticker';
    const isCustomSticker = item.type === 'custom_sticker';

    return (
      <SwipeableMessage
        key={item.id}
        onSwipe={() => setReplyingTo(item)}
        isMe={isMe}
      >
        <View style={[styles.messageContainer, isMe ? styles.myMessage : styles.otherMessage]}>
          <View style={[styles.usernameContainer, isMe ? { alignSelf: 'flex-end', marginRight: 4 } : { marginLeft: 4 }]}>
            {BadgeIcon ? <BadgeIcon color={badgeObj!.glowColor} size={12} style={{ marginRight: 4 }} /> : null}
            <Text style={styles.username}>{isMe ? 'You' : item.username}</Text>
          </View>
          
          <TouchableOpacity
            activeOpacity={0.95}
            onLongPress={() => setSelectedMessageForReaction(item)}
          >
            <View style={(isSticker || isCustomSticker) ? [styles.stickerContainer, isMe ? styles.mySticker : styles.otherSticker] : [styles.messageBubble, isMe ? styles.myBubble : styles.otherBubble]}>
              {renderReplyHeader(item, isMe)}
              {isSticker ? (
                <FloatingSticker sticker={item.message} />
              ) : isCustomSticker ? (
                <FloatingCustomSticker uri={item.message} />
              ) : (
                <Text style={styles.messageText}>{item.message}</Text>
              )}
              <Text style={[styles.timeText, isMe ? ((isSticker || isCustomSticker) ? styles.myStickerTimeText : styles.myTimeText) : ((isSticker || isCustomSticker) ? styles.otherStickerTimeText : styles.otherTimeText)]}>
                {formatTime(item.timestamp)}
              </Text>
            </View>
          </TouchableOpacity>
          
          {renderReactions(item, isMe)}
        </View>
      </SwipeableMessage>
    );
  };

  return (
    <Modal
      visible={isVisible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
      statusBarTranslucent={true}
    >
      {!shouldRender ? (
        <View style={[styles.modalOverlay, { justifyContent: 'center', alignItems: 'center', backgroundColor: '#121212' }]}>
          <ActivityIndicator color="#00FFCC" size="large" />
        </View>
      ) : (
        <KeyboardAvoidingView 
          style={styles.modalOverlay} 
          behavior="padding"
        >
          <View style={[styles.chatContainer, { paddingTop: insets.top }]}>
          <View style={styles.header}>
            <View>
              <Text style={styles.venueName}>{venueName}</Text>
              <Text style={styles.subtitle}>Live Chat (24h)</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <X color="#FFF" size={24} />
            </TouchableOpacity>
          </View>

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
              data={messages.filter(msg => !hiddenUsers.includes(msg.user_id))}
              keyExtractor={item => item.id}
              renderItem={renderMessage}
              contentContainerStyle={styles.messagesList}
              onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
              onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
            />
          )}

          {messages.length === 0 && !inputText.trim() && !isLoading && (
            <View style={styles.suggestionsContainer}>
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="always"
                data={CHAT_SUGGESTIONS}
                keyExtractor={(item) => item}
                renderItem={({ item }) => (
                  <TouchableOpacity 
                    style={styles.suggestionChip}
                    onPress={() => setInputText(item)}
                  >
                    <Text style={styles.suggestionText}>{item}</Text>
                  </TouchableOpacity>
                )}
              />
            </View>
          )}

          {/* Replying-to Preview Bar */}
          {replyingTo && (
            <View style={styles.replyBar}>
              <View style={styles.replyBarVerticalLine} />
              <View style={styles.replyBarContent}>
                <Text style={styles.replyBarUser}>Replying to {replyingTo.username}</Text>
                <Text style={styles.replyBarText} numberOfLines={1}>{replyingTo.message}</Text>
              </View>
              <TouchableOpacity onPress={() => setReplyingTo(null)} style={styles.replyBarClose}>
                <X color="#888" size={16} />
              </TouchableOpacity>
            </View>
          )}

          {/* Admin Posting Toggle Selector */}
          {isAdmin && (
            <View style={styles.adminToggleContainer}>
              <Text style={styles.adminToggleLabel}>Post as:</Text>
              <View style={styles.adminToggleButtons}>
                <TouchableOpacity 
                  style={[styles.adminToggleButton, !sendAsSimulated && styles.adminToggleButtonActive]}
                  onPress={() => setSendAsSimulated(false)}
                >
                  <Text style={[styles.adminToggleText, !sendAsSimulated && styles.adminToggleTextActive]}>
                    My Admin Profile
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.adminToggleButton, sendAsSimulated && styles.adminToggleButtonActive]}
                  onPress={() => setSendAsSimulated(true)}
                >
                  <Text style={[styles.adminToggleText, sendAsSimulated && styles.adminToggleTextActive]}>
                    Simulated User
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Sticker Picker Panel */}
          {isStickerPickerVisible && (
            <View style={styles.stickerPickerPanel}>
              <FlatList
                data={['CUSTOM_UPLOAD', ...CURATED_STICKERS]}
                keyExtractor={(item) => item}
                numColumns={6}
                renderItem={({ item }) => {
                  if (item === 'CUSTOM_UPLOAD') {
                    return (
                      <TouchableOpacity 
                        style={[styles.stickerItem, styles.customUploadItem]}
                        onPress={handleCustomStickerUpload}
                        disabled={isUploadingCustom}
                      >
                        {isUploadingCustom ? (
                          <ActivityIndicator color="#00FFCC" size="small" />
                        ) : (
                          <Icons.Plus color="#00FFCC" size={28} />
                        )}
                      </TouchableOpacity>
                    );
                  }
                  return (
                    <TouchableOpacity 
                      style={styles.stickerItem}
                      onPress={() => sendSticker(item)}
                    >
                      <Text style={styles.stickerItemText}>{item}</Text>
                    </TouchableOpacity>
                  );
                }}
                contentContainerStyle={styles.stickerGrid}
                scrollEnabled={false}
              />
            </View>
          )}

          <View style={[
            styles.inputContainer,
            { paddingBottom: keyboardVisible ? 12 : Math.max(12, insets.bottom) }
          ]}>
            <TouchableOpacity 
              style={styles.iconButton}
              onPress={() => {
                if (isStickerPickerVisible) {
                  setIsStickerPickerVisible(false);
                } else {
                  Keyboard.dismiss();
                  setIsStickerPickerVisible(true);
                }
              }}
            >
              <Smile color={isStickerPickerVisible ? "#00FFCC" : "#FFF"} size={24} />
            </TouchableOpacity>
            <TextInput
              style={styles.textInput}
              placeholder="Ask about the vibe..."
              placeholderTextColor="#888"
              value={inputText}
              onChangeText={setInputText}
              onFocus={() => setIsStickerPickerVisible(false)}
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

        {/* Reaction Emoji Popover Modal */}
        <Modal
          visible={!!selectedMessageForReaction}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setSelectedMessageForReaction(null)}
        >
          <TouchableWithoutFeedback onPress={() => setSelectedMessageForReaction(null)}>
            <View style={styles.modalOverlayReaction}>
              <TouchableWithoutFeedback>
                <View style={[
                  styles.reactionPopup,
                  styles.myReactionPopup // Always use vertical option layout for action items
                ]}>
                  <View style={styles.emojiRow}>
                    {REACTION_EMOJIS.map(emoji => (
                      <TouchableOpacity
                        key={emoji}
                        onPress={() => {
                          if (selectedMessageForReaction) {
                            toggleReaction(selectedMessageForReaction.id, emoji);
                            setSelectedMessageForReaction(null);
                          }
                        }}
                      >
                        <Text style={styles.reactionPopupEmoji}>{emoji}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {selectedMessageForReaction?.user_id === user?.uid ? (
                    <>
                      <View style={styles.reactionSeparator} />
                      <TouchableOpacity
                        style={styles.deleteOption}
                        onPress={() => {
                          if (selectedMessageForReaction) {
                            handleDeleteMessage(selectedMessageForReaction.id);
                          }
                        }}
                      >
                        <Trash2 color="#FF3333" size={16} style={{ marginRight: 8 }} />
                        <Text style={styles.deleteOptionText}>Delete Message</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <>
                      <View style={styles.reactionSeparator} />
                      <TouchableOpacity
                        style={styles.deleteOption}
                        onPress={() => {
                          if (selectedMessageForReaction) {
                            handleReportMessage(selectedMessageForReaction);
                          }
                        }}
                      >
                        <Flag color="#FFD700" size={16} style={{ marginRight: 8 }} />
                        <Text style={[styles.deleteOptionText, { color: '#FFD700' }]}>Report Message</Text>
                      </TouchableOpacity>
                      <View style={styles.reactionSeparator} />
                      <TouchableOpacity
                        style={styles.deleteOption}
                        onPress={() => {
                          if (selectedMessageForReaction) {
                            handleHideUserPrompt(
                              selectedMessageForReaction.user_id,
                              selectedMessageForReaction.username
                            );
                          }
                        }}
                      >
                        <Icons.UserX color="#FF3366" size={16} style={{ marginRight: 8 }} />
                        <Text style={[styles.deleteOptionText, { color: '#FF3366' }]}>Hide User</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

      </KeyboardAvoidingView>
      )}
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
    marginBottom: 10,
    maxWidth: '85%',
  },
  myMessage: {
    alignSelf: 'flex-end',
  },
  otherMessage: {
    alignSelf: 'flex-start',
  },
  usernameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    marginLeft: 4,
  },
  username: {
    color: '#AAA',
    fontSize: 12,
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
  suggestionsContainer: {
    paddingLeft: 16,
    paddingBottom: 12,
  },
  suggestionChip: {
    backgroundColor: '#1E1E1E',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#333',
  },
  suggestionText: {
    color: '#00FFCC',
    fontSize: 14,
    fontWeight: '500',
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
  },
  
  // 👥 Emoji Reactions Styles
  modalOverlayReaction: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  reactionPopup: {
    flexDirection: 'row',
    backgroundColor: '#1E1E1E',
    borderRadius: 30,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#333',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
  },
  myReactionPopup: {
    flexDirection: 'column',
    borderRadius: 20,
    alignItems: 'stretch',
    minWidth: 250,
  },
  emojiRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  reactionSeparator: {
    height: 1,
    backgroundColor: '#333',
    marginVertical: 10,
  },
  deleteOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  deleteOptionText: {
    color: '#FF3333',
    fontSize: 14,
    fontWeight: '600',
  },
  reactionPopupEmoji: {
    fontSize: 26,
    marginHorizontal: 8,
  },
  reactionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
    marginBottom: 4,
  },
  reactionCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#222',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#333',
  },
  reactionCapsuleActive: {
    backgroundColor: 'rgba(0, 255, 204, 0.1)',
    borderColor: '#00FFCC',
  },
  reactionEmoji: {
    fontSize: 12,
    marginRight: 4,
  },
  reactionCount: {
    color: '#888',
    fontSize: 10,
    fontWeight: 'bold',
  },
  reactionCountActive: {
    color: '#00FFCC',
  },

  // 📍 Sliding Reply Preview Bar Styles
  replyBar: {
    flexDirection: 'row',
    backgroundColor: '#1A1A1A',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#333',
    alignItems: 'center',
  },
  replyBarVerticalLine: {
    width: 3,
    height: '100%',
    backgroundColor: '#00FFCC',
    marginRight: 10,
    borderRadius: 2,
  },
  replyBarContent: {
    flex: 1,
  },
  replyBarUser: {
    color: '#00FFCC',
    fontSize: 12,
    fontWeight: 'bold',
  },
  replyBarText: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  replyBarClose: {
    padding: 4,
  },

  // Quoted reply in message bubble
  replyBubbleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 8,
    padding: 6,
    marginBottom: 6,
    maxWidth: '100%',
  },
  myReplyHeader: {
    borderLeftWidth: 2,
    borderLeftColor: '#00FFCC',
  },
  otherReplyHeader: {
    borderLeftWidth: 2,
    borderLeftColor: '#FF00CC',
  },
  replyHeaderUser: {
    color: '#00FFCC',
    fontSize: 11,
    fontWeight: 'bold',
    marginRight: 6,
  },
  replyHeaderText: {
    color: '#AAA',
    fontSize: 11,
    flex: 1,
  },

  // Swipe gesture styles
  swipeContainer: {
    position: 'relative',
    width: '100%',
  },
  replyIconContainer: {
    position: 'absolute',
    left: 15,
    top: '30%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  // Admin posting toggle styles
  adminToggleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1E1A2A', // glassmorphic deep dark violet-grey
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: '#2F1A4A',
    borderBottomWidth: 1,
    borderBottomColor: '#2F1A4A',
  },
  adminToggleLabel: {
    color: '#8A7A9A',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  adminToggleButtons: {
    flexDirection: 'row',
    backgroundColor: '#120D1A',
    borderRadius: 8,
    padding: 2,
    borderWidth: 1,
    borderColor: '#2F1A4A',
  },
  adminToggleButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  adminToggleButtonActive: {
    backgroundColor: '#FF00CC', // High-end theme neon magenta
    shadowColor: '#FF00CC',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
  },
  adminToggleText: {
    color: '#6A5A7A',
    fontSize: 12,
    fontWeight: '700',
  },
  adminToggleTextActive: {
    color: '#FFF',
  },

  // 🎭 Sticker & emoji feature styles
  stickerContainer: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mySticker: {
    alignSelf: 'flex-end',
  },
  otherSticker: {
    alignSelf: 'flex-start',
  },
  stickerText: {
    fontSize: 64,
  },
  myStickerTimeText: {
    color: '#888',
    fontSize: 10,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  otherStickerTimeText: {
    color: '#888',
    fontSize: 10,
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  stickerPickerPanel: {
    backgroundColor: '#1E1E1E',
    borderTopWidth: 1,
    borderTopColor: '#333',
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  stickerGrid: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  stickerItem: {
    width: 50,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    margin: 4,
  },
  stickerItemText: {
    fontSize: 32,
  },
  iconButton: {
    padding: 8,
    marginRight: 8,
  },
  customStickerImage: {
    width: 100,
    height: 100,
    borderRadius: 8,
  },
  customUploadItem: {
    backgroundColor: '#222',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#00FFCC',
    borderRadius: 12,
  }
});
