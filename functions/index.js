const functions = require("firebase-functions");
const admin = require("firebase-admin");
const fetch = require("node-fetch");
const { generateMessage } = require("./generator");
const { SCENARIOS, getCoreStanceForScenario, getSecondaryStanceForScenario, STRANGER_OK_SCENARIOS } = require("./scenarios");

admin.initializeApp();


const db = admin.firestore();
const rtdb = admin.database();

const VENUE_RADIUS_METERS = 200;
const STALE_MS = 2 * 60 * 60 * 1000; // 2 hours for location staleness
const CRAZY_THRESHOLD = 90; // >= 90 users

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
// 👥 1. Social / Engagement Notifications Trigger
exports.onNewChatMessage = functions.runWith({ timeoutSeconds: 360, memory: '512MB' }).database.ref('/venue_chats/{venueId}/{messageId}')
  .onCreate(async (snapshot, context) => {
    const messageData = snapshot.val();
    if (!messageData) return;

    const isPersonaMessage = messageData.isPersona === true || (messageData.user_id && messageData.user_id.startsWith('sim_'));

    const venueId = context.params.venueId;
    const messageId = context.params.messageId;
    const senderId = messageData.user_id;

    // Fetch the venue name from Firestore to customize the message
    const venueSnap = await db.collection('venues').doc(venueId).get();
    if (!venueSnap.exists) return;
    const venueName = venueSnap.data().name;

    // Load all users with push tokens
    const usersSnap = await db.collection('users').where('expoPushToken', '!=', null).get();
    const allUsersWithToken = !usersSnap.empty 
      ? usersSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      : [];

    if (allUsersWithToken.length > 0) {
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
          // Persona messages already notify engaged users inside runPersonaActivity — skip here to avoid doubles.
          if (isPersonaMessage) continue;
          // Real user messages: engaged users get unlimited notifications (bypass all limits)
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
          // Non-engaged users: max 2 chat activity notifications per venue per hour (30-min throttle).
          // The throttle key ensures only the first message in each 30-min window pings them.
          await sendRateLimitedPushNotification(
            user.id,
            venueName,
            body,
            { venueId, type: 'chat' },
            `chat_${venueId}`,
            30 * 60 * 1000, // 30-minute throttle → max 2 pings/hour per venue
            false, // bypassLimits
            true // bypassDailyLimit
          );
        }
      }
    }

    // ── Persona Direct Message Reply Trigger ─────────────────────────────
    const venueType = (venueSnap.data().type || '').toUpperCase();
    const parentChainDepth = messageData.chainDepth !== undefined 
      ? parseInt(messageData.chainDepth, 10) 
      : (isPersonaMessage ? 1 : 0);

    // Determine venue tier based on cap & date seed, and hot activation override
    const isHot = await hasRecentRealUserActivity(venueId, 180);
    
    const dateInfo = getRolloverEATDate(Date.now());
    const seedStr = `${dateInfo.year}-${dateInfo.month}-${dateInfo.day}`;
    
    // Load all venues to do the seeded select
    const venuesSnap = await db.collection('venues').get();
    const allVenues = venuesSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((v) => {
        if (v.hidden === true) return false;
        if (v.expirationDate && v.expirationDate < Date.now()) return false;
        if (v.startDate && v.startDate > Date.now()) return false;
        const type = (v.type || '').toUpperCase();
        return type === 'CLUB' || type === 'BAR';
      });
      
    const { selected: selectedVenuesForNight, numDeep } = selectChatVenuesForNight(allVenues, seedStr, dateInfo.weekday);

    let venueTier = null;
    const simIndex = selectedVenuesForNight.findIndex(v => v.id === venueId);
    if (simIndex !== -1) {
      venueTier = simIndex < numDeep ? 'deep' : 'ambient';
    }
    if (isHot) {
      venueTier = 'deep';
    }

    const shouldTriggerReply = (venueTier === 'deep' && (!isPersonaMessage || parentChainDepth < 2));

    if (shouldTriggerReply && (venueType === 'CLUB' || venueType === 'BAR')) {
      try {
        const personasSnap = await db.collection('personas').get();
        if (!personasSnap.empty) {
          const allPersonas = personasSnap.docs.map(d => ({ id: d.id, ...d.data() }));
          // Loop guard: exclude the sender of the triggering message
          const eligiblePersonas = allPersonas.filter(p => p.id !== messageData.user_id);
          const preferredPersonas = eligiblePersonas.filter(p => p.preferredVenueTypes && p.preferredVenueTypes.includes(venueSnap.data().type));
          const personaPool = preferredPersonas.length > 0 ? preferredPersonas : eligiblePersonas;
          if (personaPool.length === 0) return;
          const selectedPersona = personaPool[Math.floor(Math.random() * personaPool.length)];

          // Cooldown and hourly cap check (Loop guard + rate limit verification)
          const cooldownId = `${selectedPersona.id}_${venueId}`;
          let cooldownData = null;
          try {
            const cooldownDoc = await db.collection('persona_cooldowns').doc(cooldownId).get();
            if (cooldownDoc.exists) cooldownData = cooldownDoc.data();
          } catch (err) {
            console.warn(`[Persona Message Reply] Cooldown read failed for ${cooldownId}:`, err.message);
          }

          const nowMs = Date.now();
          const COOLDOWN_MS = 45 * 60 * 1000;
          const VENUE_HOUR_CAP = 3;

          if (cooldownData && cooldownData.lastPostAt && (nowMs - cooldownData.lastPostAt < COOLDOWN_MS)) {
            console.log(`[Persona Message Reply] @${selectedPersona.username} is on cooldown for ${venueName}. Skipping reply.`);
            return;
          }

          const oneHourAgo = nowMs - 60 * 60 * 1000;
          const currentCount = cooldownData && cooldownData.countWindowStart && cooldownData.countWindowStart > oneHourAgo
            ? (cooldownData.venueMessageCount || 0)
            : 0;

          if (currentCount >= VENUE_HOUR_CAP) {
            console.log(`[Persona Message Reply] @${selectedPersona.username} hit hourly cap (${VENUE_HOUR_CAP}) at ${venueName}. Skipping reply.`);
            return;
          }

          // Get simulation settings
          let apiKey = null;
          const simSettingsDoc = await db.collection('settings').doc('simulation').get();
          if (simSettingsDoc.exists) {
            const settingsData = simSettingsDoc.data();
            apiKey = settingsData.anthropicApiKey;
            if (settingsData.enabled !== false && apiKey) {
              const cleanSenderName = (messageData.username || 'EventGoer').toLowerCase().includes('nils') ? 'VibeGoer' : (messageData.username || 'EventGoer');
              
              // Wait for stagger: average 3-5 minutes, randomized between 2-6 minutes (shortened in emulator)
              const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
              const delaySeconds = isEmulator
                ? (Math.floor(Math.random() * 2) + 1)
                : (Math.floor(Math.random() * 240) + 120); // 120 to 360 seconds (2 to 6 minutes)
              console.log(`[Persona Message Reply] Scheduling reply from @${selectedPersona.username} to @${cleanSenderName} in ${delaySeconds} seconds...`);
              await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));

              // Check if original message still exists in RTDB
              const originalMsgSnap = await rtdb.ref(`venue_chats/${venueId}/${messageId}`).once('value');
              if (!originalMsgSnap.exists()) {
                console.log(`[Persona Message Reply] Original message ${messageId} was deleted during the delay. Aborting reply.`);
                return;
              }

              // Fetch last 5 messages to provide context
              const last5Messages = await fetchLast5ChatMessages(venueId);
              const hourLabel = new Date().getHours() > 12 ? `${new Date().getHours() - 12}PM` : new Date().getHours() === 12 ? '12PM' : `${new Date().getHours()}AM`;
              const weekdayLabel = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Africa/Nairobi' }).format(new Date());
              const dayAndTime = `${weekdayLabel} at ${hourLabel}`;

              // Resolve scenario, role, stance, location, and keywords for deep venues
              let scenario = null;
              let role = null;
              let stance = null;
              let location = 'at_venue';
              let scenarioKeywords = [];
              
              if (venueTier === 'deep') {
                if (venueSnap.exists && venueSnap.data().scenarioOverride) {
                  scenario = SCENARIOS.find(s => s.type === venueSnap.data().scenarioOverride);
                }

                if (!scenario) {
                  const deepVenues = selectedVenuesForNight.slice(0, numDeep);
                  const assignedScenarios = {};
                  const usedScenarioIndexes = new Set();
                  deepVenues.forEach((v) => {
                    if (v.scenarioOverride) {
                      const selected = SCENARIOS.find(s => s.type === v.scenarioOverride);
                      if (selected) {
                        assignedScenarios[v.id] = selected;
                        const idx = SCENARIOS.indexOf(selected);
                        if (idx !== -1) usedScenarioIndexes.add(idx);
                        return;
                      }
                    }

                    const hasPairRand = seededRandom(seedStr + '_' + v.id + '_acquaintance', 0);
                    const hasPreExistingPair = hasPairRand < 0.25;

                    let attempt = 0;
                    let selectedScenario = null;
                    while (attempt < 100) {
                      const randVal = seededRandom(seedStr + '_' + v.id, attempt);
                      const scenarioIndex = Math.floor(randVal * SCENARIOS.length);
                      const candidate = SCENARIOS[scenarioIndex];
                      const isAllowed = STRANGER_OK_SCENARIOS.includes(candidate.type) || hasPreExistingPair;
                      
                      if (isAllowed && !usedScenarioIndexes.has(scenarioIndex)) {
                        selectedScenario = candidate;
                        usedScenarioIndexes.add(scenarioIndex);
                        break;
                      }
                      attempt++;
                    }
                    if (!selectedScenario) {
                      for (let i = 0; i < SCENARIOS.length; i++) {
                        const candidate = SCENARIOS[i];
                        const isAllowed = STRANGER_OK_SCENARIOS.includes(candidate.type) || hasPreExistingPair;
                        if (isAllowed && !usedScenarioIndexes.has(i)) {
                          selectedScenario = candidate;
                          usedScenarioIndexes.add(i);
                          break;
                        }
                      }
                    }
                    assignedScenarios[v.id] = selectedScenario;
                  });

                  scenario = assignedScenarios[venueId];
                }

                if (!scenario) {
                  const hasPairRand = seededRandom(seedStr + '_' + venueId + '_acquaintance', 0);
                  const hasPreExistingPair = hasPairRand < 0.25;
                  
                  let attempt = 0;
                  while (attempt < 100) {
                    const randVal = seededRandom(seedStr + '_' + venueId, attempt);
                    const scenarioIndex = Math.floor(randVal * SCENARIOS.length);
                    const candidate = SCENARIOS[scenarioIndex];
                    if (STRANGER_OK_SCENARIOS.includes(candidate.type) || hasPreExistingPair) {
                      scenario = candidate;
                      break;
                    }
                    attempt++;
                  }
                  if (!scenario) {
                    scenario = SCENARIOS.find(s => STRANGER_OK_SCENARIOS.includes(s.type));
                  }
                }

                if (scenario) {
                  scenarioKeywords = scenario.keywords || [];
                  const roleAssignments = assignPersonaRolesForScenario(allPersonas, scenario, seedStr, venueId);
                  if (roleAssignments && roleAssignments[selectedPersona.id]) {
                    role = roleAssignments[selectedPersona.id].role;
                    stance = roleAssignments[selectedPersona.id].stance;

                    if (scenario.type === 'from_home' && role === 'homebody') {
                      location = 'at_home';
                    } else if (scenario.type === 'always_late' && role === 'latecomer') {
                      location = 'en_route';
                    }
                  }
                }
              }

              let isStranger = true;
              let friendUsername = '';
              if (venueTier === 'deep' && scenario) {
                const hasPairRand = seededRandom(seedStr + '_' + venueId + '_acquaintance', 0);
                const hasPreExistingPair = hasPairRand < 0.25;
                if (hasPreExistingPair) {
                  const shuffled = seededShuffle(allPersonas, seedStr + '_' + venueId);
                  const pair = [shuffled[0].username, shuffled[1].username];
                  if (pair.includes(selectedPersona.username)) {
                    isStranger = false;
                    friendUsername = pair[0] === selectedPersona.username ? pair[1] : pair[0];
                  }
                }
              }

              const venueForTier = allVenues.find(v => v.id === venueId) || { id: venueId, ...venueSnap.data() };
              let replyText = await generateMessage({
                variant: 'dm',
                persona: selectedPersona,
                venueName: venueName,
                history: last5Messages,
                daypart: dayAndTime,
                senderName: cleanSenderName,
                senderMessage: messageData.message || '',
                tier: venueTier,
                crowdLevel: CROWD_LEVEL_BY_TIER[getVenueCrowdTier(venueForTier, allVenues)],
                role: role,
                stance: stance,
                location: location,
                scenarioKeywords: scenarioKeywords,
                apiKey: apiKey,
                historyLimit: 5,
                isStranger,
                friendUsername
              });

              if (replyText && replyText.length > 0) {
                const chatRef = rtdb.ref(`venue_chats/${venueId}`);
                const newMsgRef = chatRef.push();
                const replyTimestamp = Date.now();
                await newMsgRef.set({
                  user_id: selectedPersona.id,
                  username: selectedPersona.username,
                  message: replyText,
                  type: 'text',
                  timestamp: replyTimestamp,
                  isPersona: true,
                  chainDepth: parentChainDepth + 1
                });
                console.log(`[Persona Message Reply] ✓ Posted @${selectedPersona.username} reply to @${cleanSenderName} at ${venueName} (chainDepth: ${parentChainDepth + 1})`);

                // Update cooldown
                const cooldownDocRef = db.collection('persona_cooldowns').doc(cooldownId);
                const oneHourAgoMs = Date.now() - 60 * 60 * 1000;
                
                await db.runTransaction(async (t) => {
                  const currentCooldown = await t.get(cooldownDocRef);
                  let finalCount = 1;
                  let finalWindowStart = Date.now();
                  
                  if (currentCooldown.exists) {
                    const data = currentCooldown.data();
                    const windowStartVal = data.countWindowStart || Date.now();
                    if (windowStartVal > oneHourAgoMs) {
                      finalCount = (data.venueMessageCount || 0) + 1;
                      finalWindowStart = windowStartVal;
                    }
                  }
                  
                  t.set(cooldownDocRef, {
                    personaId: selectedPersona.id,
                    venueId: venueId,
                    lastPostAt: Date.now(),
                    venueMessageCount: finalCount,
                    countWindowStart: finalWindowStart
                  }, { merge: true });
                });

                // Push notification to members
                try {
                  const oneHourMs = 60 * 60 * 1000;
                  for (const [memberId, memberData] of Object.entries(members)) {
                    if (memberId.startsWith('sim_') || memberId.startsWith('persona_') || memberId === selectedPersona.id) continue;
                    const isEngaged = memberData.lastInteractionTime && (Date.now() - memberData.lastInteractionTime < oneHourMs);
                    if (!isEngaged) continue;

                    await sendRateLimitedPushNotification(
                      memberId,
                      venueName,
                      `${selectedPersona.username}: ${replyText}`,
                      { venueId, type: 'chat' },
                      null,
                      0,
                      true
                    );
                  }
                } catch (pushErr) {
                  console.warn('[Persona Message Reply] Push notification dispatch failed (non-fatal):', pushErr.message);
                }
              }
            }
          }
        }
      } catch (err) {
        console.error('[Persona Message Reply] Failed to generate automated message reply:', err);
      }
    }
  });

