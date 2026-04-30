import { doc, getDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { firestore } from './firebase';

export type AchievementCategory = 'Activity' | 'Explorer' | 'Creator' | 'Social' | 'Personality';

export interface Achievement {
  id: string;
  name: string;
  description: string;
  category: AchievementCategory;
  iconName: string; // Lucide icon name or image ref
  glowColor: string; // Neon color for UI
  target: number; // Value needed to unlock
  statKey: 'hotstreaks' | 'venues' | 'stories' | 'chats'; // The user stat to compare against
}

export const ACHIEVEMENTS: Achievement[] = [
  // Activity (Based on active nights / hotstreaks)
  { id: 'act_1', name: 'Night Owl', description: 'Go out at night for the first time.', category: 'Activity', iconName: 'Moon', glowColor: '#00FFCC', target: 1, statKey: 'hotstreaks' },
  { id: 'act_3', name: 'Weekend Warrior', description: 'Be active for 3 nights.', category: 'Activity', iconName: 'Zap', glowColor: '#00FFCC', target: 3, statKey: 'hotstreaks' },
  { id: 'act_5', name: 'Party Animal', description: 'Be active for 5 nights.', category: 'Activity', iconName: 'Flame', glowColor: '#FF5E00', target: 5, statKey: 'hotstreaks' },
  { id: 'act_10', name: 'Unstoppable', description: 'Reach a 10 night streak.', category: 'Activity', iconName: 'Trophy', glowColor: '#FF0055', target: 10, statKey: 'hotstreaks' },
  
  // Explorer (Based on unique venues attended)
  { id: 'exp_1', name: 'First Steps', description: 'Visit your first venue.', category: 'Explorer', iconName: 'MapPin', glowColor: '#4169E1', target: 1, statKey: 'venues' },
  { id: 'exp_5', name: 'Local Scout', description: 'Visit 5 different venues.', category: 'Explorer', iconName: 'Compass', glowColor: '#4169E1', target: 5, statKey: 'venues' },
  { id: 'exp_10', name: 'City Navigator', description: 'Visit 10 different venues.', category: 'Explorer', iconName: 'Map', glowColor: '#9D00FF', target: 10, statKey: 'venues' },
  { id: 'exp_25', name: 'Urban Legend', description: 'Visit 25 different venues.', category: 'Explorer', iconName: 'Globe', glowColor: '#FF00CC', target: 25, statKey: 'venues' },

  // Creator (Based on stories uploaded)
  { id: 'cre_1', name: 'First Frame', description: 'Upload your first story.', category: 'Creator', iconName: 'Camera', glowColor: '#00FFCC', target: 1, statKey: 'stories' },
  { id: 'cre_5', name: 'Paparazzi', description: 'Upload 5 stories.', category: 'Creator', iconName: 'Video', glowColor: '#FF00CC', target: 5, statKey: 'stories' },
  { id: 'cre_20', name: 'Director', description: 'Upload 20 stories.', category: 'Creator', iconName: 'Film', glowColor: '#FF0055', target: 20, statKey: 'stories' },

  // Social (Based on messages sent in venue chats)
  { id: 'soc_1', name: 'Ice Breaker', description: 'Send your first chat message.', category: 'Social', iconName: 'MessageCircle', glowColor: '#00FFCC', target: 1, statKey: 'chats' },
  { id: 'soc_10', name: 'Chatterbox', description: 'Send 10 messages in live chats.', category: 'Social', iconName: 'MessageSquare', glowColor: '#4169E1', target: 10, statKey: 'chats' },
  { id: 'soc_50', name: 'Socialite', description: 'Send 50 messages in live chats.', category: 'Social', iconName: 'Users', glowColor: '#FF00CC', target: 50, statKey: 'chats' },
];

/**
 * Checks if the user qualifies for any new achievements based on their current stats.
 * If so, updates their Firestore document with the new unlocks.
 */
export const checkAndUnlockAchievements = async (userId: string) => {
  if (!userId) return;

  try {
    const userDocRef = doc(firestore, 'users', userId);
    const docSnap = await getDoc(userDocRef);

    if (!docSnap.exists()) return;

    const data = docSnap.data();
    
    // Extract stats
    const hotstreaks = (data.activeNights || []).length;
    const venues = (data.attendedVenues || []).length;
    const stories = data.storyCount || 0;
    const chats = data.chatMessageCount || 0;
    
    const statsMap = { hotstreaks, venues, stories, chats };
    const unlockedAchievements: string[] = data.unlockedAchievements || [];
    
    const newUnlocks: string[] = [];

    // Check all achievements
    for (const achievement of ACHIEVEMENTS) {
      if (!unlockedAchievements.includes(achievement.id)) {
        const userStat = statsMap[achievement.statKey];
        if (userStat >= achievement.target) {
          newUnlocks.push(achievement.id);
        }
      }
    }

    if (newUnlocks.length > 0) {
      await updateDoc(userDocRef, {
        unlockedAchievements: arrayUnion(...newUnlocks),
        // If they don't have an active badge yet, set the most recent one as active
        ...( !data.activeBadge ? { activeBadge: newUnlocks[newUnlocks.length - 1] } : {} )
      });
      console.log('[Achievements] Unlocked new badges:', newUnlocks);
      // In a full app, you might trigger an in-app notification/toast here.
    }

  } catch (error) {
    console.error('[Achievements] Error checking achievements:', error);
  }
};
