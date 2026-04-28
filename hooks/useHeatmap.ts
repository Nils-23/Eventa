import { useEffect, useState, useRef } from 'react';
import { ref, onValue } from 'firebase/database';
import { doc, onSnapshot } from 'firebase/firestore';
import { realtimeDB, firestore } from '../services/firebase';

export interface HeatPoint {
  latitude: number;
  longitude: number;
  weight: number;
}

interface RawLocation {
  latitude: number;
  longitude: number;
  timestamp: number;
  user_id: string;
}

interface SimulationConfig {
  enabled: boolean;
  threshold: number;
}

const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // ignore users inactive > 2 hours
const REFRESH_RATE_MS = 15000; // Frame-pace map rendering to 15 seconds

export const useHeatmap = () => {
  const [heatPoints, setHeatPoints] = useState<HeatPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Shadow buffer caches intense realtime DB firing implicitly
  const latestRawBuffer = useRef<Record<string, RawLocation>>({});
  const latestSimulatedBuffer = useRef<Record<string, RawLocation>>({});
  const initialLoadTriggered = useRef(false);

  const simulationConfig = useRef<SimulationConfig>({ enabled: false, threshold: 50 });

  const processBuffer = () => {
    const now = Date.now();
    const freshPoints: HeatPoint[] = [];
    
    // Process real users
    let realUserCount = 0;
    for (const entry of Object.values(latestRawBuffer.current)) {
      if (!entry.latitude || !entry.longitude) continue;
      if (now - entry.timestamp > STALE_THRESHOLD_MS) continue;
      
      realUserCount++;
      freshPoints.push({
        latitude: entry.latitude,
        longitude: entry.longitude,
        weight: 1 
      });
    }
    
    // Process simulated users if active and below threshold
    if (simulationConfig.current.enabled && realUserCount < simulationConfig.current.threshold) {
      for (const entry of Object.values(latestSimulatedBuffer.current)) {
        if (!entry.latitude || !entry.longitude) continue;
        if (now - entry.timestamp > STALE_THRESHOLD_MS) continue;
        
        freshPoints.push({
          latitude: entry.latitude,
          longitude: entry.longitude,
          weight: 1 
        });
      }
    }
    
    setHeatPoints(freshPoints);
  };

  useEffect(() => {
    // 1. Listen to config
    const configUnsubscribe = onSnapshot(doc(firestore, 'settings', 'simulation'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        simulationConfig.current = {
          enabled: data.enabled ?? false,
          threshold: data.threshold ?? 50
        };
        processBuffer();
      }
    });

    // 2. Listen to real locations
    const locationsRef = ref(realtimeDB, 'locations');
    const locUnsubscribe = onValue(
      locationsRef,
      (snapshot) => {
        setIsLoading(false);
        if (snapshot.exists()) {
          latestRawBuffer.current = snapshot.val();
        } else {
          latestRawBuffer.current = {};
        }
        
        if (!initialLoadTriggered.current) {
           initialLoadTriggered.current = true;
           processBuffer();
        }
      },
      (error) => {
        console.error('[useHeatmap] Firebase error:', error);
        setIsLoading(false);
      }
    );

    // 3. Listen to simulated locations
    const simLocationsRef = ref(realtimeDB, 'simulated_locations');
    const simUnsubscribe = onValue(
      simLocationsRef,
      (snapshot) => {
        if (snapshot.exists()) {
          latestSimulatedBuffer.current = snapshot.val();
        } else {
          latestSimulatedBuffer.current = {};
        }
        processBuffer(); // Trigger update immediately when data arrives
      },
      (error) => {
        console.error('[useHeatmap] Simulated locations error:', error);
      }
    );

    // Frame-lock rendering algorithm (No lag allowed on main UI thread)
    const timer = setInterval(() => {
      processBuffer();
    }, REFRESH_RATE_MS);

    return () => {
      configUnsubscribe();
      locUnsubscribe();
      simUnsubscribe();
      clearInterval(timer);
    };
  }, []);

  return { heatPoints, isLoading };
};
