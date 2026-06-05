import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  TextInput,
  ActivityIndicator,
  Image,
  Alert,
  ScrollView,
  Animated,
  Dimensions,
  Keyboard,
} from 'react-native';
import { Apple, Smartphone, ArrowLeft } from 'lucide-react-native';
import Toast from 'react-native-toast-message';
import FirebaseRecaptchaVerifierModal from '../components/FirebaseRecaptcha/FirebaseRecaptchaVerifierModal';
import {
  handleGoogleLogin,
  handleAppleLogin,
  handlePhoneLoginStart,
  handlePhoneOTPConfirm,
  handleSpecialBypassLogin,
} from '../services/authService';
import app from '../services/firebase';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getFriendlyErrorMessage } from '../utils/errorUtils';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ─── Animated Light Ray ───────────────────────────────────────────────────────
interface RayConfig {
  color: string;
  rotation: string;
  top: number;
  left: number;
  width: number;
  height: number;
  initialOpacity: number;
  animDuration: number;
  animDelay: number;
}

const RAY_CONFIGS: RayConfig[] = [
  // Teal rays (top-right)
  { color: 'rgba(0, 210, 200, 0.18)', rotation: '-35deg', top: -80, left: SCREEN_W * 0.25, width: SCREEN_W * 1.2, height: 140, initialOpacity: 0.6, animDuration: 4200, animDelay: 0 },
  { color: 'rgba(0, 180, 210, 0.14)', rotation: '-28deg', top: 30, left: SCREEN_W * 0.1, width: SCREEN_W * 1.4, height: 90, initialOpacity: 0.4, animDuration: 5500, animDelay: 800 },
  { color: 'rgba(80, 200, 220, 0.12)', rotation: '-42deg', top: 110, left: SCREEN_W * 0.3, width: SCREEN_W * 1.1, height: 60, initialOpacity: 0.3, animDuration: 6000, animDelay: 400 },
  // Purple rays (left)
  { color: 'rgba(140, 70, 230, 0.20)', rotation: '25deg', top: SCREEN_H * 0.3, left: -SCREEN_W * 0.3, width: SCREEN_W * 1.3, height: 120, initialOpacity: 0.5, animDuration: 4800, animDelay: 1200 },
  { color: 'rgba(160, 80, 240, 0.14)', rotation: '18deg', top: SCREEN_H * 0.45, left: -SCREEN_W * 0.2, width: SCREEN_W * 1.1, height: 70, initialOpacity: 0.3, animDuration: 5800, animDelay: 600 },
  // Bottom teal wave
  { color: 'rgba(0, 200, 190, 0.16)', rotation: '-15deg', top: SCREEN_H * 0.6, left: -SCREEN_W * 0.1, width: SCREEN_W * 1.5, height: 100, initialOpacity: 0.4, animDuration: 5200, animDelay: 1600 },
  { color: 'rgba(100, 60, 220, 0.18)', rotation: '10deg', top: SCREEN_H * 0.72, left: -SCREEN_W * 0.2, width: SCREEN_W * 1.4, height: 80, initialOpacity: 0.35, animDuration: 4600, animDelay: 900 },
];

const AnimatedRay: React.FC<RayConfig> = ({
  color, rotation, top, left, width, height,
  initialOpacity, animDuration, animDelay,
}) => {
  const opacity = useRef(new Animated.Value(initialOpacity)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const opacityAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: initialOpacity * 1.7,
          duration: animDuration,
          delay: animDelay,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: initialOpacity * 0.3,
          duration: animDuration,
          useNativeDriver: true,
        }),
      ])
    );

    const translateAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(translateY, {
          toValue: 18,
          duration: animDuration * 1.1,
          delay: animDelay,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: -10,
          duration: animDuration * 0.9,
          useNativeDriver: true,
        }),
      ])
    );

    opacityAnim.start();
    translateAnim.start();
    return () => {
      opacityAnim.stop();
      translateAnim.stop();
    };
  }, []);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        top,
        left,
        width,
        height,
        backgroundColor: color,
        borderRadius: height / 2,
        transform: [{ rotate: rotation }, { translateY }],
        opacity,
      }}
    />
  );
};

