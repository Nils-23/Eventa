import { useEffect, useRef } from 'react';
import { doc, getDoc, updateDoc, arrayUnion, setDoc } from 'firebase/firestore';
import { firestore } from '../services/firebase';
import { useAppStore } from './useAppStore';
import { useLiveVenues } from './useLiveVenues';
import { checkAndUnlockAchievements } from '../services/achievementService';

export const useVisitTracker = () => {
  const { user } = useAppStore();
  const { venues } = useLiveVenues();
  
  // We use refs to avoid triggering unnecessary effect runs and spamming Firestore
  const hasTrackedToday = useRef(false);
  const trackedVenuesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;

    const checkVisits = async () => {
      // Find venues where the user is currently within 200m
      const nearbyVenues = venues.filter(v => v.distanceKm !== null && v.distanceKm <= 0.2);
      
      if (nearbyVenues.length === 0) return;

      const todayStr = new Date().toISOString().split('T')[0]; // e.g. "2026-04-30"
      
      const userDocRef = doc(firestore, 'users', user.uid);
      
      try {
        const docSnap = await getDoc(userDocRef);
        let data = docSnap.exists() ? docSnap.data() : null;
        
        // If doc doesn't exist, create it (should exist from registration, but just in case)
        if (!data) {
          await setDoc(userDocRef, { attendedVenues: [], activeNights: [] }, { merge: true });
          data = { attendedVenues: [], activeNights: [] };
        }
        
        let needsUpdate = false;
        const updates: any = {};
        
        // Check active nights (Hotstreaks)
        const activeNights: string[] = data.activeNights || [];
        if (!activeNights.includes(todayStr) && !hasTrackedToday.current) {
          updates.activeNights = arrayUnion(todayStr);
          needsUpdate = true;
          hasTrackedToday.current = true;
        } else if (activeNights.includes(todayStr)) {
          hasTrackedToday.current = true; // Already tracked today
        }
        
        // Check attended venues
        const attendedVenues: string[] = data.attendedVenues || [];
        // Add to our local set to avoid checking Firestore again
        attendedVenues.forEach(v => trackedVenuesRef.current.add(v));
        
        for (const venue of nearbyVenues) {
          if (!trackedVenuesRef.current.has(venue.id)) {
            if (!updates.attendedVenues) updates.attendedVenues = arrayUnion(venue.id);
            // If there's already an arrayUnion, we should combine them or just let Firebase handle multiple updates? 
            // arrayUnion takes multiple arguments! arrayUnion(...newVenues)
            trackedVenuesRef.current.add(venue.id);
            needsUpdate = true;
          }
        }
        
        if (needsUpdate) {
          // Fix for arrayUnion with multiple venues
          const newVenues = nearbyVenues.map(v => v.id).filter(id => !attendedVenues.includes(id));
          if (newVenues.length > 0) {
              updates.attendedVenues = arrayUnion(...newVenues);
          }
          await updateDoc(userDocRef, updates);
          
          // Check for achievements based on updated visits/nights
          await checkAndUnlockAchievements(user.uid);
        }
        
      } catch (err) {
        console.error('[useVisitTracker] Failed to update visit stats:', err);
      }
    };

    checkVisits();
  }, [venues, user]); // Run when venues/location changes
};
