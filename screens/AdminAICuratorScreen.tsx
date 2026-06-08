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
  Key,
  Check,
  ExternalLink,
  AlertTriangle,
  Info
} from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { firestore } from '../services/firebase';
import { doc, setDoc } from 'firebase/firestore';
import Toast from 'react-native-toast-message';

interface DraftEvent {
  name: string;
  description: string;
  address: string;
  latitude: number;
  longitude: number;
  startDate: string; // ISO string
  expirationDate: string; // ISO string
  category: 'Music' | 'Food' | 'Art' | 'Sports' | 'Conference' | 'General';
}

const CATEGORY_IMAGES: Record<string, string> = {
  Music: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&q=80&w=600',
  Food: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&q=80&w=600',
  Art: 'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?auto=format&fit=crop&q=80&w=600',
  Sports: 'https://images.unsplash.com/photo-1502224562085-639556652f33?auto=format&fit=crop&q=80&w=600',
  Conference: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&q=80&w=600',
  General: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&q=80&w=600',
};

export const AdminAICuratorScreen = () => {
  const navigation = useNavigation();
  const [apiKey, setApiKey] = useState('');
  const [isKeySaved, setIsKeySaved] = useState(false);
  
  const [prompt, setPrompt] = useState('Research popular public events scheduled to happen in Nairobi in July 2026.');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [draftEvents, setDraftEvents] = useState<DraftEvent[]>([]);
  
  // Editing Event Modal State
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editLat, setEditLat] = useState('');
  const [editLng, setEditLng] = useState('');
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [editCategory, setEditCategory] = useState<'Music' | 'Food' | 'Art' | 'Sports' | 'Conference' | 'General'>('General');

  useEffect(() => {
    const loadSavedKey = async () => {
      try {
        const savedKey = await AsyncStorage.getItem('admin_gemini_api_key');
        if (savedKey) {
          setApiKey(savedKey);
          setIsKeySaved(true);
        }
      } catch (err) {
        console.warn('Failed to load saved Gemini API key:', err);
      }
    };
    loadSavedKey();
  }, []);

  const handleSaveKey = async () => {
    if (!apiKey.trim()) {
      Toast.show({ type: 'error', text1: 'Empty Key', text2: 'Please enter a valid API key.' });
      return;
    }
    try {
      await AsyncStorage.setItem('admin_gemini_api_key', apiKey.trim());
      setIsKeySaved(true);
      Toast.show({ type: 'success', text1: 'Key Saved', text2: 'Gemini API key has been stored securely.' });
    } catch (err) {
      console.error(err);
      Toast.show({ type: 'error', text1: 'Error', text2: 'Failed to save API key.' });
    }
  };

  const handleClearKey = async () => {
    try {
      await AsyncStorage.removeItem('admin_gemini_api_key');
      setApiKey('');
      setIsKeySaved(false);
      Toast.show({ type: 'success', text1: 'Key Removed', text2: 'Gemini API key was cleared.' });
    } catch (err) {
      console.error(err);
    }
  };

  const handleResearchEvents = async () => {
    if (!apiKey) {
      Toast.show({ type: 'error', text1: 'Missing API Key', text2: 'Please configure your Gemini API key first.' });
      return;
    }

    setIsLoading(true);
    setLoadingStatus('Initializing web search tools...');
    setDraftEvents([]);

    try {
      // Step 1: Query Gemini 2.5 Flash with search tools
      setLoadingStatus('Searching Google for Nairobi events...');
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: `Search the web for upcoming public events scheduled to happen in Nairobi, Kenya according to this instruction: "${prompt}". 
For each event found, you must extract/provide:
1. Event Name
2. Clear description of the event (2-3 sentences)
3. Physical address or venue name (e.g. Sarit Expo Centre, Ngong Racecourse, Alchemist Bar)
4. Precise latitude and longitude coordinates (very important to get reasonable coordinates within Nairobi)
5. Start date & time as an ISO-8601 string (e.g. '2026-07-26T11:00:00+03:00')
6. End/Expiration date & time as an ISO-8601 string (e.g. '2026-07-26T22:00:00+03:00')
7. A category classification for visual decoration: 'Music', 'Food', 'Art', 'Sports', 'Conference', or 'General'.

Return the data STRICTLY as a JSON array under the key "events" using the schema:
{
  "events": [
    {
      "name": "...",
      "description": "...",
      "address": "...",
      "latitude": -1.2882,
      "longitude": 36.8231,
      "startDate": "2026-07-26T11:00:00+03:00",
      "expirationDate": "2026-07-26T22:00:00+03:00",
      "category": "Music"
    }
  ]
}
No other text, explanations, markdown formatting, or HTML should be returned. Just the raw JSON.`,
                  },
                ],
              },
            ],
            // Request structured JSON response
            generationConfig: {
              responseMimeType: 'application/json',
            },
            // Enable search grounding to get real-time info from the web
            tools: [{ googleSearch: {} }],
          }),
        }
      );

      setLoadingStatus('Processing and parsing response...');
      const resData = await response.json();

      if (response.status !== 200) {
        throw new Error(resData?.error?.message || `API error (${response.status})`);
      }

      const rawText = resData?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) {
        throw new Error('No content returned from Gemini.');
      }

      const parsed = JSON.parse(rawText.trim());
      const events: DraftEvent[] = parsed.events || [];

      if (events.length === 0) {
        Toast.show({ type: 'info', text1: 'No Events Found', text2: 'Gemini did not return any events for this query.' });
      } else {
        setDraftEvents(events);
        Toast.show({ type: 'success', text1: 'Research Complete', text2: `Found ${events.length} draft events.` });
      }
    } catch (err: any) {
      console.error(err);
      Alert.alert(
        'Research Failed',
        err.message || 'An unknown error occurred while calling the Gemini API.'
      );
    } finally {
      setIsLoading(false);
      setLoadingStatus('');
    }
  };

  const handleDeleteDraft = (index: number) => {
    setDraftEvents((prev) => prev.filter((_, i) => i !== index));
  };

  const handleOpenEditModal = (index: number) => {
    const item = draftEvents[index];
    setEditIndex(index);
    setEditName(item.name);
    setEditDesc(item.description);
    setEditAddress(item.address);
    setEditLat(String(item.latitude));
    setEditLng(String(item.longitude));
    setEditStart(item.startDate);
    setEditEnd(item.expirationDate);
    setEditCategory(item.category);
    setIsEditModalVisible(true);
  };

  const handleSaveEdit = () => {
    if (editIndex === null) return;
    const latNum = parseFloat(editLat);
    const lngNum = parseFloat(editLng);

    if (isNaN(latNum) || isNaN(lngNum)) {
      Toast.show({ type: 'error', text1: 'Invalid Coordinates', text2: 'Latitude and longitude must be valid numbers.' });
      return;
    }

    const updatedList = [...draftEvents];
    updatedList[editIndex] = {
      name: editName,
      description: editDesc,
      address: editAddress,
      latitude: latNum,
      longitude: lngNum,
      startDate: editStart,
      expirationDate: editEnd,
      category: editCategory
    };

    setDraftEvents(updatedList);
    setIsEditModalVisible(false);
    setEditIndex(null);
    Toast.show({ type: 'success', text1: 'Event Updated', text2: 'Draft modifications saved.' });
  };

  const handleBulkSave = async () => {
    if (draftEvents.length === 0) return;

    Alert.alert(
      'Confirm Seeding',
      `Are you sure you want to write these ${draftEvents.length} events into the database?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save to DB',
          onPress: async () => {
            setIsLoading(true);
            setLoadingStatus('Saving events to database...');
            let successCount = 0;
            try {
              for (const event of draftEvents) {
                const venueId = `event_ai_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
                const docRef = doc(firestore, 'venues', venueId);
                
                const venueData = {
                  id: venueId,
                  name: event.name,
                  description: event.description,
                  address: event.address,
                  latitude: event.latitude,
                  longitude: event.longitude,
                  type: 'Event',
                  startDate: new Date(event.startDate).getTime(),
                  expirationDate: new Date(event.expirationDate).getTime(),
                  imageUrl: CATEGORY_IMAGES[event.category] || CATEGORY_IMAGES['General'],
                  simulatedUsersCount: 30 // Seed with simulated users count
                };

                await setDoc(docRef, venueData);
                successCount++;
              }
              Toast.show({
                type: 'success',
                text1: 'Successfully Seeded!',
                text2: `${successCount} new events added to Firestore.`,
              });
              setDraftEvents([]);
            } catch (err: any) {
              console.error(err);
              Alert.alert('Database Save Failed', err.message || 'Could not write records to Firestore.');
            } finally {
              setIsLoading(false);
              setLoadingStatus('');
            }
          }
        }
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <ArrowLeft color="#FFFFFF" size={24} />
        </TouchableOpacity>
        <View style={styles.headerTitleRow}>
          <Sparkles color="#00FFCC" size={18} />
          <Text style={styles.headerTitle}>AI Event Curator</Text>
        </View>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Info Banner */}
        <View style={styles.infoBanner}>
          <Info color="#00FFCC" size={20} />
          <Text style={styles.infoText}>
            Use Gemini with Google Search to discover public events around Nairobi. Set up your Google AI Studio API key to fetch real-time search results.
          </Text>
        </View>

        {/* API Key Setup */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Key color="#00FFCC" size={20} />
            <Text style={styles.cardTitle}>Google AI Studio Key</Text>
          </View>
          
          <Text style={styles.cardDesc}>
            {isKeySaved 
              ? 'Your API key is configured. You can update or clear it below.'
              : 'A personal API key from Google AI Studio is required. You can get one for free.'}
          </Text>

          <View style={styles.keyInputRow}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              placeholder="Paste your Gemini API Key (starts with AIzaSy)..."
              placeholderTextColor="#666"
              secureTextEntry={isKeySaved}
              value={apiKey}
              onChangeText={setApiKey}
              editable={!isKeySaved}
            />
            {isKeySaved ? (
              <TouchableOpacity style={styles.clearKeyBtn} onPress={handleClearKey}>
                <Text style={styles.clearKeyBtnText}>Clear</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.saveKeyBtn} onPress={handleSaveKey}>
                <Check color="#000" size={16} />
                <Text style={styles.saveKeyBtnText}>Save</Text>
              </TouchableOpacity>
            )}
          </View>

          {!isKeySaved && (
            <TouchableOpacity 
              style={styles.linkRow} 
              onPress={() => Linking.openURL('https://aistudio.google.com/')}
            >
              <Text style={styles.linkText}>Get a free API key from Google AI Studio</Text>
              <ExternalLink color="#00FFCC" size={12} />
            </TouchableOpacity>
          )}
        </View>

        {/* Research Prompt Area */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Sparkles color="#FF00CC" size={20} />
            <Text style={styles.cardTitle}>Research Events Prompt</Text>
          </View>
          <Text style={styles.cardDesc}>
            Specify what kind of events to search for (e.g. month, year, or categories).
          </Text>

          <TextInput
            style={[styles.input, styles.textArea]}
            multiline
            numberOfLines={3}
            placeholder="Type prompt here..."
            placeholderTextColor="#666"
            value={prompt}
            onChangeText={setPrompt}
          />

          <TouchableOpacity 
            style={[styles.actionBtn, !isKeySaved && styles.actionBtnDisabled]} 
            onPress={handleResearchEvents}
            disabled={isLoading || !isKeySaved}
          >
            <Sparkles color="#000" size={18} />
            <Text style={styles.actionBtnText}>Research Nairobi Events</Text>
          </TouchableOpacity>
        </View>

        {/* Draft Events Feed */}
        {draftEvents.length > 0 && (
          <View style={styles.resultsContainer}>
            <Text style={styles.resultsHeader}>
              Draft Results ({draftEvents.length} Events)
            </Text>

            {draftEvents.map((item, index) => {
              const startStr = new Date(item.startDate).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
              return (
                <View key={index} style={styles.eventCard}>
                  <View style={styles.eventCardHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.eventName}>{item.name}</Text>
                      <View style={styles.categoryBadge}>
                        <Text style={styles.categoryText}>{item.category}</Text>
                      </View>
                    </View>
                    <View style={styles.eventActions}>
                      <TouchableOpacity 
                        style={styles.editBtn} 
                        onPress={() => handleOpenEditModal(index)}
                      >
                        <Edit color="#00FFCC" size={16} />
                      </TouchableOpacity>
                      <TouchableOpacity 
                        style={styles.deleteBtn} 
                        onPress={() => handleDeleteDraft(index)}
                      >
                        <Trash2 color="#FF3366" size={16} />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <Text style={styles.eventDesc}>{item.description}</Text>

                  <View style={styles.metaRow}>
                    <MapPin color="#888" size={14} />
                    <Text style={styles.metaText} numberOfLines={1}>{item.address}</Text>
                  </View>

                  <View style={styles.metaRow}>
                    <Calendar color="#888" size={14} />
                    <Text style={styles.metaText}>{startStr}</Text>
                  </View>

                  <Text style={styles.coordsText}>
                    Lat: {item.latitude.toFixed(5)} · Lng: {item.longitude.toFixed(5)}
                  </Text>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Save Button for Drafts */}
      {draftEvents.length > 0 && (
        <View style={styles.footerContainer}>
          <TouchableOpacity style={styles.saveBulkBtn} onPress={handleBulkSave} disabled={isLoading}>
            <Save color="#000" size={18} />
            <Text style={styles.saveBulkBtnText}>Approve & Seed {draftEvents.length} Events</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Loading Modal overlay */}
      <Modal visible={isLoading} transparent animationType="fade">
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingContent}>
            <ActivityIndicator size="large" color="#00FFCC" />
            <Text style={styles.loadingTitle}>AI Curator Active</Text>
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
              <Text style={styles.modalTitle}>Edit Event details</Text>
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
                <Text style={styles.label}>Physical Address</Text>
                <TextInput style={styles.modalInput} value={editAddress} onChangeText={setEditAddress} />
              </View>

              <View style={styles.formRow}>
                <View style={[styles.formGroup, { flex: 1, marginRight: 8 }]}>
                  <Text style={styles.label}>Latitude</Text>
                  <TextInput style={styles.modalInput} value={editLat} onChangeText={setEditLat} keyboardType="numeric" />
                </View>
                <View style={[styles.formGroup, { flex: 1, marginLeft: 8 }]}>
                  <Text style={styles.label}>Longitude</Text>
                  <TextInput style={styles.modalInput} value={editLng} onChangeText={setEditLng} keyboardType="numeric" />
                </View>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Start ISO String</Text>
                <TextInput style={styles.modalInput} value={editStart} onChangeText={setEditStart} />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Expiration ISO String</Text>
                <TextInput style={styles.modalInput} value={editEnd} onChangeText={setEditEnd} />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Category</Text>
                <View style={styles.categoryPickerRow}>
                  {['Music', 'Food', 'Art', 'Sports', 'Conference', 'General'].map((cat) => (
                    <TouchableOpacity
                      key={cat}
                      style={[
                        styles.categoryPickerPill,
                        editCategory === cat && styles.categoryPickerPillActive
                      ]}
                      onPress={() => setEditCategory(cat as any)}
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
                <Text style={styles.modalSaveBtnText}>Confirm Changes</Text>
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
    padding: 24,
    paddingBottom: 80,
  },
  infoBanner: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0, 255, 204, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 204, 0.2)',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    marginBottom: 24,
    alignItems: 'center',
  },
  infoText: {
    color: '#B0B0B0',
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
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
  keyInputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  input: {
    backgroundColor: '#222',
    borderColor: '#444',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#FFF',
    fontSize: 14,
    marginBottom: 16,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  saveKeyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#00FFCC',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
  },
  saveKeyBtnText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 13,
  },
  clearKeyBtn: {
    backgroundColor: '#333',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
  },
  clearKeyBtnText: {
    color: '#FF3366',
    fontWeight: '700',
    fontSize: 13,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
  },
  linkText: {
    color: '#00FFCC',
    fontSize: 12,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#00FFCC',
    paddingVertical: 14,
    borderRadius: 12,
  },
  actionBtnDisabled: {
    backgroundColor: '#2A2A2A',
    opacity: 0.5,
  },
  actionBtnText: {
    color: '#000',
    fontWeight: '800',
    fontSize: 14,
  },
  resultsContainer: {
    marginTop: 12,
  },
  resultsHeader: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 16,
  },
  eventCard: {
    backgroundColor: '#1E1E1E',
    borderColor: '#333',
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
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
    marginBottom: 4,
  },
  categoryBadge: {
    alignSelf: 'flex-start',
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
  eventActions: {
    flexDirection: 'row',
    gap: 12,
  },
  editBtn: {
    padding: 4,
  },
  deleteBtn: {
    padding: 4,
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
  coordsText: {
    color: '#555',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginTop: 4,
  },
  footerContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#121212',
    borderTopWidth: 1,
    borderTopColor: '#2A2A2A',
    padding: 16,
  },
  saveBulkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#00FFCC',
    paddingVertical: 16,
    borderRadius: 16,
    shadowColor: '#00FFCC',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  saveBulkBtnText: {
    color: '#000',
    fontWeight: '800',
    fontSize: 15,
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