// 👥 1b. Real-Time Chat Reaction Trigger
exports.onChatReaction = functions.runWith({ timeoutSeconds: 360, memory: '512MB' })
  .database.ref('/venue_chats/{venueId}/{messageId}/reactions/{emoji}/{userId}')
  .onCreate(async (snapshot, context) => {
    const reactingUsername = snapshot.val();
    if (!reactingUsername) return;

    const { venueId, messageId, emoji, userId } = context.params;

    // If the reacting user is a persona or simulated user, ignore
    if (userId.startsWith('sim_') || userId.startsWith('persona_')) return;

    // Fetch the original message
    const msgSnap = await rtdb.ref(`venue_chats/${venueId}/${messageId}`).once('value');
    if (!msgSnap.exists()) return;
    const originalMessage = msgSnap.val();

    // Only respond if the original message was sent by a persona
    if (!originalMessage.isPersona) return;

    const personaId = originalMessage.user_id;

    // Fetch the persona's details
    const personaDoc = await db.collection('personas').doc(personaId).get();
    if (!personaDoc.exists) return;
    const persona = { id: personaDoc.id, ...personaDoc.data() };

    // Fetch the venue
    const venueSnap = await db.collection('venues').doc(venueId).get();
    if (!venueSnap.exists) return;
    const venueName = venueSnap.data().name;
    const venueType = (venueSnap.data().type || '').toUpperCase();

    // Nightlife constraint
    if (venueType !== 'CLUB' && venueType !== 'BAR') return;

    // Load API Key
    let apiKey = null;
    const simSettingsDoc = await db.collection('settings').doc('simulation').get();
    if (simSettingsDoc.exists) {
      const settingsData = simSettingsDoc.data();
      apiKey = settingsData.anthropicApiKey;
      if (settingsData.enabled === false) return;
    }

    if (!apiKey) return;

    const cleanReactingName = reactingUsername.toLowerCase().includes('nils') ? 'VibeGoer' : reactingUsername;

    // Wait for stagger: average 3-5 minutes, randomized between 2-6 minutes
    const delaySeconds = Math.floor(Math.random() * 240) + 120; // 120 to 360 seconds
    console.log(`[Persona Reaction Reply] Scheduling reaction reply from @${persona.username} to @${cleanReactingName} in ${delaySeconds} seconds...`);
    await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));

    // Check if reaction still exists in RTDB
    const reactionSnap = await rtdb.ref(`/venue_chats/${venueId}/${messageId}/reactions/${emoji}/${userId}`).once('value');
    if (!reactionSnap.exists()) {
      console.log(`[Persona Reaction Reply] Reaction was removed during the delay. Aborting reply.`);
      return;
    }

    try {
      // Fetch last 5 messages to provide context
      const last5Messages = await fetchLast5ChatMessages(venueId);
      const hourLabel = new Date().getHours() > 12 ? `${new Date().getHours() - 12}PM` : new Date().getHours() === 12 ? '12PM' : `${new Date().getHours()}AM`;
      const weekdayLabel = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Africa/Nairobi' }).format(new Date());
      const dayAndTime = `${weekdayLabel} at ${hourLabel}`;

      let replyText = await generateMessage({
        variant: 'reaction',
        persona: persona,
        venueName: venueName,
        history: last5Messages,
        daypart: dayAndTime,
        reactingName: cleanReactingName,
        reactionEmoji: emoji,
        originalMessage: originalMessage.message,
        apiKey: apiKey
      });

      if (replyText && replyText.length > 0) {
        const chatRef = rtdb.ref(`venue_chats/${venueId}`);
        const newMsgRef = chatRef.push();
        await newMsgRef.set({
          user_id: persona.id,
          username: persona.username,
          message: replyText,
          type: 'text',
          timestamp: Date.now(),
          isPersona: true,
          chainDepth: 0
        });
        console.log(`[Persona Reaction Reply] ✓ Posted @${persona.username} reaction reply to @${cleanReactingName} in ${venueName}`);

        // Update cooldown
        const cooldownId = `${persona.id}_${venueId}`;
        await db.collection('persona_cooldowns').doc(cooldownId).set({
          personaId: persona.id,
          venueId: venueId,
          lastPostAt: Date.now(),
          venueMessageCount: admin.firestore.FieldValue.increment(1),
          countWindowStart: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        // Push notification to members
        try {
          const membersSnap = await rtdb.ref(`venue_members/${venueId}`).once('value');
          if (membersSnap.exists()) {
            const members = membersSnap.val();
            const oneHourMs = 60 * 60 * 1000;
            for (const [memberId, memberData] of Object.entries(members)) {
              if (memberId.startsWith('sim_') || memberId.startsWith('persona_') || memberId === persona.id) continue;
              const isEngaged = memberData.lastInteractionTime && (Date.now() - memberData.lastInteractionTime < oneHourMs);
              if (!isEngaged) continue;

              await sendRateLimitedPushNotification(
                memberId,
                venueName,
                `${persona.username}: ${replyText}`,
                { venueId, type: 'chat' },
                null,
                0,
                true
              );
            }
          }
        } catch (pushErr) {
          console.warn('[Persona Reaction Reply] Push notification failed:', pushErr.message);
        }
      }
    } catch (err) {
      console.error('[Persona Reaction Reply] Failed to generate automated reaction reply:', err);
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

// ── Rotating hot-venue ranking ────────────────────────────────────────────
// Which venue is "hot" reshuffles every 3h slot via a seeded random draw per
// (venue, slot). Deterministic, so the app client and all functions agree on
// the same hot venue at any moment, but the winner changes slot to slot and
// never repeats a fixed daily pattern. Base popularity keeps a 30% pull so
// well-known venues trend hot slightly more often.
const HOT_ROTATION_SLOT_MS = 3 * 60 * 60 * 1000;

function seededUnitRandom(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function getRotatingHotScore(venue, nowMs = Date.now()) {
  const slot = Math.floor(nowMs / HOT_ROTATION_SLOT_MS);
  const base = venue.simPopularityScore !== undefined ? venue.simPopularityScore : 0.5;
  const roll = seededUnitRandom(`${venue.id}|hot|${slot}`);
  return 0.3 * base + 0.7 * roll;
}

function getVenueCrowdTier(venue, allVenues, nowMs = Date.now()) {
  let tier = 'low';
  if (allVenues && Array.isArray(allVenues)) {
    const categoryVenues = allVenues.filter(v => v.type === venue.type);
    if (categoryVenues.length > 0) {
      const sorted = [...categoryVenues].sort(
        (a, b) => getRotatingHotScore(b, nowMs) - getRotatingHotScore(a, nowMs)
      );
      const rankIndex = sorted.findIndex(v => v.id === venue.id);
      if (rankIndex !== -1) {
        const percentile = rankIndex / sorted.length;
        if (percentile < 0.10) {
          tier = 'hot';
        } else if (percentile < 0.40) {
          tier = 'medium';
        }
      }
    }
  }
  return tier;
}

// Chat follows the crowd: persona conversations happen at the venues currently
// ranking hottest, so the busiest-looking venues are also the ones talking.
function selectChatVenuesForNight(allVenues, seedStr, weekday, nowMs = Date.now()) {
  const totalSimCap = ['Fri', 'Sat'].includes(weekday) ? 4 : 2;
  const ranked = [...allVenues].sort(
    (a, b) => getRotatingHotScore(b, nowMs) - getRotatingHotScore(a, nowMs)
  );
  const selected = ranked.slice(0, totalSimCap);
  const numDeep = ['Fri', 'Sat'].includes(weekday)
    ? (seededRandom(seedStr, 999) < 0.5 ? 1 : 2)
    : 0;
  return { selected, numDeep };
}

const CROWD_LEVEL_BY_TIER = { hot: 'packed', medium: 'busy', low: 'quiet' };

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

  const nairobiDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(now);
  const isOverride = venue.isOverride === true && venue.overrideDate === nairobiDateStr;
  if (isOverride) {
    return venue.simulatedUsersCount !== undefined ? venue.simulatedUsersCount : 20;
  }

  // Determine tier within category (Default: 10% hot, 30% medium, 60% low)
  // Ranking reshuffles randomly every 3h slot — see getRotatingHotScore.
  const tier = getVenueCrowdTier(venue, allVenues);

  const isNightlifePeak = (day, hr) => {
    if (hr >= 21) {
      return ['Fri', 'Sat', 'Sun'].includes(day);
    } else if (hr < 4) {
      return ['Sat', 'Sun', 'Mon'].includes(day);
    }
    return false;
  };

  let count = 0;
  if (venue.type === 'Club') {
    if (['Mon', 'Tue'].includes(weekday)) {
      if (tier === 'hot') count = 10;
      else if (tier === 'medium') count = 5;
      else count = 2;
    } else if (weekday === 'Wed') {
      if (tier === 'hot') count = 15;
      else if (tier === 'medium') count = 8;
      else count = 3;
    } else {
      // Thu - Sun
      const isClubPeak = (day, hr) => {
        if (hr >= 21) return ['Thu', 'Fri', 'Sat', 'Sun'].includes(day);
        if (hr < 4) return ['Fri', 'Sat', 'Sun', 'Mon'].includes(day);
        return false;
      };
      if (isClubPeak(weekday, hour)) {
        if (tier === 'hot') count = 98;
        else if (tier === 'medium') count = 60;
        else count = 25;
      } else if (hour >= 21 || hour < 4) {
        if (tier === 'hot') count = 45;
        else if (tier === 'medium') count = 20;
        else count = 8;
      } else {
        if (tier === 'hot') count = 10;
        else if (tier === 'medium') count = 4;
        else count = 0;
      }
    }
  } else if (venue.type === 'Bar') {
    if (['Mon', 'Tue'].includes(weekday)) {
      if (tier === 'hot') count = 15;
      else if (tier === 'medium') count = 8;
      else count = 3;
    } else if (['Wed', 'Thu'].includes(weekday)) {
      if (tier === 'hot') count = 20;
      else if (tier === 'medium') count = 10;
      else count = 4;
    } else {
      // Fri - Sun
      if (isNightlifePeak(weekday, hour)) {
        if (tier === 'hot') count = 50;
        else if (tier === 'medium') count = 35;
        else count = 15;
      } else if (hour >= 21 || hour < 4) {
        if (tier === 'hot') count = 25;
        else if (tier === 'medium') count = 12;
        else count = 5;
      } else {
        if (tier === 'hot') count = 5;
        else if (tier === 'medium') count = 2;
        else count = 0;
      }
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
        if (tier === 'hot') count = 150;
        else if (tier === 'medium') count = 80;
        else count = 30;
      } else {
        if (tier === 'hot') count = 40;
        else if (tier === 'medium') count = 20;
        else count = 5;
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
  const nairobiDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(currentDate);
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
    let isOverride = venue.isOverride === true;
    if (isOverride && venue.overrideDate !== nairobiDateStr) {
      db.collection('venues').doc(venue.id).update({
        isOverride: false
      }).catch(err => console.error(`[notifyHotVenues] Failed to reset override for ${venue.name}:`, err));
      isOverride = false;
      venue.isOverride = false;
    }

    // If the venue has a start date in the future, skip notifications for it
    if (venue.startDate && now < venue.startDate) {
      console.log(`Venue/Event ${venue.name} has not started yet (starts at ${new Date(venue.startDate).toISOString()}). Skipping.`);
      continue;
    }

    // If the venue has an expiration date in the past, skip notifications for it
    if (venue.expirationDate && now > venue.expirationDate) {
      console.log(`Venue/Event ${venue.name} has already expired (expired at ${new Date(venue.expirationDate).toISOString()}). Skipping.`);
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

// Scheduled Engagement Notification (runs 1st, 10th, and 20th of every month at 9:00 AM Nairobi time)
exports.monthlyEngagementNotification = functions.pubsub
  .schedule("0 9 1,10,20 * *")
  .timeZone("Africa/Nairobi")
  .onRun(async (context) => {
    console.log("Running scheduled monthly engagement notification...");
    try {
      const now = new Date();
      // Get current day, month, and year in Africa/Nairobi timezone
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Nairobi',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
      });
      const formatted = formatter.format(now);
      const [yearStr, monthStr, dayStr] = formatted.split('-');
      const year = parseInt(yearStr, 10);
      const month = parseInt(monthStr, 10);
      const day = parseInt(dayStr, 10);

      console.log(`Date in Nairobi: ${year}-${month}-${day}`);

      // Double check that we are running on the 1st, 10th, or 20th
      if (day !== 1 && day !== 10 && day !== 20) {
        console.log(`Today is day ${day}. Monthly engagement notification only runs on 1st, 10th, and 20th. Skipping.`);
        return null;
      }

      let title = "";
      let body = "";

      if (day === 1) {
        title = "🏁 A New Month Begins!";
        body = "The slate has been cleaned! 🌟 Everyone starts fresh today. Time to get out there, check in, and start your journey to the top! 🚀";
      } else {
        const daysInMonth = new Date(year, month, 0).getDate();
        const daysLeft = daysInMonth - day;

        title = "🏆 Legend Prize Countdown!";
        body = `Only ${daysLeft} days left to climb the leaderboard this month! Keep active, visit venues, and secure that Legend Prize! ✨`;
      }

      // Load all users with push tokens
      const usersSnap = await db.collection('users').where('expoPushToken', '!=', null).get();
      if (usersSnap.empty) {
        console.log('No users with push tokens found.');
        return null;
      }

      console.log(`Sending monthly engagement notification to ${usersSnap.size} users.`);

      let successCount = 0;
      for (const doc of usersSnap.docs) {
        const sent = await sendRateLimitedPushNotification(
          doc.id,
          title,
          body,
          { type: 'monthly_engagement', day: day },
          null,
          0,
          true // bypassLimits - critical engagement alerts should bypass standard daily rate limits
        );
        if (sent) {
          successCount++;
        }
      }

      console.log(`Successfully dispatched monthly engagement notification to ${successCount} users.`);
    } catch (error) {
      console.error("Error in monthlyEngagementNotification scheduled function:", error);
    }
    return null;
  });

// ─────────────────────────────────────────────────────────────────────────────
// 🤖 AI PERSONA CHAT SYSTEM
// 25 fixed fictional Nairobi user personas post to venue group chats during
// peak hours. Messages are generated via Claude Haiku (claude-haiku-4-5).
// ─────────────────────────────────────────────────────────────────────────────

// Prompt building, call API, and post-processing functions have been moved to generator.js.


/**
 * Returns current Nairobi time parts.
 * @return {{ weekday: string, hour: number, minute: number }}
 */
function getPersonaNairobiTime() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Nairobi',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now);

  let weekday = 'Mon';
  let hour = 12;
  let minute = 0;

  parts.forEach((p) => {
    if (p.type === 'weekday') weekday = p.value;
    if (p.type === 'hour') hour = parseInt(p.value, 10);
    if (p.type === 'minute') minute = parseInt(p.value, 10);
  });
  if (hour === 24) hour = 0;

  return { weekday, hour, minute };
}

function getRolloverEATDate(nowMs = Date.now()) {
  const format = (options) => new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Nairobi', ...options }).format(nowMs);
  
  const yearStr = format({ year: 'numeric' });
  const monthStr = format({ month: 'numeric' });
  const dayStr = format({ day: 'numeric' });
  const hourStr = format({ hour: 'numeric', hour12: false });
  
  let year = parseInt(yearStr, 10);
  let month = parseInt(monthStr, 10);
  let day = parseInt(dayStr, 10);
  let hour = parseInt(hourStr, 10);
  if (hour === 24) hour = 0;
  
  if (hour < 5) {
    const d = new Date(nowMs - 24 * 60 * 60 * 1000);
    const prevFormat = (options) => new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Nairobi', ...options }).format(d);
    return {
      year: parseInt(prevFormat({ year: 'numeric' }), 10),
      month: parseInt(prevFormat({ month: 'numeric' }), 10),
      day: parseInt(prevFormat({ day: 'numeric' }), 10),
      weekday: prevFormat({ weekday: 'short' }),
      hour: hour
    };
  }
  
  return {
    year,
    month,
    day,
    weekday: format({ weekday: 'short' }),
    hour
  };
}

function seededShuffle(array, seedStr) {
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) {
    seed = (seed << 5) - seed + seedStr.charCodeAt(i);
    seed |= 0;
  }
  const random = () => {
    let x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  };
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function seededRandom(seedStr, extraSeed = 0) {
  let seed = extraSeed;
  const combined = seedStr + String(extraSeed);
  for (let i = 0; i < combined.length; i++) {
    seed = (seed << 5) - seed + combined.charCodeAt(i);
    seed |= 0;
  }
  let x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function assignPersonaRolesForScenario(allPersonas, scenario, seedStr, venueId) {
  const seed = seedStr + '_' + venueId;
  const shuffled = seededShuffle(allPersonas, seed);
  
  const roleAssignments = {};
  
  if (['which_spot'].includes(scenario.type)) {
    shuffled.forEach((persona, index) => {
      const role = index % 2 === 0 ? scenario.roles[0] : scenario.roles[1];
      roleAssignments[persona.id] = {
        role: role,
        stance: role === scenario.roles[0] ? 'Prefers staying/coming to this spot.' : 'Wants to move to the other spot.'
      };
    });
  } else {
    shuffled.forEach((persona, index) => {
      if (index === 0) {
        roleAssignments[persona.id] = {
          role: scenario.roles[0],
          stance: getCoreStanceForScenario(scenario.type)
        };
      } else {
        roleAssignments[persona.id] = {
          role: scenario.roles[1],
          stance: getSecondaryStanceForScenario(scenario.type)
        };
      }
    });
  }
  return roleAssignments;
}

/**
 * Determines the activity window for personas given current Nairobi time.
 * Returns null if this is a dead-silent period.
 * @param {string} weekday
 * @param {number} hour
 * @return {{ window: string, personaSampleSize: number } | null}
 */
function getPersonaActivityWindow(weekday, hour) {
  // Fri & Sat: 7pm–2am  → full activity, 3–5 personas
  if (['Fri', 'Sat'].includes(weekday) && (hour >= 19 || hour < 2)) {
    return { window: 'peak_night', personaSampleSize: Math.floor(Math.random() * 3) + 3 }; // 3–5
  }
  // Sat/Sun early morning (carries over from Fri/Sat nights)
  if (weekday === 'Sun' && hour < 2) {
    return { window: 'peak_night', personaSampleSize: Math.floor(Math.random() * 3) + 3 };
  }
  // Wed & Thu: 8pm–midnight → full activity, 3–5 personas
  if (['Wed', 'Thu'].includes(weekday) && hour >= 20 && hour < 24) {
    return { window: 'mid_week_night', personaSampleSize: Math.floor(Math.random() * 3) + 3 };
  }
  // Sun, Mon, Tue: 8pm–midnight → light activity, 1–2 personas
  if (['Sun', 'Mon', 'Tue'].includes(weekday) && hour >= 20 && hour < 24) {
    return { window: 'light_night', personaSampleSize: Math.floor(Math.random() * 2) + 1 }; // 1-2
  }
  // Mon–Fri 3pm–6pm → light afternoon, 1–2 personas
  if (['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday) && hour >= 15 && hour < 18) {
    return { window: 'afternoon', personaSampleSize: Math.floor(Math.random() * 2) + 1 };
  }
  if (['Mon', 'Tue'].includes(weekday) && (hour < 15 || hour >= 18)) {
    return null; // silent
  }
  // All other unlisted times: also silent
  return null;
}

/**
 * Fetches the last 5 messages from a venue chat in RTDB.
 * Returns a formatted string for use in the Haiku prompt.
 * @param {string} venueId
 * @return {Promise<string>}
 */
async function fetchLast5ChatMessages(venueId) {
  try {
    const { limitToLast, query: rtdbQuery, ref: rtdbRef } = require('firebase-admin/database');
    // Use standard RTDB admin SDK query
    const snap = await rtdb.ref(`venue_chats/${venueId}`).orderByChild('timestamp').limitToLast(5).once('value');
    if (!snap.exists()) return 'No recent messages.';

    const messages = [];
    snap.forEach((child) => {
      const msg = child.val();
      if (msg && msg.username && msg.message && msg.type === 'text') {
        messages.push(`${msg.username}: ${msg.message}`);
      }
    });
    return messages.length > 0 ? messages.join('\n') : 'No recent messages.';
  } catch (err) {
    console.warn(`[Persona] Could not fetch last messages for venue ${venueId}:`, err.message);
    return 'No recent messages.';
  }
}

/**
 * Checks whether a real (non-persona) user has posted in the last N minutes.
 * @param {string} venueId
 * @param {number} withinMinutes
 * @return {Promise<boolean>}
 */
async function hasRecentRealUserActivity(venueId, withinMinutes) {
  try {
    const cutoff = Date.now() - withinMinutes * 60 * 1000;
    const snap = await rtdb.ref(`venue_chats/${venueId}`).orderByChild('timestamp').startAt(cutoff).once('value');
    if (!snap.exists()) return false;

    let found = false;
    snap.forEach((child) => {
      const msg = child.val();
      // isPersona field marks persona messages; absence = real user
      if (msg && !msg.isPersona && msg.user_id && !msg.user_id.startsWith('sim_')) {
        found = true;
      }
    });
    return found;
  } catch (err) {
    console.warn(`[Persona] Could not check real user activity for ${venueId}:`, err.message);
    return false;
  }
}

/**
 * Shuffles an array in place (Fisher-Yates).
 */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ─────────────────────────────────────────────────────────────────────────────
// 🕑 Scheduled Persona Activity Runner (every 30 minutes)
// ─────────────────────────────────────────────────────────────────────────────
exports.runPersonaActivity = functions.pubsub.schedule('every 30 minutes').onRun(async (context) => {
  console.log('[Persona] Starting persona activity cycle...');

  // ── 1. Check current Nairobi time ────────────────────────────────────────
  const nowMs = Date.now();
  const dateInfo = getRolloverEATDate(nowMs);
  const weekday = dateInfo.weekday;
  const hour = dateInfo.hour;
  
  const calendarTime = getPersonaNairobiTime();
  console.log(`[Persona] Nairobi Calendar time: ${calendarTime.weekday} ${String(calendarTime.hour).padStart(2, '0')}:${String(calendarTime.minute).padStart(2, '0')}`);
  console.log(`[Persona] Nairobi Rollover time: ${weekday} ${String(hour).padStart(2, '0')}:00`);

  const activityWindow = getPersonaActivityWindow(weekday, hour);
  if (!activityWindow) {
    console.log(`[Persona] Dead-silent period (${weekday} ${hour}:00). No persona activity.`);
    return null;
  }
  console.log(`[Persona] Active window: ${activityWindow.window} — selecting ${activityWindow.personaSampleSize} personas.`);

  // ── 2. Load Anthropic API key ────────────────────────────────────────────
  let apiKey = null;
  try {
    const simSettingsDoc = await db.collection('settings').doc('simulation').get();
    if (simSettingsDoc.exists) {
      const settingsData = simSettingsDoc.data();
      apiKey = settingsData.anthropicApiKey;
      if (settingsData.enabled === false) {
        console.log('[Persona] Simulation globally disabled. Skipping.');
        return null;
      }
    }
  } catch (err) {
    console.error('[Persona] Failed to load simulation settings:', err);
    return null;
  }

  if (!apiKey) {
    console.warn('[Persona] anthropicApiKey not set in settings/simulation. Skipping.');
    return null;
  }

  // ── 3. Load personas & venues ────────────────────────────────────────────
  const [personasSnap, venuesSnap] = await Promise.all([
    db.collection('personas').get(),
    db.collection('venues').get(),
  ]);

  if (personasSnap.empty) {
    console.warn('[Persona] No personas found. Run scripts/seedPersonas.js first.');
    return null;
  }
  if (venuesSnap.empty) {
    console.warn('[Persona] No venues found.');
    return null;
  }

  const allPersonas = personasSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const allVenues = venuesSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((v) => {
      const nowMs = Date.now();
      if (v.hidden === true) return false;
      if (v.expirationDate && v.expirationDate < nowMs) return false;
      if (v.startDate && v.startDate > nowMs) return false;
      const type = (v.type || '').toUpperCase();
      return type === 'CLUB' || type === 'BAR';
    });

  if (allVenues.length === 0) {
    console.log('[Persona] No active venues. Skipping.');
    return null;
  }

  // ── Select active targeted venues per day ──
  const seedStr = `${dateInfo.year}-${dateInfo.month}-${dateInfo.day}`;



  const { selected: selectedVenuesForNight, numDeep } = selectChatVenuesForNight(allVenues, seedStr, weekday, nowMs);

  // Track simulated venue tiers
  const simulatedVenueTiers = {};
  selectedVenuesForNight.forEach((venue, index) => {
    simulatedVenueTiers[venue.id] = index < numDeep ? 'deep' : 'ambient';
  });

  // Assign distinct scenarios to deep venues
  const deepVenues = selectedVenuesForNight.slice(0, numDeep);
  const assignedScenarios = {};
  const usedScenarioIndexes = new Set();
  deepVenues.forEach((venue) => {
    if (venue.scenarioOverride) {
      const selected = SCENARIOS.find(s => s.type === venue.scenarioOverride);
      if (selected) {
        assignedScenarios[venue.id] = selected;
        const idx = SCENARIOS.indexOf(selected);
        if (idx !== -1) usedScenarioIndexes.add(idx);
        return;
      }
    }

    const hasPairRand = seededRandom(seedStr + '_' + venue.id + '_acquaintance', 0);
    const hasPreExistingPair = hasPairRand < 0.25;

    let attempt = 0;
    let selectedScenario = null;
    while (attempt < 100) {
      const randVal = seededRandom(seedStr + '_' + venue.id, attempt);
      const scenarioIndex = Math.floor(randVal * SCENARIOS.length);
      const candidate = SCENARIOS[scenarioIndex];
      const isAllowed = STRANGER_OK_SCENARIOS.includes(candidate.type) || hasPreExistingPair;
      
      if (isAllowed && !usedScenarioIndexes.has(scenarioIndex)) {
        selectedScenario = candidate;
        usedScenarioIndexes.add(scenarioIndex);
        break;
      }
      attempt++;
    }
    if (!selectedScenario) {
      for (let i = 0; i < SCENARIOS.length; i++) {
        const candidate = SCENARIOS[i];
        const isAllowed = STRANGER_OK_SCENARIOS.includes(candidate.type) || hasPreExistingPair;
        if (isAllowed && !usedScenarioIndexes.has(i)) {
          selectedScenario = candidate;
          usedScenarioIndexes.add(i);
          break;
        }
      }
    }
    assignedScenarios[venue.id] = selectedScenario;
  });

  // Pre-calculate persona role assignments for each deep venue
  const deepVenueRoleAssignments = {};
  deepVenues.forEach((venue) => {
    const scenario = assignedScenarios[venue.id];
    deepVenueRoleAssignments[venue.id] = assignPersonaRolesForScenario(allPersonas, scenario, seedStr, venue.id);
  });

  // Find any uncapped active hot venues (real-user activity in last 3 hours)
  const hotVenues = [];
  for (const venue of allVenues) {
    const isHot = await hasRecentRealUserActivity(venue.id, 180);
    if (isHot && !selectedVenuesForNight.some(sv => sv.id === venue.id)) {
      hotVenues.push(venue);
    }
  }

  // Combine simulated and hot venues
  const activeVenues = [...selectedVenuesForNight, ...hotVenues];

  console.log(`[Persona] Selected ${selectedVenuesForNight.length} simulated venues for ${weekday} (seed: ${seedStr}, numDeep: ${numDeep}): ${selectedVenuesForNight.map(v => `${v.name} (${simulatedVenueTiers[v.id]}${simulatedVenueTiers[v.id] === 'deep' ? `, Scenario: ${assignedScenarios[v.id].type}` : ''})`).join(', ')}`);
  if (hotVenues.length > 0) {
    console.log(`[Persona] Appended ${hotVenues.length} hot venues active with real users: ${hotVenues.map(v => v.name).join(', ')}`);
  }

  if (activeVenues.length === 0) return null;



  // ── 4. Sample personas for this cycle ───────────────────────────────────
  const shuffledPersonas = shuffleArray([...allPersonas]);
  const selectedPersonas = shuffledPersonas.slice(0, activityWindow.personaSampleSize);
  console.log(`[Persona] Selected personas: ${selectedPersonas.map((p) => p.username).join(', ')}`);

  const COOLDOWN_MS = 45 * 60 * 1000;        // 45 minutes cooldown per persona×venue
  const VENUE_HOUR_CAP = 3;                   // max 3 persona messages per venue per hour
  const REAL_USER_WINDOW_MIN = 10;            // "active" real user = posted in last 10 min
  let totalMessagesPosted = 0;

  // ── 5. Clean up stale cooldown docs (older than 24h) ────────────────────
  try {
    const staleCutoff = new Date(nowMs - 24 * 60 * 60 * 1000);
    const staleSnap = await db.collection('persona_cooldowns')
      .where('lastPostAt', '<', staleCutoff.getTime())
      .get();
    if (!staleSnap.empty) {
      const cleanupBatch = db.batch();
      staleSnap.docs.forEach((d) => cleanupBatch.delete(d.ref));
      await cleanupBatch.commit();
      console.log(`[Persona] Cleaned up ${staleSnap.size} stale cooldown docs.`);
    }
  } catch (err) {
    console.warn('[Persona] Cooldown cleanup failed (non-fatal):', err.message);
  }

  // ── 6. Process each selected persona ────────────────────────────────────
  for (const persona of selectedPersonas) {
    // Pick a venue this persona would visit (prefer their preferred types) from activeVenues pool,
    // weighted toward venues currently showing bigger crowds so chat lands where people are.
    const preferredVenues = activeVenues.filter(
      (v) => persona.preferredVenueTypes && persona.preferredVenueTypes.includes(v.type)
    );
    const venuePool = preferredVenues.length > 0 ? preferredVenues : activeVenues;
    const tierWeights = { hot: 6, medium: 3, low: 1 };
    const weightedPool = venuePool.map((v) => ({ v, w: tierWeights[getVenueCrowdTier(v, allVenues, nowMs)] || 1 }));
    let venueRoll = Math.random() * weightedPool.reduce((sum, x) => sum + x.w, 0);
    let targetVenue = weightedPool[0].v;
    for (const { v, w } of weightedPool) {
      venueRoll -= w;
      if (venueRoll <= 0) { targetVenue = v; break; }
    }

    // ── a. Cooldown check ──────────────────────────────────────────────────
    const cooldownId = `${persona.id}_${targetVenue.id}`;
    let cooldownData = null;
    try {
      const cooldownDoc = await db.collection('persona_cooldowns').doc(cooldownId).get();
      if (cooldownDoc.exists) cooldownData = cooldownDoc.data();
    } catch (err) {
      console.warn(`[Persona] Cooldown read failed for ${cooldownId}:`, err.message);
    }

    if (cooldownData && cooldownData.lastPostAt && (nowMs - cooldownData.lastPostAt < COOLDOWN_MS)) {
      const remainMin = Math.round((COOLDOWN_MS - (nowMs - cooldownData.lastPostAt)) / 60000);
      console.log(`[Persona] @${persona.username} cooldown for ${targetVenue.name} (${remainMin}m left). Skipping.`);
      continue;
    }

    // ── b. Venue hourly cap check ──────────────────────────────────────────
    const oneHourAgo = nowMs - 60 * 60 * 1000;
    const windowStart = cooldownData && cooldownData.countWindowStart && cooldownData.countWindowStart > oneHourAgo
      ? cooldownData.countWindowStart
      : nowMs;
    const currentCount = cooldownData && cooldownData.countWindowStart && cooldownData.countWindowStart > oneHourAgo
      ? (cooldownData.venueMessageCount || 0)
      : 0;

    if (currentCount >= VENUE_HOUR_CAP) {
      console.log(`[Persona] Venue ${targetVenue.name} hit hourly cap (${VENUE_HOUR_CAP} persona msgs/hr). Skipping @${persona.username}.`);
      continue;
    }

    // ── c. Real user activity — adjust reply probability ──────────────────
    const isPeakWindow = activityWindow.window === 'peak_night' || activityWindow.window === 'mid_week_night';
    const realUserActive = await hasRecentRealUserActivity(targetVenue.id, REAL_USER_WINDOW_MIN);
    let replyChance = isPeakWindow ? (Math.random() * 0.2 + 0.7) : (realUserActive ? 0.70 : 0.30);
    // Quiet venues chat less — keep the chatter where the crowd is
    const targetCrowdTier = getVenueCrowdTier(targetVenue, allVenues, nowMs);
    if (targetCrowdTier === 'low' && !realUserActive) {
      replyChance *= 0.5;
    }
    if (Math.random() > replyChance) {
      console.log(`[Persona] @${persona.username} rolled below ${replyChance * 100}% chance for ${targetVenue.name}. Skipping.`);
      continue;
    }

    // ── d. Build Claude Haiku prompt ──────────────────────────────────────
    const last5Messages = await fetchLast5ChatMessages(targetVenue.id);
    const hourLabel = hour > 12 ? `${hour - 12}PM` : hour === 12 ? '12PM' : `${hour}AM`;
    const dayAndTime = `${weekday} at ${hourLabel}`;

    // Determine target venue tier
    let venueTier = simulatedVenueTiers[targetVenue.id] || null;
    const isHot = await hasRecentRealUserActivity(targetVenue.id, 180);
    if (isHot) {
      venueTier = 'deep';
    }

    // Resolve scenario, role, stance, location, and keywords for deep venues
    let scenario = null;
    let role = null;
    let stance = null;
    let location = 'at_venue';
    let scenarioKeywords = [];
    
    if (venueTier === 'deep') {
      scenario = assignedScenarios[targetVenue.id];
      if (!scenario) {
        // Dynamically assign scenario stably for hot-upgraded venue
        const hasPairRand = seededRandom(seedStr + '_' + targetVenue.id + '_acquaintance', 0);
        const hasPreExistingPair = hasPairRand < 0.25;
        
        let attempt = 0;
        while (attempt < 100) {
          const randVal = seededRandom(seedStr + '_' + targetVenue.id, attempt);
          const scenarioIndex = Math.floor(randVal * SCENARIOS.length);
          const candidate = SCENARIOS[scenarioIndex];
          if (STRANGER_OK_SCENARIOS.includes(candidate.type) || hasPreExistingPair) {
            scenario = candidate;
            break;
          }
          attempt++;
        }
        if (!scenario) {
          scenario = SCENARIOS.find(s => STRANGER_OK_SCENARIOS.includes(s.type));
        }
      }
      
      if (scenario) {
        scenarioKeywords = scenario.keywords || [];
        let roleAssignments = deepVenueRoleAssignments[targetVenue.id];
        if (!roleAssignments) {
          roleAssignments = assignPersonaRolesForScenario(allPersonas, scenario, seedStr, targetVenue.id);
        }
        if (roleAssignments && roleAssignments[persona.id]) {
          role = roleAssignments[persona.id].role;
          stance = roleAssignments[persona.id].stance;
          
          if (scenario.type === 'from_home' && role === 'homebody') {
            location = 'at_home';
          } else if (scenario.type === 'always_late' && role === 'latecomer') {
            location = 'en_route';
          }
        }
      }
    }

    let isStranger = true;
    let friendUsername = '';
    if (venueTier === 'deep' && scenario) {
      const hasPairRand = seededRandom(seedStr + '_' + targetVenue.id + '_acquaintance', 0);
      const hasPreExistingPair = hasPairRand < 0.25;
      if (hasPreExistingPair) {
        const shuffled = seededShuffle(allPersonas, seedStr + '_' + targetVenue.id);
        const pair = [shuffled[0].username, shuffled[1].username];
        if (pair.includes(persona.username)) {
          isStranger = false;
          friendUsername = pair[0] === persona.username ? pair[1] : pair[0];
        }
      }
    }

    // ── e. Generate message text ──────────────────────────────────────────
    let messageText = null;
    try {
      messageText = await generateMessage({
        variant: 'ambient',
        persona: persona,
        venueName: targetVenue.name,
        history: last5Messages,
        daypart: dayAndTime,
        tier: venueTier,
        crowdLevel: CROWD_LEVEL_BY_TIER[targetCrowdTier],
        role: role,
        stance: stance,
        location: location,
        scenarioKeywords: scenarioKeywords,
        apiKey: apiKey,
        isStranger,
        friendUsername
      });
      console.log(`[Persona] @${persona.username} → "${messageText}"`);
    } catch (err) {
      console.error(`[Persona] Haiku API error for @${persona.username}:`, err.message);
      continue;
    }

    if (!messageText || messageText.length === 0) continue;

    // ── f. Write message to RTDB with current timestamp ──────────────────
    const messageTimestamp = nowMs;

    try {
      const chatRef = rtdb.ref(`venue_chats/${targetVenue.id}`);
      const newMsgRef = chatRef.push();
      await newMsgRef.set({
        user_id: persona.id,
        username: persona.username,
        message: messageText,
        type: 'text',
        timestamp: messageTimestamp,
        isPersona: true, // internal flag — never exposed to frontend
        chainDepth: 0
      });
      console.log(`[Persona] ✓ Posted @${persona.username} to ${targetVenue.name}`);
      totalMessagesPosted++;
    } catch (err) {
      console.error(`[Persona] RTDB write failed for @${persona.username}:`, err.message);
      continue;
    }

    // ── g. Update cooldown in Firestore ──────────────────────────────────
    try {
      const newCount = currentCount + 1;
      await db.collection('persona_cooldowns').doc(cooldownId).set({
        personaId: persona.id,
        venueId: targetVenue.id,
        lastPostAt: nowMs,
        venueMessageCount: newCount,
        countWindowStart: currentCount === 0 ? nowMs : windowStart,
      });
    } catch (err) {
      console.warn(`[Persona] Cooldown write failed for ${cooldownId} (non-fatal):`, err.message);
    }

    // ── h. Push notification to engaged venue chat members ────────────────
    // Only notify users who interacted with this venue chat in the last hour.
    // This mimics a real user message arriving in a chat they're part of.
    try {
      const membersSnap = await rtdb.ref(`venue_members/${targetVenue.id}`).once('value');
      if (membersSnap.exists()) {
        const members = membersSnap.val();
        const oneHourMs = 60 * 60 * 1000;

        for (const [memberId, memberData] of Object.entries(members)) {
          // Skip non-human IDs
          if (memberId.startsWith('sim_') || memberId.startsWith('persona_')) continue;

          const isEngaged = memberData.lastInteractionTime && (nowMs - memberData.lastInteractionTime < oneHourMs);
          if (!isEngaged) continue;

          await sendRateLimitedPushNotification(
            memberId,
            targetVenue.name,
            `${persona.username}: ${messageText}`,
            { venueId: targetVenue.id, type: 'chat' },
            null,
            0,
            true // bypassLimits — engaged users get chat pings without throttle
          );
        }
      }
    } catch (err) {
      console.warn(`[Persona] Push notification dispatch failed for ${targetVenue.name} (non-fatal):`, err.message);
    }
  }

  console.log(`[Persona] Cycle complete. ${totalMessagesPosted} persona message(s) posted.`);
  return null;
});

// ─────────────────────────────────────────────────────────────────────────────
// 🤖 CLAUDE EVENT CURATOR SYSTEM
// Scheduled run on 1st of month at 9am Nairobi time, + callable manual curators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calls the Anthropic Claude Sonnet API with web search enabled and returns the response content.
 * @param {string} apiKey
 * @param {string} userPrompt
 * @return {Promise<string>}
 */
async function callClaudeSonnetWithSearch(apiKey, userPrompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-beta': 'web-search-2025-03-05',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
        },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude Sonnet API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  if (data && data.content) {
    const textBlock = data.content.find((block) => block.type === 'text');
    if (textBlock && textBlock.text) {
      return textBlock.text.trim();
    }
  }
  throw new Error(`Unexpected Claude Sonnet response: ${JSON.stringify(data)}`);
}

/**
 * Extracts a JSON array from the response string.
 * @param {string} text
 * @return {Array|null}
 */
function extractJSONArray(text) {
  try {
    return JSON.parse(text.trim());
  } catch (err) {
    const match = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e) {
        console.error('[Curator] Failed to parse regex-extracted JSON array:', e);
      }
    }
    return null;
  }
}

/**
 * Determines whether a date in format DD/MM/YYYY is before today (Nairobi timezone).
 * @param {string} dateStr
 * @return {boolean}
 */
function isPastEvent(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return true;
  const parts = dateStr.split('/');
  if (parts.length !== 3) return true;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const year = parseInt(parts[2], 10);

  if (isNaN(day) || isNaN(month) || isNaN(year)) return true;

  // Event date constructed in EAT (UTC+3)
  const eventDate = new Date(Date.UTC(year, month, day, 0, 0, 0) - (3 * 60 * 60 * 1000));

  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  const nairobiParts = formatter.formatToParts(now);
  const nMap = {};
  nairobiParts.forEach((p) => {
    nMap[p.type] = p.value;
  });
  const todayStart = new Date(Date.UTC(
      parseInt(nMap.year, 10),
      parseInt(nMap.month, 10) - 1,
      parseInt(nMap.day, 10),
      0, 0, 0,
  ) - (3 * 60 * 60 * 1000));

  return eventDate.getTime() < todayStart.getTime();
}

/**
 * Converts date string (DD/MM/YYYY) and time string (HH:MM or equivalent) into EAT timestamps.
 * @param {string} dateStr
 * @param {string} timeStr
 * @return {{ startDate: number, expirationDate: number }}
 */
function parseDateTime(dateStr, timeStr) {
  if (!dateStr) {
    throw new Error('Date string is required.');
  }
  const parts = dateStr.split('/');
  if (parts.length !== 3) {
    throw new Error(`Invalid date format: ${dateStr}`);
  }
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const year = parseInt(parts[2], 10);

  let hour = 18;
  let minute = 0;

  if (timeStr) {
    const timeMatch = timeStr.match(/(\d+):(\d+)\s*(pm|am)?/i);
    if (timeMatch) {
      hour = parseInt(timeMatch[1], 10);
      minute = parseInt(timeMatch[2], 10);
      const ampm = timeMatch[3];
      if (ampm) {
        if (ampm.toLowerCase() === 'pm' && hour < 12) hour += 12;
        if (ampm.toLowerCase() === 'am' && hour === 12) hour = 0;
      }
    }
  }

  const pad = (n) => String(n).padStart(2, '0');
  const isoString = `${year}-${pad(month + 1)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+03:00`;
  const startDate = new Date(isoString).getTime();
  const expirationDate = startDate + (6 * 60 * 60 * 1000); // 6 hours duration fallback

  return { startDate, expirationDate };
}

/**
 * Researches events using Claude Sonnet with web search, checks duplicates, saves.
 * @param {string|null} apiKeyInput
 * @return {Promise<{ success: boolean, count: number }>}
 */
async function curateNairobiEvents(apiKeyInput = null) {
  let apiKey = apiKeyInput;
  if (!apiKey) {
    const settingsSnap = await db.collection('settings').doc('simulation').get();
    if (settingsSnap.exists) {
      apiKey = settingsSnap.data().anthropicApiKey;
    }
  }

  if (!apiKey) {
    throw new Error('Anthropic API key is not configured in settings/simulation.');
  }

  const now = new Date();
  const options = { timeZone: 'Africa/Nairobi' };
  const currentMonth = new Intl.DateTimeFormat('en-GB', { ...options, month: 'long' }).format(now);
  const currentYear = new Intl.DateTimeFormat('en-GB', { ...options, year: 'numeric' }).format(now);
  const currentDate = new Intl.DateTimeFormat('en-GB', { ...options, day: 'numeric', month: 'long', year: 'numeric' }).format(now);

  const prompt = `Today is ${currentDate}. You are an event research assistant for Eventas, a Nairobi nightlife and events app. You MUST use Google Maps to verify coordinates and ensure accurate event location definition. Search the web thoroughly for upcoming events happening in Nairobi, Kenya this month (${currentMonth} ${currentYear}). Search for: club nights, concerts, live music, art exhibitions, food festivals, pop-up markets, comedy nights, rooftop events, and outdoor festivals. Rules: only include events that have not happened yet as of today's date — strictly no past events. Only include events with a confirmed date, venue, and location in Nairobi. Ignore vague or unconfirmed events. You MUST provide a valid, verifiable sourceLink URL for every single event to ensure accuracy. If an event does not have a verifiable source URL, do not include it. sourceLink must NEVER be null. For each event return a JSON object with these exact fields: name, venue, date (DD/MM/YYYY), time, category (one of: Club / Bar / Activity / Event), description (2 sentences max, written in a fun engaging tone for a young Nairobi audience), ticketLink (URL or null if not found), sourceLink (valid URL, NEVER null). Return ONLY a valid JSON array of event objects, no markdown, no explanation, no preamble.`;

  console.log(`[Curator] Starting Claude Curator run for ${currentMonth} ${currentYear}.`);
  const rawResponse = await callClaudeSonnetWithSearch(apiKey, prompt);

  const jsonArray = extractJSONArray(rawResponse);
  if (!jsonArray || !Array.isArray(jsonArray)) {
    throw new Error(`Failed to parse valid JSON array from Claude response: ${rawResponse}`);
  }

  console.log(`[Curator] Claude returned ${jsonArray.length} raw events.`);

  let newEventsCount = 0;
  for (const event of jsonArray) {
    if (!event.date || isPastEvent(event.date)) {
      console.log(`[Curator] Discarding past or invalid event: ${event.name} (${event.date})`);
      continue;
    }

    // Duplicate Check: name + date + venue in pendingEvents
    const pendingSnap = await db.collection('pendingEvents')
      .where('name', '==', event.name || '')
      .where('date', '==', event.date || '')
      .where('venue', '==', event.venue || '')
      .get();

    if (!pendingSnap.empty) {
      console.log(`[Curator] Duplicate event in pendingEvents: ${event.name}`);
      continue;
    }

    // Duplicate Check in live venues
    let isLiveDuplicate = false;
    let startDate = null;
    let expirationDate = null;
    try {
      const parsed = parseDateTime(event.date, event.time || '18:00');
      startDate = parsed.startDate;
      expirationDate = parsed.expirationDate;

      const liveSnap = await db.collection('venues')
        .where('type', '==', 'Event')
        .where('name', '==', event.name || '')
        .where('startDate', '==', startDate)
        .get();

      if (!liveSnap.empty) {
        console.log(`[Curator] Duplicate event in live venues: ${event.name}`);
        isLiveDuplicate = true;
      }
    } catch (e) {
      console.warn(`[Curator] Error parsing event date for duplicate check:`, e.message);
    }

    if (isLiveDuplicate) continue;

    await db.collection('pendingEvents').add({
      name: event.name || '',
      venue: event.venue || '',
      date: event.date || '',
      time: event.time || '',
      category: event.category || 'Event',
      description: event.description || '',
      ticketLink: event.ticketLink || null,
      sourceLink: event.sourceLink || null,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      curatedBy: 'claude',
      startDate: startDate,
      expirationDate: expirationDate,
    });

    newEventsCount++;
  }

  console.log(`[Curator] Curator run finished. Added ${newEventsCount} new events.`);

  if (newEventsCount > 0) {
    try {
      const usersSnap = await db.collection('users').where('isAdmin', '==', true).get();
      const adminTokens = [];
      usersSnap.forEach((docSnap) => {
        const uData = docSnap.data();
        if (uData.expoPushToken) {
          adminTokens.push({ token: uData.expoPushToken, userId: docSnap.id });
        }
      });

      for (const adminUser of adminTokens) {
        await sendPushNotification(
            adminUser.token,
            'Event Curator',
            `Claude found ${newEventsCount} new events for ${currentMonth} — review them in the dashboard.`,
            { type: 'admin_curator' },
        );
      }
    } catch (err) {
      console.warn(`[Curator] Failed to send admin push notification (non-fatal):`, err.message);
    }
  }

  return { success: true, count: newEventsCount };
}

// Automatic monthly run to find events is disabled. Curator and cleanup runs are triggered manually by ADMIN via the Admin Dashboard.
// exports.curateEventsWithClaudeScheduled = functions.pubsub
//   .schedule('0 9 1 * *')
//   .timeZone('Africa/Nairobi')
//   .onRun(async (context) => {
//     try {
//       await curateNairobiEvents();
//     } catch (err) {
//       console.error('[Curator] Scheduled curate failed:', err);
//     }
//     return null;
//   });

exports.curateEventsWithClaudeCallable = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }

  const callerSnap = await db.collection('users').doc(context.auth.uid).get();
  if (!callerSnap.exists || callerSnap.data().isAdmin !== true) {
    throw new functions.https.HttpsError('permission-denied', 'Only administrators can run the event curator.');
  }

  try {
    const result = await curateNairobiEvents();
    return result;
  } catch (err) {
    throw new functions.https.HttpsError('internal', err.message);
  }
});

