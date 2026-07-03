import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  Pressable,
  Image,
  Dimensions,
  Text,
  Animated,
  ActivityIndicator,
  Alert,
  PanResponder,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Video, ResizeMode, Audio } from 'expo-av';
import { X, Plus, ArrowLeft, User as UserIcon, Trash2, Flag, UserX } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StoryData } from '../services/storyService';
import { fetchUsername, hideUser } from '../services/userService';
import { ACHIEVEMENTS } from '../services/achievementService';
import { useAppStore } from '../hooks/useAppStore';
import { createReport } from '../services/reportService';
import Toast from 'react-native-toast-message';
import * as Icons from 'lucide-react-native';
import { useCachedMedia } from '../hooks/useCachedMedia';
import { prefetchStoriesMedia } from '../utils/mediaCache';
import { ref, push, set } from 'firebase/database';
import { realtimeDB } from '../services/firebase';

interface StoryViewerProps {
  isVisible: boolean;
  onClose: () => void;
  stories: StoryData[];
  venueName?: string;
  canAddStory: boolean;
  onAddStory: () => void;
  /** When provided, a "Remove Story" button is shown and this callback is invoked with the story id */
  onRemoveStory?: (storyId: string) => void;
  onStoriesEnd?: () => void;
}

interface StoryMediaItemProps {
  story: StoryData;
  isActive: boolean;
  isPaused: boolean;
  isVisible: boolean;
  onImageLoad: () => void;
  onVideoUpdate: (status: any) => void;
  onVideoError: () => void;
}

const StoryMediaItem: React.FC<StoryMediaItemProps> = ({
  story,
  isActive,
  isPaused,
  isVisible,
  onImageLoad,
  onVideoUpdate,
  onVideoError,
}) => {
  const { cachedUri } = useCachedMedia(story.media_url);

  if (!cachedUri) {
    return (
      <View style={styles.loadingOverlay}>
        <ActivityIndicator color="#FFFFFF" size="large" />
      </View>
    );
  }

  if (story.media_type === 'video') {
    return (
      <Video
        key={`video_${story.id}`}
        source={{ uri: cachedUri }}
        style={StyleSheet.absoluteFillObject}
        resizeMode={ResizeMode.CONTAIN}
        shouldPlay={isActive && !isPaused && isVisible}
        isLooping={false}
        volume={1.0}
        isMuted={false}
        progressUpdateIntervalMillis={100}
        onPlaybackStatusUpdate={(status) => {
          if (isActive) {
            onVideoUpdate(status);
          }
        }}
        onError={onVideoError}
      />
    );
  } else {
    return (
      <Image
        key={`img_${story.id}`}
        source={{ uri: cachedUri }}
        style={StyleSheet.absoluteFillObject}
        resizeMode="contain"
        onLoad={onImageLoad}
        onError={onVideoError}
      />
    );
  }
};

interface FloatingReaction {
  id: number;
  emoji: string;
  x: number;
}

const FloatingReactionItem: React.FC<{
  emoji: string;
  startX: number;
  onAnimationEnd: () => void;
}> = ({ emoji, startX, onAnimationEnd }) => {
  const animValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(animValue, {
      toValue: 1,
      duration: 2000,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        onAnimationEnd();
      }
    });
  }, [animValue, onAnimationEnd]);

  const translateY = animValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -320],
  });

  const translateX = animValue.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: [0, 15, -15, 10, 0],
  });

  const opacity = animValue.interpolate({
    inputRange: [0, 0.8, 1],
    outputRange: [1, 1, 0],
  });

  const scale = animValue.interpolate({
    inputRange: [0, 0.1, 0.8, 1],
    outputRange: [0.6, 1.3, 1.1, 0.6],
  });

  return (
    <Animated.View
      style={{
        position: 'absolute',
        bottom: 90,
        left: startX,
        opacity,
        transform: [{ translateY }, { translateX }, { scale }],
        zIndex: 99,
      }}
      pointerEvents="none"
    >
      <Text style={{ fontSize: 32 }}>{emoji}</Text>
    </Animated.View>
  );
};

const { width, height } = Dimensions.get('window');
const IMAGE_DURATION_MS = 5000;

