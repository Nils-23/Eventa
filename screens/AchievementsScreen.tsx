import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { firestore } from '../services/firebase';
import { useAppStore } from '../hooks/useAppStore';
import { ACHIEVEMENTS, AchievementCategory, Achievement } from '../services/achievementService';
import * as Icons from 'lucide-react-native';
import { ArrowLeft, CheckCircle2, Crown, Lock } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import Svg, { Path, Rect, Ellipse, G, Defs, LinearGradient, Stop } from 'react-native-svg';

const CATEGORIES: AchievementCategory[] = ['Activity', 'Explorer', 'Creator', 'Social', 'Personality'];

// ─── Bottle Definitions ─────────────────────────────────────────────────────
interface Bottle {
  id: string;
  name: string;
  subtitle: string;
  glowColor: string;
  gradientTop: string;
  gradientBottom: string;
  labelColor: string;
}

const BOTTLES: Bottle[] = [
  {
    id: 'bottle_jameson',
    name: 'Jameson',
    subtitle: 'Irish Whiskey',
    glowColor: '#D4A843',
    gradientTop: '#C8901E',
    gradientBottom: '#6B4A0A',
    labelColor: '#F5D878',
  },
  {
    id: 'bottle_hennessy',
    name: 'Hennessy',
    subtitle: 'Cognac V.S.O.P',
    glowColor: '#C0A060',
    gradientTop: '#8B6914',
    gradientBottom: '#4A3208',
    labelColor: '#E8C96A',
  },
  {
    id: 'bottle_martell',
    name: 'Martell',
    subtitle: 'Cordon Bleu',
    glowColor: '#6AAFFF',
    gradientTop: '#2C5FA0',
    gradientBottom: '#0D2847',
    labelColor: '#A8CFFF',
  },
];

// ─── SVG Bottle Icon Component ───────────────────────────────────────────────
const BottleIcon = ({ bottle, isUnlocked, size = 80 }: { bottle: Bottle; isUnlocked: boolean; size?: number }) => {
  const w = size * 0.45;
  const h = size;
  const gradId = `grad_${bottle.id}`;
  const color = isUnlocked ? bottle.gradientTop : '#333';
  const colorBottom = isUnlocked ? bottle.gradientBottom : '#222';
  const labelCol = isUnlocked ? bottle.labelColor : '#3A3A3A';
  const neckCol = isUnlocked ? bottle.gradientTop : '#2A2A2A';
  const capCol = isUnlocked ? '#FFD700' : '#2A2A2A';

  return (
    <Svg width={w} height={h} viewBox={`0 0 45 100`}>
      <Defs>
        <LinearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={isUnlocked ? bottle.gradientTop : '#333'} stopOpacity="1" />
          <Stop offset="0.5" stopColor={isUnlocked ? (bottle.gradientTop + 'CC') : '#2A2A2A'} stopOpacity="1" />
          <Stop offset="1" stopColor={colorBottom} stopOpacity="1" />
        </LinearGradient>
      </Defs>

      {/* Cap */}
      <Rect x="16" y="2" width="13" height="7" rx="2" fill={capCol} />
      {/* Foil strip */}
      <Rect x="14" y="8" width="17" height="3" rx="1" fill={isUnlocked ? '#C8A000' : '#222'} />

      {/* Neck */}
      <Path
        d="M17 11 L15 26 L30 26 L28 11 Z"
        fill={neckCol}
      />
      {/* Neck label band */}
      <Rect x="15" y="20" width="15" height="4" rx="1" fill={labelCol} opacity="0.6" />

      {/* Shoulder curve */}
      <Path
        d="M15 26 Q7 32 7 42 L7 85 Q7 93 22.5 93 Q38 93 38 85 L38 42 Q38 32 30 26 Z"
        fill={`url(#${gradId})`}
      />

      {/* Highlight sheen */}
      <Path
        d="M12 38 Q10 50 10 60 L12 60 Q12 50 14 38 Z"
        fill={isUnlocked ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.03)'}
      />

      {/* Label background */}
      <Rect x="11" y="48" width="23" height="28" rx="4" fill={isUnlocked ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.03)'} />
      {/* Label lines (decorative) */}
      <Rect x="13" y="52" width="19" height="2" rx="1" fill={labelCol} opacity="0.7" />
      <Rect x="15" y="56" width="15" height="1" rx="0.5" fill={labelCol} opacity="0.5" />
      <Rect x="13" y="60" width="19" height="2" rx="1" fill={labelCol} opacity="0.7" />
      <Rect x="16" y="64" width="13" height="1" rx="0.5" fill={labelCol} opacity="0.4" />
      <Rect x="14" y="68" width="17" height="2" rx="1" fill={labelCol} opacity="0.5" />

      {/* Bottom base */}
      <Ellipse cx="22.5" cy="89" rx="13" ry="4" fill={colorBottom} />
    </Svg>
  );
};

