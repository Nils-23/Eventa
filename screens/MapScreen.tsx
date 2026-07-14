import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import * as Location from 'expo-location';
import { StyleSheet, View, Text, TouchableOpacity, Alert, Platform, AppState, Animated, PanResponder } from 'react-native';
import MapView, { PROVIDER_GOOGLE, MarkerAnimated, Heatmap, MapPressEvent } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LocateFixed, MapPin, Flag, MessageSquare, Users, Navigation as NavigationIcon, TrendingUp, TrendingDown } from 'lucide-react-native';
import { theme } from '../config/theme';
import { createReport } from '../services/reportService';
import { useLiveVenues, LiveVenue as LiveVenue } from '../hooks/useLiveVenues';
import * as ImagePicker from 'expo-image-picker';
import Toast from 'react-native-toast-message';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import { useStories } from '../hooks/useStories';
import { StoryViewer } from '../components/StoryViewer';
import { StoriesTray } from '../components/StoriesTray';
import { uploadStoryMedia, createStory, deleteStory } from '../services/storyService';
import { getDistanceInMeters } from '../utils/locationUtils';
import { useAppStore } from '../hooks/useAppStore';
import { VenueChat } from '../components/VenueChat';
import { VenueImage } from '../components/VenueImage';
import { LiveFeedModal } from '../components/LiveFeedModal';
import { CityPulseModal } from '../components/CityPulseModal';
import { getFriendlyErrorMessage } from '../utils/errorUtils';

const DARK_MAP_STYLE = [
  {
    "elementType": "geometry",
    "stylers": [
      {
        "color": "#212121"
      }
    ]
  },
  {
    "elementType": "labels.icon",
    "stylers": [
      {
        "visibility": "off"
      }
    ]
  },
  {
    "elementType": "labels.text.fill",
    "stylers": [
      {
        "color": "#757575"
      }
    ]
  },
  {
    "elementType": "labels.text.stroke",
    "stylers": [
      {
        "color": "#212121"
      }
    ]
  },
  {
    "featureType": "administrative",
    "elementType": "geometry",
    "stylers": [
      {
        "color": "#757575"
      }
    ]
  },
  {
    "featureType": "administrative.country",
    "elementType": "labels.text.fill",
    "stylers": [
      {
        "color": "#9e9e9e"
      }
    ]
  },
  {
    "featureType": "administrative.land_parcel",
    "stylers": [
      {
        "visibility": "off"
      }
    ]
  },
  {
    "featureType": "administrative.locality",
    "elementType": "labels.text.fill",
    "stylers": [
      {
        "color": "#bdbdbd"
      }
    ]
  },
  {
    "featureType": "poi",
    "elementType": "labels.text.fill",
    "stylers": [
      {
        "color": "#757575"
      }
    ]
  },
  {
    "featureType": "poi.park",
    "elementType": "geometry",
    "stylers": [
      {
        "color": "#181818"
      }
    ]
  },
  {
    "featureType": "poi.park",
    "elementType": "labels.text.fill",
    "stylers": [
      {
        "color": "#616161"
      }
    ]
  },
  {
    "featureType": "poi.park",
    "elementType": "labels.text.stroke",
    "stylers": [
      {
        "color": "#1b1b1b"
      }
    ]
  },
  {
    "featureType": "road",
    "elementType": "geometry.fill",
    "stylers": [
      {
        "color": "#2c2c2c"
      }
    ]
  },
  {
    "featureType": "road",
    "elementType": "labels.text.fill",
    "stylers": [
      {
        "color": "#8a8a8a"
      }
    ]
  },
  {
    "featureType": "road.arterial",
    "elementType": "geometry",
    "stylers": [
      {
        "color": "#373737"
      }
    ]
  },
  {
    "featureType": "road.highway",
    "elementType": "geometry",
    "stylers": [
      {
        "color": "#3c3c3c"
      }
    ]
  },
  {
    "featureType": "road.highway.controlled_access",
    "elementType": "geometry",
    "stylers": [
      {
        "color": "#4e4e4e"
      }
    ]
  },
  {
    "featureType": "road.local",
    "elementType": "labels.text.fill",
    "stylers": [
      {
        "color": "#616161"
      }
    ]
  },
  {
    "featureType": "transit",
    "elementType": "labels.text.fill",
    "stylers": [
      {
        "color": "#757575"
      }
    ]
  },
  {
    "featureType": "water",
    "elementType": "geometry",
    "stylers": [
      {
        "color": "#000000"
      }
    ]
  },
  {
    "featureType": "water",
    "elementType": "labels.text.fill",
    "stylers": [
      {
        "color": "#3d3d3d"
      }
    ]
  }
];

// ─── Heat gradient ────────────────────────────────────────────────────────────
// t=0 → outermost edge (transparent cyan), t=1 → hot core (deep red)
// Matches the reference image: blue/cyan outer → green → yellow → orange → red core
const HEATMAP_GRADIENT = {
  colors: [
    'rgba(0, 180, 255, 0)',    // 0% - Outermost edge (transparent to blend with map)
    'rgba(0, 200, 255, 1)',    // 8% - Solid cyan fringe
    'rgba(0, 230, 200, 1)',    // 18% - Solid teal
    'rgba(0, 255, 80, 1)',     // 30% - Solid green
    'rgba(120, 255, 0, 1)',    // 42% - Solid yellow-green
    'rgba(255, 240, 0, 1)',    // 54% - Solid yellow
    'rgba(255, 150, 0, 1)',    // 65% - Solid orange
    'rgba(255, 60, 0, 1)',     // 75% - Solid red-orange
    'rgba(230, 0, 0, 1)',      // 84% - Solid red
    'rgba(180, 0, 0, 1)',      // 92% - Solid dark red
    'rgba(120, 0, 0, 1)'       // 100% - Solid deep maroon core
  ],
  startPoints: [0, 0.08, 0.18, 0.30, 0.42, 0.54, 0.65, 0.75, 0.84, 0.92, 1.0],
  colorMapSize: 256
};

