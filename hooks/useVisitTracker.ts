import { useEffect, useRef } from 'react';
import { doc, getDoc, updateDoc, arrayUnion, setDoc, increment } from 'firebase/firestore';
import { firestore } from '../services/firebase';
import { useAppStore } from './useAppStore';
import { useLiveVenues } from './useLiveVenues';
import { checkAndUnlockAchievements } from '../services/achievementService';
import { getMonthlyPointsKey } from '../services/userService';
import { verifyAttendanceAtVenues } from '../services/creatorService';

/**
 * A queryable record of one user being at one venue on one Nairobi day.
 *
 * Deliberately fire-and-forget: the visit's points and achievements are already
 * being written by the caller, and a failed ledger row should never cost the
 * user those. It reconciles on the next visit.
 */
function writeVisitRecord(userId: string, venueId: string, venueName: string, dayKey: string) {
  const visitId = `${userId}_${dayKey}_${venueId}`;
  setDoc(
    doc(firestore, 'visits', visitId),
    {
      userId,
      venueId,
      venueName: venueName || '',
      // The key already encodes the Nairobi day; visitedAt keeps the ordering
      // exact so "most recent visit" needs no string parsing.
      dayKey,
      visitedAt: Date.now(),
      reviewPrompted: false,
    },
    { merge: true }
  ).catch((err) => console.warn('[useVisitTracker] Failed to write visit record:', err));
}

export const useVisitTracker = () => {
  const user = useAppStore((s) => s.user);
  const { venues } = useLiveVenues();
  
  // We use refs to avoid triggering unnecessary effect runs and spamming Firestore
  const trackedDailyVenuesRef = useRef<Set<string>>(new Set());
  // Ledger rows already written this session, so a venue the user is sitting in
  // is not re-written on every location tick.
  const visitRecordsWrittenRef = useRef<Set<string>>(new Set());
  const isCheckingRef = useRef<boolean>(false);

  useEffect(() => {
    if (!user) return;

    const checkVisits = async () => {
      // Find venues where the user is currently within 200m
      const nearbyVenues = venues.filter(v => v.distanceKm !== null && v.distanceKm <= 0.2);
      
      if (nearbyVenues.length === 0) return;

      // Nairobi day, not UTC: a visit at 01:00 local is still "last night" to the
      // user, and a UTC key files it under the previous date. Same 'en-CA' /
      // Africa/Nairobi formatting the rest of the app uses for day keys.
      const todayStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Nairobi',
      }).format(new Date()); // e.g. "2026-04-30"

      // Nothing left to award AND every nearby venue already has its ledger row.
      // The ledger has to be part of this test: points are once-per-day, but a
      // user whose points were already banked (earlier today, or by a build that
      // predates the ledger) still needs the visit row or they cannot rate the
      // room they are standing in.
      const allAlreadyTracked = nearbyVenues.every(
        (v) =>
          trackedDailyVenuesRef.current.has(`${todayStr}_${v.id}`) &&
          visitRecordsWrittenRef.current.has(`${todayStr}_${v.id}`)
      );
      if (allAlreadyTracked) return;

      if (isCheckingRef.current) return;
      isCheckingRef.current = true;
      
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

          // Ledger row, written for every nearby venue rather than only when
          // points are owed. The array above cannot answer "was this user here
          // in the last 14 days" without loading every user document, and that
          // question is the review gate: someone standing in a venue can rate it
          // from that moment, so the row has to exist as soon as they arrive —
          // including on a second walk-in the same day, when the points for it
          // were banked hours ago. The doc id is derived, so this is idempotent;
          // the session ref just keeps it to one write per venue per session
          // instead of one per location tick.
          if (!visitRecordsWrittenRef.current.has(dailyKey)) {
            visitRecordsWrittenRef.current.add(dailyKey);
            writeVisitRecord(user.uid, venue.id, venue.name, todayStr);
          }

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
            // NOTE: Referral rewards are no longer granted here. The referrer is now
            // credited 20 points server-side at signup (functions/onUserCreated),
            // which fires on account creation and bypasses the client-only Firestore
            // rule that forbids writing to another user's document.
          }

          await updateDoc(userDocRef, updates);

          // Check for achievements based on updated visits
          await checkAndUnlockAchievements(user.uid);
        }

        // Creator Program: the same 200m geofence check-in verifies any
        // "I'm Going" declarations for the venues the user is physically at.
        // No-op for users with no declared attendance.
        await verifyAttendanceAtVenues(user.uid, nearbyVenues.map((v) => v.id));
        
      } catch (err) {
        console.warn('[useVisitTracker] Failed to update visit stats:', err);
      } finally {
        isCheckingRef.current = false;
      }
    };

    checkVisits();
  }, [venues, user]); // Run when venues/location changes
};
