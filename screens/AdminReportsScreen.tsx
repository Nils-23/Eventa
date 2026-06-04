import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Trash2,
  UserX,
  Check,
  Flag,
  MessageSquare,
  Image,
  MapPin,
  Clock,
} from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, query, orderBy, onSnapshot, getDocs } from 'firebase/firestore';
import Toast from 'react-native-toast-message';
import { firestore } from '../services/firebase';
import {
  dismissReport,
  resolveReportWithContentRemoval,
  resolveReportWithUserSuspension,
  resolveReportWithUserWarning,
  resolveReportWithUserRemoval,
  ReportData,
} from '../services/reportService';

export const AdminReportsScreen = () => {
  const navigation = useNavigation();
  const [reports, setReports] = useState<ReportData[]>([]);
  const [loading, setLoading] = useState(true);
  const [userMap, setUserMap] = useState<Record<string, string>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Fetch usernames for reporterId and reportedUserId
  const fetchUsernames = async () => {
    try {
      const querySnapshot = await getDocs(collection(firestore, 'users'));
      const fetchedUsers: Record<string, string> = {};
      querySnapshot.docs.forEach((doc) => {
        const data = doc.data();
        fetchedUsers[doc.id] = data.username || data.email || doc.id;
      });
      setUserMap(fetchedUsers);
    } catch (error) {
      console.warn('Failed to fetch usernames for lookups:', error);
    }
  };

  useEffect(() => {
    fetchUsernames();

    const reportsRef = collection(firestore, 'reports');
    // Listen to all reports that are pending, sorted by timestamp descending
    const q = query(reportsRef, orderBy('timestamp', 'desc'));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const fetched: ReportData[] = [];
        snapshot.docs.forEach((doc) => {
          const data = doc.data() as ReportData;
          if (data.status === 'pending') {
            fetched.push({ ...data, id: doc.id });
          }
        });
        setReports(fetched);
        setLoading(false);
      },
      (error) => {
        console.warn('Error listening to reports:', error);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  const handleDismiss = async (reportId: string) => {
    Alert.alert(
      'Dismiss Report',
      'Are you sure you want to dismiss this report? No content will be modified.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Dismiss',
          onPress: async () => {
            setActionLoading(reportId);
            try {
              await dismissReport(reportId);
              Toast.show({
                type: 'success',
                text1: 'Report Dismissed',
                text2: 'The report has been cleared.',
              });
            } catch (error) {
              Toast.show({
                type: 'error',
                text1: 'Error',
                text2: 'Failed to dismiss report.',
              });
            } finally {
              setActionLoading(null);
            }
          },
        },
      ]
    );
  };

  const handleRemoveContent = async (report: ReportData) => {
    if (report.contentType === 'user_hidden') return;
    const contentText =
      report.contentType === 'chat'
        ? 'chat message'
        : report.contentType === 'post'
        ? 'story post'
        : 'venue listing';

    Alert.alert(
      'Remove Content',
      `Are you sure you want to delete/hide this ${contentText}? This action is permanent.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove Content',
          style: 'destructive',
          onPress: async () => {
            if (!report.id) return;
            setActionLoading(report.id);
            try {
              await resolveReportWithContentRemoval(
                report.id,
                report.contentType as 'chat' | 'post' | 'venue',
                report.contentId,
                report.venueId
              );
              Toast.show({
                type: 'success',
                text1: 'Content Removed',
                text2: `The ${contentText} has been removed and report resolved.`,
              });
            } catch (error) {
              Toast.show({
                type: 'error',
                text1: 'Error',
                text2: 'Failed to remove content. Please verify data.',
              });
            } finally {
              setActionLoading(null);
            }
          },
        },
      ]
    );
  };

  const handleSuspendUser = async (report: ReportData) => {
    if (!report.reportedUserId) {
      Toast.show({
        type: 'error',
        text1: 'Invalid Action',
        text2: 'No creator profile is associated with this reported content.',
      });
      return;
    }

    const username = userMap[report.reportedUserId] || report.reportedUserId;

    Alert.alert(
      'Suspend Creator',
      `Are you sure you want to suspend account access for ${username}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Suspend User',
          style: 'destructive',
          onPress: async () => {
            if (!report.id || !report.reportedUserId) return;
            setActionLoading(report.id);
            try {
              await resolveReportWithUserSuspension(report.id, report.reportedUserId);
              Toast.show({
                type: 'success',
                text1: 'User Suspended',
                text2: `${username} has been suspended.`,
              });
            } catch (error) {
              Toast.show({
                type: 'error',
                text1: 'Error',
                text2: 'Failed to suspend user.',
              });
            } finally {
              setActionLoading(null);
            }
          },
        },
      ]
    );
  };

  const handleWarnUser = async (report: ReportData) => {
    if (!report.reportedUserId) return;
    const username = userMap[report.reportedUserId] || report.reportedUserId;

    Alert.alert(
      'Warn Creator',
      `Are you sure you want to warn ${username}? This will increment their warnings count.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Warn User',
          onPress: async () => {
            if (!report.id || !report.reportedUserId) return;
            setActionLoading(report.id);
            try {
              await resolveReportWithUserWarning(report.id, report.reportedUserId);
              Toast.show({
                type: 'success',
                text1: 'User Warned',
                text2: `${username} has been warned.`,
              });
            } catch (error) {
              Toast.show({
                type: 'error',
                text1: 'Error',
                text2: 'Failed to warn user.',
              });
            } finally {
              setActionLoading(null);
            }
          },
        },
      ]
    );
  };

  const handleRemoveUser = async (report: ReportData) => {
    if (!report.reportedUserId) return;
    const username = userMap[report.reportedUserId] || report.reportedUserId;

    Alert.alert(
      'Remove Creator',
      `Are you sure you want to delete the account for ${username}? This is permanent.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove User',
          style: 'destructive',
          onPress: async () => {
            if (!report.id || !report.reportedUserId) return;
            setActionLoading(report.id);
            try {
              await resolveReportWithUserRemoval(report.id, report.reportedUserId);
              Toast.show({
                type: 'success',
                text1: 'User Removed',
                text2: `${username} has been deleted.`,
              });
            } catch (error) {
              Toast.show({
                type: 'error',
                text1: 'Error',
                text2: 'Failed to remove user.',
              });
            } finally {
              setActionLoading(null);
            }
          },
        },
      ]
    );
  };

  const renderIcon = (type: 'chat' | 'post' | 'venue' | 'user_hidden') => {
    switch (type) {
      case 'chat':
        return <MessageSquare color="#00FFCC" size={16} />;
      case 'post':
        return <Image color="#FF00CC" size={16} />;
      case 'venue':
        return <MapPin color="#FFCC00" size={16} />;
      case 'user_hidden':
        return <UserX color="#FF3366" size={16} />;
    }
  };

  const formatTime = (timestamp: any) => {
    if (!timestamp) return 'Just now';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const renderItem = ({ item }: { item: ReportData }) => {
    const reporterName = userMap[item.reporterId] || item.reporterId;
    const reportedName = item.reportedUserId
      ? userMap[item.reportedUserId] || item.reportedUserId
      : 'N/A (Venue/Listing)';

    const isActioning = actionLoading === item.id;

    const getBadgeColor = (type: string) => {
      switch (type) {
        case 'chat': return '#00FFCC';
        case 'post': return '#FF00CC';
        case 'venue': return '#FFCC00';
        case 'user_hidden': return '#FF3366';
        default: return '#FFF';
      }
    };
    const badgeColor = getBadgeColor(item.contentType);

    return (
      <View style={styles.reportCard}>
        <View style={styles.cardHeader}>
          <View style={styles.badgeContainer}>
            {renderIcon(item.contentType)}
            <Text style={[styles.badgeText, { color: badgeColor }]}>
              {item.contentType.toUpperCase()}
            </Text>
          </View>
          <View style={styles.timeContainer}>
            <Clock color="#888" size={12} />
            <Text style={styles.timeText}>{formatTime(item.timestamp)}</Text>
          </View>
        </View>

        <Text style={styles.reasonText}>Reason: {item.reason}</Text>

        <View style={styles.snippetBox}>
          <Text style={styles.snippetTitle}>REPORTED CONTENT:</Text>
          <Text style={styles.snippetContent} numberOfLines={4}>
            {item.contentSnippet || '(No content text available)'}
          </Text>
        </View>

        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>
            Reporter: <Text style={styles.metaValue}>{reporterName}</Text>
          </Text>
          <Text style={styles.metaLabel}>
            Reported User: <Text style={styles.metaValue}>{reportedName}</Text>
          </Text>
        </View>

        {isActioning ? (
          <ActivityIndicator color="#FF00CC" style={styles.cardLoader} />
        ) : (
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.actionButton, styles.dismissButton]}
              onPress={() => item.id && handleDismiss(item.id)}
            >
              <Check color="#00FFCC" size={16} />
              <Text style={styles.dismissText}>Dismiss</Text>
            </TouchableOpacity>

            {item.contentType === 'user_hidden' ? (
              <>
                {item.reportedUserId && (
                  <>
                    <TouchableOpacity
                      style={[styles.actionButton, styles.warnButton]}
                      onPress={() => handleWarnUser(item)}
                    >
                      <UserX color="#FFCC00" size={16} />
                      <Text style={styles.warnText}>Warn Creator</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.actionButton, styles.suspendButton]}
                      onPress={() => handleSuspendUser(item)}
                    >
                      <UserX color="#FF9900" size={16} />
                      <Text style={styles.suspendText}>Suspend Creator</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.actionButton, styles.removeButton]}
                      onPress={() => handleRemoveUser(item)}
                    >
                      <Trash2 color="#FF3366" size={16} />
                      <Text style={styles.removeText}>Remove Creator</Text>
                    </TouchableOpacity>
                  </>
                )}
              </>
            ) : (
              <>
                <TouchableOpacity
                  style={[styles.actionButton, styles.removeButton]}
                  onPress={() => handleRemoveContent(item)}
                >
                  <Trash2 color="#FF3366" size={16} />
                  <Text style={styles.removeText}>Remove Content</Text>
                </TouchableOpacity>

                {item.reportedUserId && (
                  <TouchableOpacity
                    style={[styles.actionButton, styles.suspendButton]}
                    onPress={() => handleSuspendUser(item)}
                  >
                    <UserX color="#FF9900" size={16} />
                    <Text style={styles.suspendText}>Suspend Creator</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <ArrowLeft color="#FFFFFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Platform Moderation</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <View style={styles.loaderContainer}>
          <ActivityIndicator size="large" color="#FF00CC" />
          <Text style={styles.loaderText}>Fetching reports...</Text>
        </View>
      ) : (
        <FlatList
          data={reports}
          renderItem={renderItem}
          keyExtractor={(item) => item.id || ''}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Flag color="#444" size={48} />
              <Text style={styles.emptyTitle}>All Clean!</Text>
              <Text style={styles.emptySubtitle}>There are no pending user reports to review.</Text>
            </View>
          }
        />
      )}
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
  loaderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loaderText: {
    color: '#888',
    marginTop: 12,
    fontSize: 14,
  },
  listContent: {
    padding: 16,
  },
  reportCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  badgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 6,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  timeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  timeText: {
    color: '#888',
    fontSize: 12,
  },
  reasonText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 12,
  },
  snippetBox: {
    backgroundColor: '#121212',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#222',
  },
  snippetTitle: {
    color: '#FF00CC',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 6,
  },
  snippetContent: {
    color: '#CCC',
    fontSize: 13,
    lineHeight: 18,
  },
  metaRow: {
    marginBottom: 16,
    gap: 4,
  },
  metaLabel: {
    color: '#888',
    fontSize: 12,
  },
  metaValue: {
    color: '#FFF',
    fontWeight: '500',
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#2A2A2A',
    paddingTop: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  dismissButton: {
    backgroundColor: 'rgba(0, 255, 204, 0.1)',
  },
  dismissText: {
    color: '#00FFCC',
    fontSize: 12,
    fontWeight: '600',
  },
  removeButton: {
    backgroundColor: 'rgba(255, 51, 102, 0.1)',
  },
  removeText: {
    color: '#FF3366',
    fontSize: 12,
    fontWeight: '600',
  },
  suspendButton: {
    backgroundColor: 'rgba(255, 153, 0, 0.1)',
  },
  suspendText: {
    color: '#FF9900',
    fontSize: 12,
    fontWeight: '600',
  },
  warnButton: {
    backgroundColor: 'rgba(255, 204, 0, 0.1)',
  },
  warnText: {
    color: '#FFCC00',
    fontSize: 12,
    fontWeight: '600',
  },
  cardLoader: {
    marginTop: 12,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
  },
  emptyTitle: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 4,
  },
  emptySubtitle: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
});
