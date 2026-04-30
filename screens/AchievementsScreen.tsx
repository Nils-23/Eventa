import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { firestore } from '../services/firebase';
import { useAppStore } from '../hooks/useAppStore';
import { ACHIEVEMENTS, AchievementCategory, Achievement } from '../services/achievementService';
import * as Icons from 'lucide-react-native';
import { ArrowLeft, CheckCircle2 } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';

const CATEGORIES: AchievementCategory[] = ['Activity', 'Explorer', 'Creator', 'Social', 'Personality'];

export const AchievementsScreen = () => {
  const { user } = useAppStore();
  const navigation = useNavigation();
  const [unlockedIds, setUnlockedIds] = useState<string[]>([]);
  const [activeBadgeId, setActiveBadgeId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (!user) return;
    const userDocRef = doc(firestore, 'users', user.uid);
    const unsubscribe = onSnapshot(userDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setUnlockedIds(data.unlockedAchievements || []);
        setActiveBadgeId(data.activeBadge || null);
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  const handleSetActiveBadge = async (badgeId: string) => {
    if (!user || isUpdating) return;
    setIsUpdating(true);
    try {
      const userDocRef = doc(firestore, 'users', user.uid);
      await updateDoc(userDocRef, { activeBadge: badgeId });
    } catch (error) {
      console.error('Failed to set active badge:', error);
    } finally {
      setIsUpdating(false);
    }
  };

  const renderBadge = (achievement: Achievement) => {
    const isUnlocked = unlockedIds.includes(achievement.id);
    const isActive = activeBadgeId === achievement.id;
    // @ts-ignore
    const Icon = Icons[achievement.iconName] || Icons.HelpCircle;

    return (
      <TouchableOpacity
        key={achievement.id}
        style={[
          styles.badgeContainer,
          isUnlocked ? styles.badgeUnlocked : styles.badgeLocked,
          isActive && styles.badgeActive
        ]}
        disabled={!isUnlocked || isActive}
        onPress={() => handleSetActiveBadge(achievement.id)}
      >
        <View style={styles.iconContainer}>
          <Icon 
            color={isUnlocked ? achievement.glowColor : '#555555'} 
            size={32} 
            style={isUnlocked ? {
              shadowColor: achievement.glowColor,
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: 0.8,
              shadowRadius: 10,
            } : undefined}
          />
        </View>
        <Text style={[styles.badgeName, isUnlocked ? styles.textUnlocked : styles.textLocked]}>
          {achievement.name}
        </Text>
        <Text style={styles.badgeDesc} numberOfLines={2}>
          {achievement.description}
        </Text>
        
        {isActive && (
          <View style={styles.activeOverlay}>
            <CheckCircle2 color="#00FFCC" size={16} />
            <Text style={styles.activeText}>Active</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#00FFCC" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <ArrowLeft color="#FFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.title}>Achievements</Text>
        <View style={{ width: 24 }} /> {/* Balance for center alignment */}
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.subtitle}>
          Earn badges by exploring the city and socializing. Tap an unlocked badge to set it as your status symbol.
        </Text>

        {CATEGORIES.map(category => {
          const categoryAchievements = ACHIEVEMENTS.filter(a => a.category === category);
          if (categoryAchievements.length === 0) return null;

          return (
            <View key={category} style={styles.categorySection}>
              <Text style={styles.categoryTitle}>{category}</Text>
              <View style={styles.badgesGrid}>
                {categoryAchievements.map(renderBadge)}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#121212',
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
  },
  backButton: {
    padding: 8,
  },
  title: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '700',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  subtitle: {
    color: '#888',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 32,
    textAlign: 'center',
  },
  categorySection: {
    marginBottom: 32,
  },
  categoryTitle: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  badgesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  badgeContainer: {
    width: '48%',
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    position: 'relative',
  },
  badgeUnlocked: {
    borderColor: '#333',
  },
  badgeLocked: {
    opacity: 0.5,
  },
  badgeActive: {
    borderColor: '#00FFCC',
    backgroundColor: 'rgba(0, 255, 204, 0.05)',
  },
  iconContainer: {
    marginBottom: 12,
  },
  badgeName: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
    textAlign: 'center',
  },
  textUnlocked: {
    color: '#FFF',
  },
  textLocked: {
    color: '#666',
  },
  badgeDesc: {
    fontSize: 11,
    color: '#888',
    textAlign: 'center',
    lineHeight: 14,
  },
  activeOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    gap: 4,
  },
  activeText: {
    color: '#00FFCC',
    fontSize: 9,
    fontWeight: 'bold',
  }
});
