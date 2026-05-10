import { LiveVenue } from '../hooks/useLiveVenues';

// Haversine formula to calculate distance between two coordinates in meters
export function getDistanceInMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3; // Earth radius in meters
  const rad = Math.PI / 180;
  const phi1 = lat1 * rad;
  const phi2 = lat2 * rad;
  const deltaPhi = (lat2 - lat1) * rad;
  const deltaLambda = (lon2 - lon1) * rad;

  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

export function findNearestLiveVenue(
  userLat: number, 
  userLng: number, 
  venues: LiveVenue[], 
  maxDistanceMeters = 200
): LiveVenue | null {
  let nearestLiveVenue: LiveVenue | null = null;
  let minDistance = Infinity;

  venues.forEach(venue => {
    const distance = getDistanceInMeters(userLat, userLng, venue.latitude, venue.longitude);
    if (distance <= maxDistanceMeters && distance < minDistance) {
      minDistance = distance;
      nearestLiveVenue = venue;
    }
  });

  return nearestLiveVenue;
}
