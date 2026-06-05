const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
});

const db = admin.firestore();
const rtdb = admin.database();

const VENUE_RADIUS_METERS = 200;
const STALE_MS = 2 * 60 * 60 * 1000;
const CRAZY_THRESHOLD = 75;

// Haversine distance
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

// Simulated mock fetch for testing push notification
let sentPushes = [];
async function mockSendPushNotification(expoPushToken, title, body, data = {}) {
  console.log(`[PUSH SENT] To: ${expoPushToken} | Title: "${title}" | Body: "${body}"`);
  sentPushes.push({ expoPushToken, title, body, data });
}

// Logic: sendRateLimitedPushNotification
async function sendRateLimitedPushNotification(userId, title, body, data = {}, throttleKey = null, throttleDurationMs = 0) {
  if (!userId) return false;
  
  const userRef = db.collection('users').doc(userId);
  
  try {
    const token = await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      if (!userDoc.exists) return null;
      
      const userData = userDoc.data();
      const expoPushToken = userData.expoPushToken;
      if (!expoPushToken || expoPushToken.includes('Simulator-Mock-Token')) return null;

      const nowMs = Date.now();
      const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());
      const lastDate = userData.lastNotificationDate || "";
      let count = userData.notificationCountToday || 0;
      
      if (lastDate === dateStr) {
        if (count >= 5) {
          console.log(`User ${userId} reached daily limit of 5. Skipping.`);
          return null;
        }
        count++;
      } else {
        count = 1;
      }

      let throttles = userData.notificationThrottles || {};
      const cleanedThrottles = {};
      for (const [k, ts] of Object.entries(throttles)) {
        if (nowMs - ts < 24 * 60 * 60 * 1000) {
          cleanedThrottles[k] = ts;
        }
      }
      
      if (throttleKey) {
        const lastSent = cleanedThrottles[throttleKey] || 0;
        if (nowMs - lastSent < throttleDurationMs) {
          console.log(`Notification for user ${userId} with throttleKey ${throttleKey} is throttled.`);
          return null;
        }
        cleanedThrottles[throttleKey] = nowMs;
      }

      transaction.update(userRef, {
        lastNotificationDate: dateStr,
        notificationCountToday: count,
        notificationThrottles: cleanedThrottles
      });

      return expoPushToken;
    });

    if (token) {
      await mockSendPushNotification(token, title, body, data);
      return true;
    }
  } catch (error) {
    console.error(`Error in sendRateLimitedPushNotification for user ${userId}:`, error);
  }
  return false;
}

