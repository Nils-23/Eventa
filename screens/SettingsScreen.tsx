import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Linking, ActivityIndicator, Modal, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Trash2, Flag, Users, FileText, UserX, X } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { auth, firestore } from '../services/firebase';
import { doc, deleteDoc } from 'firebase/firestore';
import Toast from 'react-native-toast-message';
import { useAppStore } from '../hooks/useAppStore';
import { getFriendlyErrorMessage } from '../utils/errorUtils';
import { fetchUsername, unhideUser } from '../services/userService';

export const SettingsScreen = () => {
  const navigation = useNavigation<any>();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isHiddenUsersModalVisible, setIsHiddenUsersModalVisible] = useState(false);
  const [hiddenUsernames, setHiddenUsernames] = useState<Record<string, string>>({});
  const [loadingHiddenUsers, setLoadingHiddenUsers] = useState(false);

  const user = useAppStore((s) => s.user);
  const hiddenUsers = useAppStore((s) => s.hiddenUsers);
  const setHiddenUsers = useAppStore((s) => s.setHiddenUsers);
  const isAdmin = useAppStore((s) => s.isAdmin);

  const handleReport = async () => {
    const url = 'mailto:support@eventas.live?subject=Report%20Issue&body=Please%20describe%20your%20issue%20here...';
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      } else {
        Toast.show({ type: 'error', text1: 'Email app not found', text2: 'Please email support@eventas.live directly.' });
      }
    } catch (error) {
      console.error('Error opening email:', error);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      "Delete Account",
      "Are you sure you want to delete your account? This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Delete", 
          style: "destructive",
          onPress: executeDeleteAccount
        }
      ]
    );
  };

  const executeDeleteAccount = async () => {
    const userObj = auth.currentUser;
    if (!userObj) return;
    
    setIsDeleting(true);
    try {
      // First delete user document from firestore
      const userRef = doc(firestore, 'users', userObj.uid);
      await deleteDoc(userRef);
      
      // Then delete from auth
      await userObj.delete();
      
      Toast.show({ type: 'success', text1: 'Account Deleted', text2: 'Your account has been successfully deleted.' });
      // The auth listener in App.tsx will automatically navigate to Login
    } catch (error: any) {
      console.warn("Error deleting account:", error);
      if (error.code === 'auth/requires-recent-login') {
        Toast.show({ type: 'error', text1: 'Action Required', text2: 'Please sign out and sign in again before deleting your account.' });
      } else {
        Toast.show({ type: 'error', text1: 'Error', text2: getFriendlyErrorMessage(error) });
      }
    } finally {
      setIsDeleting(false);
    }
  };

  const fetchHiddenUsernames = async () => {
    if (hiddenUsers.length === 0) return;
    setLoadingHiddenUsers(true);
    try {
      const resolved: Record<string, string> = {};
      await Promise.all(
        hiddenUsers.map(async (uid) => {
          const name = await fetchUsername(uid);
          resolved[uid] = name;
        })
      );
      setHiddenUsernames(resolved);
    } catch (error) {
      console.warn("Failed to fetch hidden usernames:", error);
    } finally {
      setLoadingHiddenUsers(false);
    }
  };

  useEffect(() => {
    if (isHiddenUsersModalVisible) {
      fetchHiddenUsernames();
    }
  }, [isHiddenUsersModalVisible, hiddenUsers]);

  const handleUnhide = async (targetUserId: string) => {
    if (!user) return;
    try {
      await unhideUser(user.uid, targetUserId);
      setHiddenUsers(hiddenUsers.filter((id) => id !== targetUserId));
      Alert.alert('User Unhidden', 'Content from this user will now be visible.');
    } catch (error) {
      console.warn("Failed to unhide user:", error);
      Alert.alert('Error', 'Failed to unhide user.');
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <ArrowLeft color="#FFFFFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Account Settings</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.content}>
        <TouchableOpacity style={styles.row} onPress={handleReport}>
          <View style={styles.rowItemLeft}>
            <Flag color="#00FFCC" size={20} />
            <Text style={styles.rowText}>Report an Issue</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.row} 
          onPress={() => navigation.navigate('Terms', { viewOnly: true })}
        >
          <View style={styles.rowItemLeft}>
            <FileText color="#A78BFA" size={20} />
            <Text style={styles.rowText}>Terms & Guidelines</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.row} 
          onPress={() => setIsHiddenUsersModalVisible(true)}
        >
          <View style={styles.rowItemLeft}>
            <UserX color="#FF3366" size={20} />
            <Text style={styles.rowText}>Hidden Users</Text>
          </View>
        </TouchableOpacity>

        {isAdmin && (
          <TouchableOpacity 
            style={styles.row} 
            onPress={() => navigation.navigate('AdminDashboard')}
          >
            <View style={styles.rowItemLeft}>
              <Users color="#FF00CC" size={20} />
              <Text style={styles.rowText}>Admin Dashboard</Text>
            </View>
          </TouchableOpacity>
        )}

        <TouchableOpacity 
          style={[styles.row, styles.deleteRow]} 
          onPress={handleDeleteAccount}
          disabled={isDeleting}
        >
          <View style={styles.rowItemLeft}>
            {isDeleting ? (
              <ActivityIndicator size="small" color="#FF0055" />
            ) : (
              <Trash2 color="#FF0055" size={20} />
            )}
            <Text style={styles.deleteText}>Delete Account</Text>
          </View>
        </TouchableOpacity>
      </View>

      <Modal
        visible={isHiddenUsersModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsHiddenUsersModalVisible(false)}
      >
        <View style={modalStyles.modalOverlay}>
          <View style={modalStyles.modalContainer}>
            <View style={modalStyles.header}>
              <Text style={modalStyles.headerTitle}>Hidden Users</Text>
              <TouchableOpacity onPress={() => setIsHiddenUsersModalVisible(false)} style={modalStyles.closeButton}>
                <X color="#FFF" size={20} />
              </TouchableOpacity>
            </View>

            {loadingHiddenUsers ? (
              <View style={modalStyles.centerContainer}>
                <ActivityIndicator color="#00FFCC" size="large" />
              </View>
            ) : hiddenUsers.length === 0 ? (
              <View style={modalStyles.centerContainer}>
                <Text style={modalStyles.emptyText}>No hidden users.</Text>
              </View>
            ) : (
              <FlatList
                data={hiddenUsers}
                keyExtractor={(item) => item}
                contentContainerStyle={modalStyles.listContent}
                renderItem={({ item }) => (
                  <View style={modalStyles.userRow}>
                    <Text style={modalStyles.username}>{hiddenUsernames[item] || 'Loading...'}</Text>
                    <TouchableOpacity style={modalStyles.unhideButton} onPress={() => handleUnhide(item)}>
                      <Text style={modalStyles.unhideText}>Unhide</Text>
                    </TouchableOpacity>
                  </View>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const modalStyles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    width: '100%',
    maxHeight: '80%',
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#333',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
  },
  headerTitle: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '700',
  },
  closeButton: {
    padding: 4,
    backgroundColor: '#2A2A2A',
    borderRadius: 12,
  },
  centerContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: '#888',
    fontSize: 15,
  },
  listContent: {
    padding: 16,
  },
  userRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
  },
  username: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '500',
  },
  unhideButton: {
    backgroundColor: 'rgba(0, 255, 204, 0.1)',
    borderWidth: 1,
    borderColor: '#00FFCC',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  unhideText: {
    color: '#00FFCC',
    fontSize: 13,
    fontWeight: '600',
  },
});

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
  row: {
    backgroundColor: '#1A1A1A',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  deleteRow: {
    borderColor: 'rgba(255, 0, 85, 0.3)',
    backgroundColor: 'rgba(255, 0, 85, 0.05)',
    marginTop: 24,
  },
  rowItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '500',
    marginLeft: 12,
  },
  deleteText: {
    color: '#FF0055',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 12,
  },
});