// ─── Stable Heatmap Wrapper ──────────────────────────────────────────────────
// CRITICAL FIX: The native iOS GMUHeatmapTileLayer calls clearTileCache() and
// re-sets the map EVERY time setPoints: is invoked from the React Native bridge.
// Any parent re-render (notifications, location updates, state changes) causes
// the Heatmap component to re-render, which crosses the bridge and wipes tiles.
// This wrapper blocks re-renders unless the points array reference changes.
const StableHeatmap = React.memo(
  ({ points, radius }: { points: { latitude: number; longitude: number; weight: number }[], radius: number }) => {
    if (points.length === 0) {
      return null;
    }
    return (
      <Heatmap
        points={points}
        radius={radius}
        opacity={1.0}
        gradient={HEATMAP_GRADIENT}
      />
    );
  },
  (prevProps, nextProps) => {
    const samePoints = prevProps.points === nextProps.points;
    const sameRadius = prevProps.radius === nextProps.radius;
    return samePoints && sameRadius;
  }
);

// Default to a lively city area for now
const INITIAL_CAMERA = {
  center: {
    latitude: -1.286389,
    longitude: 36.817223,
  },
  // Pitch must stay 0: a tilted camera makes Google Maps render different tile
  // zoom levels across the screen, and the heatmap's fixed pixel radius then
  // draws the same venue's blob tiny near the bottom and wide past mid-screen.
  pitch: 0,
  heading: 0,
  altitude: 12000,
  zoom: 11.5, // Wide city view (a bit zoomed out, leaves room to zoom out to the minZoomLevel floor)
};

// Venue pins are hidden when zoomed out (they clutter the map and overpower the
// heatmap) and automatically turn on once the user zooms in to this level or closer.
const PIN_VISIBILITY_ZOOM = 14;

// Tapping a hot area (while zoomed out) flies the camera in to this zoom — comfortably
// past PIN_VISIBILITY_ZOOM so the pins reveal — centered on the nearest hot spot. This
// makes "just tap the heat" work for users who don't realize they need to pinch-zoom.
const HEAT_TAP_ZOOM = 16;
// How close (metres) a tap must land to a heat point to count as tapping "the heat".
const HEAT_TAP_RADIUS_M = 1500;
// Duration (ms) of the pin fade in/out when crossing PIN_VISIBILITY_ZOOM, so pins ease
// in/out instead of popping.
const PIN_FADE_MS = 350;

