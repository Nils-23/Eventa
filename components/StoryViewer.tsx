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
  TextInput,
  Keyboard,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Video, ResizeMode, Audio } from 'expo-av';
import { X, Plus, ArrowLeft, User as UserIcon, Trash2, Flag, UserX, Send } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StoryData } from '../services/storyService';
import { fetchUsername, hideUser } from '../services/userService';
import { ACHIEVEMENTS } from '../services/achievementService';
import { useAppStore } from '../hooks/useAppStore';
import { createReport } from '../services/reportService';
import Toast from 'react-native-toast-message';
import * as Icons from 'lucide-react-native';
import { useCachedMedia } from '../hooks/useCachedMedia';
import { prefetchStoriesMedia, getCachedMediaUriSync } from '../utils/mediaCache';
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
  /** Called when navigating back past the first story (e.g. step to the previous venue). */
  onStoriesStart?: () => void;
  /** Start at the last story when the list changes — used when entering a venue backwards. */
  startAtEnd?: boolean;
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
  const isVideo = story.media_type === 'video';

  // An image is small enough to be worth having on disk before it is shown. A
  // video is not: useCachedMedia goes through FileSystem.downloadAsync, which
  // only resolves once the ENTIRE file has landed, so the player could not draw
  // a single frame until the whole mp4 was down. That is the minutes-long
  // spinner on story videos — the player streams progressively, so give it the
  // remote URL straight away and let the background prefetch fill the disk
  // cache for the next viewing.
  const { cachedUri } = useCachedMedia(isVideo ? undefined : story.media_url);

  // Resolved once per story on purpose. Swapping a Video's source mid-playback
  // restarts it from zero, so a cache entry that lands after the player is up
  // must not be picked up here.
  const videoUri = useMemo(
    () => (isVideo ? getCachedMediaUriSync(story.media_url) || story.media_url : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isVideo, story.id]
  );

  if (isVideo) {
    if (!videoUri) {
      return (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator color="#FFFFFF" size="large" />
        </View>
      );
    }
    return (
      <Video
        key={`video_${story.id}`}
        source={{ uri: videoUri }}
        style={StyleSheet.absoluteFillObject}
        resizeMode={ResizeMode.CONTAIN}
        shouldPlay={isActive && !isPaused && isVisible}
        isLooping={false}
        volume={1.0}
        isMuted={false}
        progressUpdateIntervalMillis={250}
        // onLoad is the earliest "there is something to show" signal. Relying
        // only on status updates left the spinner up over a perfectly loaded
        // video whenever it arrived paused (a press-and-hold across the
        // transition), because a paused video never reports isPlaying.
        onLoad={(status) => {
          if (isActive) {
            onVideoUpdate(status);
          }
        }}
        onPlaybackStatusUpdate={(status) => {
          if (isActive) {
            onVideoUpdate(status);
          }
        }}
        onError={onVideoError}
      />
    );
  }

  if (!cachedUri) {
    return (
      <View style={styles.loadingOverlay} pointerEvents="none">
        <ActivityIndicator color="#FFFFFF" size="large" />
      </View>
    );
  }

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

// Floor for a resumed image timer. A resume computed from a progress value of
// ~1 yields a near-zero duration, and a zero-duration Animated.timing can
// complete before the interaction that triggered it settles — enough of a floor
// that the advance is always a visible, ordinary transition.
const MIN_RESUME_MS = 250;

// A video that never leaves the buffering state produces no playback updates to
// advance on, so the viewer would sit on a spinner indefinitely. After this long
// the story is treated as unplayable and skipped, the same as an onError.
const VIDEO_STALL_TIMEOUT_MS = 15000;

// How many stories ahead of the one on screen to warm the cache for.
const PREFETCH_AHEAD = 2;

