import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LogOut, Settings, Award, CircleUserRound, Edit2, Check, UserPlus } from 'lucide-react-native';
import { useAppStore } from '../hooks/useAppStore';
import { auth } from '../services/firebase';
import { useStories } from '../hooks/useStories';
import { StoryViewer } from '../components/StoryViewer';
import { fetchUsername, updateUsername, getMonthlyPointsKey } from '../services/userService';
import { deleteStory } from '../services/storyService';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { firestore } from '../services/firebase';
import { useNavigation } from '@react-navigation/native';
import { ACHIEVEMENTS } from '../services/achievementService';
import * as Icons from 'lucide-react-native';

export const ProfileScreen = () => {
  const user = useAppStore((s) => s.user);
  const { stories } = useStories();
  const [isViewerVisible, setIsViewerVisible] = useState(false);
  const [username, setUsername] = useState<string>('Loading...');
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [editedUsername, setEditedUsername] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  
  const [stats, setStats] = useState({ venues: 0, points: 0 });
  const [unlockedAchievements, setUnlockedAchievements] = useState<string[]>([]);
  const navigation = useNavigation();

  useEffect(() => {
    if (user?.uid) {
      fetchUsername(user.uid).then(name => setUsername(name));
      
      const userDocRef = doc(firestore, 'users', user.uid);
      const unsubscribe = onSnapshot(userDocRef, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          const attendedVenues = data.attendedVenues || [];
          const points = data.points || 0;
          setStats({
            venues: attendedVenues.length,
            points: points,
          });
          setUnlockedAchievements(data.unlockedAchievements || []);
        }
      });
      
      return () => unsubscribe();
    }
  }, [user?.uid]);

  const myStories = stories.filter(s => s.user_id === user?.uid);
  const hasStories = myStories.length > 0;

  const handleSignOut = async () => {
    if (user?.uid) {
      try {
        const userRef = doc(firestore, 'users', user.uid);
        await updateDoc(userRef, { expoPushToken: null });
      } catch (error) {
        console.warn('Error clearing push token on sign out:', error);
      }
    }
    auth.signOut();
  };

  const handleRemoveStory = async (storyId: string) => {
    try {
      await deleteStory(storyId);
    } catch (error) {
      console.error('Failed to delete story:', error);
    }
  };

  const handleEditUsername = () => {
    setEditedUsername(username);
    setIsEditingUsername(true);
  };

  const handleSaveUsername = async () => {
    if (!user?.uid || editedUsername.trim() === '') {
      setIsEditingUsername(false);
      return;
    }
    setIsSaving(true);
    try {
      await updateUsername(user.uid, editedUsername.trim());
      setUsername(editedUsername.trim());
    } catch (error) {
      console.error(error);
    } finally {
      setIsSaving(false);
      setIsEditingUsername(false);
    }
  };

  const handleReferFriend = async () => {
    if (!user?.uid) return;
    try {
      const inviteLink = `https://eventas.live/invite/${user.uid}`;
      await Share.share({
        message: `Join me on Eventas! Use my invite link to sign up: ${inviteLink}\nAttend your first venue and I'll earn 20 points!`,
        title: 'Invite a Friend to Eventas',
      });
    } catch (error) {
      console.error('Error sharing invite link:', error);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        
        <View style={styles.header}>
          <TouchableOpacity 
            style={styles.avatarContainer}
            disabled={!hasStories}
            onPress={() => setIsViewerVisible(true)}
            activeOpacity={0.8}
          >
            {hasStories ? <View style={styles.storyRing} /> : null}
            <CircleUserRound color="#00FFCC" size={80} strokeWidth={1} />
          </TouchableOpacity>
          {isEditingUsername ? (
            <View style={styles.editUsernameContainer}>
              <TextInput
                style={styles.usernameInput}
                value={editedUsername}
                onChangeText={setEditedUsername}
                autoFocus
                maxLength={30}
                placeholder="Enter username"
                placeholderTextColor="#888888"
              />
              <TouchableOpacity onPress={handleSaveUsername} disabled={isSaving} style={styles.saveButton}>
                {isSaving ? <ActivityIndicator size="small" color="#00FFCC" /> : <Check color="#00FFCC" size={24} />}
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.usernameContainer}>
              <Text style={styles.username}>
                {username}
              </Text>
              <TouchableOpacity onPress={handleEditUsername} style={styles.editButton}>
                <Edit2 color="#888888" size={16} />
              </TouchableOpacity>
            </View>
          )}
          <Text style={styles.joinDate}>
            Joined April 2026
          </Text>
        </View>

        <View style={styles.statsContainer}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{stats.venues}</Text>
            <Text style={styles.statLabel}>Venues</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{stats.points}</Text>
            <Text style={styles.statLabel}>Points</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Top Badges</Text>
          <View style={styles.topBadgesContainer}>
            {unlockedAchievements.length === 0 ? (
              <Text style={styles.emptyBadgesText}>Keep exploring to earn your first badge!</Text>
            ) : (
              unlockedAchievements.slice(-3).reverse().map(badgeId => {
                const badge = ACHIEVEMENTS.find(a => a.id === badgeId);
                if (!badge) return null;
                // @ts-ignore
                const Icon = Icons[badge.iconName] || Icons.Award;
                return (
                  <View key={badgeId} style={styles.topBadgeBox}>
                    <Icon color={badge.glowColor} size={28} style={{
                      shadowColor: badge.glowColor,
                      shadowOffset: { width: 0, height: 0 },
                      shadowOpacity: 0.8,
                      shadowRadius: 10,
                    }} />
                    <Text style={styles.topBadgeName} numberOfLines={1}>{badge.name}</Text>
                  </View>
                );
              })
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Preferences</Text>
          <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('Settings' as never)}>
            <View style={styles.rowItemLeft}>
               <Settings color="#FFFFFF" size={20} />
               <Text style={styles.rowText}>Account Settings</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('Achievements' as never)}>
            <View style={styles.rowItemLeft}>
               <Award color="#FFFFFF" size={20} />
               <Text style={styles.rowText}>Achievements</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.row} onPress={handleReferFriend}>
            <View style={styles.rowItemLeft}>
               <UserPlus color="#00FFCC" size={20} />
               <Text style={styles.rowText}>Refer a Friend</Text>
            </View>
          </TouchableOpacity>
        </View>

        <TouchableOpacity 
          style={styles.signOutButton}
          onPress={handleSignOut}
          activeOpacity={0.7}
        >
          <LogOut color="#FF0055" size={20} style={{ marginRight: 8 }} />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

      </ScrollView>

      <StoryViewer
        isVisible={isViewerVisible}
        onClose={() => setIsViewerVisible(false)}
        stories={myStories}
        venueName="My Stories"
        canAddStory={false}
        onAddStory={() => {}}
        onRemoveStory={handleRemoveStory}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginVertical: 32,
  },
  avatarContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#1A1A1A',
    borderWidth: 2,
    borderColor: '#00FFCC',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#00FFCC',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  storyRing: {
    position: 'absolute',
    width: 108,
    height: 108,
    borderRadius: 54,
    borderWidth: 2,
    borderColor: '#FF00CC', 
    borderStyle: 'dashed',
  },
  usernameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  username: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  editButton: {
    marginLeft: 8,
    padding: 4,
  },
  editUsernameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  usernameInput: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#00FFCC',
    paddingVertical: 0,
    paddingHorizontal: 4,
    minWidth: 150,
  },
  saveButton: {
    marginLeft: 12,
    padding: 4,
  },
  joinDate: {
    fontSize: 14,
    color: '#888888',
  },
  statsContainer: {
    flexDirection: 'row',
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 20,
    marginBottom: 32,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  divider: {
    width: 1,
    backgroundColor: '#2A2A2A',
  },
  statValue: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#888888',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 14,
    color: '#888888',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 16,
    fontWeight: '600',
  },
  topBadgesContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  emptyBadgesText: {
    color: '#666',
    fontSize: 14,
    fontStyle: 'italic',
  },
  topBadgeBox: {
    flex: 1,
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  topBadgeName: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 8,
    textAlign: 'center',
  },
  row: {
    backgroundColor: '#1A1A1A',
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#2A2A2A',
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
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 0, 85, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 0, 85, 0.3)',
    borderRadius: 30,
    paddingVertical: 16,
    marginTop: 'auto',
  },
  signOutText: {
    color: '#FF0055',
    fontSize: 16,
    fontWeight: '600',
  },
});
