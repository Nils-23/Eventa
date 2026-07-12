/**
 * CreatorVerificationScreen — post-submission verification instructions.
 *
 * Shows the single-use verification code (72h TTL) and deep links to the
 * official Instagram/TikTok accounts. The application stays Pending until an
 * admin matches the code in the official DMs against the listed social
 * account. If the code lapses, the user regenerates a fresh one here.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, Linking, Clipboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Copy, Camera, Music2, Clock, ShieldCheck, RefreshCw } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import Toast from 'react-native-toast-message';
import { useAppStore } from '../hooks/useAppStore';
import {
  CreatorApplication, fetchMyApplication, regenerateVerificationCode,
  isCodeExpired, INSTAGRAM_DM_URL, TIKTOK_DM_URL,
  OFFICIAL_INSTAGRAM_USERNAME, OFFICIAL_TIKTOK_USERNAME,
} from '../services/creatorService';

function formatRemaining(expiresAt: number): string {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return 'Expired';
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${mins}m remaining`;
}

export const CreatorVerificationScreen = () => {
  const navigation = useNavigation<any>();
  const user = useAppStore((s) => s.user);
  const [app, setApp] = useState<CreatorApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [, forceTick] = useState(0);

  const load = useCallback(async () => {
    if (!user?.uid) return;
    try {
      setApp(await fetchMyApplication(user.uid));
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => { load(); }, [load]);

  // Refresh the countdown label every minute
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 60000);
    return () => clearInterval(t);
  }, []);

  const expired = app ? isCodeExpired(app) : false;

  const handleCopy = () => {
    if (!app) return;
    Clipboard.setString(app.verificationCode);
    Toast.show({ type: 'success', text1: 'Code Copied', text2: app.verificationCode });
  };

  const handleRegenerate = async () => {
    if (!user?.uid) return;
    setRegenerating(true);
    try {
      await regenerateVerificationCode(user.uid);
      await load();
      Toast.show({ type: 'success', text1: 'New Code Generated', text2: 'Valid for the next 72 hours.' });
    } catch (err: any) {
      Toast.show({ type: 'error', text1: 'Could not generate code', text2: err.message });
    } finally {
      setRegenerating(false);
    }
  };

  const openLink = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      Toast.show({ type: 'error', text1: 'Could not open app' });
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <ArrowLeft color="#FFFFFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Verify Your Account</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color="#00FFCC" size="large" /></View>
      ) : !app ? (
        <View style={styles.center}><Text style={styles.emptyText}>No application found.</Text></View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.shieldBox}>
            <ShieldCheck color="#00FFCC" size={28} />
            <Text style={styles.instructions}>
              To verify ownership of your creator account, send the verification code below
              as a DM to the official Eventas {app.platform === 'instagram' ? 'Instagram' : 'TikTok'} account
              using the same account you listed in your application
              (@{app.socialUsername}).
            </Text>
          </View>

          <View style={[styles.codeCard, expired && styles.codeCardExpired]}>
            <Text style={styles.codeLabel}>YOUR VERIFICATION CODE</Text>
            <Text style={[styles.code, expired && styles.codeExpired]}>{app.verificationCode}</Text>
            <View style={styles.expiryRow}>
              <Clock color={expired ? '#FF0055' : '#888'} size={14} />
              <Text style={[styles.expiryText, expired && { color: '#FF0055' }]}>
                {formatRemaining(app.codeExpiresAt)}
              </Text>
            </View>
          </View>

          {expired ? (
            <>
              <Text style={styles.expiredNote}>
                This code expired before it could be reviewed. Generate a new one and send it
                again — your application details are unchanged.
              </Text>
              <TouchableOpacity style={styles.primaryButton} onPress={handleRegenerate} disabled={regenerating}>
                {regenerating ? (
                  <ActivityIndicator color="#121212" />
                ) : (
                  <>
                    <RefreshCw color="#121212" size={18} />
                    <Text style={styles.primaryButtonText}>Generate New Code</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity style={styles.primaryButton} onPress={handleCopy}>
                <Copy color="#121212" size={18} />
                <Text style={styles.primaryButtonText}>Copy Code</Text>
              </TouchableOpacity>

              <View style={styles.socialRow}>
                <TouchableOpacity style={styles.socialButton} onPress={() => openLink(INSTAGRAM_DM_URL)}>
                  <Camera color="#E1306C" size={20} />
                  <Text style={styles.socialText}>Open Instagram</Text>
                  <Text style={styles.socialHandle}>@{OFFICIAL_INSTAGRAM_USERNAME}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.socialButton} onPress={() => openLink(TIKTOK_DM_URL)}>
                  <Music2 color="#69C9D0" size={20} />
                  <Text style={styles.socialText}>Open TikTok</Text>
                  <Text style={styles.socialHandle}>@{OFFICIAL_TIKTOK_USERNAME}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.pendingBox}>
                <View style={styles.pendingDot} />
                <Text style={styles.pendingText}>
                  Application status: PENDING{'\n'}
                  Your application will be reviewed once we receive your DM. This usually
                  takes 1–2 days.
                </Text>
              </View>
            </>
          )}
        </ScrollView>
      )}
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: '#888', fontSize: 15 },
  content: { padding: 24, paddingBottom: 60 },
  shieldBox: {
    flexDirection: 'row', gap: 12, alignItems: 'flex-start',
    backgroundColor: 'rgba(0, 255, 204, 0.05)', borderColor: 'rgba(0, 255, 204, 0.25)',
    borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 24,
  },
  instructions: { color: '#CCC', fontSize: 13, lineHeight: 20, flex: 1 },
  codeCard: {
    backgroundColor: '#1A1A1A', borderRadius: 16, borderWidth: 1, borderColor: '#00FFCC',
    alignItems: 'center', paddingVertical: 28, marginBottom: 24,
    shadowColor: '#00FFCC', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.2, shadowRadius: 12,
  },
  codeCardExpired: { borderColor: '#FF0055', shadowColor: '#FF0055' },
  codeLabel: { color: '#888', fontSize: 11, letterSpacing: 2, marginBottom: 10, fontWeight: '600' },
  code: { color: '#00FFCC', fontSize: 34, fontWeight: '800', letterSpacing: 3 },
  codeExpired: { color: '#FF0055', textDecorationLine: 'line-through' },
  expiryRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  expiryText: { color: '#888', fontSize: 13 },
  expiredNote: { color: '#CCC', fontSize: 13, lineHeight: 19, marginBottom: 16, textAlign: 'center' },
  primaryButton: {
    flexDirection: 'row', gap: 8, backgroundColor: '#00FFCC', borderRadius: 30,
    paddingVertical: 15, alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  primaryButtonText: { color: '#121212', fontSize: 15, fontWeight: '800' },
  socialRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  socialButton: {
    flex: 1, backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#2A2A2A',
    borderRadius: 12, padding: 16, alignItems: 'center', gap: 6,
  },
  socialText: { color: '#FFF', fontSize: 13, fontWeight: '600' },
  socialHandle: { color: '#666', fontSize: 11 },
  pendingBox: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    backgroundColor: 'rgba(255, 215, 0, 0.06)', borderColor: 'rgba(255, 215, 0, 0.25)',
    borderWidth: 1, borderRadius: 12, padding: 16,
  },
  pendingDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFD700', marginTop: 5,
  },
  pendingText: { color: '#CCC', fontSize: 13, lineHeight: 20, flex: 1 },
});
