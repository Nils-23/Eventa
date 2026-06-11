import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  StatusBar,
  ActivityIndicator,
  Animated,
  ScrollView,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Flame, Navigation, Users, Search, Calendar } from 'lucide-react-native';
import { useLiveVenues, LiveVenue as VenueWithDensity } from '../hooks/useLiveVenues';
import { useNavigation } from '@react-navigation/native';
import { useAppStore } from '../hooks/useAppStore';

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
}: {
  item: VenueWithDensity;
  index: number;
}) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const isUpcoming = (item.type === 'Activity' || item.type === 'Event') && item.startDate && Date.now() < item.startDate;
  const config = ACTIVITY_CONFIG[isUpcoming ? 'None' : item.activityLevel];
  const color = isUpcoming ? '#666666' : item.activityColor;
  const isTop = index < 3 && !isUpcoming;
  const navigation = useNavigation<any>();
  const { setSelectedMapVenue } = useAppStore();

  const onPressIn = () =>
    Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 30 }).start();
  const onPressOut = () =>
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 30 }).start();
    
  const handlePress = () => {
    setSelectedMapVenue(item);
    navigation.navigate('Map');
  };

  const formatDistance = (km: number | null) => {
    if (km === null) return '— km';
    if (km < 1) return `${Math.round(km * 1000)}m`;
    return `${km.toFixed(1)}km`;
  };

  const formatStartDate = (startDate?: number) => {
    if (!startDate) return '';
    const date = new Date(startDate);
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Africa/Nairobi'
    };
    return 'Starts ' + new Intl.DateTimeFormat('en-US', options).format(date);
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
        onPress={handlePress}
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
          <View style={[styles.badge, { backgroundColor: '#22222215', borderColor: '#33333360' }]}>
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

// ─── Screen ───────────────────────────────────────────────────────────────────
export const ListScreen = () => {
  const { venues, scheduledVenues, isLoading } = useLiveVenues();
  const [selectedFilter, setSelectedFilter] = useState<'All' | 'Club' | 'Bar' | 'Activity' | 'Event'>('All');
  const [searchQuery, setSearchQuery] = useState('');

  const combinedVenues = [...venues, ...scheduledVenues];

  const filteredVenues = combinedVenues.filter((v) => 
    (selectedFilter === 'All' || v.type === selectedFilter) &&
    v.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0A0A" />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Live Rankings</Text>
          <Text style={styles.headerSub}>Updated in real‑time · Nairobi</Text>
        </View>
        <View style={styles.livePill}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <Search color="#666" size={18} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search venues..."
          placeholderTextColor="#666"
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
      </View>

      {/* Filter Row */}
      <View style={styles.filterContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          {(['All', 'Club', 'Bar', 'Activity', 'Event'] as const).map((filter) => (
            <TouchableOpacity
              key={filter}
              style={[styles.filterPill, selectedFilter === filter && styles.filterPillActive]}
              onPress={() => setSelectedFilter(filter)}
            >
              <Text style={[styles.filterPillText, selectedFilter === filter && styles.filterPillTextActive]}>
                {filter}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        {(['Crazy', 'High', 'Medium', 'Low'] as const).map((lvl) => (
          <View key={lvl} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: ACTIVITY_CONFIG[lvl].glow }]} />
            <Text style={styles.legendLabel}>{lvl}</Text>
          </View>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.ctr}>
          <ActivityIndicator color="#00FFCC" size="large" />
          <Text style={styles.loadingText}>Scanning Nairobi…</Text>
        </View>
      ) : filteredVenues.length === 0 ? (
        <View style={styles.ctr}>
          <Text style={styles.emptyText}>No venues found for this filter</Text>
        </View>
      ) : (
        <FlatList
          data={filteredVenues}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => <VenueCard item={item} index={index} />}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      )}
    </SafeAreaView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#0A0A0A' },
  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16 },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#131313',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#232323',
    marginHorizontal: 24,
    marginBottom: 16,
    paddingHorizontal: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 44,
    color: '#FFFFFF',
    fontSize: 14,
  },
  headerTitle:  { fontSize: 28, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5 },
  headerSub:    { fontSize: 13, color: '#555', marginTop: 3 },
  livePill:     { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1A1A1A', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, gap: 5, borderWidth: 1, borderColor: '#2A2A2A' },
  liveDot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FF0055' },
  liveText:     { color: '#FF0055', fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  legend:       { flexDirection: 'row', paddingHorizontal: 24, gap: 16, marginBottom: 12 },
  legendItem:   { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot:    { width: 7, height: 7, borderRadius: 4 },
  legendLabel:  { color: '#666', fontSize: 12, fontWeight: '600' },
  filterContainer: { marginBottom: 12 },
  filterScroll: { paddingHorizontal: 24, gap: 8 },
  filterPill: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#333',
  },
  filterPillActive: {
    backgroundColor: 'rgba(0, 255, 204, 0.15)',
    borderColor: '#00FFCC',
  },
  filterPillText: {
    color: '#888',
    fontSize: 13,
    fontWeight: '600',
  },
  filterPillTextActive: {
    color: '#00FFCC',
  },
  list:         { paddingHorizontal: 16, paddingBottom: 40 },
  sep:          { height: 8 },
  card: {
    backgroundColor: '#131313',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#232323',
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
  loadingText: { color: '#555', fontSize: 14 },
  emptyText:   { color: '#444', fontSize: 16 },
  cardUpcoming: {
    opacity: 0.55,
    borderColor: '#1e1e1e',
  },
});
