import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, BadgeCheck } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, getDocs } from 'firebase/firestore';
import Toast from 'react-native-toast-message';
import { firestore } from '../services/firebase';
import { grantCertificationBadge, revokeCertificationBadge } from '../services/achievementService';

export const AdminUsersScreen = () => {
  const navigation = useNavigation();
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
    fetchUsers();
  }, []);

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

  const filteredUsers = users.filter(u => 
    u.username?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <ArrowLeft color="#FFFFFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>User Certification</Text>
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
    padding: 24,
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
  userRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#333',
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
