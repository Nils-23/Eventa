import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { Apple, Smartphone, ArrowLeft } from 'lucide-react-native';
import Toast from 'react-native-toast-message';
import { FirebaseRecaptchaVerifierModal } from 'expo-firebase-recaptcha';
import {
  handleGoogleLogin,
  handleAppleLogin,
  handlePhoneLoginStart,
  handlePhoneOTPConfirm,
} from '../services/authService';
import app from '../services/firebase';
import { SafeAreaView } from 'react-native-safe-area-context';

export const LoginScreen = () => {
  const [isLoading, setIsLoading] = useState<string | null>(null);
  
  // Phone Auth State
  const [showPhoneInput, setShowPhoneInput] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState('');
  const recaptchaVerifier = useRef(null);

  const onApplePress = async () => {
    try {
      setIsLoading('apple');
      await handleAppleLogin();
    } catch (e: any) {
      if (e.code !== 'ERR_REQUEST_CANCELED') {
        Toast.show({
          type: 'error',
          text1: 'Apple Login Failed',
          text2: e.message || 'Check your network connection and try again.',
        });
      }
    } finally {
      setIsLoading(null);
    }
  };

  const onGooglePress = async () => {
    try {
      setIsLoading('google');
      await handleGoogleLogin();
    } catch (e: any) {
      if (e.code !== 'SIGN_IN_CANCELLED') {
        Toast.show({
          type: 'error',
          text1: 'Google Login Failed',
          text2: e.message || 'Check your network connection and try again.',
        });
      }
    } finally {
      setIsLoading(null);
    }
  };

  const onPhonePress = () => {
    if (!showPhoneInput) {
      setShowPhoneInput(true);
      return;
    }
  };

  const onSendOTPPress = async () => {
    if (!phoneNumber || phoneNumber.length < 10) {
      Toast.show({ type: 'error', text1: 'Invalid Number', text2: 'Please enter a valid phone number with country code.' });
      return;
    }

    try {
      setIsLoading('phone');
      const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
      // Trigger invisible reCAPTCHA -> send SMS
      const vId = await handlePhoneLoginStart(formattedPhone, recaptchaVerifier.current as any);
      setVerificationId(vId);
      Toast.show({ type: 'info', text1: 'Code Sent', text2: 'Please check your messages.' });
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'SMS Failed', text2: e.message });
    } finally {
      setIsLoading(null);
    }
  };

  const onVerifyOTPPress = async () => {
    if (!verificationId || !verificationCode) return;
    try {
      setIsLoading('phone');
      await handlePhoneOTPConfirm(verificationId, verificationCode);
    } catch (e: any) {
      let msg = e.message;
      if (e.code === 'auth/invalid-verification-code') msg = 'Invalid code entered. Try again.';
      Toast.show({ type: 'error', text1: 'Verification Failed', text2: msg });
    } finally {
      setIsLoading(null);
    }
  };

  const onResetPhoneFlow = () => {
    setVerificationId(null);
    setVerificationCode('');
    setShowPhoneInput(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <FirebaseRecaptchaVerifierModal
        ref={recaptchaVerifier}
        firebaseConfig={app.options}
        attemptInvisibleVerification={true}
      />
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.content}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Eventa</Text>
          <Text style={styles.subtitle}>Sign in to discover your next vibe.</Text>
        </View>

        <View style={styles.actionContainer}>
          {Platform.OS === 'ios' && (
            <TouchableOpacity 
              style={[styles.providerButton, styles.appleButton]} 
              onPress={onApplePress}
              disabled={!!isLoading}
            >
              {isLoading === 'apple' ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Apple color="#FFFFFF" size={24} style={styles.icon} />
                  <Text style={styles.appleButtonText}>Continue with Apple</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity 
            style={[styles.providerButton, styles.googleButton]} 
            onPress={onGooglePress}
            disabled={!!isLoading}
          >
            {isLoading === 'google' ? (
              <ActivityIndicator color="#000000" />
            ) : (
              <>
                {/* Simplified "G" icon standard placeholder. Use SVG in production */}
                <Text style={[styles.icon, {fontWeight: 'bold', fontSize: 20, color: '#DB4437'}]}>G</Text>
                <Text style={styles.googleButtonText}>Continue with Google</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={styles.dividerContainer}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.dividerLine} />
          </View>

          {showPhoneInput ? (
            verificationId ? (
              // ── Step 2: Enter OTP Code ───────────────────────────────────────────
              <View style={styles.otpOuterContainer}>
                <TouchableOpacity onPress={onResetPhoneFlow} style={styles.backButton}>
                  <ArrowLeft color="#1A1A1A" size={20} />
                  <Text style={styles.backText}>Change number</Text>
                </TouchableOpacity>
                <View style={styles.phoneInputContainer}>
                  <TextInput
                    style={[styles.phoneInput, { textAlign: 'center', letterSpacing: 8, fontSize: 22 }]}
                    placeholder="000000"
                    keyboardType="number-pad"
                    value={verificationCode}
                    onChangeText={setVerificationCode}
                    maxLength={6}
                    autoFocus
                    placeholderTextColor="#999"
                  />
                  <TouchableOpacity 
                    style={styles.phoneSubmitButton}
                    onPress={onVerifyOTPPress}
                    disabled={!!isLoading}
                  >
                    {isLoading === 'phone' ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.phoneSubmitText}>Verify</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              // ── Step 1: Enter Phone Number ───────────────────────────────────────
              <View style={styles.phoneInputContainer}>
                <TextInput
                  style={styles.phoneInput}
                  placeholder="+1 234 567 8900"
                  keyboardType="phone-pad"
                  value={phoneNumber}
                  onChangeText={setPhoneNumber}
                  autoFocus
                  placeholderTextColor="#999"
                />
                <TouchableOpacity 
                  style={styles.phoneSubmitButton}
                  onPress={onSendOTPPress}
                  disabled={!!isLoading}
                >
                  {isLoading === 'phone' ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.phoneSubmitText}>Send OTP</Text>}
                </TouchableOpacity>
              </View>
            )
          ) : (
            <TouchableOpacity 
              style={[styles.providerButton, styles.phoneButtonOutline]} 
              onPress={onPhonePress}
              disabled={!!isLoading}
            >
              <Smartphone color="#1A1A1A" size={24} style={styles.icon} />
              <Text style={styles.phoneButtonText}>Continue with Phone</Text>
            </TouchableOpacity>
          )}

        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
  content: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },
  header: {
    marginBottom: 60,
    alignItems: 'center',
  },
  title: {
    fontSize: 42,
    fontWeight: '800',
    color: '#1A1A1A',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 18,
    color: '#666666',
  },
  actionContainer: {
    width: '100%',
    gap: 16,
  },
  providerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 30,
    width: '100%',
    position: 'relative',
  },
  icon: {
    position: 'absolute',
    left: 20,
  },
  appleButton: {
    backgroundColor: '#000000',
  },
  appleButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
  googleButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E5E5',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  googleButtonText: {
    color: '#000000',
    fontSize: 18,
    fontWeight: '600',
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E5E5',
  },
  dividerText: {
    marginHorizontal: 16,
    color: '#999999',
    fontWeight: '600',
  },
  phoneButtonOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#1A1A1A',
  },
  phoneButtonText: {
    color: '#1A1A1A',
    fontSize: 18,
    fontWeight: '600',
  },
  phoneInputContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  phoneInput: {
    flex: 1,
    height: 56,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 28,
    paddingHorizontal: 24,
    fontSize: 16,
    backgroundColor: '#FFFFFF',
    color: '#1A1A1A',
  },
  phoneSubmitButton: {
    backgroundColor: '#1A1A1A',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    borderRadius: 28,
    height: 56,
  },
  phoneSubmitText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  otpOuterContainer: {
    width: '100%',
    gap: 12,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 4,
  },
  backText: {
    color: '#1A1A1A',
    fontWeight: '600',
    fontSize: 14,
  },
});
