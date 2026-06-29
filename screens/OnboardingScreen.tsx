import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Animated,
  SafeAreaView,
  Platform,
} from 'react-native';
import { MapPin, MessageSquare, Trophy, ChevronRight } from 'lucide-react-native';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ─── Slide Data ───────────────────────────────────────────────────────────────
interface Slide {
  id: string;
  category: string;
  headline: string;
  description: string;
  IconComponent: any;
  color: string;
}

const SLIDES: Slide[] = [
  {
    id: '1',
    category: 'DISCOVER VIBES',
    headline: "Nairobi's Nightlife,\nMapped",
    description: 'Find the hottest clubs, lounges, and events happening around you. Get real-time crowd updates and locate your next move.',
    IconComponent: MapPin,
    color: '#00FFCC', // Neon Teal
  },
  {
    id: '2',
    category: 'LIVE CHAT',
    headline: 'Connect Before\nYou Pull Up',
    description: 'Chat with other partygoers at the venue in real-time. Check what the music is giving and share the energy.',
    IconComponent: MessageSquare,
    color: '#A78BFA', // Violet
  },
  {
    id: '3',
    category: 'EARN STATUS',
    headline: 'Rep Your Nightlife\nReputation',
    description: 'Unlock exclusive achievements for attending venues, claim badges, and climb the local leaderboard.',
    IconComponent: Trophy,
    color: '#FF3366', // Rose Pink
  },
];

// ─── Animated Ambient Rays ───────────────────────────────────────────────────
interface RayConfig {
  color: string;
  rotation: string;
  top: number;
  left: number;
  width: number;
  height: number;
  initialOpacity: number;
  animDuration: number;
  animDelay: number;
}

const RAY_CONFIGS: RayConfig[] = [
  { color: 'rgba(0, 255, 204, 0.12)', rotation: '-30deg', top: -100, left: SCREEN_W * 0.1, width: SCREEN_W * 1.3, height: 160, initialOpacity: 0.5, animDuration: 5000, animDelay: 0 },
  { color: 'rgba(167, 139, 250, 0.10)', rotation: '20deg', top: SCREEN_H * 0.4, left: -SCREEN_W * 0.3, width: SCREEN_W * 1.2, height: 110, initialOpacity: 0.4, animDuration: 6200, animDelay: 500 },
  { color: 'rgba(255, 51, 102, 0.08)', rotation: '-15deg', top: SCREEN_H * 0.65, left: -SCREEN_W * 0.1, width: SCREEN_W * 1.4, height: 90, initialOpacity: 0.3, animDuration: 5500, animDelay: 1000 },
];

const AnimatedRay: React.FC<RayConfig> = ({
  color, rotation, top, left, width, height,
  initialOpacity, animDuration, animDelay,
}) => {
  const opacity = useRef(new Animated.Value(initialOpacity)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const opacityAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: initialOpacity * 1.8,
          duration: animDuration,
          delay: animDelay,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: initialOpacity * 0.3,
          duration: animDuration,
          useNativeDriver: true,
        }),
      ])
    );

    const translateAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(translateY, {
          toValue: 20,
          duration: animDuration * 1.1,
          delay: animDelay,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: -12,
          duration: animDuration * 0.9,
          useNativeDriver: true,
        }),
      ])
    );

    opacityAnim.start();
    translateAnim.start();
    return () => {
      opacityAnim.stop();
      translateAnim.stop();
    };
  }, []);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        top,
        left,
        width,
        height,
        backgroundColor: color,
        borderRadius: height / 2,
        transform: [{ rotate: rotation }, { translateY }],
        opacity,
      }}
    />
  );
};

// ─── Main Onboarding Screen ──────────────────────────────────────────────────
interface OnboardingScreenProps {
  onComplete: () => void;
}

