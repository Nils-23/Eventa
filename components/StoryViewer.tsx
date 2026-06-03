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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Video, ResizeMode, Audio } from 'expo-av';
import { X, Plus, ArrowLeft, User as UserIcon, Trash2, Flag } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StoryData } from '../services/storyService';
import { fetchUsername } from '../services/userService';
import { ACHIEVEMENTS } from '../services/achievementService';
import { useAppStore } from '../hooks/useAppStore';
import { createReport } from '../services/reportService';
import Toast from 'react-native-toast-message';
import * as Icons from 'lucide-react-native';

interface StoryViewerProps {
  isVisible: boolean;
  onClose: () => void;
  stories: StoryData[];
  venueName?: string;
  canAddStory: boolean;
  onAddStory: () => void;
  /** When provided, a "Remove Story" button is shown and this callback is invoked with the story id */
  onRemoveStory?: (storyId: string) => void;
}

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
}) => {
  const insets = useSafeAreaInsets();
  const { user } = useAppStore();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isMediaLoading, setIsMediaLoading] = useState(true);

  // Username cache per-session (avoids re-fetching same uid)
  const [usernameMap, setUsernameMap] = useState<Record<string, string>>({});

  const progressAnim = useRef(new Animated.Value(0)).current;
  const progressValue = useRef(0);
  const imageTimerRef = useRef<ReturnType<typeof Animated.timing> | null>(null);
  const videoRef = useRef<Video>(null);

  const currentStory = stories.length > 0 ? stories[currentIndex] : null;

  // ─── Prefetch usernames for all stories at once ──────────────────────────
  useEffect(() => {
    if (!isVisible || stories.length === 0) return;
    const uniqueIds = [...new Set(stories.map(s => s.user_id))];
    uniqueIds.forEach(uid => {
      if (!usernameMap[uid]) {
        fetchUsername(uid).then(name => {
          setUsernameMap(prev => ({ ...prev, [uid]: name }));
        });
      }
    });
  }, [isVisible, stories]);

  // ─── Pre-resolve: current story's username ───────────────────────────────
  const currentUsername = currentStory
    ? (usernameMap[currentStory.user_id] ?? '')
    : '';

  // ─── Audio session: override iOS silent switch when viewer opens ────────
  useEffect(() => {
    if (isVisible) {
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
  }, [isVisible]);

  // ─── Reset on open ───────────────────────────────────────────────────────
  useEffect(() => {
    if (isVisible) {
      setCurrentIndex(0);
      setIsPaused(false);
      setIsMediaLoading(true);
      progressAnim.setValue(0);
      progressValue.current = 0;
    }
  }, [isVisible]);

  // ─── Progress listener ───────────────────────────────────────────────────
  useEffect(() => {
    const listener = progressAnim.addListener(({ value }) => {
      progressValue.current = value;
    });
    return () => progressAnim.removeListener(listener);
  }, []);

  // ─── Per-story reset ─────────────────────────────────────────────────────
  useEffect(() => {
    if (imageTimerRef.current) {
      imageTimerRef.current.stop();
      imageTimerRef.current = null;
    }
    progressAnim.setValue(0);
    progressValue.current = 0;
    setIsPaused(false);
    setIsMediaLoading(true);
  }, [currentIndex]);

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

  // ─── Navigation ─────────────────────────────────────────────────────────
  const handleNext = useCallback(() => {
    if (currentIndex < stories.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      onClose();
    }
  }, [currentIndex, stories.length, onClose]);

  const handlePrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  }, [currentIndex]);

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

    if (status.isPlaying && isMediaLoading) {
      setIsMediaLoading(false);
    }

    if (status.didJustFinish) {
      handleNext();
    } else if (!isPaused && status.durationMillis) {
      const progress = status.positionMillis / status.durationMillis;
      progressAnim.setValue(Math.min(progress, 1));
    }
  }, [isPaused, handleNext, isMediaLoading]);

  // ─── Helpers ─────────────────────────────────────────────────────────────
  const calculateHoursAgo = (timestamp: any) => {
    if (!timestamp?.toDate) return 0;
    const diff = new Date().getTime() - timestamp.toDate().getTime();
    return Math.floor(diff / 3600000);
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
  return (
    <Modal visible={isVisible} animationType="fade" transparent={false} statusBarTranslucent>
      <View style={styles.container}>

        {stories.length === 0 ? (
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
            {currentStory.media_type === 'video' ? (
              <Video
                ref={videoRef}
                key={`video_${currentStory.id ?? currentIndex}`}
                source={{ uri: currentStory.media_url }}
                style={StyleSheet.absoluteFillObject}
                resizeMode={ResizeMode.COVER}
                shouldPlay={!isPaused && isVisible}
                isLooping={false}
                volume={1.0}
                isMuted={false}
                progressUpdateIntervalMillis={100}
                onPlaybackStatusUpdate={handleVideoUpdate}
                onError={() => {
                  setIsMediaLoading(false);
                  handleNext();
                }}
              />
            ) : (
              <Image
                key={`img_${currentStory.id ?? currentIndex}`}
                source={{ uri: currentStory.media_url }}
                style={StyleSheet.absoluteFillObject}
                resizeMode="cover"
                onLoad={handleImageLoad}
                onError={() => {
                  setIsMediaLoading(false);
                  handleNext();
                }}
              />
            )}

            {/* ── Loading spinner (shown while media buffers) ── */}
            {isMediaLoading && (
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
            <View style={[styles.headerContainer, { paddingTop: headerTop }]} pointerEvents="none">
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
                    <Pressable
                      style={{ padding: 6, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 16 }}
                      onPress={handleReportStory}
                    >
                      <Flag color="#FFF" size={16} />
                    </Pressable>
                  )}
                </View>
              </View>
            </View>

            {/* ── Close button (safe-area aware) ────────── */}
            <Pressable
              style={[styles.closeButtonAbsolute, { top: headerTop + 44 }]}
              onPress={onClose}
            >
              <X color="#FFF" size={28} />
            </Pressable>

            {/* ── Add Story button ──────────────────────── */}
            {canAddStory && (
              <View style={[styles.controlsRow, { bottom: Math.max(insets.bottom, 40) }]}>
                <Pressable style={styles.addButtonFloating} onPress={onAddStory}>
                  <Plus color="#000" size={24} />
                </Pressable>
              </View>
            )}

            {/* ── Remove Story button (shown only when onRemoveStory is provided) ── */}
            {onRemoveStory && (
              <Pressable
                style={[styles.removeButton, { bottom: Math.max(insets.bottom + 16, 40) }]}
                onPress={handleRemoveStory}
              >
                <Trash2 color="#FF3B30" size={18} />
                <Text style={styles.removeButtonText}>Remove Story</Text>
              </Pressable>
            )}
          </>
        ) : null}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
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

  // ── Close button ──────────────────────────────────────────────────────────
  closeButtonAbsolute: {
    position: 'absolute',
    right: 16,
    zIndex: 4,
    padding: 8,
  },

  // ── Back button (empty state) ──────────────────────────────────────────────
  backButtonAbsolute: {
    position: 'absolute',
    left: 16,
    zIndex: 4,
    padding: 8,
  },

  // ── Add Story button ──────────────────────────────────────────────────────
  controlsRow: {
    position: 'absolute',
    width: '100%',
    alignItems: 'center',
    zIndex: 4,
  },
  addButtonFloating: {
    backgroundColor: '#00FFCC',
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#00FFCC',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },

  // ── Remove Story button ───────────────────────────────────────────────────
  removeButton: {
    position: 'absolute',
    alignSelf: 'center',
    left: '50%',
    transform: [{ translateX: -80 }],
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,59,48,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,59,48,0.5)',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 30,
    zIndex: 5,
    width: 160,
    justifyContent: 'center',
  },
  removeButtonText: {
    color: '#FF3B30',
    fontSize: 15,
    fontWeight: '700',
  },
});
