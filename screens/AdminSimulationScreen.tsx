import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Alert, Modal, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Users, Plus, Save, X, UploadCloud } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { useLiveVenues, LiveVenue as Venue } from '../hooks/useLiveVenues';
import { firestore } from '../services/firebase';
import { doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import Toast from 'react-native-toast-message';
import * as ImagePicker from 'expo-image-picker';
import { uploadStoryMedia, createSimulatedStory } from '../services/storyService';
import { Trash2 } from 'lucide-react-native';

export const AdminSimulationScreen = () => {
  const navigation = useNavigation();
  const { venues, isLoading } = useLiveVenues();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingCounts, setEditingCounts] = useState<Record<string, string>>({});
  const [uploadingVenueId, setUploadingVenueId] = useState<string | null>(null);
  
  // New Venue State
  const [newVenueName, setNewVenueName] = useState('');
  const [newVenueLat, setNewVenueLat] = useState('');
  const [newVenueLng, setNewVenueLng] = useState('');
  const [newVenueDesc, setNewVenueDesc] = useState('');
  const [newVenueType, setNewVenueType] = useState<'Club' | 'Bar' | 'Festival' | 'Event'>('Club');
  const [newVenueExpiration, setNewVenueExpiration] = useState('');

  const handleUpdateCount = async (venueId: string) => {
    const value = editingCounts[venueId];
    if (!value) return;

    const count = parseInt(value, 10);
    if (isNaN(count) || count < 0) {
      Toast.show({ type: 'error', text1: 'Invalid Number', text2: 'Please enter a valid positive number.' });
      return;
    }

    try {
      const venueRef = doc(firestore, 'venues', venueId);
      await updateDoc(venueRef, {
        simulatedUsersCount: count
      });
      Toast.show({ type: 'success', text1: 'Updated!', text2: `Simulated users count updated.` });
    } catch (error) {
      console.error('Error updating venue:', error);
      Toast.show({ type: 'error', text1: 'Error', text2: 'Failed to update simulated users count.' });
    }
  };

  const handleCreateVenue = async () => {
    if (!newVenueName || !newVenueLat || !newVenueLng || !newVenueDesc) {
      Toast.show({ type: 'error', text1: 'Missing Fields', text2: 'Please fill in all basic fields.' });
      return;
    }

    if ((newVenueType === 'Festival' || newVenueType === 'Event') && !newVenueExpiration) {
      Toast.show({ type: 'error', text1: 'Missing Expiration', text2: `${newVenueType}s must have an expiration date.` });
      return;
    }

    let expirationDate = null;
    if (newVenueExpiration) {
      const parsedDate = new Date(newVenueExpiration);
      if (isNaN(parsedDate.getTime())) {
        Toast.show({ type: 'error', text1: 'Invalid Date', text2: 'Please use YYYY-MM-DD format.' });
        return;
      }
      expirationDate = parsedDate.getTime();
    }

    const lat = parseFloat(newVenueLat);
    const lng = parseFloat(newVenueLng);

    if (isNaN(lat) || isNaN(lng)) {
      Toast.show({ type: 'error', text1: 'Invalid Coordinates', text2: 'Latitude and Longitude must be numbers.' });
      return;
    }

    try {
      const newVenueId = `venue_${Date.now()}`;
      const venueRef = doc(firestore, 'venues', newVenueId);
      
      const venueData: any = {
        name: newVenueName,
        latitude: lat,
        longitude: lng,
        description: newVenueDesc,
        type: newVenueType,
        simulatedUsersCount: 0
      };
      
      if (expirationDate) {
        venueData.expirationDate = expirationDate;
      }

      await setDoc(venueRef, venueData);

      Toast.show({ type: 'success', text1: 'Venue Created', text2: `${newVenueName} has been added.` });
      setIsModalVisible(false);
      setNewVenueName('');
      setNewVenueLat('');
      setNewVenueLng('');
      setNewVenueDesc('');
      setNewVenueType('Club');
      setNewVenueExpiration('');
    } catch (error) {
      console.error('Error creating venue:', error);
      Toast.show({ type: 'error', text1: 'Error', text2: 'Failed to create new venue.' });
    }
  };

  const handleUploadStory = async (venue: Venue) => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Toast.show({ type: 'error', text1: 'Permission Denied', text2: 'Gallery access is required.' });
        return;
      }

      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images', 'videos'],
        allowsEditing: true,
        quality: 0.7,
      };

      const result = await ImagePicker.launchImageLibraryAsync(options);

      if (!result.canceled && result.assets.length > 0) {
        setUploadingVenueId(venue.id);
        const uri = result.assets[0].uri;
        const mediaType = result.assets[0].type === 'video' ? 'video' : 'image';

        const downloadUrl = await uploadStoryMedia(uri, `sim_admin_${Date.now()}`);
        await createSimulatedStory(downloadUrl, mediaType, venue.id);

        Toast.show({
          type: 'success',
          text1: 'Story Preloaded!',
          text2: `A simulated story was added to ${venue.name}.`,
        });
      }
    } catch (error) {
      console.error('Upload Error:', error);
      Toast.show({
        type: 'error',
        text1: 'Upload Failed',
        text2: 'Could not upload the simulated story.',
      });
    } finally {
      setUploadingVenueId(null);
    }
  };

  const handleDeleteVenue = (venue: Venue) => {
    Alert.alert(
      'Delete Venue',
      `Are you sure you want to delete ${venue.name}? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteDoc(doc(firestore, 'venues', venue.id));
              Toast.show({ type: 'success', text1: 'Venue Deleted', text2: `${venue.name} has been removed.` });
            } catch (error) {
              console.error('Error deleting venue:', error);
              Toast.show({ type: 'error', text1: 'Error', text2: 'Failed to delete venue.' });
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <ArrowLeft color="#FFFFFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Admin Dashboard</Text>
        <TouchableOpacity onPress={() => setIsModalVisible(true)} style={styles.addButton}>
          <Plus color="#00FFCC" size={24} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.sectionHeader}>
          <Users color="#FF00CC" size={20} />
          <Text style={styles.sectionTitle}>Simulated Users Control</Text>
        </View>
        <Text style={styles.sectionSubtitle}>
          Adjust the number of simulated users for each venue. Changes will reflect in real-time.
        </Text>

        {isLoading ? (
          <Text style={styles.loadingText}>Loading venues...</Text>
        ) : (
          venues.map(venue => (
            <View key={venue.id} style={styles.venueCard}>
              <View style={styles.venueInfo}>
                <Text style={styles.venueName}>{venue.name}</Text>
                <Text style={styles.venueCurrentCount}>
                  Current Target: {venue.simulatedUsersCount ?? 20}
                </Text>
                {venue.type && (
                  <Text style={styles.venueType}>Type: {venue.type}</Text>
                )}
              </View>
              
              <View style={styles.venueControls}>
                <TextInput
                  style={styles.countInput}
                  keyboardType="numeric"
                  placeholder={String(venue.simulatedUsersCount ?? 20)}
                  placeholderTextColor="#666"
                  value={editingCounts[venue.id] !== undefined ? editingCounts[venue.id] : ''}
                  onChangeText={(text) => setEditingCounts(prev => ({ ...prev, [venue.id]: text }))}
                />
                <TouchableOpacity 
                  style={styles.saveButton}
                  onPress={() => handleUpdateCount(venue.id)}
                >
                  <Save color="#000" size={16} />
                  <Text style={styles.saveButtonText}>Set</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={styles.uploadButton}
                  onPress={() => handleUploadStory(venue)}
                  disabled={uploadingVenueId === venue.id}
                >
                  {uploadingVenueId === venue.id ? (
                    <ActivityIndicator size="small" color="#000" />
                  ) : (
                    <>
                      <UploadCloud color="#000" size={16} />
                      <Text style={styles.saveButtonText}>Upload</Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity 
                  style={styles.deleteButton}
                  onPress={() => handleDeleteVenue(venue)}
                >
                  <Trash2 color="#FFF" size={16} />
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {/* Add Venue Modal */}
      <Modal visible={isModalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add New Venue</Text>
              <TouchableOpacity onPress={() => setIsModalVisible(false)}>
                <X color="#FFFFFF" size={24} />
              </TouchableOpacity>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Venue Name</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. The Alchemist"
                placeholderTextColor="#666"
                value={newVenueName}
                onChangeText={setNewVenueName}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Venue Type</Text>
              <View style={styles.typeSelectorRow}>
                {(['Club', 'Bar', 'Festival', 'Event'] as const).map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[styles.typePill, newVenueType === type && styles.typePillSelected]}
                    onPress={() => setNewVenueType(type)}
                  >
                    <Text style={[styles.typePillText, newVenueType === type && styles.typePillTextSelected]}>
                      {type}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {(newVenueType === 'Festival' || newVenueType === 'Event') && (
              <View style={styles.formGroup}>
                <Text style={styles.label}>Expiration Date (Mandatory for {newVenueType}s)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#666"
                  value={newVenueExpiration}
                  onChangeText={setNewVenueExpiration}
                />
              </View>
            )}

            <View style={styles.rowFormGroup}>
              <View style={[styles.formGroup, { flex: 1, marginRight: 8 }]}>
                <Text style={styles.label}>Latitude</Text>
                <TextInput
                  style={styles.input}
                  placeholder="-1.2664"
                  placeholderTextColor="#666"
                  keyboardType="numeric"
                  value={newVenueLat}
                  onChangeText={setNewVenueLat}
                />
              </View>
              <View style={[styles.formGroup, { flex: 1, marginLeft: 8 }]}>
                <Text style={styles.label}>Longitude</Text>
                <TextInput
                  style={styles.input}
                  placeholder="36.7966"
                  placeholderTextColor="#666"
                  keyboardType="numeric"
                  value={newVenueLng}
                  onChangeText={setNewVenueLng}
                />
              </View>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Description</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Brief description of the venue..."
                placeholderTextColor="#666"
                multiline
                numberOfLines={3}
                value={newVenueDesc}
                onChangeText={setNewVenueDesc}
              />
            </View>

            <TouchableOpacity style={styles.createButton} onPress={handleCreateVenue}>
              <Text style={styles.createButtonText}>Create Venue</Text>
            </TouchableOpacity>
          </View>
        </View>
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
  addButton: {
    padding: 4,
  },
  content: {
    padding: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    color: '#FF00CC',
    fontSize: 20,
    fontWeight: '700',
    marginLeft: 8,
  },
  sectionSubtitle: {
    color: '#888',
    fontSize: 14,
    marginBottom: 24,
    lineHeight: 20,
  },
  loadingText: {
    color: '#888',
    textAlign: 'center',
    marginTop: 20,
  },
  venueCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  venueInfo: {
    flex: 1,
  },
  venueName: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  venueCurrentCount: {
    color: '#00FFCC',
    fontSize: 12,
  },
  venueType: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  venueControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  countInput: {
    backgroundColor: '#2A2A2A',
    color: '#FFFFFF',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    width: 60,
    textAlign: 'center',
    fontSize: 16,
  },
  saveButton: {
    backgroundColor: '#00FFCC',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 4,
  },
  saveButtonText: {
    color: '#000',
    fontWeight: '600',
    fontSize: 14,
  },
  uploadButton: {
    backgroundColor: '#FF00CC',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 4,
  },
  deleteButton: {
    backgroundColor: '#FF3333',
    padding: 8,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#333',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  formGroup: {
    marginBottom: 16,
  },
  rowFormGroup: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  label: {
    color: '#888',
    fontSize: 14,
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#2A2A2A',
    color: '#FFFFFF',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  createButton: {
    backgroundColor: '#FF00CC',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  typeSelectorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  typePill: {
    backgroundColor: '#2A2A2A',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  typePillSelected: {
    backgroundColor: 'rgba(255, 0, 204, 0.2)',
    borderColor: '#FF00CC',
  },
  typePillText: {
    color: '#888',
    fontSize: 14,
    fontWeight: '600',
  },
  typePillTextSelected: {
    color: '#FF00CC',
  },
});
