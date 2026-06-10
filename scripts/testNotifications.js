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
async function mockSendPushNotification(userId, expoPushToken, title, body, data = {}) {
  console.log(`[PUSH SENT] To: ${expoPushToken} | Title: "${title}" | Body: "${body}"`);
  sentPushes.push({ userId, expoPushToken, title, body, data });
}

// Logic: sendRateLimitedPushNotification
async function sendRateLimitedPushNotification(userId, title, body, data = {}, throttleKey = null, throttleDurationMs = 0, bypassLimits = false, bypassDailyLimit = false) {
  if (!userId) return false;
  
  const userRef = db.collection('users').doc(userId);
  
  try {
    const token = await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      if (!userDoc.exists) return null;
      
      const userData = userDoc.data();
      const expoPushToken = userData.expoPushToken;
      if (!expoPushToken || expoPushToken.includes('Simulator-Mock-Token')) return null;

      if (bypassLimits) {
        return expoPushToken;
      }

      const nowMs = Date.now();

      // Hourly throttle for live notifications (max 2 per hour)
      let liveTimes = userData.liveNotificationTimes || [];
      if (data && data.type === 'live') {
        const oneHourAgo = nowMs - (1 * 60 * 60 * 1000);
        liveTimes = liveTimes.filter(ts => ts > oneHourAgo);
        
        if (liveTimes.length >= 2) {
          console.log(`User ${userId} reached hourly limit of 2 live notifications. Skipping.`);
          return null;
        }
        liveTimes.push(nowMs);
      }

      const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());
      const lastDate = userData.lastNotificationDate || "";
      let count = userData.notificationCountToday || 0;
      
      if (!bypassDailyLimit) {
        if (lastDate === dateStr) {
          if (count >= 5) {
            console.log(`User ${userId} reached daily limit of 5. Skipping.`);
            return null;
          }
          count++;
        } else {
          count = 1;
        }
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

      const updateData = {
        lastNotificationDate: dateStr,
        notificationThrottles: cleanedThrottles
      };
      if (!bypassDailyLimit) {
        updateData.notificationCountToday = count;
      }
      if (data && data.type === 'live') {
        updateData.liveNotificationTimes = liveTimes;
      }

      transaction.update(userRef, updateData);

      return expoPushToken;
    });

    if (token) {
      await mockSendPushNotification(userId, token, title, body, data);
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
  await db.collection('users').doc(testUserId).set({
    username: "Test Notification User",
    expoPushToken: "ExponentPushToken[test-user-token-12345]",
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
  await db.collection('users').doc(testUserId).set({
    username: "Test Notification User",
    expoPushToken: "ExponentPushToken[test-user-token-12345]",
    notificationCountToday: 0,
    lastNotificationDate: "",
    notificationThrottles: {}
  });

  // 5. Test Social/Engagement chat activity notifications
  console.log("\n5. Testing Social/Engagement chat activity trigger...");

  // Simulate onNewChatMessage logic
  const simulateNewMessage = async (senderId, messageData) => {
    sentPushes = [];
    const now = Date.now();
    const ONE_HOUR = 1 * 60 * 60 * 1000;

    const venueSnap = await db.collection('venues').doc(testVenueId).get();
    if (!venueSnap.exists) return;
    const venueName = venueSnap.exists ? venueSnap.data().name : "Unknown Venue";

    const usersSnap = await db.collection('users').where('expoPushToken', '!=', null).get();
    if (usersSnap.empty) return;
    const allUsersWithToken = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const membersSnap = await rtdb.ref(`venue_members/${testVenueId}`).once('value');
    const members = membersSnap.exists() ? membersSnap.val() : {};

    let messageText = messageData.message || '';
    if (messageData.type === 'custom_sticker') {
      messageText = '📷 sent a custom sticker';
    } else if (messageData.type === 'sticker') {
      messageText = `${messageData.message} (sticker)`;
    }
    const body = `${messageData.username}: ${messageText}`;

    for (const user of allUsersWithToken) {
      if (user.id === senderId) continue;

      const isEngaged = members[user.id] && (now - (members[user.id].lastInteractionTime || 0) < ONE_HOUR);

      if (isEngaged) {
        await sendRateLimitedPushNotification(
          user.id,
          venueName,
          body,
          { venueId: testVenueId, type: 'chat' },
          null,
          0,
          true
        );
      } else {
        await sendRateLimitedPushNotification(
          user.id,
          venueName,
          body,
          { venueId: testVenueId, type: 'chat' },
          `chat_${testVenueId}`,
          1 * 60 * 60 * 1000,
          false,
          true
        );
      }
    }
  };

  // 5a. Test broadcast for non-engaged user (should succeed)
  console.log("5a. Testing standard broadcast for non-engaged user...");
  await rtdb.ref(`venue_members/${testVenueId}`).set(null); // No one is engaged
  await simulateNewMessage("another_user_abc", {
    username: "Alex",
    message: "Who is here?",
    type: "text"
  });
  const testPushesA = sentPushes.filter(p => p.userId === testUserId);
  console.log(`Sent pushes count for test user: ${testPushesA.length} (Expected: 1)`);
  if (testPushesA.length !== 1 || testPushesA[0].title !== "Test VIP Lounge" || testPushesA[0].body !== "Alex: Who is here?") {
    throw new Error("Standard broadcast test failed!");
  }
  console.log("Standard broadcast test passed!");

  // 5b. Test broadcast throttling for non-engaged user (should be throttled)
  console.log("5b. Testing standard broadcast throttling (should skip)...");
  await simulateNewMessage("another_user_abc", {
    username: "Alex",
    message: "Any updates?",
    type: "text"
  });
  const testPushesB = sentPushes.filter(p => p.userId === testUserId);
  console.log(`Sent pushes count for test user: ${testPushesB.length} (Expected: 0 - throttled)`);
  if (testPushesB.length !== 0) {
    throw new Error("Broadcast throttling test failed!");
  }
  console.log("Broadcast throttling test passed!");

  // Reset rate limits & throttles for test user
  await db.collection('users').doc(testUserId).update({
    notificationCountToday: 0,
    notificationThrottles: {}
  });

  // 5c. Test continuation for engaged user (should bypass limits)
  console.log("5c. Testing continuation notifications for engaged user (should succeed & not throttle)...");
  // Mark test user as engaged (active in last 5 minutes)
  await rtdb.ref(`venue_members/${testVenueId}/${testUserId}`).set({
    lastInteractionTime: Date.now() - 5 * 60 * 1000
  });

  // Message 1
  await simulateNewMessage("another_user_abc", {
    username: "Alex",
    message: "Hey guys!",
    type: "text"
  });
  const testPushesC1 = sentPushes.filter(p => p.userId === testUserId);
  console.log(`Message 1 - Sent pushes count for test user: ${testPushesC1.length} (Expected: 1)`);
  if (testPushesC1.length !== 1 || testPushesC1[0].title !== "Test VIP Lounge" || testPushesC1[0].body !== "Alex: Hey guys!") {
    throw new Error("Continuation notification message 1 failed!");
  }

  // Message 2 immediately after (normally throttled, but engaged should bypass)
  await simulateNewMessage("another_user_abc", {
    username: "Alex",
    message: "Are we drinking?",
    type: "text"
  });
  const testPushesC2 = sentPushes.filter(p => p.userId === testUserId);
  console.log(`Message 2 - Sent pushes count for test user: ${testPushesC2.length} (Expected: 1)`);
  if (testPushesC2.length !== 1 || testPushesC2[0].title !== "Test VIP Lounge" || testPushesC2[0].body !== "Alex: Are we drinking?") {
    throw new Error("Continuation notification message 2 (bypass) failed!");
  }
  console.log("Continuation notifications for engaged user passed!");

  // Reset rate limits & throttles
  await db.collection('users').doc(testUserId).set({
    username: "Test Notification User",
    expoPushToken: "ExponentPushToken[test-user-token-12345]",
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

    const nairobiParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Nairobi',
      weekday: 'short',
      hour: 'numeric',
      hour12: false
    }).formatToParts(new Date());

    let weekday = 'Mon';
    let hour = 12;

    nairobiParts.forEach(p => {
      if (p.type === 'weekday') weekday = p.value;
      if (p.type === 'hour') hour = parseInt(p.value, 10);
    });
    
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

    // Get active simulated locations (filtered to test-script specific users to ignore background simulator noise)
    const activeSimLocs = Object.entries(simLocs)
      .map(([uid, loc]) => ({ ...loc, user_id: uid }))
      .filter(loc => loc.latitude && loc.longitude && (now - loc.timestamp < STALE_MS))
      .filter(loc => loc.user_id && loc.user_id.startsWith('sim_user_'));
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

      const isUnrealistic = isUnrealisticVenueTime(venue, weekday, hour);
      const includeSimulatedForVenue = includeSimulated && !isUnrealistic;

      const venueLocations = activeLocations.filter(loc => {
        if (isUnrealistic && loc.user_id && loc.user_id.startsWith('sim_')) {
          return false;
        }
        if (loc.venueId) return loc.venueId === venue.id;
        return getDistanceInMeters(venue.latitude, venue.longitude, loc.latitude, loc.longitude) <= VENUE_RADIUS_METERS;
      });

      const currentUsersAtVenue = venueLocations
        .map(loc => loc.user_id || 'unknown')
        .filter(uid => uid !== 'unknown');

      // Calculate user count exactly like the app (including simulated defaults)
      const realUserCount = activeRealLocs.filter(loc => {
        if (loc.venueId) return loc.venueId === venue.id;
        return getDistanceInMeters(venue.latitude, venue.longitude, loc.latitude, loc.longitude) <= VENUE_RADIUS_METERS;
      }).length;

      let simUserCount = 0;
      if (includeSimulatedForVenue) {
        const rtdbSimCount = activeSimLocs.filter(loc => {
          if (loc.venueId) return loc.venueId === venue.id;
          return getDistanceInMeters(venue.latitude, venue.longitude, loc.latitude, loc.longitude) <= VENUE_RADIUS_METERS;
        }).length;

        simUserCount = isEngineActive ? rtdbSimCount : getDynamicTargetCount(venue, venues);
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

      const isVenueMarkedCrazy = venue.isCrazy === true || venue.activityLevel === 'Crazy' || userCount > CRAZY_THRESHOLD;

      if (joinsCount >= 5) {
        liveNotificationMessage = `👀 ${userCount} people are at ${venue.name}`;
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
            { venueId: venue.id, type: 'live' },
            `live_${venue.id}`,
            4 * 60 * 60 * 1000
          );
          if (sent) {
            if (user.id !== testUserId) {
              notifiedUserIds.add(user.id);
            }
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
              { venueId: venue.id, type: 'nearby' },
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
  // Clean up any stale simulated locations & presence first
  await rtdb.ref('simulated_locations').set(null);
  await rtdb.ref(`venue_presence/${testVenueId}`).set(null);
  
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
  sentPushes = [];
  await simulateScheduledNotification();
  const proximityPushes = sentPushes.filter(p => p.title === "📍 Popular nearby");
  console.log(`Sent proximity pushes count: ${proximityPushes.length} (Expected: 1)`);
  if (proximityPushes.length !== 1) {
    throw new Error("Proximity alert test failed!");
  }
  console.log("Proximity alert test passed!");

  // Reset rate limits/throttles
  await db.collection('users').doc(testUserId).set({
    username: "Test Notification User",
    expoPushToken: "ExponentPushToken[test-user-token-12345]",
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

  sentPushes = [];
  await simulateScheduledNotification();
  const joinSpikePushes = sentPushes.filter(p => p.title === "🔥 Live Activity" && p.body.includes("people are at"));
  console.log(`Sent live activity join spike pushes count: ${joinSpikePushes.length} (Expected: 1)`);
  if (joinSpikePushes.length !== 1) {
    throw new Error("Live activity: Join spike test failed!");
  }
  console.log("Live activity: Join spike test passed!");

  // Reset rate limits/throttles
  await db.collection('users').doc(testUserId).set({
    username: "Test Notification User",
    expoPushToken: "ExponentPushToken[test-user-token-12345]",
    notificationCountToday: 0,
    lastNotificationDate: "",
    notificationThrottles: {}
  });

  // Clean simulated locations
  await rtdb.ref('simulated_locations').set(null);

  // 6c. Test Live Activity: Chat Spike removed (now decoupled from hot venues notification).

  // 6d. Test Live Activity: Crazy Status
  console.log("\n6d. Testing Live Activity: Crazy Status...");
  // Clear chats & presence & simulated locations
  await rtdb.ref(`venue_chats/${testVenueId}`).set(null);
  await rtdb.ref(`venue_presence/${testVenueId}`).set(null);
  await rtdb.ref('simulated_locations').set(null);
  // Mark venue crazy
  await db.collection('venues').doc(testVenueId).update({
    isCrazy: true
  });

  sentPushes = [];
  await simulateScheduledNotification();
  const crazyPushes = sentPushes.filter(p => p.title === "🔥 Live Activity" && p.body.includes("Something’s happening at"));
  console.log(`Sent live activity crazy status pushes count: ${crazyPushes.length} (Expected: 1)`);
  if (crazyPushes.length !== 1) {
    throw new Error("Live activity: Crazy status test failed!");
  }
  console.log("Live activity: Crazy status test passed!");

  // 6e. Test Live Activity: Hourly rate limit (max 2 per hour)
  console.log("\n6e. Testing Live Activity: Hourly rate-limiting (should stop after 2 sends)...");
  // Clean up user document liveNotificationTimes first
  await db.collection('users').doc(testUserId).update({
    liveNotificationTimes: []
  });

  sentPushes = [];
  
  // Attempt 1: Should succeed
  await sendRateLimitedPushNotification(
    testUserId,
    `🔥 Live Activity`,
    "Live activity message 1",
    { venueId: testVenueId, type: 'live' },
    `live_test_1`,
    0
  );
  
  // Attempt 2: Should succeed
  await sendRateLimitedPushNotification(
    testUserId,
    `🔥 Live Activity`,
    "Live activity message 2",
    { venueId: testVenueId, type: 'live' },
    `live_test_2`,
    0
  );

  // Attempt 3: Should be blocked by hourly limit (since it's the 3rd 'live' notification within 1 hour)
  await sendRateLimitedPushNotification(
    testUserId,
    `🔥 Live Activity`,
    "Live activity message 3",
    { venueId: testVenueId, type: 'live' },
    `live_test_3`,
    0
  );

  console.log(`Live activity hourly count: ${sentPushes.length} (Expected: 2)`);
  if (sentPushes.length !== 2) {
    throw new Error("Live activity hourly rate limit failed!");
  }
  console.log("Live activity hourly rate limit passed!");

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

function getDefaultCapacity(type) {
  switch (type) {
    case 'Club': return 250;
    case 'Bar': return 100;
    case 'Activity': return 200;
    case 'Event': return 500;
    default: return 100;
  }
}

function getDynamicTargetCount(venue, allVenues) {
  const now = new Date();
  const nairobiParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Nairobi',
    weekday: 'short',
    hour: 'numeric',
    hour12: false
  }).formatToParts(now);

  let weekday = 'Mon';
  let hour = 12;

  nairobiParts.forEach(p => {
    if (p.type === 'weekday') weekday = p.value;
    if (p.type === 'hour') hour = parseInt(p.value, 10);
  });

  const isOverride = venue.isOverride === true;
  if (isOverride) {
    return venue.simulatedUsersCount !== undefined ? venue.simulatedUsersCount : 20;
  }

  // Determine tier within category (Default: 10% hot, 30% medium, 60% low)
  let tier = 'low';
  if (allVenues && Array.isArray(allVenues)) {
    const categoryVenues = allVenues.filter(v => v.type === venue.type);
    if (categoryVenues.length > 0) {
      const sorted = [...categoryVenues].sort((a, b) => {
        const scoreA = a.simPopularityScore !== undefined ? a.simPopularityScore : 0.5;
        const scoreB = b.simPopularityScore !== undefined ? b.simPopularityScore : 0.5;
        return scoreB - scoreA;
      });
      const rankIndex = sorted.findIndex(v => v.id === venue.id);
      if (rankIndex !== -1) {
        const percentile = rankIndex / sorted.length;
        if (percentile < 0.10) {
          tier = 'hot';
        } else if (percentile < 0.40) {
          tier = 'medium';
        } else {
          tier = 'low';
        }
      }
    }
  }

  const isNightlifePeak = (day, hr) => {
    if (hr >= 21) {
      return ['Fri', 'Sat', 'Sun'].includes(day);
    } else if (hr < 4) {
      return ['Sat', 'Sun', 'Mon'].includes(day);
    }
    return false;
  };

  let count = 0;
  if (venue.type === 'Club' || venue.type === 'Bar') {
    if (isNightlifePeak(weekday, hour)) {
      if (tier === 'hot') count = 90;
      else if (tier === 'medium') count = 40;
      else count = 20;
    } else if (hour >= 21 || hour < 4) {
      if (tier === 'hot') count = 50;
      else if (tier === 'medium') count = 25;
      else count = 10;
    } else {
      if (tier === 'hot') count = 10;
      else if (tier === 'medium') count = 4;
      else count = 0;
    }
  } else if (venue.type === 'Activity') {
    if (hour >= 19 || hour < 6) {
      if (tier === 'hot') count = 3;
      else if (tier === 'medium') count = 1;
      else count = 0;
    } else {
      const isWeekend = ['Sat', 'Sun'].includes(weekday);
      if (isWeekend) {
        if (tier === 'hot') count = 75;
        else if (tier === 'medium') count = 35;
        else count = 10;
      } else {
        if (tier === 'hot') count = 35;
        else if (tier === 'medium') count = 20;
        else count = 5;
      }
    }
  } else if (venue.type === 'Event') {
    const nowMs = Date.now();
    const isOngoing = venue.startDate && venue.expirationDate && (nowMs >= venue.startDate && nowMs <= venue.expirationDate);
    if (isOngoing) {
      if (hour >= 9 && hour < 22) {
        if (tier === 'hot') count = 100;
        else if (tier === 'medium') count = 50;
        else count = 15;
      } else {
        if (tier === 'hot') count = 15;
        else if (tier === 'medium') count = 8;
        else count = 0;
      }
    } else {
      count = 0;
    }
  } else {
    if (tier === 'hot') count = 40;
    else if (tier === 'medium') count = 20;
    else count = 5;
  }

  const maxCapacity = venue.maxCapacity !== undefined ? venue.maxCapacity : getDefaultCapacity(venue.type);
  count = Math.min(count, maxCapacity);

  if (venue.type === 'Activity' && (hour >= 19 || hour < 6)) {
    count = Math.min(count, 5);
  }
  if ((venue.type === 'Club' || venue.type === 'Bar') && isNightlifePeak(weekday, hour)) {
    count = Math.max(count, 20);
  }

  return Math.max(0, count);
}

function isUnrealisticVenueTime(venue, day, hour) {
  if (venue.type === 'Activity' && (hour >= 19 || hour < 6)) {
    return true;
  }
  if (venue.type === 'Club' && (hour >= 6 && hour < 18)) {
    return true;
  }
  return false;
}

