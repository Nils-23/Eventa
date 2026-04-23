import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Modal, TouchableOpacity, Image, Dimensions, Text } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { X, Plus, Clock } from 'lucide-react-native';
import { StoryData } from '../services/storyService';

interface StoryViewerProps {
  isVisible: boolean;
  onClose: () => void;
  stories: StoryData[];
  venueName?: string;
  canAddStory: boolean;
  onAddStory: () => void;
}

const { width, height } = Dimensions.get('window');

export const StoryViewer: React.FC<StoryViewerProps> = ({ 
  isVisible, 
  onClose, 
  stories, 
  venueName,
  canAddStory, 
  onAddStory 
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  // Reset index when visibility changes
  useEffect(() => {
    if (isVisible) {
      setCurrentIndex(0);
    }
  }, [isVisible]);

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

  const currentStory = stories.length > 0 ? stories[currentIndex] : null;

  return (
    <Modal visible={isVisible} animationType="fade" transparent={true}>
      <View style={styles.container}>
        {/* If no stories exist, just show the Add prompt if they are allowed */}
        {stories.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No stories here yet.</Text>
            {canAddStory && (
              <TouchableOpacity style={styles.addButtonLarge} onPress={onAddStory}>
                <Plus color="#000" size={24} />
                <Text style={styles.addButtonText}>Be the first to add a story!</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : currentStory ? (
          <>
            {/* Media Rendering */}
            {currentStory.media_type === 'video' ? (
              <Video
                source={{ uri: currentStory.media_url }}
                style={StyleSheet.absoluteFillObject}
                resizeMode={ResizeMode.COVER}
                shouldPlay
                isLooping
              />
            ) : (
              <Image 
                source={{ uri: currentStory.media_url }} 
                style={StyleSheet.absoluteFillObject} 
                resizeMode="cover" 
              />
            )}

            {/* Tap Zones for Navigation */}
            <TouchableOpacity style={styles.leftTapZone} onPress={handlePrev} activeOpacity={1} />
            <TouchableOpacity style={styles.rightTapZone} onPress={handleNext} activeOpacity={1} />

            {/* Progress Indicators */}
            <View style={styles.progressContainer}>
              {stories.map((_, index) => (
                <View 
                  key={index} 
                  style={[
                    styles.progressBar, 
                    { opacity: index <= currentIndex ? 1 : 0.4 }
                  ]} 
                />
              ))}
            </View>

            {/* Venue & Metadata */}
            <View style={styles.metadataContainer}>
              {venueName && <Text style={styles.venueName}>{venueName}</Text>}
              <View style={styles.timeContainer}>
                <Clock color="#fff" size={12} />
                <Text style={styles.timeText}>
                  {currentStory.created_at?.toDate ? Math.round((new Date().getTime() - currentStory.created_at.toDate().getTime()) / 3600000) : 0}h ago
                </Text>
              </View>
            </View>

            {/* Floating Action Button for Adding (if allowed) */}
            {canAddStory && (
              <TouchableOpacity style={styles.addButtonFloating} onPress={onAddStory}>
                <Plus color="#000" size={20} />
              </TouchableOpacity>
            )}
          </>
        ) : null}

        {/* Global Close Button */}
        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
          <X color="#FFF" size={28} />
        </TouchableOpacity>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
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
  leftTapZone: {
    position: 'absolute',
    top: 60,
    bottom: 0,
    left: 0,
    width: width * 0.3,
    zIndex: 1,
  },
  rightTapZone: {
    position: 'absolute',
    top: 60,
    bottom: 0,
    right: 0,
    width: width * 0.7,
    zIndex: 1,
  },
  progressContainer: {
    position: 'absolute',
    top: 50,
    left: 10,
    right: 10,
    flexDirection: 'row',
    gap: 4,
    zIndex: 2,
  },
  progressBar: {
    flex: 1,
    height: 3,
    backgroundColor: '#FFF',
    borderRadius: 2,
  },
  closeButton: {
    position: 'absolute',
    top: 60,
    right: 16,
    zIndex: 3,
    padding: 8,
  },
  metadataContainer: {
    position: 'absolute',
    top: 60,
    left: 16,
    zIndex: 2,
  },
  venueName: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: -1, height: 1 },
    textShadowRadius: 10
  },
  timeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  timeText: {
    color: '#FFF',
    fontSize: 12,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: -1, height: 1 },
    textShadowRadius: 10
  },
  addButtonFloating: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    backgroundColor: '#00FFCC',
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 3,
    shadowColor: '#00FFCC',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 8,
  }
});
