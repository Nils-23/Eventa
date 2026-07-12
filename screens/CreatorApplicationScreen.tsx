/**
 * CreatorApplicationScreen — the "Apply for Creator Account" form.
 *
 * Full Name is collected for admin verification only (never shown publicly).
 * On submit a single-use EVT-XXXXXX verification code (72h TTL) is generated
 * and the user is sent to CreatorVerification to complete the DM step.
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Star, Lock } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import Toast from 'react-native-toast-message';
import { useAppStore } from '../hooks/useAppStore';
import {
  submitCreatorApplication, CREATOR_CATEGORIES, CreatorPlatform,
} from '../services/creatorService';

export const CreatorApplicationScreen = () => {
  const navigation = useNavigation<any>();
  const user = useAppStore((s) => s.user);

  const [fullName, setFullName] = useState('');
  const [creatorName, setCreatorName] = useState('');
  const [socialUsername, setSocialUsername] = useState('');
  const [platform, setPlatform] = useState<CreatorPlatform>('instagram');
  const [category, setCategory] = useState<string>('Nightlife');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit =
    fullName.trim().length >= 3 &&
    creatorName.trim().length >= 2 &&
    socialUsername.trim().length >= 2 &&
    !submitting;

  const handleSubmit = async () => {
    if (!user?.uid || !canSubmit) return;
    setSubmitting(true);
    try {
      await submitCreatorApplication(user.uid, {
        fullName, creatorName, socialUsername, platform, category, message,
      });
      Toast.show({ type: 'success', text1: 'Application Submitted', text2: 'One more step: verify your social account.' });
      navigation.replace('CreatorVerification');
    } catch (err: any) {
      Toast.show({ type: 'error', text1: 'Submission Failed', text2: err.message || 'Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <ArrowLeft color="#FFFFFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Creator Application</Text>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.introBox}>
            <Star color="#FFD700" size={22} />
            <Text style={styles.introText}>
              Join the Eventas Creator Program to unlock referral links, event attendance
              features, and your own creator dashboard. Applications are reviewed manually.
            </Text>
          </View>

          <Text style={styles.label}>Full Name</Text>
          <View style={styles.privateHintRow}>
            <Lock color="#888" size={12} />
            <Text style={styles.privateHint}>Private — visible only to Eventas admins.</Text>
          </View>
          <TextInput
            style={styles.input}
            value={fullName}
            onChangeText={setFullName}
            placeholder="e.g. Jane Wanjiru Kamau"
            placeholderTextColor="#555"
            maxLength={80}
          />

          <Text style={styles.label}>Creator / Stage Name</Text>
          <TextInput
            style={styles.input}
            value={creatorName}
            onChangeText={setCreatorName}
            placeholder="The name shown on your public profile"
            placeholderTextColor="#555"
            maxLength={40}
          />

          <Text style={styles.label}>Platform</Text>
          <View style={styles.pillRow}>
            {(['instagram', 'tiktok'] as const).map((p) => (
              <TouchableOpacity
                key={p}
                style={[styles.pill, platform === p && styles.pillActive]}
                onPress={() => setPlatform(p)}
              >
                <Text style={[styles.pillText, platform === p && styles.pillTextActive]}>
                  {p === 'instagram' ? 'Instagram' : 'TikTok'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>{platform === 'instagram' ? 'Instagram' : 'TikTok'} Username</Text>
          <TextInput
            style={styles.input}
            value={socialUsername}
            onChangeText={setSocialUsername}
            placeholder="@yourhandle"
            placeholderTextColor="#555"
            autoCapitalize="none"
            maxLength={40}
          />

          <Text style={styles.label}>Primary Content Category</Text>
          <View style={styles.pillRowWrap}>
            {CREATOR_CATEGORIES.map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.pill, category === c && styles.pillActive]}
                onPress={() => setCategory(c)}
              >
                <Text style={[styles.pillText, category === c && styles.pillTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Why do you want to join? (optional)</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={message}
            onChangeText={setMessage}
            placeholder="Tell us a little about your content..."
            placeholderTextColor="#555"
            multiline
            numberOfLines={4}
            maxLength={400}
          />

          <TouchableOpacity
            style={[styles.submitButton, !canSubmit && styles.submitDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit}
          >
            {submitting ? (
              <ActivityIndicator color="#121212" />
            ) : (
              <Text style={styles.submitText}>Submit Application</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: '#2A2A2A',
  },
  backButton: { padding: 4 },
  headerTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  content: { padding: 24, paddingBottom: 60 },
  introBox: {
    flexDirection: 'row', gap: 12, alignItems: 'flex-start',
    backgroundColor: 'rgba(255, 215, 0, 0.06)', borderColor: 'rgba(255, 215, 0, 0.25)',
    borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 24,
  },
  introText: { color: '#CCC', fontSize: 13, lineHeight: 19, flex: 1 },
  label: { color: '#FFF', fontSize: 14, fontWeight: '600', marginBottom: 8, marginTop: 16 },
  privateHintRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
  privateHint: { color: '#888', fontSize: 12 },
  input: {
    backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#2A2A2A',
    borderRadius: 12, padding: 14, color: '#FFF', fontSize: 15,
  },
  multiline: { minHeight: 100, textAlignVertical: 'top' },
  pillRow: { flexDirection: 'row', gap: 8 },
  pillRowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20,
    backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#2A2A2A',
  },
  pillActive: { backgroundColor: 'rgba(0, 255, 204, 0.12)', borderColor: '#00FFCC' },
  pillText: { color: '#888', fontSize: 13, fontWeight: '600' },
  pillTextActive: { color: '#00FFCC' },
  submitButton: {
    backgroundColor: '#00FFCC', borderRadius: 30, paddingVertical: 16,
    alignItems: 'center', marginTop: 32,
  },
  submitDisabled: { opacity: 0.35 },
  submitText: { color: '#121212', fontSize: 16, fontWeight: '800' },
});
