/**
 * ExploreScreen
 *
 * Replaces the old ranking-only Explore tab. Two view modes share one header, one filter
 * row and one search box:
 *
 *   Feed  — full-bleed image cards, one thing per card. The default.
 *   List  — the original live leaderboard (VenueRankingList), unchanged.
 *
 * The mode is remembered across launches, so anyone who prefers the leaderboard keeps it.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  StatusBar,
  ActivityIndicator,
  ScrollView,
  TextInput,
  RefreshControl,
  Dimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Search, X, List, Image as ImageIcon } from 'lucide-react-native';
import { theme } from '../config/theme';
import { LiveVenue } from '../contexts/LiveVenuesContext';
import { useLiveVenues } from '../hooks/useLiveVenues';
import {
  EXPLORE_FILTERS,
  ExploreFeedItem,
  ExploreFilter,
  filterVenuesForList,
  useExploreFeed,
} from '../hooks/useExploreFeed';
import { useAppStore } from '../hooks/useAppStore';
import { ExploreFeedCard } from '../components/ExploreFeedCard';
import { VenueRankingList } from '../components/VenueRankingList';

// Tall enough to dominate the screen, short enough that the next card always peeks
// above the tab bar — that peek is what makes the surface read as scrollable.
const SCREEN_HEIGHT = Dimensions.get('window').height;
const CARD_HEIGHT = Math.round(Math.min(SCREEN_HEIGHT * 0.58, 520));
const CARD_GAP = 14;

const VIEW_MODE_KEY = 'eventas_explore_view_mode';
type ViewMode = 'feed' | 'list';

export const ExploreScreen = () => {
  const navigation = useNavigation<any>();
  const { venues, scheduledVenues } = useLiveVenues();
  const setSelectedMapVenue = useAppStore((s) => s.setSelectedMapVenue);

  const [viewMode, setViewMode] = useState<ViewMode>('feed');
  const [selectedFilter, setSelectedFilter] = useState<ExploreFilter>('Trending');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const feedRef = useRef<FlatList<ExploreFeedItem>>(null);
  const listRef = useRef<FlatList<LiveVenue>>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { items, isLoading } = useExploreFeed({
    filter: selectedFilter,
    search: searchQuery,
    refreshKey,
  });

  const listVenues = useMemo(
    () => filterVenuesForList(venues, scheduledVenues, selectedFilter, searchQuery),
    [venues, scheduledVenues, selectedFilter, searchQuery]
  );

  useEffect(() => {
    AsyncStorage.getItem(VIEW_MODE_KEY)
      .then((stored) => {
        if (stored === 'feed' || stored === 'list') setViewMode(stored);
      })
      .catch(() => {});
  }, []);

  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
  }, []);

  const changeViewMode = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    AsyncStorage.setItem(VIEW_MODE_KEY, mode).catch(() => {});
  }, []);

  // Venue data streams in continuously, so there is nothing to re-fetch — but in the
  // feed a refresh does real work: it re-ranks the order, which is otherwise frozen so
  // cards can't reshuffle mid-scroll. The short spin acknowledges the gesture.
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => setRefreshing(false), 600);
  }, []);

  // Pressing the Explore tab while already on it returns to the top with a fresh ranking.
  useEffect(() => {
    const unsubscribe = navigation.addListener('tabPress', () => {
      feedRef.current?.scrollToOffset({ offset: 0, animated: true });
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
      setRefreshKey((k) => k + 1);
    });
    return unsubscribe;
  }, [navigation]);

  const handlePressVenue = useCallback(
    (venue: LiveVenue) => {
      if (venue.type === 'Event') {
        navigation.navigate('EventDetail', { event: venue });
      } else {
        setSelectedMapVenue(venue);
        navigation.navigate('Map');
      }
    },
    [navigation, setSelectedMapVenue]
  );

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery('');
  }, []);

  const renderFeedItem = useCallback(
    ({ item }: { item: ExploreFeedItem }) => (
      <ExploreFeedCard item={item} height={CARD_HEIGHT} onPress={handlePressVenue} />
    ),
    [handlePressVenue]
  );

  // Every feed card is the same height, so the list can skip measurement entirely.
  const getItemLayout = useCallback(
    (_: ArrayLike<ExploreFeedItem> | null | undefined, index: number) => ({
      length: CARD_HEIGHT + CARD_GAP,
      offset: (CARD_HEIGHT + CARD_GAP) * index,
      index,
    }),
    []
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={theme.background} />

      {/* Header: title + search toggle + view mode. The old "Live Rankings / Updated in
          real-time · Nairobi" block and the activity legend are gone from feed mode —
          a surface that needs a key to be read isn't an explore surface. */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Explore</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
            hitSlop={8}
          >
            {searchOpen ? <X color={theme.textMuted} size={20} /> : <Search color={theme.textMuted} size={20} />}
          </TouchableOpacity>

          <View style={styles.segmented}>
            <TouchableOpacity
              style={[styles.segment, viewMode === 'feed' && styles.segmentActive]}
              onPress={() => changeViewMode('feed')}
              hitSlop={6}
            >
              <ImageIcon color={viewMode === 'feed' ? theme.accent : theme.textMuted} size={17} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.segment, viewMode === 'list' && styles.segmentActive]}
              onPress={() => changeViewMode('list')}
              hitSlop={6}
            >
              <List color={viewMode === 'list' ? theme.accent : theme.textMuted} size={17} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {searchOpen && (
        <View style={styles.searchContainer}>
          <Search color={theme.textMuted} size={18} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search venues..."
            placeholderTextColor={theme.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoFocus
            clearButtonMode="while-editing"
          />
        </View>
      )}

      <View style={styles.filterContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterScroll}
        >
          {EXPLORE_FILTERS.map((filter) => (
            <TouchableOpacity
              key={filter}
              style={[styles.filterPill, selectedFilter === filter && styles.filterPillActive]}
              onPress={() => setSelectedFilter(filter)}
            >
              <Text
                style={[
                  styles.filterPillText,
                  selectedFilter === filter && styles.filterPillTextActive,
                ]}
              >
                {filter}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {isLoading ? (
        <View style={styles.ctr}>
          <ActivityIndicator color={theme.accent} size="large" />
          <Text style={styles.loadingText}>Scanning Nairobi…</Text>
        </View>
      ) : viewMode === 'list' ? (
        <VenueRankingList
          venues={listVenues}
          refreshing={refreshing}
          onRefresh={onRefresh}
          onPressVenue={handlePressVenue}
          listRef={listRef}
        />
      ) : items.length === 0 ? (
        <View style={styles.ctr}>
          <Text style={styles.emptyText}>Nothing here yet</Text>
          <Text style={styles.emptySub}>Try another filter, or check the map</Text>
        </View>
      ) : (
        <FlatList
          ref={feedRef}
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderFeedItem}
          getItemLayout={getItemLayout}
          contentContainerStyle={styles.feed}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: CARD_GAP }} />}
          initialNumToRender={3}
          maxToRenderPerBatch={3}
          windowSize={5}
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
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
  },
  headerTitle: { fontSize: 26, fontWeight: '800', color: theme.textPrimary, letterSpacing: -0.5 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: theme.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 2,
    gap: 2,
  },
  segment: {
    width: 34,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  segmentActive: { backgroundColor: 'rgba(0, 255, 204, 0.15)' },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 12,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, height: 44, color: theme.textPrimary, fontSize: 14 },
  filterContainer: { marginBottom: 12 },
  filterScroll: { paddingHorizontal: 20, gap: 8 },
  filterPill: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: '#333',
  },
  filterPillActive: {
    backgroundColor: 'rgba(0, 255, 204, 0.15)',
    borderColor: theme.accent,
  },
  filterPillText: { color: theme.textMuted, fontSize: 13, fontWeight: '600' },
  filterPillTextActive: { color: theme.accent },
  feed: { paddingHorizontal: 16, paddingBottom: 40 },
  ctr: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  loadingText: { color: '#555', fontSize: 14 },
  emptyText: { color: theme.textSecondary, fontSize: 17, fontWeight: '600' },
  emptySub: { color: '#555', fontSize: 13 },
});
