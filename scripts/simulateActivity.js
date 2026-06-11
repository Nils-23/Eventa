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
  const variation = (Math.random() * 0.3 - 0.15);
  let variableTarget = Math.round(baseTarget * (1 + variation));

  if (!isOverride) {
    if (venue.type === 'Activity' && (hour >= 19 || hour < 6)) {
      variableTarget = Math.min(variableTarget, 5);
    }
    if ((venue.type === 'Club' || venue.type === 'Bar') && isNightlifePeak(weekday, hour)) {
      variableTarget = Math.max(variableTarget, 20);
    }
  }

  const maxCapacity = venue.maxCapacity !== undefined ? venue.maxCapacity : getDefaultCapacity(venue.type);
  const finalTarget = Math.max(0, Math.min(variableTarget, maxCapacity));

  // Subtract real user counts from target count to prioritize real user activity
  const rawTargetCount = Math.round(currentCount * 0.7 + finalTarget * 0.3);
  let targetCount = Math.max(0, rawTargetCount - realUserCount);
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

  activeVenues.forEach(venue => {
    const isOverride = venue.isOverride === true;
    // Drift & Initialize popularity scores
    if (!isOverride && isTick) {
      if (venue.simPopularityScore === undefined) {
        const initialScore = Math.random();
        db.collection('venues').doc(venue.id).update({
          simPopularityScore: initialScore
        }).catch(err => console.error(`Failed to initialize score for ${venue.name}:`, err));
      } else if (Math.random() < 0.01) {
        const currentScore = venue.simPopularityScore;
        const drift = (Math.random() - 0.5) * 0.1;
        const newScore = Math.max(0.0, Math.min(1.0, currentScore + drift));
        db.collection('venues').doc(venue.id).update({
          simPopularityScore: newScore
        }).catch(err => console.error(`Failed to drift score for ${venue.name}:`, err));
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
    const currentCount = currentUsers.length;

    let state = venueSimStates[venue.id];
    const targetCount = getTargetForVenue(venue, currentCount, realUserCount, activeVenues);

    if (shouldRecalculate || !state || state.ultimateTarget !== targetCount) {
      const diff = targetCount - currentCount;
      const steps = 5;
      const changeQueue = [];
      let remaining = diff;
      for (let i = 0; i < steps; i++) {
        const stepChange = Math.round(remaining / (steps - i));
        changeQueue.push(stepChange);
        remaining -= stepChange;
      }

      state = {
        ultimateTarget: targetCount,
        changeQueue,
        currentCount
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
      console.log(`[+] Spawned ${stepChange} new users for venue ${venue.name}. Step Target: ${currentCount + stepChange}`);
    } else if (stepChange < 0) {
      const toRemove = Math.abs(stepChange);
      const despawnList = currentUsers.slice(0, toRemove).map(u => u.user_id);
      simulatedUsers = simulatedUsers.filter(u => !despawnList.includes(u.user_id));
      despawnList.forEach(uid => {
        updates[uid] = null;
      });
      needsUpdate = true;
      console.log(`[-] Despawned ${toRemove} users from venue ${venue.name}. Step Target: ${currentCount - toRemove}`);
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