async function runTests() {
  console.log("=== STARTING NOTIFICATION SYSTEM TEST ===");
  
  const testUserId = "test_user_notification_sys";
  const testVenueId = "test_venue_notification_sys";
  
  // 1. Setup Test User in Firestore
  console.log("\n1. Setting up test user...");
  await db.collection('users').doc(testUserId).set({
    username: "Test Notification User",
    expoPushToken: "ExponentPushToken[test-user-token-12345]",
    notificationCountToday: 0,
    lastNotificationDate: "",
    notificationThrottles: {}
  });

  // 2. Setup Test Venue in Firestore
  console.log("2. Setting up test venue...");
  await db.collection('venues').doc(testVenueId).set({
    name: "Test VIP Lounge",
    latitude: -1.2833, // Nairobi Central coords
    longitude: 36.8219,
    description: "A cool test venue for notifications",
    isCrazy: false,
    activityLevel: "None"
  });

  // 3. Test daily frequency rate-limiting (max 5)
  console.log("\n3. Testing daily rate limiting (should stop after 5 sends)...");
  sentPushes = [];
  for (let i = 0; i < 7; i++) {
    console.log(`Attempt ${i + 1}:`);
    await sendRateLimitedPushNotification(testUserId, "Test Title", `Message ${i + 1}`);
  }
  console.log(`Sent pushes count: ${sentPushes.length} (Expected: 5)`);
  if (sentPushes.length !== 5) {
    throw new Error("Daily frequency rate limit check failed!");
  }
  console.log("Daily rate limit check passed!");

  // Reset rate limits for further testing
  await db.collection('users').doc(testUserId).update({
    notificationCountToday: 0,
    lastNotificationDate: "",
    notificationThrottles: {}
  });

  // 4. Test Event/Venue Throttling
  console.log("\n4. Testing Event/Venue Throttling (should skip second consecutive send)...");
  sentPushes = [];
  const throttleKey = `test_throttle_${testVenueId}`;
  const throttleDuration = 10000; // 10 seconds for test
  
  // Attempt 1: Should succeed
  await sendRateLimitedPushNotification(testUserId, "Throttle Test 1", "Hello 1", {}, throttleKey, throttleDuration);
  // Attempt 2: Should be throttled
  await sendRateLimitedPushNotification(testUserId, "Throttle Test 2", "Hello 2", {}, throttleKey, throttleDuration);
  
  console.log(`Sent pushes count: ${sentPushes.length} (Expected: 1)`);
  if (sentPushes.length !== 1) {
    throw new Error("Event/Venue throttling failed!");
  }
  console.log("Event/Venue throttling passed!");

  // Reset rate limits & throttles
  await db.collection('users').doc(testUserId).update({
    notificationCountToday: 0,
    lastNotificationDate: "",
    notificationThrottles: {}
  });

  // 5. Test Social/Engagement chat activity notifications
  console.log("\n5. Testing Social/Engagement chat activity trigger...");
  // Mark user as active member of test venue chat
  await rtdb.ref(`venue_members/${testVenueId}/${testUserId}`).set({
    lastInteractionTime: Date.now()
  });

  // Simulate onNewChatMessage logic
  const simulateNewMessage = async (senderId) => {
    sentPushes = [];
    const membersSnap = await rtdb.ref(`venue_members/${testVenueId}`).once('value');
    if (!membersSnap.exists()) return;
    
    const members = membersSnap.val();
    const activeMembers = Object.keys(members).filter(uid => {
      if (uid === senderId) return false;
      const lastInteraction = members[uid].lastInteractionTime || 0;
      return (Date.now() - lastInteraction) < (24 * 60 * 60 * 1000);
    });

    console.log(`Simulating message from ${senderId}. Active members to notify:`, activeMembers);

    for (const memberId of activeMembers) {
      await sendRateLimitedPushNotification(
        memberId,
        `💬 Activity in Test VIP Lounge`,
        `Activity is picking up in your event chat`,
        { venueId: testVenueId },
        `chat_${testVenueId}`,
        1 * 60 * 60 * 1000
      );
    }
  };

  await simulateNewMessage("another_user_abc");
  console.log(`Sent pushes count: ${sentPushes.length} (Expected: 1)`);
  if (sentPushes.length !== 1 || sentPushes[0].title !== "💬 Activity in Test VIP Lounge") {
    throw new Error("Social chat activity notification failed!");
  }
  console.log("Social chat activity notification passed!");

  // Reset rate limits & throttles
  await db.collection('users').doc(testUserId).update({
    notificationCountToday: 0,
    lastNotificationDate: "",
    notificationThrottles: {}
  });

  // 6. Test Live Activity signals & Proximity Alert in Scheduled Function
  console.log("\n6. Testing Scheduled Function Notification Logic...");
  
  // Set up user's location to be nearby the venue (e.g. 500 meters away)
  // Venue is at -1.2833, 36.8219. Let's offset by ~0.004 degrees lat (~440m)
  await rtdb.ref(`locations/${testUserId}`).set({
    latitude: -1.2833 + 0.004,
    longitude: 36.8219,
    timestamp: Date.now()
  });

  const simulateScheduledNotification = async () => {
    sentPushes = [];
    const now = Date.now();
    const notifiedUserIds = new Set();
    
    const venuesSnap = await db.collection('venues').get();
    const venues = venuesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const locsSnap = await rtdb.ref('locations').once('value');
    const realLocs = locsSnap.exists() ? locsSnap.val() : {};

    const simLocsSnap = await rtdb.ref('simulated_locations').once('value');
    const simLocs = simLocsSnap.exists() ? simLocsSnap.val() : {};

    // Load simulation settings from Firestore
    let simEnabled = true;
    let simThreshold = 100;
    try {
      const simSettingsDoc = await db.collection('settings').doc('simulation').get();
      if (simSettingsDoc.exists) {
        const data = simSettingsDoc.data();
        if (data.enabled !== undefined) simEnabled = data.enabled;
        if (data.threshold !== undefined) simThreshold = data.threshold;
      }
    } catch (err) {
      console.warn('Failed to load simulation settings:', err);
    }

    // Get active real locations
    const activeRealLocs = Object.entries(realLocs)
      .map(([uid, loc]) => ({ ...loc, user_id: uid }))
      .filter(loc => loc.latitude && loc.longitude && (now - loc.timestamp < STALE_MS));
    const activeRealCount = activeRealLocs.length;

    const includeSimulated = simEnabled && (activeRealCount < simThreshold);

    // Get active simulated locations
    const activeSimLocs = Object.entries(simLocs)
      .map(([uid, loc]) => ({ ...loc, user_id: uid }))
      .filter(loc => loc.latitude && loc.longitude && (now - loc.timestamp < STALE_MS));
    const isEngineActive = activeSimLocs.length > 0;

    // Build active locations list mirroring app behavior
    const activeLocations = [];
    activeLocations.push(...activeRealLocs);
    if (includeSimulated) {
      activeLocations.push(...activeSimLocs);
    }

    const usersSnap = await db.collection('users').where('expoPushToken', '!=', null).get();
    const allUsersWithToken = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    for (const venue of venues) {
      if (venue.id !== testVenueId) continue; // Only test our test venue

      const currentUsersAtVenue = activeLocations
        .filter(loc => {
          if (loc.venueId) return loc.venueId === venue.id;
          return getDistanceInMeters(venue.latitude, venue.longitude, loc.latitude, loc.longitude) <= VENUE_RADIUS_METERS;
        })
        .map(loc => loc.user_id || 'unknown')
        .filter(uid => uid !== 'unknown');

      // Calculate user count exactly like the app (including simulated defaults)
      const realUserCount = activeRealLocs.filter(loc => {
        if (loc.venueId) return loc.venueId === venue.id;
        return getDistanceInMeters(venue.latitude, venue.longitude, loc.latitude, loc.longitude) <= VENUE_RADIUS_METERS;
      }).length;

      const rtdbSimCount = activeSimLocs.filter(loc => {
        if (loc.venueId) return loc.venueId === venue.id;
        return getDistanceInMeters(venue.latitude, venue.longitude, loc.latitude, loc.longitude) <= VENUE_RADIUS_METERS;
      }).length;

      let simUserCount = 0;
      if (includeSimulated) {
        const customAdminCount = venue.simulatedUsersCount !== undefined ? venue.simulatedUsersCount : 20;
        simUserCount = isEngineActive ? Math.max(rtdbSimCount, customAdminCount) : customAdminCount;
      }

      const userCount = realUserCount + simUserCount;

      let liveNotificationMessage = null;
      let joinsCount = 0;

      // Join Spike
      const presenceRef = rtdb.ref(`venue_presence/${venue.id}`);
      const presenceSnap = await presenceRef.once('value');
      const oldPresence = presenceSnap.exists() ? presenceSnap.val() : {};
      const newPresence = {};

      for (const uid of currentUsersAtVenue) {
        if (oldPresence[uid]) {
          newPresence[uid] = oldPresence[uid];
        } else {
          newPresence[uid] = now;
        }
        if (now - newPresence[uid] < 15 * 60 * 1000) {
          joinsCount++;
        }
      }
      await presenceRef.set(newPresence);

      // Chat Spike
      const tenMinAgo = now - 10 * 60 * 1000;
      const recentMessagesSnap = await rtdb.ref(`venue_chats/${venue.id}`)
        .orderByChild('timestamp')
        .startAt(tenMinAgo)
        .once('value');
      const recentMessagesCount = recentMessagesSnap.exists() ? Object.keys(recentMessagesSnap.val()).length : 0;

      const isVenueMarkedCrazy = venue.isCrazy === true || venue.activityLevel === 'Crazy' || userCount > CRAZY_THRESHOLD;

      if (joinsCount >= 5) {
        liveNotificationMessage = `👀 ${userCount} people are at ${venue.name}`;
      } else if (recentMessagesCount >= 10) {
        liveNotificationMessage = `🔥 ${venue.name} is heating up right now`;
      } else if (isVenueMarkedCrazy) {
        liveNotificationMessage = `🎉 Something’s happening at ${venue.name}`;
      }

      if (liveNotificationMessage) {
        console.log(`[TEST LIVE ACTIVITY] Triggered: "${liveNotificationMessage}"`);
        for (const user of allUsersWithToken) {
          if (currentUsersAtVenue.includes(user.id)) continue;
          if (notifiedUserIds.has(user.id)) continue;

          const sent = await sendRateLimitedPushNotification(
            user.id,
            `🔥 Live Activity`,
            liveNotificationMessage,
            { venueId: venue.id },
            `live_${venue.id}`,
            4 * 60 * 60 * 1000
          );
          if (sent) {
            notifiedUserIds.add(user.id);
          }
        }
      }

      const isPopular = userCount >= 10;
      if (isPopular) {
        console.log(`[TEST PROXIMITY] Venue is popular. Checking nearby users...`);
        for (const [userId, loc] of Object.entries(realLocs)) {
          if (!loc.latitude || !loc.longitude || (now - loc.timestamp >= STALE_MS)) continue;

          const dist = getDistanceInMeters(venue.latitude, venue.longitude, loc.latitude, loc.longitude);
          if (dist > VENUE_RADIUS_METERS && dist <= 2500) {
            if (notifiedUserIds.has(userId)) continue;

            const sent = await sendRateLimitedPushNotification(
              userId,
              `📍 Popular nearby`,
              `Something popular happening near you`,
              { venueId: venue.id },
              `nearby_${venue.id}`,
              6 * 60 * 60 * 1000
            );
            if (sent) {
              notifiedUserIds.add(userId);
            }
          }
        }
      }
    }
  };

  // 6a. Test Proximity Alert when venue is popular
  console.log("\n6a. Testing proximity alert (simulating 10 users at venue, test user nearby)...");
  // Simulate 10 locations inside venue radius
  const simUpdates = {};
  const presenceUpdates = {};
  const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
  for (let i = 0; i < 10; i++) {
    const uid = `sim_user_prox_${i}`;
    simUpdates[uid] = {
      latitude: -1.2833,
      longitude: 36.8219,
      timestamp: Date.now()
    };
    presenceUpdates[uid] = thirtyMinAgo;
  }
  await rtdb.ref('simulated_locations').update(simUpdates);
  await rtdb.ref(`venue_presence/${testVenueId}`).update(presenceUpdates);
  
  await simulateScheduledNotification();
  console.log(`Sent pushes count: ${sentPushes.length} (Expected: 1 - proximity alert)`);
  if (sentPushes.length !== 1 || sentPushes[0].title !== "📍 Popular nearby") {
    throw new Error("Proximity alert test failed!");
  }
  console.log("Proximity alert test passed!");

  // Reset rate limits/throttles
  await db.collection('users').doc(testUserId).update({
    notificationCountToday: 0,
    lastNotificationDate: "",
    notificationThrottles: {}
  });

  // Clean simulated locations
  await rtdb.ref('simulated_locations').set(null);

  // 6b. Test Live Activity: Join Spike (5+ joins)
  console.log("\n6b. Testing Live Activity: Join Spike...");
  // Setup 5 simulated users joining now
  const joinsUpdates = {};
  for (let i = 0; i < 6; i++) {
    joinsUpdates[`sim_user_join_${i}`] = {
      latitude: -1.2833,
      longitude: 36.8219,
      timestamp: Date.now()
    };
  }
  await rtdb.ref('simulated_locations').update(joinsUpdates);

  // Clear presence to ensure they are new joins
  await rtdb.ref(`venue_presence/${testVenueId}`).set(null);

  await simulateScheduledNotification();
  console.log(`Sent pushes count: ${sentPushes.length} (Expected: 1 - join spike)`);
  if (sentPushes.length !== 1 || !sentPushes[0].body.includes("people are at")) {
    throw new Error("Live activity: Join spike test failed!");
  }
  console.log("Live activity: Join spike test passed!");

  // Reset rate limits/throttles
  await db.collection('users').doc(testUserId).update({
    notificationCountToday: 0,
    lastNotificationDate: "",
    notificationThrottles: {}
  });

  // Clean simulated locations
  await rtdb.ref('simulated_locations').set(null);

  // 6c. Test Live Activity: Chat Spike (10+ messages in last 10 minutes)
  console.log("\n6c. Testing Live Activity: Chat Spike...");
  // Push 11 chat messages
  const chatsRef = rtdb.ref(`venue_chats/${testVenueId}`);
  await chatsRef.set(null);
  for (let i = 0; i < 11; i++) {
    await chatsRef.push().set({
      user_id: `sender_${i}`,
      username: `User ${i}`,
      message: `Message ${i}`,
      timestamp: Date.now()
    });
  }

  await simulateScheduledNotification();
  console.log(`Sent pushes count: ${sentPushes.length} (Expected: 1 - chat spike)`);
  if (sentPushes.length !== 1 || !sentPushes[0].body.includes("heating up right now")) {
    throw new Error("Live activity: Chat spike test failed!");
  }
  console.log("Live activity: Chat spike test passed!");

  // Reset rate limits/throttles
  await db.collection('users').doc(testUserId).update({
    notificationCountToday: 0,
    lastNotificationDate: "",
    notificationThrottles: {}
  });

  // 6d. Test Live Activity: Crazy Status
  console.log("\n6d. Testing Live Activity: Crazy Status...");
  // Clear chats
  await chatsRef.set(null);
  // Mark venue crazy
  await db.collection('venues').doc(testVenueId).update({
    isCrazy: true
  });

  await simulateScheduledNotification();
  console.log(`Sent pushes count: ${sentPushes.length} (Expected: 1 - crazy status)`);
  if (sentPushes.length !== 1 || !sentPushes[0].body.includes("Something’s happening at")) {
    throw new Error("Live activity: Crazy status test failed!");
  }
  console.log("Live activity: Crazy status test passed!");

  // Cleanup Database
  console.log("\nCleaning up test data...");
  await db.collection('users').doc(testUserId).delete();
  await db.collection('venues').doc(testVenueId).delete();
  await rtdb.ref(`venue_members/${testVenueId}`).set(null);
  await rtdb.ref(`locations/${testUserId}`).set(null);
  await rtdb.ref(`venue_presence/${testVenueId}`).set(null);
  await rtdb.ref(`venue_chats/${testVenueId}`).set(null);
  await rtdb.ref('simulated_locations').set(null);

  console.log("\n=== ALL TESTS PASSED SUCCESSFULLY! ===");
  process.exit(0);
}

runTests().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
