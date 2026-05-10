import React, { useRef, useState, useEffect, useMemo } from 'react';
import * as Location from 'expo-location';
import { StyleSheet, View, Text, TouchableOpacity, Alert } from 'react-native';
import MapView, { PROVIDER_GOOGLE, Marker, Region, Heatmap } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LocateFixed, Plus, Minus, MapPin, Camera, Wrench, X } from 'lucide-react-native';
import { useLiveVenues, LiveVenue as LiveVenue } from '../hooks/useLiveVenues';
import * as ImagePicker from 'expo-image-picker';
import Toast from 'react-native-toast-message';
import { useStories } from '../hooks/useStories';
import { StoryViewer } from '../components/StoryViewer';
import { uploadStoryMedia, createStory } from '../services/storyService';
import { getDistanceInMeters } from '../utils/locationUtils';
import { useAppStore } from '../hooks/useAppStore';
import { VenueChat } from '../components/VenueChat';

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
  ({ points }: { points: { latitude: number; longitude: number; weight: number }[] }) => {
    React.useEffect(() => {
      console.log(`[HEATMAP-DEBUG] StableHeatmap MOUNTED with ${points.length} points`);
      return () => console.log('[HEATMAP-DEBUG] StableHeatmap UNMOUNTED');
    }, []);

    React.useEffect(() => {
      console.log(`[HEATMAP-DEBUG] StableHeatmap points CHANGED → ${points.length} points`);
    }, [points]);

    console.log(`[HEATMAP-DEBUG] StableHeatmap render() called. points.length=${points.length}`);

    if (points.length === 0) {
      console.log('[HEATMAP-DEBUG] StableHeatmap returning null (0 points)');
      return null;
    }
    return (
      <Heatmap
        points={points}
        radius={50}
        opacity={0.8}
        gradient={HEATMAP_GRADIENT}
      />
    );
  },
  (prevProps, nextProps) => {
    const same = prevProps.points === nextProps.points;
    if (!same) {
      console.log(`[HEATMAP-DEBUG] React.memo: points ref CHANGED (prev=${prevProps.points.length}, next=${nextProps.points.length}) → WILL re-render`);
    }
    return same;
  }
);

