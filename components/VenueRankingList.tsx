/**
 * VenueRankingList
 *
 * The original Explore experience — a live leaderboard of venues by headcount. It moved
 * out of ListScreen so the Explore screen can offer it as the "List" view mode alongside
 * the image feed. Behaviour is unchanged: rank, distance, headcount, flame meter, legend.
 */
import React, { useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Animated,
  RefreshControl,
} from 'react-native';
import { Flame, Navigation, Users, Calendar } from 'lucide-react-native';
import { theme } from '../config/theme';
import { LiveVenue } from '../contexts/LiveVenuesContext';

// ─── Activity config ──────────────────────────────────────────────────────────
const ACTIVITY_CONFIG = {
  Crazy:  { flames: 4, label: 'CRAZY',  glow: '#FF0055' },
  High:   { flames: 3, label: 'HIGH',   glow: '#FF5E00' },
  Medium: { flames: 2, label: 'MED',    glow: '#00FFCC' },
  Low:    { flames: 1, label: 'LOW',    glow: '#4169E1' },
  None:   { flames: 0, label: 'QUIET',  glow: '#444444' },
} as const;

// ─── Individual Venue Card ────────────────────────────────────────────────────
const VenueCard = ({
  item,
  index,
  onPress,
}: {
  item: LiveVenue;
  index: number;
  onPress: (venue: LiveVenue) => void;
}) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const isUpcoming = item.startDate && Date.now() < item.startDate;
  const config = ACTIVITY_CONFIG[isUpcoming ? 'None' : item.activityLevel];
  const color = isUpcoming ? '#666666' : item.activityColor;
  const isTop = index < 3 && !isUpcoming;

  const onPressIn = () =>
    Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 30 }).start();
  const onPressOut = () =>
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 30 }).start();

  const formatDistance = (km: number | null) => {
    if (km === null) return '— km';
    if (km < 1) return `${Math.round(km * 1000)}m`;
    return `${km.toFixed(1)}km`;
  };

  const formatStartDate = (startDate?: number) => {
    if (!startDate) return '';
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Africa/Nairobi'
    };
    return 'Starts ' + new Intl.DateTimeFormat('en-US', options).format(new Date(startDate));
  };

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={[
          styles.card,
          isTop ? { borderColor: `${color}55` } : undefined,
          isUpcoming ? styles.cardUpcoming : undefined
        ]}
        activeOpacity={1}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        onPress={() => onPress(item)}
      >
        {/* Left: rank */}
        <View style={styles.rankCol}>
          <Text style={[
            styles.rankNum,
            isTop ? { color } : undefined,
            isUpcoming ? { color: '#444' } : undefined
          ]}>
            {index + 1}
          </Text>
          {isTop && <View style={[styles.rankBar, { backgroundColor: color }]} />}
        </View>

        {/* Center: info */}
        <View style={styles.infoCol}>
          <Text style={styles.venueName} numberOfLines={1}>{item.name}</Text>
          <View style={styles.metaRow}>
            <View style={styles.metaGroup}>
              <Navigation color="#888" size={12} />
              <Text style={styles.metaText}>{formatDistance(item.distanceKm)}</Text>
            </View>
            {isUpcoming ? (
              <View style={styles.metaGroup}>
                <Calendar color="#666" size={12} />
                <Text style={styles.metaText}>{formatStartDate(item.startDate)}</Text>
              </View>
            ) : (
              <View style={styles.metaGroup}>
                <Users color="#555" size={12} />
                <Text style={styles.metaText}>{item.userCount} nearby</Text>
              </View>
            )}
          </View>
        </View>

        {/* Right: activity badge */}
        {isUpcoming ? (
          <View style={[styles.badge, { backgroundColor: '#2A2A2A15', borderColor: '#33333360' }]}>
            <Calendar color="#666" size={11} style={{ marginBottom: 4 }} />
            <Text style={[styles.badgeLabel, { color: '#666' }]}>UPCOMING</Text>
          </View>
        ) : (
          <View style={[styles.badge, { backgroundColor: `${color}15`, borderColor: `${color}60` }]}>
            {/* Flame icons */}
            <View style={styles.flameRow}>
              {Array.from({ length: 4 }).map((_, i) => (
                <Flame
                  key={i}
                  size={11}
                  color={i < config.flames ? color : '#333'}
                />
              ))}
            </View>
            <Text style={[styles.badgeLabel, { color }]}>{config.label}</Text>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
};

interface Props {
  venues: LiveVenue[];
  refreshing: boolean;
  onRefresh: () => void;
  onPressVenue: (venue: LiveVenue) => void;
  listRef?: React.RefObject<FlatList<LiveVenue> | null>;
}

export const VenueRankingList: React.FC<Props> = ({
  venues,
  refreshing,
  onRefresh,
  onPressVenue,
  listRef,
}) => {
  if (venues.length === 0) {
    return (
      <View style={styles.ctr}>
        <Text style={styles.emptyText}>No venues found for this filter</Text>
      </View>
    );
  }

  return (
    <>
      {/* Legend */}
      <View style={styles.legend}>
        {(['Crazy', 'High', 'Medium', 'Low'] as const).map((lvl) => (
          <View key={lvl} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: ACTIVITY_CONFIG[lvl].glow }]} />
            <Text style={styles.legendLabel}>{lvl}</Text>
          </View>
        ))}
      </View>

      <FlatList
        ref={listRef}
        data={venues}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <VenueCard item={item} index={index} onPress={onPressVenue} />
        )}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.accent}
            colors={[theme.accent]}
            progressBackgroundColor={theme.surface}
          />
        }
      />
    </>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  legend:       { flexDirection: 'row', paddingHorizontal: 24, gap: 16, marginBottom: 12 },
  legendItem:   { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot:    { width: 7, height: 7, borderRadius: 4 },
  legendLabel:  { color: '#666', fontSize: 12, fontWeight: '600' },
  list:         { paddingHorizontal: 16, paddingBottom: 40 },
  sep:          { height: 8 },
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    gap: 12,
  },
  rankCol:   { alignItems: 'center', width: 32 },
  rankNum:   { fontSize: 22, fontWeight: '800', color: '#444' },
  rankBar:   { width: 3, height: 16, borderRadius: 2, marginTop: 3 },
  infoCol:   { flex: 1 },
  venueName: { fontSize: 16, fontWeight: '700', color: '#F0F0F0', marginBottom: 6 },
  metaRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  metaGroup: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText:  { color: '#666', fontSize: 12, fontWeight: '500' },
  badge: {
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    minWidth: 75,
  },
  flameRow:   { flexDirection: 'row', gap: 2, marginBottom: 4 },
  badgeLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  ctr:         { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  emptyText:   { color: '#444', fontSize: 16 },
  cardUpcoming: {
    opacity: 0.55,
    borderColor: '#1A1A1A',
  },
});
