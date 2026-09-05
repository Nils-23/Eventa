import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  Image,
  ScrollView
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Video, ResizeMode } from 'expo-av';
import { X, Send, CornerUpLeft, Trash2, Flag, Camera } from 'lucide-react-native';
import { navigate } from '../navigation/navigationRef';
import { ref, push, set, remove } from 'firebase/database';
import { subscribeToRTDB } from '../utils/firebaseUtils';
import { doc, getDoc, updateDoc, increment } from 'firebase/firestore';
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { realtimeDB, firestore, storage } from '../services/firebase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppStore } from '../hooks/useAppStore';
import { requireUsername, hideUser } from '../services/userService';
import { useUsernames } from '../hooks/useUsernames';
import { SIM_PERSONAS, DEFAULT_SIM_PERSONA, getSimPersona, SimPersona } from '../services/simPersonas';
import { checkAndUnlockAchievements, ACHIEVEMENTS } from '../services/achievementService';
import { createReport } from '../services/reportService';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import * as Icons from 'lucide-react-native';
import { getFriendlyErrorMessage } from '../utils/errorUtils';
import { getDistanceInMeters } from '../utils/locationUtils';
import { useLiveVenues } from '../hooks/useLiveVenues';
import { StoryViewer } from './StoryViewer';

// Last persona the admin spoke as, so the choice survives closing the chat/app.
const SIM_PERSONA_STORAGE_KEY = '@eventa/admin_sim_persona_id';

interface Message {
  id: string;
  user_id: string;
  username: string;
  message: string;
  timestamp: number;
  // 'sticker' / 'custom_sticker' are legacy: the emoji picker was replaced by the
  // camera, but messages live for 24h so old ones still have to render.
  type?: 'text' | 'sticker' | 'custom_sticker' | 'story_reaction' | 'media';
  mediaType?: 'image' | 'video';
  activeBadge?: string;
  reactions?: Record<string, Record<string, string>>; // emoji -> userId -> username
  replyTo?: {
    messageId: string;
    /** Author of the quoted message, so the quote can show their live name. */
    userId?: string;
    username: string;
    message: string;
  };
  storyData?: {
    id: string;
    media_url: string;
    media_type: 'image' | 'video';
    user_id: string;
    username: string;
    created_at: number;
    expires_at: number;
    venue_id?: string;
    activeBadge?: string;
  };
}

interface VenueChatProps {
  isVisible: boolean;
  onClose: () => void;
  venueId: string;
  venueName: string;
  // Optional venue coordinates for the camera's proximity gate. When omitted the
  // venue is looked up in the live venues feed by id, so callers that only hold an
  // id/name pair (e.g. ChatListScreen) still get the gate.
  venueLatitude?: number;
  venueLongitude?: number;
}

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

// Same radius the stories feature uses to unlock posting — camera messages are
// meant to prove you're actually at the venue right now.
const MEDIA_RADIUS_METERS = 200;
// "Short videos": anything longer gets cut off by the picker itself.
const MAX_VIDEO_SECONDS = 15;
// Ceiling on how long a tap waits for a GPS fix before falling back to the cached one.
const LOCATION_FIX_TIMEOUT_MS = 4000;

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

// Legacy renderers: stickers can no longer be sent (the picker became the camera),
// but any sent in the last 24h still need to display.
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

