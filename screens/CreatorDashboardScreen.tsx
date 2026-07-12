/**
 * CreatorDashboardScreen — creator-only home for referral performance and
 * event attendance. Gated in real time by useCreatorStatus: if an admin
 * revokes creator status while this screen is open, it locks immediately.
 *
 * Future creator modules (profile views, insights, brand campaigns) should be
 * added as new sections here, reading from their own collections.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator,
  Share, Clipboard, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft, Copy, Share2, BadgeCheck, MousePointerClick, Download,
  UserPlus, MapPin, Trophy, CalendarCheck, Lock, Eye, LineChart,
} from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import Toast from 'react-native-toast-message';
import { useAppStore } from '../hooks/useAppStore';
import { useCreatorStatus } from '../hooks/useCreatorStatus';
import {
  CreatorStats, CreatorAttendance, fetchCreatorStats, fetchMyAttendance,
  buildReferralLink,
} from '../services/creatorService';

export const CreatorDashboardScreen = () => {
  const navigation = useNavigation<any>();
  const user = useAppStore((s) => s.user);
  const { loading: statusLoading, isCreator, creatorProfile } = useCreatorStatus();

  const [stats, setStats] = useState<CreatorStats | null>(null);
  const [attendance, setAttendance] = useState<CreatorAttendance[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user?.uid) return;
    try {
      const [s, a] = await Promise.all([
        fetchCreatorStats(user.uid),
        fetchMyAttendance(user.uid),
      ]);
      setStats(s);
      setAttendance(a);
    } catch (err) {
      console.warn('[CreatorDashboard] load failed:', err);
    }
  }, [user?.uid]);

  useEffect(() => { if (isCreator) load(); }, [isCreator, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (statusLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.center}><ActivityIndicator color="#00FFCC" size="large" /></View>
      </SafeAreaView>
    );
  }

  // Revocation / non-creator lock — creator features are inaccessible the
  // moment accountType flips, even mid-session.
  if (!isCreator || !creatorProfile) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <ArrowLeft color="#FFFFFF" size={24} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Creator Dashboard</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.center}>
          <Lock color="#666" size={40} />
          <Text style={styles.lockedText}>
            Creator features are only available to approved Creator accounts.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const referralLink = buildReferralLink(creatorProfile.referralCode);
  const verifiedCount = attendance.filter((a) => a.verified).length;

  const handleCopyLink = () => {
    Clipboard.setString(referralLink);
    Toast.show({ type: 'success', text1: 'Link Copied' });
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Join me on Eventas! Download the app with my link: ${referralLink}`,
      });
    } catch {}
  };

  const statTiles = [
    { label: 'Link Clicks', value: stats?.totalClicks ?? 0, Icon: MousePointerClick, color: '#00FFCC' },
    { label: 'App Installs', value: stats?.validInstalls ?? 0, Icon: Download, color: '#A78BFA' },
    { label: 'Registrations', value: stats?.totalSignups ?? 0, Icon: UserPlus, color: '#FF00CC' },
    { label: 'First Venue Visits', value: stats?.firstVisits ?? 0, Icon: MapPin, color: '#FFD700' },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <ArrowLeft color="#FFFFFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Creator Dashboard</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00FFCC" />}
      >
        {/* Identity */}
        <View style={styles.identityRow}>
          <BadgeCheck color="#00FFCC" size={26} />
          <View>
            <Text style={styles.creatorName}>{creatorProfile.creatorName}</Text>
            <Text style={styles.categoryText}>{creatorProfile.category} Creator</Text>
          </View>
        </View>

        {/* Referral link */}
        <Text style={styles.sectionTitle}>Your Referral Link</Text>
        <View style={styles.linkCard}>
          <Text style={styles.linkText} numberOfLines={1}>{referralLink}</Text>
          <Text style={styles.codeText}>Code: {creatorProfile.referralCode}</Text>
          <View style={styles.linkActions}>
            <TouchableOpacity style={styles.linkButton} onPress={handleCopyLink}>
              <Copy color="#00FFCC" size={16} />
              <Text style={styles.linkButtonText}>Copy Link</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.linkButton} onPress={handleShare}>
              <Share2 color="#00FFCC" size={16} />
              <Text style={styles.linkButtonText}>Share</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Referral stats */}
        <Text style={styles.sectionTitle}>Referral Statistics</Text>
        <View style={styles.tileGrid}>
          {statTiles.map(({ label, value, Icon, color }) => (
            <View key={label} style={styles.tile}>
              <Icon color={color} size={20} />
              <Text style={styles.tileValue}>{value}</Text>
              <Text style={styles.tileLabel}>{label}</Text>
            </View>
          ))}
        </View>
        <View style={styles.totalCard}>
          <Trophy color="#FFD700" size={20} />
          <Text style={styles.totalText}>
            {stats?.totalSignups ?? 0} successful referral{(stats?.totalSignups ?? 0) === 1 ? '' : 's'}
          </Text>
          <Text style={styles.rewardsHint}>Rewards coming soon</Text>
        </View>

        {/* Attendance history */}
        <Text style={styles.sectionTitle}>Event Attendance</Text>
        {attendance.length === 0 ? (
          <Text style={styles.emptyText}>
            Tap "I'm Going" on any event to appear in its Creators Attending section.
          </Text>
        ) : (
          <>
            <Text style={styles.attendanceSummary}>
              {attendance.length} declared · {verifiedCount} verified on location
            </Text>
            {attendance.map((a) => (
              <View key={`${a.eventId}_${a.createdAt}`} style={styles.attendanceRow}>
                <CalendarCheck color={a.verified ? '#00FFCC' : '#888'} size={18} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.attendanceName} numberOfLines={1}>{a.eventName}</Text>
                  <Text style={styles.attendanceDate}>
                    {new Date(a.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </Text>
                </View>
                <View style={[styles.verifyChip, a.verified && styles.verifyChipOn]}>
                  <Text style={[styles.verifyChipText, a.verified && styles.verifyChipTextOn]}>
                    {a.verified ? 'VERIFIED' : 'DECLARED'}
                  </Text>
                </View>
              </View>
            ))}
          </>
        )}

        {/* Future modules */}
        <Text style={styles.sectionTitle}>Coming Soon</Text>
        <View style={styles.futureRow}>
          <View style={styles.futureTile}>
            <Eye color="#555" size={18} />
            <Text style={styles.futureText}>Profile Views</Text>
          </View>
          <View style={styles.futureTile}>
            <LineChart color="#555" size={18} />
            <Text style={styles.futureText}>Creator Insights</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: '#2A2A2A',
  },
  backButton: { padding: 4 },
  headerTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  lockedText: { color: '#888', fontSize: 14, textAlign: 'center', lineHeight: 21 },
  content: { padding: 24, paddingBottom: 60 },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  creatorName: { color: '#FFF', fontSize: 22, fontWeight: '800' },
  categoryText: { color: '#00FFCC', fontSize: 13, fontWeight: '600', marginTop: 2 },
  sectionTitle: {
    fontSize: 13, color: '#888', textTransform: 'uppercase', letterSpacing: 1,
    fontWeight: '600', marginTop: 28, marginBottom: 12,
  },
  linkCard: {
    backgroundColor: '#1A1A1A', borderRadius: 14, borderWidth: 1, borderColor: '#2A2A2A',
    padding: 16,
  },
  linkText: { color: '#FFF', fontSize: 14, fontWeight: '600' },
  codeText: { color: '#00FFCC', fontSize: 13, marginTop: 4, fontWeight: '700' },
  linkActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  linkButton: {
    flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(0, 255, 204, 0.4)', borderRadius: 10, paddingVertical: 10,
    backgroundColor: 'rgba(0, 255, 204, 0.06)',
  },
  linkButtonText: { color: '#00FFCC', fontSize: 13, fontWeight: '700' },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    width: '48%', flexGrow: 1, backgroundColor: '#1A1A1A', borderRadius: 12,
    borderWidth: 1, borderColor: '#2A2A2A', padding: 16, gap: 6,
  },
  tileValue: { color: '#FFF', fontSize: 24, fontWeight: '800' },
  tileLabel: { color: '#888', fontSize: 12 },
  totalCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10,
    backgroundColor: 'rgba(255, 215, 0, 0.06)', borderColor: 'rgba(255, 215, 0, 0.25)',
    borderWidth: 1, borderRadius: 12, padding: 14,
  },
  totalText: { color: '#FFF', fontSize: 14, fontWeight: '700', flex: 1 },
  rewardsHint: { color: '#887744', fontSize: 11, fontStyle: 'italic' },
  emptyText: { color: '#666', fontSize: 13, lineHeight: 19 },
  attendanceSummary: { color: '#AAA', fontSize: 13, marginBottom: 10 },
  attendanceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#1A1A1A', borderRadius: 12, borderWidth: 1, borderColor: '#2A2A2A',
    padding: 14, marginBottom: 8,
  },
  attendanceName: { color: '#FFF', fontSize: 14, fontWeight: '600' },
  attendanceDate: { color: '#777', fontSize: 12, marginTop: 2 },
  verifyChip: {
    borderWidth: 1, borderColor: '#444', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3,
  },
  verifyChipOn: { borderColor: '#00FFCC', backgroundColor: 'rgba(0, 255, 204, 0.08)' },
  verifyChipText: { color: '#777', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  verifyChipTextOn: { color: '#00FFCC' },
  futureRow: { flexDirection: 'row', gap: 10 },
  futureTile: {
    flex: 1, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#161616', borderRadius: 12, borderWidth: 1, borderColor: '#222',
    paddingVertical: 14,
  },
  futureText: { color: '#555', fontSize: 13, fontWeight: '600' },
});
