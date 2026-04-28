const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

// Initialize Firebase Admin (only if not already initialized to avoid errors)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
  });
}

const db = admin.firestore();
const rtdb = admin.database();

const VENUE_RADIUS_METERS = 200;
const NOTIFY_RADIUS_METERS = 5000; // 5km
const STALE_MS = 2 * 60 * 60 * 1000; // 2 hours for location staleness
const CRAZY_THRESHOLD = 75; // > 75 users

const THROTTLE_MS = 2 * 60 * 60 * 1000; // 2 hours cool-down per venue
const notificationThrottle = {};

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
async function sendPushNotification(expoPushToken, title, body) {
  const message = {
    to: expoPushToken,
    sound: 'default',
    title: title,
    body: body,
    data: { someData: 'goes here' },
  };

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });
    const receipt = await response.json();
    console.log(`Push notification sent to ${expoPushToken}`, receipt);
  } catch (error) {
    console.error(`Error sending push notification: ${error}`);
  }
}

async function startNotificationService() {
  console.log('Starting Notification Service...');
  
  // 1. Load Venues
  const venuesSnap = await db.collection('venues').get();
  if (venuesSnap.empty) {
    console.log('No venues found.');
    return;
  }
  const venues = venuesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  // 2. Poll Activity every 15 seconds
  setInterval(async () => {
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

    for (const venue of venues) {
      // Calculate active users at venue
      const userCount = activeLocations.filter(loc => 
        getDistanceInMeters(venue.latitude, venue.longitude, loc.latitude, loc.longitude) <= VENUE_RADIUS_METERS
      ).length;

      // Check if it crosses the "Crazy" threshold
      if (userCount > CRAZY_THRESHOLD) {
        const lastNotified = notificationThrottle[venue.id] || 0;
        
        // Check Throttle
        if (now - lastNotified > THROTTLE_MS) {
          console.log(`🔥 [ALERT] ${venue.name} is CRAZY! (${userCount} users). Dispatching pushes...`);
          
          // Dispatch notifications
          // Get users who have push tokens
          const usersSnap = await db.collection('users').where('expoPushToken', '!=', null).get();
          
          let dispatchedCount = 0;
          for (const userDoc of usersSnap.docs) {
            const userData = userDoc.data();
            const token = userData.expoPushToken;
            
            // We only notify them if they are nearby!
            const userLastLoc = realLocs[userDoc.id];
            if (userLastLoc) {
              const distance = getDistanceInMeters(venue.latitude, venue.longitude, userLastLoc.latitude, userLastLoc.longitude);
              
              if (distance <= NOTIFY_RADIUS_METERS) {
                await sendPushNotification(
                  token, 
                  `🔥 Crazy vibes at ${venue.name} right now!`,
                  `Over ${userCount} people are there. Check it out!`
                );
                dispatchedCount++;
              }
            }
          }
          console.log(`Dispatched ${dispatchedCount} pushes for ${venue.name}.`);
          
          // Update Throttle
          notificationThrottle[venue.id] = now;
        }
      }
    }

  }, 15000); // Check every 15s
}

startNotificationService().catch(console.error);
