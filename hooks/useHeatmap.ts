import { useEffect, useState, useRef } from 'react';
import { ref, onValue } from 'firebase/database';
import { realtimeDB } from '../services/firebase';

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

const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // ignore users inactive > 2 hours
const REFRESH_RATE_MS = 15000; // Frame-pace map rendering to 15 seconds

export const useHeatmap = () => {
  const [heatPoints, setHeatPoints] = useState<HeatPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Shadow buffer caches intense realtime DB firing implicitly
  const latestRawBuffer = useRef<Record<string, RawLocation> | null>(null);
  const initialLoadTriggered = useRef(false);

  const processBuffer = () => {
    if (latestRawBuffer.current) {
      const now = Date.now();
      const freshPoints: HeatPoint[] = [];

      for (const entry of Object.values(latestRawBuffer.current)) {
        if (!entry.latitude || !entry.longitude) continue;
        if (now - entry.timestamp > STALE_THRESHOLD_MS) continue;
        
        freshPoints.push({
          latitude: entry.latitude,
          longitude: entry.longitude,
          weight: 1 
        });
      }
      
      setHeatPoints(freshPoints);
    }
  };

  useEffect(() => {
    const locationsRef = ref(realtimeDB, 'locations');

    const unsubscribe = onValue(
      locationsRef,
      (snapshot) => {
        setIsLoading(false);
        if (!snapshot.exists()) {
          latestRawBuffer.current = {};
          return;
        }
        
        latestRawBuffer.current = snapshot.val() as Record<string, RawLocation>;
        
        // Execute the very first frame immediately to avoid a 15-second loading wait
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

    // Frame-lock rendering algorithm (No lag allowed on main UI thread)
    const timer = setInterval(() => {
      processBuffer();
    }, REFRESH_RATE_MS);

    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, []);

  return { heatPoints, isLoading };
};
