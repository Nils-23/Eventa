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
    priority: 'high',
    channelId: 'default',
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
async function sendRateLimitedPushNotification(userId, title, body, data = {}, throttleKey = null, throttleDurationMs = 0, bypassLimits = false, bypassDailyLimit = false, testTimeMs = null) {
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

      const nowMs = testTimeMs || Date.now();

      // Hourly throttle for live notifications (max 2 per hour)
      let liveTimes = userData.liveNotificationTimes || [];
      if (data && data.type === 'live') {
        const oneHourAgo = nowMs - (1 * 60 * 60 * 1000);
        // Keep only timestamps within the last hour
        liveTimes = liveTimes.filter(ts => ts > oneHourAgo);
        
        if (liveTimes.length >= 2) {
          console.log(`User ${userId} reached hourly limit of 2 live notifications. Skipping.`);
          return null;
        }
        liveTimes.push(nowMs);
      }

      const dateToUse = testTimeMs ? new Date(testTimeMs) : new Date();
      const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(dateToUse);
      
      const nairobiParts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Nairobi',
        hour: 'numeric',
        hour12: false
      }).formatToParts(dateToUse);
      
      let hour = 12;
      nairobiParts.forEach(p => {
        if (p.type === 'hour') hour = parseInt(p.value, 10);
      });
      if (hour === 24) hour = 0;

      // Reset logic when date changes
      const lastDate = userData.lastNotificationDate || "";
      let count = userData.notificationCountToday || 0;
      let periodCounts = userData.notificationCountsByPeriod || {
        "00-06": 0,
        "06-12": 0,
        "12-18": 0,
        "18-24": 0
      };

      if (lastDate !== dateStr) {
        count = 0;
        periodCounts = {
          "00-06": 0,
          "06-12": 0,
          "12-18": 0,
          "18-24": 0
        };
      }

      const DAILY_LIMIT = 5;
      let periodKey = "";
      let periodLimit = 0;
      let periodPercentageLabel = "";

      if (hour >= 0 && hour < 6) {
        periodKey = "00-06";
        periodLimit = Math.floor(DAILY_LIMIT * 0.20); // 1
        periodPercentageLabel = "20%";
      } else if (hour >= 6 && hour < 12) {
        periodKey = "06-12";
        periodLimit = Math.floor(DAILY_LIMIT * 0.00); // 0
        periodPercentageLabel = "0%";
      } else if (hour >= 12 && hour < 18) {
        periodKey = "12-18";
        periodLimit = Math.floor(DAILY_LIMIT * 0.40); // 2
        periodPercentageLabel = "40%";
      } else {
        // hour >= 18 && hour < 24
        periodKey = "18-24";
        periodLimit = Math.floor(DAILY_LIMIT * 0.40); // 2
        periodPercentageLabel = "40%";
      }

      if (!bypassDailyLimit) {
        // Enforce daily limit
        if (count >= DAILY_LIMIT) {
          console.log(`User ${userId} reached daily limit of ${DAILY_LIMIT}. Skipping.`);
          return null;
        }

        // Enforce period-specific limit
        const currentPeriodCount = periodCounts[periodKey] || 0;
        if (currentPeriodCount >= periodLimit) {
          console.log(`User ${userId} reached period limit of ${periodLimit} (${periodPercentageLabel}) for period ${periodKey}. Skipping.`);
          return null;
        }
      }

      let throttles = userData.notificationThrottles || {};
      const cleanedThrottles = {};
      for (const [k, ts] of Object.entries(throttles)) {
        if (nowMs - ts < 24 * 60 * 60 * 1000) {
          cleanedThrottles[k] = ts;
        }
      }

      // Enforce general venue throttle for 'live' and 'nearby' notifications (at most 1 per hour per venue)
      if (data && (data.type === 'live' || data.type === 'nearby') && data.venueId) {
        const venueThrottleKey = `venue_${data.venueId}`;
        const lastVenueSent = cleanedThrottles[venueThrottleKey] || 0;
        const ONE_HOUR_MS = 60 * 60 * 1000;
        if (nowMs - lastVenueSent < ONE_HOUR_MS) {
          console.log(`Notification for user ${userId} regarding venue ${data.venueId} is throttled (venue-specific 1-hour limit).`);
          return null;
        }
        cleanedThrottles[venueThrottleKey] = nowMs;
      }
      
      if (throttleKey) {
        const lastSent = cleanedThrottles[throttleKey] || 0;
        if (nowMs - lastSent < throttleDurationMs) {
          console.log(`Notification for user ${userId} with throttleKey ${throttleKey} is throttled.`);
          return null;
        }
        cleanedThrottles[throttleKey] = nowMs;
      }

      // Increment counts if not bypassed
      if (!bypassDailyLimit) {
        count++;
        periodCounts[periodKey] = (periodCounts[periodKey] || 0) + 1;
      }

      const updateData = {
        lastNotificationDate: dateStr,
        notificationThrottles: cleanedThrottles
      };
      if (!bypassDailyLimit) {
        updateData.notificationCountToday = count;
        updateData.notificationCountsByPeriod = periodCounts;
      }
      if (data && data.type === 'live') {
        updateData.liveNotificationTimes = liveTimes;
      }

      transaction.update(userRef, updateData);

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

    // Load all users with push tokens
    const usersSnap = await db.collection('users').where('expoPushToken', '!=', null).get();
    if (usersSnap.empty) return;
    const allUsersWithToken = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Get all members of this venue's chat
    const membersSnap = await rtdb.ref(`venue_members/${venueId}`).once('value');
    const members = membersSnap.exists() ? membersSnap.val() : {};

    const now = Date.now();
    const ONE_HOUR = 1 * 60 * 60 * 1000;

    // Construct WhatsApp-style body content
    let messageText = messageData.message || '';
    if (messageData.type === 'custom_sticker') {
      messageText = '📷 sent a custom sticker';
    } else if (messageData.type === 'sticker') {
      messageText = `${messageData.message} (sticker)`;
    }
    const body = `${messageData.username}: ${messageText}`;

    console.log(`Processing message from ${messageData.username} at ${venueName}. Notifying users...`);

    for (const user of allUsersWithToken) {
      if (user.id === senderId) continue;

      // Check if user is actively engaged in chat (last interaction within 1 hour)
      const isEngaged = members[user.id] && (now - (members[user.id].lastInteractionTime || 0) < ONE_HOUR);

      if (isEngaged) {
        // Engaged users get unlimited notifications for this chat (bypassing daily and throttle limits)
        await sendRateLimitedPushNotification(
          user.id,
          venueName,
          body,
          { venueId, type: 'chat' },
          null,
          0,
          true // bypassLimits
        );
      } else {
        // Non-engaged users receive broadcast rate-limited to 1 per hour per venue, bypassing daily limit
        await sendRateLimitedPushNotification(
          user.id,
          venueName,
          body,
          { venueId, type: 'chat' },
          `chat_${venueId}`,
          1 * 60 * 60 * 1000, // 1 hour throttle
          false, // bypassLimits
          true // bypassDailyLimit
        );
      }
    }
  });

