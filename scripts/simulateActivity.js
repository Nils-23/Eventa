const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
});

const db = admin.firestore();
const rtdb = admin.database();

const USERS_PER_VENUE = 12;
const MAX_RADIUS_METERS = 200; // Roam within 200m
const UPDATE_INTERVAL_MS = 15000; // Update every 15 seconds

// Helper to calculate a new location within distance
function offsetLocation(lat, lon, maxDistanceMeters) {
  // 1 degree of latitude is ~111,111 meters
  const radiusInDegrees = maxDistanceMeters / 111111;
  const u = Math.random();
  const v = Math.random();
  const w = radiusInDegrees * Math.sqrt(u);
  const t = 2 * Math.PI * v;
  const x = w * Math.cos(t);
  const y = w * Math.sin(t);
  
  // Adjust longitude based on latitude
  const newLat = lat + x;
  const newLon = lon + y / Math.cos(lat * Math.PI / 180);
  
  return { latitude: newLat, longitude: newLon };
}

// Helper to move a bit towards target or randomly
function moveLocation(currentLat, currentLon, centerLat, centerLon, stepMeters) {
  // Move randomly by stepMeters
  let { latitude, longitude } = offsetLocation(currentLat, currentLon, stepMeters);
  
  // Keep it within max radius
  const distance = getDistanceInMeters(latitude, longitude, centerLat, centerLon);
  if (distance > MAX_RADIUS_METERS) {
     // Pull back towards center
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

async function startSimulation() {
  console.log('Loading venues from Firestore...');
  const snapshot = await db.collection('venues').get();
  
  if (snapshot.empty) {
    console.log('No venues found. Make sure to run seedVenues.js first.');
    process.exit(1);
  }

  const venues = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  console.log(`Loaded ${venues.length} venues.`);

  // Generate initial fake users
  venues.forEach(venue => {
    for (let i = 0; i < USERS_PER_VENUE; i++) {
      const id = `sim_${venue.id}_${i}`;
      const loc = offsetLocation(venue.latitude, venue.longitude, MAX_RADIUS_METERS / 2);
      simulatedUsers.push({
        user_id: id,
        venueId: venue.id,
        centerLat: venue.latitude,
        centerLon: venue.longitude,
        latitude: loc.latitude,
        longitude: loc.longitude,
        timestamp: Date.now()
      });
    }
  });

  console.log(`Spawned ${simulatedUsers.length} simulated users. Starting simulation loop...`);

  // Run update loop immediately and then every UPDATE_INTERVAL_MS
  const tick = () => {
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

    locationsRef.set(updates)
      .then(() => console.log(`[${new Date().toISOString()}] Updated ${simulatedUsers.length} simulated locations.`))
      .catch(err => console.error('Failed to update RTDB:', err));
  };

  tick();
  setInterval(tick, UPDATE_INTERVAL_MS);
}

startSimulation().catch(console.error);
