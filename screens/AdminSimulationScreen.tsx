import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Alert, Modal, ActivityIndicator, KeyboardAvoidingView, Platform, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Users, Plus, Save, X, UploadCloud, Trash2, Calendar } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { useLiveVenues, LiveVenue as Venue } from '../hooks/useLiveVenues';
import { firestore, storage } from '../services/firebase';
import { doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import Toast from 'react-native-toast-message';
import * as ImagePicker from 'expo-image-picker';
import { uploadStoryMedia, createSimulatedStory } from '../services/storyService';
import { getFallbackImageByType } from '../utils/venueImageUtils';

export const AdminSimulationScreen = () => {
  const navigation = useNavigation();
  const { venues, scheduledVenues = [], isLoading } = useLiveVenues();
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
  const [newVenueStartDate, setNewVenueStartDate] = useState('');
  const [newVenueAddress, setNewVenueAddress] = useState('');
  const [newVenueGoogleImageUrl, setNewVenueGoogleImageUrl] = useState('');
  const [customImageUri, setCustomImageUri] = useState<string | null>(null);
  const [isUploadingCustomImage, setIsUploadingCustomImage] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);

  const fetchSuggestions = async (input: string) => {
    if (input.length < 3) {
      setSuggestions([]);
      return;
    }
    try {
      const apiKey = 'REDACTED_GOOGLE_MAPS_KEY';
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&location=-1.286389,36.817223&radius=50000&key=${apiKey}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.status === 'OK') {
        setSuggestions(data.predictions);
      } else {
        setSuggestions([]);
      }
    } catch (error) {
      console.warn('Error fetching place suggestions:', error);
      setSuggestions([]);
    }
  };

  const handleSelectSuggestion = async (placeId: string) => {
    try {
      const apiKey = 'REDACTED_GOOGLE_MAPS_KEY';
      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=geometry,formatted_address,name,photos&key=${apiKey}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.status === 'OK' && data.result) {
        const { geometry, formatted_address, name, photos } = data.result;
        setNewVenueName(name || '');
        setNewVenueLat(geometry?.location?.lat ? String(geometry.location.lat) : '');
        setNewVenueLng(geometry?.location?.lng ? String(geometry.location.lng) : '');
        setNewVenueAddress(formatted_address || '');
        
        if (photos && photos.length > 0) {
          const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${photos[0].photo_reference}&key=${apiKey}`;
          setNewVenueGoogleImageUrl(photoUrl);
        } else {
          setNewVenueGoogleImageUrl('');
        }
        
        setSuggestions([]);
      }
    } catch (error) {
      console.warn('Error getting place details:', error);
      Toast.show({ type: 'error', text1: 'Lookup Failed', text2: 'Could not fetch details from Google Maps.' });
    }
  };

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

  const handleSelectCustomImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Toast.show({ type: 'error', text1: 'Permission Denied', text2: 'Gallery access is required to upload a thumbnail.' });
        return;
      }

      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.7,
        aspect: [16, 9],
      };

      const result = await ImagePicker.launchImageLibraryAsync(options);

      if (!result.canceled && result.assets.length > 0) {
        setCustomImageUri(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Image Picker Error:', error);
      Toast.show({
        type: 'error',
        text1: 'Selection Failed',
        text2: 'Could not open the gallery.',
      });
    }
  };

  const uploadVenueThumbnail = async (uri: string, venueId: string): Promise<string> => {
    const fileExtension = uri.split('.').pop() || 'jpg';
    const fileName = `venues/${venueId}_${Date.now()}.${fileExtension}`;
    const storageRef = ref(storage, fileName);

    const response = await fetch(uri);
    const blob = await response.blob();

    const uploadTask = await uploadBytesResumable(storageRef, blob);
    return getDownloadURL(uploadTask.ref);
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

    let startDate = null;
    if ((newVenueType === 'Festival' || newVenueType === 'Event') && newVenueStartDate) {
      const parsedDate = new Date(newVenueStartDate);
      if (isNaN(parsedDate.getTime())) {
        Toast.show({ type: 'error', text1: 'Invalid Date', text2: 'Please use YYYY-MM-DD format for Start Date.' });
        return;
      }
      startDate = parsedDate.getTime();

      if (expirationDate && startDate >= expirationDate) {
        Toast.show({ type: 'error', text1: 'Invalid Dates', text2: 'Start Date must be before Expiration Date.' });
        return;
      }
    }

    const lat = parseFloat(newVenueLat);
    const lng = parseFloat(newVenueLng);

    if (isNaN(lat) || isNaN(lng)) {
      Toast.show({ type: 'error', text1: 'Invalid Coordinates', text2: 'Latitude and Longitude must be numbers.' });
      return;
    }

    setIsUploadingCustomImage(true);

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
      
      if (newVenueAddress) {
        venueData.address = newVenueAddress;
      }
      
      if (newVenueGoogleImageUrl) {
        venueData.googleImageUrl = newVenueGoogleImageUrl;
      }

      // If a custom image was selected by the admin, upload it to storage
      if (customImageUri) {
        const downloadUrl = await uploadVenueThumbnail(customImageUri, newVenueId);
        venueData.customImageUrl = downloadUrl;
      }
      
      if (expirationDate) {
        venueData.expirationDate = expirationDate;
      }

      if (startDate) {
        venueData.startDate = startDate;
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
      setNewVenueStartDate('');
      setNewVenueAddress('');
      setNewVenueGoogleImageUrl('');
      setCustomImageUri(null);
      setSuggestions([]);
    } catch (error) {
      console.error('Error creating venue:', error);
      Toast.show({ type: 'error', text1: 'Error', text2: 'Failed to create new venue.' });
    } finally {
      setIsUploadingCustomImage(false);
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

        {/* Divider */}
        {scheduledVenues.length > 0 && (
          <View style={styles.sectionDivider} />
        )}

        {/* Scheduled Future Events Section */}
        {scheduledVenues.length > 0 && (
          <>
            <View style={[styles.sectionHeader, { marginTop: 24 }]}>
              <Calendar color="#00FFCC" size={20} />
              <Text style={[styles.sectionTitle, { color: '#00FFCC' }]}>Scheduled Upcoming Events</Text>
            </View>
            <Text style={styles.sectionSubtitle}>
              These events are scheduled for a future date and are currently hidden from public maps/lists.
            </Text>

            {scheduledVenues.map(venue => {
              const startDateStr = venue.startDate ? new Date(venue.startDate).toLocaleDateString() : 'N/A';
              const endDateStr = venue.expirationDate ? new Date(venue.expirationDate).toLocaleDateString() : 'N/A';
              return (
                <View key={venue.id} style={styles.venueCard}>
                  <View style={styles.venueInfo}>
                    <Text style={styles.venueName}>{venue.name}</Text>
                    <Text style={styles.scheduledDateText}>
                      Starts: {startDateStr}
                    </Text>
                    <Text style={styles.scheduledDateText}>
                      Expires: {endDateStr}
                    </Text>
                    {venue.type && (
                      <Text style={styles.venueType}>Type: {venue.type}</Text>
                    )}
                  </View>
                  
                  <View style={styles.venueControls}>
                    <TouchableOpacity 
                      style={styles.deleteButton}
                      onPress={() => handleDeleteVenue(venue)}
                    >
                      <Trash2 color="#FFF" size={16} />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </>
        )}
      </ScrollView>

      <Modal
        visible={isModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsModalVisible(false)}
        statusBarTranslucent={true}
      >
        <KeyboardAvoidingView
          behavior="padding"
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add New Venue</Text>
              <TouchableOpacity onPress={() => setIsModalVisible(false)}>
                <X color="#FFFFFF" size={24} />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 16 }}
            >
              <View style={styles.formGroup}>
                <Text style={styles.label}>Venue Name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Search venue on Google Maps..."
                  placeholderTextColor="#666"
                  value={newVenueName}
                  onChangeText={(text) => {
                    setNewVenueName(text);
                    fetchSuggestions(text);
                  }}
                />
                {suggestions.length > 0 && (
                  <View style={styles.suggestionsContainer}>
                    {suggestions.map((item) => (
                      <TouchableOpacity
                        key={item.place_id}
                        style={styles.suggestionItem}
                        onPress={() => handleSelectSuggestion(item.place_id)}
                      >
                        <Text style={styles.suggestionText} numberOfLines={1}>
                          {item.description}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Address</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Parklands Rd, Westlands, Nairobi"
                  placeholderTextColor="#666"
                  value={newVenueAddress}
                  onChangeText={setNewVenueAddress}
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
                <>
                  <View style={styles.formGroup}>
                    <Text style={styles.label}>Scheduled Start Date (Optional, YYYY-MM-DD)</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor="#666"
                      value={newVenueStartDate}
                      onChangeText={setNewVenueStartDate}
                    />
                  </View>

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
                </>
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

              {/* Thumbnail Image Picker & Preview Section */}
              <View style={styles.formGroup}>
                <Text style={styles.label}>Thumbnail Image</Text>
                
                <View style={styles.previewContainer}>
                  {customImageUri ? (
                    <>
                      <Image source={{ uri: customImageUri }} style={styles.previewImage} />
                      <View style={[styles.previewBadge, { backgroundColor: '#FF00CC' }]}>
                        <Text style={styles.previewBadgeText}>Admin Override</Text>
                      </View>
                      <TouchableOpacity 
                        style={styles.removeImageButton} 
                        onPress={() => setCustomImageUri(null)}
                      >
                        <X color="#FFF" size={14} />
                      </TouchableOpacity>
                    </>
                  ) : newVenueGoogleImageUrl ? (
                    <>
                      <Image source={{ uri: newVenueGoogleImageUrl }} style={styles.previewImage} />
                      <View style={[styles.previewBadge, { backgroundColor: '#00FFCC' }]}>
                        <Text style={[styles.previewBadgeText, { color: '#000' }]}>Google Maps Fetch</Text>
                      </View>
                    </>
                  ) : (
                    <>
                      <Image source={{ uri: getFallbackImageByType(newVenueType) }} style={styles.previewImage} />
                      <View style={[styles.previewBadge, { backgroundColor: '#888' }]}>
                        <Text style={styles.previewBadgeText}>Category Fallback ({newVenueType})</Text>
                      </View>
                    </>
                  )}
                </View>

                <TouchableOpacity 
                  style={styles.imageUploadButton} 
                  onPress={handleSelectCustomImage}
                >
                  <UploadCloud color="#FF00CC" size={20} />
                  <Text style={styles.imageUploadButtonText}>
                    {customImageUri ? 'Change Custom Thumbnail' : 'Upload Custom Thumbnail (Optional)'}
                  </Text>
                </TouchableOpacity>
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

              <TouchableOpacity 
                style={[styles.createButton, isUploadingCustomImage && styles.createButtonDisabled]} 
                onPress={handleCreateVenue}
                disabled={isUploadingCustomImage}
              >
                {isUploadingCustomImage ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.createButtonText}>Create Venue</Text>
                )}
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
    maxHeight: '85%',
    width: '100%',
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
  suggestionsContainer: {
    backgroundColor: '#2A2A2A',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
    maxHeight: 150,
    marginTop: 4,
    overflow: 'hidden',
  },
  suggestionItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  suggestionText: {
    color: '#FFF',
    fontSize: 14,
  },
  createButtonDisabled: {
    backgroundColor: '#666',
    opacity: 0.7,
  },
  previewContainer: {
    width: '100%',
    height: 150,
    borderRadius: 8,
    backgroundColor: '#2A2A2A',
    overflow: 'hidden',
    position: 'relative',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#333',
  },
  previewImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
    opacity: 0.85,
  },
  previewBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  previewBadgeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  removeImageButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 12,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FFF',
  },
  imageUploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2A2A2A',
    borderWidth: 1,
    borderColor: '#FF00CC',
    borderRadius: 8,
    paddingVertical: 12,
    gap: 8,
  },
  imageUploadButtonText: {
    color: '#FF00CC',
    fontSize: 14,
    fontWeight: '600',
  },
  sectionDivider: {
    height: 1,
    backgroundColor: '#333',
    marginVertical: 24,
  },
  scheduledDateText: {
    color: '#00FFCC',
    fontSize: 12,
    marginTop: 2,
  },
});