export const MapScreen = () => {
  const mapRef = useRef<MapView>(null);
  const insets = useSafeAreaInsets();
  const { venues, heatPoints } = useLiveVenues();
  const { user, selectedMapVenue, setSelectedMapLiveVenue, isAdmin } = useAppStore();
  const { stories } = useStories();

  // ─── Diagnostic: track every MapScreen render ───────────────────────────
  const renderCountRef = useRef(0);
  renderCountRef.current++;
  console.log(`[HEATMAP-DEBUG] MapScreen render #${renderCountRef.current} | heatPoints.length=${heatPoints.length} | showHeatmapOverlay=${true}`);

  const [userLocation, setUserLocation] = useState<Location.LocationObjectCoords | null>(null);
  const [selectedLiveVenue, setSelectedLiveVenue] = useState<LiveVenue | null>(null);
  const [isViewerVisible, setIsViewerVisible] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isChatVisible, setIsChatVisible] = useState(false);

  // Debug states
  const [isDebugMode, setIsDebugMode] = useState(false);
  const [showHeatmapOverlay, setShowHeatmapOverlay] = useState(true);
  const [showRawPoints, setShowRawPoints] = useState(false);

  // ─── Region + zoom tracking ───────────────────────────────────────────────
  // We track the current zoom level so we can convert screen-pixel sizes to
  // geo-accurate meter radii. This fixes the zoom-in issue (GitHub #371):
  // fixed-meter circles balloon on screen as you zoom in, but pixel-based
  // circles stay a constant visual size at all zoom levels.
  const [region, setRegion] = useState<Region | null>(null);
  const [currentZoom, setCurrentZoom] = useState(14);

  const handleRegionChange = (newRegion: Region) => {
    setRegion(newRegion);
    // Derive zoom from longitudeDelta: zoom ≈ log2(360 / longitudeDelta)
    if (newRegion.longitudeDelta > 0) {
      const zoom = Math.log2(360 / newRegion.longitudeDelta);
      setCurrentZoom(Math.max(1, Math.min(20, zoom)));
    }
  };

  // ─── Meters-per-pixel at a given zoom & latitude ─────────────────────────
  // Formula from Web Mercator: metersPerPx = 156543.03392 * cos(lat°) / 2^zoom
  // Source: https://wiki.openstreetmap.org/wiki/Zoom_levels
  const metersPerPixel = (lat: number, zoom: number): number => {
    return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
  };

  // Default to a lively city area for now
  const [camera, setCamera] = useState({
    center: {
      latitude: -1.286389,
      longitude: 36.817223,
    },
    pitch: 45, // Snap map 3D tilt
    heading: 0,
    altitude: 2000,
    zoom: 14,
  });

  // Effect to stop marker tracking after mount to boost performance
  const [trackMarkerChanges, setTrackMarkerChanges] = useState(true);
  useEffect(() => {
    setTrackMarkerChanges(true);
    const timer = setTimeout(() => setTrackMarkerChanges(false), 2000);
    return () => clearTimeout(timer);
  }, [venues, stories]);

  useEffect(() => {
    if (selectedMapVenue && mapRef.current) {
      mapRef.current.animateCamera({
        center: {
          latitude: selectedMapVenue.latitude,
          longitude: selectedMapVenue.longitude,
        },
        zoom: 17,
        pitch: 45,
      }, { duration: 1000 });
    }
  }, [selectedMapVenue]);

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
            pitch: 45,
            heading: location.coords.heading || 0,
            zoom: 16,
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
              console.error("Error auto-refreshing location:", e);
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
      console.error("Error zooming:", error);
    }
  };

  const handleMarkerPress = (venue: LiveVenue) => {
    setSelectedMapLiveVenue(venue);
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

        const downloadUrl = await uploadStoryMedia(uri, user.uid);
        await createStory(user.uid, downloadUrl, mediaType, targetVenue.id);

        Toast.show({
          type: 'success',
          text1: 'Story Added!',
          text2: 'Your story is now visible at this venue.',
        });
      }
    } catch (error) {
      console.error('Upload Error:', error);
      Toast.show({
        type: 'error',
        text1: 'Upload Failed',
        text2: 'Could not upload your story.',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleAddStory = () => {
    if (selectedLiveVenue) executeStoryUpload(selectedLiveVenue);
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
    if (closestLiveVenue.venue) executeStoryUpload(closestLiveVenue.venue);
  };
    
  // Safe distance check
  const isNearLiveVenue = selectedLiveVenue && userLocation ? 
    getDistanceInMeters(userLocation.latitude, userLocation.longitude, selectedLiveVenue.latitude, selectedLiveVenue.longitude) <= 200 
    : false;

  return (
    <View style={styles.container}>
      {/* Global Top Add Story Button */}
      <View style={[styles.topBarContainer, { top: insets.top + 16 }]}>
        <TouchableOpacity 
          style={[styles.globalAddButton, !canAddGlobalStory && styles.globalAddButtonDisabled]} 
          onPress={handleGlobalAddStory}
          disabled={!canAddGlobalStory}
        >
          <Camera color={canAddGlobalStory ? "#000" : "#888"} size={20} />
          <Text style={[styles.globalAddText, !canAddGlobalStory && styles.globalAddTextDisabled]}>
            {canAddGlobalStory ? "Add Story" : "Move closer to add"}
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
        onUserLocationChange={() => {}}
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
        maxZoomLevel={20}
        onRegionChangeComplete={handleRegionChange}
      >
        {/* ── Native Heatmap (KDE blending) ──────────────────────────────
             Uses react-native-maps's native Heatmap implementation which supports
             seamless blending and KDE (Kernel Density Estimation).
             Wrapped in StableHeatmap to prevent native tile cache wipe on
             unrelated parent re-renders (notifications, location, etc).       */}
        {showHeatmapOverlay && <StableHeatmap points={heatPoints} />}
        {/* LiveVenue markers */}
        {venues.map((venue) => {
          const venueStories = stories.filter(s => s.venue_id === venue.id);
          const hasStories = venueStories.length > 0;
          const pinColor = hasStories ? "#FF00CC" : "#00FFCC"; // Magenta if stories exist

          return (
            <Marker
              key={venue.id}
              coordinate={{ latitude: venue.latitude, longitude: venue.longitude }}
              onPress={(e) => {
                e.stopPropagation();
                handleMarkerPress(venue);
              }}
              tracksViewChanges={trackMarkerChanges}
            >
              <View style={styles.markerContainer}>
                {hasStories && <View style={styles.storyRing} />}
                <View style={[styles.markerGlow, hasStories && styles.markerGlowActive]} />
                <MapPin color={pinColor} fill={pinColor} size={24} />
              </View>
            </Marker>
          );
        })}
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
      {selectedLiveVenue && (
        <StoryViewer
          isVisible={isViewerVisible}
          onClose={() => setIsViewerVisible(false)}
          stories={stories.filter(s => s.venue_id === selectedLiveVenue.id)}
          venueName={selectedLiveVenue.name}
          canAddStory={Boolean(isNearLiveVenue)}
          onAddStory={handleAddStory}
        />
      )}

      {/* LiveVenue Chat Modal */}
      {selectedMapVenue && (
        <VenueChat
          isVisible={isChatVisible}
          onClose={() => setIsChatVisible(false)}
          venueId={selectedMapVenue.id}
          venueName={selectedMapVenue.name}
        />
      )}

      {/* LiveVenue Info Overlay Card */}
      {selectedMapVenue && (
        <View style={[styles.venueInfoCard, { bottom: insets.bottom + 40 }]}>
          <TouchableOpacity 
            style={styles.closeCardButton}
            onPress={() => setSelectedMapLiveVenue(null)}
          >
            <X color="#888" size={20} />
          </TouchableOpacity>
          <Text style={styles.venueCardTitle} numberOfLines={1}>{selectedMapVenue.name}</Text>
          <Text style={styles.venueCardAddress} numberOfLines={1}>{selectedMapVenue.address || 'Nairobi, Kenya'}</Text>
          <View style={styles.cardActionRow}>
            <TouchableOpacity 
              style={styles.viewStoriesBtn}
              onPress={() => {
                setSelectedLiveVenue(selectedMapVenue);
                setIsViewerVisible(true);
              }}
            >
              <Text style={styles.viewStoriesText}>View Stories</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.accessChatBtn}
              onPress={() => {
                setIsChatVisible(true);
              }}
            >
              <Text style={styles.accessChatText}>Access chat</Text>
            </TouchableOpacity>
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
  markerGlow: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0, 255, 204, 0.3)',
    shadowColor: '#00FFCC',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 10,
    elevation: 8,
  },
  markerGlowActive: {
    backgroundColor: 'rgba(255, 0, 204, 0.3)',
    shadowColor: '#FF00CC',
  },
  storyRing: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: '#FF00CC', // Instagram-like magenta color for active stories
    borderStyle: 'dashed',
  },
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
    right: 80, // leave space for controls
    backgroundColor: 'rgba(26,26,26,0.95)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#00FFCC',
    shadowColor: '#00FFCC',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
    zIndex: 20,
  },
  closeCardButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 2,
    padding: 4,
  },
  venueCardTitle: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 4,
    paddingRight: 24,
  },
  venueCardAddress: {
    color: '#AAA',
    fontSize: 14,
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
  controlDivider: {
    height: 1,
    width: '100%',
    backgroundColor: '#2A2A2A',
  },
});
