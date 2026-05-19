import { doc, getDoc, updateDoc, arrayUnion, increment } from 'firebase/firestore';
import { firestore } from './firebase';
import { getMonthlyPointsKey } from './userService';

export type AchievementCategory = 'Activity' | 'Explorer' | 'Creator' | 'Social' | 'Personality';

export interface Achievement {
  id: string;
  name: string;
  description: string;
  category: AchievementCategory;
  iconName: string; // Lucide icon name or image ref
  glowColor: string; // Neon color for UI
  target: number; // Value needed to unlock
  statKey: 'points' | 'venues' | 'stories' | 'chats'; // The user stat to compare against
}

export const ACHIEVEMENTS: Achievement[] = [
  // Activity (Based on points)
  { id: 'act_1', name: 'Getting Started', description: 'Earn your first 10 points.', category: 'Activity', iconName: 'Moon', glowColor: '#00FFCC', target: 10, statKey: 'points' },
  { id: 'act_3', name: 'Rising Star', description: 'Reach 50 points.', category: 'Activity', iconName: 'Zap', glowColor: '#00FFCC', target: 50, statKey: 'points' },
  { id: 'act_5', name: 'Party Animal', description: 'Reach 100 points.', category: 'Activity', iconName: 'Flame', glowColor: '#FF5E00', target: 100, statKey: 'points' },
  { id: 'act_10', name: 'Unstoppable', description: 'Reach 250 points.', category: 'Activity', iconName: 'Trophy', glowColor: '#FF0055', target: 250, statKey: 'points' },
  
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

  // Admin / Special
  { id: 'cert_1', name: 'Eventas Certified', description: 'Official certification of prestige. Recognized by Eventas.', category: 'Personality', iconName: 'BadgeCheck', glowColor: '#FFD700', target: 999999, statKey: 'points' },
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
    const points = data.points || 0;
    const venues = (data.attendedVenues || []).length;
    const stories = data.storyCount || 0;
    const chats = data.chatMessageCount || 0;
    
    const statsMap = { points, venues, stories, chats };
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
      const pointsToAward = newUnlocks.length * 10;
      const monthlyKey = getMonthlyPointsKey();
      await updateDoc(userDocRef, {
        unlockedAchievements: arrayUnion(...newUnlocks),
        points: increment(pointsToAward),
        [monthlyKey]: increment(pointsToAward),
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

/**
 * Admin function to manually grant the prestige certification badge to a user.
 */
export const grantCertificationBadge = async (userId: string) => {
  try {
    const userDocRef = doc(firestore, 'users', userId);
    await updateDoc(userDocRef, {
      unlockedAchievements: arrayUnion('cert_1'),
      activeBadge: 'cert_1'
    });
    console.log(`[Admin] Successfully certified user ${userId}`);
  } catch (error) {
    console.error('[Admin] Error granting certification badge:', error);
    throw error;
  }
};

// ─── Bottle Award Admin Functions ─────────────────────────────────────────────

export const BOTTLE_IDS = ['bottle_jameson', 'bottle_hennessy', 'bottle_martell'] as const;
export type BottleId = typeof BOTTLE_IDS[number];

/**
 * Admin function to grant a specific bottle reward to the monthly Nightlife Legend.
 */
export const grantBottleReward = async (userId: string, bottleId: BottleId) => {
  try {
    const userDocRef = doc(firestore, 'users', userId);
    await updateDoc(userDocRef, {
      unlockedBottles: arrayUnion(bottleId),
    });
    console.log(`[Admin] Granted bottle '${bottleId}' to user ${userId}`);
  } catch (error) {
    console.error('[Admin] Error granting bottle reward:', error);
    throw error;
  }
};

/**
 * Admin function to revoke a specific bottle reward from a user.
 */
export const revokeBottleReward = async (userId: string, bottleId: BottleId) => {
  try {
    const userDocRef = doc(firestore, 'users', userId);
    const docSnap = await getDoc(userDocRef);
    if (!docSnap.exists()) return;

    const data = docSnap.data();
    const unlockedBottles: string[] = (data.unlockedBottles || []).filter((b: string) => b !== bottleId);
    await updateDoc(userDocRef, { unlockedBottles });
    console.log(`[Admin] Revoked bottle '${bottleId}' from user ${userId}`);
  } catch (error) {
    console.error('[Admin] Error revoking bottle reward:', error);
    throw error;
  }
};

/**
 * Admin function to manually revoke the prestige certification badge from a user.
 */
export const revokeCertificationBadge = async (userId: string) => {
  try {
    const userDocRef = doc(firestore, 'users', userId);
    const docSnap = await getDoc(userDocRef);
    if (!docSnap.exists()) return;
    
    const data = docSnap.data();
    let unlockedAchievements = data.unlockedAchievements || [];
    unlockedAchievements = unlockedAchievements.filter((id: string) => id !== 'cert_1');
    
    const updates: any = { unlockedAchievements };
    if (data.activeBadge === 'cert_1') {
      updates.activeBadge = null;
    }
    
    await updateDoc(userDocRef, updates);
    console.log(`[Admin] Successfully revoked certification from user ${userId}`);
  } catch (error) {
    console.error('[Admin] Error revoking certification badge:', error);
    throw error;
  }
};
