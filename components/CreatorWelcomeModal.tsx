/**
 * CreatorWelcomeModal — one-time celebration + walkthrough shown on the first
 * launch after a creator application is approved. Driven by useCreatorWelcome.
 *
 * Flow: a congratulations hero → a short, skippable tour of the features a
 * creator account unlocks → a final CTA into the Creator Dashboard. "Skip" and
 * the close affordance are available at every step; either way, dismissing
 * persists the "seen" marker so it never shows again for this approval.
 *
 * Steps mirror the actual creator surfaces (referral link + stats, "I'm Going"
 * attendance, verified stage identity, the dashboard). When new creator
 * features ship, add a slide to WALKTHROUGH_SLIDES.
 */
import React, { useRef, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, Animated, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  PartyPopper, Share2, CalendarCheck, BadgeCheck, LineChart,
  ChevronRight, X,
} from 'lucide-react-native';
import { theme } from '../config/theme';
import type { CreatorProfile } from '../services/creatorService';

interface WalkthroughSlide {
  category: string;
  title: string;
  description: string;
  Icon: any;
  color: string;
}

const WALKTHROUGH_SLIDES: WalkthroughSlide[] = [
  {
    category: 'GROW YOUR REACH',
    title: 'Your Referral Link',
    description:
      'Share your personal link to invite people to Eventas. Track every click, install, sign-up, and first venue visit it drives — all in real time.',
    Icon: Share2,
    color: theme.accent,
  },
  {
    category: 'SHOW UP',
    title: '"I\'m Going" on Events',
    description:
      'Declare your attendance on any event to appear in its Creators Attending section. When you actually show up, it\'s automatically verified on location.',
    Icon: CalendarCheck,
    color: '#A78BFA',
  },
  {
    category: 'STAND OUT',
    title: 'Verified Creator Identity',
    description:
      'Your stage name now carries a verified Creator badge across the app, so the community knows you\'re the real deal.',
    Icon: BadgeCheck,
    color: theme.accentAlt,
  },
  {
    category: 'ALL IN ONE PLACE',
    title: 'Your Creator Dashboard',
    description:
      'A dedicated home for your referral stats and attendance history — with profile views, insights, and rewards on the way.',
    Icon: LineChart,
    color: theme.gold,
  },
];

interface CreatorWelcomeModalProps {
  visible: boolean;
  creatorProfile: CreatorProfile | null;
  /** Persists the "seen" marker. Called on skip, close, and finish. */
  onDismiss: () => void;
  /** Fired when the user chooses to open the dashboard on the final step. */
  onGoToDashboard: () => void;
}

// step index: -1 is the congratulations hero, 0..N-1 are walkthrough slides.
const HERO_STEP = -1;