// ─── Screen Component ────────────────────────────────────────────────────────
export const AchievementsScreen = () => {
  const { user } = useAppStore();
  const navigation = useNavigation();
  const [unlockedIds, setUnlockedIds] = useState<string[]>([]);
  const [unlockedBottles, setUnlockedBottles] = useState<string[]>([]);
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
        setUnlockedBottles(data.unlockedBottles || []);
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

        {isActive ? (
          <View style={styles.activeOverlay}>
            <CheckCircle2 color="#00FFCC" size={16} />
            <Text style={styles.activeText}>Active</Text>
          </View>
        ) : null}
      </TouchableOpacity>
    );
  };

  // ── Nightlife Legend Bottle Section ──────────────────────────────────────
  const renderBottleSection = () => (
    <View style={styles.bottleSection}>
      {/* Header */}
      <View style={styles.bottleSectionHeader}>
        <Crown color="#FFD700" size={22} style={{ marginRight: 8 }} />
        <Text style={styles.bottleSectionTitle}>NIGHTLIFE LEGEND</Text>
        <Crown color="#FFD700" size={22} style={{ marginLeft: 8 }} />
      </View>

      {/* Description card */}
      <View style={styles.bottleDescCard}>
        <Text style={styles.bottleDescTitle}>🏆 Monthly Bottle Award</Text>
        <Text style={styles.bottleDescText}>
          Every month, Eventa rewards one Nightlife Legend by unlocking this achievement and offering them a real bottle of their choice — on us.
        </Text>
        <View style={styles.bottleDescBadge}>
          <Lock color="#888" size={11} />
          <Text style={styles.bottleDescBadgeText}>Admin-unlocked · Limited to 1 per month</Text>
        </View>
      </View>

      {/* Bottles row */}
      <View style={styles.bottlesRow}>
        {BOTTLES.map((bottle) => {
          const isUnlocked = unlockedBottles.includes(bottle.id);
          return (
            <View key={bottle.id} style={[styles.bottleCard, isUnlocked && styles.bottleCardUnlocked]}>
              {/* Glow aura when unlocked */}
              {isUnlocked && (
                <View style={[styles.bottleGlowAura, { shadowColor: bottle.glowColor }]} />
              )}

              <View style={styles.bottleIconWrapper}>
                <BottleIcon bottle={bottle} isUnlocked={isUnlocked} size={90} />
              </View>

              <Text style={[styles.bottleName, isUnlocked ? { color: bottle.glowColor } : styles.bottleNameLocked]}>
                {bottle.name}
              </Text>
              <Text style={styles.bottleSubtitle}>{bottle.subtitle}</Text>

              {isUnlocked ? (
                <View style={[styles.bottleUnlockedTag, { borderColor: bottle.glowColor }]}>
                  <CheckCircle2 color={bottle.glowColor} size={11} />
                  <Text style={[styles.bottleUnlockedTagText, { color: bottle.glowColor }]}>Earned</Text>
                </View>
              ) : (
                <View style={styles.bottleLockedTag}>
                  <Lock color="#555" size={10} />
                  <Text style={styles.bottleLockedTagText}>Locked</Text>
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );

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
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.subtitle}>
          Earn badges by exploring the city and socializing. Tap an unlocked badge to set it as your status symbol.
        </Text>

        {/* ── Nightlife Legend Bottles ── */}
        {renderBottleSection()}

        {/* ── Standard Achievement Categories ── */}
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

  // ── Bottle Section ─────────────────────────────────────────────────────────
  bottleSection: {
    marginBottom: 36,
    backgroundColor: '#0D0D0D',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#2A1F00',
    overflow: 'hidden',
    paddingBottom: 20,
  },
  bottleSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255, 215, 0, 0.06)',
    borderBottomWidth: 1,
    borderBottomColor: '#2A1F00',
  },
  bottleSectionTitle: {
    color: '#FFD700',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 2.5,
  },
  bottleDescCard: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: '#1A1500',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2E2200',
  },
  bottleDescTitle: {
    color: '#FFD700',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  bottleDescText: {
    color: '#AAA',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 10,
  },
  bottleDescBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  bottleDescBadgeText: {
    color: '#666',
    fontSize: 10,
    fontStyle: 'italic',
  },

  // Bottles Row
  bottlesRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 10,
    marginTop: 20,
  },
  bottleCard: {
    alignItems: 'center',
    width: '30%',
    backgroundColor: '#141414',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#222',
    position: 'relative',
    overflow: 'visible',
  },
  bottleCardUnlocked: {
    borderColor: '#3A2E00',
    backgroundColor: '#181300',
  },
  bottleGlowAura: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 18,
    elevation: 12,
  },
  bottleIconWrapper: {
    marginBottom: 10,
    alignItems: 'center',
  },
  bottleName: {
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  bottleNameLocked: {
    color: '#444',
  },
  bottleSubtitle: {
    fontSize: 9,
    color: '#555',
    textAlign: 'center',
    marginTop: 2,
    marginBottom: 8,
  },
  bottleUnlockedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: 'rgba(255,215,0,0.05)',
  },
  bottleUnlockedTagText: {
    fontSize: 9,
    fontWeight: '700',
  },
  bottleLockedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#1A1A1A',
  },
  bottleLockedTagText: {
    color: '#555',
    fontSize: 9,
    fontWeight: '600',
  },

  // ── Standard Achievement Styles ────────────────────────────────────────────
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
  },
});
