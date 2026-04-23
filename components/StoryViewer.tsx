import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Modal, Pressable, Image, Dimensions, Text, Animated, SafeAreaView } from 'react-native';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { X, Plus, Clock, User as UserIcon, ArrowLeft } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StoryData } from '../services/storyService';
import { fetchUsername } from '../services/userService';

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
  onAddStory 
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [username, setUsername] = useState<string>('Loading...');
  const [isPaused, setIsPaused] = useState(false);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const progressValue = useRef(0);

  const currentStory = stories.length > 0 ? stories[currentIndex] : null;

  // Initialize and attach listener
  useEffect(() => {
    const listener = progressAnim.addListener(({ value }) => {
      progressValue.current = value;
    });
    return () => progressAnim.removeListener(listener);
  }, [progressAnim]);

  useEffect(() => {
    if (isVisible) {
      setCurrentIndex(0);
      progressAnim.setValue(0);
      progressValue.current = 0; // Ensures animation logic doesn't resume from the end!
      setIsPaused(false);
    }
  }, [isVisible, progressAnim]);

  // Story Index Change Observer
  useEffect(() => {
    progressAnim.setValue(0);
    progressValue.current = 0;
    setIsPaused(false);

    if (currentStory) {
      setUsername(''); // Reset instantly on index jump
      fetchUsername(currentStory.user_id).then(setUsername);
    }
  }, [currentIndex, currentStory, progressAnim]);

  // Pause / Resume Logic for Images
  useEffect(() => {
    if (!isVisible || !currentStory || currentStory.media_type !== 'image') return;

    if (isPaused) {
      progressAnim.stopAnimation();
    } else {
      // If we are resuming from a paused state (progress > 0)
      if (progressValue.current > 0) {
        Animated.timing(progressAnim, {
          toValue: 1,
          duration: IMAGE_DURATION_MS * (1 - progressValue.current),
          useNativeDriver: false,
        }).start(({ finished }) => {
          if (finished && !isPaused) handleNext();
        });
      }
    }
  }, [isPaused, isVisible, currentStory]);

  const handleNext = () => {
    if (currentIndex < stories.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      onClose(); // Close if it's the last story
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  };

  const handleImageLoad = () => {
    if (currentStory?.media_type === 'image') {
      progressAnim.setValue(0);
      Animated.timing(progressAnim, {
        toValue: 1,
        duration: IMAGE_DURATION_MS,
        useNativeDriver: false,
      }).start(({ finished }) => {
         if (finished && !isPaused) handleNext();
      });
    }
  };

  const handleVideoUpdate = (status: any) => {
    if (status.isLoaded) {
      if (status.didJustFinish) {
        handleNext();
      } else if (!isPaused) {
        // Map video duration actively to the progress bar natively
        const progress = status.positionMillis / (status.durationMillis || 1);
        progressAnim.setValue(progress);
      }
    }
  };

  const calculateHoursAgo = (timestamp: any) => {
    if (!timestamp?.toDate) return 0;
    const diff = new Date().getTime() - timestamp.toDate().getTime();
    return Math.floor(diff / 3600000);
  };

  return (
    <Modal visible={isVisible} animationType="fade" transparent={true}>
      <View style={styles.container}>
        {stories.length === 0 ? (
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
            {/* Dynamic Media Context */}
            {currentStory.media_type === 'video' ? (
              <Video
                key={`video_${currentStory.user_id}_${currentIndex}_${isVisible}`}
                source={{ uri: currentStory.media_url }}
                style={StyleSheet.absoluteFillObject}
                resizeMode={ResizeMode.COVER}
                shouldPlay={!isPaused && isVisible}
                progressUpdateIntervalMillis={50} // Keep smooth progress mapping
                onPlaybackStatusUpdate={handleVideoUpdate}
              />
            ) : (
              <Image 
                key={`img_${currentStory.user_id}_${currentIndex}_${isVisible}`}
                source={{ uri: currentStory.media_url }} 
                style={StyleSheet.absoluteFillObject} 
                resizeMode="cover" 
                onLoad={handleImageLoad}
              />
            )}

            {/* Tap & Hold Interaction Zones */}
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

            {/* Smooth Top Gradient for Text Legibility */}
            <LinearGradient
              colors={['rgba(0, 0, 0, 0.7)', 'transparent']}
              style={styles.topGradient}
              pointerEvents="none"
            />

            {/* Structured Top Header Overlay */}
            <SafeAreaView style={styles.headerContainer} pointerEvents="none">
              <View style={styles.progressContainer}>
                {stories.map((_, index) => {
                  // Logic to evaluate width per dynamic progress
                  let widthStyle = '0%';
                  if (index < currentIndex) widthStyle = '100%';
                  else if (index === currentIndex) {
                    // interpolate current animated value
                    widthStyle = progressAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0%', '100%'],
                      extrapolate: 'clamp'
                    }) as any; 
                  }

                  return (
                    <View key={index} style={styles.progressBarBackground}>
                      <Animated.View style={[styles.progressBarFill, { width: widthStyle }]} />
                    </View>
                  );
                })}
              </View>

              {/* Advanced Metadata Context */}
              <View style={styles.metadataLayout}>
                <View style={styles.userInfoBlock}>
                  <View style={styles.avatar}>
                    <UserIcon color="#FFF" size={16} />
                  </View>
                  <View>
                    <Text style={styles.usernameText}>{username}</Text>
                    {venueName && <Text style={styles.venueName}>{venueName}</Text>}
                  </View>
                </View>
                
                <View style={styles.timeBlock}>
                  <Text style={styles.timeText}>{calculateHoursAgo(currentStory.created_at)}h</Text>
                </View>
              </View>
            </SafeAreaView>

            {/* Bottom Controls */}
            <View style={styles.controlsRow}>
              {canAddStory && (
                <Pressable style={styles.addButtonFloating} onPress={onAddStory}>
                  <Plus color="#000" size={24} />
                </Pressable>
              )}
            </View>

            {/* Global Closing Top Right Corner */}
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
  container: { flex: 1, backgroundColor: '#000' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyText: { color: '#FFF', fontSize: 20, fontWeight: '600', marginBottom: 20 },
  addButtonLarge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#00FFCC', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 24, gap: 8 },
  addButtonText: { color: '#000', fontSize: 16, fontWeight: '700' },

  interactionLayer: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', zIndex: 1 },
  leftTapZone: { flex: 0.35, height: '100%' },
  rightTapZone: { flex: 0.65, height: '100%' },

  topGradient: { position: 'absolute', top: 0, left: 0, right: 0, height: 160, zIndex: 2 },
  
  headerContainer: { position: 'absolute', top: 10, left: 0, right: 0, paddingHorizontal: 16, zIndex: 3 },
  progressContainer: { flexDirection: 'row', gap: 4, height: 3, marginBottom: 16 },
  progressBarBackground: { flex: 1, height: '100%', backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 2, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: '#FFF', borderRadius: 2 },
  
  metadataLayout: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  userInfoBlock: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#FFF' },
  usernameText: { color: '#FFF', fontSize: 15, fontWeight: '800', shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 3, shadowOffset: { width: 0, height: 1} },
  venueName: { color: '#00FFCC', fontSize: 12, fontWeight: '600', opacity: 0.9 },
  
  timeBlock: { opacity: 0.8 },
  timeText: { color: '#FFF', fontSize: 14, fontWeight: '600', shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 3, shadowOffset: { width: 0, height: 1} },
  
  closeButtonAbsolute: { position: 'absolute', top: 40, right: 16, zIndex: 4, padding: 8 },
  backButtonAbsolute: { position: 'absolute', top: 40, left: 16, zIndex: 4, padding: 8 },

  controlsRow: { position: 'absolute', bottom: 40, width: '100%', alignItems: 'center', zIndex: 4 },
  addButtonFloating: { backgroundColor: '#00FFCC', width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center', shadowColor: '#00FFCC', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 8 }
});
