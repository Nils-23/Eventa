/**
 * AdminCreatorApplicationsScreen — manual review surface for the Creator Program.
 *
 * Admin workflow:
 *   1. Open the official Eventas Instagram/TikTok DMs.
 *   2. Find the DM carrying the verification code shown on the application.
 *   3. Confirm the DM sender matches the social username on the application.
 *   4. Approve (upgrades the account to Creator) or Reject.
 *
 * Expired codes render as EXPIRED and cannot be approved — the applicant must
 * generate a fresh code from their verification screen first. Approved creators
 * can be revoked here; revocation locks creator features immediately while the
 * creators/{uid} analytics doc is preserved for admin records.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Camera, Music2, ShieldOff, BadgeCheck } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import Toast from 'react-native-toast-message';
import { useAppStore } from '../hooks/useAppStore';
import {
  CreatorApplication, subscribeAllApplications, approveApplication,
  rejectApplication, revokeCreator, effectiveStatus,
} from '../services/creatorService';

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected' | 'expired';
const FILTERS: StatusFilter[] = ['all', 'pending', 'approved', 'rejected', 'expired'];

const STATUS_COLORS: Record<string, string> = {
  pending: '#FFD700',
  approved: '#00FFCC',
  rejected: '#FF0055',
  expired: '#888888',
};

export const AdminCreatorApplicationsScreen = () => {
  const navigation = useNavigation<any>();
  const user = useAppStore((s) => s.user);
  const [apps, setApps] = useState<CreatorApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('pending');
  const [actingOn, setActingOn] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeAllApplications((list) => {
      setApps(list);
      setLoading(false);
    });
    return unsub;
  }, []);

  const filtered = apps.filter((a) => filter === 'all' || effectiveStatus(a) === filter);

  const handleApprove = (app: CreatorApplication) => {
    Alert.alert(
      'Approve Creator',
      `Confirm you found "${app.verificationCode}" in the official ${app.platform} DMs, sent from @${app.socialUsername}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            if (!user?.uid) return;
            setActingOn(app.userId);
            try {
              const profile = await approveApplication(app, user.uid);
              Toast.show({
                type: 'success',
                text1: 'Creator Approved',
                text2: `${app.creatorName} → referral code ${profile.referralCode}`,
              });
            } catch (err: any) {
              Toast.show({ type: 'error', text1: 'Approval failed', text2: err.message });
            } finally {
              setActingOn(null);
            }
          },
        },
      ]
    );
  };

  const handleReject = (app: CreatorApplication) => {
    Alert.alert('Reject Application', `Reject ${app.creatorName}'s application?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reject',
        style: 'destructive',
        onPress: async () => {
          if (!user?.uid) return;
          setActingOn(app.userId);
          try {
            await rejectApplication(app.userId, user.uid);
            Toast.show({ type: 'success', text1: 'Application Rejected' });
          } catch (err: any) {
            Toast.show({ type: 'error', text1: 'Rejection failed', text2: err.message });
          } finally {
            setActingOn(null);
          }
        },
      },
    ]);
  };

  const handleRevoke = (app: CreatorApplication) => {
    Alert.alert(
      'Revoke Creator Status',
      `${app.creatorName} will immediately lose all creator features. Historical analytics are preserved for admin records.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: async () => {
            if (!user?.uid) return;
            setActingOn(app.userId);
            try {
              await revokeCreator(app.userId, user.uid);
              Toast.show({ type: 'success', text1: 'Creator Revoked' });
            } catch (err: any) {
              Toast.show({ type: 'error', text1: 'Revoke failed', text2: err.message });
            } finally {
              setActingOn(null);
            }
          },
        },
      ]
    );
  };

  const renderApp = ({ item }: { item: CreatorApplication }) => {
    const status = effectiveStatus(item);
    const busy = actingOn === item.userId;
    const submitted = item.createdAt?.toDate
      ? item.createdAt.toDate().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      : '—';

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.creatorName}>{item.creatorName}</Text>
            <Text style={styles.fullName}>{item.fullName}</Text>
          </View>
          <View style={[styles.statusChip, { borderColor: STATUS_COLORS[status] }]}>
            <Text style={[styles.statusText, { color: STATUS_COLORS[status] }]}>
              {status.toUpperCase()}
            </Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          {item.platform === 'instagram'
            ? <Camera color="#E1306C" size={14} />
            : <Music2 color="#69C9D0" size={14} />}
          <Text style={styles.metaText}>@{item.socialUsername}</Text>
          <Text style={styles.metaDot}>·</Text>
          <Text style={styles.metaText}>{item.category}</Text>
          <Text style={styles.metaDot}>·</Text>
          <Text style={styles.metaText}>{submitted}</Text>
        </View>

        <View style={styles.codeRow}>
          <Text style={styles.codeLabel}>CODE</Text>
          <Text style={[styles.codeValue, status === 'expired' && styles.codeExpired]}>
            {item.verificationCode}
          </Text>
        </View>

        {!!item.message && <Text style={styles.message} numberOfLines={3}>"{item.message}"</Text>}

        {busy ? (
          <ActivityIndicator color="#00FFCC" style={{ marginTop: 12 }} />
        ) : status === 'pending' ? (
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.approveButton} onPress={() => handleApprove(item)}>
              <BadgeCheck color="#121212" size={16} />
              <Text style={styles.approveText}>Approve</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.rejectButton} onPress={() => handleReject(item)}>
              <Text style={styles.rejectText}>Reject</Text>
            </TouchableOpacity>
          </View>
        ) : status === 'expired' ? (
          <Text style={styles.expiredHint}>
            Code expired before review — the applicant must generate a new code before this can be approved.
          </Text>
        ) : status === 'approved' ? (
          <TouchableOpacity style={styles.revokeButton} onPress={() => handleRevoke(item)}>
            <ShieldOff color="#FF0055" size={16} />
            <Text style={styles.revokeText}>Revoke Creator Status</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <ArrowLeft color="#FFFFFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Creator Applications</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterPill, filter === f && styles.filterPillActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color="#00FFCC" size="large" /></View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>No {filter === 'all' ? '' : filter + ' '}applications.</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.userId}
          renderItem={renderApp}
          contentContainerStyle={styles.listContent}
        />
      )}
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
  filterRow: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12,
  },
  filterPill: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16,
    backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#2A2A2A',
  },
  filterPillActive: { backgroundColor: 'rgba(0, 255, 204, 0.12)', borderColor: '#00FFCC' },
  filterText: { color: '#888', fontSize: 12, fontWeight: '600' },
  filterTextActive: { color: '#00FFCC' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: '#666', fontSize: 15 },
  listContent: { padding: 16, paddingBottom: 40 },
  card: {
    backgroundColor: '#1A1A1A', borderRadius: 14, borderWidth: 1, borderColor: '#2A2A2A',
    padding: 16, marginBottom: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  creatorName: { color: '#FFF', fontSize: 17, fontWeight: '700' },
  fullName: { color: '#888', fontSize: 13, marginTop: 2 },
  statusChip: {
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4,
  },
  statusText: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  metaText: { color: '#AAA', fontSize: 13 },
  metaDot: { color: '#444' },
  codeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#121212', borderRadius: 8, padding: 10, marginBottom: 8,
  },
  codeLabel: { color: '#666', fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  codeValue: { color: '#00FFCC', fontSize: 16, fontWeight: '800', letterSpacing: 2 },
  codeExpired: { color: '#888', textDecorationLine: 'line-through' },
  message: { color: '#999', fontSize: 13, fontStyle: 'italic', marginBottom: 4 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  approveButton: {
    flex: 1, flexDirection: 'row', gap: 6, backgroundColor: '#00FFCC',
    borderRadius: 10, paddingVertical: 12, alignItems: 'center', justifyContent: 'center',
  },
  approveText: { color: '#121212', fontSize: 14, fontWeight: '800' },
  rejectButton: {
    flex: 1, borderWidth: 1, borderColor: 'rgba(255, 0, 85, 0.5)',
    borderRadius: 10, paddingVertical: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255, 0, 85, 0.08)',
  },
  rejectText: { color: '#FF0055', fontSize: 14, fontWeight: '700' },
  expiredHint: { color: '#777', fontSize: 12, marginTop: 10, fontStyle: 'italic' },
  revokeButton: {
    flexDirection: 'row', gap: 8, marginTop: 12, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255, 0, 85, 0.4)', borderRadius: 10, paddingVertical: 12,
    backgroundColor: 'rgba(255, 0, 85, 0.05)',
  },
  revokeText: { color: '#FF0055', fontSize: 13, fontWeight: '700' },
});
