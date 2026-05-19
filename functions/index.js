const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();
const rtdb = admin.database();

const VENUE_RADIUS_METERS = 200;
const STALE_MS = 2 * 60 * 60 * 1000; // 2 hours for location staleness
const CRAZY_THRESHOLD = 75; // > 75 users

const THROTTLE_MS = 2 * 60 * 60 * 1000; // 2 hours cool-down per venue

// Helper: Haversine distance
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

// Helper: Send Expo Push Notification
async function sendPushNotification(expoPushToken, title, body, data = {}) {
  if (!expoPushToken || expoPushToken.includes('Simulator-Mock-Token')) {
    return;
  }

  const message = {
    to: expoPushToken,
    sound: 'default',
    title: title,
    body: body,
    data: data,
  };

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });
    const receipt = await response.json();
    if (receipt?.data?.status === 'error') {
      console.warn(`Push failed for ${expoPushToken}:`, receipt.data.message);
    }
  } catch (error) {
    console.error(`Error sending push notification: ${error}`);
  }
}

exports.notifyHotVenues = functions.pubsub.schedule("every 5 minutes").onRun(async (context) => {
  console.log('Running scheduled notification service...');
  
  // 1. Load Venues
  const venuesSnap = await db.collection('venues').get();
  if (venuesSnap.empty) {
    console.log('No venues found.');
    return;
  }
  const venues = venuesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  const now = Date.now();
  
  // Fetch real user locations
  const locsSnap = await rtdb.ref('locations').once('value');
  const realLocs = locsSnap.exists() ? locsSnap.val() : {};

  // Fetch simulated user locations
  const simLocsSnap = await rtdb.ref('simulated_locations').once('value');
  const simLocs = simLocsSnap.exists() ? simLocsSnap.val() : {};

  const allLocs = { ...realLocs, ...simLocs };
  
  // Filter out stale locations
  const activeLocations = Object.values(allLocs).filter(loc => 
    loc.latitude && loc.longitude && (now - loc.timestamp < STALE_MS)
  );

  // Fetch global throttle state from firestore or memory (memory is unreliable in serverless, so we use firestore)
  const throttleDocRef = db.collection('system').doc('notificationThrottle');
  let notificationThrottle = {};
  try {
    const throttleDoc = await throttleDocRef.get();
    if (throttleDoc.exists) {
      notificationThrottle = throttleDoc.data();
    }
  } catch(e) {
    console.error("Could not fetch throttle data:", e);
  }

  let throttleUpdated = false;

  // Cache users to avoid querying inside loop
  let usersSnap = null;

  for (const venue of venues) {
    const userCount = activeLocations.filter(loc => 
      getDistanceInMeters(venue.latitude, venue.longitude, loc.latitude, loc.longitude) <= VENUE_RADIUS_METERS
    ).length;

    if (userCount > CRAZY_THRESHOLD) {
      const lastNotified = notificationThrottle[venue.id] || 0;
      
      if (now - lastNotified > THROTTLE_MS) {
        console.log(`🔥 [ALERT] ${venue.name} is CRAZY! (${userCount} users). Dispatching pushes...`);
        
        if (!usersSnap) {
          usersSnap = await db.collection('users').where('expoPushToken', '!=', null).get();
        }
        
        let dispatchedCount = 0;
        for (const userDoc of usersSnap.docs) {
          const userData = userDoc.data();
          const token = userData.expoPushToken;
          if (!token) continue;

          await sendPushNotification(
            token,
            `🔥 Crazy vibes at ${venue.name} right now!`,
            `Over ${userCount} people are there. Check it out!`,
            { venueId: venue.id }
          );
          dispatchedCount++;
        }
        console.log(`Dispatched ${dispatchedCount} pushes for ${venue.name}.`);
        
        notificationThrottle[venue.id] = now;
        throttleUpdated = true;
      }
    }
  }

  if (throttleUpdated) {
    await throttleDocRef.set(notificationThrottle, { merge: true });
  }

  console.log("Finished scheduled notification run.");
});
