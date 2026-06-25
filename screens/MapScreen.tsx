import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import * as Location from 'expo-location';
import { StyleSheet, View, Text, TouchableOpacity, Alert, Platform, AppState } from 'react-native';
import MapView, { PROVIDER_GOOGLE, Marker, Region, Heatmap } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LocateFixed, Plus, Minus, MapPin, Camera, Wrench, X, Flag, MessageSquare } from 'lucide-react-native';
import { createReport } from '../services/reportService';
import { useLiveVenues, LiveVenue as LiveVenue } from '../hooks/useLiveVenues';
import * as ImagePicker from 'expo-image-picker';
import Toast from 'react-native-toast-message';
import { useFocusEffect } from '@react-navigation/native';
import { useStories } from '../hooks/useStories';
import { StoryViewer } from '../components/StoryViewer';
import { uploadStoryMedia, createStory, deleteStory } from '../services/storyService';
import { getDistanceInMeters } from '../utils/locationUtils';
import { useAppStore } from '../hooks/useAppStore';
import { VenueChat } from '../components/VenueChat';
import { VenueImage } from '../components/VenueImage';
import { LiveFeedModal } from '../components/LiveFeedModal';
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

export const MapScreen = () => {
  const mapRef = useRef<MapView>(null);
  const insets = useSafeAreaInsets();
  const { venues, heatPoints } = useLiveVenues();
  const { user, selectedMapVenue, setSelectedMapVenue, isAdmin, pendingVenueAction, setPendingVenueAction, unreadChatCount } = useAppStore();
  const { stories } = useStories();

  // ─── Zoom tracking ───────────────────────────────────────────────
  // We track the current rounded zoom level so we can convert screen-pixel sizes to
  // geo-accurate meter radii. This fixes the zoom-in issue (GitHub #371):
  // fixed-meter circles balloon on screen as you zoom in, but pixel-based
  // circles stay a constant visual size at all zoom levels.
  const [discreteZoom, setDiscreteZoom] = useState(14);

  const scaledPoints = useMemo(() => {
    // Boost base intensity and scale it up exponentially with zoom level
    // to maintain the red core visibility as you zoom in.
    const zoomScale = 4.5 * Math.pow(1.65, Math.max(0, discreteZoom - 12));
    return heatPoints.map((pt) => ({
      ...pt,
      weight: pt.weight * zoomScale,
    }));
  }, [heatPoints, discreteZoom]);





  const [userLocation, setUserLocation] = useState<Location.LocationObjectCoords | null>(null);

  const [isViewerVisible, setIsViewerVisible] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isChatVisible, setIsChatVisible] = useState(false);
  const [chatVenue, setChatVenue] = useState<{ id: string; name: string } | null>(null);
  const [isLiveFeedVisible, setIsLiveFeedVisible] = useState(false);
  const [isMapReady, setIsMapReady] = useState(false);

  // Debug states
  const [isDebugMode, setIsDebugMode] = useState(false);
  const [showHeatmapOverlay, setShowHeatmapOverlay] = useState(true);
  const [showRawPoints, setShowRawPoints] = useState(false);

  const handleRegionChange = async (newRegion: Region) => {
    // Briefly force marker tracking so they redraw correctly if OS garbage collected them during intense panning
    setTrackMarkerChanges(true);
    setTimeout(() => setTrackMarkerChanges(false), 2000);

    // Determine new zoom level
    let newZoom = 14;
    if (mapRef.current) {
      try {
        const cam = await mapRef.current.getCamera();
        if (cam && typeof cam.zoom === 'number') {
          newZoom = Math.max(1, Math.min(20, cam.zoom));
        }
      } catch (err) {
        console.warn('[MAP-DEBUG] Failed to get camera zoom:', err);
        if (newRegion.longitudeDelta > 0) {
          newZoom = Math.max(1, Math.min(20, Math.log2(360 / newRegion.longitudeDelta)));
        }
      }
    } else if (newRegion.longitudeDelta > 0) {
      newZoom = Math.max(1, Math.min(20, Math.log2(360 / newRegion.longitudeDelta)));
    }

    const newDiscreteZoom = Math.round(newZoom);
    if (newDiscreteZoom !== discreteZoom) {
      setDiscreteZoom(newDiscreteZoom);
    }
  };

  // Default to a lively city area for now
  const [camera, setCamera] = useState({
    center: {
      latitude: -1.286389,
      longitude: 36.817223,
    },
    pitch: 30, // Slight tilt for 3D/2D hybrid perspective
    heading: 0,
    altitude: 12000,
    zoom: 12.2, // Wide city view
  });

  // Effect to stop marker tracking after mount to boost performance
  const [trackMarkerChanges, setTrackMarkerChanges] = useState(true);

  // Briefly re-enable tracking when App returns to foreground to redraw any OS-dropped bitmaps
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        setTrackMarkerChanges(true);
        setTimeout(() => setTrackMarkerChanges(false), 2000);
      }
    });
    return () => subscription.remove();
  }, []);

  // Also re-enable tracking when returning to this tab via React Navigation
  useFocusEffect(
    useCallback(() => {
      if (!isMapReady) return;
      setTrackMarkerChanges(true);
      // Brief 500ms timeout is enough when map is already ready and we just focused the screen
      const timer = setTimeout(() => setTrackMarkerChanges(false), 500);
      return () => clearTimeout(timer);
    }, [isMapReady])
  );

  useEffect(() => {
    setTrackMarkerChanges(true);
    const timer = setTimeout(() => setTrackMarkerChanges(false), 2000);
    return () => clearTimeout(timer);
  }, [venues, stories]);

  useEffect(() => {
    if (selectedMapVenue && mapRef.current && isMapReady) {
      mapRef.current.animateCamera({
        center: {
          latitude: selectedMapVenue.latitude,
          longitude: selectedMapVenue.longitude,
        },
        zoom: 16,
        pitch: 45,
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
    let intervalId: NodeJS.Timeout;

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

        let location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        if (isMounted) {
          setUserLocation(location.coords);
          mapRef.current?.animateCamera({
            center: {
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
            },
            pitch: 30,
            heading: location.coords.heading || 0,
            zoom: 12.2, // Wide city view showing hot zones
          }, { duration: 2000 });
        }

        // Auto refresh location every 15 seconds
        intervalId = setInterval(async () => {
          try {
            // Check permission again in case it was revoked
            const perm = await Location.getForegroundPermissionsAsync();
            if (perm.status !== 'granted') {
              clearInterval(intervalId);
              return;
            }

            let newLocation = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            });
            if (isMounted) {
              setUserLocation(newLocation.coords);
            }
          } catch (e: any) {
            // Graceful handling of permission errors without spamming the console
            if (e?.message?.includes('permission')) {
              clearInterval(intervalId);
            } else {
              console.warn("Error auto-refreshing location:", e);
            }
          }
        }, 15000);

      } catch (error) {
        console.warn("Could not start location tracking:", error);
      }
    })();

    return () => {
      isMounted = false;
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, []);

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
        pitch: 45,
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

  const handleZoom = async (zoomIn: boolean) => {
    try {
      const camera = await mapRef.current?.getCamera();
      if (camera && camera.zoom !== undefined) {
        camera.zoom += zoomIn ? 1 : -1;
        mapRef.current?.animateCamera(camera, { duration: 300 });
      }
    } catch (error) {
      console.warn("Error zooming:", error);
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

  const canAddGlobalStory = closestLiveVenue.distance <= 200;

  const handleGlobalAddStory = () => {
    if (!canAddGlobalStory) {
      Alert.alert(
        "Vibe Check Restricted",
        "You must be within 200 meters of a venue to post a story. This keeps the Eventas live feed real and local to what is happening right now!",
        [{ text: "Got it" }]
      );
      return;
    }
    if (closestLiveVenue.venue) {
      executeStoryUpload(closestLiveVenue.venue);
    }
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
          <Marker
            key={`${venue.id}_${hasStories}`}
            coordinate={{ latitude: venue.latitude, longitude: venue.longitude }}
            onPress={(e) => {
              e.stopPropagation();
              handleMarkerPress(venue);
            }}
            tracksViewChanges={trackMarkerChanges}
            zIndex={hasStories ? 200 : 100}
            anchor={{ x: 0.5, y: 1 }}
          >
            <View style={styles.markerContainer}>
              <View style={[styles.pinBubble, { backgroundColor: pinColor }]}>
                <MapPin color="#000" size={14} fill="#000" />
              </View>
              <View style={[styles.pinArrow, { borderTopColor: pinColor }]} />
            </View>
          </Marker>
        );
      });
  }, [venues, stories, trackMarkerChanges]);

  return (
    <View style={styles.container}>
      {/* Global Top Add Story Button */}
      <View style={[styles.topBarContainer, { top: insets.top + 16 }]}>
        <TouchableOpacity
          style={[styles.globalAddButton, !canAddGlobalStory && styles.globalAddButtonDisabled]}
          onPress={handleGlobalAddStory}
          activeOpacity={0.8}
        >
          <Camera color={canAddGlobalStory ? "#000" : "#888"} size={18} style={{ marginRight: 6 }} />
          <Text style={[styles.globalAddText, !canAddGlobalStory && styles.globalAddTextDisabled]}>
            Add Story
          </Text>
        </TouchableOpacity>
      </View>

      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={PROVIDER_GOOGLE}
        customMapStyle={DARK_MAP_STYLE}
        initialCamera={camera}
        showsUserLocation={true}
        showsMyLocationButton={false}
        showsCompass={false}
        showsScale={false}
        showsBuildings={true}
        showsTraffic={false}
        showsIndoors={false}
        loadingEnabled={true}
        loadingBackgroundColor="#121212"
        loadingIndicatorColor="#00FFCC"
        pitchEnabled={true}
        rotateEnabled={true}
        minZoomLevel={3}
        maxZoomLevel={18}
        onRegionChangeComplete={handleRegionChange}
        onMapReady={() => setIsMapReady(true)}
      >
        {/* ── Native Heatmap (KDE blending) ──────────────────────────────
             Uses react-native-maps's native Heatmap implementation which supports
             seamless blending and KDE (Kernel Density Estimation).
             Wrapped in StableHeatmap to prevent native tile cache wipe on
             unrelated parent re-renders (notifications, location, etc).       */}
        {/* Dynamically scale radius based on zoom level to keep geographic size constant and keep intensity strong */}
        {showHeatmapOverlay && (
          <StableHeatmap
            points={scaledPoints}
            radius={Platform.OS === 'android' ? 50 : 90}
          />
        )}
        {/* LiveVenue markers */}
        {renderedMarkers}
      </MapView>

      {/* Story Upload Overlay */}
      {isUploading && (
        <View style={styles.uploadOverlay}>
          <Text style={styles.uploadText}>Uploading Story...</Text>
        </View>
      )}

      {/* Hardware Debugging Panel */}
      {isDebugMode && (
        <View style={[styles.debugPanel, { top: insets.top + 80 }]}>
          <Text style={styles.debugTitle}>ENGINE DEBUG</Text>
          <TouchableOpacity onPress={() => setShowHeatmapOverlay(!showHeatmapOverlay)}>
            <Text style={styles.debugText}>[ {showHeatmapOverlay ? 'X' : ' '} ] KDE Heatmap Matrix</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowRawPoints(!showRawPoints)}>
            <Text style={styles.debugText}>[ {showRawPoints ? 'X' : ' '} ] Expose Raw Firebase Nodes</Text>
          </TouchableOpacity>
          <Text style={styles.debugText}>Active Heat LiveVenues: {heatPoints.length}</Text>
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
      {selectedMapVenue && (
        <View style={[styles.venueInfoCard, { bottom: insets.bottom + 20 }]}>
          {/* Top Banner Image with themed filter */}
          <View style={styles.cardImageContainer}>
            <VenueImage
              venue={selectedMapVenue}
              style={styles.cardImage}
              isBanner={true}
            />
            {/* Report Button overlaying the image */}
            <TouchableOpacity
              style={styles.reportCardButtonOverlay}
              onPress={handleReportVenue}
            >
              <Flag color="#FFF" size={16} />
            </TouchableOpacity>
            {/* Close Button overlaying the image */}
            <TouchableOpacity
              style={styles.closeCardButtonOverlay}
              onPress={() => setSelectedMapVenue(null)}
            >
              <X color="#FFF" size={18} />
            </TouchableOpacity>
          </View>

          <View style={styles.cardContent}>
            <Text style={styles.venueCardTitle} numberOfLines={1}>{selectedMapVenue.name}</Text>
            <Text style={styles.venueCardAddress} numberOfLines={1}>{selectedMapVenue.address || 'Nairobi, Kenya'}</Text>
            <Text style={styles.venueCardDescription} numberOfLines={2}>{selectedMapVenue.description}</Text>

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
        </View>
      )}

      <View style={[styles.controlsContainer, { bottom: insets.bottom + 120 }]}>
        {/* Debug Toggle Wrench */}
        {isAdmin && (
          <TouchableOpacity style={styles.controlButton} onPress={() => setIsDebugMode(!isDebugMode)} activeOpacity={0.7}>
            <Wrench color={isDebugMode ? "#FF00CC" : "#888"} size={20} />
          </TouchableOpacity>
        )}

        {/* Active Chats List Button */}
        <TouchableOpacity 
          style={[styles.controlButton, styles.chatListButton]} 
          onPress={() => setIsLiveFeedVisible(true)} 
          activeOpacity={0.7}
        >
          <MessageSquare color="#00FFCC" size={20} />
          {unreadChatCount > 0 && (
            <View style={styles.badgeContainer}>
              <Text style={styles.badgeText}>{unreadChatCount}</Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.controlButton} onPress={centerMap} activeOpacity={0.7}>
          <LocateFixed color="#00FFCC" size={20} />
        </TouchableOpacity>

        <View style={styles.zoomContainer}>
          <TouchableOpacity style={styles.controlButton} onPress={() => handleZoom(true)} activeOpacity={0.7}>
            <Plus color="#FFFFFF" size={24} />
          </TouchableOpacity>
          <View style={styles.controlDivider} />
          <TouchableOpacity style={styles.controlButton} onPress={() => handleZoom(false)} activeOpacity={0.7}>
            <Minus color="#FFFFFF" size={24} />
          </TouchableOpacity>
        </View>
      </View>

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
            zoom: 16,
            pitch: 45,
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
  topBarContainer: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
    zIndex: 10,
  },
  globalAddButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#00FFCC',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    gap: 8,
    shadowColor: '#00FFCC',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
  },
  globalAddButtonDisabled: {
    backgroundColor: 'rgba(26,26,26,0.9)',
    borderColor: '#444',
    borderWidth: 1,
    shadowOpacity: 0,
    elevation: 0,
  },
  globalAddText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
  },
  globalAddTextDisabled: {
    color: '#888',
    fontSize: 14,
  },
  debugPanel: {
    position: 'absolute',
    left: 16,
    backgroundColor: 'rgba(26,26,26,0.95)',
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FF00CC',
    zIndex: 100,
  },
  debugTitle: {
    color: '#FF00CC',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 8,
    letterSpacing: 2,
  },
  debugText: {
    color: '#00FFCC',
    fontSize: 14,
    marginVertical: 4,
    fontFamily: 'monospace',
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
  closeCardButtonOverlay: {
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
  reportCardButtonOverlay: {
    position: 'absolute',
    top: 12,
    right: 52,
    zIndex: 2,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
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
  zoomContainer: {
    backgroundColor: 'rgba(26, 26, 26, 0.9)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    overflow: 'hidden',
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
  chatListButton: {
    borderColor: '#00FFCC',
    shadowColor: '#00FFCC',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 6,
  },
  controlDivider: {
    height: 1,
    width: '100%',
    backgroundColor: '#2A2A2A',
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
