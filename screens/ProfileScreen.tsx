import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LogOut, Settings, Award, CircleUserRound, Edit2, Check, UserPlus, BadgeCheck, Star, Bell, Trash2 } from 'lucide-react-native';
import Toast from 'react-native-toast-message';
import { useCreatorStatus } from '../hooks/useCreatorStatus';
import { useAppStore } from '../hooks/useAppStore';
import { auth } from '../services/firebase';
import { useStories } from '../hooks/useStories';
import { StoryViewer } from '../components/StoryViewer';
import {
  updateUsername,
  getMonthlyPointsKey,
  inspectUsername,
  USERNAME_MAX,
  USERNAME_RULES,
} from '../services/userService';
import { useUsername } from '../hooks/useUsernames';
import { deleteStory } from '../services/storyService';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { firestore } from '../services/firebase';
import { useNavigation } from '@react-navigation/native';
import { ACHIEVEMENTS } from '../services/achievementService';
import * as Icons from 'lucide-react-native';
import { SavedEvent, subscribeSavedEvents, unsaveEvent } from '../services/savedEventService';
import { useLiveVenues } from '../hooks/useLiveVenues';

// created_at is a Firestore Timestamp on profiles made by createUserProfile, but
// accounts predating that write don't have it — hence the Auth metadata fallback,
// which arrives as an ISO/RFC string.
const formatJoinDate = (value: any): string | null => {
  if (!value) return null;
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  if (isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
};

export const ProfileScreen = () => {
  const user = useAppStore((s) => s.user);
  const { stories } = useStories();
  const [isViewerVisible, setIsViewerVisible] = useState(false);
  // Live: a rename made on another device (or the name assigned at sign-up)
  // lands here without a restart, and the same value is what every other
  // surface renders.
  const username = useUsername(user?.uid) ?? 'Loading...';
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [editedUsername, setEditedUsername] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  
  const [stats, setStats] = useState({ venues: 0, points: 0 });
  const [joinDate, setJoinDate] = useState<string | null>(null);
  const [savedEvents, setSavedEvents] = useState<SavedEvent[]>([]);
  const [removingEventId, setRemovingEventId] = useState<string | null>(null);
  // Used only to decide whether a saved event is still a real, openable event.
  const { venues } = useLiveVenues();
  const [unlockedAchievements, setUnlockedAchievements] = useState<string[]>([]);
  const navigation = useNavigation();
  // Real-time creator state: the badge and stage name appear on approval and
  // disappear instantly on revocation. Full Name is never on the user doc —
  // the public profile only ever shows the Creator/Stage name.
  const { isCreator, creatorProfile } = useCreatorStatus();

  useEffect(() => {
    if (user?.uid) {
      // Shown until the doc arrives, and kept if created_at is missing or still
      // pending (serverTimestamp resolves to null in the local snapshot).
      const authFallback = formatJoinDate(user.metadata?.creationTime);
      setJoinDate(authFallback);

      const userDocRef = doc(firestore, 'users', user.uid);
      const unsubscribe = onSnapshot(userDocRef, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          setJoinDate(formatJoinDate(data.created_at) ?? authFallback);
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

  // ── Saved events ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.uid) {
      setSavedEvents([]);
      return;
    }
    return subscribeSavedEvents(user.uid, setSavedEvents);
  }, [user?.uid]);

  // Upcoming first, soonest at the top; anything already started falls below it,
  // most recent first. Past saves are deliberately still listed — the reminder
  // scheduler leaves them alone, so this section is the only place a user can
  // clear them out, which is the point of it.
  const { upcomingSaved, endedSaved } = React.useMemo(() => {
    const now = Date.now();
    const upcoming: SavedEvent[] = [];
    const ended: SavedEvent[] = [];
    savedEvents.forEach((s) => {
      // A TBA event (null startDate) has nothing to have passed yet.
      if (typeof s.startDate !== 'number' || s.startDate > now) upcoming.push(s);
      else ended.push(s);
    });
    upcoming.sort((a, b) => (a.startDate ?? Infinity) - (b.startDate ?? Infinity));
    ended.sort((a, b) => (b.startDate ?? 0) - (a.startDate ?? 0));
    return { upcomingSaved: upcoming, endedSaved: ended };
  }, [savedEvents]);

  const handleRemoveSaved = async (eventId: string) => {
    if (!user?.uid || removingEventId) return;
    setRemovingEventId(eventId);
    try {
      await unsaveEvent(eventId, user.uid);
      Toast.show({ type: 'success', text1: 'Removed from saved events' });
    } catch (err: any) {
      Toast.show({ type: 'error', text1: "Couldn't remove", text2: err.message });
    } finally {
      setRemovingEventId(null);
    }
  };

  const handleOpenSaved = (saved: SavedEvent) => {
    // Navigate only with the real venue object. EventDetailScreen re-resolves by
    // id but falls back to whatever it was handed, and a saved row carries only
    // a name and a date — passing that would render a stripped-down screen.
    const venue = venues.find((v) => v.id === saved.eventId);
    // `navigation` here is the untyped useNavigation(), whose overloads reject a
    // params argument; the screen itself reads route.params as LiveVenue.
    if (venue) (navigation as any).navigate('EventDetail', { event: venue });
  };

  const formatSavedWhen = (startDate: number | null): string => {
    if (typeof startDate !== 'number') return 'Date to be announced';
    return new Date(startDate).toLocaleString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Africa/Nairobi',
    });
  };

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

  // Checked on every keystroke so the rules are explained as they are hit,
  // rather than the user discovering them from a rejected save (or, worse, from
  // input that was silently tidied up behind their back).
  const usernameCheck = useMemo(
    () => (isEditingUsername ? inspectUsername(editedUsername) : null),
    [isEditingUsername, editedUsername]
  );

  const handleEditUsername = () => {
    setEditedUsername(username);
    setIsEditingUsername(true);
  };

  const handleSaveUsername = async () => {
    if (!user?.uid) return;

    // Was: silently close the editor and keep the old name. The user had no way
    // to tell whether the rename had happened.
    const check = inspectUsername(editedUsername);
    if (check.error) {
      Toast.show({
        type: 'error',
        text1: "Username not saved",
        text2: check.error,
      });
      return;
    }
    setIsSaving(true);
    try {
      const result = await updateUsername(user.uid, editedUsername);
      // No local setState: updateUsername publishes into the live registry, so
      // this screen and every other surface re-render from the same source.
      setIsEditingUsername(false);

      if (!result.changed) {
        Toast.show({ type: 'info', text1: 'That is already your username' });
      } else if (result.adjusted) {
        // Never let a saved name differ from what they typed without saying so.
        Toast.show({
          type: 'success',
          text1: `Saved as "${result.username}"`,
          text2: 'Extra spaces were removed.',
        });
      } else {
        Toast.show({
          type: 'success',
          text1: 'Username updated',
          text2: `You now appear as "${result.username}" everywhere, including in chats you have already posted in.`,
        });
      }
    } catch (error: any) {
      // Validation and "already taken" are user-fixable — keep the editor open
      // with what they typed rather than silently discarding the change.
      Toast.show({
        type: 'error',
        text1: "Couldn't save username",
        text2: error?.message || 'Please try again.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleReferFriend = async () => {
    if (!user?.uid) return;
    try {
      const inviteLink = `https://www.eventas.live/invite/${user.uid}`;
      await Share.share({
        message: `Join me on Eventas! Use my invite link to sign up: ${inviteLink}\nCreate your account and I'll earn 20 points!`,
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
            <View style={styles.editUsernameBlock}>
              <View style={styles.editUsernameContainer}>
                <TextInput
                  style={styles.usernameInput}
                  value={editedUsername}
                  onChangeText={setEditedUsername}
                  autoFocus
                  // Deliberately above USERNAME_MAX: a hard stop at the limit
                  // just makes the keyboard go dead with no explanation. Let
                  // them overshoot and tell them by how much.
                  maxLength={USERNAME_MAX + 15}
                  placeholder="Enter username"
                  placeholderTextColor="#888888"
                />
                <TouchableOpacity onPress={handleSaveUsername} disabled={isSaving} style={styles.saveButton}>
                  {isSaving ? <ActivityIndicator size="small" color="#00FFCC" /> : <Check color="#00FFCC" size={24} />}
                </TouchableOpacity>
              </View>

              {/* The rules, then what is currently wrong with (or will be
                  changed about) what they typed. Always one line present, so
                  nothing about the outcome is left to be guessed at. */}
              <Text
                style={[
                  styles.usernameHint,
                  usernameCheck?.error ? styles.usernameHintError : null,
                  usernameCheck?.notice ? styles.usernameHintNotice : null,
                ]}
              >
                {usernameCheck?.error ?? usernameCheck?.notice ?? USERNAME_RULES}
              </Text>
              <Text style={styles.usernameCounter}>
                {`${usernameCheck?.normalized.length ?? 0}/${USERNAME_MAX}`}
              </Text>
            </View>
          ) : (
            <View style={styles.usernameContainer}>
              <Text style={styles.username}>
                {isCreator && creatorProfile ? creatorProfile.creatorName : username}
              </Text>
              {isCreator ? (
                <BadgeCheck color="#00FFCC" size={20} style={{ marginLeft: 8 }} />
              ) : (
                <TouchableOpacity onPress={handleEditUsername} style={styles.editButton}>
                  <Edit2 color="#888888" size={16} />
                </TouchableOpacity>
              )}
            </View>
          )}
          {isCreator && creatorProfile && (
            <View style={styles.creatorChip}>
              <Star color="#FFD700" size={12} />
              <Text style={styles.creatorChipText}>{creatorProfile.category} Creator</Text>
            </View>
          )}
          {joinDate && (
            <Text style={styles.joinDate}>
              Joined {joinDate}
            </Text>
          )}
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
          <Text style={styles.sectionTitle}>Saved Events</Text>
          {savedEvents.length === 0 ? (
            <Text style={styles.emptyBadgesText}>
              Save an event to get reminded the day before and on the day.
            </Text>
          ) : (
            <>
              {upcomingSaved.map((saved) => {
                const openable = venues.some((v) => v.id === saved.eventId);
                return (
                  <TouchableOpacity
                    key={saved.eventId}
                    style={styles.savedRow}
                    onPress={() => handleOpenSaved(saved)}
                    disabled={!openable}
                    activeOpacity={0.7}
                  >
                    <Bell color="#00FFCC" size={18} />
                    <View style={styles.savedRowText}>
                      <Text style={styles.savedRowName} numberOfLines={1}>
                        {saved.eventName}
                      </Text>
                      <Text style={styles.savedRowWhen}>{formatSavedWhen(saved.startDate)}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => handleRemoveSaved(saved.eventId)}
                      disabled={removingEventId === saved.eventId}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      style={styles.savedRemoveButton}
                    >
                      {removingEventId === saved.eventId ? (
                        <ActivityIndicator size="small" color="#FF0055" />
                      ) : (
                        <Trash2 color="#FF0055" size={18} />
                      )}
                    </TouchableOpacity>
                  </TouchableOpacity>
                );
              })}

              {/* Kept visible rather than hidden: these no longer remind, and
                  this is the only place they can be cleared. */}
              {endedSaved.map((saved) => (
                <View key={saved.eventId} style={[styles.savedRow, styles.savedRowEnded]}>
                  <Bell color="#555" size={18} />
                  <View style={styles.savedRowText}>
                    <Text style={[styles.savedRowName, styles.savedRowNameEnded]} numberOfLines={1}>
                      {saved.eventName}
                    </Text>
                    <Text style={styles.savedRowWhen}>
                      Ended · {formatSavedWhen(saved.startDate)}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleRemoveSaved(saved.eventId)}
                    disabled={removingEventId === saved.eventId}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    style={styles.savedRemoveButton}
                  >
                    {removingEventId === saved.eventId ? (
                      <ActivityIndicator size="small" color="#FF0055" />
                    ) : (
                      <Trash2 color="#FF0055" size={18} />
                    )}
                  </TouchableOpacity>
                </View>
              ))}
            </>
          )}
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
  editUsernameBlock: {
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 24,
  },
  usernameHint: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 16,
    color: '#888888',
    textAlign: 'center',
  },
  usernameHintError: {
    color: '#FF5C7A',
  },
  usernameHintNotice: {
    color: '#FFD700',
  },
  usernameCounter: {
    marginTop: 4,
    fontSize: 11,
    color: '#666666',
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
  creatorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255, 215, 0, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.35)',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 6,
  },
  creatorChipText: {
    color: '#FFD700',
    fontSize: 12,
    fontWeight: '700',
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
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  savedRowEnded: {
    opacity: 0.6,
  },
  savedRowText: {
    flex: 1,
    minWidth: 0,
  },
  savedRowName: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  savedRowNameEnded: {
    color: '#999999',
  },
  savedRowWhen: {
    color: '#888888',
    fontSize: 12,
    marginTop: 2,
  },
  savedRemoveButton: {
    padding: 4,
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
