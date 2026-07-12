import React, { useLayoutEffect, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Share,
  Linking,
  StatusBar,
  Dimensions,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Calendar, Navigation, MapPin, Share as ShareIcon, Ticket, Clock, Info, MessageSquare, Users, BadgeCheck, Star, CheckCircle2 } from 'lucide-react-native';
import Toast from 'react-native-toast-message';
import { LiveVenue, useLiveVenues } from '../hooks/useLiveVenues';
import { VenueImage } from '../components/VenueImage';
import { VenueChat } from '../components/VenueChat';
import { useAppStore } from '../hooks/useAppStore';
import { useCreatorStatus } from '../hooks/useCreatorStatus';
import {
  CreatorAttendance, subscribeCreatorsAttending, markGoing, cancelGoing,
} from '../services/creatorService';

const { width } = Dimensions.get('window');

export const EventDetailScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const { event: eventParam } = route.params as { event: LiveVenue };
  const setSelectedMapVenue = useAppStore((s) => s.setSelectedMapVenue);
  const user = useAppStore((s) => s.user);
  const [isChatVisible, setIsChatVisible] = useState(false);

  // The route param is a snapshot from navigation time; re-resolve against the
  // live venues list so attendance stays current while this screen is open.
  const { venues } = useLiveVenues();
  const event = venues.find((v) => v.id === eventParam.id) ?? eventParam;

  const isOngoing = event.startDate ? Date.now() >= event.startDate : false;

  // ── Creator Program: "I'm Going" + Creators Attending ─────────────────────
  // The section is visible to everyone; the button only to approved creators.
  const { isCreator, creatorProfile } = useCreatorStatus();
  const [creatorsAttending, setCreatorsAttending] = useState<CreatorAttendance[]>([]);
  const [togglingGoing, setTogglingGoing] = useState(false);

  useEffect(() => {
    const unsub = subscribeCreatorsAttending(event.id, setCreatorsAttending);
    return unsub;
  }, [event.id]);

  const iAmGoing = !!user && creatorsAttending.some((c) => c.userId === user.uid);

  const handleToggleGoing = async () => {
    if (!user?.uid || !creatorProfile || togglingGoing) return;
    setTogglingGoing(true);
    try {
      if (iAmGoing) {
        await cancelGoing(event.id, user.uid);
        Toast.show({ type: 'success', text1: 'Removed from Creators Attending' });
      } else {
        await markGoing(event.id, event.name, user.uid, creatorProfile);
        Toast.show({
          type: 'success',
          text1: "You're on the list!",
          text2: 'Your attendance is verified when you arrive at the event.',
        });
      }
    } catch (err: any) {
      Toast.show({ type: 'error', text1: 'Something went wrong', text2: err.message });
    } finally {
      setTogglingGoing(false);
    }
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: false,
    });
  }, [navigation]);

  const handleBack = () => {
    navigation.goBack();
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Check out ${event.name} on Eventas!\n\nhttps://eventas.live/venue/${event.id}`,
      });
    } catch (error) {
      console.error(error);
    }
  };

  const handleViewOnMap = () => {
    setSelectedMapVenue(event);
    navigation.navigate('Main', { screen: 'Map' });
  };

  const handleTickets = () => {
    if (event.ticketLink) {
      Linking.openURL(event.ticketLink).catch(err => console.error("Couldn't load page", err));
    }
  };

  const formatStartDate = (timestamp?: number) => {
    if (!timestamp) return 'TBA';
    const date = new Date(timestamp);
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      timeZone: 'Africa/Nairobi'
    };
    return new Intl.DateTimeFormat('en-US', options).format(date);
  };

  const formatTimeRange = (start?: number, end?: number) => {
    if (!start) return 'TBA';
    const options: Intl.DateTimeFormatOptions = {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Africa/Nairobi'
    };
    const formatter = new Intl.DateTimeFormat('en-US', options);
    
    const startStr = formatter.format(new Date(start));
    if (!end) return startStr;
    
    const endStr = formatter.format(new Date(end));
    return `${startStr} - ${endStr}`;
  };

  const formatDistance = (km: number | null) => {
    if (km === null) return 'Distance unknown';
    if (km < 1) return `${Math.round(km * 1000)}m away`;
    return `${km.toFixed(1)}km away`;
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false} bounces={false}>
        {/* Hero Section */}
        <View style={styles.heroContainer}>
          <VenueImage venue={event} style={styles.heroImage} />
          
          {/* Glassmorphism gradient overlay */}
          <View style={styles.heroOverlay} />
          
          <SafeAreaView edges={['top']} style={styles.headerSafeArea}>
            <View style={styles.headerActions}>
              <TouchableOpacity onPress={handleBack} style={styles.iconButton}>
                <ArrowLeft color="#FFFFFF" size={24} />
              </TouchableOpacity>
              <TouchableOpacity onPress={handleShare} style={styles.iconButton}>
                <ShareIcon color="#FFFFFF" size={20} />
              </TouchableOpacity>
            </View>
          </SafeAreaView>

          <View style={styles.heroContent}>
            <View style={[styles.badge, isOngoing && styles.badgeOngoing]}>
              <Text style={[styles.badgeText, isOngoing && styles.badgeTextOngoing]}>
                {isOngoing ? 'ONGOING EVENT' : 'UPCOMING EVENT'}
              </Text>
            </View>
            <Text style={styles.title}>{event.name}</Text>
          </View>
        </View>

        {/* Info Cards */}
        <View style={styles.content}>
          {/* Date & Time Card */}
          <View style={styles.card}>
            <View style={styles.cardRow}>
              <View style={styles.iconContainer}>
                <Calendar color="#00FFCC" size={20} />
              </View>
              <View style={styles.cardTextContainer}>
                <Text style={styles.cardTitle}>{formatStartDate(event.startDate)}</Text>
                <Text style={styles.cardSubtitle}>Mark your calendar</Text>
              </View>
            </View>
            <View style={styles.divider} />
            <View style={styles.cardRow}>
              <View style={styles.iconContainer}>
                <Clock color="#00FFCC" size={20} />
              </View>
              <View style={styles.cardTextContainer}>
                <Text style={styles.cardTitle}>{formatTimeRange(event.startDate, event.expirationDate)}</Text>
                <Text style={styles.cardSubtitle}>Local time in Nairobi</Text>
              </View>
            </View>
          </View>

          {/* Location Card */}
          <View style={styles.card}>
            <View style={styles.cardRow}>
              <View style={styles.iconContainer}>
                <MapPin color="#00FFCC" size={20} />
              </View>
              <View style={styles.cardTextContainer}>
                <Text style={styles.cardTitle}>{event.address || "Nairobi"}</Text>
                <Text style={styles.cardSubtitle}>{formatDistance(event.distanceKm)}</Text>
              </View>
            </View>
          </View>

          {/* Live Activity Card — only meaningful once the event has started */}
          {isOngoing && (
            <View style={[styles.card, { borderColor: `${event.activityColor}40`, borderWidth: 1 }]}>
              <View style={styles.cardRow}>
                <View style={[styles.iconContainer, { backgroundColor: `${event.activityColor}20` }]}>
                  <Users color={event.activityColor} size={20} />
                </View>
                <View style={styles.cardTextContainer}>
                  <Text style={[styles.cardTitle, { color: event.activityColor }]}>
                    {event.userCount > 0 ? `${event.userCount} people here now` : 'Quiet right now'}
                  </Text>
                  <Text style={styles.cardSubtitle}>
                    {event.activityLevel === 'None' ? 'Be the first to show up' : `Activity level: ${event.activityLevel}`}
                  </Text>
                </View>
              </View>
            </View>
          )}

          {/* Ticket Card (If available) */}
          {(event.ticketLink || event.price) && (
            <View style={[styles.card, { borderColor: 'rgba(255, 0, 204, 0.3)', borderWidth: 1 }]}>
              <View style={styles.cardRow}>
                <View style={[styles.iconContainer, { backgroundColor: 'rgba(255, 0, 204, 0.15)' }]}>
                  <Ticket color="#FF00CC" size={20} />
                </View>
                <View style={styles.cardTextContainer}>
                  <Text style={[styles.cardTitle, { color: '#FF00CC' }]}>
                    {event.price ? event.price : "Tickets Available"}
                  </Text>
                  <Text style={styles.cardSubtitle}>Secure your spot</Text>
                </View>
                {event.ticketLink && (
                  <TouchableOpacity onPress={handleTickets} style={[styles.smallMapButton, { backgroundColor: '#FF00CC' }]}>
                    <Text style={styles.smallMapButtonText}>BUY</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          {/* Creators Attending — visible to all users */}
          {(creatorsAttending.length > 0 || isCreator) && (
            <View style={[styles.card, { borderColor: 'rgba(255, 215, 0, 0.25)', borderWidth: 1 }]}>
              <View style={styles.creatorsHeader}>
                <Star color="#FFD700" size={18} />
                <Text style={styles.creatorsTitle}>Creators Attending</Text>
                {creatorsAttending.length > 0 && (
                  <Text style={styles.creatorsCount}>{creatorsAttending.length}</Text>
                )}
              </View>
              {creatorsAttending.length === 0 ? (
                <Text style={styles.creatorsEmpty}>No creators have confirmed yet — be the first.</Text>
              ) : (
                creatorsAttending.map((c) => (
                  <View key={c.userId} style={styles.creatorRow}>
                    <BadgeCheck color="#00FFCC" size={16} />
                    <Text style={styles.creatorRowName} numberOfLines={1}>{c.creatorName}</Text>
                    <Text style={styles.creatorRowCategory}>{c.category}</Text>
                    {c.verified && (
                      <View style={styles.verifiedChip}>
                        <CheckCircle2 color="#00FFCC" size={11} />
                        <Text style={styles.verifiedChipText}>HERE</Text>
                      </View>
                    )}
                  </View>
                ))
              )}
              {isCreator && (
                <TouchableOpacity
                  style={[styles.goingButton, iAmGoing && styles.goingButtonActive]}
                  onPress={handleToggleGoing}
                  disabled={togglingGoing}
                >
                  <Star color={iAmGoing ? '#121212' : '#FFD700'} size={16} />
                  <Text style={[styles.goingButtonText, iAmGoing && styles.goingButtonTextActive]}>
                    {iAmGoing ? "You're Going ✓" : "I'm Going"}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Description */}
          {event.description ? (
            <View style={styles.descriptionContainer}>
              <Text style={styles.sectionTitle}>About</Text>
              <Text style={styles.description}>{event.description}</Text>
            </View>
          ) : null}

        </View>
      </ScrollView>

      {/* Live Venue Chat Modal */}
      <VenueChat
        isVisible={isChatVisible}
        onClose={() => setIsChatVisible(false)}
        venueId={event.id}
        venueName={event.name}
      />

      {/* Floating Action Bar */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom || 24, flexDirection: 'row', gap: 12 }]}>
        <TouchableOpacity style={[styles.primaryButton, { flex: 1, backgroundColor: '#222' }]} onPress={() => setIsChatVisible(true)}>
          <MessageSquare color="#00FFCC" size={20} style={{ marginRight: 8 }} />
          <Text style={[styles.primaryButtonText, { color: '#00FFCC' }]}>Live Chat</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.primaryButton, { flex: 1 }]} onPress={handleViewOnMap}>
          <MapPin color="#121212" size={20} strokeWidth={2.5} style={{ marginRight: 8 }} />
          <Text style={styles.primaryButtonText}>View Map</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  heroContainer: {
    width: '100%',
    height: 380,
    position: 'relative',
  },
  heroImage: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10, 10, 10, 0.5)', // Darken image slightly
    // A linear gradient from top (dark for header) to bottom (dark for blending into background) would be ideal,
    // but using a static color overlay gives the text contrast for now.
  },
  headerSafeArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  headerActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  heroContent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 24,
    paddingBottom: 30,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0, 255, 204, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 204, 0.3)',
  },
  badgeOngoing: {
    backgroundColor: 'rgba(255, 45, 85, 0.15)',
    borderColor: 'rgba(255, 45, 85, 0.3)',
  },
  badgeText: {
    color: '#00FFCC',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  badgeTextOngoing: {
    color: '#FF2D55',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  content: {
    padding: 20,
    marginTop: -20, // Overlap the hero slightly
    backgroundColor: '#121212',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0, 255, 204, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  cardTextContainer: {
    flex: 1,
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  cardSubtitle: {
    color: '#888888',
    fontSize: 13,
    fontWeight: '500',
  },
  divider: {
    height: 1,
    backgroundColor: '#2A2A2A',
    marginVertical: 16,
    marginLeft: 64, // Align with text
  },
  smallMapButton: {
    backgroundColor: '#00FFCC',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  smallMapButtonText: {
    color: '#121212',
    fontSize: 12,
    fontWeight: '800',
    marginLeft: 4,
    letterSpacing: 0.5,
  },
  creatorsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  creatorsTitle: {
    color: '#FFD700',
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  creatorsCount: {
    color: '#FFD700',
    fontSize: 13,
    fontWeight: '800',
    backgroundColor: 'rgba(255, 215, 0, 0.12)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  creatorsEmpty: {
    color: '#777',
    fontSize: 13,
    fontStyle: 'italic',
  },
  creatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
  },
  creatorRowName: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
  },
  creatorRowCategory: {
    color: '#777',
    fontSize: 12,
    flex: 1,
  },
  verifiedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 204, 0.4)',
    backgroundColor: 'rgba(0, 255, 204, 0.08)',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  verifiedChipText: {
    color: '#00FFCC',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  goingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.5)',
    backgroundColor: 'rgba(255, 215, 0, 0.08)',
    borderRadius: 12,
    paddingVertical: 12,
  },
  goingButtonActive: {
    backgroundColor: '#FFD700',
    borderColor: '#FFD700',
  },
  goingButtonText: {
    color: '#FFD700',
    fontSize: 14,
    fontWeight: '800',
  },
  goingButtonTextActive: {
    color: '#121212',
  },
  descriptionContainer: {
    marginTop: 10,
    marginBottom: 40,
    paddingHorizontal: 4,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 12,
  },
  description: {
    color: '#AAAAAA',
    fontSize: 15,
    lineHeight: 24,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(10, 10, 10, 0.9)',
    paddingHorizontal: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#2A2A2A',
  },
  primaryButton: {
    backgroundColor: '#00FFCC',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 56,
    borderRadius: 28,
    shadowColor: '#00FFCC',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  primaryButtonText: {
    color: '#121212',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
