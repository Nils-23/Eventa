const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

// Initialize Firebase Admin
if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
  });
}

const db = admin.firestore();
const rtdb = admin.database();

const MAX_RADIUS_METERS = 200; // Roam within 200m
const UPDATE_INTERVAL_MS = 15000; // Update every 15 seconds

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

  const isNightlifePeak = (day, hr) => {
    if (hr >= 21) {
      return ['Fri', 'Sat', 'Sun'].includes(day);
    } else if (hr < 4) {
      return ['Sat', 'Sun', 'Mon'].includes(day);
    }
    return false;
  };

  // Determine baseCapacity depending on category and time-window
  let baseCapacity = 50;
  if (venue.type === 'Club' || venue.type === 'Bar') {
    if (isNightlifePeak(weekday, hour)) {
      baseCapacity = venue.type === 'Club' ? 100 : 50;
    } else if (hour >= 21 || hour < 4) {
      baseCapacity = venue.type === 'Club' ? 60 : 30;
    } else {
      baseCapacity = venue.type === 'Club' ? 10 : 5;
    }
  } else if (venue.type === 'Activity') {
    if (hour >= 19 || hour < 6) {
      baseCapacity = 5;
    } else {
      const isWeekend = ['Sat', 'Sun'].includes(weekday);
      baseCapacity = isWeekend ? 75 : 45;
    }
  } else if (venue.type === 'Event') {
    const nowMs = Date.now();
    const isOngoing = venue.startDate && venue.expirationDate && (nowMs >= venue.startDate && nowMs <= venue.expirationDate);
    if (isOngoing) {
      baseCapacity = (hour >= 9 && hour < 22) ? 150 : 20;
    } else {
      baseCapacity = 0;
    }
  }

  if (!allVenues || allVenues.length === 0) {
    const defaultCap = getDefaultCapacity(venue.type);
    const maxCapacity = Math.min(defaultCap, venue.maxCapacity !== undefined ? venue.maxCapacity : defaultCap);
    return Math.max(0, Math.min(baseCapacity, maxCapacity));
  }

  // Sort all venues globally by their simPopularityScore to find this venue's rank
  const sortedVenues = [...allVenues].sort((a, b) => {
    const scoreA = a.simPopularityScore !== undefined ? a.simPopularityScore : 0.5;
    const scoreB = b.simPopularityScore !== undefined ? b.simPopularityScore : 0.5;
    return scoreA - scoreB;
  });

  const venueIndex = sortedVenues.findIndex(v => v.id === venue.id);
  const totalVenues = sortedVenues.length;
  const rank = totalVenues > 1 ? venueIndex / (totalVenues - 1) : 1.0;

  // Determine tierFactor based on rank
  let tierFactor = 0.0;
  if (rank >= 0.85) {
    // Hotspot (Top 15%): 0.75 to 0.95
    tierFactor = 0.75 + Math.random() * 0.20;
  } else if (rank >= 0.60) {
    // Popular (Next 25%): 0.40 to 0.65
    tierFactor = 0.40 + Math.random() * 0.25;
  } else if (rank >= 0.20) {
    // Average (Next 40%): 0.15 to 0.35
    tierFactor = 0.15 + Math.random() * 0.20;
  } else {
    // Quiet (Bottom 20%): 0.00 to 0.10
    tierFactor = 0.00 + Math.random() * 0.10;
  }

  // Calculate base target
  let count = baseCapacity * tierFactor;

  const defaultCap = getDefaultCapacity(venue.type);
  const maxCapacity = Math.min(defaultCap, venue.maxCapacity !== undefined ? venue.maxCapacity : defaultCap);
  count = Math.min(count, maxCapacity);

  return Math.max(0, count);
}

