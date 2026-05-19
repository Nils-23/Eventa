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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Trophy, Award, CircleUserRound, Clock, Flame, Wine } from 'lucide-react-native';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { firestore } from '../services/firebase';
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

export const LeaderboardScreen = () => {
  const [leaders, setLeaders] = useState<LeaderboardUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [countdown, setCountdown] = useState('');

  const currentMonthName = new Date().toLocaleString('default', { month: 'long' });
  const monthlyKey = getMonthlyPointsKey();

  const calculateCountdown = () => {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const diffMs = nextMonth.getTime() - now.getTime();
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    
    if (days > 0) {
      setCountdown(`Resets in ${days}d ${hours}h`);
    } else {
      setCountdown(`Resets in ${hours}h`);
    }
  };

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
      snap.forEach((doc) => {
        const data = doc.data();
        fetched.push({
          id: doc.id,
          username: data.username || 'Anonymous',
          points: data.points || 0,
          monthlyPoints: data[monthlyKey] || 0,
          activeBadge: data.activeBadge || null,
          unlockedAchievements: data.unlockedAchievements || [],
        });
      });
      
      // Filter out users who have 0 points to keep leaderboard active
      setLeaders(fetched.filter(u => u.monthlyPoints > 0));
    } catch (err) {
      console.error('[Leaderboard] Error fetching top users:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchLeaders();
    calculateCountdown();
    
    // Update countdown every hour
    const interval = setInterval(calculateCountdown, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchLeaders();
    calculateCountdown();
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
    let cardBorderColor = '#232323';
    let cardBgColor = '#131313';
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

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Monthly Rankings</Text>
          <Text style={styles.headerSub}>{currentMonthName} Leaderboard</Text>
        </View>
        <View style={styles.timerPill}>
          <Clock color="#00FFCC" size={14} />
          <Text style={styles.timerText}>{countdown}</Text>
        </View>
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
        <FlatList
          data={leaders}
          keyExtractor={(item) => item.id}
          renderItem={renderUserRow}
          contentContainerStyle={styles.list}
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
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
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
    backgroundColor: '#161616',
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
    backgroundColor: '#131313',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#232323',
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
});