export const VenueChat: React.FC<VenueChatProps> = ({
  isVisible,
  onClose,
  venueId,
  venueName,
  venueLatitude,
  venueLongitude,
}) => {
  const [shouldRender, setShouldRender] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMessageForReaction, setSelectedMessageForReaction] = useState<Message | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [activeBadge, setActiveBadge] = useState<string | null>(null);
  const [sendAsSimulated, setSendAsSimulated] = useState(false);
  // Admin "simulated user" identity comes from a FIXED roster of ten personas
  // (services/simPersonas.ts). Every simulated message sends as the currently
  // selected one, so the admin holds a continuous conversation as a single
  // person and can switch away and come back to it later — earlier this minted
  // a fresh random persona on every shuffle, which made the old identity
  // unrecoverable. The ref mirrors state so the async send paths never read a
  // stale value between a set and the next render.
  const [simPersona, setSimPersona] = useState<SimPersona>(DEFAULT_SIM_PERSONA);
  const simPersonaRef = useRef<SimPersona>(DEFAULT_SIM_PERSONA);
  const setPersona = (p: SimPersona) => {
    simPersonaRef.current = p;
    setSimPersona(p);
    AsyncStorage.setItem(SIM_PERSONA_STORAGE_KEY, p.id)
      .catch((err) => console.warn('[VenueChat] Failed to persist sim persona:', err));
  };
  // Admin personas are human-controlled, so they count as real presence for
  // the hot-venue notification triggers (join spike / user count). Every send
  // refreshes the persona's entry; the server prunes entries it deems stale.
  const recordSimPersonaPresence = (personaId: string) => {
    if (!venueId) return;
    set(ref(realtimeDB, `admin_persona_locations/${personaId}`), {
      user_id: personaId,
      venueId,
      timestamp: Date.now(),
    }).catch((err) => console.warn('[VenueChat] Failed to record persona presence:', err));
  };
  // Returns the selected roster persona and refreshes its presence entry.
  const ensureSimPersona = () => {
    const persona = simPersonaRef.current;
    recordSimPersonaPresence(persona.id);
    return persona;
  };
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [isCheckingLocation, setIsCheckingLocation] = useState(false);
  const [mediaViewer, setMediaViewer] = useState<{ url: string; mediaType: 'image' | 'video' } | null>(null);
  const [selectedStoryForViewer, setSelectedStoryForViewer] = useState<any[]>([]);
  const [isStoryViewerVisible, setIsStoryViewerVisible] = useState(false);

  const user = useAppStore((s) => s.user);
  const hiddenUsers = useAppStore((s) => s.hiddenUsers);
  const setHiddenUsers = useAppStore((s) => s.setHiddenUsers);
  const isAdmin = useAppStore((s) => s.isAdmin);

  // ─── Live author names ───────────────────────────────────────────────────
  // The `username` on a message is a snapshot of what the sender was called
  // when they sent it, and nothing ever rewrites it. Rendering that string is
  // why a rename appeared to "undo itself": the profile showed the new name
  // while every message in the room still showed the old one. Names are
  // resolved live from the author's user document instead, and the stored
  // string is kept only as the fallback for ids we cannot resolve.
  const messageAuthorIds = useMemo(
    () => messages.flatMap((m) => [m.user_id, m.replyTo?.userId, m.storyData?.user_id]),
    [messages]
  );
  const liveNames = useUsernames(messageAuthorIds);
  const displayName = (userId?: string | null, storedName?: string) =>
    (userId ? liveNames[userId] : null) ?? storedName ?? 'Someone';
  // Restore the last persona the admin spoke as, so re-opening a chat (or the
  // app) resumes the same identity instead of silently reverting to slot 1.
  useEffect(() => {
    if (!isAdmin) return;
    AsyncStorage.getItem(SIM_PERSONA_STORAGE_KEY)
      .then((storedId) => {
        const stored = storedId ? getSimPersona(storedId) : undefined;
        if (stored) {
          simPersonaRef.current = stored;
          setSimPersona(stored);
        }
      })
      .catch((err) => console.warn('[VenueChat] Failed to restore sim persona:', err));
  }, [isAdmin]);
  const updateLastViewedChat = useAppStore((s) => s.updateLastViewedChat);
  const userLocation = useAppStore((s) => s.userLocation);
  const { venues, ensureLocationWatch } = useLiveVenues();
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  const swipeClosePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx > 40) {
          onClose();
        }
      },
    })
  ).current;

  // ── Unread divider (WhatsApp-style) ──────────────────────────────────────
  // Snapshot the last-viewed timestamp at open — the effect below overwrites
  // it immediately, and the divider anchors to this boundary.
  const [unreadAnchor, setUnreadAnchor] = useState<{ id: string; count: number } | null>(null);
  const unreadLockedRef = useRef(false);
  const initialScrollDoneRef = useRef(false);
  const unreadSinceRef = useRef(0);

  useEffect(() => {
    if (isVisible && venueId) {
      unreadSinceRef.current = useAppStore.getState().lastViewedChats[venueId] || 0;
    } else {
      unreadLockedRef.current = false;
      initialScrollDoneRef.current = false;
      setUnreadAnchor(null);
    }
  }, [isVisible, venueId]);

  useEffect(() => {
    if (isVisible && venueId) {
      updateLastViewedChat(venueId);
    }
  }, [isVisible, venueId, messages.length, updateLastViewedChat]);

  // Anchor the divider once per open on the first load of messages: it stays
  // put while the chat is open (even as new messages arrive) and is gone on
  // the next visit, once everything has been "read".
  useEffect(() => {
    if (!isVisible || unreadLockedRef.current || isLoading) return;
    unreadLockedRef.current = true;
    const since = unreadSinceRef.current;
    if (since <= 0) return; // first-ever visit: nothing is "unread" yet
    const unread = messages.filter(
      (m) => m.timestamp > since && m.user_id !== user?.uid && !hiddenUsers.includes(m.user_id)
    );
    if (unread.length > 0) {
      setUnreadAnchor({ id: unread[0].id, count: unread.length });
    }
  }, [isVisible, isLoading, messages]);



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
      () => setKeyboardVisible(true)
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

  // Reply previews quote the original text. Media and stickers have no text worth
  // quoting (the raw value is a storage URL), so they get a short label instead.
  const replyPreview = (msg: Message) => {
    if (msg.type === 'media') return msg.mediaType === 'video' ? '🎥 Video' : '📷 Photo';
    if (msg.type === 'custom_sticker') return '🖼️ Sticker';
    return msg.message;
  };

  // Shared tail of every send path: resolves the sender identity (pinned admin
  // persona or the real account), writes the message, then updates stats and
  // presence in the background.
  const postMessage = async (
    payload: { message: string; type: Message['type']; mediaType?: 'image' | 'video' },
    previousReplyTo: Message | null
  ) => {
    if (!user || !venueId) return;

    let senderId = user.uid;
    let senderName = '';
    let senderBadge: string | null = activeBadge;

    if (isAdmin && sendAsSimulated) {
      const persona = ensureSimPersona();
      senderId = persona.id;
      senderName = persona.name;
      senderBadge = null; // Simulated users don't get the admin's active badge
    } else {
      senderName = await requireUsername(user.uid);
    }

    const chatRef = ref(realtimeDB, `venue_chats/${venueId}`);
    const newMessageRef = push(chatRef);

    await set(newMessageRef, {
      user_id: senderId,
      username: senderName,
      message: payload.message,
      type: payload.type,
      timestamp: Date.now(),
      ...(payload.mediaType ? { mediaType: payload.mediaType } : {}),
      ...(senderBadge ? { activeBadge: senderBadge } : {}),
      ...(previousReplyTo ? {
        replyTo: {
          messageId: previousReplyTo.id,
          userId: previousReplyTo.user_id,
          username: displayName(previousReplyTo.user_id, previousReplyTo.username),
          message: replyPreview(previousReplyTo)
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
  };

  const handleSend = async () => {
    const textToSend = inputText.trim();
    if (!textToSend || !user || !venueId) return;

    if (textToSend.length > 80) {
      Toast.show({
        type: 'error',
        text1: 'Message Too Long',
        text2: 'Messages must be 80 characters or less.'
      });
      return;
    }

    // Clear input immediately to make chat feel extremely snappy and responsive
    setInputText('');
    const previousReplyTo = replyingTo;
    setReplyingTo(null);
    setIsSending(true);

    try {
      await postMessage({ message: textToSend, type: 'text' }, previousReplyTo);
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

  // ── Camera messages (proximity-gated, like stories) ─────────────────────
  // Coordinates come from the caller when it has them, otherwise from the live
  // venues feed. Without either we can't verify presence, so the camera stays locked.
  const venueCoords = useMemo(() => {
    if (typeof venueLatitude === 'number' && typeof venueLongitude === 'number') {
      return { latitude: venueLatitude, longitude: venueLongitude };
    }
    const match = venues.find((v) => v.id === venueId);
    return match ? { latitude: match.latitude, longitude: match.longitude } : null;
  }, [venueLatitude, venueLongitude, venues, venueId]);

  // Drives the lock affordance on the camera button. The authoritative check runs
  // again on tap against a freshly fetched position.
  const isNearVenue = useMemo(() => {
    if (!venueCoords || !userLocation) return false;
    return getDistanceInMeters(
      userLocation.latitude,
      userLocation.longitude,
      venueCoords.latitude,
      venueCoords.longitude
    ) <= MEDIA_RADIUS_METERS;
  }, [venueCoords, userLocation]);

  // Re-checks proximity against a LIVE position rather than the cached store value:
  // the background watcher only pushes after ~20m of movement or every 15s, so it
  // lags real movement and can leave the camera stuck "locked" (same reasoning as
  // the story add button on the map).
  // `promptForPermission` is only set on the tap paths — the passive check on open
  // must never pop a system dialog at someone who just wanted to read the chat.
  const verifyProximity = async (promptForPermission = false): Promise<boolean> => {
    if (!venueCoords) return false;

    let coords = userLocation;
    try {
      let { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted' && promptForPermission) {
        ({ status } = await Location.requestForegroundPermissionsAsync());
        if (status === 'granted') ensureLocationWatch();
      }
      if (status === 'granted') {
        // getCurrentPositionAsync can hang indefinitely rather than reject — a
        // simulator with Location set to "None", or a real device with no fix
        // (basement, airplane mode). Without this race the tap never resolves and
        // the button looks dead, so we time out and use the last known position.
        const fresh = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), LOCATION_FIX_TIMEOUT_MS)),
        ]);
        if (fresh) {
          coords = { latitude: fresh.coords.latitude, longitude: fresh.coords.longitude };
          useAppStore.getState().setUserLocation(coords); // keep store (and lock UI) in sync
        } else {
          console.warn('[VenueChat] Location fix timed out; falling back to cached position.');
        }
      }
    } catch {
      // Fall back to whatever cached location we have.
    }

    if (!coords) return false;
    return getDistanceInMeters(
      coords.latitude,
      coords.longitude,
      venueCoords.latitude,
      venueCoords.longitude
    ) <= MEDIA_RADIUS_METERS;
  };

  // Refresh the fix once per open so the lock affordance reflects where the user
  // actually is rather than a cached position from before they walked in.
  useEffect(() => {
    if (isVisible && shouldRender && venueCoords) {
      verifyProximity().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, shouldRender, venueCoords]);

  const sendMedia = async (downloadUrl: string, mediaType: 'image' | 'video') => {
    if (!user || !venueId) return;

    const previousReplyTo = replyingTo;
    setReplyingTo(null);

    try {
      await postMessage({ message: downloadUrl, type: 'media', mediaType }, previousReplyTo);
    } catch (error) {
      console.warn('Error sending media:', error);
      setReplyingTo(previousReplyTo);
      Toast.show({
        type: 'error',
        text1: 'Message Failed',
        text2: getFriendlyErrorMessage(error)
      });
    }
  };

  // Camera only, no gallery: what lands in a venue chat has to be shot there and
  // then. A library picker would let any old photo pose as what's happening now.
  const launchMediaPicker = async () => {
    if (!user || !venueId) return;
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();

      if (status !== 'granted') {
        Toast.show({
          type: 'error',
          text1: 'Permission Denied',
          text2: 'Camera access is required.'
        });
        return;
      }

      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images', 'videos'],
        allowsEditing: true,
        quality: 0.7,
        videoMaxDuration: MAX_VIDEO_SECONDS,
      };

      const result = await ImagePicker.launchCameraAsync(options);

      if (result.canceled || result.assets.length === 0) return;

      const asset = result.assets[0];
      const mediaType: 'image' | 'video' = asset.type === 'video' ? 'video' : 'image';

      // A slow shot/upload gives plenty of time to walk away, so re-verify presence
      // right before the message goes out.
      if (!(await verifyProximity(true))) {
        Toast.show({
          type: 'error',
          text1: 'Too far away',
          text2: `You must be within ${MEDIA_RADIUS_METERS}m to post here!`
        });
        return;
      }

      setIsUploadingMedia(true);

      // Kept under the stories/ prefix on purpose: that path is already writable by
      // signed-in users under the deployed Storage rules.
      const fileExtension = asset.uri.split('.').pop() || (mediaType === 'video' ? 'mp4' : 'jpg');
      const fileName = `stories/${user.uid}_chat_${Date.now()}.${fileExtension}`;
      const stRef = storageRef(storage, fileName);

      const response = await fetch(asset.uri);
      const blob = await response.blob();

      const uploadTask = await uploadBytesResumable(stRef, blob);
      const downloadUrl = await getDownloadURL(uploadTask.ref);

      await sendMedia(downloadUrl, mediaType);
    } catch (error) {
      console.warn('Chat media upload error:', error);
      Toast.show({
        type: 'error',
        text1: 'Upload Failed',
        text2: getFriendlyErrorMessage(error),
      });
    } finally {
      setIsUploadingMedia(false);
    }
  };

  const handleCameraPress = async () => {
    if (!user || !venueId || isUploadingMedia || isCheckingLocation) return;

    // The fix can take a second or two; without this the button reads as dead.
    setIsCheckingLocation(true);
    let near = false;
    try {
      near = await verifyProximity(true);
    } finally {
      setIsCheckingLocation(false);
    }

    if (!near) {
      Alert.alert(
        'Vibe Check Restricted',
        `You must be within ${MEDIA_RADIUS_METERS} meters of ${venueName} to share photos or videos here. This keeps the Eventas live feed real and local to what is happening right now!`,
        [{ text: 'Got it' }]
      );
      return;
    }

    // Straight to the camera — with the gallery gone there is nothing to choose
    // between, and a confirmation dialog would just be a tap in the way.
    Keyboard.dismiss();
    launchMediaPicker();
  };


  const toggleReaction = async (messageId: string, emoji: string) => {
    if (!user || !venueId) return;
    try {
      // Keyed by uid, so the stored name is only ever a label of last resort —
      // every reader resolves the reactor's current name from the uid.
      const username = await requireUsername(user.uid);
      const reactionRef = ref(realtimeDB, `venue_chats/${venueId}/${messageId}/reactions/${emoji}/${user.uid}`);
      
      const message = messages.find(m => m.id === messageId);
      const userReacted = message?.reactions?.[emoji]?.[user.uid];

      if (userReacted) {
        await set(reactionRef, null);
      } else {
        await set(reactionRef, username);
      }
    } catch (error) {
      // Reactions used to fail in complete silence — the emoji simply never
      // appeared and the user was left to work out why.
      console.warn("Failed to toggle reaction:", error);
      Toast.show({
        type: 'error',
        text1: 'Reaction not saved',
        text2: getFriendlyErrorMessage(error),
      });
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
      const isMedia = msg.type === 'media';
      await createReport(
        user.uid,
        msg.user_id,
        'chat',
        msg.id,
        isMedia ? (msg.mediaType === 'video' ? 'Video message' : 'Photo message') : msg.message,
        venueId,
        reason,
        isMedia && msg.message
          ? { url: msg.message, type: msg.mediaType === 'video' ? 'video' : 'image' }
          : undefined
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

  const handleReportStory = (msg: Message) => {
    if (!user || !venueId || !msg.storyData) return;

    Alert.alert(
      "Report Story",
      "Why are you reporting this story?",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Inappropriate Content", 
          onPress: () => submitStoryReport(msg, "Inappropriate Content")
        },
        { 
          text: "Harassment / Bullying", 
          onPress: () => submitStoryReport(msg, "Harassment or Bullying")
        },
        { 
          text: "Spam / Scams", 
          onPress: () => submitStoryReport(msg, "Spam or scams")
        },
        { 
          text: "Hate Speech", 
          onPress: () => submitStoryReport(msg, "Hate Speech")
        }
      ]
    );
  };

  const submitStoryReport = async (msg: Message, reason: string) => {
    if (!user || !msg.storyData) return;
    try {
      await createReport(
        user.uid,
        msg.storyData.user_id,
        'post',
        msg.storyData.id,
        msg.storyData.media_type === 'video' ? 'Video story' : 'Photo story',
        venueId,
        reason,
        msg.storyData.media_url
          ? { url: msg.storyData.media_url, type: msg.storyData.media_type === 'video' ? 'video' : 'image' }
          : undefined
      );
      Toast.show({
        type: 'success',
        text1: 'Report Submitted',
        text2: 'Thank you. We will review this story.'
      });
    } catch (error) {
      console.warn("Failed to submit story report:", error);
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
        <Text style={styles.replyHeaderUser} numberOfLines={1}>{displayName(message.replyTo.userId, message.replyTo.username)}</Text>
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
    const isStoryReaction = item.type === 'story_reaction' && item.storyData;
    const isMedia = item.type === 'media';

    return (
      <>
      {unreadAnchor?.id === item.id && (
        <View style={styles.unreadDividerRow}>
          <View style={styles.unreadDividerLine} />
          <Text style={styles.unreadDividerText}>
            {unreadAnchor.count} UNREAD MESSAGE{unreadAnchor.count > 1 ? 'S' : ''}
          </Text>
          <View style={styles.unreadDividerLine} />
        </View>
      )}
      <SwipeableMessage
        key={item.id}
        onSwipe={() => setReplyingTo(item)}
        isMe={isMe}
      >
        <View style={[styles.messageContainer, isMe ? styles.myMessage : styles.otherMessage]}>
          <View style={[styles.usernameContainer, isMe ? { alignSelf: 'flex-end', marginRight: 4 } : { marginLeft: 4 }]}>
            {BadgeIcon ? <BadgeIcon color={badgeObj!.glowColor} size={12} style={{ marginRight: 4 }} /> : null}
            <Text style={styles.username} numberOfLines={1} ellipsizeMode="tail">{isMe ? 'You' : displayName(item.user_id, item.username)}</Text>
          </View>
          
          <TouchableOpacity
            activeOpacity={0.95}
            onLongPress={() => setSelectedMessageForReaction(item)}
            onPress={() => {
              if (isStoryReaction && item.storyData) {
                const storyObj = {
                  id: item.storyData.id,
                  user_id: item.storyData.user_id,
                  media_url: item.storyData.media_url,
                  media_type: item.storyData.media_type,
                  created_at: item.storyData.created_at ? {
                    toDate: () => new Date(item.storyData!.created_at)
                  } : null,
                  expires_at: item.storyData.expires_at ? {
                    toDate: () => new Date(item.storyData!.expires_at)
                  } : null,
                  venue_id: item.storyData.venue_id || venueId,
                  activeBadge: item.storyData.activeBadge || undefined
                };
                setSelectedStoryForViewer([storyObj]);
                setIsStoryViewerVisible(true);
              } else if (isMedia) {
                setMediaViewer({ url: item.message, mediaType: item.mediaType === 'video' ? 'video' : 'image' });
              }
            }}
          >
            {isStoryReaction && item.storyData ? (
              <View style={[
                styles.storyReactionBubble, 
                isMe ? styles.myStoryReactionBubble : styles.otherStoryReactionBubble
              ]}>
                <View style={styles.storyReactionContent}>
                  <View style={styles.storyThumbnailContainer}>
                    <Image source={{ uri: item.storyData.media_url }} style={styles.storyThumbnail} />
                    {item.storyData.media_type === 'video' && (
                      <View style={styles.playIconOverlay}>
                        <Icons.Play size={10} color="#000" fill="#000" />
                      </View>
                    )}
                  </View>
                  <View style={styles.storyReactionDetails}>
                    <Text style={styles.storyReactionText}>{item.message}</Text>
                    <View style={styles.tapToViewContainer}>
                      <Icons.Sparkles size={10} color="#00FFCC" style={{ marginRight: 4 }} />
                      <Text style={styles.tapToViewText}>Tap to view story</Text>
                    </View>
                  </View>
                </View>
                <Text style={[styles.timeText, styles.storyReactionTime]}>
                  {formatTime(item.timestamp)}
                </Text>
              </View>
            ) : isMedia ? (
              <View style={[styles.mediaBubble, isMe ? styles.myMediaBubble : styles.otherMediaBubble]}>
                {renderReplyHeader(item, isMe)}
                <View style={styles.mediaFrame} pointerEvents="none">
                  {item.mediaType === 'video' ? (
                    // Paused Video renders the first frame as the thumbnail; actual
                    // playback (with sound and controls) happens in the full-screen viewer.
                    <>
                      <Video
                        source={{ uri: item.message }}
                        style={styles.mediaImage}
                        resizeMode={ResizeMode.COVER}
                        shouldPlay={false}
                        isMuted
                      />
                      <View style={styles.mediaPlayBadge}>
                        <Icons.Play size={20} color="#000" fill="#000" />
                      </View>
                      <View style={styles.mediaTypePill}>
                        <Icons.Video size={10} color="#FFF" />
                        <Text style={styles.mediaTypePillText}>Video</Text>
                      </View>
                    </>
                  ) : (
                    <Image source={{ uri: item.message }} style={styles.mediaImage} resizeMode="cover" />
                  )}
                </View>
                <Text style={[styles.timeText, isMe ? styles.myTimeText : styles.otherTimeText]}>
                  {formatTime(item.timestamp)}
                </Text>
              </View>
            ) : (
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
            )}
          </TouchableOpacity>
          
          {renderReactions(item, isMe)}
        </View>
      </SwipeableMessage>
      </>
    );
  };

  const visibleMessages = messages.filter(msg => !hiddenUsers.includes(msg.user_id));

  // Initial scroll lands on the unread divider (slightly below the top) like
  // WhatsApp; without unread we stick to the bottom as before. After the
  // divider scroll, incoming messages no longer yank the list to the end —
  // the explicit scrollToEnd in the send paths still covers own messages.
  const handleListReady = () => {
    if (unreadAnchor) {
      if (initialScrollDoneRef.current) return;
      const idx = visibleMessages.findIndex(m => m.id === unreadAnchor.id);
      if (idx >= 0) {
        initialScrollDoneRef.current = true;
        flatListRef.current?.scrollToIndex({ index: idx, viewPosition: 0.2, animated: false });
      }
      return;
    }
    flatListRef.current?.scrollToEnd({ animated: true });
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
            {/* flex:1 + minWidth:0 so a long venue name truncates instead of
                growing the row and shoving the close button off-screen. */}
            <View style={styles.headerTitleGroup}>
              <Text style={styles.venueName} numberOfLines={1} ellipsizeMode="tail">{venueName}</Text>
              <Text style={styles.subtitle}>Live Chat (24h)</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <X color="#FFF" size={24} />
            </TouchableOpacity>
          </View>

          {/* Message area. The left-edge swipe strip lives INSIDE this region so it can
              never reach the input bar below it — it used to span the whole modal at
              zIndex 9999 and swallow taps on the left 40px, which is exactly where the
              camera button sits. */}
          <View style={styles.listArea}>
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
                data={visibleMessages}
                keyExtractor={item => item.id}
                renderItem={renderMessage}
                contentContainerStyle={styles.messagesList}
                onContentSizeChange={handleListReady}
                onLayout={handleListReady}
                onScrollToIndexFailed={(info) => {
                  // Virtualized rows may not be measured yet — jump close, retry.
                  flatListRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
                  setTimeout(() => {
                    flatListRef.current?.scrollToIndex({ index: info.index, viewPosition: 0.2, animated: false });
                  }, 120);
                }}
              />
            )}

            {/* Swipe-right on the left edge of the messages to close. Last child so it
                sits above the list, but bounded by listArea. */}
            <View
              style={styles.swipeEdgeStrip}
              {...swipeClosePanResponder.panHandlers}
            />
          </View>

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
                <Text style={styles.replyBarUser}>Replying to {displayName(replyingTo.user_id, replyingTo.username)}</Text>
                <Text style={styles.replyBarText} numberOfLines={1}>{replyPreview(replyingTo)}</Text>
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
                  onPress={() => { setSendAsSimulated(true); ensureSimPersona(); }}
                >
                  <Text style={[styles.adminToggleText, sendAsSimulated && styles.adminToggleTextActive]}>
                    Simulated User
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Fixed roster of simulated personas. All simulated messages send as the
              selected one, and any persona can be re-selected later to pick a
              conversation back up. */}
          {isAdmin && sendAsSimulated && (
            <View style={styles.simPersonaBar}>
              <Text style={styles.simPersonaLabel}>
                Speaking as <Text style={styles.simPersonaName}>{simPersona.name}</Text>
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.simPersonaChips}
              >
                {SIM_PERSONAS.map((persona) => {
                  const isSelected = persona.id === simPersona.id;
                  return (
                    <TouchableOpacity
                      key={persona.id}
                      style={[styles.simPersonaChip, isSelected && styles.simPersonaChipActive]}
                      onPress={() => setPersona(persona)}
                      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                    >
                      <Text style={[styles.simPersonaChipText, isSelected && styles.simPersonaChipTextActive]}>
                        {persona.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          <View
            style={[
              styles.inputContainer,
              { paddingBottom: keyboardVisible ? 12 : Math.max(12, insets.bottom) }
            ]}
          >
            <TouchableOpacity
              style={styles.iconButton}
              onPress={handleCameraPress}
              disabled={isUploadingMedia || isCheckingLocation}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              {isUploadingMedia || isCheckingLocation ? (
                <ActivityIndicator color="#00FFCC" size="small" />
              ) : (
                // Same affordance as the story add bubble: greyed out until you're
                // actually at the venue, then it lights up.
                <Camera color={isNearVenue ? '#00FFCC' : '#777'} size={24} />
              )}
            </TouchableOpacity>
            <TextInput
              style={styles.textInput}
              placeholder="Ask about the vibe..."
              placeholderTextColor="#888"
              value={inputText}
              onChangeText={setInputText}
              maxLength={80}
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
                            const msgId = selectedMessageForReaction.id;
                            setSelectedMessageForReaction(null);
                            setTimeout(() => {
                              handleDeleteMessage(msgId);
                            }, 100);
                          }
                        }}
                      >
                        <Trash2 color="#FF0055" size={16} style={{ marginRight: 8 }} />
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
                            const msg = selectedMessageForReaction;
                            setSelectedMessageForReaction(null);
                            setTimeout(() => {
                              handleReportMessage(msg);
                            }, 100);
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
                            const uid = selectedMessageForReaction.user_id;
                            const uname = displayName(uid, selectedMessageForReaction.username);
                            setSelectedMessageForReaction(null);
                            setTimeout(() => {
                              handleHideUserPrompt(uid, uname);
                            }, 100);
                          }
                        }}
                      >
                        <Icons.UserX color="#FF0055" size={16} style={{ marginRight: 8 }} />
                        <Text style={[styles.deleteOptionText, { color: '#FF0055' }]}>Hide User</Text>
                      </TouchableOpacity>
                    </>
                  )}

                  {selectedMessageForReaction?.type === 'story_reaction' &&
                   selectedMessageForReaction?.storyData &&
                   selectedMessageForReaction.storyData.user_id !== user?.uid && (
                    <>
                      <View style={styles.reactionSeparator} />
                      <TouchableOpacity
                        style={styles.deleteOption}
                        onPress={() => {
                          if (selectedMessageForReaction) {
                            const msg = selectedMessageForReaction;
                            setSelectedMessageForReaction(null);
                            setTimeout(() => {
                              handleReportStory(msg);
                            }, 100);
                          }
                        }}
                      >
                        <Icons.AlertTriangle color="#FFD700" size={16} style={{ marginRight: 8 }} />
                        <Text style={[styles.deleteOptionText, { color: '#FFD700' }]}>Report Story</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        {/* Full-screen viewer for camera messages */}
        <Modal
          visible={!!mediaViewer}
          transparent={false}
          animationType="fade"
          onRequestClose={() => setMediaViewer(null)}
          statusBarTranslucent={true}
        >
          <View style={styles.mediaViewerContainer}>
            {mediaViewer?.mediaType === 'video' ? (
              <Video
                source={{ uri: mediaViewer.url }}
                style={styles.mediaViewerContent}
                resizeMode={ResizeMode.CONTAIN}
                shouldPlay
                isLooping
                useNativeControls
              />
            ) : mediaViewer ? (
              <Image
                source={{ uri: mediaViewer.url }}
                style={styles.mediaViewerContent}
                resizeMode="contain"
              />
            ) : null}
            <TouchableOpacity
              style={[styles.mediaViewerClose, { top: insets.top + 12 }]}
              onPress={() => setMediaViewer(null)}
            >
              <X color="#FFF" size={24} />
            </TouchableOpacity>
          </View>
        </Modal>

        <StoryViewer
          isVisible={isStoryViewerVisible}
          onClose={() => {
            setIsStoryViewerVisible(false);
            setSelectedStoryForViewer([]);
          }}
          stories={selectedStoryForViewer}
          venueName={venueName}
          canAddStory={false}
          onAddStory={() => {}}
        />
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
  listArea: {
    flex: 1,
  },
  swipeEdgeStrip: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: 40,
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
    gap: 12,
  },
  headerTitleGroup: {
    flex: 1,
    minWidth: 0,
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
    flexShrink: 0,
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
  unreadDividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 14,
    gap: 10,
  },
  unreadDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(0, 255, 204, 0.35)',
  },
  unreadDividerText: {
    color: '#00FFCC',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
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
    flexShrink: 1,
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
    backgroundColor: '#1A1A1A',
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
    backgroundColor: '#1A1A1A',
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
    backgroundColor: '#1A1A1A',
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
    color: '#FF0055',
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
    // Cap the name so it can't squeeze the quoted text down to nothing.
    flexShrink: 1,
    maxWidth: '50%',
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
  
  // Simulated-persona roster bar
  simPersonaBar: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#1A1626',
    borderBottomWidth: 1,
    borderBottomColor: '#2F1A4A',
  },
  simPersonaLabel: {
    color: '#9A8FB0',
    fontSize: 12,
    marginBottom: 6,
  },
  simPersonaName: {
    color: '#00FFCC',
    fontSize: 13,
    fontWeight: '700',
  },
  simPersonaChips: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: 8,
  },
  simPersonaChip: {
    backgroundColor: '#241B36',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#3A2A55',
  },
  simPersonaChipActive: {
    backgroundColor: '#00FFCC',
    borderColor: '#00FFCC',
  },
  simPersonaChipText: {
    color: '#9A8FB0',
    fontSize: 12,
    fontWeight: '600',
  },
  simPersonaChipTextActive: {
    color: '#120D1A',
    fontWeight: '700',
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
  iconButton: {
    // Explicit 44x44 — Apple/Android minimum touch target — so the whole icon is
    // pressable rather than just the glyph's bounding box.
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  customStickerImage: {
    width: 100,
    height: 100,
    borderRadius: 8,
  },

  // 📸 Camera message styles
  mediaBubble: {
    padding: 6,
    borderRadius: 20,
  },
  myMediaBubble: {
    backgroundColor: '#FF00CC',
    borderBottomRightRadius: 4,
  },
  otherMediaBubble: {
    backgroundColor: '#333',
    borderBottomLeftRadius: 4,
  },
  mediaFrame: {
    width: 200,
    height: 260,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#111',
    position: 'relative',
  },
  mediaImage: {
    width: '100%',
    height: '100%',
  },
  mediaPlayBadge: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 44,
    height: 44,
    borderRadius: 22,
    marginLeft: -22,
    marginTop: -22,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaTypePill: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  mediaTypePillText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '600',
  },
  mediaViewerContainer: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaViewerContent: {
    width: '100%',
    height: '100%',
  },
  mediaViewerClose: {
    position: 'absolute',
    right: 16,
    padding: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 20,
  },
  storyReactionBubble: {
    padding: 10,
    borderRadius: 16,
    borderWidth: 1,
    minWidth: 220,
    maxWidth: 280,
  },
  myStoryReactionBubble: {
    backgroundColor: 'rgba(255, 0, 204, 0.12)',
    borderColor: 'rgba(255, 0, 204, 0.35)',
    borderBottomRightRadius: 4,
  },
  otherStoryReactionBubble: {
    backgroundColor: 'rgba(0, 255, 204, 0.1)',
    borderColor: 'rgba(0, 255, 204, 0.3)',
    borderBottomLeftRadius: 4,
  },
  storyReactionContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  storyThumbnailContainer: {
    width: 50,
    height: 50,
    borderRadius: 10,
    overflow: 'hidden',
    marginRight: 12,
    backgroundColor: '#222',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    position: 'relative',
  },
  storyThumbnail: {
    width: '100%',
    height: '100%',
  },
  playIconOverlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#FFF',
    marginLeft: -9,
    marginTop: -9,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 2,
  },
  storyReactionDetails: {
    flex: 1,
    justifyContent: 'center',
  },
  storyReactionText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  tapToViewContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  tapToViewText: {
    color: '#00FFCC',
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  storyReactionTime: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 9,
    marginTop: 6,
    alignSelf: 'flex-end',
  }
});
