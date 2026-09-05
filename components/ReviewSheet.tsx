import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Check } from 'lucide-react-native';
import Toast from 'react-native-toast-message';
import { theme } from '../config/theme';
import { useAppStore } from '../hooks/useAppStore';
import { requireUsername } from '../services/userService';
import {
  ANSWER_LABELS,
  REVIEW_WINDOW_DAYS,
  ReviewAnswers,
  getReviewEligibility,
  submitReview,
} from '../services/reviewService';

/**
 * The whole review, as four taps.
 *
 * No text field on purpose. Prose is what people skip (a couple of percent
 * answer, against roughly a third for taps), what cannot be filtered or
 * aggregated, and what carries the moderation and defamation risk. These four
 * answers are also the ones that actually decide a night out: how full it is,
 * whether you'll get in, what it costs, and whether anyone would go back.
 */

const QUESTIONS: {
  key: keyof ReviewAnswers;
  prompt: string;
  options: string[];
}[] = [
  { key: 'crowd', prompt: 'How busy was it?', options: ['dead', 'chill', 'buzzing', 'packed'] },
  {
    key: 'entry',
    prompt: 'Getting in',
    options: ['walked_in', 'short_queue', 'long_queue', 'turned_away'],
  },
  { key: 'price', prompt: 'Prices', options: ['cheap', 'fair', 'steep'] },
];

interface ReviewSheetProps {
  isVisible: boolean;
  onClose: () => void;
  venueId: string;
  venueName: string;
  onSubmitted?: () => void;
}

