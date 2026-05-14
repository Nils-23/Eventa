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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Video, ResizeMode, Audio } from 'expo-av';
import { X, Plus, ArrowLeft, User as UserIcon } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StoryData } from '../services/storyService';
import { fetchUsername } from '../services/userService';
import { ACHIEVEMENTS } from '../services/achievementService';
import * as Icons from 'lucide-react-native';

interface StoryViewerProps {
  isVisible: boolean;
  onClose: () => void;
  stories: StoryData[];
  venueName?: string;
  canAddStory: boolean;
  onAddStory: () => void;
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
}) => {
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
  // This runs once when the story list changes, so usernames are ready instantly
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
      // playsInSilentModeIOS: true makes audio play even when the device
      // ringer/silent switch is toggled off — required for story videos.
      Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        allowsRecordingIOS: false,
        staysActiveInBackground: false,
        shouldDuckAndroid: false,
      }).catch(() => {});
    } else {
      // Restore default audio behaviour when viewer closes
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
      // Resume from where we paused
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

  // ─── Progress bar interpolations (memoised per story count) ──────────────
  const progressInterpolation = useMemo(() =>
    progressAnim.interpolate({
      inputRange: [0, 1],
      outputRange: ['0%', '100%'],
      extrapolate: 'clamp',
    }),
    [progressAnim]
  );

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <Modal visible={isVisible} animationType="fade" transparent={false} statusBarTranslucent>
      <View style={styles.container}>

        {stories.length === 0 ? (
          /* ── Empty state ─────────────────────────────── */
          <View style={styles.emptyContainer}>
            <Pressable style={styles.backButtonAbsolute} onPress={onClose}>
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
                volume={1.0}          // ← explicit full volume, fixes muted videos
                isMuted={false}       // ← explicitly unmuted
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
            <SafeAreaView style={styles.headerContainer} pointerEvents="none" edges={['top']}>
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
                <View style={styles.timeBlock}>
                  <Text style={styles.timeText}>{calculateHoursAgo(currentStory.created_at)}h</Text>
                </View>
              </View>
            </SafeAreaView>

            {/* ── Add Story button ──────────────────────── */}
            {canAddStory && (
              <View style={styles.controlsRow}>
                <Pressable style={styles.addButtonFloating} onPress={onAddStory}>
                  <Plus color="#000" size={24} />
                </Pressable>
              </View>
            )}

            {/* ── Close button ──────────────────────────── */}
            <Pressable style={styles.closeButtonAbsolute} onPress={onClose}>
              <X color="#FFF" size={28} />
            </Pressable>
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
    height: 180,
    zIndex: 2,
  },
  headerContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    paddingTop: 8,
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

  // ── Controls ──────────────────────────────────────────────────────────────
  controlsRow: {
    position: 'absolute',
    bottom: 40,
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
  closeButtonAbsolute: {
    position: 'absolute',
    top: 56,
    right: 16,
    zIndex: 4,
    padding: 8,
  },
  backButtonAbsolute: {
    position: 'absolute',
    top: 56,
    left: 16,
    zIndex: 4,
    padding: 8,
  },
});