exports.runEventCleanup = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }

  const callerSnap = await db.collection('users').doc(context.auth.uid).get();
  if (!callerSnap.exists || callerSnap.data().isAdmin !== true) {
    throw new functions.https.HttpsError('permission-denied', 'Only administrators can run the event cleanup job.');
  }

  let apiKey = null;
  const settingsSnap = await db.collection('settings').doc('simulation').get();
  if (settingsSnap.exists) {
    apiKey = settingsSnap.data().anthropicApiKey;
  }

  if (!apiKey) {
    throw new functions.https.HttpsError('failed-precondition', 'Anthropic API key is not configured in settings/simulation.');
  }

  const liveEventsSnap = await db.collection('venues')
    .where('type', '==', 'Event')
    .get();

  const existingEvents = [];
  liveEventsSnap.forEach((docSnap) => {
    const vData = docSnap.data();
    let EATDateStr = '';
    let EATTimeStr = '';
    if (vData.startDate) {
      try {
        const d = new Date(vData.startDate);
        const options = { timeZone: 'Africa/Nairobi' };
        const dayStr = new Intl.DateTimeFormat('en-GB', { ...options, day: '2-digit' }).format(d);
        const monthStr = new Intl.DateTimeFormat('en-GB', { ...options, month: '2-digit' }).format(d);
        const yearStr = new Intl.DateTimeFormat('en-GB', { ...options, year: 'numeric' }).format(d);
        EATDateStr = `${dayStr}/${monthStr}/${yearStr}`;

        const hourStr = new Intl.DateTimeFormat('en-GB', { ...options, hour: '2-digit', hour12: false }).format(d);
        const minStr = new Intl.DateTimeFormat('en-GB', { ...options, minute: '2-digit' }).format(d);
        EATTimeStr = `${hourStr}:${minStr}`;
      } catch (e) {
        console.warn(`[Cleanup] Date conversion error for ${docSnap.id}:`, e.message);
      }
    }

    existingEvents.push({
      id: docSnap.id,
      name: vData.name || '',
      description: vData.description || '',
      venue: vData.address || '',
      date: EATDateStr,
      time: EATTimeStr,
      category: vData.category || 'Other',
      ticketLink: vData.ticketLink || null,
      sourceLink: vData.sourceLink || null,
    });
  });

  if (existingEvents.length === 0) {
    return { success: true, count: 0, message: 'No live events found to clean up.' };
  }

  const now = new Date();
  const options = { timeZone: 'Africa/Nairobi' };
  const currentDate = new Intl.DateTimeFormat('en-GB', { ...options, day: 'numeric', month: 'long', year: 'numeric' }).format(now);

  const existingEventsJSON = JSON.stringify(existingEvents, null, 2);

  const prompt = `Today is ${currentDate}. Below is a list of events currently live on Eventas, a Nairobi nightlife app. Your job is to clean this list. You MUST use Google Maps to verify the coordinates and event location definition of these events, and verify their dates using reliable web sources.

CRITICAL SEARCH EFFICIENCY RULE: Do NOT perform individual search queries for every single event. Instead, batch your searches by category or grouping (e.g., search for "upcoming Nairobi concerts this month", "Nairobi club nights June 2026", "Nairobi art events 2026", etc.) and cross-reference multiple events per search. You should target verifying all events in a total of 5–8 batched searches maximum to keep API search costs low.

For each event: mark it as REMOVE if the date has already passed as of today, mark it as REMOVE if the event details are vague, incomplete, or unverifiable, mark it as KEEP if it is a valid upcoming event with a confirmed date and venue, mark it as NEEDS EDIT if the event is upcoming but has incomplete or poorly written details — and provide a corrected version. Return ONLY a valid JSON array where each object has: originalId (the Firestore document ID), action (KEEP / REMOVE / NEEDS EDIT), and updatedEvent (null if KEEP or REMOVE, or the full corrected event object if NEEDS EDIT). The corrected event object inside updatedEvent must have category as one of: Club / Bar / Activity / Event, and a valid, non-null sourceLink. Here are the current events: ${existingEventsJSON}`;

  console.log(`[Cleanup] Triggering Claude cleanup with prompt for ${existingEvents.length} events.`);
  const rawResponse = await callClaudeSonnetWithSearch(apiKey, prompt);

  const jsonArray = extractJSONArray(rawResponse);
  if (!jsonArray || !Array.isArray(jsonArray)) {
    throw new functions.https.HttpsError('internal', `Failed to parse valid JSON array from Claude response: ${rawResponse}`);
  }

  console.log(`[Cleanup] Claude returned ${jsonArray.length} items.`);

  const existingCleanupsSnap = await db.collection('pendingEvents')
    .where('curatedBy', '==', 'claude_cleanup')
    .where('status', '==', 'pending')
    .get();

  const batch = db.batch();
  existingCleanupsSnap.forEach((docSnap) => {
    batch.delete(docSnap.ref);
  });
  await batch.commit();
  console.log(`[Cleanup] Cleared ${existingCleanupsSnap.size} existing pending cleanup docs.`);

  let countAdded = 0;
  for (const item of jsonArray) {
    const origEvent = existingEvents.find((e) => e.id === item.originalId);
    if (!origEvent) continue;

    const displayEvent = item.action === 'NEEDS EDIT' && item.updatedEvent ? item.updatedEvent : origEvent;

    let startDate = null;
    let expirationDate = null;
    try {
      const parsed = parseDateTime(displayEvent.date || origEvent.date, displayEvent.time || origEvent.time || '18:00');
      startDate = parsed.startDate;
      expirationDate = parsed.expirationDate;
    } catch (e) {
      console.warn(`[Cleanup] Error pre-calculating timestamps for cleanup event ${displayEvent.name}:`, e.message);
    }

    await db.collection('pendingEvents').add({
      name: displayEvent.name || origEvent.name || '',
      venue: displayEvent.venue || origEvent.venue || '',
      date: displayEvent.date || origEvent.date || '',
      time: displayEvent.time || origEvent.time || '',
      category: displayEvent.category || origEvent.category || 'Event',
      description: displayEvent.description || origEvent.description || '',
      ticketLink: displayEvent.ticketLink || origEvent.ticketLink || null,
      sourceLink: displayEvent.sourceLink || origEvent.sourceLink || null,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      curatedBy: 'claude_cleanup',
      originalId: item.originalId,
      action: item.action || 'KEEP',
      updatedEvent: item.updatedEvent || null,
      startDate: startDate,
      expirationDate: expirationDate,
    });
    countAdded++;
  }

  console.log(`[Cleanup] Saved ${countAdded} cleanup recommendations.`);
  return { success: true, count: countAdded };
});


