const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
});

const db = admin.firestore();
const rtdb = admin.database();

const MAX_RADIUS_METERS = 200; // Roam within 200m
const UPDATE_INTERVAL_MS = 15000; // Update every 15 seconds
const DEFAULT_USERS_PER_VENUE = 80;

// Helper to calculate a new location within distance
function offsetLocation(lat, lon, maxDistanceMeters) {
  const radiusInDegrees = maxDistanceMeters / 111111;
  const u = Math.random();
  const v = Math.random();
  const w = radiusInDegrees * Math.sqrt(u);
  const t = 2 * Math.PI * v;
  const x = w * Math.cos(t);
  const y = w * Math.sin(t);
  
  const newLat = lat + x;
  const newLon = lon + y / Math.cos(lat * Math.PI / 180);
  
  return { latitude: newLat, longitude: newLon };
}

// Helper to move a bit towards target or randomly
function moveLocation(currentLat, currentLon, centerLat, centerLon, stepMeters) {
  let { latitude, longitude } = offsetLocation(currentLat, currentLon, stepMeters);
  
  const distance = getDistanceInMeters(latitude, longitude, centerLat, centerLon);
  if (distance > MAX_RADIUS_METERS) {
     return {
       latitude: (latitude + centerLat) / 2,
       longitude: (longitude + centerLon) / 2
     }
  }
  return { latitude, longitude };
}

function getDistanceInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

let simulatedUsers = [];

function syncVenueUsers(venue, targetCount) {
  // Count how many users we currently have for this venue
  const currentUsers = simulatedUsers.filter(u => u.venueId === venue.id);
  const currentCount = currentUsers.length;

  if (currentCount < targetCount) {
    // Need to spawn more
    const toSpawn = targetCount - currentCount;
    for (let i = 0; i < toSpawn; i++) {
      const loc = offsetLocation(venue.latitude, venue.longitude, MAX_RADIUS_METERS / 2);
      simulatedUsers.push({
        user_id: `sim_${venue.id}_${Date.now()}_${i}`,
        venueId: venue.id,
        centerLat: venue.latitude,
        centerLon: venue.longitude,
        latitude: loc.latitude,
        longitude: loc.longitude,
        timestamp: Date.now()
      });
    }
    console.log(`[+] Spawned ${toSpawn} new users for venue ${venue.name}. Total: ${targetCount}`);
  } else if (currentCount > targetCount) {
    // Need to despawn
    const toRemove = currentCount - targetCount;
    
    // Grab the ones we want to remove
    const despawnList = currentUsers.slice(0, toRemove).map(u => u.user_id);
    
    // Remove from active array
    simulatedUsers = simulatedUsers.filter(u => !despawnList.includes(u.user_id));
    
    // Remove from RTDB
    const locationsRef = rtdb.ref('simulated_locations');
    const updates = {};
    despawnList.forEach(uid => {
      updates[uid] = null;
    });
    
    locationsRef.update(updates).catch(console.error);
    console.log(`[-] Despawned ${toRemove} users from venue ${venue.name}. Total: ${targetCount}`);
  }
}

async function startSimulation() {
  console.log('Starting dynamic simulation server...');
  
  // Listen to changes in venues dynamically
  db.collection('venues').onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      const venue = { id: change.doc.id, ...change.doc.data() };
      const targetCount = venue.simulatedUsersCount !== undefined ? venue.simulatedUsersCount : DEFAULT_USERS_PER_VENUE;

      if (change.type === 'added' || change.type === 'modified') {
        syncVenueUsers(venue, targetCount);
      }
      
      if (change.type === 'removed') {
        syncVenueUsers(venue, 0); // Remove all users for this venue
      }
    });
  });

  // Run update loop immediately and then every UPDATE_INTERVAL_MS
  const tick = () => {
    if (simulatedUsers.length === 0) return;
    
    const locationsRef = rtdb.ref('simulated_locations');
    const updates = {};
    const now = Date.now();

    simulatedUsers.forEach(u => {
      // Move them ~15 meters per tick
      const nextLoc = moveLocation(u.latitude, u.longitude, u.centerLat, u.centerLon, 15);
      u.latitude = nextLoc.latitude;
      u.longitude = nextLoc.longitude;
      u.timestamp = now;

      updates[u.user_id] = {
        latitude: u.latitude,
        longitude: u.longitude,
        timestamp: u.timestamp,
        user_id: u.user_id
      };
    });

    locationsRef.update(updates)
      .then(() => console.log(`[${new Date().toISOString()}] Updated ${simulatedUsers.length} simulated locations.`))
      .catch(err => console.error('Failed to update RTDB:', err));
  };

  setInterval(tick, UPDATE_INTERVAL_MS);
}

startSimulation().catch(console.error);
