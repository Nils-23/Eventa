import { useEffect, useRef } from 'react';
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { ref, update, set, get } from 'firebase/database';
import { firestore, realtimeDB } from '../services/firebase';
import { getDistanceInMeters } from '../utils/locationUtils';
import { useAppStore } from './useAppStore';

const MAX_RADIUS_METERS = 200; // Roam within 200m
const UPDATE_INTERVAL_MS = 15000; // Update every 15 seconds
const DEFAULT_USERS_PER_VENUE = 20;

// Helper to calculate a new location within distance
function offsetLocation(lat: number, lon: number, maxDistanceMeters: number) {
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

// Helper to move a bit towards target or randomly
function moveLocation(currentLat: number, currentLon: number, centerLat: number, centerLon: number, stepMeters: number) {
  const { latitude, longitude } = offsetLocation(currentLat, currentLon, stepMeters);
  
  const distance = getDistanceInMeters(latitude, longitude, centerLat, centerLon);
  if (distance > MAX_RADIUS_METERS) {
     return {
       latitude: (latitude + centerLat) / 2,
       longitude: (longitude + centerLon) / 2
     }
  }
  return { latitude, longitude };
}

function getDefaultCapacity(type?: 'Club' | 'Bar' | 'Activity' | 'Event'): number {
  if (!type) return 100;
  switch (type) {
    case 'Club': return 250;
    case 'Bar': return 100;
    case 'Activity': return 200;
    case 'Event': return 500;
    default: return 100;
  }
}

function getDynamicTargetCount(venue: any, allVenues?: any[]): number {
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
  let tier: 'hot' | 'medium' | 'low' = 'low';
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

  const isNightlifePeak = (day: string, hr: number) => {
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

export const useSimulationEngine = () => {

  const { isSimulationRunning, isAdmin } = useAppStore();
  const simulatedUsersRef = useRef<any[]>([]);
  const venuesRef = useRef<any[]>([]);

  // 1. Maintain realtime venues list for target counts
  useEffect(() => {
    if (!isAdmin) return; // Only admins need this

    const unsubscribe = onSnapshot(collection(firestore, 'venues'), (snapshot) => {
      const venues = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
      venuesRef.current = venues;
      
      // If simulation is running, instantly sync counts
      if (isSimulationRunning) {
        syncAllVenueUsers();
      }
    });

    return () => unsubscribe();
  }, [isAdmin, isSimulationRunning]);

  const syncAllVenueUsers = async () => {
    let currentSims = [...simulatedUsersRef.current];
    let updates: any = {};
    let needsUpdate = false;

    // Fetch the entire venue_presence once to count real users
    let allPresence: Record<string, Record<string, number>> = {};
    try {
      const presenceSnap = await get(ref(realtimeDB, 'venue_presence'));
      if (presenceSnap.exists()) {
        allPresence = presenceSnap.val();
      }
    } catch (err) {
      console.error('[syncAllVenueUsers] Failed to fetch presence:', err);
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

    const isNightlifePeak = (day: string, hr: number) => {
      if (hr >= 21) {
        return ['Fri', 'Sat', 'Sun'].includes(day);
      } else if (hr < 4) {
        return ['Sat', 'Sun', 'Mon'].includes(day);
      }
      return false;
    };

    venuesRef.current.forEach(venue => {
      // 1. Initialize & drift popularity scores in Firestore slowly
      const isOverride = venue.isOverride === true;
      if (!isOverride) {
        if (venue.simPopularityScore === undefined) {
          const initialScore = Math.random();
          updateDoc(doc(firestore, 'venues', venue.id), {
            simPopularityScore: initialScore
          }).catch(err => console.error(`[useSimulationEngine] Failed to initialize score for ${venue.name}:`, err));
        } else if (Math.random() < 0.01) {
          const currentScore = venue.simPopularityScore;
          const drift = (Math.random() - 0.5) * 0.1;
          const newScore = Math.max(0.0, Math.min(1.0, currentScore + drift));
          updateDoc(doc(firestore, 'venues', venue.id), {
            simPopularityScore: newScore
          }).catch(err => console.error(`[useSimulationEngine] Failed to drift score for ${venue.name}:`, err));
        }
      }

      // 2. Count real users present within last 15 minutes
      const presenceObj = allPresence[venue.id] || {};
      const fifteenMinAgo = Date.now() - 15 * 60 * 1000;
      let realUserCount = 0;
      for (const uid in presenceObj) {
        if (!uid.startsWith('sim_') && presenceObj[uid] > fifteenMinAgo) {
          realUserCount++;
        }
      }

      // 3. Compute dynamic target count
      const baseTarget = getDynamicTargetCount(venue, venuesRef.current);
      
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

      const currentUsers = currentSims.filter(u => u.venueId === venue.id);
      const currentCount = currentUsers.length;

      // Real user count takes priority and subtracts from simulated target
      const rawTargetCount = Math.round(currentCount * 0.7 + finalTarget * 0.3);
      const targetCount = Math.max(0, rawTargetCount - realUserCount);

      if (currentCount < targetCount) {
        const toSpawn = targetCount - currentCount;
        for (let i = 0; i < toSpawn; i++) {
          const loc = offsetLocation(venue.latitude, venue.longitude, MAX_RADIUS_METERS / 2);
          const newUser = {
            user_id: `sim_${venue.id}_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
            venueId: venue.id,
            centerLat: venue.latitude,
            centerLon: venue.longitude,
            latitude: loc.latitude,
            longitude: loc.longitude,
            timestamp: Date.now()
          };
          currentSims.push(newUser);
          updates[newUser.user_id] = newUser;
          needsUpdate = true;
        }
      } else if (currentCount > targetCount) {
        const toRemove = currentCount - targetCount;
        const despawnList = currentUsers.slice(0, toRemove).map(u => u.user_id);
        
        currentSims = currentSims.filter(u => !despawnList.includes(u.user_id));
        despawnList.forEach(uid => {
          updates[uid] = null;
        });
        needsUpdate = true;
      }
    });

    simulatedUsersRef.current = currentSims;

    if (needsUpdate) {
      update(ref(realtimeDB, 'simulated_locations'), updates).catch(console.error);
    }
  };
  // 2. Run the main simulation loop
  useEffect(() => {
    if (!isSimulationRunning || !isAdmin) {
      // Clean up local reference and wipe RTDB when stopped
      if (simulatedUsersRef.current.length > 0) {
        import('firebase/auth').then(({ getAuth }) => {
          const auth = getAuth();
          if (auth.currentUser) {
            set(ref(realtimeDB, 'simulated_locations'), null).catch(console.error);
          }
        });
      }
      simulatedUsersRef.current = [];
      return;
    }

    // Initial sync
    const initializeEngine = async () => {
      try {
        // Fetch existing sims from RTDB so we don't infinitely duplicate them on app restart
        const { get } = await import('firebase/database');
        const snap = await get(ref(realtimeDB, 'simulated_locations'));
        if (snap.exists()) {
          const existingSims = Object.values(snap.val());
          // Only keep sims that are structurally valid
          simulatedUsersRef.current = existingSims.filter((s: any) => s.user_id && s.venueId);
        }
      } catch (err) {
        console.error('Error fetching existing simulations:', err);
      }
      
      syncAllVenueUsers();
    };

    initializeEngine();

    const tick = async () => {
      syncAllVenueUsers();

      if (simulatedUsersRef.current.length === 0) return;

      
      const now = Date.now();
      const updates: any = {};

      const nextState = simulatedUsersRef.current.map(u => {
        const nextLoc = moveLocation(u.latitude, u.longitude, u.centerLat, u.centerLon, 15);
        const updatedUser = {
          ...u,
          latitude: nextLoc.latitude,
          longitude: nextLoc.longitude,
          timestamp: now
        };

        updates[u.user_id] = {
          latitude: updatedUser.latitude,
          longitude: updatedUser.longitude,
          timestamp: updatedUser.timestamp,
          user_id: updatedUser.user_id,
          venueId: updatedUser.venueId
        };

        return updatedUser;
      });

      simulatedUsersRef.current = nextState;

      try {
        await update(ref(realtimeDB, 'simulated_locations'), updates);
      } catch (err) {
        console.error('Simulation RTDB Error:', err);
      }
    };

    const intervalId = setInterval(tick, UPDATE_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [isSimulationRunning, isAdmin]);
};
