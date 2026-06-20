import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Linking,
  Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Sparkles,
  Trash2,
  Edit,
  Calendar,
  MapPin,
  Save,
  Check,
  ExternalLink,
  AlertTriangle,
  Info,
  X,
  Link
} from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { firestore, functions } from '../services/firebase';
import { doc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import Toast from 'react-native-toast-message';

interface PendingEvent {
  id: string;
  name: string;
  venue: string;
  date: string;
  time: string;
  category: string;
  description: string;
  ticketLink: string | null;
  sourceLink: string | null;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: any;
  curatedBy: 'claude' | 'claude_cleanup';
  originalId?: string;
  action?: 'KEEP' | 'REMOVE' | 'NEEDS EDIT';
  updatedEvent?: any;
  address?: string;
  latitude?: number;
  longitude?: number;
}

const CATEGORY_IMAGES: Record<string, string> = {
  Music: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&q=80&w=600',
  Food: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&q=80&w=600',
  Art: 'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?auto=format&fit=crop&q=80&w=600',
  Sports: 'https://images.unsplash.com/photo-1502224562085-639556652f33?auto=format&fit=crop&q=80&w=600',
  Conference: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&q=80&w=600',
  General: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&q=80&w=600',
};

const CATEGORIES = ['Nightlife', 'Concert', 'Art', 'Food & Market', 'Comedy', 'Festival', 'Other'];

export const AdminAICuratorScreen = () => {
  const navigation = useNavigation();
  const [activeTab, setActiveTab] = useState<'curated' | 'cleanup'>('curated');
  const [pendingEvents, setPendingEvents] = useState<PendingEvent[]>([]);
  
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  
  // Edit Event Modal State
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editVenue, setEditVenue] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editCategory, setEditCategory] = useState('Other');
  const [editTicketLink, setEditTicketLink] = useState('');
  const [editSourceLink, setEditSourceLink] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editLat, setEditLat] = useState('');
  const [editLng, setEditLng] = useState('');

  // Subscribe to pendingEvents where status == "pending"
  useEffect(() => {
    const q = query(
      collection(firestore, 'pendingEvents'),
      where('status', '==', 'pending')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: PendingEvent[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        list.push({
          id: docSnap.id,
          name: data.name || '',
          venue: data.venue || '',
          date: data.date || '',
          time: data.time || '',
          category: data.category || 'Other',
          description: data.description || '',
          ticketLink: data.ticketLink || null,
          sourceLink: data.sourceLink || null,
          status: data.status || 'pending',
          createdAt: data.createdAt,
          curatedBy: data.curatedBy || 'claude',
          originalId: data.originalId,
          action: data.action,
          updatedEvent: data.updatedEvent,
          address: data.address,
          latitude: data.latitude,
          longitude: data.longitude
        });
      });
      setPendingEvents(list);
    }, (err) => {
      console.warn('Failed to listen to pendingEvents:', err);
    });

    return () => unsubscribe();
  }, []);

  const handleRunCurator = async () => {
    setIsLoading(true);
    setLoadingStatus('Running Claude Curator (web searching)...');
    try {
      const curateEvents = httpsCallable(functions, 'curateEventsWithClaudeCallable');
      const result = await curateEvents();
      const data: any = result.data;
      if (data && data.success) {
        Toast.show({
          type: 'success',
          text1: 'Curator Finished',
          text2: `Claude found and added ${data.count} new events!`,
        });
      } else {
        Toast.show({
          type: 'info',
          text1: 'No New Events',
          text2: 'No new events were discovered.',
        });
      }
    } catch (err: any) {
      console.error(err);
      Alert.alert('Curator Failed', err.message || 'An error occurred during event curation.');
    } finally {
      setIsLoading(false);
      setLoadingStatus('');
    }
  };

  const handleRunCleanup = async () => {
    setIsLoading(true);
    setLoadingStatus('Running Live Events Cleanup...');
    try {
      const runCleanup = httpsCallable(functions, 'runEventCleanup');
      const result = await runCleanup();
      const data: any = result.data;
      if (data && data.success) {
        Toast.show({
          type: 'success',
          text1: 'Cleanup Finished',
          text2: `Claude analyzed live events and generated ${data.count} recommendations!`,
        });
        setActiveTab('cleanup');
      } else {
        Toast.show({
          type: 'info',
          text1: 'No Live Events',
          text2: 'No live events found to clean up.',
        });
      }
    } catch (err: any) {
      console.error(err);
      Alert.alert('Cleanup Failed', err.message || 'An error occurred during cleanup processing.');
    } finally {
      setIsLoading(false);
      setLoadingStatus('');
    }
  };

  const parseDateTime = (dateStr: string, timeStr: string) => {
    if (!dateStr) return { startDate: Date.now(), expirationDate: Date.now() + 6 * 3600000 };
    const parts = dateStr.split('/');
    if (parts.length !== 3) return { startDate: Date.now(), expirationDate: Date.now() + 6 * 3600000 };
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parseInt(parts[2], 10);

    let hour = 18;
    let minute = 0;

    if (timeStr) {
      const timeMatch = timeStr.match(/(\d+):(\d+)\s*(pm|am)?/i);
      if (timeMatch) {
        hour = parseInt(timeMatch[1], 10);
        minute = parseInt(timeMatch[2], 10);
        const ampm = timeMatch[3];
        if (ampm) {
          if (ampm.toLowerCase() === 'pm' && hour < 12) hour += 12;
          if (ampm.toLowerCase() === 'am' && hour === 12) hour = 0;
        }
      }
    }

    const pad = (n: number) => String(n).padStart(2, '0');
    const isoString = `${year}-${pad(month + 1)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+03:00`;
    const startDate = new Date(isoString).getTime();
    const expirationDate = startDate + (6 * 60 * 60 * 1000); // 6 hours default

    return { startDate, expirationDate };
  };

  const handleApproveCurated = async (event: PendingEvent) => {
    setIsLoading(true);
    setLoadingStatus('Approving event...');
    try {
      const venuesRef = collection(firestore, 'venues');
      const q = query(venuesRef);
      const snap = await getDocs(q);
      let matchedVenue: any = null;
      snap.forEach((docSnap) => {
        const v = docSnap.data();
        if (v.name && v.name.toLowerCase() === event.venue.toLowerCase()) {
          matchedVenue = v;
        }
      });

      const { startDate, expirationDate } = parseDateTime(event.date, event.time);
      const venueId = `event_ai_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const docRef = doc(firestore, 'venues', venueId);

      const address = event.address || (matchedVenue ? matchedVenue.address : event.venue);
      const latitude = event.latitude !== undefined && event.latitude !== null ? event.latitude : (matchedVenue ? matchedVenue.latitude : -1.286389);
      const longitude = event.longitude !== undefined && event.longitude !== null ? event.longitude : (matchedVenue ? matchedVenue.longitude : 36.817223);

      const categoryMapping: Record<string, string> = {
        Nightlife: 'Music',
        Concert: 'Music',
        Art: 'Art',
        'Food & Market': 'Food',
        Comedy: 'General',
        Festival: 'General',
        Other: 'General',
      };
      const mappedCategory = categoryMapping[event.category] || 'General';
      const imageUrl = CATEGORY_IMAGES[mappedCategory] || CATEGORY_IMAGES.General;

      const venueData = {
        id: venueId,
        name: event.name,
        description: event.description,
        address,
        latitude,
        longitude,
        type: 'Event',
        startDate,
        expirationDate,
        imageUrl,
        simulatedUsersCount: 30,
        ticketLink: event.ticketLink || null,
        sourceLink: event.sourceLink || null
      };

      await setDoc(docRef, venueData);
      await updateDoc(doc(firestore, 'pendingEvents', event.id), { status: 'approved' });

      Toast.show({ type: 'success', text1: 'Event Approved', text2: `"${event.name}" is now live!` });
    } catch (err: any) {
      console.error(err);
      Alert.alert('Approve Failed', err.message || 'Could not approve and publish event.');
    } finally {
      setIsLoading(false);
      setLoadingStatus('');
    }
  };

  const handleRejectCurated = async (event: PendingEvent) => {
    setIsLoading(true);
    setLoadingStatus('Rejecting event...');
    try {
      await updateDoc(doc(firestore, 'pendingEvents', event.id), { status: 'rejected' });
      Toast.show({ type: 'info', text1: 'Event Rejected', text2: `"${event.name}" has been removed.` });
    } catch (err: any) {
      console.error(err);
      Alert.alert('Operation Failed', err.message || 'Could not reject event.');
    } finally {
      setIsLoading(false);
      setLoadingStatus('');
    }
  };

  const handleConfirmCleanup = async (event: PendingEvent) => {
    setIsLoading(true);
    setLoadingStatus('Applying cleanup action...');
    try {
      if (event.action === 'REMOVE') {
        if (event.originalId) {
          await deleteDoc(doc(firestore, 'venues', event.originalId));
          Toast.show({ type: 'success', text1: 'Event Removed', text2: 'Event was deleted from live database.' });
        }
      } else if (event.action === 'NEEDS EDIT') {
        if (event.originalId) {
          const { startDate, expirationDate } = parseDateTime(event.date, event.time);
          const categoryMapping: Record<string, string> = {
            Nightlife: 'Music',
            Concert: 'Music',
            Art: 'Art',
            'Food & Market': 'Food',
            Comedy: 'General',
            Festival: 'General',
            Other: 'General',
          };
          const mappedCategory = categoryMapping[event.category] || 'General';
          const imageUrl = CATEGORY_IMAGES[mappedCategory] || CATEGORY_IMAGES.General;

          const updateData: any = {
            name: event.name,
            description: event.description,
            address: event.venue,
            startDate,
            expirationDate,
            imageUrl,
            ticketLink: event.ticketLink || null,
            sourceLink: event.sourceLink || null
          };

          if (event.latitude !== undefined && event.latitude !== null) updateData.latitude = event.latitude;
          if (event.longitude !== undefined && event.longitude !== null) updateData.longitude = event.longitude;

          await updateDoc(doc(firestore, 'venues', event.originalId), updateData);
          Toast.show({ type: 'success', text1: 'Event Corrected', text2: 'Live event updated successfully.' });
        }
      } else {
        Toast.show({ type: 'success', text1: 'Event Kept', text2: 'Confirmed as valid upcoming event.' });
      }

      await updateDoc(doc(firestore, 'pendingEvents', event.id), { status: 'approved' });
    } catch (err: any) {
      console.error(err);
      Alert.alert('Action Failed', err.message || 'Could not apply cleanup recommendation.');
    } finally {
      setIsLoading(false);
      setLoadingStatus('');
    }
  };

  const handleRejectCleanup = async (event: PendingEvent) => {
    setIsLoading(true);
    setLoadingStatus('Overriding recommendation...');
    try {
      await updateDoc(doc(firestore, 'pendingEvents', event.id), { status: 'rejected' });
      Toast.show({ type: 'info', text1: 'Cleanup Overridden', text2: 'Claude decision bypassed.' });
    } catch (err: any) {
      console.error(err);
      Alert.alert('Override Failed', err.message || 'Could not override recommendation.');
    } finally {
      setIsLoading(false);
      setLoadingStatus('');
    }
  };

  const handleOpenEditModal = (item: PendingEvent) => {
    setEditId(item.id);
    setEditName(item.name);
    setEditDesc(item.description);
    setEditVenue(item.venue);
    setEditDate(item.date);
    setEditTime(item.time);
    setEditCategory(item.category);
    setEditTicketLink(item.ticketLink || '');
    setEditSourceLink(item.sourceLink || '');
    setEditAddress(item.address || '');
    setEditLat(item.latitude !== undefined && item.latitude !== null ? String(item.latitude) : '');
    setEditLng(item.longitude !== undefined && item.longitude !== null ? String(item.longitude) : '');
    setIsEditModalVisible(true);
  };

  const handleSaveEdit = async () => {
    if (!editId) return;
    const latNum = editLat ? parseFloat(editLat) : null;
    const lngNum = editLng ? parseFloat(editLng) : null;

    setIsLoading(true);
    setLoadingStatus('Saving event details...');
    try {
      const updateData: any = {
        name: editName,
        description: editDesc,
        venue: editVenue,
        date: editDate,
        time: editTime,
        category: editCategory,
        ticketLink: editTicketLink || null,
        sourceLink: editSourceLink || null,
        address: editAddress || null,
        latitude: latNum !== null && !isNaN(latNum) ? latNum : null,
        longitude: lngNum !== null && !isNaN(lngNum) ? lngNum : null,
      };

      const item = pendingEvents.find(e => e.id === editId);
      if (item && item.curatedBy === 'claude_cleanup' && item.action === 'NEEDS EDIT') {
        updateData.updatedEvent = {
          name: editName,
          description: editDesc,
          venue: editVenue,
          date: editDate,
          time: editTime,
          category: editCategory,
          ticketLink: editTicketLink || null,
          sourceLink: editSourceLink || null
        };
      }

      await updateDoc(doc(firestore, 'pendingEvents', editId), updateData);
      setIsEditModalVisible(false);
      setEditId(null);
      Toast.show({ type: 'success', text1: 'Saved', text2: 'Modified details saved in database.' });
    } catch (err: any) {
      console.error(err);
      Alert.alert('Save Failed', err.message || 'Could not update event details.');
    } finally {
      setIsLoading(false);
      setLoadingStatus('');
    }
  };

  const filteredEvents = pendingEvents.filter(e => 
    activeTab === 'curated' ? e.curatedBy === 'claude' : e.curatedBy === 'claude_cleanup'
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <ArrowLeft color="#FFFFFF" size={24} />
        </TouchableOpacity>
        <View style={styles.headerTitleRow}>
          <Sparkles color="#00FFCC" size={18} />
          <Text style={styles.headerTitle}>Claude Event Curator</Text>
        </View>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Core Actions Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Sparkles color="#00FFCC" size={20} />
            <Text style={styles.cardTitle}>Curator Controls</Text>
          </View>
          <Text style={styles.cardDesc}>
            Manage Nairobi nightlife event research and live database date cleaning via Claude Sonnet.
          </Text>

          <View style={styles.actionBtnRow}>
            <TouchableOpacity style={[styles.actionBtn, { flex: 1 }]} onPress={handleRunCurator} disabled={isLoading}>
              <Sparkles color="#000" size={16} />
              <Text style={styles.actionBtnText}>Run Curator</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.actionBtn, styles.actionBtnSecondary, { flex: 1 }]} onPress={handleRunCleanup} disabled={isLoading}>
              <AlertTriangle color="#000" size={16} />
              <Text style={styles.actionBtnText}>Run Live Cleanup</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Tab Switcher */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'curated' && styles.tabButtonActive]}
            onPress={() => setActiveTab('curated')}
          >
            <Sparkles color={activeTab === 'curated' ? '#00FFCC' : '#888'} size={16} />
            <Text style={[styles.tabButtonText, activeTab === 'curated' && styles.tabButtonTextActive]}>
              Curations ({pendingEvents.filter(e => e.curatedBy === 'claude').length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'cleanup' && styles.tabButtonActive]}
            onPress={() => setActiveTab('cleanup')}
          >
            <AlertTriangle color={activeTab === 'cleanup' ? '#FFD700' : '#888'} size={16} />
            <Text style={[styles.tabButtonText, activeTab === 'cleanup' && styles.tabButtonTextActive]}>
              Cleanups ({pendingEvents.filter(e => e.curatedBy === 'claude_cleanup').length})
            </Text>
          </TouchableOpacity>
        </View>

        {/* Results Area */}
        {filteredEvents.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Info color="#555" size={40} />
            <Text style={styles.emptyText}>
              {activeTab === 'curated'
                ? "No pending Claude-curated events found. Tap 'Run Curator' to search upcoming Nairobi nightlife events."
                : "No pending cleanup tasks found. Tap 'Run Live Cleanup' to scan live events and detect outdated posts."}
            </Text>
          </View>
        ) : (
          <View style={styles.resultsContainer}>
            {filteredEvents.map((item) => {
              return (
                <View key={item.id} style={styles.eventCard}>
                  {/* Card Header info */}
                  <View style={styles.eventCardHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.eventName}>{item.name}</Text>
                      <View style={styles.badgeRow}>
                        <View style={styles.categoryBadge}>
                          <Text style={styles.categoryText}>{item.category}</Text>
                        </View>
                        {item.curatedBy === 'claude_cleanup' && (
                          <View style={[
                            styles.actionBadge,
                            item.action === 'KEEP' && styles.actionBadgeKeep,
                            item.action === 'REMOVE' && styles.actionBadgeRemove,
                            item.action === 'NEEDS EDIT' && styles.actionBadgeEdit,
                          ]}>
                            <Text style={[
                              styles.actionBadgeText,
                              item.action === 'KEEP' && styles.actionBadgeTextKeep,
                              item.action === 'REMOVE' && styles.actionBadgeTextRemove,
                              item.action === 'NEEDS EDIT' && styles.actionBadgeTextEdit,
                            ]}>
                              {item.action}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </View>

                  {/* Body description */}
                  <Text style={styles.eventDesc}>{item.description}</Text>

                  {/* Metadata fields */}
                  <View style={styles.metaRow}>
                    <MapPin color="#888" size={14} />
                    <Text style={styles.metaText} numberOfLines={1}>{item.venue}</Text>
                  </View>

                  <View style={styles.metaRow}>
                    <Calendar color="#888" size={14} />
                    <Text style={styles.metaText}>{item.date} at {item.time || 'TBD'}</Text>
                  </View>

                  {(item.ticketLink || item.sourceLink) && (
                    <View style={styles.linksRow}>
                      {item.ticketLink && (
                        <TouchableOpacity style={styles.linkButton} onPress={() => Linking.openURL(item.ticketLink!)}>
                          <Link color="#00FFCC" size={12} />
                          <Text style={styles.linkButtonText}>Ticket Link</Text>
                        </TouchableOpacity>
                      )}
                      {item.sourceLink && (
                        <TouchableOpacity style={styles.linkButton} onPress={() => Linking.openURL(item.sourceLink!)}>
                          <ExternalLink color="#00FFCC" size={12} />
                          <Text style={styles.linkButtonText}>Source</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}

                  {/* Action buttons */}
                  {item.curatedBy === 'claude' ? (
                    <View style={styles.cardActionsRow}>
                      <TouchableOpacity style={styles.actionPillApprove} onPress={() => handleApproveCurated(item)}>
                        <Check color="#000" size={14} />
                        <Text style={styles.actionPillTextApprove}>Approve</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.actionPillEdit} onPress={() => handleOpenEditModal(item)}>
                        <Edit color="#00FFCC" size={14} />
                        <Text style={styles.actionPillTextEdit}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.actionPillReject} onPress={() => handleRejectCurated(item)}>
                        <Trash2 color="#FF3366" size={14} />
                        <Text style={styles.actionPillTextReject}>Reject</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={styles.cardActionsRow}>
                      <TouchableOpacity style={styles.actionPillApprove} onPress={() => handleConfirmCleanup(item)}>
                        <Check color="#000" size={14} />
                        <Text style={styles.actionPillTextApprove}>Confirm</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.actionPillEdit} onPress={() => handleOpenEditModal(item)}>
                        <Edit color="#00FFCC" size={14} />
                        <Text style={styles.actionPillTextEdit}>Edit Details</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.actionPillReject} onPress={() => handleRejectCleanup(item)}>
                        <X color="#FF3366" size={14} />
                        <Text style={styles.actionPillTextReject}>Override</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Loading Modal overlay */}
      <Modal visible={isLoading} transparent animationType="fade">
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingContent}>
            <ActivityIndicator size="large" color="#00FFCC" />
            <Text style={styles.loadingTitle}>Claude Curator Active</Text>
            <Text style={styles.loadingSubtitle}>{loadingStatus}</Text>
          </View>
        </View>
      </Modal>

      {/* Edit Event Modal */}
      <Modal visible={isEditModalVisible} transparent animationType="slide">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Event Details</Text>
              <TouchableOpacity onPress={() => setIsEditModalVisible(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalForm}>
              <View style={styles.formGroup}>
                <Text style={styles.label}>Event Name</Text>
                <TextInput style={styles.modalInput} value={editName} onChangeText={setEditName} />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Description</Text>
                <TextInput
                  style={[styles.modalInput, styles.modalTextArea]}
                  multiline
                  numberOfLines={3}
                  value={editDesc}
                  onChangeText={setEditDesc}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Venue / Address Name</Text>
                <TextInput style={styles.modalInput} value={editVenue} onChangeText={setEditVenue} />
              </View>

              <View style={styles.formRow}>
                <View style={[styles.formGroup, { flex: 1, marginRight: 8 }]}>
                  <Text style={styles.label}>Date (DD/MM/YYYY)</Text>
                  <TextInput style={styles.modalInput} value={editDate} onChangeText={setEditDate} placeholder="e.g. 26/07/2026" placeholderTextColor="#555" />
                </View>
                <View style={[styles.formGroup, { flex: 1, marginLeft: 8 }]}>
                  <Text style={styles.label}>Time</Text>
                  <TextInput style={styles.modalInput} value={editTime} onChangeText={setEditTime} placeholder="e.g. 20:00" placeholderTextColor="#555" />
                </View>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Ticket Link</Text>
                <TextInput style={styles.modalInput} value={editTicketLink} onChangeText={setEditTicketLink} placeholder="https://..." placeholderTextColor="#555" />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Source URL</Text>
                <TextInput style={styles.modalInput} value={editSourceLink} onChangeText={setEditSourceLink} placeholder="https://..." placeholderTextColor="#555" />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Physical Address Override (Optional)</Text>
                <TextInput style={styles.modalInput} value={editAddress} onChangeText={setEditAddress} placeholder="e.g. Ngong Racecourse" placeholderTextColor="#555" />
              </View>

              <View style={styles.formRow}>
                <View style={[styles.formGroup, { flex: 1, marginRight: 8 }]}>
                  <Text style={styles.label}>Latitude Override</Text>
                  <TextInput style={styles.modalInput} value={editLat} onChangeText={setEditLat} keyboardType="numeric" placeholder="-1.286389" placeholderTextColor="#555" />
                </View>
                <View style={[styles.formGroup, { flex: 1, marginLeft: 8 }]}>
                  <Text style={styles.label}>Longitude Override</Text>
                  <TextInput style={styles.modalInput} value={editLng} onChangeText={setEditLng} keyboardType="numeric" placeholder="36.817223" placeholderTextColor="#555" />
                </View>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Category</Text>
                <View style={styles.categoryPickerRow}>
                  {CATEGORIES.map((cat) => (
                    <TouchableOpacity
                      key={cat}
                      style={[
                        styles.categoryPickerPill,
                        editCategory === cat && styles.categoryPickerPillActive
                      ]}
                      onPress={() => setEditCategory(cat)}
                    >
                      <Text style={[
                        styles.categoryPickerPillText,
                        editCategory === cat && styles.categoryPickerPillTextActive
                      ]}>
                        {cat}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <TouchableOpacity style={styles.modalSaveBtn} onPress={handleSaveEdit}>
                <Save color="#000" size={16} />
                <Text style={styles.modalSaveBtnText}>Save Draft Details</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
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
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#333',
    marginBottom: 20,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  cardDesc: {
    color: '#888',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  actionBtnRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#00FFCC',
    paddingVertical: 12,
    borderRadius: 12,
  },
  actionBtnSecondary: {
    backgroundColor: '#FFD700',
  },
  actionBtnText: {
    color: '#000',
    fontWeight: '800',
    fontSize: 13,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#2D2D2D',
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
  },
  tabButtonActive: {
    backgroundColor: '#2A2A2A',
  },
  tabButtonText: {
    color: '#888',
    fontSize: 13,
    fontWeight: '600',
  },
  tabButtonTextActive: {
    color: '#FFF',
    fontWeight: '700',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 20,
    gap: 16,
  },
  emptyText: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  resultsContainer: {
    gap: 16,
  },
  eventCard: {
    backgroundColor: '#1E1E1E',
    borderColor: '#333',
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
  },
  eventCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  eventName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 6,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    marginBottom: 4,
  },
  categoryBadge: {
    backgroundColor: 'rgba(0, 255, 204, 0.1)',
    borderColor: '#00FFCC',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  categoryText: {
    color: '#00FFCC',
    fontSize: 10,
    fontWeight: '800',
  },
  actionBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
  },
  actionBadgeKeep: {
    backgroundColor: 'rgba(46, 204, 113, 0.1)',
    borderColor: '#2ecc71',
  },
  actionBadgeRemove: {
    backgroundColor: 'rgba(231, 76, 60, 0.1)',
    borderColor: '#e74c3c',
  },
  actionBadgeEdit: {
    backgroundColor: 'rgba(241, 196, 15, 0.1)',
    borderColor: '#f1c40f',
  },
  actionBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  actionBadgeTextKeep: {
    color: '#2ecc71',
  },
  actionBadgeTextRemove: {
    color: '#e74c3c',
  },
  actionBadgeTextEdit: {
    color: '#f1c40f',
  },
  eventDesc: {
    color: '#AAA',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  metaText: {
    color: '#888',
    fontSize: 12,
    flex: 1,
  },
  linksRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
    marginBottom: 12,
  },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#2A2A2A',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3D3D3D',
  },
  linkButtonText: {
    color: '#00FFCC',
    fontSize: 11,
    fontWeight: '600',
  },
  cardActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#2A2A2A',
    paddingTop: 12,
  },
  actionPillApprove: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#00FFCC',
    paddingVertical: 10,
    borderRadius: 10,
  },
  actionPillTextApprove: {
    color: '#000',
    fontWeight: '800',
    fontSize: 12,
  },
  actionPillEdit: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(0, 255, 204, 0.1)',
    borderColor: '#00FFCC',
    borderWidth: 1,
    paddingVertical: 10,
    borderRadius: 10,
  },
  actionPillTextEdit: {
    color: '#00FFCC',
    fontWeight: '700',
    fontSize: 12,
  },
  actionPillReject: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 51, 102, 0.1)',
    borderColor: '#FF3366',
    borderWidth: 1,
    paddingVertical: 10,
    borderRadius: 10,
  },
  actionPillTextReject: {
    color: '#FF3366',
    fontWeight: '700',
    fontSize: 12,
  },
  loadingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContent: {
    backgroundColor: '#1A1A1A',
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  loadingTitle: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 8,
  },
  loadingSubtitle: {
    color: '#888',
    fontSize: 13,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1A1A1A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
  },
  modalTitle: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '700',
  },
  modalCancelText: {
    color: '#FF3366',
    fontSize: 15,
    fontWeight: '600',
  },
  modalForm: {
    padding: 24,
    paddingBottom: 40,
  },
  formGroup: {
    marginBottom: 16,
  },
  formRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  label: {
    color: '#888',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  modalInput: {
    backgroundColor: '#222',
    borderColor: '#333',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#FFF',
    fontSize: 14,
  },
  modalTextArea: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  categoryPickerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryPickerPill: {
    backgroundColor: '#222',
    borderColor: '#444',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  categoryPickerPillActive: {
    backgroundColor: 'rgba(0, 255, 204, 0.15)',
    borderColor: '#00FFCC',
  },
  categoryPickerPillText: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
  },
  categoryPickerPillTextActive: {
    color: '#00FFCC',
  },
  modalSaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#00FFCC',
    paddingVertical: 16,
    borderRadius: 16,
    marginTop: 16,
  },
  modalSaveBtnText: {
    color: '#000',
    fontWeight: '800',
    fontSize: 15,
  }
});
