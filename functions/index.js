const functions = require("firebase-functions");
const admin = require("firebase-admin");
const fetch = require("node-fetch");

admin.initializeApp();


const db = admin.firestore();
const rtdb = admin.database();

const VENUE_RADIUS_METERS = 200;
const STALE_MS = 2 * 60 * 60 * 1000; // 2 hours for location staleness
const CRAZY_THRESHOLD = 75; // > 75 users

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

/**
 * Sends a push notification to a user with daily rate limiting (max 5 per day) and throttle key validation.
 * @param {string} userId - The user ID.
 * @param {string} title - The notification title.
 * @param {string} body - The notification body.
 * @param {object} data - The custom notification data.
 * @param {string|null} throttleKey - The key to throttle.
 * @param {number} throttleDurationMs - How long to throttle this key in ms.
 * @return {Promise<boolean>} - True if notification was sent, false otherwise.
 */
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
      await sendPushNotification(token, title, body, data);
      return true;
    }
  } catch (error) {
    console.error(`Error in sendRateLimitedPushNotification for user ${userId}:`, error);
  }
  return false;
}

// 👥 1. Social / Engagement Notifications Trigger
exports.onNewChatMessage = functions.database.ref('/venue_chats/{venueId}/{messageId}')
  .onCreate(async (snapshot, context) => {
    const messageData = snapshot.val();
    if (!messageData) return;

    const venueId = context.params.venueId;
    const senderId = messageData.user_id;

    // Fetch the venue name from Firestore to customize the message
    const venueSnap = await db.collection('venues').doc(venueId).get();
    if (!venueSnap.exists) return;
    const venueName = venueSnap.data().name;

    // Get all members of this venue's chat
    const membersSnap = await rtdb.ref(`venue_members/${venueId}`).once('value');
    if (!membersSnap.exists()) return;

    const members = membersSnap.val();
    const now = Date.now();
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

    // Filter active members (chatted in the last 24h, exclude sender)
    const activeMembers = Object.keys(members).filter(uid => {
      if (uid === senderId) return false;
      const lastInteraction = members[uid].lastInteractionTime || 0;
      return (now - lastInteraction) < TWENTY_FOUR_HOURS;
    });

    console.log(`Notifying ${activeMembers.length} members about chat activity in venue ${venueName} (${venueId})`);

    for (const memberId of activeMembers) {
      await sendRateLimitedPushNotification(
        memberId,
        `💬 Activity in ${venueName}`,
        `Activity is picking up in your event chat`,
        { venueId },
        `chat_${venueId}`,
        1 * 60 * 60 * 1000 // 1 hour throttle
      );
    }
  });

// Scheduled Notification Service
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

  // Merge locations and tag them with user_id
  const allLocs = {};
  if (realLocs) {
    for (const [uid, loc] of Object.entries(realLocs)) {
      allLocs[uid] = { ...loc, user_id: uid };
    }
  }
  if (simLocs) {
    for (const [uid, loc] of Object.entries(simLocs)) {
      allLocs[uid] = { ...loc, user_id: uid };
    }
  }

  // Filter active locations (under 2 hours stale)
  const activeLocations = Object.values(allLocs).filter(loc => 
    loc.latitude && loc.longitude && (now - loc.timestamp < STALE_MS)
  );

  // Load all users with push tokens once
  const usersSnap = await db.collection('users').where('expoPushToken', '!=', null).get();
  const allUsersWithToken = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  for (const venue of venues) {
    // Determine active users (real + sim) currently at this venue
    const currentUsersAtVenue = activeLocations
      .filter(loc => getDistanceInMeters(venue.latitude, venue.longitude, loc.latitude, loc.longitude) <= VENUE_RADIUS_METERS)
      .map(loc => loc.user_id || 'unknown')
      .filter(uid => uid !== 'unknown');
    const userCount = currentUsersAtVenue.length;

    // Evaluate Live Activity signals
    let liveNotificationMessage = null;
    let joinsCount = 0;

    // Signal 1: Join Spike (using rolling venue presence)
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
    // Update presence (also removes users who left)
    await presenceRef.set(newPresence);

    // Signal 2: Chat Spike (10+ messages in last 10 minutes)
    const tenMinAgo = now - 10 * 60 * 1000;
    const recentMessagesSnap = await rtdb.ref(`venue_chats/${venue.id}`)
      .orderByChild('timestamp')
      .startAt(tenMinAgo)
      .once('value');
    const recentMessagesCount = recentMessagesSnap.exists() ? Object.keys(recentMessagesSnap.val()).length : 0;

    // Signal 3: Venue marked "crazy"
    const isVenueMarkedCrazy = venue.isCrazy === true || venue.activityLevel === 'Crazy' || userCount > CRAZY_THRESHOLD;

    // Determine if Live Activity triggers
    if (joinsCount >= 5) {
      liveNotificationMessage = `👀 ${joinsCount} people just joined ${venue.name}`;
    } else if (recentMessagesCount >= 10) {
      liveNotificationMessage = `🔥 ${venue.name} is heating up right now`;
    } else if (isVenueMarkedCrazy) {
      liveNotificationMessage = `🎉 Something’s happening at ${venue.name}`;
    }

    if (liveNotificationMessage) {
      console.log(`🔥 [LIVE ACTIVITY] ${venue.name} is crazy! Message: "${liveNotificationMessage}". Dispatching...`);
      for (const user of allUsersWithToken) {
        // Skip if the user is already at the venue
        if (currentUsersAtVenue.includes(user.id)) {
          continue;
        }

        await sendRateLimitedPushNotification(
          user.id,
          `🔥 Live Activity`,
          liveNotificationMessage,
          { venueId: venue.id },
          `live_${venue.id}`,
          4 * 60 * 60 * 1000 // 4 hours throttle
        );
      }
    }

    // Evaluate Personalized Event Alerts (Proximity Alert)
    // Send if venue is popular (userCount >= 10) and user is between 200m and 2.5km away
    const isPopular = userCount >= 10;
    if (isPopular) {
      for (const [userId, loc] of Object.entries(realLocs)) {
        if (!loc.latitude || !loc.longitude || (now - loc.timestamp >= STALE_MS)) continue;

        const dist = getDistanceInMeters(venue.latitude, venue.longitude, loc.latitude, loc.longitude);
        // User is nearby but NOT at the venue
        if (dist > VENUE_RADIUS_METERS && dist <= 2500) {
          await sendRateLimitedPushNotification(
            userId,
            `📍 Popular nearby`,
            `Something popular happening near you`,
            { venueId: venue.id },
            `nearby_${venue.id}`,
            6 * 60 * 60 * 1000 // 6 hours throttle
          );
        }
      }
    }
  }

  console.log("Finished scheduled notification run.");
});