export const OnboardingScreen: React.FC<OnboardingScreenProps> = ({ onComplete }) => {
  const [activeIndex, setActiveIndex] = useState(0);
  
  // Animation values for transitions
  const slideAnim = useRef(new Animated.Value(0)).current; // For horizontal offset
  const fadeAnim = useRef(new Animated.Value(1)).current;  // For text opacity

  const transitionToSlide = (newIndex: number) => {
    // Fade out text first
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0.2,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: -newIndex * SCREEN_W,
        tension: 40,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setActiveIndex(newIndex);
      // Fade back in
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    });
  };

  const handleNext = () => {
    if (activeIndex < SLIDES.length - 1) {
      transitionToSlide(activeIndex + 1);
    } else {
      onComplete();
    }
  };

  const handleSkip = () => {
    onComplete();
  };

  const CurrentIcon = SLIDES[activeIndex].IconComponent;

  return (
    <View style={styles.container}>
      {/* Deep purple background */}
      <View style={styles.bgBase} />

      {/* Animated Light Rays */}
      {RAY_CONFIGS.map((cfg, i) => (
        <AnimatedRay key={i} {...cfg} />
      ))}

      {/* Vignette Overlay */}
      <View style={styles.vignette} />

      <SafeAreaView style={styles.safeArea}>
        {/* Header - Skip Button */}
        <View style={styles.header}>
          <View style={styles.logoBadge}>
            <Text style={styles.logoText}>EVENTAS</Text>
          </View>
          <TouchableOpacity onPress={handleSkip} activeOpacity={0.7} style={styles.skipButton}>
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
        </View>

        {/* Slide Visuals Block */}
        <View style={styles.illustrationSection}>
          <Animated.View 
            style={[
              styles.iconWrapper, 
              { 
                borderColor: SLIDES[activeIndex].color,
                shadowColor: SLIDES[activeIndex].color,
                opacity: fadeAnim,
                transform: [
                  { scale: fadeAnim.interpolate({
                      inputRange: [0.2, 1],
                      outputRange: [0.85, 1]
                    }) 
                  }
                ]
              }
            ]}
          >
            <CurrentIcon color={SLIDES[activeIndex].color} size={54} />
          </Animated.View>
        </View>

        {/* Slide Text Content */}
        <Animated.View style={[styles.textSection, { opacity: fadeAnim }]}>
          <Text style={[styles.category, { color: SLIDES[activeIndex].color }]}>
            {SLIDES[activeIndex].category}
          </Text>
          <Text style={styles.headline}>
            {SLIDES[activeIndex].headline}
          </Text>
          <Text style={styles.description}>
            {SLIDES[activeIndex].description}
          </Text>
        </Animated.View>

        {/* Footer controls */}
        <View style={styles.footer}>
          {/* Pagination Indicators */}
          <View style={styles.pagination}>
            {SLIDES.map((_, index) => (
              <TouchableOpacity
                key={index}
                style={[
                  styles.dot,
                  activeIndex === index && {
                    backgroundColor: SLIDES[activeIndex].color,
                    width: 20,
                  },
                ]}
                onPress={() => transitionToSlide(index)}
                activeOpacity={0.7}
              />
            ))}
          </View>

          {/* Action Button */}
          <TouchableOpacity
            style={[
              styles.actionButton,
              { backgroundColor: SLIDES[activeIndex].color }
            ]}
            onPress={handleNext}
            activeOpacity={0.85}
          >
            <Text style={styles.actionText}>
              {activeIndex === SLIDES.length - 1 ? 'Get Started' : 'Next'}
            </Text>
            {activeIndex !== SLIDES.length - 1 && (
              <ChevronRight color="#120825" size={18} style={styles.actionIcon} />
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#120825',
  },
  bgBase: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#150a2e',
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingTop: Platform.OS === 'ios' ? 8 : 24,
    height: 60,
  },
  logoBadge: {
    paddingVertical: 4,
  },
  logoText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 4,
  },
  skipButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  skipText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 14,
    fontWeight: '600',
  },
  illustrationSection: {
    flex: 1.2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconWrapper: {
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    // Icon glow styles
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 8,
  },
  textSection: {
    flex: 1,
    paddingHorizontal: 32,
    justifyContent: 'center',
  },
  category: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 12,
  },
  headline: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '800',
    lineHeight: 42,
    letterSpacing: -0.5,
    marginBottom: 16,
  },
  description: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 15,
    lineHeight: 24,
    fontWeight: '400',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingBottom: Platform.OS === 'ios' ? 24 : 40,
    paddingTop: 16,
  },
  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    height: 50,
    borderRadius: 25,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  actionText: {
    color: '#120825',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  actionIcon: {
    marginLeft: 4,
  },
});
