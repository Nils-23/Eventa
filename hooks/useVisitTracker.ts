import { useEffect, useRef } from 'react';
import { doc, getDoc, updateDoc, arrayUnion, setDoc, increment } from 'firebase/firestore';
import { firestore } from '../services/firebase';
import { useAppStore } from './useAppStore';
import { useLiveVenues } from './useLiveVenues';
import { checkAndUnlockAchievements } from '../services/achievementService';
import { getMonthlyPointsKey } from '../services/userService';

export const useVisitTracker = () => {
  const { user } = useAppStore();
  const { venues } = useLiveVenues();
  
  // We use refs to avoid triggering unnecessary effect runs and spamming Firestore
  const trackedDailyVenuesRef = useRef<Set<string>>(new Set());

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
        
        // If doc doesn't exist, create it
        if (!data) {
          await setDoc(userDocRef, { attendedVenues: [], dailyVenueVisits: [], points: 0 }, { merge: true });
          data = { attendedVenues: [], dailyVenueVisits: [], points: 0 };
        }
        
        let needsUpdate = false;
        const updates: any = {};
        let pointsEarned = 0;
        let isFirstVenueEver = (data.attendedVenues || []).length === 0;
        
        const dailyVenueVisits: string[] = data.dailyVenueVisits || [];
        // Add to our local set
        dailyVenueVisits.forEach(v => trackedDailyVenuesRef.current.add(v));
        
        const attendedVenues: string[] = data.attendedVenues || [];
        const newVenues: string[] = [];
        
        for (const venue of nearbyVenues) {
          const dailyKey = `${todayStr}_${venue.id}`;
          if (!trackedDailyVenuesRef.current.has(dailyKey)) {
            updates.dailyVenueVisits = updates.dailyVenueVisits || arrayUnion();
            // Just tracking locally, will use arrayUnion later
            trackedDailyVenuesRef.current.add(dailyKey);
            pointsEarned += 10;
            needsUpdate = true;
          }
          if (!attendedVenues.includes(venue.id)) {
            newVenues.push(venue.id);
            needsUpdate = true;
          }
        }
        
        if (needsUpdate) {
          const monthlyKey = getMonthlyPointsKey();
          // Prepare actual daily visits strings to union
          const newDailyKeys = nearbyVenues.map(v => `${todayStr}_${v.id}`).filter(k => !dailyVenueVisits.includes(k));
          if (newDailyKeys.length > 0) {
            updates.dailyVenueVisits = arrayUnion(...newDailyKeys);
          }
          if (newVenues.length > 0) {
            updates.attendedVenues = arrayUnion(...newVenues);
          }
          if (pointsEarned > 0) {
            updates.points = increment(pointsEarned);
            updates[monthlyKey] = increment(pointsEarned);
          }
          
          if (isFirstVenueEver && newVenues.length > 0 && !data.hasAttendedFirstVenue) {
            updates.hasAttendedFirstVenue = true;
            if (data.referredBy) {
              // Award 20 points to the referrer
              const referrerDocRef = doc(firestore, 'users', data.referredBy);
              try {
                const referrerSnap = await getDoc(referrerDocRef);
                if (referrerSnap.exists()) {
                  const referrerUpdates: any = {
                    points: increment(20),
                    [monthlyKey]: increment(20),
                  };
                  await updateDoc(referrerDocRef, referrerUpdates);
                }
              } catch (referrerErr) {
                console.error('[useVisitTracker] Failed to award referrer points:', referrerErr);
              }
            }
          }

          await updateDoc(userDocRef, updates);
          
          // Check for achievements based on updated visits
          await checkAndUnlockAchievements(user.uid);
        }
        
      } catch (err) {
        console.error('[useVisitTracker] Failed to update visit stats:', err);
      }
    };

    checkVisits();
  }, [venues, user]); // Run when venues/location changes
};
