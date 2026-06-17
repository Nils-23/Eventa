import { useEffect, useRef } from 'react';
import { collection, onSnapshot, doc, updateDoc, writeBatch, getDoc } from 'firebase/firestore';
import { ref, update, set, get, onValue } from 'firebase/database';
import { firestore, realtimeDB } from '../services/firebase';
import { getDistanceInMeters } from '../utils/locationUtils';
import { useAppStore } from './useAppStore';

const MAX_RADIUS_METERS = 200; // Roam within 200m
const HEARTBEAT_INTERVAL_MS = 15000; // Heartbeat lease & micro-movement every 15 seconds

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
     };
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

function getVenueHash(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

// Weekday Multipliers
function getWeekdayMultiplier(venueType: string, day: string): number {
  const type = (venueType || '').toUpperCase();
  if (type === 'CLUB') {
    switch (day) {
      case 'Mon': return 0.07;
      case 'Tue': return 0.07;
      case 'Wed': return 0.10;
      case 'Thu': return 0.68;
      case 'Fri': return 0.68;
      case 'Sat': return 0.68;
      case 'Sun': return 0.68;
    }
  } else if (type === 'BAR') {
    switch (day) {
      case 'Mon': return 0.20;
      case 'Tue': return 0.20;
      case 'Wed': return 0.28;
      case 'Thu': return 0.28;
      case 'Fri': return 1.0;
      case 'Sat': return 1.0;
      case 'Sun': return 1.0;
    }
  } else if (type === 'ACTIVITY') {
    switch (day) {
      case 'Mon': return 0.8;
      case 'Tue': return 0.8;
      case 'Wed': return 0.9;
      case 'Thu': return 0.9;
      case 'Fri': return 1.0;
      case 'Sat': return 1.0;
      case 'Sun': return 1.0;
    }
  }
  return 1.0;
}

// Hour Multipliers
function getHourMultiplier(
  venueType: string,
  hour: number,
  nowMs: number,
  eventStart?: number,
  eventEnd?: number
): number {
  const type = (venueType || '').toUpperCase();
  if (type === 'CLUB') {
    if (hour >= 22 || hour <= 2) return 1.0;
    if (hour === 20) return 0.2;
    if (hour === 21) return 0.5;
    if (hour === 3) return 0.6;
    if (hour === 4) return 0.3;
    if (hour === 5) return 0.1;
    if (hour === 6) return 0.05;
    return 0.05;
  } else if (type === 'BAR') {
    if (hour >= 19 && hour <= 23) return 1.0;
    if (hour === 16) return 0.2;
    if (hour === 17) return 0.5;
    if (hour === 18) return 0.8;
    if (hour === 0) return 0.6;
    if (hour === 1) return 0.3;
    if (hour === 2) return 0.1;
    if (hour === 3) return 0.05;
    return 0.02;
  } else if (type === 'ACTIVITY') {
    if (hour >= 11 && hour <= 16) return 1.0;
    if (hour === 8) return 0.3;
    if (hour === 9) return 0.6;
    if (hour === 10) return 0.8;
    if (hour === 17) return 0.8;
    if (hour === 18) return 0.5;
    if (hour === 19) return 0.2;
    return 0.05;
  } else if (type === 'EVENT' && eventStart && eventEnd) {
    if (nowMs < eventStart - 2 * 3600 * 1000) return 0.0;
    if (nowMs >= eventStart && nowMs <= eventEnd) {
      // Night attendance should be lower than daytime by default
      const isNight = hour >= 22 || hour < 9;
      return isNight ? 0.26 : 1.0;
    }
    
    if (nowMs < eventStart) {
      const timeDiff = nowMs - (eventStart - 2 * 3600 * 1000);
      const ratio = timeDiff / (2 * 3600 * 1000);
      return 0.1 + ratio * 0.9;
    } else {
      const timeDiff = nowMs - eventEnd;
      const ratio = timeDiff / (2 * 3600 * 1000);
      return Math.max(0, 1.0 - ratio * 1.0);
    }
  }
  return 1.0;
}

// Automatic Event Strength
function getEventStrengthMultiplier(venue: any): number {
  if (venue.type !== 'Event') return 1.0;
  
  const savedCount = venue.savedCount !== undefined ? venue.savedCount : null;
  const views = venue.views !== undefined ? venue.views : null;
  const shares = venue.shares !== undefined ? venue.shares : null;
  const comments = venue.comments !== undefined ? venue.comments : null;
  
  if (savedCount === null && views === null && shares === null && comments === null) {
    return 1.5; // MEDIUM
  }
  
  const sc = savedCount || 0;
  const v = views || 0;
  const sh = shares || 0;
  const c = comments || 0;
  
  const score = (sc * 2) + (v * 0.1) + (sh * 5) + (c * 3);
  if (score <= 50) return 1.0; // SMALL
  if (score <= 150) return 1.5; // MEDIUM
  if (score <= 400) return 2.5; // LARGE
  return 4.0; // MAJOR
}

export const useSimulationEngine = () => {
  const { isSimulationRunning, isAdmin } = useAppStore();
  const simulatedUsersRef = useRef<any[]>([]);
  const MY_SIMULATOR_ID = useRef(`sim_client_${Date.now()}_${Math.floor(Math.random() * 100000)}`);
  
  const venuesRef = useRef<any[]>([]);
  const storiesRef = useRef<any[]>([]);
  
  const venueSimStatesRef = useRef<Record<string, {
    ultimateTarget: number;
    currentCount: number;
    momentumScore: number;
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

  // Maintain realtime venues list
  useEffect(() => {
    if (!isAdmin) return;
    const unsubscribe = onSnapshot(collection(firestore, 'venues'), (snapshot) => {
      venuesRef.current = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    });
    return () => unsubscribe();
  }, [isAdmin]);

  // Maintain realtime stories list
  useEffect(() => {
    if (!isAdmin) return;
    const unsubscribe = onSnapshot(collection(firestore, 'stories'), (snapshot) => {
      storiesRef.current = snapshot.docs.map(doc => doc.data());
    });
    return () => unsubscribe();
  }, [isAdmin]);

  // Main calculations algorithm cycle (Runs dynamically inside useEffect timeout loop)
  const runSimulationAlgorithm = async () => {
    if (venuesRef.current.length === 0) return;

    console.log('[useSimulationEngine] Executing Eventas Simulation Cycle...');
    const nowMs = Date.now();
    const rawVenues = [...venuesRef.current].filter(venue => {
      if (venue.hidden === true) return false;
      if (venue.expirationDate && venue.expirationDate < nowMs) return false;
      if (venue.startDate && venue.startDate > nowMs) return false;
      return true;
    });
    const now = new Date();
    const nairobiDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(now);
    
    // Get current Nairobi weekday and hour
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

    // 1. Initialise missing metrics in Firestore batch if needed
    try {
      for (const v of rawVenues) {
        let needsUpdate = false;
        const updateObj: any = {};

        if (v.venueViews === undefined) {
          needsUpdate = true;
          const type = (v.type || 'Club').toUpperCase();
          const defaultPop = type === 'CLUB' ? 60 : type === 'BAR' ? 50 : type === 'ACTIVITY' ? 45 : 50;
          const baseViews = Math.floor(defaultPop * 3 + Math.random() * 100);
          const baseFavs = Math.floor(defaultPop * 0.5 + Math.random() * 10);
          const baseShares = Math.floor(defaultPop * 0.2 + Math.random() * 5);
          const baseVisits = Math.floor(defaultPop * 0.8 + Math.random() * 20);
          const baseCheckIns = Math.floor(defaultPop * 0.3 + Math.random() * 10);
          
          Object.assign(updateObj, {
            venueViews: baseViews,
            favorites: baseFavs,
            shares: baseShares,
            venueVisits: baseVisits,
            checkIns: baseCheckIns,
            popularityDrift: 1.0
          });
          
          if (v.type === 'Event') {
            Object.assign(updateObj, {
              savedCount: Math.floor(10 + Math.random() * 40),
              views: Math.floor(100 + Math.random() * 200),
              comments: Math.floor(2 + Math.random() * 10),
              shares: Math.floor(5 + Math.random() * 15)
            });
          }
        }

        if (v.venueIdentityFactor === undefined) {
          needsUpdate = true;
          updateObj.venueIdentityFactor = 0.90 + Math.random() * 0.20; // 0.90 to 1.10
        }

        if (needsUpdate) {
          await updateDoc(doc(firestore, 'venues', v.id), updateObj);
          Object.assign(v, updateObj);
        }
      }
    } catch (err) {
      console.error('[useSimulationEngine] Failed to initialize stats:', err);
    }

    // 2. Weekly popularity drift check
    try {
      const docRef = doc(firestore, 'settings', 'simulation');
      const docSnap = await getDoc(docRef);
      let lastDriftTime = 0;
      if (docSnap.exists()) {
        lastDriftTime = docSnap.data().lastDriftTime || 0;
      }
      if (nowMs - lastDriftTime > 7 * 24 * 3600 * 1000) {
        console.log('[useSimulationEngine] Triggering weekly drift update...');
        const batch = writeBatch(firestore);
        for (const v of rawVenues) {
          const currentDrift = v.popularityDrift || 1.0;
          const magnitude = 0.05 + Math.random() * 0.05; // 5% to 10%
          const sign = Math.random() > 0.5 ? 1 : -1;
          const drift = 1 + sign * magnitude;
          const newDrift = Math.max(0.5, Math.min(2.0, currentDrift * drift));
          batch.update(doc(firestore, 'venues', v.id), {
            popularityDrift: newDrift
          });
          v.popularityDrift = newDrift;
        }
        batch.update(docRef, {
          lastDriftTime: nowMs
        });
        await batch.commit();
      }
    } catch (err) {
      console.error('[useSimulationEngine] Weekly drift failed:', err);
    }

    // 3. Dynamic Popularity Score Calculation
    const scores = rawVenues.map(v => {
      const sc = (v.venueViews || 0) * 0.2 + 
                 (v.favorites || 0) * 2 + 
                 (v.shares || 0) * 3 + 
                 (v.venueVisits || 0) * 5 + 
                 (v.checkIns || 0) * 10;
      return { id: v.id, rawScore: sc };
    });

    const rawScoresList = scores.map(s => s.rawScore);
    const minHP = Math.min(...rawScoresList);
    const maxHP = Math.max(...rawScoresList);

    const rawStories = storiesRef.current || [];

    const computedVenues = rawVenues.map(v => {
      const rawObj = scores.find(s => s.id === v.id);
      const rawScore = rawObj ? rawObj.rawScore : 0;
      
      const historicalPopularity = maxHP > minHP 
        ? 1 + 99 * (rawScore - minHP) / (maxHP - minHP) 
        : 50;

      // Calculate a time-based rotation (cycle repeats every 8 hours)
      const cycleTime = (nowMs / (8 * 60 * 60 * 1000)) * 2 * Math.PI;
      const rotation = Math.sin(cycleTime + getVenueHash(v.id)) * 30; // Shift range: -30 to +30

      const recentStoriesCount = rawStories.filter(s => s.venue_id === v.id).length;
      const recentChatsCount = Math.floor(Math.random() * 10);
      const recentActivity = (recentStoriesCount * 15) + (recentChatsCount * 5);

      const popularityBase = Math.max(1, historicalPopularity + rotation + recentActivity);
      const popularityDrift = v.popularityDrift || 1.0;
      const trendFactor = 0.85 + Math.random() * 0.3; // random(0.85 - 1.15)

      const resultingPopularity = popularityBase * popularityDrift * trendFactor;

      return {
        ...v,
        resultingPopularity
      };
    });

    // 4. Popularity Distribution (Tier-Based Popularity Clustering category-wise, relative to time)
    const venuesByType: Record<string, typeof computedVenues> = {};
    computedVenues.forEach(v => {
      if (!venuesByType[v.type]) {
        venuesByType[v.type] = [];
      }
      venuesByType[v.type].push(v);
    });

    const venuesWithFactors: typeof computedVenues = [];
    for (const type in venuesByType) {
      const list = venuesByType[type];
      list.sort((a, b) => a.resultingPopularity - b.resultingPopularity);
      const totalInType = list.length;
      
      list.forEach((v, index) => {
        const rank = totalInType > 1 ? index / (totalInType - 1) : 1.0;
        
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

        venuesWithFactors.push({
          ...v,
          popularityFactor: tierFactor
        });
      });
    }

    // 5. Fetch presence to count real users
    let allPresence: Record<string, Record<string, number>> = {};
    try {
      const presenceSnap = await get(ref(realtimeDB, 'venue_presence'));
      if (presenceSnap.exists()) {
        allPresence = presenceSnap.val();
      }
    } catch (err) {
      console.error('[useSimulationEngine] Failed to fetch presence:', err);
    }

    // 6. Recalculate targets (Pass 1)
    const proposedCounts: Record<string, number> = {};
    const calculatedTargets: Record<string, number> = {};
    const venueContexts: Record<string, {
      cap: number;
      currentCount: number;
      realUserCount: number;
      currentUsers: any[];
    }> = {};

    venuesWithFactors.forEach(venue => {
      let isOverride = venue.isOverride === true;
      if (isOverride && venue.overrideDate !== nairobiDateStr) {
        // Reset override in Firestore
        updateDoc(doc(firestore, 'venues', venue.id), {
          isOverride: false
        }).catch(err => console.error(`[useSimulationEngine] Failed to reset override for ${venue.name}:`, err));
        isOverride = false;
        venue.isOverride = false;
      }
      const cap = venue.maxCapacity !== undefined ? venue.maxCapacity : getDefaultCapacity(venue.type);

      let targetAttendance = 0;

      if (isOverride) {
        targetAttendance = venue.simulatedUsersCount !== undefined ? venue.simulatedUsersCount : 20;
      } else {
        const weekdayMultiplier = getWeekdayMultiplier(venue.type, weekday);
        const hourMultiplier = getHourMultiplier(venue.type, hour, nowMs, venue.startDate, venue.expirationDate);
        const eventStrengthMultiplier = getEventStrengthMultiplier(venue);

        let state = venueSimStatesRef.current[venue.id];
        if (!state) {
          state = {
            ultimateTarget: 0,
            currentCount: 0,
            momentumScore: 1.0
          };
          venueSimStatesRef.current[venue.id] = state;
        }
        
        const momentumScore = state.momentumScore || 1.0;
        const calculatedTarget = cap * 
                                 venue.popularityFactor * 
                                 weekdayMultiplier * 
                                 hourMultiplier * 
                                 eventStrengthMultiplier * 
                                 momentumScore;

        // Apply independent dynamic target noise (±15%) to break monotonicity
        const dynamicNoise = 0.85 + Math.random() * 0.30;
        targetAttendance = calculatedTarget * dynamicNoise;
      }

      // Apply venueIdentityFactor directly to the decimal calculatedTarget before rounding once
      const identityFactor = venue.venueIdentityFactor !== undefined ? venue.venueIdentityFactor : 1.0;
      const adjustedTargetAttendance = Math.max(0, Math.min(cap, Math.round(targetAttendance * identityFactor)));
      calculatedTargets[venue.id] = adjustedTargetAttendance;

      // Count real users within last 15 minutes
      const presenceObj = allPresence[venue.id] || {};
      const fifteenMinAgo = Date.now() - 15 * 60 * 1000;
      let realUserCount = 0;
      for (const uid in presenceObj) {
        if (!uid.startsWith('sim_') && presenceObj[uid] > fifteenMinAgo) {
          realUserCount++;
        }
      }

      const currentUsers = simulatedUsersRef.current.filter(u => u.venueId === venue.id);
      let currentCount = currentUsers.length;

      // Momentum System: Drift slowly by ±0.02
      let state = venueSimStatesRef.current[venue.id];
      if (state) {
        let momentum = state.momentumScore || 1.0;
        if (adjustedTargetAttendance > currentCount) {
          momentum = Math.min(1.2, momentum + 0.02);
        } else if (adjustedTargetAttendance < currentCount) {
          momentum = Math.max(0.8, momentum - 0.02);
        }
        state.momentumScore = momentum;
      }

      const simulatedTarget = Math.max(0, adjustedTargetAttendance - realUserCount);

      // Smooth Transitions: Move only 5-15% toward target
      const diff = simulatedTarget - currentCount;
      const transitionFactor = 0.05 + Math.random() * 0.10;
      const rawStep = diff * transitionFactor;
      let step = 0;
      if (diff > 0 && rawStep < 1) {
        // Stochastic rounding for small positive steps
        step = Math.random() < rawStep ? 1 : 0;
      } else if (diff < 0 && rawStep > -1) {
        // Stochastic rounding for small negative steps
        step = Math.random() < Math.abs(rawStep) ? -1 : 0;
      } else {
        step = Math.round(rawStep);
      }
      let newCount = currentCount + step;

      // Spike Protection: Cap max change per cycle (±3, ±8, ±15)
      let delta = newCount - currentCount;
      let maxDelta = 15;
      if (currentCount < 15) {
        maxDelta = 3;
      } else if (currentCount <= 50) {
        maxDelta = 8;
      } else {
        maxDelta = 15;
      }

      if (delta > maxDelta) delta = maxDelta;
      if (delta < -maxDelta) delta = -maxDelta;
      newCount = currentCount + delta;

      newCount = Math.max(0, Math.min(cap, newCount));

      // Force 0 for future unstarted events
      if (venue.type === 'Event' && venue.startDate && Date.now() < venue.startDate) {
        newCount = 0;
      }

      proposedCounts[venue.id] = newCount;
      venueContexts[venue.id] = {
        cap,
        currentCount,
        realUserCount,
        currentUsers
      };
    });

    // Collision Safeguard Step
    const venueTypes = ['CLUB', 'BAR', 'ACTIVITY', 'EVENT'];
    for (const vType of venueTypes) {
      const typeVenues = venuesWithFactors.filter(v => (v.type || 'Club').toUpperCase() === vType);
      
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
        const assignedCounts = new Set<number>();
        
        // Shuffle venues to avoid systematic bias in adjustments
        const shuffledVenues = [...typeVenues].sort(() => Math.random() - 0.5);
        
        shuffledVenues.forEach(venue => {
          let count = proposedCounts[venue.id];
          if (count === undefined) return;
          
          const cap = venueContexts[venue.id].cap;
          
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

    // Pass 2: Apply resolved counts and spawn/despawn simulated users
    let currentSims = [...simulatedUsersRef.current];
    let updates: any = {};
    let needsUpdate = false;

    // Prune simulated users for inactive/expired/deleted/hidden venues
    const activeVenueIds = new Set(rawVenues.map(v => v.id));
    const usersToPrune = currentSims.filter(u => !activeVenueIds.has(u.venueId));
    if (usersToPrune.length > 0) {
      const pruneIds = usersToPrune.map(u => u.user_id);
      currentSims = currentSims.filter(u => !pruneIds.includes(u.user_id));
      pruneIds.forEach(uid => {
        updates[uid] = null;
      });
      needsUpdate = true;
      console.log(`[Clean] Pruned ${pruneIds.length} simulated users for inactive/expired/deleted/hidden venues.`);
    }

    venuesWithFactors.forEach(venue => {
      const { cap, currentUsers } = venueContexts[venue.id];
      let currentCount = currentUsers.length;

      // Force prune if excess sims exceed capacity
      if (currentCount > cap) {
        const excessCount = currentCount - cap;
        const toPrune = currentUsers.slice(0, excessCount).map(u => u.user_id);
        currentSims = currentSims.filter(u => !toPrune.includes(u.user_id));
        toPrune.forEach(uid => {
          updates[uid] = null;
        });
        needsUpdate = true;
        currentCount = cap;
      }

      const newCount = proposedCounts[venue.id];
      const targetAttendance = calculatedTargets[venue.id];

      const finalDiff = newCount - currentCount;
      if (finalDiff > 0) {
        for (let i = 0; i < finalDiff; i++) {
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
      } else if (finalDiff < 0) {
        const toRemove = Math.abs(finalDiff);
        const despawnList = currentUsers.slice(0, toRemove).map(u => u.user_id);
        currentSims = currentSims.filter(u => !despawnList.includes(u.user_id));
        despawnList.forEach(uid => {
          updates[uid] = null;
        });
        needsUpdate = true;
      }

      // Update local memory state tracking
      let state = venueSimStatesRef.current[venue.id];
      if (state) {
        state.ultimateTarget = targetAttendance;
        state.currentCount = newCount;
      }
    });

    simulatedUsersRef.current = currentSims;

    if (needsUpdate) {
      try {
        await update(ref(realtimeDB, 'simulated_locations'), updates);
      } catch (err) {
        console.error('[useSimulationEngine] RTDB updates failed:', err);
      }
    }
  };

  // Run the main simulation loops
  useEffect(() => {
    if (!isSimulationRunning || !isAdmin) {
      // Clean up local reference and release RTDB lease if we hold it
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
      venueSimStatesRef.current = {};
      return;
    }

    // Initial sync
    const initializeEngine = async () => {
      try {
        const snap = await get(ref(realtimeDB, 'simulated_locations'));
        if (snap.exists()) {
          const existingSims = Object.values(snap.val());
          simulatedUsersRef.current = existingSims.filter((s: any) => s.user_id && s.venueId);
        }
      } catch (err) {
        console.error('Error fetching existing simulations:', err);
      }
      
      try {
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
          await runSimulationAlgorithm();
        }
      } catch (err) {
        console.error('[useSimulationEngine] Initial lease claim failed:', err);
      }
    };

    initializeEngine();

    // Loop 1: Fast Heartbeat & Micro-movements Roaming (Runs every 15 seconds)
    const fastIntervalId = setInterval(async () => {
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
        console.error('[useSimulationEngine] Fast check failed to read status:', err);
        return;
      }

      const nowMs = getServerTime();
      const isLeaseActive = activeId && (nowMs - lastHeartbeat < 30000);

      // Claim or renew lease
      if (!isLeaseActive || activeId === MY_SIMULATOR_ID.current) {
        try {
          await set(ref(realtimeDB, 'simulation_status'), {
            activeSimulatorId: MY_SIMULATOR_ID.current,
            lastHeartbeat: nowMs
          });
        } catch (err) {
          console.error('[useSimulationEngine] Heartbeat lease renewal failed:', err);
          return;
        }
      } else {
        return; // Standby client
      }

      // Roam/Move existing users slightly to make them roam organically
      if (simulatedUsersRef.current.length === 0) return;

      const updates: any = {};
      const nextState = simulatedUsersRef.current.map(u => {
        const nextLoc = moveLocation(u.latitude, u.longitude, u.centerLat, u.centerLon, 15);
        const updatedUser = {
          ...u,
          latitude: nextLoc.latitude,
          longitude: nextLoc.longitude,
          timestamp: nowMs
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
        console.error('[useSimulationEngine] Fast tick movement update failed:', err);
      }
    }, HEARTBEAT_INTERVAL_MS);

    // Loop 2: Simulation Cycle (Runs recalculations and spawning on a random 2-5 minutes recursive timeout)
    let simTimerId: NodeJS.Timeout;

    const scheduleNextSimulationTick = () => {
      // Choose a random interval between 2 and 5 minutes
      const randomMinutes = 2 + Math.random() * 3;
      const intervalMs = Math.round(randomMinutes * 60 * 1000);
      
      simTimerId = setTimeout(async () => {
        // Verify lease before running calculation
        try {
          const statusSnap = await get(ref(realtimeDB, 'simulation_status'));
          if (statusSnap.exists()) {
            const activeId = statusSnap.val().activeSimulatorId;
            if (activeId !== MY_SIMULATOR_ID.current) {
              console.log('[useSimulationEngine] Standing by, lease held by:', activeId);
              scheduleNextSimulationTick();
              return;
            }
          }
        } catch (err) {
          console.warn('[useSimulationEngine] Failed lease check in simulation cycle:', err);
        }

        await runSimulationAlgorithm();
        scheduleNextSimulationTick();
      }, intervalMs);
      
      console.log(`[useSimulationEngine] Next simulation tick scheduled in ${Math.round(intervalMs / 1000)} seconds.`);
    };

    scheduleNextSimulationTick();

    return () => {
      clearInterval(fastIntervalId);
      clearTimeout(simTimerId);
    };
  }, [isSimulationRunning, isAdmin]);
};
