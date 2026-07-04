import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, BadgeCheck, Wine, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import Toast from 'react-native-toast-message';
import { firestore } from '../services/firebase';
import {
  grantCertificationBadge,
  revokeCertificationBadge,
  grantBottleReward,
  revokeBottleReward,
  BOTTLE_IDS,
  BottleId,
} from '../services/achievementService';

// Bottle display metadata
const BOTTLE_META: Record<BottleId, { label: string; color: string; emoji: string }> = {
  bottle_jameson:  { label: 'Jameson',  color: '#D4A843', emoji: '🥃' },
  bottle_hennessy: { label: 'Hennessy', color: '#C0A060', emoji: '🥂' },
  bottle_martell:  { label: 'Martell',  color: '#6AAFFF', emoji: '🍾' },
};

export const AdminUsersScreen = () => {
  const navigation = useNavigation();
  const [searchQuery, setSearchQuery] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  // Track which user rows have the bottle panel expanded
  const [expandedBottleRows, setExpandedBottleRows] = useState<Set<string>>(new Set());
  // Track per-user + per-bottle loading state
  const [bottleLoading, setBottleLoading] = useState<Record<string, boolean>>({});

  const fetchUsers = async () => {
    setLoadingUsers(true);
    try {
      const querySnapshot = await getDocs(collection(firestore, 'users'));
      const fetchedUsers = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
      setUsers(fetchedUsers);
    } catch (err) {
      console.error('Error fetching users:', err);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  // ── Certification toggle ─────────────────────────────────────────────────
  const handleToggleCertification = async (user: any) => {
    const isCertified = user.unlockedAchievements?.includes('cert_1');
    try {
      if (isCertified) {
        await revokeCertificationBadge(user.id);
        Toast.show({ type: 'success', text1: 'Revoked', text2: `${user.username} is no longer certified.` });
      } else {
        await grantCertificationBadge(user.id);
        Toast.show({ type: 'success', text1: 'Certified!', text2: `${user.username} has been granted the prestige badge.` });
      }
      fetchUsers();
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Error', text2: 'Failed to update badge.' });
    }
  };

  // ── Suspension toggle ────────────────────────────────────────────────────
  const handleToggleSuspend = async (user: any) => {
    const isSuspended = user.suspended === true;
    try {
      const userRef = doc(firestore, 'users', user.id);
      await updateDoc(userRef, {
        suspended: !isSuspended
      });
      Toast.show({ type: 'success', text1: isSuspended ? 'Restored' : 'Suspended', text2: `Account access updated for ${user.username}.` });
      fetchUsers();
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Error', text2: 'Failed to update suspension status.' });
    }
  };

  // ── Bottle award toggle ──────────────────────────────────────────────────
  const handleToggleBottle = async (user: any, bottleId: BottleId) => {
    const key = `${user.id}_${bottleId}`;
    const hasBottle = user.unlockedBottles?.includes(bottleId);
    setBottleLoading(prev => ({ ...prev, [key]: true }));
    try {
      if (hasBottle) {
        await revokeBottleReward(user.id, bottleId);
        Toast.show({
          type: 'success',
          text1: '🍾 Revoked',
          text2: `${BOTTLE_META[bottleId].label} removed from ${user.username}.`,
        });
      } else {
        await grantBottleReward(user.id, bottleId);
        Toast.show({
          type: 'success',
          text1: '🏆 Bottle Awarded!',
          text2: `${user.username} is now a Nightlife Legend — ${BOTTLE_META[bottleId].label} granted!`,
        });
      }
      fetchUsers();
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Error', text2: 'Failed to update bottle award.' });
    } finally {
      setBottleLoading(prev => ({ ...prev, [key]: false }));
    }
  };

  const toggleBottlePanel = (userId: string) => {
    setExpandedBottleRows(prev => {
      const next = new Set(prev);
      next.has(userId) ? next.delete(userId) : next.add(userId);
      return next;
    });
  };

  const filteredUsers = users.filter(u =>
    u.username?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <ArrowLeft color="#FFFFFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>User Management</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.content}>
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search users by username..."
            placeholderTextColor="#666"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
          />
        </View>

        {loadingUsers ? (
          <ActivityIndicator size="large" color="#FFD700" style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={filteredUsers}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingBottom: 24 }}
            renderItem={({ item }) => {
              const isCertified = item.unlockedAchievements?.includes('cert_1');
              const isBottlePanelOpen = expandedBottleRows.has(item.id);
              const hasAnyBottle = BOTTLE_IDS.some(b => item.unlockedBottles?.includes(b));

              return (
                <View style={styles.userCard}>
                  {/* ── User header row ───────────────────────── */}
                  <View style={styles.userNameRow}>
                    <View style={styles.userNameLeft}>
                      <Text style={styles.userRowName}>{item.username || 'Unknown'}</Text>
                      <View style={styles.badgePills}>
                        {isCertified && (
                          <View style={styles.certPill}>
                            <BadgeCheck color="#FFD700" size={11} />
                            <Text style={styles.certPillText}>Certified</Text>
                          </View>
                        )}
                        {hasAnyBottle && (
                          <View style={styles.bottlePill}>
                            <Text style={styles.bottlePillText}>🏆 Legend</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </View>

                  {/* ── Certification action ──────────────────── */}
                  <View style={styles.actionRow}>
                    <View style={styles.actionLabel}>
                      <BadgeCheck color={isCertified ? '#FFD700' : '#555'} size={16} />
                      <Text style={styles.actionLabelText}>Eventas Certified</Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.actionBtn, isCertified ? styles.revokeBtn : styles.grantBtn]}
                      onPress={() => handleToggleCertification(item)}
                    >
                      <Text style={[styles.actionBtnText, isCertified && styles.actionBtnTextRevoke]}>
                        {isCertified ? 'Revoke' : 'Grant'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* ── Suspension action ──────────────────── */}
                  <View style={styles.actionRow}>
                    <View style={styles.actionLabel}>
                      <AlertTriangle color={item.suspended ? '#FF0055' : '#555'} size={16} />
                      <Text style={styles.actionLabelText}>Account Access</Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.actionBtn, item.suspended ? styles.grantBtn : styles.revokeBtn]}
                      onPress={() => handleToggleSuspend(item)}
                    >
                      <Text style={[styles.actionBtnText, !item.suspended && styles.actionBtnTextRevoke]}>
                        {item.suspended ? 'Restore Access' : 'Suspend Account'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* ── Bottle section expander ───────────────── */}
                  <TouchableOpacity
                    style={[styles.bottleExpanderRow, isBottlePanelOpen && styles.bottleExpanderOpen]}
                    onPress={() => toggleBottlePanel(item.id)}
                    activeOpacity={0.7}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Wine color="#D4A843" size={15} />
                      <Text style={styles.bottleExpanderText}>Bottle Award (Nightlife Legend)</Text>
                    </View>
                    {isBottlePanelOpen
                      ? <ChevronUp color="#888" size={16} />
                      : <ChevronDown color="#888" size={16} />
                    }
                  </TouchableOpacity>

                  {/* ── Bottle picker panel ───────────────────── */}
                  {isBottlePanelOpen && (
                    <View style={styles.bottlePanel}>
                      <Text style={styles.bottlePanelHint}>
                        Grant one bottle per month to the Nightlife Legend.
                      </Text>
                      {BOTTLE_IDS.map((bottleId) => {
                        const meta = BOTTLE_META[bottleId];
                        const hasThisBottle = item.unlockedBottles?.includes(bottleId);
                        const isLoadingThis = bottleLoading[`${item.id}_${bottleId}`];

                        return (
                          <View key={bottleId} style={[styles.bottleRow, hasThisBottle && { borderColor: meta.color + '55' }]}>
                            <View style={styles.bottleRowLeft}>
                              <Text style={styles.bottleEmoji}>{meta.emoji}</Text>
                              <View>
                                <Text style={[styles.bottleLabel, hasThisBottle && { color: meta.color }]}>
                                  {meta.label}
                                </Text>
                                {hasThisBottle && (
                                  <Text style={[styles.bottleGrantedTag, { color: meta.color }]}>✓ Awarded</Text>
                                )}
                              </View>
                            </View>

                            {isLoadingThis ? (
                              <ActivityIndicator size="small" color={meta.color} />
                            ) : (
                              <TouchableOpacity
                                style={[
                                  styles.bottleActionBtn,
                                  hasThisBottle
                                    ? styles.bottleRevokeBtn
                                    : [styles.bottleGrantBtn, { borderColor: meta.color }],
                                ]}
                                onPress={() => handleToggleBottle(item, bottleId)}
                              >
                                <Text style={[
                                  styles.bottleActionBtnText,
                                  hasThisBottle ? styles.bottleActionBtnRevoke : { color: meta.color },
                                ]}>
                                  {hasThisBottle ? 'Revoke' : 'Award'}
                                </Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            }}
            ListEmptyComponent={<Text style={{ color: '#888', textAlign: 'center', marginTop: 40 }}>No users found.</Text>}
          />
        )}
      </View>
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    color: '#FFD700',
    fontSize: 18,
    fontWeight: '700',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  searchContainer: {
    marginBottom: 16,
  },
  searchInput: {
    backgroundColor: '#1A1A1A',
    color: '#FFFFFF',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#333',
  },

  // ── User card ──────────────────────────────────────────────────────────────
  userCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    overflow: 'hidden',
  },
  userNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#242424',
  },
  userNameLeft: {
    flex: 1,
  },
  userRowName: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 5,
  },
  badgePills: {
    flexDirection: 'row',
    gap: 6,
  },
  certPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,215,0,0.1)',
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.3)',
  },
  certPillText: {
    color: '#FFD700',
    fontSize: 10,
    fontWeight: '700',
  },
  bottlePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(212,168,67,0.1)',
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(212,168,67,0.3)',
  },
  bottlePillText: {
    color: '#D4A843',
    fontSize: 10,
    fontWeight: '700',
  },

  // ── Action rows ────────────────────────────────────────────────────────────
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  actionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionLabelText: {
    color: '#CCC',
    fontSize: 14,
    fontWeight: '600',
  },
  actionBtn: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 8,
  },
  grantBtn: {
    backgroundColor: '#FFD700',
  },
  revokeBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#FF0055',
  },
  actionBtnText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 13,
  },
  actionBtnTextRevoke: {
    color: '#FF0055',
  },

  // ── Bottle expander ────────────────────────────────────────────────────────
  bottleExpanderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#1A1A1A',
  },
  bottleExpanderOpen: {
    borderBottomWidth: 1,
    borderBottomColor: '#2A2200',
    backgroundColor: '#120E00',
  },
  bottleExpanderText: {
    color: '#888',
    fontSize: 13,
    fontWeight: '600',
  },

  // ── Bottle panel ───────────────────────────────────────────────────────────
  bottlePanel: {
    backgroundColor: '#120E00',
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  bottlePanelHint: {
    color: '#666',
    fontSize: 11,
    fontStyle: 'italic',
    marginBottom: 10,
    marginTop: 4,
  },
  bottleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1A1300',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#2A1F00',
  },
  bottleRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bottleEmoji: {
    fontSize: 24,
  },
  bottleLabel: {
    color: '#CCC',
    fontSize: 14,
    fontWeight: '700',
  },
  bottleGrantedTag: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  bottleActionBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  bottleGrantBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  bottleRevokeBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#FF0055',
  },
  bottleActionBtnText: {
    fontWeight: '700',
    fontSize: 12,
  },
  bottleActionBtnRevoke: {
    color: '#FF0055',
  },
});
