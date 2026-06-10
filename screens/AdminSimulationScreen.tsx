import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Alert, Modal, ActivityIndicator, KeyboardAvoidingView, Platform, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Users, Plus, Save, X, UploadCloud, Trash2, Calendar, Clock, Play, Pause, Film } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { useLiveVenues, LiveVenue as Venue } from '../hooks/useLiveVenues';
import { firestore, storage } from '../services/firebase';
import { doc, setDoc, updateDoc, deleteDoc, collection, addDoc, onSnapshot, query, orderBy, serverTimestamp } from 'firebase/firestore';
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
  const [editingCapacities, setEditingCapacities] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [newVenueMaxCapacity, setNewVenueMaxCapacity] = useState('');


  const filteredVenues = venues.filter(venue =>
    venue.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredScheduledVenues = scheduledVenues.filter(venue =>
    venue.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const [uploadingVenueId, setUploadingVenueId] = useState<string | null>(null);
  
  // Recurring Stories State
  const [recurringStories, setRecurringStories] = useState<any[]>([]);
  const [isScheduleModalVisible, setIsScheduleModalVisible] = useState(false);
  const [scheduleVenue, setScheduleVenue] = useState<Venue | null>(null);
  const [scheduleFrequency, setScheduleFrequency] = useState<'daily' | 'weekly'>('daily');
  const [scheduleDayOfWeek, setScheduleDayOfWeek] = useState<'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun'>('Mon');
  const [scheduleTime, setScheduleTime] = useState('');
  const [scheduleMediaUri, setScheduleMediaUri] = useState<string | null>(null);
  const [scheduleMediaType, setScheduleMediaType] = useState<'image' | 'video'>('image');
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);

  useEffect(() => {
    const q = query(collection(firestore, 'recurring_stories'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const storiesList: any[] = [];
      snapshot.forEach((doc) => {
        storiesList.push({ id: doc.id, ...doc.data() });
      });
      setRecurringStories(storiesList);
    }, (error) => {
      console.error('Error fetching recurring stories:', error);
    });
    return () => unsubscribe();
  }, []);
  
  // New Venue State
  const [newVenueName, setNewVenueName] = useState('');
  const [newVenueLat, setNewVenueLat] = useState('');
  const [newVenueLng, setNewVenueLng] = useState('');
  const [newVenueDesc, setNewVenueDesc] = useState('');
  const [newVenueType, setNewVenueType] = useState<'Club' | 'Bar' | 'Activity' | 'Event'>('Club');
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
        simulatedUsersCount: count,
        isOverride: true
      });
      Toast.show({ type: 'success', text1: 'Updated!', text2: `Simulated users count updated.` });
    } catch (error) {
      console.error('Error updating venue:', error);
      Toast.show({ type: 'error', text1: 'Error', text2: 'Failed to update simulated users count.' });
    }
  };

  const handleResetToAuto = async (venueId: string) => {
    try {
      const venueRef = doc(firestore, 'venues', venueId);
      await updateDoc(venueRef, {
        isOverride: false
      });
      Toast.show({ type: 'success', text1: 'Reset Completed', text2: `Simulated users set to Auto.` });
    } catch (error) {
      console.error('Error resetting override status:', error);
      Toast.show({ type: 'error', text1: 'Error', text2: 'Failed to reset override status.' });
    }
  };

  const handleUpdateCapacity = async (venueId: string) => {
    const value = editingCapacities[venueId];
    if (!value) return;

    const capacity = parseInt(value, 10);
    if (isNaN(capacity) || capacity <= 0) {
      Toast.show({ type: 'error', text1: 'Invalid Capacity', text2: 'Please enter a valid positive capacity.' });
      return;
    }

    try {
      const venueRef = doc(firestore, 'venues', venueId);
      await updateDoc(venueRef, {
        maxCapacity: capacity
      });
      Toast.show({ type: 'success', text1: 'Updated!', text2: `Maximum capacity updated to ${capacity}.` });
    } catch (error) {
      console.error('Error updating capacity:', error);
      Toast.show({ type: 'error', text1: 'Error', text2: 'Failed to update maximum capacity.' });
    }
  };

  const getDefaultCapacity = (type?: 'Club' | 'Bar' | 'Activity' | 'Event') => {
    switch (type) {
      case 'Club': return 250;
      case 'Bar': return 100;
      case 'Activity': return 200;
      case 'Event': return 500;
      default: return 100;
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

    if ((newVenueType === 'Activity' || newVenueType === 'Event') && !newVenueExpiration) {
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
    if ((newVenueType === 'Activity' || newVenueType === 'Event') && newVenueStartDate) {
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
      
      const parsedCapacity = parseInt(newVenueMaxCapacity, 10);
      const cap = (!isNaN(parsedCapacity) && parsedCapacity > 0) ? parsedCapacity : getDefaultCapacity(newVenueType);

      const venueData: any = {
        name: newVenueName,
        latitude: lat,
        longitude: lng,
        description: newVenueDesc,
        type: newVenueType,
        simulatedUsersCount: 0,
        isOverride: false,
        maxCapacity: cap
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
      setNewVenueMaxCapacity('');
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

  const handleSelectScheduleMedia = async () => {
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
        setScheduleMediaUri(result.assets[0].uri);
        setScheduleMediaType(result.assets[0].type === 'video' ? 'video' : 'image');
      }
    } catch (error) {
      console.error('Select Media Error:', error);
      Toast.show({
        type: 'error',
        text1: 'Selection Failed',
        text2: 'Could not select media.',
      });
    }
  };

  const handleSaveSchedule = async () => {
    if (!scheduleVenue) return;
    if (!scheduleMediaUri) {
      Toast.show({ type: 'error', text1: 'Missing Media', text2: 'Please select an image or video.' });
      return;
    }
    if (!scheduleTime) {
      Toast.show({ type: 'error', text1: 'Missing Time', text2: 'Please specify the time.' });
      return;
    }

    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timeRegex.test(scheduleTime)) {
      Toast.show({ type: 'error', text1: 'Invalid Time Format', text2: 'Time must be in 24-hour format (HH:MM), e.g. 19:00' });
      return;
    }

    setIsSavingSchedule(true);
    try {
      const downloadUrl = await uploadStoryMedia(scheduleMediaUri, `sim_admin_schedule`);
      
      const scheduleData: any = {
        venueId: scheduleVenue.id,
        venueName: scheduleVenue.name,
        mediaUrl: downloadUrl,
        mediaType: scheduleMediaType,
        frequency: scheduleFrequency,
        time: scheduleTime,
        active: true,
        createdAt: serverTimestamp(),
      };

      if (scheduleFrequency === 'weekly') {
        scheduleData.dayOfWeek = scheduleDayOfWeek;
      }

      await addDoc(collection(firestore, 'recurring_stories'), scheduleData);

      Toast.show({
        type: 'success',
        text1: 'Schedule Created!',
        text2: `Story scheduled for ${scheduleVenue.name} successfully.`,
      });

      setIsScheduleModalVisible(false);
      setScheduleVenue(null);
      setScheduleFrequency('daily');
      setScheduleDayOfWeek('Mon');
      setScheduleTime('');
      setScheduleMediaUri(null);
    } catch (error) {
      console.error('Save Schedule Error:', error);
      Toast.show({
        type: 'error',
        text1: 'Failed to Save',
        text2: 'Could not create recurring story schedule.',
      });
    } finally {
      setIsSavingSchedule(false);
    }
  };

  const handleToggleScheduleActive = async (scheduleId: string, currentStatus: boolean) => {
    try {
      const scheduleRef = doc(firestore, 'recurring_stories', scheduleId);
      await updateDoc(scheduleRef, {
        active: !currentStatus
      });
      Toast.show({
        type: 'success',
        text1: !currentStatus ? 'Schedule Activated' : 'Schedule Paused',
        text2: `Recurring story posting has been ${!currentStatus ? 'resumed' : 'paused'}.`,
      });
    } catch (error) {
      console.error('Toggle Schedule Error:', error);
      Toast.show({
        type: 'error',
        text1: 'Update Failed',
        text2: 'Could not update active status.',
      });
    }
  };

  const handleDeleteSchedule = (scheduleId: string, venueName: string) => {
    Alert.alert(
      'Delete Schedule',
      `Are you sure you want to delete this recurring story schedule for ${venueName}? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteDoc(doc(firestore, 'recurring_stories', scheduleId));
              Toast.show({ type: 'success', text1: 'Schedule Deleted', text2: 'The schedule has been removed.' });
            } catch (error) {
              console.error('Delete Schedule Error:', error);
              Toast.show({ type: 'error', text1: 'Error', text2: 'Failed to delete schedule.' });
            }
          },
        },
      ]
    );
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

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search venues..."
            placeholderTextColor="#888"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
          />
        </View>

        {isLoading ? (
          <Text style={styles.loadingText}>Loading venues...</Text>
        ) : filteredVenues.length === 0 ? (
          <Text style={styles.noVenuesText}>No venues match your search.</Text>
        ) : (
          filteredVenues.map(venue => (
            <View key={venue.id} style={styles.venueCard}>
              <View style={styles.venueHeaderRow}>
                <View style={styles.venueInfo}>
                  <Text style={styles.venueName}>{venue.name}</Text>
                  <Text style={styles.venueCurrentCount}>
                    Current Target: {venue.isOverride ? `${venue.simulatedUsersCount ?? 20} (Override)` : 'Auto'}
                  </Text>
                  <Text style={styles.venueCurrentCount}>
                    Max Capacity: {venue.maxCapacity ?? getDefaultCapacity(venue.type)}
                  </Text>
                  {venue.type && (
                    <Text style={styles.venueType}>Type: {venue.type}</Text>
                  )}
                </View>
                <TouchableOpacity 
                  style={styles.deleteButton}
                  onPress={() => handleDeleteVenue(venue)}
                >
                  <Trash2 color="#FFF" size={16} />
                </TouchableOpacity>
              </View>
              
              <View style={styles.venueActionRow}>
                <View style={{ flex: 1, gap: 8, minWidth: 180 }}>
                  <View style={styles.countModifier}>
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
                      <Save color="#000" size={14} />
                      <Text style={styles.saveButtonText}>Set</Text>
                    </TouchableOpacity>
                    {venue.isOverride && (
                      <TouchableOpacity 
                        style={[styles.saveButton, { backgroundColor: '#FF8800' }]}
                        onPress={() => handleResetToAuto(venue.id)}
                      >
                        <Text style={[styles.saveButtonText, { color: '#FFF' }]}>Auto</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  <View style={styles.countModifier}>
                    <TextInput
                      style={styles.countInput}
                      keyboardType="numeric"
                      placeholder={String(venue.maxCapacity ?? getDefaultCapacity(venue.type))}
                      placeholderTextColor="#666"
                      value={editingCapacities[venue.id] !== undefined ? editingCapacities[venue.id] : ''}
                      onChangeText={(text) => setEditingCapacities(prev => ({ ...prev, [venue.id]: text }))}
                    />
                    <TouchableOpacity 
                      style={styles.saveButton}
                      onPress={() => handleUpdateCapacity(venue.id)}
                    >
                      <Save color="#000" size={14} />
                      <Text style={styles.saveButtonText}>Cap</Text>
                    </TouchableOpacity>
                  </View>
                </View>


                <View style={styles.storyButtons}>
                  <TouchableOpacity 
                    style={styles.uploadButton}
                    onPress={() => handleUploadStory(venue)}
                    disabled={uploadingVenueId === venue.id}
                  >
                    {uploadingVenueId === venue.id ? (
                      <ActivityIndicator size="small" color="#000" />
                    ) : (
                      <>
                        <UploadCloud color="#000" size={14} />
                        <Text style={styles.saveButtonText}>Upload</Text>
                      </>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={styles.scheduleButton}
                    onPress={() => {
                      setScheduleVenue(venue);
                      setIsScheduleModalVisible(true);
                    }}
                  >
                    <Clock color="#000" size={14} />
                    <Text style={styles.saveButtonText}>Schedule</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ))
        )}

        {/* Divider */}
        {filteredScheduledVenues.length > 0 && (
          <View style={styles.sectionDivider} />
        )}

        {/* Scheduled Future Events Section */}
        {filteredScheduledVenues.length > 0 && (
          <>
            <View style={[styles.sectionHeader, { marginTop: 24 }]}>
              <Calendar color="#00FFCC" size={20} />
              <Text style={[styles.sectionTitle, { color: '#00FFCC' }]}>Scheduled Upcoming Events</Text>
            </View>
            <Text style={styles.sectionSubtitle}>
              These events are scheduled for a future date and are currently hidden from public maps/lists.
            </Text>

            {filteredScheduledVenues.map(venue => {
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

        {/* Divider */}
        <View style={styles.sectionDivider} />

        {/* Recurring Stories Schedules Section */}
        <View style={styles.sectionHeader}>
          <Clock color="#A855F7" size={20} />
          <Text style={[styles.sectionTitle, { color: '#A855F7' }]}>Recurring Stories Schedules</Text>
        </View>
        <Text style={styles.sectionSubtitle}>
          View and manage automatically reposting stories. Use the toggle to pause/resume.
        </Text>

        {recurringStories.length === 0 ? (
          <Text style={styles.noSchedulesText}>No recurring stories scheduled yet.</Text>
        ) : (
          recurringStories.map((schedule) => {
            const formattedTime = schedule.time;
            const frequencyLabel = schedule.frequency === 'daily' 
              ? 'Daily' 
              : `Weekly (${schedule.dayOfWeek})`;
            
            return (
              <View key={schedule.id} style={styles.scheduleCard}>
                <View style={styles.scheduleMediaContainer}>
                  {schedule.mediaType === 'video' ? (
                    <View style={styles.videoPlaceholder}>
                      <Film color="#A855F7" size={24} />
                      <Text style={styles.videoText}>Video</Text>
                    </View>
                  ) : (
                    <Image source={{ uri: schedule.mediaUrl }} style={styles.scheduleThumbnail} />
                  )}
                </View>
                
                <View style={styles.scheduleInfo}>
                  <Text style={styles.scheduleVenueName} numberOfLines={1}>{schedule.venueName}</Text>
                  <Text style={styles.scheduleTimeText}>
                    {frequencyLabel} at {formattedTime}
                  </Text>
                  {schedule.lastTriggered && (
                    <Text style={styles.lastTriggeredText}>
                      Last posted: {schedule.lastTriggered.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  )}
                </View>

                <View style={styles.scheduleActions}>
                  <TouchableOpacity
                    style={[
                      styles.statusToggle,
                      schedule.active ? styles.statusToggleActive : styles.statusToggleInactive
                    ]}
                    onPress={() => handleToggleScheduleActive(schedule.id, schedule.active)}
                  >
                    {schedule.active ? (
                      <Play color="#000" size={14} />
                    ) : (
                      <Pause color="#FFF" size={14} />
                    )}
                    <Text style={[
                      styles.statusToggleText,
                      { color: schedule.active ? '#000' : '#FFF' }
                    ]}>
                      {schedule.active ? 'Active' : 'Paused'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.scheduleDeleteButton}
                    onPress={() => handleDeleteSchedule(schedule.id, schedule.venueName)}
                  >
                    <Trash2 color="#FFF" size={14} />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
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
                  {(['Club', 'Bar', 'Activity', 'Event'] as const).map((type) => (
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

              <View style={styles.formGroup}>
                <Text style={styles.label}>Max Capacity (Optional, default by type)</Text>
                <TextInput
                  style={styles.input}
                  placeholder={`e.g. ${getDefaultCapacity(newVenueType)}`}
                  placeholderTextColor="#666"
                  keyboardType="numeric"
                  value={newVenueMaxCapacity}
                  onChangeText={setNewVenueMaxCapacity}
                />
              </View>

              {(newVenueType === 'Activity' || newVenueType === 'Event') && (

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

      {/* Schedule Recurring Story Modal */}
      <Modal
        visible={isScheduleModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsScheduleModalVisible(false)}
        statusBarTranslucent={true}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Schedule Recurring Story</Text>
              <TouchableOpacity onPress={() => setIsScheduleModalVisible(false)}>
                <X color="#FFFFFF" size={24} />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 16 }}
            >
              <Text style={styles.modalVenueSubtitle}>
                Venue: {scheduleVenue?.name}
              </Text>

              {/* Media Picker */}
              <View style={styles.formGroup}>
                <Text style={styles.label}>Select Media (Image/Video)</Text>
                
                <View style={styles.previewContainer}>
                  {scheduleMediaUri ? (
                    <>
                      {scheduleMediaType === 'video' ? (
                        <View style={styles.videoPreviewPlaceholder}>
                          <Film color="#A855F7" size={48} />
                          <Text style={styles.videoPreviewText}>Video Selected</Text>
                          <Text style={styles.videoPreviewSubtext}>{scheduleMediaUri.split('/').pop()}</Text>
                        </View>
                      ) : (
                        <Image source={{ uri: scheduleMediaUri }} style={styles.previewImage} />
                      )}
                      <TouchableOpacity 
                        style={styles.removeImageButton} 
                        onPress={() => setScheduleMediaUri(null)}
                      >
                        <X color="#FFF" size={14} />
                      </TouchableOpacity>
                    </>
                  ) : (
                    <View style={styles.mediaPlaceholder}>
                      <UploadCloud color="#666" size={32} />
                      <Text style={styles.mediaPlaceholderText}>No media selected</Text>
                    </View>
                  )}
                </View>

                <TouchableOpacity 
                  style={styles.imageUploadButton} 
                  onPress={handleSelectScheduleMedia}
                >
                  <UploadCloud color="#A855F7" size={20} />
                  <Text style={[styles.imageUploadButtonText, { color: '#A855F7' }]}>
                    {scheduleMediaUri ? 'Change Media' : 'Choose Image or Video'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Frequency */}
              <View style={styles.formGroup}>
                <Text style={styles.label}>Frequency</Text>
                <View style={styles.typeSelectorRow}>
                  {(['daily', 'weekly'] as const).map((freq) => (
                    <TouchableOpacity
                      key={freq}
                      style={[
                        styles.typePill,
                        scheduleFrequency === freq && styles.scheduleTypePillSelected
                      ]}
                      onPress={() => setScheduleFrequency(freq)}
                    >
                      <Text style={[
                        styles.typePillText,
                        scheduleFrequency === freq && styles.scheduleTypePillTextSelected
                      ]}>
                        {freq.charAt(0).toUpperCase() + freq.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Day of the Week (if weekly) */}
              {scheduleFrequency === 'weekly' && (
                <View style={styles.formGroup}>
                  <Text style={styles.label}>Day of the Week</Text>
                  <View style={styles.daySelectorRow}>
                    {(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const).map((day) => (
                      <TouchableOpacity
                        key={day}
                        style={[
                          styles.dayPill,
                          scheduleDayOfWeek === day && styles.dayPillSelected
                        ]}
                        onPress={() => setScheduleDayOfWeek(day)}
                      >
                        <Text style={[
                          styles.dayPillText,
                          scheduleDayOfWeek === day && styles.dayPillTextSelected
                        ]}>
                          {day}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {/* Time */}
              <View style={styles.formGroup}>
                <Text style={styles.label}>Execution Time (24h format, HH:MM)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 19:00"
                  placeholderTextColor="#666"
                  value={scheduleTime}
                  onChangeText={setScheduleTime}
                  maxLength={5}
                />
                <Text style={styles.helperText}>
                  Enter local Nairobi time. Note: The story will be posted automatically and stay active for 24 hours.
                </Text>
              </View>

              <TouchableOpacity 
                style={[
                  styles.createButton,
                  { backgroundColor: '#A855F7' },
                  isSavingSchedule && styles.createButtonDisabled
                ]} 
                onPress={handleSaveSchedule}
                disabled={isSavingSchedule}
              >
                {isSavingSchedule ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.createButtonText}>Save Schedule</Text>
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
    flexDirection: 'column',
    alignItems: 'stretch',
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
  // New Styles for Recurring Stories
  venueHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  venueActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#2A2A2A',
    paddingTop: 12,
  },
  countModifier: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  storyButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  scheduleButton: {
    backgroundColor: '#A855F7',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 4,
  },
  noSchedulesText: {
    color: '#888',
    textAlign: 'center',
    marginVertical: 20,
    fontStyle: 'italic',
  },
  scheduleCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  scheduleMediaContainer: {
    width: 50,
    height: 50,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: '#2A2A2A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scheduleThumbnail: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  videoPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoText: {
    color: '#A855F7',
    fontSize: 8,
    marginTop: 2,
    fontWeight: '600',
  },
  scheduleInfo: {
    flex: 1,
  },
  scheduleVenueName: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  scheduleTimeText: {
    color: '#A855F7',
    fontSize: 12,
    marginTop: 2,
  },
  lastTriggeredText: {
    color: '#888',
    fontSize: 10,
    marginTop: 2,
  },
  scheduleActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 4,
  },
  statusToggleActive: {
    backgroundColor: '#00FFCC',
  },
  statusToggleInactive: {
    backgroundColor: '#444',
  },
  statusToggleText: {
    fontSize: 12,
    fontWeight: '600',
  },
  scheduleDeleteButton: {
    backgroundColor: '#FF3333',
    padding: 8,
    borderRadius: 6,
  },
  modalVenueSubtitle: {
    color: '#00FFCC',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 16,
  },
  mediaPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mediaPlaceholderText: {
    color: '#666',
    fontSize: 14,
    marginTop: 8,
  },
  videoPreviewPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  videoPreviewText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 8,
  },
  videoPreviewSubtext: {
    color: '#888',
    fontSize: 12,
    marginTop: 4,
  },
  scheduleTypePillSelected: {
    backgroundColor: 'rgba(168, 85, 247, 0.2)',
    borderColor: '#A855F7',
  },
  scheduleTypePillTextSelected: {
    color: '#A855F7',
  },
  daySelectorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  dayPill: {
    backgroundColor: '#2A2A2A',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#333',
  },
  dayPillSelected: {
    backgroundColor: 'rgba(168, 85, 247, 0.2)',
    borderColor: '#A855F7',
  },
  dayPillText: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
  },
  dayPillTextSelected: {
    color: '#A855F7',
  },
  helperText: {
    color: '#666',
    fontSize: 11,
    marginTop: 4,
  },
  searchContainer: {
    marginBottom: 16,
  },
  searchInput: {
    backgroundColor: '#1E1E1E',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    padding: 12,
    color: '#FFFFFF',
    fontSize: 14,
  },
  noVenuesText: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    marginVertical: 24,
  },
});