export const MapScreen = () => {
  const mapRef = useRef<MapView>(null);
  const insets = useSafeAreaInsets();
  const { venues, heatPoints, ensureLocationWatch } = useLiveVenues();
  const user = useAppStore((s) => s.user);
  const userLocation = useAppStore((s) => s.userLocation);
  const selectedMapVenue = useAppStore((s) => s.selectedMapVenue);
  const setSelectedMapVenue = useAppStore((s) => s.setSelectedMapVenue);
  const pendingVenueAction = useAppStore((s) => s.pendingVenueAction);
  const setPendingVenueAction = useAppStore((s) => s.setPendingVenueAction);
  const unreadChatCount = useAppStore((s) => s.unreadChatCount);
  const { stories } = useStories();
  const navigation = useNavigation<any>();
  const isFocused = useIsFocused();

  // Bumped on every screen focus to remount all markers. On Android, markers with
  // tracksViewChanges=false render from a bitmap captured when tracking was turned
  // off; if that capture happened while this screen was hidden, the bitmap is blank
  // and the pin becomes invisible. Remounting forces a fresh draw while visible.
  const [focusEpoch, setFocusEpoch] = useState(0);

  const [isViewerVisible, setIsViewerVisible] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isChatVisible, setIsChatVisible] = useState(false);
  const [chatVenue, setChatVenue] = useState<{ id: string; name: string } | null>(null);
  const [isLiveFeedVisible, setIsLiveFeedVisible] = useState(false);
  const [isCityPulseVisible, setIsCityPulseVisible] = useState(false);
  const [isMapReady, setIsMapReady] = useState(false);

  // ─── Venue card entrance + swipe-down dismiss ────────────────────────
  const cardTranslateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (selectedMapVenue) {
      cardTranslateY.setValue(320);
      Animated.spring(cardTranslateY, {
        toValue: 0,
        useNativeDriver: true,
        friction: 9,
        tension: 70,
      }).start();
    }
  }, [selectedMapVenue, cardTranslateY]);

  const cardPanResponder = useRef(
    PanResponder.create({
      // Claim only clear downward drags so taps and inner buttons keep working
      onMoveShouldSetPanResponder: (_, g) => g.dy > 10 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) cardTranslateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80 || g.vy > 1.2) {
          Animated.timing(cardTranslateY, { toValue: 420, duration: 160, useNativeDriver: true }).start(() => {
            useAppStore.getState().setSelectedMapVenue(null);
          });
        } else {
          Animated.spring(cardTranslateY, { toValue: 0, useNativeDriver: true, friction: 9 }).start();
        }
      },
    })
  ).current;

  // The stored selection is a snapshot from tap-time; re-resolve it against the
  // live venues list so the card's count/activity stay current while open.
  const cardVenue = selectedMapVenue
    ? venues.find((v) => v.id === selectedMapVenue.id) ?? selectedMapVenue
    : null;

  // Effect to stop marker tracking after mount to boost performance
  const [trackMarkerChanges, setTrackMarkerChanges] = useState(true);

  // Venue pins fade in/out by zoom (see PIN_VISIBILITY_ZOOM). Start hidden because the
  // initial camera opens zoomed out. The ref mirrors the state so the settle handler can
  // bail without depending on (and re-creating itself for) the latest render's value.
  const [pinsVisible, setPinsVisible] = useState(false);
  const pinsVisibleRef = useRef(false);
  // Drives the native marker opacity so pins fade rather than pop. Animating the marker's
  // native alpha (not its content) means no per-frame re-rasterization — tracksViewChanges
  // is untouched, so the fade doesn't reintroduce the tap-latency regression.
  const pinOpacity = useRef(new Animated.Value(0)).current;

  // Fires only when a pan/zoom gesture settles (not per frame). We do work ONLY when the
  // pins' visibility actually flips across the zoom threshold, so ordinary gestures within
  // a zoom band trigger no setState / re-render / marker re-rasterization — this is what
  // keeps the tap-latency invariant (see the note above <MapView/>) intact.
  const handleRegionChangeComplete = useCallback(async () => {
    const cam = await mapRef.current?.getCamera();
    const zoom = cam?.zoom;
    if (zoom === undefined) return;
    const shouldShow = zoom >= PIN_VISIBILITY_ZOOM;
    if (shouldShow === pinsVisibleRef.current) return;
    pinsVisibleRef.current = shouldShow;

    // Stop any in-flight fade so a quick re-cross reverses smoothly instead of fighting it.
    pinOpacity.stopAnimation();
    if (shouldShow) {
      // Mount the pins, then fade them in. Briefly re-enable tracking (and remount via
      // focusEpoch) so their SVG bitmaps capture — Android renders blank pins otherwise.
      setPinsVisible(true);
      setFocusEpoch(e => e + 1);
      setTrackMarkerChanges(true);
      setTimeout(() => setTrackMarkerChanges(false), 1500);
      Animated.timing(pinOpacity, {
        toValue: 1,
        duration: PIN_FADE_MS,
        useNativeDriver: false, // opacity is a native marker prop, not a transform
      }).start();
    } else {
      // Fade out first, then unmount once the fade actually finishes (finished === false
      // means a fade-in interrupted us, so we leave the pins mounted).
      Animated.timing(pinOpacity, {
        toValue: 0,
        duration: PIN_FADE_MS,
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished) setPinsVisible(false);
      });
    }
  }, [pinOpacity]);

  // Tapping the heat while zoomed out flies the camera in to the nearest hot spot so pins
  // reveal (see HEAT_TAP_ZOOM). Discoverability: a tap is most users' first instinct, so it
  // should "just work" even if they never think to pinch-zoom. Once pins are already showing
  // we leave taps alone. Marker presses call stopPropagation, so this never fires on a pin.
  const handleMapPress = useCallback((e: MapPressEvent) => {
    if (pinsVisibleRef.current) return;
    const tap = e.nativeEvent.coordinate;
    if (!tap) return;

    // Snap to the nearest hot point (skip the far-south heatmap calibration anchor).
    let nearest: { latitude: number; longitude: number } | null = null;
    let nearestDist = Infinity;
    for (const p of heatPoints) {
      if (p.latitude <= -60) continue;
      const d = getDistanceInMeters(tap.latitude, tap.longitude, p.latitude, p.longitude);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = p;
      }
    }
    if (!nearest || nearestDist > HEAT_TAP_RADIUS_M) return;

    // Smooth fly-in. Pitch/heading stay flat (a tilted camera breaks heatmap blob sizing —
    // see INITIAL_CAMERA). onRegionChangeComplete fires when this settles and flips the pins on.
    mapRef.current?.animateCamera(
      {
        center: { latitude: nearest.latitude, longitude: nearest.longitude },
        zoom: HEAT_TAP_ZOOM,
        pitch: 0,
        heading: 0,
      },
      { duration: 700 }
    );
  }, [heatPoints]);

  // Briefly re-enable tracking when App returns to foreground to redraw any OS-dropped bitmaps.
  // Skipped when this screen isn't the focused tab — capturing the marker bitmaps while the
  // screen is hidden produces blank pins on Android.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active' && navigation.isFocused()) {
        setFocusEpoch(e => e + 1);
        setTrackMarkerChanges(true);
        setTimeout(() => setTrackMarkerChanges(false), 2000);
      }
    });
    return () => subscription.remove();
  }, [navigation]);

  // Re-enable tracking when returning to this tab via React Navigation. Remount the
  // markers (focusEpoch) so Android draws fresh views, and keep tracking on long enough
  // for the SVG pin icons to finish rendering before the bitmap is captured.
  useFocusEffect(
    useCallback(() => {
      if (!isMapReady) return;
      setFocusEpoch(e => e + 1);
      setTrackMarkerChanges(true);
      const timer = setTimeout(() => setTrackMarkerChanges(false), 1500);
      return () => clearTimeout(timer);
    }, [isMapReady])
  );

  // Markers only look different when a venue appears/moves or gains/loses stories
  // (pin color). Distance/count updates from Firebase produce a new venues array
  // every few seconds without changing any pixel — keying the effect below on this
  // signature (instead of array identity) avoids constantly re-rasterizing markers.
  const markerVisualSignature = useMemo(() => {
    const storyVenueIds = new Set(stories.map((s) => s.venue_id));
    return venues
      .map((v) => `${v.id}:${storyVenueIds.has(v.id) ? 1 : 0}:${v.latitude},${v.longitude}`)
      .join('|');
  }, [venues, stories]);

  useEffect(() => {
    // Never toggle tracking while unfocused: the toggle-off would capture blank marker
    // bitmaps (venues/stories keep updating from Firebase while the user is on other tabs).
    // The focus effect above re-rasterizes everything when the user comes back.
    if (!isFocused) return;
    setTrackMarkerChanges(true);
    const timer = setTimeout(() => setTrackMarkerChanges(false), 2000);
    return () => clearTimeout(timer);
  }, [markerVisualSignature, isFocused]);

  useEffect(() => {
    if (selectedMapVenue && mapRef.current && isMapReady) {
      mapRef.current.animateCamera({
        center: {
          latitude: selectedMapVenue.latitude,
          longitude: selectedMapVenue.longitude,
        },
        zoom: 19.5,
        pitch: 0, // keep flat — tilt breaks heatmap blob sizing (see INITIAL_CAMERA)
      }, { duration: 1000 });
    }
  }, [selectedMapVenue, isMapReady]);

  // Automatically close any overlay modals (chat, stories, live feed) when a new venue is focused on the map
  useEffect(() => {
    if (selectedMapVenue) {
      setIsChatVisible(false);
      setChatVenue(null);
      setIsLiveFeedVisible(false);
      if (!isViewerVisible) {
        setIsViewerVisible(false);
      }
    }
  }, [selectedMapVenue, isViewerVisible]);

  useEffect(() => {
    if (selectedMapVenue && pendingVenueAction === 'chat') {
      setChatVenue({ id: selectedMapVenue.id, name: selectedMapVenue.name });
      setIsChatVisible(true);
      setPendingVenueAction(null);
    }
  }, [selectedMapVenue, pendingVenueAction, setPendingVenueAction]);

  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        let { status } = await Location.getForegroundPermissionsAsync();

        // If not granted, request it
        if (status !== 'granted') {
          const res = await Location.requestForegroundPermissionsAsync();
          status = res.status;
        }

        if (status !== 'granted') {
          console.warn('Location permission denied, cannot center map to user.');
          return;
        }

        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        if (isMounted) {
          useAppStore.getState().setUserLocation({
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
          });
          mapRef.current?.animateCamera({
            center: {
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
            },
            pitch: 0, // keep flat — tilt breaks heatmap blob sizing (see INITIAL_CAMERA)
            heading: location.coords.heading || 0,
            zoom: 12.2, // Wide city view showing hot zones
          }, { duration: 2000 });
        }

        // Ongoing updates come from the app-wide shared watcher (via the store).
        // It couldn't start if permission was only granted just now, so kick it.
        ensureLocationWatch();
      } catch (error) {
        console.warn("Could not start location tracking:", error);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [ensureLocationWatch]);

  const centerMap = async () => {
    try {
      let { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') {
        const res = await Location.requestForegroundPermissionsAsync();
        status = res.status;
      }

      if (status !== 'granted') {
        Toast.show({ type: 'error', text1: 'Permission Denied', text2: 'Please allow location access to center map.' });
        return;
      }

      let location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      mapRef.current?.animateCamera({
        center: {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        },
        pitch: 0, // keep flat — tilt breaks heatmap blob sizing (see INITIAL_CAMERA)
        heading: location.coords.heading || 0,
        zoom: 16,
      }, { duration: 1500 });
    } catch (error) {
      console.warn("Error centering map:", error);
      Toast.show({
        type: 'error',
        text1: 'Location Error',
        text2: 'Could not retrieve your location. Please check your GPS settings and try again.'
      });
    }
  };

  const handleMarkerPress = (venue: LiveVenue) => {
    setSelectedMapVenue(venue);
  };

  const handleReportVenue = () => {
    if (!user || !selectedMapVenue) return;

    Alert.alert(
      "Report Venue/Event",
      "Why are you reporting this venue/event?",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Inappropriate Listing", 
          onPress: () => submitVenueReport("Inappropriate Listing")
        },
        { 
          text: "Fake / Scam Event", 
          onPress: () => submitVenueReport("Fake or scam event")
        },
        { 
          text: "Violent / Dangerous Area", 
          onPress: () => submitVenueReport("Violent or dangerous area")
        },
        { 
          text: "Other", 
          onPress: () => submitVenueReport("Other")
        }
      ]
    );
  };

  const submitVenueReport = async (reason: string) => {
    if (!user || !selectedMapVenue) return;
    try {
      await createReport(
        user.uid,
        null, // No reportedUserId for venues
        'venue',
        selectedMapVenue.id,
        selectedMapVenue.name,
        undefined,
        reason
      );
      Toast.show({
        type: 'success',
        text1: 'Report Submitted',
        text2: 'Thank you. We will review this venue/event listing.'
      });
    } catch (error) {
      console.warn("Failed to submit venue report:", error);
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'Failed to submit report. Please try again.'
      });
    }
  };

  const executeStoryUpload = async (targetVenue: LiveVenue) => {
    if (!user || !targetVenue || !userLocation) return;

    const trueDistance = getDistanceInMeters(userLocation.latitude, userLocation.longitude, targetVenue.latitude, targetVenue.longitude);
    if (trueDistance > 200) {
      Toast.show({ type: 'error', text1: 'Too far away', text2: 'You must be within 200m to post here!' });
      return;
    }

    Alert.alert(
      "Add Story",
      "Would you like to take a new photo/video or select from your gallery?",
      [
        {
          text: "Cancel",
          style: "cancel"
        },
        {
          text: "Camera",
          onPress: async () => {
            const { status } = await ImagePicker.requestCameraPermissionsAsync();
            if (status !== 'granted') {
              Toast.show({ type: 'error', text1: 'Permission Denied', text2: 'Camera access is required.' });
              return;
            }
            launchPicker(true, targetVenue);
          }
        },
        {
          text: "Gallery",
          onPress: async () => {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') {
              Toast.show({ type: 'error', text1: 'Permission Denied', text2: 'Gallery access is required.' });
              return;
            }
            launchPicker(false, targetVenue);
          }
        }
      ]
    );
  };

  const launchPicker = async (useCamera: boolean, targetVenue: LiveVenue) => {
    try {
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images', 'videos'],
        allowsEditing: true,
        quality: 0.7,
      };

      const result = useCamera
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);

      if (!result.canceled && result.assets.length > 0) {
        setIsUploading(true);
        setIsViewerVisible(false); // Close viewer while uploading

        const uri = result.assets[0].uri;
        const mediaType = result.assets[0].type === 'video' ? 'video' : 'image';

        if (user) {
          const downloadUrl = await uploadStoryMedia(uri, user.uid);
          await createStory(user.uid, downloadUrl, mediaType, targetVenue.id);

          Toast.show({
            type: 'success',
            text1: 'Story Added!',
            text2: 'Your story is now visible at this venue.',
          });
        }
      }
    } catch (error) {
      console.warn('Upload Error:', error);
      Toast.show({
        type: 'error',
        text1: 'Upload Failed',
        text2: getFriendlyErrorMessage(error),
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleAddStory = () => {
    if (selectedMapVenue) executeStoryUpload(selectedMapVenue as LiveVenue);
  };

  const handleRemoveStory = async (storyId: string) => {
    try {
      await deleteStory(storyId);
      Toast.show({
        type: 'success',
        text1: 'Story Deleted',
        text2: 'Your story has been removed.'
      });
    } catch (error) {
      console.warn('Delete Story Error:', error);
      Toast.show({
        type: 'error',
        text1: 'Delete Failed',
        text2: getFriendlyErrorMessage(error),
      });
    }
  };

  const handleStoriesEnd = () => {
    // Find all venues that have stories, preserving the order they are in the active venues list
    const venuesWithStories = venues.filter(v => stories.some(s => s.venue_id === v.id));
    if (selectedMapVenue) {
      const currentIdx = venuesWithStories.findIndex(v => v.id === selectedMapVenue.id);
      if (currentIdx !== -1 && currentIdx < venuesWithStories.length - 1) {
        const nextVenue = venuesWithStories[currentIdx + 1];
        setSelectedMapVenue(nextVenue);
      } else {
        // No more venues with stories, close the viewer
        setIsViewerVisible(false);
        setSelectedMapVenue(null);
      }
    } else {
      setIsViewerVisible(false);
    }
  };

  const closestLiveVenue = useMemo(() => {
    if (!userLocation || !venues.length) return { venue: null, distance: Infinity };
    let minDist = Infinity;
    let closest = null;
    venues.forEach((v) => {
      const dist = getDistanceInMeters(userLocation.latitude, userLocation.longitude, v.latitude, v.longitude);
      if (dist < minDist) {
        minDist = dist;
        closest = v;
      }
    });
    return { venue: closest, distance: minDist };
  }, [userLocation, venues]);

  // Live city pulse: total people out across every venue right now. Updates in real time
  // with the venues feed, and shows a believable number instantly (not 0) thanks to the
  // cold-start prediction. Drives the bottom-center "Nairobi Live" pill.
  const totalUsersOut = useMemo(
    () => venues.reduce((sum, v) => sum + (v.userCount || 0), 0),
    [venues]
  );

  // Gentle heartbeat on the live dot. Plain view (not a map marker) + native-driven opacity,
  // so it's off the JS thread and has no marker-rasterization cost.
  const livePulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(livePulse, { toValue: 0.25, duration: 900, useNativeDriver: true }),
        Animated.timing(livePulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [livePulse]);

  const canAddGlobalStory = closestLiveVenue.distance <= 200;

  const handleGlobalAddStory = async () => {
    // Re-check the LIVE position on tap instead of trusting the cached store value. The
    // background watcher only pushes updates after ≥20m of movement or every 15s, so it can
    // lag real movement — and a static simulated-location teleport may never trigger it at
    // all, leaving the feature stuck "locked". A fresh fetch makes the unlock responsive.
    let coords = userLocation;
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status === 'granted') {
        const fresh = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        coords = { latitude: fresh.coords.latitude, longitude: fresh.coords.longitude };
        useAppStore.getState().setUserLocation(coords); // keep store (and lock UI) in sync
      }
    } catch {
      // Fall back to whatever cached location we have.
    }

    let nearest: LiveVenue | null = null;
    let nearestDist = Infinity;
    if (coords) {
      for (const v of venues) {
        const d = getDistanceInMeters(coords.latitude, coords.longitude, v.latitude, v.longitude);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = v;
        }
      }
    }

    if (!nearest || nearestDist > 200) {
      Alert.alert(
        "Vibe Check Restricted",
        "You must be within 200 meters of a venue to post a story. This keeps the Eventas live feed real and local to what is happening right now!",
        [{ text: "Got it" }]
      );
      return;
    }
    executeStoryUpload(nearest);
  };

  // Safe distance check
  const isNearLiveVenue = selectedMapVenue && userLocation ?
    getDistanceInMeters(userLocation.latitude, userLocation.longitude, selectedMapVenue.latitude, selectedMapVenue.longitude) <= 200
    : false;

  const renderedMarkers = useMemo(() => {
    return venues
      .slice()
      .sort((a, b) => {
        const aHasStories = stories.some(s => s.venue_id === a.id);
        const bHasStories = stories.some(s => s.venue_id === b.id);
        if (aHasStories && !bHasStories) return 1;
        if (!aHasStories && bHasStories) return -1;
        return 0;
      })
      .map((venue) => {
        const venueStories = stories.filter(s => s.venue_id === venue.id);
        const hasStories = venueStories.length > 0;
        const pinColor = hasStories ? "#FF00CC" : "#00FFCC";

        return (
          <MarkerAnimated
            key={`${venue.id}_${hasStories}_${focusEpoch}`}
            coordinate={{ latitude: venue.latitude, longitude: venue.longitude }}
            onPress={(e) => {
              e.stopPropagation();
              handleMarkerPress(venue);
            }}
            tracksViewChanges={trackMarkerChanges}
            opacity={pinOpacity}
            zIndex={hasStories ? 200 : 100}
            anchor={{ x: 0.5, y: 1 }}
          >
            {/* collapsable={false}: RN's Android view flattening can strip this wrapper,
                breaking the marker's view-to-bitmap capture */}
            <View style={styles.markerContainer} collapsable={false}>
              <View style={[styles.pinBubble, { backgroundColor: pinColor }]}>
                <MapPin color="#000" size={14} fill="#000" />
              </View>
              <View style={[styles.pinArrow, { borderTopColor: pinColor }]} />
            </View>
          </MarkerAnimated>
        );
      });
  }, [venues, stories, trackMarkerChanges, focusEpoch, pinOpacity]);

  return (
    <View style={styles.container}>
      {/* Top stories tray — one-tap access to add / view stories now that pins are hidden.
          First bubble adds your story; the rest are venues with active stories. */}
      <StoriesTray
        venues={venues}
        stories={stories}
        canAddStory={canAddGlobalStory}
        onAddStory={handleGlobalAddStory}
        onOpenVenueStories={(venueObj) => {
          setSelectedMapVenue(venueObj);
          setIsViewerVisible(true);
        }}
      />

      {/* NOTE: the onRegionChangeComplete handler below fires only when a gesture
          settles and re-renders ONLY when pins cross the zoom-visibility threshold —
          never on ordinary pans/zooms. Do NOT toggle tracksViewChanges on every camera
          move: rasterized marker bitmaps are repositioned natively during pan/zoom, and
          re-rasterizing on every gesture saturates the UI thread (tap-latency regression). */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={PROVIDER_GOOGLE}
        customMapStyle={DARK_MAP_STYLE}
        initialCamera={INITIAL_CAMERA}
        showsUserLocation={true}
        showsMyLocationButton={false}
        showsCompass={false}
        showsScale={false}
        showsBuildings={true}
        showsTraffic={false}
        showsIndoors={false}
        toolbarEnabled={false} // (Android) hide the Directions/navigate toolbar that pops up bottom-right and covers our controls
        loadingEnabled={true}
        loadingBackgroundColor="#121212"
        loadingIndicatorColor="#00FFCC"
        pitchEnabled={false} // tilt gestures re-introduce the heatmap zoom-band artifact
        rotateEnabled={true}
        minZoomLevel={11} // Zoom-out floor: start is 11.5, so users get a slight (~half level) pull-back but can't zoom out so far events condense into one blob
        maxZoomLevel={20}
        onPress={handleMapPress}
        onRegionChangeComplete={handleRegionChangeComplete}
        onMapReady={() => {
          // Pan boundaries (generously covering Africa) keep the heatmap's
          // south-pole calibration anchor (see LiveVenuesContext) permanently
          // off-screen, together with minZoomLevel above.
          mapRef.current?.setMapBoundaries(
            { latitude: 25, longitude: 65 },
            { latitude: -40, longitude: -25 }
          );
          setIsMapReady(true);
        }}
      >
        {/* ── Native Heatmap (KDE blending) ──────────────────────────────
             Uses react-native-maps's native Heatmap implementation which supports
             seamless blending and KDE (Kernel Density Estimation).
             Wrapped in StableHeatmap to prevent native tile cache wipe on
             unrelated parent re-renders (notifications, location, etc).
             Weights arrive pre-normalized to 0..1 (LiveVenuesContext), so the
             points array only changes when a venue's heat band actually moves.
             Radius must stay ≤ 50 on Android (screen pixels), but needs to be larger on iOS (points, e.g., 90) to match visually due to high-DPI scaling. Since our active venue count is tiny, tile rendering is instantaneous and does not suffer from visible tile seam lag. */}
        <StableHeatmap
          points={heatPoints}
          radius={Platform.OS === 'android' ? 50 : 90}
        />
        {/* LiveVenue markers — shown only when zoomed in past PIN_VISIBILITY_ZOOM */}
        {pinsVisible && renderedMarkers}
      </MapView>

      {/* Story Upload Overlay */}
      {isUploading && (
        <View style={styles.uploadOverlay}>
          <Text style={styles.uploadText}>Uploading Story...</Text>
        </View>
      )}

      {/* Story Viewer Modal */}
      {selectedMapVenue && (
        <StoryViewer
          isVisible={isViewerVisible}
          onClose={() => setIsViewerVisible(false)}
          stories={stories.filter(s => s.venue_id === selectedMapVenue.id)}
          venueName={selectedMapVenue.name}
          canAddStory={Boolean(isNearLiveVenue)}
          onAddStory={handleAddStory}
          onRemoveStory={handleRemoveStory}
          onStoriesEnd={handleStoriesEnd}
        />
      )}

      {/* LiveVenue Chat Modal */}
      {chatVenue && (
        <VenueChat
          isVisible={isChatVisible}
          onClose={() => {
            setIsChatVisible(false);
            setChatVenue(null);
          }}
          venueId={chatVenue.id}
          venueName={chatVenue.name}
        />
      )}

      {/* LiveVenue Info Overlay Card */}
      {selectedMapVenue && cardVenue && (
        <Animated.View
          style={[
            styles.venueInfoCard,
            { bottom: insets.bottom + 20, transform: [{ translateY: cardTranslateY }] },
          ]}
          {...cardPanResponder.panHandlers}
        >
        <TouchableOpacity
          activeOpacity={cardVenue.type === 'Event' ? 0.95 : 1}
          onPress={() => {
            if (cardVenue.type === 'Event') {
              navigation.navigate('EventDetail', { event: cardVenue });
            }
          }}
        >
          {/* Top Banner Image with themed filter */}
          <View style={styles.cardImageContainer}>
            <VenueImage
              venue={cardVenue}
              style={styles.cardImage}
              isBanner={true}
            />
            {/* Swipe-down affordance */}
            <View style={styles.cardGrabber} />
            {/* Report Button overlaying the image */}
            <TouchableOpacity
              style={styles.reportCardButtonOverlay}
              onPress={handleReportVenue}
            >
              <Flag color="#FFF" size={16} />
            </TouchableOpacity>
          </View>

          <View style={styles.cardContent}>
            <Text style={styles.venueCardTitle} numberOfLines={1}>{cardVenue.name}</Text>
            <Text style={styles.venueCardAddress} numberOfLines={1}>{cardVenue.address || 'Nairobi, Kenya'}</Text>

            {/* Live activity — the core signal, surfaced on the card itself */}
            <View style={styles.activityRow}>
              <View
                style={[
                  styles.activityChip,
                  { backgroundColor: `${cardVenue.activityColor}18`, borderColor: `${cardVenue.activityColor}60` },
                ]}
              >
                <View style={[styles.activityDot, { backgroundColor: cardVenue.activityColor }]} />
                <Text style={[styles.activityChipText, { color: cardVenue.activityColor }]}>
                  {cardVenue.activityLevel === 'None' ? 'QUIET' : cardVenue.activityLevel.toUpperCase()}
                </Text>
              </View>
              <View style={styles.activityMeta}>
                <Users color={theme.textSecondary} size={13} />
                <Text style={styles.activityMetaText}>{cardVenue.userCount} here now</Text>
              </View>
              {cardVenue.distanceKm !== null && (
                <View style={styles.activityMeta}>
                  <NavigationIcon color={theme.textSecondary} size={12} />
                  <Text style={styles.activityMetaText}>
                    {cardVenue.distanceKm < 1
                      ? `${Math.round(cardVenue.distanceKm * 1000)}m`
                      : `${cardVenue.distanceKm.toFixed(1)}km`}
                  </Text>
                </View>
              )}
              {cardVenue.trend === 'rising' && (
                <View style={styles.activityMeta}>
                  <TrendingUp color="#4CD964" size={13} />
                  <Text style={[styles.activityMetaText, styles.trendRisingText]}>Heating up</Text>
                </View>
              )}
              {cardVenue.trend === 'falling' && (
                <View style={styles.activityMeta}>
                  <TrendingDown color="#FF9500" size={13} />
                  <Text style={[styles.activityMetaText, styles.trendFallingText]}>Winding down</Text>
                </View>
              )}
            </View>

            <Text style={styles.venueCardDescription} numberOfLines={2}>{cardVenue.description}</Text>

            <View style={styles.cardActionRow}>
              <TouchableOpacity
                style={styles.viewStoriesBtn}
                onPress={() => {
                  setSelectedMapVenue(selectedMapVenue);
                  setIsViewerVisible(true);
                }}
              >
                <Text style={styles.viewStoriesText}>View Stories</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.accessChatBtn}
                onPress={() => {
                  if (selectedMapVenue) {
                    setChatVenue({ id: selectedMapVenue.id, name: selectedMapVenue.name });
                    setIsChatVisible(true);
                  }
                }}
              >
                <Text style={styles.accessChatText}>Access chat</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
        </Animated.View>
      )}

      {/* Neutral (dark-glass / white) controls so they recede against the colourful heat.
          Recenter sits at the bottom-right corner (maps convention), chat stacked above it.
          In the resting state the stack shares the Nairobi Live pill's baseline (+24); it
          rises to +120 only when a venue card is up, to clear the full-width card. */}
      <View style={[styles.controlsContainer, { bottom: insets.bottom + (selectedMapVenue ? 120 : 72) }]}>
        {/* Active Chats List Button */}
        <TouchableOpacity
          style={styles.controlButton}
          onPress={() => setIsLiveFeedVisible(true)}
          activeOpacity={0.7}
        >
          <MessageSquare color="#FFFFFF" size={20} />
          {unreadChatCount > 0 && (
            <View style={styles.badgeContainer}>
              <Text style={styles.badgeText}>{unreadChatCount}</Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.controlButton} onPress={centerMap} activeOpacity={0.7}>
          <LocateFixed color="#FFFFFF" size={20} />
        </TouchableOpacity>
      </View>

      {/* Bottom-center "Nairobi Live" realtime pulse. Tap to open the City Pulse popup.
          Hidden while a venue card is up (they'd overlap). box-none lets the empty sides of
          the container pass touches through to the map (only the pill itself is tappable). */}
      {!selectedMapVenue && (
        <View
          style={[styles.livePulseContainer, { bottom: insets.bottom + 8 }]}
          pointerEvents="box-none"
        >
          <TouchableOpacity
            style={styles.livePulsePill}
            activeOpacity={0.85}
            onPress={() => setIsCityPulseVisible(true)}
          >
            <Animated.View style={[styles.livePulseDot, { opacity: livePulse }]} />
            <Text style={styles.livePulseLabel}>NAIROBI LIVE</Text>
            <Text style={styles.livePulseDivider}>·</Text>
            <Text style={styles.livePulseCount}>{totalUsersOut.toLocaleString()} out now</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* City Pulse popup (opened from the Nairobi Live pill) */}
      <CityPulseModal
        isVisible={isCityPulseVisible}
        onClose={() => setIsCityPulseVisible(false)}
        venues={venues}
        totalUsersOut={totalUsersOut}
        onSelectVenue={(venueObj) => {
          setIsCityPulseVisible(false);
          setSelectedMapVenue(venueObj);
          mapRef.current?.animateCamera({
            center: { latitude: venueObj.latitude, longitude: venueObj.longitude },
            zoom: 19.5,
            pitch: 0, // keep flat — tilt breaks heatmap blob sizing (see INITIAL_CAMERA)
          }, { duration: 1000 });
        }}
      />

      {/* Live Feed Modal */}
      <LiveFeedModal
        isVisible={isLiveFeedVisible}
        onClose={() => setIsLiveFeedVisible(false)}
        venues={venues}
        stories={stories}
        onOpenChat={(venueId, venueName) => {
          setChatVenue({ id: venueId, name: venueName });
          setIsChatVisible(true);
        }}
        onOpenStories={(venueObj) => {
          setSelectedMapVenue(venueObj);
          setIsViewerVisible(true);
        }}
        onFocusVenue={(venueObj) => {
          setSelectedMapVenue(venueObj);
          mapRef.current?.animateCamera({
            center: {
              latitude: venueObj.latitude,
              longitude: venueObj.longitude,
            },
            zoom: 19.5,
            pitch: 0, // keep flat — tilt breaks heatmap blob sizing (see INITIAL_CAMERA)
          }, { duration: 1000 });
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    height: 40,
  },
  pinBubble: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#00FFCC',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#000',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 3,
    elevation: 5,
  },
  pinArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#00FFCC',
    marginTop: -2,
  },
  // Removed fuzzy markerGlow and storyRing to improve pin quality and clarity per user request
  uploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  uploadText: {
    color: '#00FFCC',
    fontSize: 18,
    fontWeight: 'bold',
  },
  venueInfoCard: {
    position: 'absolute',
    left: 16,
    right: 16, // full width except margins
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#00FFCC',
    shadowColor: '#00FFCC',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
    zIndex: 20,
    overflow: 'hidden', // required for rounded image corners
  },
  cardImageContainer: {
    width: '100%',
    height: 130,
    position: 'relative',
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  reportCardButtonOverlay: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 2,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardGrabber: {
    position: 'absolute',
    top: 8,
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
    zIndex: 2,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 10,
  },
  trendRisingText: {
    color: '#4CD964',
  },
  trendFallingText: {
    color: '#FF9500',
  },
  activityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  activityDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  activityChipText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  activityMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  activityMetaText: {
    color: theme.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  cardContent: {
    padding: 16,
  },
  venueCardTitle: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 4,
  },
  venueCardAddress: {
    color: '#AAA',
    fontSize: 14,
    marginBottom: 8,
  },
  venueCardDescription: {
    color: '#BBB',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  cardActionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  viewStoriesBtn: {
    flex: 1,
    backgroundColor: '#FF00CC',
    paddingVertical: 10,
    borderRadius: 24,
    alignItems: 'center',
  },
  viewStoriesText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
  accessChatBtn: {
    flex: 1,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#00FFCC',
    paddingVertical: 10,
    borderRadius: 24,
    alignItems: 'center',
  },
  accessChatText: {
    color: '#00FFCC',
    fontSize: 14,
    fontWeight: '700',
  },
  controlsContainer: {
    position: 'absolute',
    right: 16,
    alignItems: 'center',
    gap: 16,
  },
  livePulseContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  livePulsePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(18, 18, 18, 0.92)',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    gap: 7,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
  livePulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF2D55',
  },
  livePulseLabel: {
    color: '#00FFCC',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  livePulseDivider: {
    color: '#666',
    fontSize: 12,
    fontWeight: '700',
  },
  livePulseCount: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  controlButton: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(26, 26, 26, 0.9)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  badgeContainer: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#FF0055',
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: '#121212',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: 'bold',
    lineHeight: 11,
    textAlign: 'center',
  },
});