export const ReviewSheet: React.FC<ReviewSheetProps> = ({
  isVisible,
  onClose,
  venueId,
  venueName,
  onSubmitted,
}) => {
  const insets = useSafeAreaInsets();
  const user = useAppStore((s) => s.user);
  const [answers, setAnswers] = useState<ReviewAnswers>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [eligibility, setEligibility] = useState<{
    canReview: boolean;
    visitDayKey?: string;
    visitedAt?: number;
    isEdit: boolean;
  }>({ canReview: false, isEdit: false });

  useEffect(() => {
    if (!isVisible || !user) return;
    let cancelled = false;
    setIsLoading(true);

    getReviewEligibility(user.uid, venueId)
      .then((result) => {
        if (cancelled) return;
        // An existing review pre-fills the sheet, so a returning visitor edits
        // their answer instead of being asked the same questions from scratch.
        if (result.existing) {
          setAnswers({
            crowd: result.existing.crowd,
            entry: result.existing.entry,
            price: result.existing.price,
            wouldReturn: result.existing.wouldReturn,
          });
        } else {
          setAnswers({});
        }
        setEligibility({
          canReview: result.canReview,
          visitDayKey: result.visitDayKey,
          visitedAt: result.visitedAt,
          isEdit: !!result.existing,
        });
      })
      .finally(() => !cancelled && setIsLoading(false));

    return () => {
      cancelled = true;
    };
  }, [isVisible, user, venueId]);

  const pick = (key: keyof ReviewAnswers, value: string | boolean) =>
    setAnswers((prev) => ({ ...prev, [key]: prev[key] === value ? undefined : value }));

  const answeredCount = QUESTIONS.filter((q) => answers[q.key] !== undefined).length;
  const canSubmit = answeredCount > 0 && !isSaving && eligibility.canReview;

  const handleSubmit = async () => {
    if (!user || !canSubmit) return;
    setIsSaving(true);
    try {
      const username = await requireUsername(user.uid);
      await submitReview({
        userId: user.uid,
        username,
        venueId,
        venueName,
        visitDayKey: eligibility.visitDayKey || '',
        visitedAt: eligibility.visitedAt || Date.now(),
        answers,
      });
      Toast.show({ type: 'success', text1: 'Thanks — that helps everyone else' });
      onSubmitted?.();
      onClose();
    } catch (err: any) {
      console.warn('[ReviewSheet] Submit failed:', err);
      Toast.show({
        type: 'error',
        text1: 'Could not save',
        text2: err?.message || 'Try again in a moment.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const visitLabel = eligibility.visitDayKey
    ? new Date(eligibility.visitedAt || Date.now()).toLocaleDateString('en-GB', {
        timeZone: 'Africa/Nairobi',
        day: 'numeric',
        month: 'short',
      })
    : null;

  return (
    <Modal visible={isVisible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: Math.max(20, insets.bottom) }]}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>
                {venueName}
              </Text>
              {visitLabel && <Text style={styles.subtitle}>Verified visit · {visitLabel}</Text>}
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <X color={theme.textSecondary} size={22} />
            </TouchableOpacity>
          </View>

          {isLoading ? (
            <ActivityIndicator color={theme.accent} style={{ marginVertical: 40 }} />
          ) : !eligibility.canReview ? (
            // The gate, stated plainly. "You weren't here" would read as an
            // accusation; the useful half is what makes someone eligible.
            <View style={styles.lockedBox}>
              <Text style={styles.lockedTitle}>Only people who were there can rate</Text>
              <Text style={styles.lockedBody}>
                Check in at {venueName} and you can rate it for the next {REVIEW_WINDOW_DAYS} days.
              </Text>
            </View>
          ) : (
            <>
              {QUESTIONS.map((q) => (
                <View key={q.key} style={styles.question}>
                  <Text style={styles.prompt}>{q.prompt}</Text>
                  <View style={styles.options}>
                    {q.options.map((opt) => {
                      const selected = answers[q.key] === opt;
                      return (
                        <TouchableOpacity
                          key={opt}
                          style={[styles.chip, selected && styles.chipActive]}
                          onPress={() => pick(q.key, opt)}
                        >
                          <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                            {ANSWER_LABELS[opt]}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}

              <View style={styles.question}>
                <Text style={styles.prompt}>Would you go back?</Text>
                <View style={styles.options}>
                  {[
                    { label: 'Yes', value: true },
                    { label: 'No', value: false },
                  ].map(({ label, value }) => {
                    const selected = answers.wouldReturn === value;
                    return (
                      <TouchableOpacity
                        key={label}
                        style={[styles.chip, selected && styles.chipActive]}
                        onPress={() => pick('wouldReturn', value)}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextActive]}>
                          {label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <TouchableOpacity
                style={[styles.submit, !canSubmit && styles.submitDisabled]}
                onPress={handleSubmit}
                disabled={!canSubmit}
              >
                {isSaving ? (
                  <ActivityIndicator color="#120D1A" />
                ) : (
                  <>
                    <Check color="#120D1A" size={18} />
                    <Text style={styles.submitText}>
                      {eligibility.isEdit ? 'Update rating' : 'Submit rating'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
              {/* Any single answer is worth having — demanding all four is how a
                  30% completion rate turns into 8%. */}
              <Text style={styles.footnote}>Answer as many or as few as you like.</Text>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#171320',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 18,
    borderTopWidth: 1,
    borderColor: '#2F1A4A',
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 18 },
  title: { color: theme.textPrimary, fontSize: 19, fontWeight: '800' },
  subtitle: { color: '#00FFCC', fontSize: 12, fontWeight: '600', marginTop: 3 },
  question: { marginBottom: 16 },
  prompt: {
    color: '#8A7A9A',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: '#241B36',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: '#3A2A55',
  },
  chipActive: { backgroundColor: '#00FFCC', borderColor: '#00FFCC' },
  chipText: { color: '#9A8FB0', fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#120D1A', fontWeight: '800' },
  submit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#00FFCC',
    borderRadius: 16,
    paddingVertical: 15,
    marginTop: 6,
  },
  submitDisabled: { opacity: 0.4 },
  submitText: { color: '#120D1A', fontSize: 15, fontWeight: '800' },
  footnote: { color: '#6A5A7A', fontSize: 11, textAlign: 'center', marginTop: 10 },
  lockedBox: { paddingVertical: 24, alignItems: 'center' },
  lockedTitle: { color: theme.textPrimary, fontSize: 15, fontWeight: '700', marginBottom: 6 },
  lockedBody: { color: theme.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 19 },
});
