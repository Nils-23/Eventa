import { useEffect, useRef } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { ref, update, set } from 'firebase/database';
import { firestore, realtimeDB } from '../services/firebase';
import { getDistanceInMeters } from '../utils/locationUtils';
import { useAppStore } from './useAppStore';

const MAX_RADIUS_METERS = 200; // Roam within 200m
const UPDATE_INTERVAL_MS = 15000; // Update every 15 seconds
const DEFAULT_USERS_PER_VENUE = 80;

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

  const syncAllVenueUsers = () => {
    let currentSims = [...simulatedUsersRef.current];
    let updates: any = {};
    let needsUpdate = false;

    venuesRef.current.forEach(venue => {
      const targetCount = venue.simulatedUsersCount !== undefined ? venue.simulatedUsersCount : DEFAULT_USERS_PER_VENUE;
      const currentUsers = currentSims.filter(u => u.venueId === venue.id);
      const currentCount = currentUsers.length;

      if (currentCount < targetCount) {
        // Spawn
        const toSpawn = targetCount - currentCount;
        for (let i = 0; i < toSpawn; i++) {
          const loc = offsetLocation(venue.latitude, venue.longitude, MAX_RADIUS_METERS / 2);
          currentSims.push({
            user_id: `sim_${venue.id}_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
            venueId: venue.id,
            centerLat: venue.latitude,
            centerLon: venue.longitude,
            latitude: loc.latitude,
            longitude: loc.longitude,
            timestamp: Date.now()
          });
        }
      } else if (currentCount > targetCount) {
        // Despawn
        const toRemove = currentCount - targetCount;
        const despawnList = currentUsers.slice(0, toRemove).map(u => u.user_id);
        
        currentSims = currentSims.filter(u => !despawnList.includes(u.user_id));
        despawnList.forEach(uid => {
          updates[uid] = null; // null deletes from RTDB
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
      set(ref(realtimeDB, 'simulated_locations'), null).catch(console.error);
      simulatedUsersRef.current = [];
      return;
    }

    // Initial sync
    syncAllVenueUsers();

    const tick = async () => {
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
