import { useEffect, useRef } from 'react';
import { ref, onValue, query, limitToLast } from 'firebase/database';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { realtimeDB } from '../services/firebase';
import { useAppStore } from './useAppStore';
import { useLiveVenues } from './useLiveVenues';

export const useUnreadChatListener = () => {
  const { user, lastViewedChats, setLastViewedChats, setUnreadChatCount } = useAppStore();
  const { venues } = useLiveVenues();

  const latestMessagesRef = useRef<Record<string, { timestamp: number; userId: string }>>({});
  const lastViewedRef = useRef<Record<string, number>>(lastViewedChats);
  const userRef = useRef(user);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Load last viewed chats from storage on mount/auth change
  useEffect(() => {
    if (!user) {
      setLastViewedChats({});
      setUnreadChatCount(0);
      return;
    }

    const loadLastViewed = async () => {
      try {
        const stored = await AsyncStorage.getItem('eventas_chat_last_viewed');
        if (stored) {
          setLastViewedChats(JSON.parse(stored));
        } else {
          setLastViewedChats({});
        }
      } catch (err) {
        console.warn('[useUnreadChatListener] Error loading last viewed:', err);
      }
    };

    loadLastViewed();
  }, [user, setLastViewedChats, setUnreadChatCount]);

  // Keep lastViewedRef updated and trigger recalculation when store updates
  useEffect(() => {
    lastViewedRef.current = lastViewedChats;
    recalculateCount();
  }, [lastViewedChats]);

  const recalculateCount = () => {
    let count = 0;
    const now = Date.now();
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

    for (const venueId in latestMessagesRef.current) {
      const msg = latestMessagesRef.current[venueId];
      if (!msg) continue;

      const lastViewed = lastViewedRef.current[venueId] || 0;
      const isWithin24Hours = msg.timestamp > twentyFourHoursAgo;
      const isNotMe = msg.userId !== userRef.current?.uid;
      const isUnread = msg.timestamp > lastViewed;

      if (isWithin24Hours && isNotMe && isUnread) {
        count++;
      }
    }

    setUnreadChatCount(count);
  };

  // Subscribe to latest messages for each active venue
  useEffect(() => {
    if (!user || venues.length === 0) {
      latestMessagesRef.current = {};
      setUnreadChatCount(0);
      return;
    }

    // Prune stored messages for venues that are no longer active/loaded
    const activeVenueIds = new Set(venues.map(v => v.id));
    Object.keys(latestMessagesRef.current).forEach(id => {
      if (!activeVenueIds.has(id)) {
        delete latestMessagesRef.current[id];
      }
    });

    const unsubscribes: Record<string, () => void> = {};

    venues.forEach((venue) => {
      const chatQuery = query(
        ref(realtimeDB, `venue_chats/${venue.id}`),
        limitToLast(1)
      );

      const unsub = onValue(chatQuery, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.val();
          const keys = Object.keys(data);
          if (keys.length > 0) {
            const key = keys[0];
            const msg = data[key];
            latestMessagesRef.current[venue.id] = {
              timestamp: msg.timestamp,
              userId: msg.user_id,
            };
          } else {
            delete latestMessagesRef.current[venue.id];
          }
        } else {
          delete latestMessagesRef.current[venue.id];
        }
        recalculateCount();
      }, (error) => {
        console.warn(`[useUnreadChatListener] Error listening to ${venue.id}:`, error);
      });

      unsubscribes[venue.id] = unsub;
    });

    // Run initial calculation
    recalculateCount();

    return () => {
      Object.values(unsubscribes).forEach((unsub) => unsub());
    };
  }, [venues, user, setUnreadChatCount]);

  // Periodic pruning of expired messages (> 24 hours old)
  useEffect(() => {
    if (!user) return;

    const interval = setInterval(() => {
      recalculateCount();
    }, 15000); // Check every 15 seconds

    return () => clearInterval(interval);
  }, [user]);
};
