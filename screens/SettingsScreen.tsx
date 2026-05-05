import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Linking, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Trash2, Flag, Users } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { auth, firestore } from '../services/firebase';
import { doc, deleteDoc } from 'firebase/firestore';
import Toast from 'react-native-toast-message';
import { useAppStore } from '../hooks/useAppStore';

export const SettingsScreen = () => {
  const navigation = useNavigation<any>();
  const [isDeleting, setIsDeleting] = useState(false);
  const { isAdmin } = useAppStore();

  const handleReport = async () => {
    const url = 'mailto:support@eventa.to?subject=Report%20Issue&body=Please%20describe%20your%20issue%20here...';
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      } else {
        Toast.show({ type: 'error', text1: 'Email app not found', text2: 'Please email support@eventa.to directly.' });
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
    const user = auth.currentUser;
    if (!user) return;
    
    setIsDeleting(true);
    try {
      // First delete user document from firestore
      const userRef = doc(firestore, 'users', user.uid);
      await deleteDoc(userRef);
      
      // Then delete from auth
      await user.delete();
      
      Toast.show({ type: 'success', text1: 'Account Deleted', text2: 'Your account has been successfully deleted.' });
      // The auth listener in App.tsx will automatically navigate to Login
    } catch (error: any) {
      console.error("Error deleting account:", error);
      if (error.code === 'auth/requires-recent-login') {
        Toast.show({ type: 'error', text1: 'Action Required', text2: 'Please sign out and sign in again before deleting your account.' });
      } else {
        Toast.show({ type: 'error', text1: 'Error', text2: 'Failed to delete account. Please try again later.' });
      }
    } finally {
      setIsDeleting(false);
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
