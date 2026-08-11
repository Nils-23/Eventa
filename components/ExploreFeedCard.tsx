/**
 * ExploreFeedCard
 *
 * One full-bleed card in the Explore feed. Strict text budget: a single pill, a title,
 * and one meta line. Everything the old ranking row spelled out (rank, flame meter,
 * activity label, headcount, distance) is either implicit in feed position or folded
 * into those three elements.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Calendar, Ticket } from 'lucide-react-native';
import { theme } from '../config/theme';
import { LiveVenue } from '../contexts/LiveVenuesContext';
import { ExploreFeedItem } from '../hooks/useExploreFeed';
import { nearestArea } from '../utils/nairobiAreas';
import { VenueImage } from './VenueImage';

const QUIET_COLOR = '#8E8E93';

function formatDistance(km: number | null): string | null {
  if (km === null) return null;
  if (km < 1) return `${Math.round(km * 1000)}m`;
  return `${km.toFixed(1)}km`;
}

// The card says how a place *feels*, not what its activity enum is. "Buzzing" needs no
// legend; "HIGH" with three of four flames did.
function vibeLabel(v: LiveVenue): string {
  if (v.userCount === 0) return 'Quiet right now';
  if (v.trend === 'rising') return 'Filling up';
  if (v.trend === 'falling') return 'Winding down';
  switch (v.activityLevel) {
    case 'Crazy':
      return 'Packed';
    case 'High':
      return 'Buzzing';
    case 'Medium':
      return 'Good crowd';
    default:
      return 'Just getting started';
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

function formatStart(startDate?: number): string {
  if (!startDate) return 'Upcoming';
  const withinWeek = startDate - Date.now() < 7 * DAY_MS;
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    ...(withinWeek ? {} : { month: 'short', day: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Africa/Nairobi',
  }).format(new Date(startDate));
}

interface Props {
  item: ExploreFeedItem;
  height: number;
  onPress: (venue: LiveVenue) => void;
}

const ExploreFeedCardBase: React.FC<Props> = ({ item, height, onPress }) => {
  const { venue } = item;
  const scaleAnim = React.useRef(new Animated.Value(1)).current;

  const isUpcoming = item.kind === 'upcoming';
  const isQuiet = venue.userCount === 0;
  const accent = isUpcoming ? theme.accent : isQuiet ? QUIET_COLOR : venue.activityColor;

  const area = nearestArea(venue.latitude, venue.longitude);
  const distance = formatDistance(venue.distanceKm);
  const meta = isUpcoming
    ? [area, distance, venue.price || (venue.ticketLink ? 'Tickets available' : null)]
    : [area, distance, vibeLabel(venue)];
  const metaLine = meta.filter(Boolean).join('  ·  ');

  const onPressIn = () =>
    Animated.spring(scaleAnim, { toValue: 0.98, useNativeDriver: true, speed: 30 }).start();
  const onPressOut = () =>
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 30 }).start();

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={[styles.card, { height }]}
        activeOpacity={1}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        onPress={() => onPress(venue)}
      >
        <VenueImage
          venue={{ id: venue.id, imageUrl: venue.imageUrl, type: venue.type, category: venue.category }}
          style={StyleSheet.absoluteFillObject}
          isHero
        />

        {/* The one pill: live headcount, or the start time for something upcoming. */}
        <View style={[styles.pill, { borderColor: `${accent}80`, backgroundColor: `${accent}22` }]}>
          {isUpcoming ? (
            <Calendar color={accent} size={12} />
          ) : (
            <View style={[styles.dot, { backgroundColor: accent }]} />
          )}
          <Text style={[styles.pillText, { color: accent }]} numberOfLines={1}>
            {isUpcoming
              ? formatStart(venue.startDate)
              : isQuiet
              ? 'Quiet'
              : `${venue.userCount} here now`}
          </Text>
        </View>

        {isUpcoming && venue.ticketLink ? (
          <View style={styles.ticketBadge}>
            <Ticket color={theme.textPrimary} size={13} />
          </View>
        ) : null}

        <View style={styles.footer}>
          <Text style={styles.title} numberOfLines={1}>
            {venue.name}
          </Text>
          {metaLine ? (
            <Text style={styles.meta} numberOfLines={1}>
              {metaLine}
            </Text>
          ) : null}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

// Counts stream in every ~2s. Re-render only when something the card actually draws
// changed — otherwise every visible card re-renders on every tick of every venue.
export const ExploreFeedCard = React.memo(ExploreFeedCardBase, (a, b) => {
  const va = a.item.venue;
  const vb = b.item.venue;
  return (
    a.item.id === b.item.id &&
    a.height === b.height &&
    va.userCount === vb.userCount &&
    va.activityLevel === vb.activityLevel &&
    va.activityColor === vb.activityColor &&
    va.trend === vb.trend &&
    va.distanceKm === vb.distanceKm &&
    va.imageUrl === vb.imageUrl &&
    va.name === vb.name &&
    va.price === vb.price &&
    va.startDate === vb.startDate &&
    va.ticketLink === vb.ticketLink
  );
});

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: theme.surface,
    justifyContent: 'flex-end',
  },
  pill: {
    position: 'absolute',
    top: 14,
    left: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    maxWidth: '75%',
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  pillText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
  ticketBadge: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  footer: { padding: 18 },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: theme.textPrimary,
    letterSpacing: -0.5,
  },
  meta: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.72)',
    marginTop: 5,
  },
});