export const CreatorWelcomeModal: React.FC<CreatorWelcomeModalProps> = ({
  visible, creatorProfile, onDismiss, onGoToDashboard,
}) => {
  const [step, setStep] = useState(HERO_STEP);
  const fade = useRef(new Animated.Value(1)).current;

  // Reset to the hero each time the modal opens.
  React.useEffect(() => {
    if (visible) {
      setStep(HERO_STEP);
      fade.setValue(1);
    }
  }, [visible, fade]);

  const transitionTo = (next: number) => {
    Animated.timing(fade, { toValue: 0, duration: 130, useNativeDriver: true }).start(() => {
      setStep(next);
      Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    });
  };

  const isLastSlide = step === WALKTHROUGH_SLIDES.length - 1;

  const handlePrimary = () => {
    if (step === HERO_STEP) {
      transitionTo(0);
    } else if (isLastSlide) {
      onGoToDashboard();
      onDismiss();
    } else {
      transitionTo(step + 1);
    }
  };

  const handleFinish = () => onDismiss();

  const slide = step >= 0 ? WALKTHROUGH_SLIDES[step] : null;
  const accent = slide ? slide.color : theme.accent;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.bgBase} />
        <SafeAreaView style={styles.safeArea}>
          {/* Header: close (persists seen) + skip on tour steps */}
          <View style={styles.header}>
            <TouchableOpacity onPress={onDismiss} hitSlop={12} style={styles.closeButton}>
              <X color="rgba(255,255,255,0.6)" size={22} />
            </TouchableOpacity>
            {step !== HERO_STEP && (
              <TouchableOpacity onPress={handleFinish} hitSlop={12} style={styles.skipButton}>
                <Text style={styles.skipText}>Skip</Text>
              </TouchableOpacity>
            )}
          </View>

          {step === HERO_STEP ? (
            <Animated.View style={[styles.body, { opacity: fade }]}>
              <View style={[styles.iconWrapper, styles.heroIcon]}>
                <PartyPopper color={theme.accent} size={58} />
              </View>
              <Text style={styles.heroKicker}>APPLICATION APPROVED</Text>
              <Text style={styles.heroTitle}>You're a Creator{'\n'}now 🎉</Text>
              <Text style={styles.heroName}>{creatorProfile?.creatorName ?? ''}</Text>
              <Text style={styles.heroSub}>
                Congratulations — your creator account is live. Here's a quick look at
                everything you've just unlocked.
              </Text>
            </Animated.View>
          ) : (
            <Animated.View style={[styles.body, { opacity: fade }]}>
              <View style={[styles.iconWrapper, { borderColor: accent, shadowColor: accent }]}>
                {slide && <slide.Icon color={accent} size={50} />}
              </View>
              <Text style={[styles.category, { color: accent }]}>{slide?.category}</Text>
              <Text style={styles.title}>{slide?.title}</Text>
              <Text style={styles.description}>{slide?.description}</Text>
            </Animated.View>
          )}

          {/* Footer: pagination + primary action */}
          <View style={styles.footer}>
            <View style={styles.pagination}>
              {WALKTHROUGH_SLIDES.map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.dot,
                    step === i && { backgroundColor: accent, width: 20 },
                  ]}
                />
              ))}
            </View>

            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: accent }]}
              onPress={handlePrimary}
              activeOpacity={0.85}
            >
              <Text style={styles.actionText}>
                {step === HERO_STEP ? 'Take the tour' : isLastSlide ? 'Go to Dashboard' : 'Next'}
              </Text>
              {step !== HERO_STEP && !isLastSlide && (
                <ChevronRight color={theme.onAccent} size={18} style={{ marginLeft: 4 }} />
              )}
            </TouchableOpacity>
          </View>

          {step === HERO_STEP && (
            <TouchableOpacity onPress={handleFinish} style={styles.textLink} hitSlop={8}>
              <Text style={styles.textLinkLabel}>Maybe later</Text>
            </TouchableOpacity>
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: theme.background },
  bgBase: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.background },
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 8, minHeight: 44,
  },
  closeButton: { padding: 6 },
  skipButton: { paddingVertical: 6, paddingHorizontal: 10 },
  skipText: { color: 'rgba(255,255,255,0.5)', fontSize: 14, fontWeight: '600' },

  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  iconWrapper: {
    width: 132, height: 132, borderRadius: 66, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 22, elevation: 8,
    marginBottom: 28,
  },
  heroIcon: { borderColor: theme.accent, shadowColor: theme.accent },

  heroKicker: {
    color: theme.accent, fontSize: 12, fontWeight: '800', letterSpacing: 2, marginBottom: 12,
  },
  heroTitle: {
    color: theme.textPrimary, fontSize: 34, fontWeight: '800', lineHeight: 42,
    textAlign: 'center', letterSpacing: -0.5,
  },
  heroName: {
    color: theme.accent, fontSize: 18, fontWeight: '700', marginTop: 10, textAlign: 'center',
  },
  heroSub: {
    color: 'rgba(255,255,255,0.65)', fontSize: 15, lineHeight: 24, textAlign: 'center',
    marginTop: 16,
  },

  category: { fontSize: 12, fontWeight: '800', letterSpacing: 2, marginBottom: 12 },
  title: {
    color: theme.textPrimary, fontSize: 28, fontWeight: '800', lineHeight: 34,
    textAlign: 'center', letterSpacing: -0.3,
  },
  description: {
    color: 'rgba(255,255,255,0.65)', fontSize: 15, lineHeight: 24, textAlign: 'center',
    marginTop: 16,
  },

  footer: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 28, paddingTop: 12,
  },
  pagination: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.2)' },
  actionButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 24, height: 50, borderRadius: 25,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25,
    shadowRadius: 8, elevation: 6,
  },
  actionText: { color: theme.onAccent, fontSize: 15, fontWeight: '800', letterSpacing: 0.2 },

  textLink: {
    alignSelf: 'center', paddingVertical: 14,
    paddingBottom: Platform.OS === 'ios' ? 8 : 24,
  },
  textLinkLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 14, fontWeight: '600' },
});
