import { useEffect, useRef } from 'react';
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { ref, update, set, get, onValue } from 'firebase/database';
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
    case 'Club': return 100;
    case 'Bar': return 50;
    case 'Activity': return 75;
    case 'Event': return 150;
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
  const MY_SIMULATOR_ID = useRef(`sim_client_${Date.now()}_${Math.floor(Math.random() * 100000)}`);
  const venuesRef = useRef<any[]>([]);
  const lastRecalculateTimeRef = useRef<number>(0);
  const venueSimStatesRef = useRef<Record<string, {
    ultimateTarget: number;
    changeQueue: number[];
    currentCount: number;
  }>>({});

  const serverTimeOffsetRef = useRef<number>(0);

  // Synchronize server time offset to handle local clock drift
  useEffect(() => {
    if (!isAdmin) return;
    const offsetRef = ref(realtimeDB, '.info/serverTimeOffset');
    const unsub = onValue(offsetRef, (snap) => {
      serverTimeOffsetRef.current = snap.val() || 0;
    });
    return () => unsub();
  }, [isAdmin]);

  // Global subscription to settings/simulation document in Firestore for all screens
  useEffect(() => {
    if (!isAdmin) return;
    const unsub = onSnapshot(doc(firestore, 'settings', 'simulation'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.enabled !== undefined) {
          useAppStore.setState({ isSimulationRunning: data.enabled });
        }
      }
    }, (error) => {
      console.warn("[useSimulationEngine] Failed to listen to simulation settings:", error);
    });
    return () => unsub();
  }, [isAdmin]);

  const getServerTime = () => Date.now() + serverTimeOffsetRef.current;

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

  const syncAllVenueUsers = async (isTick = false) => {
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

    const nowMs = Date.now();
    const shouldRecalculate = lastRecalculateTimeRef.current === 0 || (nowMs - lastRecalculateTimeRef.current >= 5 * 60 * 1000);

    if (shouldRecalculate && isTick) {
      lastRecalculateTimeRef.current = nowMs;
    }

    const getTargetForVenue = (venue: any, currentCount: number, realUserCount: number): number => {
      const isOverride = venue.isOverride === true;
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

      const rawTargetCount = Math.round(currentCount * 0.7 + finalTarget * 0.3);
      let targetCount = Math.max(0, rawTargetCount - realUserCount);
      if (venue.startDate && Date.now() < venue.startDate) {
        targetCount = 0;
      }
      return targetCount;
    };

    venuesRef.current.forEach(venue => {
      // 1. Initialize & drift popularity scores in Firestore slowly
      const isOverride = venue.isOverride === true;
      if (!isOverride && isTick) {
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

      const currentUsers = currentSims.filter(u => u.venueId === venue.id);
      const currentCount = currentUsers.length;

      let state = venueSimStatesRef.current[venue.id];
      const targetCount = getTargetForVenue(venue, currentCount, realUserCount);

      if (shouldRecalculate || !state || state.ultimateTarget !== targetCount) {
        const diff = targetCount - currentCount;
        const steps = 5;
        const changeQueue: number[] = [];
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
        venueSimStatesRef.current[venue.id] = state;
      }

      const stepChange = (isTick && state.changeQueue.length > 0) ? state.changeQueue.shift()! : 0;

      if (stepChange > 0) {
        for (let i = 0; i < stepChange; i++) {
          const loc = offsetLocation(venue.latitude, venue.longitude, MAX_RADIUS_METERS / 2);
          const newUser = {
            user_id: `sim_${venue.id}_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
            venueId: venue.id,
            centerLat: venue.latitude,
            centerLon: venue.longitude,
            latitude: loc.latitude,
            longitude: loc.longitude,
            timestamp: getServerTime()
          };
          currentSims.push(newUser);
          updates[newUser.user_id] = newUser;
          needsUpdate = true;
        }
      } else if (stepChange < 0) {
        const toRemove = Math.abs(stepChange);
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
      // Clean up local reference and wipe RTDB only if we are the active leader holding the lease
      import('firebase/auth').then(({ getAuth }) => {
        const auth = getAuth();
        if (auth.currentUser) {
          get(ref(realtimeDB, 'simulation_status')).then((snap) => {
            if (snap.exists() && snap.val().activeSimulatorId === MY_SIMULATOR_ID.current) {
              set(ref(realtimeDB, 'simulated_locations'), null).catch(console.error);
              set(ref(realtimeDB, 'simulation_status'), null).catch(console.error);
              console.log('[useSimulationEngine] Released active lease and cleared simulated locations.');
            }
          }).catch(console.error);
        }
      });
      simulatedUsersRef.current = [];
      lastRecalculateTimeRef.current = 0;
      venueSimStatesRef.current = {};
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
      
      try {
        const { get } = await import('firebase/database');
        const statusSnap = await get(ref(realtimeDB, 'simulation_status'));
        let activeId = null;
        let lastHeartbeat = 0;
        if (statusSnap.exists()) {
          const val = statusSnap.val();
          activeId = val.activeSimulatorId;
          lastHeartbeat = val.lastHeartbeat || 0;
        }
        const nowMs = getServerTime();
        const isLeaseActive = activeId && (nowMs - lastHeartbeat < 30000);
        if (!isLeaseActive || activeId === MY_SIMULATOR_ID.current) {
          await set(ref(realtimeDB, 'simulation_status'), {
            activeSimulatorId: MY_SIMULATOR_ID.current,
            lastHeartbeat: nowMs
          });
          syncAllVenueUsers();
        }
      } catch (err) {
        console.error('[useSimulationEngine] Initial lease claim failed:', err);
      }
    };

    initializeEngine();

    const tick = async () => {
      // 1. Leader election check
      let activeId = null;
      let lastHeartbeat = 0;
      try {
        const statusSnap = await get(ref(realtimeDB, 'simulation_status'));
        if (statusSnap.exists()) {
          const val = statusSnap.val();
          activeId = val.activeSimulatorId;
          lastHeartbeat = val.lastHeartbeat || 0;
        }
      } catch (err) {
        console.error('[useSimulationEngine] Failed to read simulation status:', err);
      }

      const nowMs = getServerTime();
      const isLeaseActive = activeId && (nowMs - lastHeartbeat < 30000);

      if (isLeaseActive && activeId !== MY_SIMULATOR_ID.current) {
        console.log(`[useSimulationEngine] Standing by. Active simulator is ${activeId}`);
        return;
      }

      // Claim/Renew lease
      try {
        await set(ref(realtimeDB, 'simulation_status'), {
          activeSimulatorId: MY_SIMULATOR_ID.current,
          lastHeartbeat: nowMs
        });
      } catch (err) {
        console.error('[useSimulationEngine] Failed to claim simulation lease:', err);
        return;
      }

      syncAllVenueUsers(true);

      if (simulatedUsersRef.current.length === 0) return;

      
      const now = getServerTime();
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
