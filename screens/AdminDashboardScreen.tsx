import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch, TextInput, Modal, ActivityIndicator, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Users, Settings, MapPin, Zap, BadgeCheck, X } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, query, where, getDocs } from 'firebase/firestore';
import Toast from 'react-native-toast-message';
import { firestore } from '../services/firebase';
import { useAppStore } from '../hooks/useAppStore';
import { grantCertificationBadge, revokeCertificationBadge } from '../services/achievementService';

export const AdminDashboardScreen = () => {
  const navigation = useNavigation<any>();
  const { isSimulationRunning, setIsSimulationRunning } = useAppStore();
  const [isCertModalVisible, setIsCertModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

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
    if (isCertModalVisible) {
      fetchUsers();
    }
  }, [isCertModalVisible]);

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
      // Refresh list to show updated status
      fetchUsers();
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Error', text2: 'Failed to update badge.' });
    }
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
        <Text style={styles.headerTitle}>Admin Dashboard</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.welcomeText}>Welcome to the Admin Hub</Text>
        <Text style={styles.subtitle}>Select a module to manage platform operations.</Text>

        <View style={styles.grid}>
          {/* Venue & Simulation Management */}
          <TouchableOpacity 
            style={styles.card} 
            onPress={() => navigation.navigate('AdminSimulation')}
          >
            <View style={styles.iconContainer}>
              <Users color="#FF00CC" size={32} />
              <MapPin color="#00FFCC" size={24} style={styles.subIcon} />
            </View>
            <Text style={styles.cardTitle}>Venue & Users</Text>
            <Text style={styles.cardDesc}>Manage venues, add new locations, and control simulated user counts.</Text>
          </TouchableOpacity>

          {/* Master Simulation Toggle */}
          <View style={[styles.card, styles.toggleCard]}>
            <View style={{ flex: 1 }}>
              <View style={styles.toggleHeader}>
                <Zap color={isSimulationRunning ? "#FF00CC" : "#888"} size={20} />
                <Text style={styles.cardTitle}>Simulation Engine</Text>
              </View>
              <Text style={styles.cardDesc}>
                {isSimulationRunning 
                  ? "Running in background. Fake locations are actively syncing to the map."
                  : "Engine is paused. Toggle to start simulating activity locally."}
              </Text>
            </View>
            <Switch
              value={isSimulationRunning}
              onValueChange={setIsSimulationRunning}
              trackColor={{ false: '#222', true: '#FF00CC' }}
              thumbColor={isSimulationRunning ? '#FFFFFF' : '#888'}
            />
          </View>

          {/* Certification / User Management */}
          <TouchableOpacity 
            style={styles.card} 
            onPress={() => setIsCertModalVisible(true)}
          >
            <View style={styles.iconContainer}>
              <BadgeCheck color="#FFD700" size={32} />
            </View>
            <Text style={styles.cardTitle}>User Certification</Text>
            <Text style={styles.cardDesc}>Grant the ultimate prestige verification badge to top-tier users.</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Certification Modal */}
      <Modal visible={isCertModalVisible} animationType="slide" transparent={true}>
        <SafeAreaView style={styles.fullModalOverlay}>
          <View style={styles.fullModalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>User Certification</Text>
              <TouchableOpacity onPress={() => setIsCertModalVisible(false)}>
                <X color="#FFFFFF" size={24} />
              </TouchableOpacity>
            </View>

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
                  return (
                    <View style={styles.userRow}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={styles.userRowName}>{item.username || 'Unknown'}</Text>
                        {isCertified && <BadgeCheck color="#FFD700" size={16} style={{ marginLeft: 8 }} />}
                      </View>
                      
                      <TouchableOpacity 
                        style={[styles.toggleBtn, isCertified ? styles.revokeBtn : styles.grantBtn]} 
                        onPress={() => handleToggleCertification(item)}
                      >
                        <Text style={styles.toggleBtnText}>
                          {isCertified ? 'Revoke' : 'Grant'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  );
                }}
                ListEmptyComponent={<Text style={{ color: '#888', textAlign: 'center', marginTop: 40 }}>No users found.</Text>}
              />
            )}
          </View>
        </SafeAreaView>
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
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  content: {
    padding: 24,
  },
  welcomeText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    marginBottom: 32,
  },
  grid: {
    flexDirection: 'column',
    gap: 16,
  },
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#333',
  },
  toggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  cardDisabled: {
    backgroundColor: '#161616',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#222',
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255, 0, 204, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    position: 'relative',
  },
  subIcon: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    overflow: 'hidden',
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  cardDesc: {
    color: '#888',
    fontSize: 14,
    lineHeight: 20,
  },
  fullModalOverlay: {
    flex: 1,
    backgroundColor: '#121212',
  },
  fullModalContent: {
    flex: 1,
    backgroundColor: '#1A1A1A',
    padding: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    color: '#FFD700',
    fontSize: 20,
    fontWeight: '700',
  },
  searchContainer: {
    marginBottom: 16,
  },
  searchInput: {
    backgroundColor: '#2A2A2A',
    color: '#FFFFFF',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  userRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#222',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  userRowName: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  toggleBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  grantBtn: {
    backgroundColor: '#FFD700',
  },
  revokeBtn: {
    backgroundColor: '#FF0055',
  },
  toggleBtnText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 14,
  },
});
