import React, { useMemo, useRef, useEffect } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Animated, PanResponder, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TrendingUp, MapPin } from 'lucide-react-native';
import { LiveVenue } from '../contexts/LiveVenuesContext';
import { nearestArea } from '../utils/nairobiAreas';

const SCREEN_HEIGHT = Dimensions.get('window').height;

interface CityPulseModalProps {
  isVisible: boolean;
  onClose: () => void;
  venues: LiveVenue[];
  totalUsersOut: number;
  onSelectVenue: (venue: LiveVenue) => void;
}

export const CityPulseModal: React.FC<CityPulseModalProps> = ({
  isVisible,
  onClose,
  venues,
  totalUsersOut,
  onSelectVenue,
}) => {
  const insets = useSafeAreaInsets();

  // "Trending" = venues gaining momentum right now. If nothing is rising (e.g. a quiet
  // afternoon), fall back to the busiest venues so the section is never empty.
  const hasRising = useMemo(
    () => venues.some((v) => v.trend === 'rising' && v.userCount > 0),
    [venues]
  );
  const trending = useMemo(() => {
    const source = hasRising
      ? venues.filter((v) => v.trend === 'rising' && v.userCount > 0)
      : venues.filter((v) => v.userCount > 0);
    return source.sort((a, b) => b.userCount - a.userCount).slice(0, 3);
  }, [venues, hasRising]);

  // Peak areas: bucket each venue's live count into its nearest Nairobi area, ranked.
  const topAreas = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const v of venues) {
      if (!v.userCount) continue;
      const area = nearestArea(v.latitude, v.longitude);
      if (!area) continue;
      totals[area] = (totals[area] || 0) + v.userCount;
    }
    return Object.entries(totals)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
  }, [venues]);

  const peak = topAreas[0];

  // Slide up on open; drag the sheet down (or fling) to dismiss, else spring back.
  // NOTE: useNativeDriver MUST be false everywhere here — we drive translateY with setValue
  // during the pan, and a native-driver-owned value won't follow those JS updates (the sheet
  // would freeze mid-drag). Keep the whole lifecycle on the JS driver so it tracks the finger.
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (isVisible) {
      translateY.setValue(SCREEN_HEIGHT);
      Animated.spring(translateY, { toValue: 0, useNativeDriver: false, bounciness: 4 }).start();
    }
  }, [isVisible, translateY]);

  const panResponder = useRef(
    PanResponder.create({
      // CRITICAL: inside an RN Modal, move-based claiming (onMoveShouldSet*) is swallowed by
      // the Modal's native root, so it never fires — this is why earlier threshold tweaks did
      // nothing. Claim on START instead (the pattern LiveFeedModal uses successfully in a
      // Modal). To keep the venue rows tappable, these handlers are attached only to the top
      // drag-handle zone, not the whole sheet — so start-claiming here has no tap to conflict.
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => {
        translateY.setValue(Math.max(0, g.dy));
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 90 || g.vy > 0.5) {
          Animated.timing(translateY, {
            toValue: SCREEN_HEIGHT,
            duration: 220,
            useNativeDriver: false,
          }).start(() => onCloseRef.current());
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: false, bounciness: 0 }).start();
        }
      },
    })
  ).current;

  return (
    <Modal visible={isVisible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        {/* Backdrop sits behind the sheet; tapping it (outside the sheet) closes. */}
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        {/* Swipe the sheet down to dismiss. */}
        <Animated.View
          style={[styles.card, { paddingBottom: insets.bottom + 24, transform: [{ translateY }] }]}
        >
          {/* Dedicated drag handle (grabber + header + hero). Claims the gesture on start,
              which is the reliable way to swipe-to-dismiss inside an RN Modal. The venue rows
              below sit outside this zone, so they stay tappable. */}
          <View {...panResponder.panHandlers}>
            <View style={styles.grabber} />
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <View style={styles.dot} />
                <Text style={styles.headerLabel}>NAIROBI LIVE</Text>
              </View>
            </View>

            {/* Hero count */}
            <Text style={styles.heroNumber}>{totalUsersOut.toLocaleString()}</Text>
            <Text style={styles.heroCaption}>people out right now</Text>
          </View>

          {/* Peak area */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <MapPin color="#00FFCC" size={15} />
              <Text style={styles.sectionTitle}>Peak area</Text>
            </View>
            {peak ? (
              <>
                <View style={styles.peakRow}>
                  <Text style={styles.peakName}>{peak.name}</Text>
                  <Text style={styles.peakCount}>{peak.count.toLocaleString()} out</Text>
                </View>
                {topAreas.slice(1).map((a) => (
                  <View key={a.name} style={styles.areaRow}>
                    <Text style={styles.areaRowName}>{a.name}</Text>
                    <Text style={styles.areaRowCount}>{a.count.toLocaleString()}</Text>
                  </View>
                ))}
              </>
            ) : (
              <Text style={styles.emptyText}>Quiet across the city right now.</Text>
            )}
          </View>

          {/* Trending venues */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <TrendingUp color="#00FFCC" size={15} />
              <Text style={styles.sectionTitle}>{hasRising ? 'Trending venues' : 'Busiest venues'}</Text>
            </View>
            {trending.length > 0 ? (
              trending.map((v, i) => (
                <TouchableOpacity
                  key={v.id}
                  style={styles.venueRow}
                  activeOpacity={0.6}
                  onPress={() => onSelectVenue(v)}
                >
                  <Text style={styles.venueRank}>{i + 1}</Text>
                  <Text style={styles.venueName} numberOfLines={1}>
                    {v.name}
                  </Text>
                  <View style={styles.venueCountWrap}>
                    {v.trend === 'rising' && <TrendingUp color="#4CD964" size={13} />}
                    <Text style={styles.venueCount}>{v.userCount.toLocaleString()}</Text>
                  </View>
                </TouchableOpacity>
              ))
            ) : (
              <Text style={styles.emptyText}>No venues buzzing yet tonight.</Text>
            )}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  card: {
    backgroundColor: '#121212',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 22,
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: '#2A2A2A',
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#3A3A3A',
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF2D55',
  },
  headerLabel: {
    color: '#00FFCC',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  heroNumber: {
    color: '#FFFFFF',
    fontSize: 44,
    fontWeight: '800',
    marginTop: 18,
    letterSpacing: -1,
  },
  heroCaption: {
    color: '#888',
    fontSize: 14,
    marginTop: 2,
  },
  section: {
    marginTop: 26,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 12,
  },
  sectionTitle: {
    color: '#AAA',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  peakRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  peakName: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
  },
  peakCount: {
    color: '#00FFCC',
    fontSize: 14,
    fontWeight: '700',
  },
  areaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  areaRowName: {
    color: '#BBB',
    fontSize: 15,
  },
  areaRowCount: {
    color: '#888',
    fontSize: 15,
    fontWeight: '600',
  },
  venueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#242424',
  },
  venueRank: {
    color: '#555',
    fontSize: 14,
    fontWeight: '800',
    width: 22,
  },
  venueName: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },
  venueCountWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  venueCount: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  emptyText: {
    color: '#777',
    fontSize: 14,
  },
});