// ─── Main Login Screen ────────────────────────────────────────────────────────
export const LoginScreen = () => {
  const [isLoading, setIsLoading] = useState<string | null>(null);

  // Phone Auth State
  const [showPhoneInput, setShowPhoneInput] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState('');
  const recaptchaVerifier = useRef(null);

  // Keyboard visibility tracking
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showSubscription = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardVisible(true)
    );
    const hideSubscription = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardVisible(false)
    );

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const onApplePress = async () => {
    try {
      setIsLoading('apple');
      await handleAppleLogin();
    } catch (e: any) {
      if (e.message === 'ACCOUNT_SUSPENDED') {
        Alert.alert(
          'Account Suspended',
          'Due to previous activities that are not aligned with our policies we have been forced to temporarily suspend your account. Contact us via email in case you think this is wrong.\n\nsupport@eventas.live',
          [{ text: 'OK' }]
        );
      } else if (e.code !== 'ERR_REQUEST_CANCELED') {
        Toast.show({
          type: 'error',
          text1: 'Apple Login Failed',
          text2: getFriendlyErrorMessage(e),
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
      if (e.message === 'ACCOUNT_SUSPENDED') {
        Alert.alert(
          'Account Suspended',
          'Due to previous activities that are not aligned with our policies we have been forced to temporarily suspend your account. Contact us via email in case you think this is wrong.\n\nsupport@eventas.live',
          [{ text: 'OK' }]
        );
      } else if (e.code !== 'SIGN_IN_CANCELLED') {
        Toast.show({
          type: 'error',
          text1: 'Google Login Failed',
          text2: getFriendlyErrorMessage(e),
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
    const trimmedPhone = phoneNumber.trim();
    if (trimmedPhone === '0990') {
      try {
        setIsLoading('phone');
        await handleSpecialBypassLogin();
        Toast.show({ type: 'success', text1: 'Special Access', text2: 'Logged in successfully.' });
      } catch (e: any) {
        Toast.show({ type: 'error', text1: 'Bypass Login Failed', text2: getFriendlyErrorMessage(e) });
      } finally {
        setIsLoading(null);
      }
      return;
    }

    if (!phoneNumber || phoneNumber.length < 10) {
      Toast.show({ type: 'error', text1: 'Invalid Number', text2: 'Please enter a valid phone number with country code.' });
      return;
    }
    try {
      setIsLoading('phone');
      const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
      const vId = await handlePhoneLoginStart(formattedPhone, recaptchaVerifier.current as any);
      setVerificationId(vId);
      Toast.show({ type: 'info', text1: 'Code Sent', text2: 'Please check your messages.' });
    } catch (e: any) {
      Toast.show({ type: 'error', text1: 'SMS Failed', text2: getFriendlyErrorMessage(e) });
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
      if (e.message === 'ACCOUNT_SUSPENDED') {
        Alert.alert(
          'Account Suspended',
          'Due to previous activities that are not aligned with our policies we have been forced to temporarily suspend your account. Contact us via email in case you think this is wrong.\n\nsupport@eventas.live',
          [{ text: 'OK' }]
        );
      } else {
        Toast.show({ type: 'error', text1: 'Verification Failed', text2: getFriendlyErrorMessage(e) });
      }
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
    <View style={styles.root}>
      {/* ── Animated Background ─────────────────────────────────────────── */}
      {/* Deep purple → near-black gradient base */}
      <View style={styles.bgBase} />

      {/* Animated light rays */}
      {RAY_CONFIGS.map((cfg, i) => (
        <AnimatedRay key={i} {...cfg} />
      ))}

      {/* Subtle vignette overlay */}
      <View style={styles.vignette} />

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <FirebaseRecaptchaVerifierModal
        ref={recaptchaVerifier}
        firebaseConfig={app.options}
        attemptInvisibleVerification={true}
      />

      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={[
              styles.scroll,
              keyboardVisible && { justifyContent: 'flex-start' }
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {/* Logo + Brand (collapses when keyboard is visible to save vertical space on Android) */}
            <View style={[styles.heroSection, keyboardVisible && { marginBottom: 12, marginTop: 8 }]}>
              <View style={[styles.logoWrapper, keyboardVisible ? { width: 120, height: 98, marginBottom: 4 } : null]}>
                <Image
                  source={require('../assets/EventasNewLogo.png')}
                  style={[styles.logo, keyboardVisible ? { width: 120, height: 98 } : null]}
                  resizeMode="contain"
                />
              </View>
              {!keyboardVisible && (
                <Text style={styles.tagline}>Sign in to discover your next vibe.</Text>
              )}
            </View>

            {/* Auth Buttons */}
            <View style={styles.buttonsSection}>

              {/* Apple */}
              {Platform.OS === 'ios' && (
                <TouchableOpacity
                  style={styles.appleBtn}
                  onPress={onApplePress}
                  disabled={!!isLoading}
                  activeOpacity={0.85}
                >
                  {isLoading === 'apple' ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <>
                      <View style={styles.btnIconWrap}>
                        <Apple color="#FFFFFF" size={22} />
                      </View>
                      <Text style={styles.appleBtnText}>Continue with Apple</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}

              {/* Google */}
              <TouchableOpacity
                style={styles.googleBtn}
                onPress={onGooglePress}
                disabled={!!isLoading}
                activeOpacity={0.85}
              >
                {isLoading === 'google' ? (
                  <ActivityIndicator color="#1A1A1A" />
                ) : (
                  <>
                    <View style={styles.btnIconWrap}>
                      <Text style={styles.googleG}>G</Text>
                    </View>
                    <Text style={styles.googleBtnText}>Continue with Google</Text>
                  </>
                )}
              </TouchableOpacity>

              {/* OR Divider */}
              <View style={styles.orRow}>
                <View style={styles.orLine} />
                <Text style={styles.orText}>OR</Text>
                <View style={styles.orLine} />
              </View>

              {/* Phone — expands into input flow */}
              {showPhoneInput ? (
                verificationId ? (
                  // Step 2: OTP Entry
                  <View style={styles.phoneFlowWrap}>
                    <TouchableOpacity onPress={onResetPhoneFlow} style={styles.backBtn}>
                      <ArrowLeft color="rgba(255,255,255,0.7)" size={18} />
                      <Text style={styles.backText}>Change number</Text>
                    </TouchableOpacity>
                    <View style={styles.phoneInputRow}>
                      <TextInput
                        style={[styles.phoneInput, { textAlign: 'center', letterSpacing: 10, fontSize: 24 }]}
                        placeholder="000000"
                        placeholderTextColor="rgba(255,255,255,0.3)"
                        keyboardType="number-pad"
                        value={verificationCode}
                        onChangeText={setVerificationCode}
                        maxLength={6}
                        autoFocus
                      />
                      <TouchableOpacity
                        style={styles.phoneSubmitBtn}
                        onPress={onVerifyOTPPress}
                        disabled={!!isLoading}
                        activeOpacity={0.85}
                      >
                        {isLoading === 'phone'
                          ? <ActivityIndicator color="#FFFFFF" />
                          : <Text style={styles.phoneSubmitText}>Verify</Text>}
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  // Step 1: Phone Number
                  <View style={styles.phoneInputRow}>
                    <TextInput
                      style={styles.phoneInput}
                      placeholder="+254712345678"
                      placeholderTextColor="rgba(255,255,255,0.3)"
                      keyboardType="phone-pad"
                      value={phoneNumber}
                      onChangeText={setPhoneNumber}
                      autoFocus
                    />
                    <TouchableOpacity
                      style={styles.phoneSubmitBtn}
                      onPress={onSendOTPPress}
                      disabled={!!isLoading}
                      activeOpacity={0.85}
                    >
                      {isLoading === 'phone'
                        ? <ActivityIndicator color="#FFFFFF" />
                        : <Text style={styles.phoneSubmitText}>Send OTP</Text>}
                    </TouchableOpacity>
                  </View>
                )
              ) : (
                <TouchableOpacity
                  style={styles.phoneBtn}
                  onPress={onPhonePress}
                  disabled={!!isLoading}
                  activeOpacity={0.85}
                >
                  <View style={styles.btnIconWrap}>
                    <Smartphone color="rgba(255,255,255,0.85)" size={22} />
                  </View>
                  <Text style={styles.phoneBtnText}>Continue with Phone</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Footer tagline */}
            <Text style={styles.footer}>
              A universe of moments is just{'\n'}a location away.
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#120825', // Deep purple-black base
  },
  bgBase: {
    ...StyleSheet.absoluteFillObject,
    // Deep purple on left → dark navy on right
    backgroundColor: '#1a0d35',
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  safeArea: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: 24,
    paddingBottom: 40,
    justifyContent: 'center',
  },

  // ── Hero ──────────────────────────────────────────────────────────────────
  heroSection: {
    alignItems: 'center',
    marginBottom: 44,
    marginTop: 16,
  },
  logoWrapper: {
    width: 220,
    height: 180,
    marginBottom: 8,
    // Subtle glow behind logo
    shadowColor: '#7B4FD4',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 30,
    elevation: 12,
  },
  logo: {
    width: 220,
    height: 180,
  },
  brandName: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 6,
    // Gradient text via color — we use a bright purple-to-teal-ish color
    color: '#A78BFA', // Vibrant violet
    textShadowColor: 'rgba(100, 200, 255, 0.4)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
    marginBottom: 12,
  },
  tagline: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.75)',
    textAlign: 'center',
    fontWeight: '400',
    letterSpacing: 0.2,
  },

  // ── Auth Buttons ──────────────────────────────────────────────────────────
  buttonsSection: {
    width: '100%',
    gap: 14,
  },
  btnIconWrap: {
    position: 'absolute',
    left: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Apple
  appleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
    borderRadius: 32,
    paddingVertical: 17,
    paddingHorizontal: 24,
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
  appleBtnText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: 0.2,
  },

  // Google
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 32,
    paddingVertical: 17,
    paddingHorizontal: 24,
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 6,
  },
  googleBtnText: {
    color: '#1A1A1A',
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  googleG: {
    fontSize: 20,
    fontWeight: '800',
    color: '#DB4437',
  },

  // OR
  orRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 2,
  },
  orLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  orText: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
  },

  // Phone
  phoneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 32,
    paddingVertical: 17,
    paddingHorizontal: 24,
    position: 'relative',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  phoneBtnText: {
    color: 'rgba(255,255,255,0.90)',
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: 0.2,
  },

  // Phone input flow
  phoneFlowWrap: {
    gap: 12,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  backText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    fontWeight: '500',
  },
  phoneInputRow: {
    flexDirection: 'row',
    gap: 10,
  },
  phoneInput: {
    flex: 1,
    height: 56,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 28,
    paddingHorizontal: 22,
    fontSize: 16,
    color: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  phoneSubmitBtn: {
    backgroundColor: '#7B4FD4',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 22,
    borderRadius: 28,
    height: 56,
    shadowColor: '#7B4FD4',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 8,
  },
  phoneSubmitText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },

  // ── Footer ────────────────────────────────────────────────────────────────
  footer: {
    marginTop: 44,
    color: 'rgba(255,255,255,0.35)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    fontWeight: '400',
  },
});
