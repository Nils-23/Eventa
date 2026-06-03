import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, ShieldCheck, LogOut } from 'lucide-react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, firestore } from '../services/firebase';
import { createUserProfile } from '../services/authService';
import { useAppStore } from '../hooks/useAppStore';
import Toast from 'react-native-toast-message';

const { width: SCREEN_W } = Dimensions.get('window');

export const TermsScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const [isAgreeing, setIsAgreeing] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const { setHasAgreedToTerms } = useAppStore();
  const viewOnly = route.params?.viewOnly === true;

  const handleAgree = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      Toast.show({
        type: 'error',
        text1: 'Authentication Error',
        text2: 'You must be signed in to agree to terms.',
      });
      return;
    }

    setIsAgreeing(true);
    try {
      const userDocRef = doc(firestore, 'users', currentUser.uid);
      const userDoc = await getDoc(userDocRef);

      if (userDoc.exists()) {
        // Existing user - update document with agreement
        await setDoc(
          userDocRef,
          {
            agreedToTerms: true,
            termsAgreementDate: serverTimestamp(),
            last_active: serverTimestamp(),
          },
          { merge: true }
        );
      } else {
        // New user - create profile document
        await createUserProfile(currentUser);
      }

      setHasAgreedToTerms(true);
      Toast.show({
        type: 'success',
        text1: 'Agreement Accepted',
        text2: 'Thank you for keeping our community safe!',
      });
    } catch (error: any) {
      console.error('Error accepting terms:', error);
      Alert.alert(
        'Submission Failed',
        'Could not save your agreement. Please try again. ' + (error.message || '')
      );
    } finally {
      setIsAgreeing(false);
    }
  };

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await auth.signOut();
      // App.tsx auth listener handles redirecting back to LoginScreen
    } catch (error) {
      console.error('Sign Out Error:', error);
      Toast.show({
        type: 'error',
        text1: 'Sign Out Failed',
        text2: 'Please restart the app to try again.',
      });
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        {viewOnly ? (
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <ArrowLeft color="#FFFFFF" size={24} />
          </TouchableOpacity>
        ) : (
          <View style={styles.logoBadge}>
            <ShieldCheck color="#00FFCC" size={24} />
          </View>
        )}
        <Text style={styles.headerTitle}>Terms & Community Guidelines</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Main content scroll */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
      >
        <Text style={styles.title}>Eventas Terms of Use & Community Guidelines</Text>
        <Text style={styles.subtitle}>Last updated: June 2026</Text>

        <Text style={styles.paragraph}>Welcome to Eventas.</Text>
        <Text style={styles.paragraph}>
          By creating an account or using Eventas, you agree to follow these Terms of Use and Community Guidelines. Our goal is to keep the platform safe, respectful, and enjoyable for everyone.
        </Text>

        <Text style={styles.sectionHeader}>1. Acceptable Use</Text>
        <Text style={styles.paragraph}>You agree to use Eventas responsibly and respectfully.</Text>
        
        <Text style={styles.bulletTitle}>You may not:</Text>
        <Text style={styles.bulletItem}>• Post or share hateful, abusive, threatening, or violent content</Text>
        <Text style={styles.bulletItem}>• Harass, bully, impersonate, or intimidate other users</Text>
        <Text style={styles.bulletItem}>• Share sexually explicit, illegal, or dangerous content</Text>
        <Text style={styles.bulletItem}>• Promote scams, fraud, illegal activity, or misleading information</Text>
        <Text style={styles.bulletItem}>• Spam chats, events, or other platform features</Text>
        <Text style={styles.bulletItem}>• Upload content that violates another person’s rights or privacy</Text>

        <Text style={styles.sectionHeader}>2. Events & User Content</Text>
        <Text style={styles.paragraph}>Users are responsible for the content they post, including:</Text>
        <Text style={styles.bulletItem}>• Event listings</Text>
        <Text style={styles.bulletItem}>• Messages</Text>
        <Text style={styles.bulletItem}>• Photos</Text>
        <Text style={styles.bulletItem}>• Usernames</Text>
        <Text style={styles.bulletItem}>• Profile information</Text>
        <Text style={styles.paragraph}>
          Eventas reserves the right to remove any content or account that violates these guidelines without warning.
        </Text>

        <Text style={styles.sectionHeader}>3. Reporting & Blocking</Text>
        <Text style={styles.paragraph}>
          Users can report objectionable content or abusive behavior directly within the app.
        </Text>
        <Text style={styles.paragraph}>
          Users can also block other users. Blocked users will no longer be able to interact with or appear in the blocked user’s experience where applicable.
        </Text>
        <Text style={styles.paragraph}>
          We review reports and take action against violating content and accounts, including content removal, temporary suspension, or permanent bans.
        </Text>

        <Text style={styles.sectionHeader}>4. Safety</Text>
        <Text style={styles.paragraph}>
          Always use caution when attending events or interacting with people offline.
        </Text>
        <Text style={styles.paragraph}>
          Eventas does not guarantee the safety, accuracy, legality, or quality of user-generated events or content.
        </Text>

        <Text style={styles.sectionHeader}>5. Account Access</Text>
        <Text style={styles.paragraph}>
          You are responsible for maintaining the security of your account and login methods.
        </Text>
        <Text style={styles.paragraph}>
          Eventas may suspend or terminate accounts that violate these Terms or abuse the platform.
        </Text>

        <Text style={styles.sectionHeader}>6. Privacy</Text>
        <Text style={styles.paragraph}>
          Your use of Eventas is also governed by our Privacy Policy.
        </Text>

        <Text style={styles.sectionHeader}>7. Updates</Text>
        <Text style={styles.paragraph}>
          These Terms and Guidelines may be updated from time to time to improve platform safety and functionality.
        </Text>
        <Text style={styles.paragraph}>
          By continuing to use Eventas, you agree to the latest version.
        </Text>

        <Text style={styles.sectionHeader}>8. Contact</Text>
        <Text style={styles.paragraph}>
          If you need help or want to report serious issues, contact:
        </Text>
        <Text style={styles.emailText}>support@eventas.app</Text>
      </ScrollView>

      {/* Action Footer (Only visible if not view-only) */}
      {!viewOnly && (
        <View style={styles.footer}>
          <Text style={styles.footerDisclaimer}>
            By tapping Agree & Continue, you confirm you have read and agree to follow the Terms of Use and Community Guidelines.
          </Text>

          <View style={styles.buttonRow}>
            {/* Sign Out Button */}
            <TouchableOpacity
              style={styles.signOutBtn}
              onPress={handleSignOut}
              disabled={isAgreeing || isSigningOut}
              activeOpacity={0.8}
            >
              {isSigningOut ? (
                <ActivityIndicator color="#FF3366" size="small" />
              ) : (
                <>
                  <LogOut color="#FF3366" size={18} style={styles.btnIcon} />
                  <Text style={styles.signOutText}>Cancel</Text>
                </>
              )}
            </TouchableOpacity>

            {/* Agree Button */}
            <TouchableOpacity
              style={styles.agreeBtn}
              onPress={handleAgree}
              disabled={isAgreeing || isSigningOut}
              activeOpacity={0.85}
            >
              {isAgreeing ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.agreeText}>Agree & Continue</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#120825', // Matches deep brand purple
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  backButton: {
    padding: 4,
  },
  logoBadge: {
    padding: 4,
    backgroundColor: 'rgba(0, 255, 204, 0.1)',
    borderRadius: 8,
  },
  headerTitle: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    marginRight: 8,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 40,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.4)',
    marginBottom: 24,
  },
  sectionHeader: {
    fontSize: 17,
    fontWeight: '700',
    color: '#A78BFA', // Violet accent
    marginTop: 24,
    marginBottom: 10,
    letterSpacing: 0.2,
  },
  paragraph: {
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.8)',
    lineHeight: 23,
    marginBottom: 12,
  },
  bulletTitle: {
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.85)',
    fontWeight: '600',
    marginBottom: 8,
  },
  bulletItem: {
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.75)',
    lineHeight: 22,
    marginLeft: 12,
    marginBottom: 6,
  },
  emailText: {
    fontSize: 16,
    color: '#00FFCC', // Teal highlight
    fontWeight: '700',
    marginTop: 4,
  },
  footer: {
    padding: 20,
    backgroundColor: '#170c2e',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  footerDisclaimer: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.45)',
    textAlign: 'center',
    lineHeight: 17,
    marginBottom: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 51, 102, 0.3)',
    backgroundColor: 'rgba(255, 51, 102, 0.05)',
  },
  signOutText: {
    color: '#FF3366',
    fontSize: 15,
    fontWeight: '600',
  },
  btnIcon: {
    marginRight: 6,
  },
  agreeBtn: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 24,
    backgroundColor: '#7B4FD4', // Brand purple
    shadowColor: '#7B4FD4',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  agreeText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
