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

let simulatedUsers = [];
let activeVenues = [];

function syncVenueUsers(venue, targetCount) {
  const currentUsers = simulatedUsers.filter(u => u.venueId === venue.id);
  const currentCount = currentUsers.length;

  if (currentCount < targetCount) {
    const toSpawn = targetCount - currentCount;
    for (let i = 0; i < toSpawn; i++) {
      const loc = offsetLocation(venue.latitude, venue.longitude, MAX_RADIUS_METERS / 2);
      simulatedUsers.push({
        user_id: `sim_${venue.id}_${Date.now()}_${i}_${Math.floor(Math.random() * 100000)}`,
        venueId: venue.id,
        centerLat: venue.latitude,
        centerLon: venue.longitude,
        latitude: loc.latitude,
        longitude: loc.longitude,
        timestamp: Date.now()
      });
    }
    console.log(`[+] Spawned ${toSpawn} new users for venue ${venue.name}. Total: ${targetCount}`);
  } else if (currentCount > targetCount) {
    const toRemove = currentCount - targetCount;
    const despawnList = currentUsers.slice(0, toRemove).map(u => u.user_id);
    
    simulatedUsers = simulatedUsers.filter(u => !despawnList.includes(u.user_id));
    
    const locationsRef = rtdb.ref('simulated_locations');
    const updates = {};
    despawnList.forEach(uid => {
      updates[uid] = null;
    });
    
    locationsRef.update(updates).catch(console.error);
    console.log(`[-] Despawned ${toRemove} users from venue ${venue.name}. Total: ${targetCount}`);
  }
}



async function startSimulation() {
  console.log('Starting dynamic simulation server...');
  
  // Listen to changes in venues dynamically
  db.collection('venues').onSnapshot(async (snapshot) => {
    activeVenues = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
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

    activeVenues.forEach(venue => {
      const isOverride = venue.isOverride === true;
      // Drift & Initialize popularity scores
      if (!isOverride) {
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

      const baseTarget = getDynamicTargetCount(venue, activeVenues);
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
      const targetCount = Math.max(0, rawTargetCount - realUserCount);

      syncVenueUsers(venue, targetCount);
    });
  });

  const tick = async () => {
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

    activeVenues.forEach(venue => {
      const isOverride = venue.isOverride === true;
      // Drift & Initialize popularity scores
      if (!isOverride) {
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

      const baseTarget = getDynamicTargetCount(venue, activeVenues);
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
      const targetCount = Math.max(0, rawTargetCount - realUserCount);

      syncVenueUsers(venue, targetCount);
    });

    if (simulatedUsers.length === 0) return;
    
    const locationsRef = rtdb.ref('simulated_locations');
    const updates = {};
    const nowMs = Date.now();

    simulatedUsers.forEach(u => {
      const nextLoc = moveLocation(u.latitude, u.longitude, u.centerLat, u.centerLon, 15);
      u.latitude = nextLoc.latitude;
      u.longitude = nextLoc.longitude;
      u.timestamp = nowMs;

      updates[u.user_id] = {
        latitude: u.latitude,
        longitude: u.longitude,
        timestamp: u.timestamp,
        user_id: u.user_id,
        venueId: u.venueId
      };
    });

    locationsRef.update(updates)
      .then(() => console.log(`[${new Date().toISOString()}] Updated ${simulatedUsers.length} simulated locations.`))
      .catch(err => console.error('Failed to update RTDB:', err));
  };

  setInterval(tick, UPDATE_INTERVAL_MS);
}

startSimulation().catch(console.error);