export const StoryViewer: React.FC<StoryViewerProps> = ({
  isVisible,
  onClose,
  stories,
  venueName,
  canAddStory,
  onAddStory,
  onRemoveStory,
  onStoriesEnd,
}) => {
  const insets = useSafeAreaInsets();
  const user = useAppStore((s) => s.user);
  const hiddenUsers = useAppStore((s) => s.hiddenUsers);
  const setHiddenUsers = useAppStore((s) => s.setHiddenUsers);

  const [shouldRender, setShouldRender] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const storiesSerialized = stories.map(s => s.id).join(',');
  const [isPaused, setIsPaused] = useState(false);
  const [isMediaLoading, setIsMediaLoading] = useState(true);
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
  const nextUniqueId = useRef(0);

  // Username cache per-session (avoids re-fetching same uid)
  const [usernameMap, setUsernameMap] = useState<Record<string, string>>({});

  const progressAnim = useRef(new Animated.Value(0)).current;
  const progressValue = useRef(0);
  const imageTimerRef = useRef<ReturnType<typeof Animated.timing> | null>(null);
  const videoTimerRef = useRef<ReturnType<typeof Animated.timing> | null>(null);
  const videoRef = useRef<Video>(null);

  const currentStory = stories.length > 0 ? stories[currentIndex] : null;
  const { cachedUri: currentStoryUri } = useCachedMedia(currentStory?.media_url);

  // Gesture and transition animations
  const translateY = useRef(new Animated.Value(0)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const [transitioningIndex, setTransitioningIndex] = useState<number | null>(null);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Trigger drag down only when vertical drag is significant and dragging downward
        return gestureState.dy > 5 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx);
      },
      onPanResponderGrant: () => {
        setIsPaused(true);
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          translateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 120 || gestureState.vy > 0.5) {
          Animated.timing(translateY, {
            toValue: height,
            duration: 250,
            useNativeDriver: true,
          }).start(() => {
            onClose();
          });
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
          }).start(() => {
            setIsPaused(false);
          });
        }
      },
    })
  ).current;

  // Defer rendering until transition is finished
  useEffect(() => {
    if (isVisible) {
      const timer = setTimeout(() => {
        setShouldRender(true);
      }, 300);
      return () => clearTimeout(timer);
    } else {
      setShouldRender(false);
    }
  }, [isVisible]);

  // Prefetch stories media when viewer opens
  useEffect(() => {
    if (isVisible && stories.length > 0 && shouldRender) {
      const mediaUrls = stories.map(s => s.media_url).filter(Boolean);
      prefetchStoriesMedia(mediaUrls);
    }
  }, [isVisible, stories, shouldRender]);

  // ─── Prefetch usernames for all stories at once ──────────────────────────
  useEffect(() => {
    if (!isVisible || stories.length === 0 || !shouldRender) return;
    const uniqueIds = [...new Set(stories.map(s => s.user_id))];
    uniqueIds.forEach(uid => {
      if (!usernameMap[uid]) {
        fetchUsername(uid).then(name => {
          setUsernameMap(prev => ({ ...prev, [uid]: name }));
        });
      }
    });
  }, [isVisible, stories, shouldRender]);

  // ─── Pre-resolve: current story's username ───────────────────────────────
  const currentUsername = currentStory
    ? (usernameMap[currentStory.user_id] ?? '')
    : '';

  // ─── Audio session: override iOS silent switch when viewer opens ────────
  useEffect(() => {
    if (isVisible && shouldRender) {
      Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        allowsRecordingIOS: false,
        staysActiveInBackground: false,
        shouldDuckAndroid: false,
      }).catch(() => {});
    } else {
      Audio.setAudioModeAsync({
        playsInSilentModeIOS: false,
        allowsRecordingIOS: false,
      }).catch(() => {});
    }
  }, [isVisible, shouldRender]);

  // ─── Reset on open ───────────────────────────────────────────────────────
  useEffect(() => {
    if (isVisible) {
      translateY.setValue(height);
      Animated.timing(translateY, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
      setCurrentIndex(0);
      setIsPaused(false);
      setIsMediaLoading(true);
      progressAnim.setValue(0);
      progressValue.current = 0;
      setFloatingReactions([]);
    } else {
      if (imageTimerRef.current) {
        imageTimerRef.current.stop();
        imageTimerRef.current = null;
      }
      if (videoTimerRef.current) {
        videoTimerRef.current.stop();
        videoTimerRef.current = null;
      }
    }
  }, [isVisible]);

  // ─── Progress listener ───────────────────────────────────────────────────
  useEffect(() => {
    const listener = progressAnim.addListener(({ value }) => {
      progressValue.current = value;
    });
    return () => progressAnim.removeListener(listener);
  }, []);

  // Reset index when stories list changes (e.g. switching to next venue)
  useEffect(() => {
    setCurrentIndex(0);
  }, [storiesSerialized]);

  // ─── Per-story reset ─────────────────────────────────────────────────────
  useEffect(() => {
    if (imageTimerRef.current) {
      imageTimerRef.current.stop();
      imageTimerRef.current = null;
    }
    if (videoTimerRef.current) {
      videoTimerRef.current.stop();
      videoTimerRef.current = null;
    }
    progressAnim.setValue(0);
    progressValue.current = 0;
    setIsPaused(false);
    setIsMediaLoading(true);
  }, [currentIndex, storiesSerialized]);

  // ─── Image pause/resume ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isVisible || !currentStory || currentStory.media_type !== 'image') return;

    if (isPaused) {
      if (imageTimerRef.current) {
        imageTimerRef.current.stop();
        imageTimerRef.current = null;
      }
    } else if (progressValue.current > 0) {
      const remaining = IMAGE_DURATION_MS * (1 - progressValue.current);
      const anim = Animated.timing(progressAnim, {
        toValue: 1,
        duration: remaining,
        useNativeDriver: false,
      });
      imageTimerRef.current = anim;
      anim.start(({ finished }) => {
        if (finished) handleNext();
      });
    }
  }, [isPaused]);

  // ─── Video pause/resume ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isVisible || !currentStory || currentStory.media_type !== 'video') return;

    if (isPaused) {
      if (videoTimerRef.current) {
        videoTimerRef.current.stop();
        videoTimerRef.current = null;
      }
    }
  }, [isPaused]);

  // ─── Navigation ─────────────────────────────────────────────────────────
  const handleNext = useCallback(() => {
    if (currentIndex < stories.length - 1) {
      setIsPaused(true);
      setTransitioningIndex(currentIndex + 1);
      Animated.timing(translateX, {
        toValue: -width,
        duration: 300,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setCurrentIndex(prev => prev + 1);
          translateX.setValue(0);
          setTransitioningIndex(null);
        }
      });
    } else {
      if (onStoriesEnd) {
        onStoriesEnd();
      } else {
        onClose();
      }
    }
  }, [currentIndex, stories.length, onClose, translateX, onStoriesEnd]);

  const handlePrev = useCallback(() => {
    if (currentIndex > 0) {
      setIsPaused(true);
      setTransitioningIndex(currentIndex - 1);
      Animated.timing(translateX, {
        toValue: width,
        duration: 300,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setCurrentIndex(prev => prev - 1);
          translateX.setValue(0);
          setTransitioningIndex(null);
        }
      });
    }
  }, [currentIndex, translateX]);

  // ─── Image loaded → start timer ──────────────────────────────────────────
  const handleImageLoad = useCallback(() => {
    setIsMediaLoading(false);
    progressAnim.setValue(0);
    const anim = Animated.timing(progressAnim, {
      toValue: 1,
      duration: IMAGE_DURATION_MS,
      useNativeDriver: false,
    });
    imageTimerRef.current = anim;
    anim.start(({ finished }) => {
      if (finished && !isPaused) handleNext();
    });
  }, [isPaused, handleNext]);

  // ─── Video playback status ───────────────────────────────────────────────
  const handleVideoUpdate = useCallback((status: any) => {
    if (!status.isLoaded) return;

    // Handle buffering state
    if (status.isBuffering) {
      setIsMediaLoading(true);
      if (videoTimerRef.current) {
        videoTimerRef.current.stop();
        videoTimerRef.current = null;
      }
      return;
    } else if (status.isPlaying && isMediaLoading) {
      setIsMediaLoading(false);
    }

    if (status.didJustFinish) {
      if (videoTimerRef.current) {
        videoTimerRef.current.stop();
        videoTimerRef.current = null;
      }
      handleNext();
    } else if (!isPaused && status.durationMillis) {
      const progress = status.positionMillis / status.durationMillis;
      
      // Stop previous progress animation before starting the next transition slice
      if (videoTimerRef.current) {
        videoTimerRef.current.stop();
      }
      
      // Animate smoothly to the current playback position over 100ms
      const anim = Animated.timing(progressAnim, {
        toValue: Math.min(progress, 1),
        duration: 100,
        useNativeDriver: false,
      });
      videoTimerRef.current = anim;
      anim.start();
    } else if (isPaused) {
      if (videoTimerRef.current) {
        videoTimerRef.current.stop();
        videoTimerRef.current = null;
      }
    }
  }, [isPaused, handleNext, isMediaLoading]);

  // ─── Helpers ─────────────────────────────────────────────────────────────
  const calculateHoursAgo = (timestamp: any) => {
    if (!timestamp) return 0;
    let ms = 0;
    if (typeof timestamp.toDate === 'function') {
      ms = timestamp.toDate().getTime();
    } else if (typeof timestamp === 'number') {
      ms = timestamp;
    } else if (timestamp.seconds !== undefined) {
      ms = timestamp.seconds * 1000;
    } else if (typeof timestamp === 'string') {
      ms = Date.parse(timestamp);
    } else {
      return 0;
    }
    const diff = Date.now() - ms;
    return Math.max(0, Math.floor(diff / 3600000));
  };

  // ─── Remove story ────────────────────────────────────────────────────────
  const handleRemoveStory = useCallback(() => {
    if (!currentStory?.id || !onRemoveStory) return;
    Alert.alert(
      'Remove Story',
      'Are you sure you want to delete this story? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            onRemoveStory(currentStory.id!);
            // If this was the last story, close the viewer
            if (stories.length <= 1) {
              onClose();
            } else if (currentIndex >= stories.length - 1) {
              setCurrentIndex(prev => prev - 1);
            }
          },
        },
      ]
    );
  }, [currentStory, onRemoveStory, stories.length, currentIndex, onClose]);

  const handleReactToStory = async (emoji: string, index: number) => {
    if (!user || !currentStory?.venue_id) return;

    // Add floating reaction instantly for immediate feedback!
    const containerWidth = width - 40 - (canAddStory ? 56 : 0);
    const buttonWidth = containerWidth / 6;
    const startX = 20 + (canAddStory ? 56 : 0) + index * buttonWidth + buttonWidth / 2 - 16;
    
    const reactionId = nextUniqueId.current++;
    setFloatingReactions(prev => [...prev, { id: reactionId, emoji, x: startX }]);

    // Temporarily pause the story while sending reaction
    setIsPaused(true);

    try {
      const senderName = await fetchUsername(user.uid);
      const chatRef = ref(realtimeDB, `venue_chats/${currentStory.venue_id}`);
      const newMessageRef = push(chatRef);

      const displayAuthor = currentUsername || 'someone';

      const createdAtVal = currentStory.created_at ? (
        typeof currentStory.created_at.toDate === 'function' 
          ? currentStory.created_at.toDate().getTime()
          : (currentStory.created_at.seconds !== undefined ? currentStory.created_at.seconds * 1000 : Date.now())
      ) : Date.now();

      const expiresAtVal = currentStory.expires_at ? (
        typeof currentStory.expires_at.toDate === 'function'
          ? currentStory.expires_at.toDate().getTime()
          : (currentStory.expires_at.seconds !== undefined ? currentStory.expires_at.seconds * 1000 : Date.now() + 24 * 3600 * 1000)
      ) : Date.now() + 24 * 3600 * 1000;

      await set(newMessageRef, {
        user_id: user.uid,
        username: senderName,
        message: `Reacted ${emoji} to ${displayAuthor}'s story`,
        type: 'story_reaction',
        timestamp: Date.now(),
        reactions: {
          [emoji]: {
            [user.uid]: senderName
          }
        },
        storyData: {
          id: currentStory.id || '',
          media_url: currentStory.media_url,
          media_type: currentStory.media_type,
          user_id: currentStory.user_id,
          username: displayAuthor,
          created_at: createdAtVal,
          expires_at: expiresAtVal,
          venue_id: currentStory.venue_id,
          activeBadge: currentStory.activeBadge || ''
        }
      });

      // Briefly show success notification
      Toast.show({
        type: 'success',
        text1: `Reacted ${emoji}`,
        text2: 'Reaction sent to chat room!',
        position: 'top',
        visibilityTime: 1500,
      });

      // Resume story playback after a short delay
      setTimeout(() => {
        setIsPaused(false);
      }, 1000);

    } catch (err) {
      console.warn('[StoryViewer] Failed to send story reaction:', err);
      Toast.show({
        type: 'error',
        text1: 'Reaction Failed',
        text2: 'Could not deliver reaction to chat.',
      });
      setIsPaused(false);
    }
  };

  const handleHideUserPrompt = (targetUserId: string, username: string) => {
    setIsPaused(true);
    Alert.alert(
      "Hide User",
      `Are you sure you want to hide ${username}? Content from this user will no longer be shown to you.`,
      [
        { text: "Cancel", style: "cancel", onPress: () => setIsPaused(false) },
        {
          text: "Hide User",
          style: "destructive",
          onPress: async () => {
            try {
              onClose();
              await hideUser(user!.uid, targetUserId);
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
              setIsPaused(false);
            }
          }
        }
      ]
    );
  };

  const handleReportStory = () => {
    if (!user || !currentStory?.id) return;

    setIsPaused(true);
    Alert.alert(
      "Report Story",
      "Why are you reporting this story?",
      [
        { text: "Cancel", style: "cancel", onPress: () => setIsPaused(false) },
        { 
          text: "Inappropriate Content", 
          onPress: () => submitStoryReport("Inappropriate Content")
        },
        { 
          text: "Harassment / Bullying", 
          onPress: () => submitStoryReport("Harassment or Bullying")
        },
        { 
          text: "Spam / Scams", 
          onPress: () => submitStoryReport("Spam or scams")
        },
        { 
          text: "Hate Speech", 
          onPress: () => submitStoryReport("Hate Speech")
        }
      ]
    );
  };

  const submitStoryReport = async (reason: string) => {
    if (!user || !currentStory?.id) return;
    try {
      await createReport(
        user.uid,
        currentStory.user_id,
        'post',
        currentStory.id,
        currentStory.media_url,
        currentStory.venue_id || undefined,
        reason
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
    } finally {
      setIsPaused(false);
    }
  };

  // ─── Progress bar interpolations (memoised per story count) ──────────────
  const progressInterpolation = useMemo(() =>
    progressAnim.interpolate({
      inputRange: [0, 1],
      outputRange: ['0%', '100%'],
      extrapolate: 'clamp',
    }),
    [progressAnim]
  );

  // Safe-area aware top offset for header elements
  const headerTop = Math.max(insets.top, 12);

  // ─── Render ──────────────────────────────────────────────────────────────
  const backdropOpacity = translateY.interpolate({
    inputRange: [0, height],
    outputRange: ['rgba(0,0,0,0.9)', 'rgba(0,0,0,0)'],
    extrapolate: 'clamp',
  });

  return (
    <Modal visible={isVisible} animationType="none" transparent statusBarTranslucent>
      <Animated.View style={[styles.modalOverlay, { backgroundColor: backdropOpacity }]}>
        <Animated.View
          style={[styles.container, { transform: [{ translateY }] }]}
          {...panResponder.panHandlers}
        >
          {!shouldRender ? (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator color="#FFFFFF" size="large" />
            </View>
          ) : stories.length === 0 ? (
            /* ── Empty state ─────────────────────────────── */
            <View style={styles.emptyContainer}>
              <Pressable
                style={[styles.backButtonAbsolute, { top: headerTop }]}
                onPress={onClose}
              >
                <ArrowLeft color="#FFF" size={28} />
              </Pressable>
              <Text style={styles.emptyText}>No stories here yet.</Text>
              {canAddStory && (
                <Pressable style={styles.addButtonLarge} onPress={onAddStory}>
                  <Plus color="#000" size={24} />
                  <Text style={styles.addButtonText}>Be the first to add a story!</Text>
                </Pressable>
              )}
            </View>

          ) : currentStory ? (
            <>
              {/* ── Media layer ───────────────────────────── */}
              <Animated.View style={[StyleSheet.absoluteFillObject, { transform: [{ translateX }] }]}>
                {/* Current Story Media */}
                <View style={StyleSheet.absoluteFillObject}>
                  <StoryMediaItem
                    story={currentStory}
                    isActive={transitioningIndex === null}
                    isPaused={isPaused}
                    isVisible={isVisible}
                    onImageLoad={handleImageLoad}
                    onVideoUpdate={handleVideoUpdate}
                    onVideoError={() => {
                      setIsMediaLoading(false);
                      handleNext();
                    }}
                  />
                </View>

                {/* Transitioning Story Media */}
                {transitioningIndex !== null && stories[transitioningIndex] && (
                  <View style={[StyleSheet.absoluteFillObject, { left: transitioningIndex > currentIndex ? width : -width }]}>
                    <StoryMediaItem
                      story={stories[transitioningIndex]}
                      isActive={true}
                      isPaused={true}
                      isVisible={isVisible}
                      onImageLoad={() => {}}
                      onVideoUpdate={() => {}}
                      onVideoError={() => {}}
                    />
                  </View>
                )}
              </Animated.View>

              {/* Floating Reactions Overlay */}
              {floatingReactions.map(reaction => (
                <FloatingReactionItem
                  key={reaction.id}
                  emoji={reaction.emoji}
                  startX={reaction.x}
                  onAnimationEnd={() => {
                    setFloatingReactions(prev => prev.filter(r => r.id !== reaction.id));
                  }}
                />
              ))}

              {/* ── Loading spinner (shown while media buffers or cache resolves) ── */}
              {(isMediaLoading || !currentStoryUri) && transitioningIndex === null && (
                <View style={styles.loadingOverlay}>
                  <ActivityIndicator color="#FFFFFF" size="large" />
                </View>
              )}

              {/* ── Touch zones (prev / next) ─────────────── */}
              <View style={styles.interactionLayer}>
                <Pressable
                  style={styles.leftTapZone}
                  onPressIn={() => setIsPaused(true)}
                  onPressOut={() => setIsPaused(false)}
                  onPress={handlePrev}
                />
                <Pressable
                  style={styles.rightTapZone}
                  onPressIn={() => setIsPaused(true)}
                  onPressOut={() => setIsPaused(false)}
                  onPress={handleNext}
                />
              </View>

              {/* ── Top gradient ──────────────────────────── */}
              <LinearGradient
                colors={['rgba(0,0,0,0.75)', 'transparent']}
                style={styles.topGradient}
                pointerEvents="none"
              />

              {/* ── Header (progress + metadata) ─────────── */}
              {/* Uses safe-area inset so it's never hidden behind notch/island */}
              <View style={[styles.headerContainer, { paddingTop: headerTop }]} pointerEvents="box-none">
                {/* Progress bars */}
                <View style={styles.progressContainer}>
                  {stories.map((_, index) => {
                    let widthValue: any;
                    if (index < currentIndex) widthValue = '100%';
                    else if (index === currentIndex) widthValue = progressInterpolation;
                    else widthValue = '0%';

                    return (
                      <View key={index} style={styles.progressBarBackground}>
                        <Animated.View style={[styles.progressBarFill, { width: widthValue }]} />
                      </View>
                    );
                  })}
                </View>

                {/* Author + venue info */}
                <View style={styles.metadataLayout}>
                  <View style={styles.userInfoBlock}>
                    <View style={styles.avatar}>
                      <UserIcon color="#FFF" size={16} />
                    </View>
                    <View>
                      <View style={styles.usernameRow}>
                        {currentStory.activeBadge ? (() => {
                          const badgeObj = ACHIEVEMENTS.find(a => a.id === currentStory.activeBadge);
                          // @ts-ignore
                          const BadgeIcon = badgeObj ? Icons[badgeObj.iconName] : null;
                          if (!BadgeIcon || !badgeObj) return null;
                          return <BadgeIcon color={badgeObj.glowColor} size={14} style={{ marginRight: 6 }} />;
                        })() : null}
                        <Text style={styles.usernameText}>
                          {currentUsername || ' '}
                        </Text>
                      </View>
                      {venueName ? <Text style={styles.venueName}>{venueName}</Text> : null}
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={styles.timeBlock}>
                      <Text style={styles.timeText}>{calculateHoursAgo(currentStory.created_at)}h</Text>
                    </View>
                    {user && currentStory.user_id !== user.uid && (
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <Pressable
                          style={{ padding: 6, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 16 }}
                          onPress={() => handleHideUserPrompt(currentStory.user_id, currentUsername)}
                        >
                          <UserX color="#FFF" size={16} />
                        </Pressable>
                        <Pressable
                          style={{ padding: 6, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 16 }}
                          onPress={handleReportStory}
                        >
                          <Flag color="#FFF" size={16} />
                        </Pressable>
                      </View>
                    )}
                  </View>
                </View>
              </View>



              {/* ── Bottom controls row (unified layout for Add/Remove/React actions) ── */}
              <View style={[
                styles.bottomControlsContainer, 
                { 
                  bottom: Math.max(insets.bottom, 20),
                  justifyContent: (canAddStory || currentStory.user_id !== user?.uid) ? 'space-between' : 'center'
                }
              ]}>
                {canAddStory && (
                  <Pressable style={styles.addButtonFloating} onPress={onAddStory}>
                    <Plus color="#000" size={22} />
                  </Pressable>
                )}

                {currentStory.user_id === user?.uid ? (
                  onRemoveStory && (
                    <Pressable
                      style={styles.removeButtonInline}
                      onPress={handleRemoveStory}
                    >
                      <Trash2 color="#FF3B30" size={16} style={{ marginRight: 6 }} />
                      <Text style={styles.removeButtonText}>Remove Story</Text>
                    </Pressable>
                  )
                ) : (
                  <View style={[styles.reactionContainer, { marginLeft: canAddStory ? 12 : 0 }]}>
                    {['❤️', '🔥', '😂', '👍', '😮', '🍻'].map((emoji, index) => (
                      <TouchableOpacity
                        key={emoji}
                        style={styles.reactionButton}
                        onPress={() => handleReactToStory(emoji, index)}
                        activeOpacity={0.6}
                      >
                        <Text style={styles.reactionEmojiText}>{emoji}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            </>
          ) : null}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
  },
  container: {
    flex: 1,
    backgroundColor: '#000',
    overflow: 'hidden',
  },

  // ── Empty state ────────────────────────────────────────────────────────────
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyText: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 20,
  },
  addButtonLarge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#00FFCC',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    gap: 8,
  },
  addButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
  },

  // ── Media loading spinner ─────────────────────────────────────────────────
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    zIndex: 10,
  },

  // ── Touch zones ───────────────────────────────────────────────────────────
  interactionLayer: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    zIndex: 1,
  },
  leftTapZone: { flex: 0.35, height: '100%' },
  rightTapZone: { flex: 0.65, height: '100%' },

  // ── Gradient + header ─────────────────────────────────────────────────────
  topGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 200,
    zIndex: 2,
  },
  headerContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    // paddingTop is set dynamically via insets
    zIndex: 3,
  },
  progressContainer: {
    flexDirection: 'row',
    gap: 4,
    height: 3,
    marginBottom: 14,
  },
  progressBarBackground: {
    flex: 1,
    height: '100%',
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#FFF',
    borderRadius: 2,
  },

  // ── Metadata ──────────────────────────────────────────────────────────────
  metadataLayout: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  userInfoBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  usernameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FFF',
  },
  usernameText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '800',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  venueName: {
    color: '#00FFCC',
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.9,
  },
  timeBlock: { opacity: 0.8 },
  timeText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },



  // ── Back button (empty state) ──────────────────────────────────────────────
  backButtonAbsolute: {
    position: 'absolute',
    left: 16,
    zIndex: 4,
    padding: 8,
  },

  // ── Bottom controls row (unified layout) ──────────────────────────────────
  bottomControlsContainer: {
    position: 'absolute',
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 5,
  },
  addButtonFloating: {
    backgroundColor: '#00FFCC',
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#00FFCC',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  removeButtonInline: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 59, 48, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 59, 48, 0.3)',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 22,
  },
  removeButtonText: {
    color: '#FF3B30',
    fontSize: 14,
    fontWeight: '600',
  },
  reactionContainer: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  reactionButton: {
    padding: 6,
  },
  reactionEmojiText: {
    fontSize: 20,
  },
});