function getDefaultCapacity(type) {
  switch (type) {
    case 'Club': return 100;
    case 'Bar': return 50;
    case 'Activity': return 75;
    case 'Event': return 150;
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

// Scheduled Notification Service
exports.notifyHotVenues = functions.pubsub.schedule("every 5 minutes").onRun(async (context) => {

  console.log('Running scheduled notification service...');
  const notifiedUserIds = new Set();
  
  const currentDate = new Date();
  const nairobiParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Nairobi',
    weekday: 'short',
    hour: 'numeric',
    hour12: false
  }).formatToParts(currentDate);

  let weekday = 'Mon';
  let hour = 12;

  nairobiParts.forEach(p => {
    if (p.type === 'weekday') weekday = p.value;
    if (p.type === 'hour') hour = parseInt(p.value, 10);
  });

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

  // Load all users with push tokens once
  const usersSnap = await db.collection('users').where('expoPushToken', '!=', null).get();
  const allUsersWithToken = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  for (const venue of venues) {
    // If the venue has a start date in the future, skip notifications for it
    if (venue.startDate && now < venue.startDate) {
      console.log(`Venue/Event ${venue.name} has not started yet (starts at ${new Date(venue.startDate).toISOString()}). Skipping.`);
      continue;
    }

    const isUnrealistic = isUnrealisticVenueTime(venue, weekday, hour);
    const includeSimulatedForVenue = includeSimulated && !isUnrealistic;

    // Filter activeLocations for counts and presence checks at this venue
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

    // Signal 2: Venue marked "crazy"
    const isVenueMarkedCrazy = venue.isCrazy === true || venue.activityLevel === 'Crazy' || userCount > CRAZY_THRESHOLD;

    // Determine if Live Activity triggers
    if (joinsCount >= 5) {
      liveNotificationMessage = `👀 ${userCount} people are at ${venue.name}`;
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

        if (notifiedUserIds.has(user.id)) {
          continue;
        }

        const sent = await sendRateLimitedPushNotification(
          user.id,
          `🔥 Live Activity`,
          liveNotificationMessage,
          { venueId: venue.id, type: 'live' },
          `live_${venue.id}`,
          4 * 60 * 60 * 1000 // 4 hours throttle
        );
        if (sent) {
          notifiedUserIds.add(user.id);
        }
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
          if (notifiedUserIds.has(userId)) {
            continue;
          }

          const sent = await sendRateLimitedPushNotification(
            userId,
            `📍 Popular nearby`,
            `Something popular happening near you`,
            { venueId: venue.id, type: 'nearby' },
            `nearby_${venue.id}`,
            6 * 60 * 60 * 1000 // 6 hours throttle
          );
          if (sent) {
            notifiedUserIds.add(userId);
          }
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

  // Retrieve client IP and User-Agent
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || "unknown";
  const userAgent = req.headers['user-agent'] || "unknown";

  const cleanCode = (code && code !== "inviteRedirect" && code !== "invite" && code.trim() !== "") ? code.trim() : null;

  try {
    if (cleanCode) {
      // Log invite link click for first-open iOS attribution
      await db.collection('pending_clicks').add({
        referralCode: cleanCode,
        ip: ip,
        userAgent: userAgent,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    // In production, redirects to Store links:
    let redirectUrl = "https://play.google.com/store/apps/details?id=com.nils23.Eventa";
    const uaLower = userAgent.toLowerCase();
    if (uaLower.includes("iphone") || uaLower.includes("ipad") || uaLower.includes("ipod")) {
      redirectUrl = "https://apps.apple.com/app/eventas/id6769403503";
    } else {
      if (cleanCode) {
        redirectUrl = `https://play.google.com/store/apps/details?id=com.nils23.Eventa&referrer=${encodeURIComponent(cleanCode)}`;
      } else {
        redirectUrl = `https://play.google.com/store/apps/details?id=com.nils23.Eventa`;
      }
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
          <p>${cleanCode ? `Please wait while we set up your invite code: <strong>${cleanCode}</strong>...` : 'Please wait while we redirect you to the App Store...'}</p>
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
    // Rule 1: IP Velocity rate limit (max 3 confirmed installs per IP per 10 minutes)
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const ipSnap = await db.collection('installs')
      .where('ip', '==', ip)
      .where('status', '==', 'confirmed')
      .where('timestamp', '>=', tenMinutesAgo)
      .get();

    const isIpVelocityLimitReached = ipSnap.size >= 3;

    const validationResult = await db.runTransaction(async (transaction) => {
      if (isIpVelocityLimitReached) {
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

// 👥 User Account Creation Trigger - Attributes new signups to affiliate creators
exports.onUserCreated = functions.firestore
  .document('users/{userId}')
  .onCreate(async (snap, context) => {
    const userData = snap.data();
    if (!userData) return;

    const deviceId = userData.deviceId;
    if (!deviceId) {
      console.log(`No deviceId for new user ${context.params.userId}, skipping creator attribution.`);
      return;
    }

    try {
      // Look up install record for this device
      const installDoc = await db.collection('installs').doc(deviceId).get();
      if (!installDoc.exists) {
        console.log(`No install record found for device ${deviceId}.`);
        return;
      }

      const installData = installDoc.data();
      if (installData.status === 'confirmed' && installData.creatorId) {
        const creatorId = installData.creatorId;
        const creatorRef = db.collection('creators').doc(creatorId);

        console.log(`Attributing user ${context.params.userId} to creator ${creatorId}`);

        // Increment totalSignups for this creator
        await db.runTransaction(async (transaction) => {
          const creatorSnap = await transaction.get(creatorRef);
          if (creatorSnap.exists) {
            const totalSignups = creatorSnap.data().totalSignups || 0;
            transaction.update(creatorRef, {
              totalSignups: totalSignups + 1
            });
          }
        });

        // Update user document with the creatorId and referralCode
        await snap.ref.update({
          referredByCreator: creatorId,
          creatorReferralCode: installData.referralCode || null
        });

        console.log(`Successfully updated creator stats and user record for user ${context.params.userId}`);
      } else {
        console.log(`Install status is ${installData.status} or creatorId is missing for device ${deviceId}. Skipping signup attribution.`);
      }
    } catch (error) {
      console.error(`Error in onUserCreated trigger for user ${context.params.userId}:`, error);
    }
  });

// Cleanup duplicate expoPushTokens across users to avoid multiple delivery to the same device
exports.cleanupDuplicateTokens = functions.firestore
  .document('users/{userId}')
  .onWrite(async (change, context) => {
    const userId = context.params.userId;
    const afterData = change.after.exists ? change.after.data() : null;
    if (!afterData) return null;

    const token = afterData.expoPushToken;
    if (!token) return null;

    const beforeData = change.before.exists ? change.before.data() : null;
    const oldToken = beforeData ? beforeData.expoPushToken : null;

    // Only run cleanup if token has been updated or newly set
    if (token !== oldToken) {
      console.log(`🧹 [TOKEN CLEANUP] Token updated for user ${userId}. Cleaning duplicates of: ${token}`);
      const usersRef = db.collection('users');
      const querySnap = await usersRef.where('expoPushToken', '==', token).get();

      const batch = db.batch();
      let count = 0;

      querySnap.forEach(docSnap => {
        if (docSnap.id !== userId) {
          batch.update(docSnap.ref, { expoPushToken: null });
          count++;
        }
      });

      if (count > 0) {
        await batch.commit();
        console.log(`🧹 [TOKEN CLEANUP] Disassociated expoPushToken ${token} from ${count} other users.`);
      }
    }
    return null;
  });

// 💻 Simulation helper to simulate user signup from Admin referrers dashboard
exports.simulateUserSignup = functions.https.onCall(async (data, context) => {
  // Only allow admin users to call this
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');
  }

  // Verify admin status
  const callerRef = db.collection('users').doc(context.auth.uid);
  const callerSnap = await callerRef.get();
  if (!callerSnap.exists || callerSnap.data().isAdmin !== true) {
    throw new functions.https.HttpsError('permission-denied', 'Only admins can simulate signups');
  }

  const { deviceId } = data;
  if (!deviceId) {
    throw new functions.https.HttpsError('invalid-argument', 'deviceId is required');
  }

  const mockUid = `mock_user_${Date.now()}`;
  const userRef = db.collection('users').doc(mockUid);

  await userRef.set({
    user_id: mockUid,
    username: `SimUser_${Math.floor(1000 + Math.random() * 9000)}`,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    last_active: admin.firestore.FieldValue.serverTimestamp(),
    points: 0,
    hasAttendedFirstVenue: false,
    agreedToTerms: true,
    termsAgreementDate: admin.firestore.FieldValue.serverTimestamp(),
    deviceId: deviceId
  });

  return { success: true, userId: mockUid };
});

// 🔄 5. Scheduled Recurring Story Handler
exports.checkRecurringStories = functions.pubsub.schedule("every 5 minutes").onRun(async (context) => {
  console.log("Checking for recurring stories to trigger...");
  const now = new Date();
  
  // Resolve current weekday and time in Nairobi timezone
  const nairobiParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Nairobi',
    weekday: 'short', // 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  }).formatToParts(now);

  let weekday = '';
  let hourStr = '';
  let minuteStr = '';

  nairobiParts.forEach(p => {
    if (p.type === 'weekday') weekday = p.value;
    if (p.type === 'hour') hourStr = p.value.padStart(2, '0');
    if (p.type === 'minute') minuteStr = p.value.padStart(2, '0');
  });

  const currentTime = `${hourStr}:${minuteStr}`;
  const currentMinutes = parseInt(hourStr, 10) * 60 + parseInt(minuteStr, 10);
  console.log(`Current Nairobi Time: ${weekday} ${currentTime} (${currentMinutes} mins from midnight)`);

  try {
    const activeSchedulesSnap = await db.collection('recurring_stories')
      .where('active', '==', true)
      .get();

    if (activeSchedulesSnap.empty) {
      console.log("No active recurring story schedules found.");
      return null;
    }

    const batch = db.batch();
    let triggerCount = 0;

    for (const docSnap of activeSchedulesSnap.docs) {
      const schedule = docSnap.data();
      const targetParts = schedule.time.split(':');
      if (targetParts.length !== 2) continue;

      const targetMinutes = parseInt(targetParts[0], 10) * 60 + parseInt(targetParts[1], 10);
      
      let shouldTrigger = false;

      if (schedule.frequency === 'daily') {
        // Trigger if current time is within 30 minutes after target time
        if (currentMinutes >= targetMinutes && currentMinutes - targetMinutes < 30) {
          shouldTrigger = true;
        }
      } else if (schedule.frequency === 'weekly') {
        // Trigger if day matches AND time is within 30 minutes after target time
        if (weekday === schedule.dayOfWeek && currentMinutes >= targetMinutes && currentMinutes - targetMinutes < 30) {
          shouldTrigger = true;
        }
      }

      // Check throttle: if lastTriggered was less than 12 hours ago, skip
      if (shouldTrigger && schedule.lastTriggered) {
        const lastTime = schedule.lastTriggered.toDate().getTime();
        if (now.getTime() - lastTime < 12 * 60 * 60 * 1000) {
          shouldTrigger = false;
        }
      }

      if (shouldTrigger) {
        console.log(`Triggering recurring story schedule: ${docSnap.id} for venue: ${schedule.venueName} (${schedule.venueId})`);
        
        // Calculate expiration date (24 hours from now)
        const expiresAtDate = new Date();
        expiresAtDate.setHours(expiresAtDate.getHours() + 24);

        // 1. Write the new story doc
        const newStoryRef = db.collection('stories').doc();
        batch.set(newStoryRef, {
          user_id: `sim_admin_${Date.now()}`,
          venue_id: schedule.venueId,
          media_url: schedule.mediaUrl,
          media_type: schedule.mediaType,
          created_at: admin.firestore.FieldValue.serverTimestamp(),
          expires_at: expiresAtDate,
          activeBadge: 'Admin'
        });

        // 2. Update lastTriggered on the schedule
        batch.update(docSnap.ref, {
          lastTriggered: admin.firestore.FieldValue.serverTimestamp()
        });

        triggerCount++;
      }
    }

    if (triggerCount > 0) {
      await batch.commit();
      console.log(`Successfully triggered ${triggerCount} recurring stories.`);
    } else {
      console.log("No schedules matched the current time slot.");
    }
  } catch (error) {
    console.error("Error executing checkRecurringStories scheduled function:", error);
  }
  return null;
});

