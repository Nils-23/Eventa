import { useEffect, useRef } from 'react';
import { collection, onSnapshot, doc, updateDoc, writeBatch, getDoc } from 'firebase/firestore';
import { ref, update, set, get, onValue } from 'firebase/database';
import { firestore, realtimeDB } from '../services/firebase';
import { getDistanceInMeters } from '../utils/locationUtils';
import { useAppStore } from './useAppStore';
import {
  getProfile,
  getProfileCapacity,
  getAttendanceShape,
  getEventEnvelope,
  getStableBaseFactor,
  inferProfileKey,
  samplePoisson,
} from '../utils/venueProfiles';

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

function getVenueHash(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
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
  const isSimulationRunning = useAppStore((s) => s.isSimulationRunning);
  const isAdmin = useAppStore((s) => s.isAdmin);
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

        // Persist the inferred profile so admins can see/override it in Firestore.
        // New venues are classified automatically on their first simulation cycle;
        // inference is deterministic, so this is a cache, not a source of truth.
        if (v.venueProfile === undefined) {
          needsUpdate = true;
          updateObj.venueProfile = inferProfileKey(v);
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

    // 3. Per-venue popularity: stable log-normal base around the profile's prior.
    // Heavy-tailed and deterministic per venue id — a few standouts, a long quiet
    // tail, no per-cycle re-rolling, and identical for any client or future venue.
    const rawStories = storiesRef.current || [];

    const venuesWithFactors = rawVenues.map(v => {
      const profile = getProfile(v);
      const baseFactor = getStableBaseFactor(v.id, profile.popularityPrior);

      // Slow 8h rotation so the "hot" venue of the moment shifts through the week (±15%)
      const cycleTime = (nowMs / (8 * 60 * 60 * 1000)) * 2 * Math.PI;
      const rotation = 1 + 0.15 * Math.sin(cycleTime + getVenueHash(v.id));

      // Real activity signal: stories posted at this venue draw a modest extra crowd
      const recentStoriesCount = rawStories.filter(s => s.venue_id === v.id).length;
      const storyBoost = Math.min(1.3, 1 + recentStoriesCount * 0.05);

      const popularityDrift = v.popularityDrift || 1.0;

      const popularityFactor = Math.max(0.02, Math.min(0.95,
        baseFactor * rotation * storyBoost * popularityDrift
      ));

      return { ...v, profile, popularityFactor };
    });

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
      const cap = getProfileCapacity(venue, venue.profile);

      let adjustedTargetAttendance = 0;

      if (isOverride) {
        adjustedTargetAttendance = Math.max(0, Math.min(cap,
          venue.simulatedUsersCount !== undefined ? venue.simulatedUsersCount : 20));
      } else {
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
        const identityFactor = venue.venueIdentityFactor !== undefined ? venue.venueIdentityFactor : 1.0;

        // AMPLITUDE: how big this venue's crowd can get (capped at capacity).
        // Event strength scales amplitude only — a big event fills the venue at its
        // peak hours, but can no longer cancel the night/off-hours shape.
        const eventStrengthMultiplier = getEventStrengthMultiplier(venue);
        const amplitude = Math.min(cap,
          cap * venue.popularityFactor * identityFactor * eventStrengthMultiplier);

        // SHAPE: when people actually show up, always in [0, 1].
        // Profile curves handle the venue's rhythm; the envelope gates events to
        // their scheduled window (pessimistic 0.3 when an event has no dates).
        let shape = getAttendanceShape(venue.profile, weekday, hour);
        if (venue.type === 'Event') {
          shape *= getEventEnvelope(nowMs, venue.startDate, venue.expirationDate);
        }

        // Poisson sampling supplies natural, scale-appropriate variance — small
        // venues wobble by ones, big venues by tens — replacing uniform noise and
        // the old collision-resolution laddering.
        const targetFloat = amplitude * shape * momentumScore;
        adjustedTargetAttendance = Math.max(0, Math.min(cap, samplePoisson(targetFloat)));
      }

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

      // Smooth Transitions — asymmetric: crowds build gradually (5-15% per cycle)
      // but empty out fast (25-45% per cycle), matching how venues clear at closing.
      const diff = simulatedTarget - currentCount;
      const transitionFactor = diff < 0
        ? 0.25 + Math.random() * 0.20
        : 0.05 + Math.random() * 0.10;
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

      // Spike Protection: cap growth per cycle; allow departures to run 2x faster
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
      if (delta < -maxDelta * 2) delta = -maxDelta * 2;
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

    // NOTE: The old "Collision Safeguard" (forcing unique counts per category) was
    // removed deliberately — nudging venues onto adjacent integers produced the
    // artificial 10, 9, 8, 7 laddering. Poisson sampling above disperses counts
    // naturally, and real venues can legitimately tie.

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
