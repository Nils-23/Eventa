import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Star, ThumbsUp } from 'lucide-react-native';
import { theme } from '../config/theme';
import { ReviewStats, summarizeStats } from '../services/reviewService';

/**
 * The one line of review data a venue card can afford.
 *
 * Reads the aggregate denormalized onto the venue doc, so it costs no extra
 * read — the card already has the venue. There is no star average anywhere on
 * purpose: in nightlife every venue converges on the same 4.2 and nobody reads
 * it. "Buzzing · Short queue · Fair" tells you what tonight will be like, which
 * is the question people actually open the app with.
 *
 * With no reviews yet it becomes the prompt to leave the first one, so an empty
 * venue reads as an invitation rather than a broken section.
 */
interface VenueRatingRowProps {
  stats?: ReviewStats | null;
  onPress: () => void;
}

export const VenueRatingRow: React.FC<VenueRatingRowProps> = ({ stats, onPress }) => {
  const { count, headline, wouldReturnPct } = summarizeStats(stats);

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.75}>
      <Star color="#FFD700" size={14} />
      <View style={styles.textCol}>
        {count > 0 ? (
          <>
            <Text style={styles.headline} numberOfLines={1}>
              {headline || 'Rated by visitors'}
            </Text>
            <View style={styles.metaRow}>
              <Text style={styles.meta}>
                {count} {count === 1 ? 'rating' : 'ratings'}
              </Text>
              {wouldReturnPct !== null && (
                <>
                  <Text style={styles.dot}>·</Text>
                  <ThumbsUp color="#4CD964" size={11} />
                  <Text style={styles.meta}>{wouldReturnPct}% would return</Text>
                </>
              )}
            </View>
          </>
        ) : (
          <>
            <Text style={styles.headline}>No ratings yet</Text>
            <Text style={styles.meta}>Been here? Rate it</Text>
          </>
        )}
      </View>
      <Text style={styles.action}>{count > 0 ? 'Rate' : 'Add'}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#1A1626',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2F1A4A',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 10,
  },
  textCol: { flex: 1, minWidth: 0 },
  headline: { color: theme.textPrimary, fontSize: 13, fontWeight: '700' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  meta: { color: theme.textSecondary, fontSize: 11 },
  dot: { color: '#4A3A5A', fontSize: 11 },
  action: { color: '#00FFCC', fontSize: 12, fontWeight: '800' },
});