// 🔗 3. Invite Link HTTP Redirect Handler
exports.inviteRedirect = functions.https.onRequest(async (req, res) => {
  const pathParts = req.path.split('/');
  const code = req.query.code || pathParts[pathParts.length - 1];

  if (!code) {
    res.status(400).send("Error: Missing referral code");
    return;
  }

  // Retrieve client IP and User-Agent
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || "unknown";
  const userAgent = req.headers['user-agent'] || "unknown";

  try {
    // Log invite link click for first-open iOS attribution
    await db.collection('pending_clicks').add({
      referralCode: code,
      ip: ip,
      userAgent: userAgent,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    // In production, redirects to Store links:
    let redirectUrl = "https://play.google.com/store/apps/details?id=com.eventas.app";
    const uaLower = userAgent.toLowerCase();
    if (uaLower.includes("iphone") || uaLower.includes("ipad") || uaLower.includes("ipod")) {
      redirectUrl = "https://apps.apple.com/app/eventas/id123456789";
    } else {
      redirectUrl = `https://play.google.com/store/apps/details?id=com.eventas.app&referrer=${encodeURIComponent(code)}`;
    }

    res.send(`
      <html>
        <head>
          <title>Redirecting to Eventa...</title>
          <meta http-equiv="refresh" content="2;url=${redirectUrl}">
          <style>
            body { background-color: #121212; color: #FFFFFF; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .loader { border: 4px solid #1A1A1A; border-top: 4px solid #00FFCC; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin-bottom: 20px; }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            h1 { font-size: 20px; font-weight: 600; margin-bottom: 8px; }
            p { color: #888; font-size: 14px; }
          </style>
        </head>
        <body>
          <div class="loader"></div>
          <h1>Redirecting to the App Store</h1>
          <p>Please wait while we set up your invite code: <strong>${code}</strong>...</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Error in inviteRedirect:", error);
    res.status(500).send("Error performing invite redirection.");
  }
});

// 📲 4. Device Install Registration & Anti-Fraud Validation
exports.registerInstall = functions.https.onCall(async (data, context) => {
  const { deviceId, referralCode, deviceDetails, simulatedIp, simulatedUserAgent } = data;

  if (!deviceId) {
    throw new functions.https.HttpsError('invalid-argument', 'deviceId is required');
  }

  const req = context.rawRequest;
  let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || "unknown";
  let userAgent = req.headers['user-agent'] || "unknown";

  // Allow simulator to override IP and User-Agent for validation testing
  if (simulatedIp) {
    ip = simulatedIp;
  }
  if (simulatedUserAgent) {
    userAgent = simulatedUserAgent;
  }
  const now = admin.firestore.FieldValue.serverTimestamp();

  const installRef = db.collection('installs').doc(deviceId);

  try {
    // Check if device has ever registered an install before
    const docSnap = await installRef.get();
    if (docSnap.exists) {
      const existingData = docSnap.data();
      
      // Log duplicate attempt as separate invalid log to avoid overwriting original confirmed record
      const dupRef = db.collection('installs').doc();
      await dupRef.set({
        deviceId,
        providedReferralCode: referralCode || null,
        deviceDetails: deviceDetails || {},
        ip,
        userAgent,
        timestamp: now,
        status: 'invalid',
        reason: 'duplicate_device',
        originalInstallId: deviceId
      });

      if (existingData.creatorId) {
        const creatorRef = db.collection('creators').doc(existingData.creatorId);
        await creatorRef.update({
          totalInstalls: admin.firestore.FieldValue.increment(1)
        });
      }

      return { success: false, status: 'invalid', reason: 'duplicate_device' };
    }

    // 1. Mark install as "pending validation" initially
    const initialRecord = {
      deviceId,
      providedReferralCode: referralCode || null,
      deviceDetails: deviceDetails || {},
      ip,
      userAgent,
      timestamp: now,
      status: 'pending',
      reason: null
    };
    await installRef.set(initialRecord);

    // 2. Perform attribution if referralCode is not provided directly (iOS first-open IP/UA match)
    let finalCode = referralCode;
    let attributionSource = referralCode ? 'direct' : 'none';

    if (!finalCode) {
      // Find matching click recorded within the last 24 hours matching IP & User-Agent
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const clickSnap = await db.collection('pending_clicks')
        .where('ip', '==', ip)
        .where('userAgent', '==', userAgent)
        .where('timestamp', '>=', twentyFourHoursAgo)
        .orderBy('timestamp', 'desc')
        .limit(1)
        .get();

      if (!clickSnap.empty) {
        const clickDoc = clickSnap.docs[0].data();
        finalCode = clickDoc.referralCode;
        attributionSource = 'ip_useragent_match';
      }
    }

    if (!finalCode) {
      await installRef.update({
        status: 'invalid',
        reason: 'no_referral_code',
        attributionSource
      });
      return { success: false, status: 'invalid', reason: 'no_referral_code' };
    }

    // 3. Find creator matching referralCode (case-insensitive)
    const creatorsSnap = await db.collection('creators')
      .where('referralCode', '==', finalCode.toUpperCase().trim())
      .limit(1)
      .get();

    if (creatorsSnap.empty) {
      await installRef.update({
        status: 'invalid',
        referralCode: finalCode,
        reason: 'invalid_referral_code',
        attributionSource
      });
      return { success: false, status: 'invalid', reason: 'invalid_referral_code' };
    }

    const creatorDoc = creatorsSnap.docs[0];
    const creatorId = creatorDoc.id;

    await installRef.update({
      creatorId,
      referralCode: finalCode.toUpperCase().trim(),
      attributionSource
    });

    // 4. Run validation & anti-fraud rules
    const validationResult = await db.runTransaction(async (transaction) => {
      // Rule 1: IP Velocity rate limit (max 3 confirmed installs per IP per 10 minutes)
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const ipSnap = await transaction.get(
        db.collection('installs')
          .where('ip', '==', ip)
          .where('status', '==', 'confirmed')
          .where('timestamp', '>=', tenMinutesAgo)
      );

      if (ipSnap.size >= 3) {
        return { status: 'invalid', reason: 'ip_velocity_limit' };
      }

      // Rule 2: Emulator detection
      const model = (deviceDetails && deviceDetails.model) ? deviceDetails.model.toLowerCase() : "";
      const isDevice = deviceDetails && deviceDetails.isDevice !== undefined ? deviceDetails.isDevice : true;
      const isEmulator = !isDevice || model.includes("emulator") || model.includes("simulator") || model.includes("sdk_gphone") || model.includes("gphone");

      if (isEmulator) {
        return { status: 'invalid', reason: 'emulator_detected' };
      }

      return { status: 'confirmed' };
    });

    // Write final status
    await installRef.update({
      status: validationResult.status,
      reason: validationResult.reason || null
    });

    // 5. Update creator statistics
    const creatorRef = db.collection('creators').doc(creatorId);
    if (validationResult.status === 'confirmed') {
      await db.runTransaction(async (t) => {
        const cDoc = await t.get(creatorRef);
        if (cDoc.exists) {
          const totalInstalls = cDoc.data().totalInstalls || 0;
          const validInstalls = cDoc.data().validInstalls || 0;
          t.update(creatorRef, {
            totalInstalls: totalInstalls + 1,
            validInstalls: validInstalls + 1
          });
        }
      });
      return { success: true, status: 'confirmed' };
    } else {
      await db.runTransaction(async (t) => {
        const cDoc = await t.get(creatorRef);
        if (cDoc.exists) {
          const totalInstalls = cDoc.data().totalInstalls || 0;
          t.update(creatorRef, {
            totalInstalls: totalInstalls + 1
          });
        }
      });
      return { success: false, status: 'invalid', reason: validationResult.reason };
    }
  } catch (error) {
    console.error("Error running registerInstall function:", error);
    try {
      await installRef.update({
        status: 'invalid',
        reason: 'internal_error'
      });
    } catch (_) {}
    throw new functions.https.HttpsError('internal', 'Internal error registering install: ' + error.message);
  }
});

