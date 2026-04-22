import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Apple, Smartphone } from 'lucide-react-native';
import { handleGoogleLogin, handleAppleLogin } from '../services/authService';
import { SafeAreaView } from 'react-native-safe-area-context';

export const LoginScreen = () => {
  const [isLoading, setIsLoading] = useState<string | null>(null);
  const [showPhoneInput, setShowPhoneInput] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');

  const onApplePress = async () => {
    try {
      setIsLoading('apple');
      await handleAppleLogin();
    } catch (e: any) {
      if (e.code !== 'ERR_REQUEST_CANCELED') {
         Alert.alert('Apple Login Failed', e.message);
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
        Alert.alert('Google Login Failed', e.message);
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
    // TODO: Phone auth OTP dispatch trigger
    Alert.alert('Coming Soon', 'Phone authentication processing native dispatch.');
  };

  return (
    <SafeAreaView style={styles.container}>
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
                onPress={onPhonePress}
              >
                <Text style={styles.phoneSubmitText}>Send OTP</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity 
              style={[styles.providerButton, styles.phoneButtonOutline]} 
              onPress={onPhonePress}
              disabled={!!isLoading}
            >
              <Smartphone color="#000000" size={24} style={styles.icon} />
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
});
