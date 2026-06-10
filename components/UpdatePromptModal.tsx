import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Download, AlertTriangle, Sparkles, ShieldCheck, ArrowRight } from 'lucide-react-native';

interface UpdatePromptModalProps {
  isVisible: boolean;
  isForced: boolean;
  latestVersion: string;
  updateUrl: string;
  onClose: () => void;
}

export const UpdatePromptModal: React.FC<UpdatePromptModalProps> = ({
  isVisible,
  isForced,
  latestVersion,
  updateUrl,
  onClose,
}) => {
  const insets = useSafeAreaInsets();

  const handleUpdate = async () => {
    if (updateUrl) {
      try {
        const supported = await Linking.canOpenURL(updateUrl);
        if (supported) {
          await Linking.openURL(updateUrl);
        } else {
          console.warn(`[UpdatePromptModal] Don't know how to open URL: ${updateUrl}`);
          // Fallback opening
          await Linking.openURL(updateUrl);
        }
      } catch (err) {
        console.error('[UpdatePromptModal] Failed to open update URL:', err);
      }
    } else {
      console.warn('[UpdatePromptModal] No update URL provided.');
    }
  };

  if (!isVisible) return null;

  return (
    <Modal
      transparent
      visible={isVisible}
      animationType="slide"
      statusBarTranslucent
      onRequestClose={isForced ? () => {} : onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.centerContainer}>
          <LinearGradient
            colors={['#1c0f30', '#0a0514']}
            style={styles.modalContainer}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            {/* Top decorative glow */}
            <LinearGradient
              colors={isForced ? ['#FF3B30', 'transparent'] : ['#00FFCC', 'transparent']}
              style={styles.glowAccent}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
            />

            {/* Icon Header */}
            <View style={styles.iconContainer}>
              <View style={[
                styles.iconCircle,
                isForced ? styles.iconCircleForced : styles.iconCircleFlexible
              ]}>
                {isForced ? (
                  <AlertTriangle color="#FF3B30" size={32} />
                ) : (
                  <Sparkles color="#00FFCC" size={32} />
                )}
              </View>
            </View>

            {/* Title and Version */}
            <Text style={styles.title}>
              {isForced ? 'Update Required' : 'New Update Available'}
            </Text>
            <View style={styles.versionBadge}>
              <Text style={styles.versionText}>v{latestVersion}</Text>
            </View>

            {/* Description */}
            <Text style={styles.description}>
              {isForced
                ? 'A critical update is required to continue using Eventa. We’ve added security enhancements and vital performance improvements.'
                : 'A new version of Eventa is ready! Update now to experience new features, enhanced design, and general bug fixes.'}
            </Text>

            {/* Features list */}
            <View style={styles.featuresList}>
              <View style={styles.featureItem}>
                <ShieldCheck color="#00FFCC" size={20} style={styles.featureIcon} />
                <View style={styles.featureTextContainer}>
                  <Text style={styles.featureTitle}>Security & Stability</Text>
                  <Text style={styles.featureDesc}>Critical bug fixes and optimized background performance.</Text>
                </View>
              </View>
              <View style={styles.featureItem}>
                <Sparkles color="#00FFCC" size={20} style={styles.featureIcon} />
                <View style={styles.featureTextContainer}>
                  <Text style={styles.featureTitle}>Enhanced Experience</Text>
                  <Text style={styles.featureDesc}>Sleeker layout transitions and faster message deliveries.</Text>
                </View>
              </View>
            </View>

            {/* Action Buttons */}
            <View style={styles.buttonContainer}>
              <TouchableOpacity onPress={handleUpdate} activeOpacity={0.85}>
                <LinearGradient
                  colors={isForced ? ['#FF3B30', '#C30010'] : ['#00FFCC', '#00B3FF']}
                  style={styles.updateButton}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                >
                  <Download color="#0A0514" size={20} style={styles.buttonIcon} />
                  <Text style={styles.updateButtonText}>Update Now</Text>
                </LinearGradient>
              </TouchableOpacity>

              {!isForced && (
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={onClose}
                  activeOpacity={0.8}
                >
                  <Text style={styles.cancelButtonText}>Maybe Later</Text>
                  <ArrowRight color="#666" size={14} />
                </TouchableOpacity>
              )}
            </View>
          </LinearGradient>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(5, 2, 10, 0.9)', // very dark purple tint translucent backplate
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  centerContainer: {
    width: '100%',
    maxWidth: 360,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 20,
  },
  modalContainer: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    overflow: 'hidden',
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 28,
    alignItems: 'center',
  },
  glowAccent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 120,
    opacity: 0.15,
  },
  iconContainer: {
    marginBottom: 20,
  },
  iconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  iconCircleForced: {
    backgroundColor: 'rgba(255, 59, 48, 0.12)',
    borderColor: 'rgba(255, 59, 48, 0.3)',
  },
  iconCircleFlexible: {
    backgroundColor: 'rgba(0, 255, 204, 0.12)',
    borderColor: 'rgba(0, 255, 204, 0.3)',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFF',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  versionBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  versionText: {
    fontSize: 12,
    color: '#00FFCC',
    fontWeight: '700',
  },
  description: {
    fontSize: 14,
    color: '#AAA',
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 16,
    paddingHorizontal: 4,
  },
  featuresList: {
    width: '100%',
    marginTop: 24,
    marginBottom: 28,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  featureIcon: {
    marginTop: 2,
    marginRight: 12,
  },
  featureTextContainer: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFF',
  },
  featureDesc: {
    fontSize: 12,
    color: '#888',
    lineHeight: 16,
    marginTop: 2,
  },
  buttonContainer: {
    width: '100%',
    gap: 12,
  },
  updateButton: {
    height: 52,
    borderRadius: 26,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#00FFCC',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  buttonIcon: {
    marginRight: 8,
  },
  updateButtonText: {
    color: '#0A0514',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  cancelButton: {
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  cancelButtonText: {
    color: '#888',
    fontSize: 14,
    fontWeight: '600',
  },
});
