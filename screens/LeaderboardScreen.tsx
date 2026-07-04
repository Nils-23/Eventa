import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
  RefreshControl,
  Modal,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Trophy, Award, CircleUserRound, Flame, Wine, Info, X, MapPin, Share2 } from 'lucide-react-native';
import { collection, query, orderBy, limit, getDocs, doc, getDoc, startAfter, where, getCountFromServer } from 'firebase/firestore';
import { auth, firestore } from '../services/firebase';
import { getMonthlyPointsKey } from '../services/userService';
import { ACHIEVEMENTS } from '../services/achievementService';
import * as Icons from 'lucide-react-native';

interface LeaderboardUser {
  id: string;
  username: string;
  points: number;
  monthlyPoints: number;
  activeBadge?: string | null;
  unlockedAchievements?: string[];
}

interface RankedUserInfo {
  id: string;
  username: string;
  points: number;
  monthlyPoints: number;
  activeBadge?: string | null;
  unlockedAchievements?: string[];
  rank: number;
}

export const LeaderboardScreen = () => {
  const [leaders, setLeaders] = useState<LeaderboardUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // User standing and target competitor states
  const [currentUserRanked, setCurrentUserRanked] = useState<RankedUserInfo | null>(null);
  const [aboveUserRanked, setAboveUserRanked] = useState<RankedUserInfo | null>(null);
  const [showInfoModal, setShowInfoModal] = useState(false);

  const currentMonthName = new Date().toLocaleString('default', { month: 'long' });
  const monthlyKey = getMonthlyPointsKey();

  const fetchLeaders = async () => {
    try {
      // Query top 10 users by current monthly points key
      const q = query(
        collection(firestore, 'users'),
        orderBy(monthlyKey, 'desc'),
        limit(10)
      );
      
      const snap = await getDocs(q);
      const fetched: LeaderboardUser[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        fetched.push({
          id: docSnap.id,
          username: data.username || 'Anonymous',
          points: data.points || 0,
          monthlyPoints: data[monthlyKey] || 0,
          activeBadge: data.activeBadge || null,
          unlockedAchievements: data.unlockedAchievements || [],
        });
      });
      
      // Filter out users who have 0 points to keep leaderboard active
      setLeaders(fetched.filter(u => u.monthlyPoints > 0));

      // Fetch active user standing
      const currentUser = auth.currentUser;
      if (currentUser) {
        const userDocRef = doc(firestore, 'users', currentUser.uid);
        const userDocSnap = await getDoc(userDocRef);
        
        if (userDocSnap.exists()) {
          const userData = userDocSnap.data();
          const userMonthlyPoints = userData[monthlyKey] || 0;
          
          if (userMonthlyPoints > 0) {
            // Count users with more monthly points to calculate current rank
            const rankQuery = query(
              collection(firestore, 'users'),
              where(monthlyKey, '>', userMonthlyPoints)
            );
            const rankSnap = await getCountFromServer(rankQuery);
            const userRank = rankSnap.data().count + 1;
            
            const userRankedInfo: RankedUserInfo = {
              id: currentUser.uid,
              username: userData.username || 'You',
              points: userData.points || 0,
              monthlyPoints: userMonthlyPoints,
              activeBadge: userData.activeBadge || null,
              unlockedAchievements: userData.unlockedAchievements || [],
              rank: userRank
            };
            setCurrentUserRanked(userRankedInfo);

            // Fetch the competitor immediately above current user
            const aboveQuery = query(
              collection(firestore, 'users'),
              orderBy(monthlyKey, 'asc'),
              startAfter(userDocSnap),
              limit(1)
            );
            const aboveSnap = await getDocs(aboveQuery);
            
            if (!aboveSnap.empty) {
              const aboveDoc = aboveSnap.docs[0];
              const aboveData = aboveDoc.data();
              const aboveMonthlyPoints = aboveData[monthlyKey] || 0;
              
              // Calculate above user's rank
              const aboveRankQuery = query(
                collection(firestore, 'users'),
                where(monthlyKey, '>', aboveMonthlyPoints)
              );
              const aboveRankSnap = await getCountFromServer(aboveRankQuery);
              const aboveRank = aboveRankSnap.data().count + 1;

              setAboveUserRanked({
                id: aboveDoc.id,
                username: aboveData.username || 'Anonymous',
                points: aboveData.points || 0,
                monthlyPoints: aboveMonthlyPoints,
                activeBadge: aboveData.activeBadge || null,
                unlockedAchievements: aboveData.unlockedAchievements || [],
                rank: aboveRank
              });
            } else {
              setAboveUserRanked(null); // No user above (Current user is rank #1)
            }
          } else {
            // User has 0 monthly points and is unranked
            setCurrentUserRanked({
              id: currentUser.uid,
              username: userData.username || 'You',
              points: userData.points || 0,
              monthlyPoints: 0,
              activeBadge: userData.activeBadge || null,
              unlockedAchievements: userData.unlockedAchievements || [],
              rank: 0
            });

            // Target the lowest active user with points on the leaderboard
            const lowestQuery = query(
              collection(firestore, 'users'),
              where(monthlyKey, '>', 0),
              orderBy(monthlyKey, 'asc'),
              limit(1)
            );
            const lowestSnap = await getDocs(lowestQuery);
            if (!lowestSnap.empty) {
              const lowestDoc = lowestSnap.docs[0];
              const lowestData = lowestDoc.data();
              const lowestMonthlyPoints = lowestData[monthlyKey] || 0;

              const lowestRankQuery = query(
                collection(firestore, 'users'),
                where(monthlyKey, '>', lowestMonthlyPoints)
              );
              const lowestRankSnap = await getCountFromServer(lowestRankQuery);
              const lowestRank = lowestRankSnap.data().count + 1;

              setAboveUserRanked({
                id: lowestDoc.id,
                username: lowestData.username || 'Anonymous',
                points: lowestData.points || 0,
                monthlyPoints: lowestMonthlyPoints,
                activeBadge: lowestData.activeBadge || null,
                unlockedAchievements: lowestData.unlockedAchievements || [],
                rank: lowestRank
              });
            } else {
              setAboveUserRanked(null);
            }
          }
        }
      }
    } catch (err) {
      console.error('[Leaderboard] Error fetching top users & rank details:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchLeaders();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchLeaders();
  };

  const renderActiveBadge = (badgeId: string | null | undefined) => {
    if (!badgeId) return null;
    const badge = ACHIEVEMENTS.find((a) => a.id === badgeId);
    if (!badge) return null;
    
    // @ts-ignore
    const Icon = Icons[badge.iconName] || Icons.Award;
    return (
      <View style={[styles.badgePill, { borderColor: badge.glowColor + '44' }]}>
        <Icon color={badge.glowColor} size={11} />
        <Text style={[styles.badgeText, { color: badge.glowColor }]} numberOfLines={1}>
          {badge.name}
        </Text>
      </View>
    );
  };

  const renderUserRow = ({ item, index }: { item: LeaderboardUser; index: number }) => {
    const isTop3 = index < 3;
    let rankColor = '#888888';
    let cardBorderColor = '#2A2A2A';
    let cardBgColor = '#1A1A1A';
    let glowStyle = {};

    if (index === 0) {
      rankColor = '#FFD700'; // Gold
      cardBorderColor = 'rgba(255, 215, 0, 0.3)';
      cardBgColor = 'rgba(255, 215, 0, 0.03)';
      glowStyle = { textShadowColor: '#FFD700', textShadowRadius: 8 };
    } else if (index === 1) {
      rankColor = '#C0C0C0'; // Silver
      cardBorderColor = 'rgba(192, 192, 192, 0.2)';
      cardBgColor = 'rgba(192, 192, 192, 0.02)';
      glowStyle = { textShadowColor: '#C0C0C0', textShadowRadius: 6 };
    } else if (index === 2) {
      rankColor = '#CD7F32'; // Bronze
      cardBorderColor = 'rgba(205, 127, 50, 0.15)';
      cardBgColor = 'rgba(205, 127, 50, 0.01)';
      glowStyle = { textShadowColor: '#CD7F32', textShadowRadius: 6 };
    }

    return (
      <View style={[styles.card, { borderColor: cardBorderColor, backgroundColor: cardBgColor }]}>
        <View style={styles.rankCol}>
          <Text style={[styles.rankNum, { color: rankColor }, glowStyle]}>
            {index + 1}
          </Text>
        </View>

        <CircleUserRound color={isTop3 ? rankColor : '#666'} size={40} strokeWidth={1} style={styles.avatar} />

        <View style={styles.infoCol}>
          <Text style={styles.username} numberOfLines={1}>
            {item.username}
          </Text>
          <View style={styles.badgeRow}>
            {renderActiveBadge(item.activeBadge)}
          </View>
        </View>

        <View style={styles.pointsCol}>
          <Text style={[styles.pointsVal, isTop3 && { color: rankColor }]}>
            {item.monthlyPoints}
          </Text>
          <Text style={styles.pointsLabel}>PTS</Text>
        </View>
      </View>
    );
  };

  const renderStandingRow = (item: RankedUserInfo, isCurrentUser: boolean, isTarget: boolean) => {
    const isTop3 = item.rank > 0 && item.rank <= 3;
    let rankColor = '#888888';
    let glowStyle = {};

    if (item.rank === 1) {
      rankColor = '#FFD700';
      glowStyle = { textShadowColor: '#FFD700', textShadowRadius: 8 };
    } else if (item.rank === 2) {
      rankColor = '#C0C0C0';
      glowStyle = { textShadowColor: '#C0C0C0', textShadowRadius: 6 };
    } else if (item.rank === 3) {
      rankColor = '#CD7F32';
      glowStyle = { textShadowColor: '#CD7F32', textShadowRadius: 6 };
    } else if (isCurrentUser) {
      rankColor = '#00FFCC';
    }

    return (
      <View style={[styles.standingRow, isCurrentUser && styles.standingRowCurrent]}>
        <View style={styles.rankCol}>
          <Text style={[styles.rankNumSmall, { color: rankColor }, glowStyle]}>
            {item.rank > 0 ? `#${item.rank}` : '-'}
          </Text>
        </View>

        <CircleUserRound color={isCurrentUser ? '#00FFCC' : (isTop3 ? rankColor : '#666')} size={32} strokeWidth={1} style={styles.avatarSmall} />

        <View style={styles.infoCol}>
          <View style={styles.nameRow}>
            <Text style={[styles.usernameSmall, isCurrentUser && { color: '#00FFCC', fontWeight: '800' }]} numberOfLines={1}>
              {item.username} {isCurrentUser && '(You)'}
            </Text>
            {isTarget && (
              <View style={styles.targetBadge}>
                <Text style={styles.targetBadgeText}>NEXT UP</Text>
              </View>
            )}
          </View>
          <View style={styles.badgeRow}>
            {renderActiveBadge(item.activeBadge)}
          </View>
        </View>

        <View style={styles.pointsColSmall}>
          <Text style={[styles.pointsValSmall, isCurrentUser && { color: '#00FFCC' }]}>
            {item.monthlyPoints}
          </Text>
          <Text style={styles.pointsLabel}>PTS</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Monthly Rankings</Text>
          <Text style={styles.headerSub}>{currentMonthName} Leaderboard</Text>
        </View>
        <TouchableOpacity 
          style={styles.infoButton} 
          onPress={() => setShowInfoModal(true)}
          activeOpacity={0.7}
        >
          <Info color="#00FFCC" size={20} />
        </TouchableOpacity>
      </View>

      {/* Top reward promo card */}
      <View style={styles.promoCard}>
        <View style={styles.promoIconWrap}>
          <Wine color="#FFD700" size={26} />
        </View>
        <View style={styles.promoContent}>
          <Text style={styles.promoTitle}>Monthly Legend Prize</Text>
          <Text style={styles.promoDesc}>
            Finish at Rank #1 this month to win a premium bottle 🍾 of your choice (Hennessy, Jameson, or Martell).
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator color="#00FFCC" size="large" />
          <Text style={styles.loadingText}>Fetching Nairobi's finest…</Text>
        </View>
      ) : leaders.length === 0 ? (
        <View style={styles.centerContainer}>
          <Trophy color="#333" size={60} style={{ marginBottom: 12 }} />
          <Text style={styles.emptyTitle}>Leaderboard is quiet</Text>
          <Text style={styles.emptyText}>
            No points earned yet this month. Attend venues and unlock achievements to claim the first spot!
          </Text>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <FlatList
            data={leaders}
            keyExtractor={(item) => item.id}
            renderItem={renderUserRow}
            contentContainerStyle={[
              styles.list,
              currentUserRanked && { paddingBottom: 170 }
            ]}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor="#00FFCC"
                colors={['#00FFCC']}
              />
            }
          />

          {/* User standing sticky panel */}
          {currentUserRanked && (
            <View style={styles.standingPanel}>
              <Text style={styles.standingTitle}>Your Standing</Text>
              
              {aboveUserRanked ? (
                renderStandingRow(aboveUserRanked, false, true)
              ) : (
                currentUserRanked.rank === 1 ? (
                  <View style={styles.topStatusRow}>
                    <Trophy color="#FFD700" size={16} />
                    <Text style={styles.topStatusText}>You are currently in 1st place! Keep it up! 👑</Text>
                  </View>
                ) : null
              )}

              {aboveUserRanked && <View style={styles.standingDivider} />}

              {renderStandingRow(currentUserRanked, true, false)}
            </View>
          )}
        </View>
      )}

      {/* Info Modal */}
      <Modal
        visible={showInfoModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowInfoModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <Trophy color="#FFD700" size={22} style={{ marginRight: 8 }} />
                <Text style={styles.modalTitle}>How Points Work</Text>
              </View>
              <TouchableOpacity onPress={() => setShowInfoModal(false)} style={styles.modalCloseButton}>
                <X color="#888" size={20} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              <Text style={styles.modalIntro}>
                Earn leaderboard points every month to claim the crown! The standings reset at the beginning of each calendar month.
              </Text>

              <View style={styles.ruleCard}>
                <View style={[styles.ruleIconContainer, { backgroundColor: 'rgba(0, 255, 204, 0.1)' }]}>
                  <MapPin color="#00FFCC" size={22} />
                </View>
                <View style={styles.ruleInfo}>
                  <View style={styles.ruleTitleRow}>
                    <Text style={styles.ruleTitle}>Venue Check-In</Text>
                    <View style={[styles.pointsPill, { backgroundColor: 'rgba(0, 255, 204, 0.15)', borderColor: '#00FFCC' }]}>
                      <Text style={[styles.pointsPillText, { color: '#00FFCC' }]}>+10 PTS</Text>
                    </View>
                  </View>
                  <Text style={styles.ruleDesc}>
                    Visit any popular nightlife venue on the map (within 200 meters). Earn points once per venue per day.
                  </Text>
                </View>
              </View>

              <View style={styles.ruleCard}>
                <View style={[styles.ruleIconContainer, { backgroundColor: 'rgba(157, 0, 255, 0.1)' }]}>
                  <Award color="#9D00FF" size={22} />
                </View>
                <View style={styles.ruleInfo}>
                  <View style={styles.ruleTitleRow}>
                    <Text style={styles.ruleTitle}>Unlock Badges</Text>
                    <View style={[styles.pointsPill, { backgroundColor: 'rgba(157, 0, 255, 0.15)', borderColor: '#9D00FF' }]}>
                      <Text style={[styles.pointsPillText, { color: '#9D00FF' }]}>+10 PTS</Text>
                    </View>
                  </View>
                  <Text style={styles.ruleDesc}>
                    Reach activity milestones, post stories, visit new venues, or participate in chats to unlock special profile badges.
                  </Text>
                </View>
              </View>

              <View style={styles.ruleCard}>
                <View style={[styles.ruleIconContainer, { backgroundColor: 'rgba(255, 94, 0, 0.1)' }]}>
                  <Share2 color="#FF5E00" size={22} />
                </View>
                <View style={styles.ruleInfo}>
                  <View style={styles.ruleTitleRow}>
                    <Text style={styles.ruleTitle}>Refer Friends</Text>
                    <View style={[styles.pointsPill, { backgroundColor: 'rgba(255, 94, 0, 0.15)', borderColor: '#FF5E00' }]}>
                      <Text style={[styles.pointsPillText, { color: '#FF5E00' }]}>+20 PTS</Text>
                    </View>
                  </View>
                  <Text style={styles.ruleDesc}>
                    Invite others to join Eventa. You'll receive points as soon as they attend and check into their first venue!
                  </Text>
                </View>
              </View>
              
              <View style={styles.modalFooter}>
                <Wine color="#FFD700" size={16} />
                <Text style={styles.modalFooterText}>Top monthly rankings win premium rewards! 🍾</Text>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  headerSub: {
    fontSize: 13,
    color: '#888888',
    marginTop: 3,
  },
  timerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  timerText: {
    color: '#00FFCC',
    fontSize: 12,
    fontWeight: '700',
  },
  promoCard: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 215, 0, 0.08)',
    borderColor: 'rgba(255, 215, 0, 0.2)',
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 24,
    marginBottom: 20,
    alignItems: 'center',
    gap: 16,
  },
  promoIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 215, 0, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  promoContent: {
    flex: 1,
  },
  promoTitle: {
    color: '#FFD700',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  promoDesc: {
    color: '#CCCCCC',
    fontSize: 12,
    lineHeight: 18,
  },
  list: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  sep: {
    height: 10,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    gap: 12,
  },
  rankCol: {
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankNum: {
    fontSize: 20,
    fontWeight: '800',
  },
  trophyIcon: {
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 5,
  },
  avatar: {
    marginRight: 2,
  },
  infoCol: {
    flex: 1,
  },
  username: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  badgeRow: {
    flexDirection: 'row',
  },
  badgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    maxWidth: 120,
  },
  pointsCol: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    minWidth: 50,
  },
  pointsVal: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  pointsLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: '#666666',
    marginTop: 1,
    letterSpacing: 0.5,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    gap: 8,
  },
  loadingText: {
    color: '#555555',
    fontSize: 14,
    fontWeight: '500',
    marginTop: 8,
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 12,
  },
  emptyText: {
    color: '#666666',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },
  infoButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  standingPanel: {
    backgroundColor: '#111111',
    borderTopWidth: 1,
    borderTopColor: '#2A2A2A',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 24,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 20,
  },
  standingTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#888888',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  standingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    gap: 10,
  },
  standingRowCurrent: {
    backgroundColor: 'rgba(0, 255, 204, 0.04)',
    paddingHorizontal: 8,
    marginHorizontal: -8,
  },
  standingDivider: {
    height: 1,
    backgroundColor: '#2A2A2A',
    marginVertical: 4,
  },
  rankNumSmall: {
    fontSize: 15,
    fontWeight: '800',
  },
  avatarSmall: {
    marginRight: 0,
  },
  usernameSmall: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  targetBadge: {
    backgroundColor: 'rgba(255, 94, 0, 0.15)',
    borderColor: 'rgba(255, 94, 0, 0.3)',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  targetBadgeText: {
    color: '#FF8800',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  pointsColSmall: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    minWidth: 45,
  },
  pointsValSmall: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  topStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 215, 0, 0.05)',
    borderColor: 'rgba(255, 215, 0, 0.2)',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    gap: 8,
    marginBottom: 4,
  },
  topStatusText: {
    color: '#FFD700',
    fontSize: 12,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: '#121212',
    borderColor: '#2A2A2A',
    borderWidth: 1,
    borderRadius: 24,
    width: '100%',
    maxHeight: '80%',
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
    paddingBottom: 16,
    marginBottom: 16,
  },
  modalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  modalCloseButton: {
    padding: 4,
  },
  modalScroll: {
    flexGrow: 0,
  },
  modalIntro: {
    fontSize: 14,
    lineHeight: 22,
    color: '#CCCCCC',
    marginBottom: 20,
  },
  ruleCard: {
    flexDirection: 'row',
    backgroundColor: '#1A1A1A',
    borderColor: '#262626',
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    gap: 14,
  },
  ruleIconContainer: {
    width: 42,
    height: 42,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ruleInfo: {
    flex: 1,
  },
  ruleTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  ruleTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  pointsPill: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  pointsPillText: {
    fontSize: 10,
    fontWeight: '800',
  },
  ruleDesc: {
    fontSize: 12,
    lineHeight: 18,
    color: '#888888',
  },
  modalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
    paddingVertical: 12,
    backgroundColor: 'rgba(255, 215, 0, 0.05)',
    borderColor: 'rgba(255, 215, 0, 0.15)',
    borderWidth: 1,
    borderRadius: 12,
  },
  modalFooterText: {
    color: '#FFD700',
    fontSize: 12,
    fontWeight: '600',
  },
});