export const StoryViewer: React.FC<StoryViewerProps> = ({
  isVisible,
  onClose,
  stories,
  venueName,
  canAddStory,
  onAddStory,
  onRemoveStory,
  onStoriesEnd,
  onStoriesStart,
  startAtEnd,
}) => {
  const insets = useSafeAreaInsets();
  const user = useAppStore((s) => s.user);
  const hiddenUsers = useAppStore((s) => s.hiddenUsers);
  const setHiddenUsers = useAppStore((s) => s.setHiddenUsers);

  const [currentIndex, setCurrentIndex] = useState(0);
  const storiesSerialized = stories.map(s => s.id).join(',');
  const [isPaused, setIsPaused] = useState(false);
  const [isMediaLoading, setIsMediaLoading] = useState(true);
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
  const nextUniqueId = useRef(0);
  const [replyText, setReplyText] = useState('');
  const [isSendingReply, setIsSendingReply] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  // WhatsApp-style: the emoji panel only appears over the story while the
  // reply input is focused (the focus itself signals intent to react).
  const [isInputFocused, setIsInputFocused] = useState(false);

  // Username cache per-session (avoids re-fetching same uid)
  const [usernameMap, setUsernameMap] = useState<Record<string, string>>({});

  const progressAnim = useRef(new Animated.Value(0)).current;
  const progressValue = useRef(0);
  // Animation completion callbacks fire long after the render that created
  // them, so reading `isPaused` from the closure there can resume a story the
  // user is still holding, or advance one they paused. Mirrored in a ref that
  // callbacks read instead.
  const isPausedRef = useRef(false);
  isPausedRef.current = isPaused;
  const imageTimerRef = useRef<ReturnType<typeof Animated.timing> | null>(null);
  const videoTimerRef = useRef<ReturnType<typeof Animated.timing> | null>(null);
  const videoRef = useRef<Video>(null);
  // Wall-clock deadline for the stall watchdog below; set once per stall, never
  // per status tick. Paired with a mirror of isMediaLoading, because the video
  // status callback fires every 250ms and must be able to tell a new stall from
  // one it has already reported without waiting for a re-render.
  const stallDeadlineRef = useRef(0);
  const isMediaLoadingRef = useRef(true);

  // `stories` is live: a story can expire on its 24h TTL, be deleted by its
  // author, or drop out of the hiddenUsers filter while it is on screen. When
  // the array shrinks under a currentIndex sitting at the end, stories[index] is
  // undefined — and the render treats "no current story" as render-nothing while
  // the non-empty branch is taken, producing a black screen with no close
  // button. Clamping makes that state unreachable rather than relying on the
  // reset effect to repair it a frame later.
  const safeIndex = stories.length > 0 ? Math.min(currentIndex, stories.length - 1) : 0;
  const currentStory = stories.length > 0 ? stories[safeIndex] : null;

  // Which story the user is actually watching, so a live change to the list can
  // keep them on it instead of resetting their position.
  const viewedStoryIdRef = useRef<string | undefined>(undefined);
  // Latched "entered this venue backwards" instruction; see where it is consumed.
  const startAtEndPending = useRef(false);
  // Videos are streamed by StoryMediaItem, so only images are resolved through
  // the cache here — asking for a video would start a second full download of a
  // file the player is already pulling.
  const { cachedUri: currentStoryUri } = useCachedMedia(
    currentStory?.media_type === 'video' ? undefined : currentStory?.media_url
  );

  // Gesture animation (swipe-down to dismiss)
  const translateY = useRef(new Animated.Value(0)).current;

  // The responder is created once, so it reads navigation through refs that
  // are refreshed every render (direct closure would capture a stale index).
  const handleNextRef = useRef<() => void>(() => {});
  const handlePrevRef = useRef<() => void>(() => {});

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Vertical drag down (dismiss) or a deliberate horizontal swipe (nav)
        const vertical = gestureState.dy > 5 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx);
        const horizontal = Math.abs(gestureState.dx) > 10 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
        return vertical || horizontal;
      },
      onPanResponderGrant: () => {
        setIsPaused(true);
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx)) {
          translateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        // Horizontal swipe: left → next story, right → previous story.
        // Always unpause: a no-op swipe (e.g. back on the first story) must
        // not leave the story frozen from the grant-time pause.
        if (Math.abs(gestureState.dx) > Math.abs(gestureState.dy)) {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
          setIsPaused(false);
          if (gestureState.dx < -50 || gestureState.vx < -0.3) {
            handleNextRef.current();
          } else if (gestureState.dx > 50 || gestureState.vx > 0.3) {
            handlePrevRef.current();
          }
          return;
        }
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
      // Once this drag owns the gesture, keep it. Handing the responder to
      // another view mid-drag ends the gesture through onPanResponderTerminate
      // instead of onPanResponderRelease, which is the Android-specific path
      // that used to strand the viewer.
      onPanResponderTerminationRequest: () => false,
      // Reached when the responder is taken anyway (the OS can force it, e.g.
      // on a system gesture or when the modal loses focus). Release never runs,
      // so without this the grant-time pause and any partial drag offset are
      // permanent: the story sits still, half off-screen, and no tap resumes it.
      onPanResponderTerminate: () => {
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
        setIsPaused(false);
      },
    })
  ).current;

  // Prefetch a short window of upcoming stories. Queueing every story in the
  // venue the moment the viewer opened put up to three background downloads —
  // other people's videos included — in a bandwidth fight with the story
  // actually on screen, which is a large part of why videos took so long to
  // start. The current story is deliberately left out: an image is fetched by
  // its own useCachedMedia and a video is streamed by the player.
  useEffect(() => {
    if (!isVisible || stories.length === 0) return;
    const upcoming = stories
      .slice(safeIndex + 1, safeIndex + 1 + PREFETCH_AHEAD)
      .map(s => s.media_url)
      .filter(Boolean);
    if (upcoming.length > 0) prefetchStoriesMedia(upcoming);
  }, [isVisible, storiesSerialized, safeIndex]);

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

  // ─── Keyboard tracking: lift the reply bar above the keyboard ────────────
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardOffset(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardOffset(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

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
      setReplyText('');
      // A fresh open starts at the first story, so nothing from the previous
      // session should influence re-anchoring.
      viewedStoryIdRef.current = undefined;
      startAtEndPending.current = false;
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

  // `startAtEnd` is a one-shot instruction ("you entered this venue backwards"),
  // not a standing mode. It was being read on every story-list change, so once
  // MapScreen set it for a backwards step it kept re-anchoring to the end on any
  // later change to the same venue's list. Latch it, then consume it below.
  useEffect(() => {
    if (startAtEnd) startAtEndPending.current = true;
  }, [startAtEnd]);

  // Re-anchor when the story list changes.
  //
  // The list is live, so it changes for two very different reasons and the old
  // code treated them alike — it reset to index 0 unconditionally. Someone
  // posting a story to the venue you are watching would throw you back to the
  // first story mid-view, over and over as posts arrived.
  //
  // A change only means "navigate" when the story you were on is gone (a venue
  // switch, or that story expiring). If it is still in the list, stay on it and
  // just follow it to its new position.
  useEffect(() => {
    const previousId = viewedStoryIdRef.current;
    const stillPresent = previousId
      ? stories.findIndex((s) => s.id === previousId)
      : -1;

    if (stillPresent !== -1) {
      startAtEndPending.current = false;
      setCurrentIndex(stillPresent);
      return;
    }

    const enteringBackwards = startAtEndPending.current;
    startAtEndPending.current = false;
    setCurrentIndex(enteringBackwards ? Math.max(stories.length - 1, 0) : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storiesSerialized]);

  // Records which story is on screen, for the re-anchoring above. Declared after
  // that effect on purpose: effects run in order, so the effect above still sees
  // the previously-viewed id in the same commit that delivers a new list.
  useEffect(() => {
    viewedStoryIdRef.current = currentStory?.id;
  }, [currentStory?.id]);

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
    isMediaLoadingRef.current = true;
    setIsMediaLoading(true);
    stallDeadlineRef.current = Date.now() + VIDEO_STALL_TIMEOUT_MS;
  }, [currentIndex, storiesSerialized]);

  // ─── Stall watchdog ──────────────────────────────────────────────────────
  // Every automatic advance is driven by media making progress: an image's
  // onLoad, or a video's playback updates. When the media never becomes ready
  // — a cache resolve that never settles, a video stuck buffering on a bad
  // connection, an onLoad that never fires — nothing schedules anything, and
  // the viewer waits on a spinner with no timer running and no way forward.
  // That dead state, not a crash, is what users report as the app freezing.
  //
  // Only armed while genuinely waiting: it is torn down the moment the media
  // reports ready, and it never fires against a paused story (a deliberate
  // press-and-hold must be able to last as long as the user wants).
  //
  // It counts down to a deadline fixed when the story opened, NOT to a fresh
  // timeout per run. This effect re-runs on every isMediaLoading/isPaused
  // change, and it used to restart the full 15s each time — so a video flapping
  // in and out of `isBuffering` at the 250ms status interval, or a user tapping
  // around trying to escape, pushed the deadline forward forever and the one
  // thing meant to rescue them never fired.
  useEffect(() => {
    if (!isVisible || !currentStory || !isMediaLoading || isPaused) return;

    const timer = setTimeout(() => {
      // Still stalled. Treat it as unplayable and move on rather than sit here.
      console.warn(
        `[StoryViewer] Story ${currentStory.id} stalled for ${VIDEO_STALL_TIMEOUT_MS}ms; skipping`
      );
      isMediaLoadingRef.current = false;
      setIsMediaLoading(false);
      handleNextRef.current();
    }, Math.max(stallDeadlineRef.current - Date.now(), 0));

    return () => clearTimeout(timer);
  }, [isVisible, currentStory?.id, isMediaLoading, isPaused]);

  // ─── Image pause/resume ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isVisible || !currentStory || currentStory.media_type !== 'image') return;

    if (isPaused) {
      if (imageTimerRef.current) {
        imageTimerRef.current.stop();
        imageTimerRef.current = null;
      }
      return;
    }

    // Resuming. This used to require progressValue > 0, which quietly stranded
    // the story whenever a pause landed at exactly 0 — press-and-hold the
    // instant an image appears, or a per-story reset that zeroes progress while
    // a press is still down. The image had already fired onLoad, so nothing was
    // left to restart the timer and the story sat at 0% forever with no way
    // forward. Any progress value, 0 included, must be resumable.
    //
    // Nothing to time until the image is actually on screen. handleImageLoad
    // clearing isMediaLoading re-runs this effect, which is what starts the
    // first timer — this effect is the only place an image timer is created, so
    // there can never be two animations driving progress and double-advancing.
    if (isMediaLoading) return;

    const remaining = Math.max(
      IMAGE_DURATION_MS * (1 - progressValue.current),
      MIN_RESUME_MS
    );
    const anim = Animated.timing(progressAnim, {
      toValue: 1,
      duration: remaining,
      useNativeDriver: false,
    });
    imageTimerRef.current = anim;
    anim.start(({ finished }) => {
      if (finished && !isPausedRef.current) handleNextRef.current();
    });
  }, [isPaused, isMediaLoading]);

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
  // Instant cut, no slide: the 300ms slide (with a second media item mounted
  // mid-transition) made every tap feel laggy, especially on videos.
  // Stepping is computed from safeIndex, not the raw state, so a stale
  // out-of-range index can never produce another out-of-range one.
  const handleNext = useCallback(() => {
    if (safeIndex < stories.length - 1) {
      setCurrentIndex(safeIndex + 1);
    } else {
      if (onStoriesEnd) {
        onStoriesEnd();
      } else {
        onClose();
      }
    }
  }, [safeIndex, stories.length, onClose, onStoriesEnd]);

  const handlePrev = useCallback(() => {
    if (safeIndex > 0) {
      setCurrentIndex(safeIndex - 1);
    } else if (onStoriesStart) {
      onStoriesStart();
    }
  }, [safeIndex, onStoriesStart]);

  // Keep the gesture responder's view of navigation fresh
  handleNextRef.current = handleNext;
  handlePrevRef.current = handlePrev;

  // ─── Image loaded ────────────────────────────────────────────────────────
  // Flipping isMediaLoading is all this does. Starting the timer here as well
  // as in the pause/resume effect meant two live animations driving the same
  // progress value, each firing handleNext on completion — a story got skipped.
  // The effect is the single owner of the image timer; this only reports that
  // there is something to time.
  const handleImageLoad = useCallback(() => {
    progressAnim.setValue(0);
    progressValue.current = 0;
    isMediaLoadingRef.current = false;
    setIsMediaLoading(false);
  }, [progressAnim]);

  // ─── Video playback status ───────────────────────────────────────────────
  const handleVideoUpdate = useCallback((status: any) => {
    if (!status.isLoaded) return;

    // A buffering stall. Not every isBuffering report is one: expo-av keeps
    // flagging it during healthy playback on Android while it tops the buffer
    // up, and treating that as loading re-raised the spinner over a video the
    // user was happily watching.
    if (status.isBuffering && !status.isPlaying) {
      if (!isMediaLoadingRef.current) {
        // Entering a stall from playback. Give the watchdog a deadline measured
        // from this stall rather than from when the story opened, so a video
        // that dies halfway through is still rescued. Guarded on the ref, not
        // the state, so the 250ms status ticks that arrive before the re-render
        // cannot keep pushing the deadline out — the bug this whole watchdog
        // rewrite is about.
        stallDeadlineRef.current = Date.now() + VIDEO_STALL_TIMEOUT_MS;
        isMediaLoadingRef.current = true;
        setIsMediaLoading(true);
      }
      if (videoTimerRef.current) {
        videoTimerRef.current.stop();
        videoTimerRef.current = null;
      }
      return;
    }
    // Ready is "loaded and not buffering", not "playing" — a video that arrives
    // while the user is holding never plays, so keying off isPlaying left the
    // spinner over a fully loaded frame with the watchdog disabled by the pause.
    if (isMediaLoadingRef.current) {
      isMediaLoadingRef.current = false;
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
      
      // Animate smoothly to the current playback position over one interval
      const anim = Animated.timing(progressAnim, {
        toValue: Math.min(progress, 1),
        duration: 250,
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
  }, [isPaused, handleNext]);

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
            } else if (safeIndex >= stories.length - 1) {
              setCurrentIndex(Math.max(safeIndex - 1, 0));
            }
          },
        },
      ]
    );
  }, [currentStory, onRemoveStory, stories.length, safeIndex, onClose]);

  /**
   * Pushes a story_reaction message (emoji reaction or text reply — both carry
   * the story thumbnail payload) into the venue chat.
   */
  const sendStoryChatMessage = async (
    message: string,
    reactions?: Record<string, Record<string, string>>
  ) => {
    if (!user || !currentStory?.venue_id) return;

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
      message,
      type: 'story_reaction',
      timestamp: Date.now(),
      ...(reactions ? { reactions } : {}),
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
  };

  const handleReactToStory = async (emoji: string, index: number) => {
    if (!user || !currentStory?.venue_id) return;

    // Reacting closes the panel/keyboard, WhatsApp-style
    Keyboard.dismiss();

    // Add floating reaction instantly for immediate feedback!
    const containerWidth = width - 40;
    const buttonWidth = containerWidth / 6;
    const startX = 20 + index * buttonWidth + buttonWidth / 2 - 16;

    const reactionId = nextUniqueId.current++;
    setFloatingReactions(prev => [...prev, { id: reactionId, emoji, x: startX }]);

    // Temporarily pause the story while sending reaction
    setIsPaused(true);

    try {
      const senderName = await fetchUsername(user.uid);
      await sendStoryChatMessage(
        `Reacted ${emoji} to ${currentUsername || 'someone'}'s story`,
        { [emoji]: { [user.uid]: senderName } }
      );

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

  const handleSendReply = async () => {
    const text = replyText.trim();
    if (!text || isSendingReply || !user || !currentStory?.venue_id) return;

    setIsSendingReply(true);
    try {
      await sendStoryChatMessage(text);
      setReplyText('');
      Keyboard.dismiss();
      Toast.show({
        type: 'success',
        text1: 'Reply Sent',
        text2: 'Your reply was posted to the venue chat.',
        position: 'top',
        visibilityTime: 1500,
      });
    } catch (err) {
      console.warn('[StoryViewer] Failed to send story reply:', err);
      Toast.show({
        type: 'error',
        text1: 'Reply Failed',
        text2: 'Could not deliver reply to chat.',
      });
    } finally {
      setIsSendingReply(false);
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
      ],
      // On Android an alert is dismissible by the back button or an outside tap,
      // and neither fires a button handler — the pause taken above would never
      // be released and the story would sit frozen with the UI still live. This
      // is the second half of the same escape-hatch problem as the modal's
      // onRequestClose.
      { cancelable: true, onDismiss: () => setIsPaused(false) }
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
      ],
      { cancelable: true, onDismiss: () => setIsPaused(false) }
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
        currentStory.media_type === 'video' ? 'Video story' : 'Photo story',
        currentStory.venue_id || undefined,
        reason,
        currentStory.media_url
          ? { url: currentStory.media_url, type: currentStory.media_type === 'video' ? 'video' : 'image' }
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

  // onRequestClose is what makes the Android hardware/gesture back button
  // dismiss this modal. Without it the back press is swallowed, so any state
  // that stalls playback (a buffering video, a stuck pause) leaves the user with
  // no way out at all and the app reads as fully frozen — the reported "had to
  // close the app and reopen". It is the escape hatch of last resort and must
  // stay wired even after the individual stalls are fixed.
  return (
    <Modal
      visible={isVisible}
      animationType="none"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Animated.View style={[styles.modalOverlay, { backgroundColor: backdropOpacity }]}>
        <Animated.View
          style={[styles.container, { transform: [{ translateY }] }]}
          {...panResponder.panHandlers}
        >
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
              <View style={StyleSheet.absoluteFillObject}>
                <StoryMediaItem
                  story={currentStory}
                  isActive={true}
                  isPaused={isPaused}
                  isVisible={isVisible}
                  onImageLoad={handleImageLoad}
                  onVideoUpdate={handleVideoUpdate}
                  onVideoError={() => {
                    isMediaLoadingRef.current = false;
                    setIsMediaLoading(false);
                    handleNext();
                  }}
                />
              </View>

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
              {(isMediaLoading || (currentStory.media_type !== 'video' && !currentStoryUri)) && (
                <View style={styles.loadingOverlay} pointerEvents="none">
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
                    if (index < safeIndex) widthValue = '100%';
                    else if (index === safeIndex) widthValue = progressInterpolation;
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
                    <View style={styles.userTextBlock}>
                      <View style={styles.usernameRow}>
                        {currentStory.activeBadge ? (() => {
                          const badgeObj = ACHIEVEMENTS.find(a => a.id === currentStory.activeBadge);
                          // @ts-ignore
                          const BadgeIcon = badgeObj ? Icons[badgeObj.iconName] : null;
                          if (!BadgeIcon || !badgeObj) return null;
                          return <BadgeIcon color={badgeObj.glowColor} size={14} style={{ marginRight: 6 }} />;
                        })() : null}
                        <Text style={styles.usernameText} numberOfLines={1} ellipsizeMode="tail">
                          {currentUsername || ' '}
                        </Text>
                      </View>
                      {venueName ? <Text style={styles.venueName} numberOfLines={1} ellipsizeMode="tail">{venueName}</Text> : null}
                    </View>
                  </View>
                  <View style={styles.metadataActions}>
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
                    {/* The only exit from a playing story used to be the
                        swipe-down gesture (plus the Android back button), so
                        anything that made the story feel unresponsive left iOS
                        users with no visible way out at all. An always-present
                        close button means a stalled story is never a trap. */}
                    <Pressable
                      style={styles.closeButton}
                      onPress={onClose}
                      hitSlop={12}
                    >
                      <X color="#FFF" size={18} />
                    </Pressable>
                  </View>
                </View>
              </View>



              {/* ── Bottom controls (WhatsApp-style reply bar) ── */}
              <View style={[
                styles.bottomControlsColumn,
                { bottom: Math.max(insets.bottom, 20) + keyboardOffset }
              ]}>
                {currentStory.user_id !== user?.uid && currentStory.venue_id ? (
                  <>
                    {/* Emoji panel floats over the story only while the input
                        is focused — focusing signals intent to react. */}
                    {isInputFocused && (
                      <View style={styles.emojiPanel}>
                        {['❤️', '🔥', '😂', '👍', '😮', '🍻'].map((emoji, index) => (
                          <TouchableOpacity
                            key={emoji}
                            style={styles.emojiPanelButton}
                            onPress={() => handleReactToStory(emoji, index)}
                            activeOpacity={0.6}
                          >
                            <Text style={styles.emojiPanelText}>{emoji}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}

                    <View style={styles.replyRow}>
                      {canAddStory && !isInputFocused && (
                        <Pressable style={styles.addButtonFloating} onPress={onAddStory}>
                          <Plus color="#000" size={22} />
                        </Pressable>
                      )}
                      <TextInput
                        style={styles.replyInput}
                        value={replyText}
                        onChangeText={setReplyText}
                        placeholder={`Reply to ${currentUsername || 'story'}...`}
                        placeholderTextColor="rgba(255,255,255,0.5)"
                        maxLength={300}
                        returnKeyType="send"
                        onSubmitEditing={handleSendReply}
                        onFocus={() => {
                          setIsInputFocused(true);
                          setIsPaused(true);
                        }}
                        onBlur={() => {
                          setIsInputFocused(false);
                          setIsPaused(false);
                        }}
                      />
                      {isInputFocused && (
                        <TouchableOpacity
                          style={[styles.replySendButton, (!replyText.trim() || isSendingReply) && { opacity: 0.4 }]}
                          onPress={handleSendReply}
                          disabled={!replyText.trim() || isSendingReply}
                        >
                          {isSendingReply ? (
                            <ActivityIndicator color="#000" size="small" />
                          ) : (
                            <Send color="#000" size={18} />
                          )}
                        </TouchableOpacity>
                      )}
                    </View>
                  </>
                ) : (
                  <View style={[
                    styles.bottomControlsContainer,
                    { justifyContent: (canAddStory || currentStory.user_id !== user?.uid) ? 'space-between' : 'center' }
                  ]}>
                    {canAddStory && (
                      <Pressable style={styles.addButtonFloating} onPress={onAddStory}>
                        <Plus color="#000" size={22} />
                      </Pressable>
                    )}

                    {currentStory.user_id === user?.uid && onRemoveStory && (
                      <Pressable
                        style={styles.removeButtonInline}
                        onPress={handleRemoveStory}
                      >
                        <Trash2 color="#FF0055" size={16} style={{ marginRight: 6 }} />
                        <Text style={styles.removeButtonText}>Remove Story</Text>
                      </Pressable>
                    )}
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
  // zIndex 10 put this full-screen view above every control in the viewer: the
  // prev/next tap zones (1), the header (3) and the bottom bar (5). While it was
  // up it swallowed the taps meant to skip the story and dimmed the chrome, and
  // since the playing state has no close button, the swipe-down gesture was the
  // only exit left — that is the "stuck on a loading video, had to kill the app"
  // report. It sits just above the media now, and never takes a touch.
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    zIndex: 1,
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
    gap: 12,
  },
  // The author block absorbs the free space and truncates; the action buttons
  // on the right keep their intrinsic size so a long venue name can't push
  // them past the screen edge.
  userInfoBlock: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  userTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  metadataActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexShrink: 0,
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
  closeButton: {
    padding: 6,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 16,
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

  // ── Bottom controls (reply bar + action row) ──────────────────────────────
  bottomControlsColumn: {
    position: 'absolute',
    left: 20,
    right: 20,
    zIndex: 5,
  },
  bottomControlsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  replyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  replyInput: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: '#FFF',
    fontSize: 14,
  },
  replySendButton: {
    backgroundColor: '#00FFCC',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
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
    color: '#FF0055',
    fontSize: 14,
    fontWeight: '600',
  },
  emojiPanel: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    paddingVertical: 10,
    paddingHorizontal: 8,
    marginBottom: 12,
  },
  emojiPanelButton: {
    padding: 6,
  },
  emojiPanelText: {
    fontSize: 32,
  },
});