const MY_SIMULATOR_ID = `sim_server_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
let isSimulationEnabled = false;
let hasLease = false;
let simulatedUsers = [];
let activeVenues = [];
let lastRecalculateTime = 0;
let venueSimStates = {};

let serverTimeOffset = 0;
rtdb.ref('.info/serverTimeOffset').on('value', (snap) => {
  serverTimeOffset = snap.val() || 0;
});
const getServerTime = () => Date.now() + serverTimeOffset;

function getTargetForVenue(venue, currentCount, realUserCount, allVenues) {
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

  const isNightlifePeak = (day, hr) => {
    if (hr >= 21) {
      return ['Fri', 'Sat', 'Sun'].includes(day);
    } else if (hr < 4) {
      return ['Sat', 'Sun', 'Mon'].includes(day);
    }
    return false;
  };

  const isOverride = venue.isOverride === true;
  const baseTarget = getDynamicTargetCount(venue, allVenues);
  
  // Apply dynamic noise: ±15% independent random fluctuation
  const dynamicNoise = 0.85 + Math.random() * 0.30;
  
  // Apply venueIdentityFactor
  const identityFactor = venue.venueIdentityFactor !== undefined ? venue.venueIdentityFactor : 1.0;
  
  let variableTarget = baseTarget * dynamicNoise * identityFactor;

  if (!isOverride) {
    if (venue.type === 'Activity' && (hour >= 19 || hour < 6)) {
      variableTarget = Math.min(variableTarget, 5);
    }
    if ((venue.type === 'Club' || venue.type === 'Bar') && isNightlifePeak(weekday, hour)) {
      variableTarget = Math.max(variableTarget, 20);
    }
  }

  const defaultCap = getDefaultCapacity(venue.type);
  const maxCapacity = Math.min(defaultCap, venue.maxCapacity !== undefined ? venue.maxCapacity : defaultCap);
  const finalTarget = Math.max(0, Math.min(variableTarget, maxCapacity));

  // Subtract real user counts from target count to prioritize real user activity
  const rawTargetCount = currentCount * 0.7 + finalTarget * 0.3;
  let targetCount = Math.max(0, Math.round(rawTargetCount) - realUserCount);
  if (venue.startDate && Date.now() < venue.startDate) {
    targetCount = 0;
  }
  return targetCount;
}

async function syncAllVenueUsers(isTick = false) {
  if (!isSimulationEnabled || !hasLease) {
    return;
  }
  // Fetch presence once to discount real users
  let allPresence = {};
  try {
    const presenceSnap = await rtdb.ref('venue_presence').once('value');
    if (presenceSnap.exists()) {
      allPresence = presenceSnap.val();
    }
  } catch (err) {
    console.error('Failed to fetch presence:', err);
  }

  const nowMs = Date.now();
  const shouldRecalculate = lastRecalculateTime === 0 || (nowMs - lastRecalculateTime >= 5 * 60 * 1000);

  if (shouldRecalculate && isTick) {
    lastRecalculateTime = nowMs;
  }

  const updates = {};
  let needsUpdate = false;
  const venueContexts = {};
  const proposedCounts = {};

  activeVenues.forEach(venue => {
    const isOverride = venue.isOverride === true;
    
    // Drift & Initialize popularity scores and identity factor
    if (!isOverride && isTick) {
      const updateObj = {};
      let needsDbUpdate = false;

      if (venue.simPopularityScore === undefined) {
        venue.simPopularityScore = Math.random();
        updateObj.simPopularityScore = venue.simPopularityScore;
        needsDbUpdate = true;
      } else if (Math.random() < 0.01) {
        const currentScore = venue.simPopularityScore;
        const drift = (Math.random() - 0.5) * 0.1;
        venue.simPopularityScore = Math.max(0.0, Math.min(1.0, currentScore + drift));
        updateObj.simPopularityScore = venue.simPopularityScore;
        needsDbUpdate = true;
      }

      if (venue.venueIdentityFactor === undefined) {
        venue.venueIdentityFactor = 0.90 + Math.random() * 0.20; // 0.90 to 1.10
        updateObj.venueIdentityFactor = venue.venueIdentityFactor;
        needsDbUpdate = true;
      }

      if (needsDbUpdate) {
        db.collection('venues').doc(venue.id).update(updateObj)
          .catch(err => console.error(`Failed to update stats for ${venue.name}:`, err));
      }
    }

    // Count real users present
    const presenceObj = allPresence[venue.id] || {};
    const fifteenMinAgo = Date.now() - 15 * 60 * 1000;
    let realUserCount = 0;
    for (const uid in presenceObj) {
      if (!uid.startsWith('sim_') && presenceObj[uid] > fifteenMinAgo) {
        realUserCount++;
      }
    }

    const currentUsers = simulatedUsers.filter(u => u.venueId === venue.id);
    let currentCount = currentUsers.length;

    const defaultCap = getDefaultCapacity(venue.type);
    const maxCapacity = Math.min(defaultCap, venue.maxCapacity !== undefined ? venue.maxCapacity : defaultCap);

    // Instantly prune any excess simulated users exceeding the absolute simulated cap
    if (currentCount > maxCapacity) {
      const excessCount = currentCount - maxCapacity;
      const toPrune = currentUsers.slice(0, excessCount).map(u => u.user_id);
      simulatedUsers = simulatedUsers.filter(u => !toPrune.includes(u.user_id));
      toPrune.forEach(uid => {
        updates[uid] = null;
      });
      needsUpdate = true;
      currentCount = maxCapacity;
    }

    let state = venueSimStates[venue.id];
    const hasConfigChanged = !state ||
      state.isOverride !== venue.isOverride ||
      state.simulatedUsersCount !== venue.simulatedUsersCount ||
      state.maxCapacity !== maxCapacity ||
      state.startDate !== venue.startDate ||
      state.expirationDate !== venue.expirationDate;

    let targetCount = currentCount;
    let shouldRecalcVenue = shouldRecalculate || hasConfigChanged;

    if (shouldRecalcVenue) {
      targetCount = getTargetForVenue(venue, currentCount, realUserCount, activeVenues);
    } else if (state) {
      targetCount = state.ultimateTarget;
    }

    let diff = targetCount - currentCount;

    // Enforce maximum change of 10 users per 5-minute interval
    const MAX_CHANGE_PER_INTERVAL = 10;
    if (diff > MAX_CHANGE_PER_INTERVAL) {
      diff = MAX_CHANGE_PER_INTERVAL;
    } else if (diff < -MAX_CHANGE_PER_INTERVAL) {
      diff = -MAX_CHANGE_PER_INTERVAL;
    }

    const cappedTargetCount = currentCount + diff;
    proposedCounts[venue.id] = cappedTargetCount;

    venueContexts[venue.id] = {
      realUserCount,
      currentCount,
      maxCapacity,
      currentUsers,
      shouldRecalcVenue,
      hasConfigChanged,
      state
    };
  });

  // Collision Safeguard Step
  const venueTypes = ['CLUB', 'BAR', 'ACTIVITY', 'EVENT'];
  for (const vType of venueTypes) {
    const typeVenues = activeVenues.filter(v => (v.type || 'Club').toUpperCase() === vType);
    
    // Find proposed counts in this category
    const counts = typeVenues.map(v => proposedCounts[v.id]).filter(c => c !== undefined);
    
    // Check if a collision group (3 or more venues with values within 1 user of each other) exists
    let hasCollision = false;
    for (let i = 0; i < counts.length; i++) {
      let matchCount = 0;
      for (let j = 0; j < counts.length; j++) {
        if (Math.abs(counts[i] - counts[j]) <= 1) {
          matchCount++;
        }
      }
      if (matchCount >= 3) {
        hasCollision = true;
        break;
      }
    }

    // Apply shuffled-adjustments collision resolver to ensure uniqueness and diversity within same category
    if (hasCollision) {
      const assignedCounts = new Set();
      
      // Shuffle venues to avoid systematic bias in adjustments
      const shuffledVenues = [...typeVenues].sort(() => Math.random() - 0.5);
      
      shuffledVenues.forEach(venue => {
        let count = proposedCounts[venue.id];
        if (count === undefined) return;
        
        const cap = venueContexts[venue.id].maxCapacity;
        
        if (assignedCounts.has(count)) {
          // Generate and shuffle candidate adjustments to scramble the resolved values
          const adjustments = [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6, -7, 7, -8, 8, -9, 9, -10, 10];
          const shuffledAdjustments = adjustments.sort(() => Math.random() - 0.5);
          
          for (const adj of shuffledAdjustments) {
            let nextVal = count + adj;
            nextVal = Math.max(0, Math.min(cap, nextVal));
            if (!assignedCounts.has(nextVal)) {
              count = nextVal;
              break;
            }
          }
        }
        
        proposedCounts[venue.id] = count;
        assignedCounts.add(count);
      });
    }
  }

  activeVenues.forEach(venue => {
    const ctx = venueContexts[venue.id];
    let state = ctx.state;
    
    const finalCappedTargetCount = proposedCounts[venue.id];
    
    if (ctx.shouldRecalcVenue) {
      let diff = finalCappedTargetCount - ctx.currentCount;
      
      const steps = 5;
      const changeQueue = [];
      let remaining = diff;
      for (let i = 0; i < steps; i++) {
        const stepChange = Math.round(remaining / (steps - i));
        changeQueue.push(stepChange);
        remaining -= stepChange;
      }

      state = {
        ultimateTarget: finalCappedTargetCount,
        changeQueue,
        currentCount: ctx.currentCount,
        isOverride: venue.isOverride,
        simulatedUsersCount: venue.simulatedUsersCount,
        maxCapacity: ctx.maxCapacity,
        startDate: venue.startDate,
        expirationDate: venue.expirationDate
      };
      venueSimStates[venue.id] = state;
    }

    const stepChange = (isTick && state.changeQueue.length > 0) ? state.changeQueue.shift() : 0;

    if (stepChange > 0) {
      for (let i = 0; i < stepChange; i++) {
        const loc = offsetLocation(venue.latitude, venue.longitude, MAX_RADIUS_METERS / 2);
        const newUser = {
          user_id: `sim_${venue.id}_${Date.now()}_${i}_${Math.floor(Math.random() * 100000)}`,
          venueId: venue.id,
          centerLat: venue.latitude,
          centerLon: venue.longitude,
          latitude: loc.latitude,
          longitude: loc.longitude,
          timestamp: getServerTime()
        };
        simulatedUsers.push(newUser);
        updates[newUser.user_id] = {
          latitude: newUser.latitude,
          longitude: newUser.longitude,
          timestamp: newUser.timestamp,
          user_id: newUser.user_id,
          venueId: newUser.venueId
        };
        needsUpdate = true;
      }
      console.log(`[+] Spawned ${stepChange} new users for venue ${venue.name}. Step Target: ${ctx.currentCount + stepChange}`);
    } else if (stepChange < 0) {
      const toRemove = Math.abs(stepChange);
      const despawnList = ctx.currentUsers.slice(0, toRemove).map(u => u.user_id);
      simulatedUsers = simulatedUsers.filter(u => !despawnList.includes(u.user_id));
      despawnList.forEach(uid => {
        updates[uid] = null;
      });
      needsUpdate = true;
      console.log(`[-] Despawned ${toRemove} users from venue ${venue.name}. Step Target: ${ctx.currentCount - toRemove}`);
    }
  });

  if (needsUpdate) {
    try {
      await rtdb.ref('simulated_locations').update(updates);
    } catch (err) {
      console.error('Failed to update RTDB:', err);
    }
  }
}

async function startSimulation() {
  console.log(`Starting dynamic simulation server... (ID: ${MY_SIMULATOR_ID})`);
  
  // Subscribe to the global Firestore simulation configuration
  db.collection('settings').doc('simulation').onSnapshot(async (docSnap) => {
    const data = docSnap.exists ? docSnap.data() : null;
    const enabled = data ? !!data.enabled : false;
    
    console.log(`[Firestore Settings] Simulation enabled status changed to: ${enabled}`);
    
    if (enabled !== isSimulationEnabled) {
      isSimulationEnabled = enabled;
      if (!isSimulationEnabled) {
        console.log('Simulation disabled globally. Cleaning up simulated locations...');
        // Clean up simulated locations and release lease if we held it
        if (hasLease) {
          try {
            await rtdb.ref('simulated_locations').set(null);
            const statusSnap = await rtdb.ref('simulation_status').once('value');
            if (statusSnap.exists() && statusSnap.val().activeSimulatorId === MY_SIMULATOR_ID) {
              await rtdb.ref('simulation_status').set(null);
              console.log('Simulation lease released.');
            }
          } catch (err) {
            console.error('Error during cleanup:', err);
          }
          hasLease = false;
        }
        simulatedUsers = [];
        lastRecalculateTime = 0;
        venueSimStates = {};
      } else {
        console.log('Simulation enabled globally. Running lease checks...');
      }
    }
  }, err => {
    console.error('Error listening to simulation settings:', err);
  });

  // Listen to changes in venues dynamically
  db.collection('venues').onSnapshot(async (snapshot) => {
    activeVenues = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    if (isSimulationEnabled && hasLease) {
      await syncAllVenueUsers(false);
    }
  });

  const tick = async () => {
    if (!isSimulationEnabled) {
      return;
    }

    // 1. Leader election check
    let activeId = null;
    let lastHeartbeat = 0;
    try {
      const statusSnap = await rtdb.ref('simulation_status').once('value');
      if (statusSnap.exists()) {
        const val = statusSnap.val();
        activeId = val.activeSimulatorId;
        lastHeartbeat = val.lastHeartbeat || 0;
      }
    } catch (err) {
      console.error('[Leader Election] Failed to read simulation status:', err);
    }

    const nowMs = getServerTime();
    const isLeaseActive = activeId && (nowMs - lastHeartbeat < 30000);

    if (isLeaseActive && activeId !== MY_SIMULATOR_ID) {
      console.log(`[Leader Election] Standing by. Active simulator is ${activeId}`);
      if (hasLease) {
        hasLease = false;
        simulatedUsers = [];
        lastRecalculateTime = 0;
        venueSimStates = {};
      }
      return;
    }

    // Claim/Renew lease
    try {
      await rtdb.ref('simulation_status').set({
        activeSimulatorId: MY_SIMULATOR_ID,
        lastHeartbeat: nowMs
      });
      hasLease = true;
    } catch (err) {
      console.error('[Leader Election] Failed to claim simulation lease:', err);
      return;
    }

    // Fetch existing simulations on first startup/takeover if local array is empty
    if (simulatedUsers.length === 0) {
      try {
        const snap = await rtdb.ref('simulated_locations').once('value');
        if (snap.exists()) {
          const existingSims = Object.values(snap.val());
          simulatedUsers = existingSims.filter(s => s && s.user_id && s.venueId);
          console.log(`[Leader Election] Takeover active. Restored ${simulatedUsers.length} simulated users.`);
        }
      } catch (err) {
        console.error('Error fetching existing simulations on lease acquisition:', err);
      }
    }

    await syncAllVenueUsers(true);

    if (simulatedUsers.length === 0) return;
    
    const locationsRef = rtdb.ref('simulated_locations');
    const updates = {};
    const tickTime = getServerTime();

    simulatedUsers.forEach(u => {
      const nextLoc = moveLocation(u.latitude, u.longitude, u.centerLat, u.centerLon, 15);
      u.latitude = nextLoc.latitude;
      u.longitude = nextLoc.longitude;
      u.timestamp = tickTime;

      updates[u.user_id] = {
        latitude: u.latitude,
        longitude: u.longitude,
        timestamp: u.timestamp,
        user_id: u.user_id,
        venueId: u.venueId
      };
    });

    try {
      await locationsRef.update(updates);
      console.log(`[${new Date().toISOString()}] Updated ${simulatedUsers.length} simulated locations.`);
    } catch (err) {
      console.error('Failed to update RTDB simulated locations:', err);
    }
  };

  setInterval(tick, UPDATE_INTERVAL_MS);

  // Clear lease on exit
  const handleExit = async () => {
    console.log('\nShutting down server simulator...');
    if (hasLease) {
      try {
        const statusSnap = await rtdb.ref('simulation_status').once('value');
        if (statusSnap.exists() && statusSnap.val().activeSimulatorId === MY_SIMULATOR_ID) {
          await rtdb.ref('simulation_status').set(null);
          console.log('Lease cleared successfully.');
        }
      } catch (err) {
        console.error('Failed to clear lease on exit:', err);
      }
    }
    process.exit(0);
  };

  process.on('SIGINT', handleExit);
  process.on('SIGTERM', handleExit);
}

startSimulation().catch(console.error);
