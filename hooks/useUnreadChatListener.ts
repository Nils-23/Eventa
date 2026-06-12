import { useEffect, useRef } from 'react';
import { ref, query, limitToLast } from 'firebase/database';
import { subscribeToRTDB } from '../utils/firebaseUtils';
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
  const subscriptionsRef = useRef<Record<string, () => void>>({});

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

  // Clean up all subscriptions on user log out or unmount
  useEffect(() => {
    return () => {
      Object.values(subscriptionsRef.current).forEach((unsub) => unsub());
      subscriptionsRef.current = {};
      latestMessagesRef.current = {};
      setUnreadChatCount(0);
    };
  }, [user, setUnreadChatCount]);

  // Subscribe to latest messages for each active venue incrementally
  useEffect(() => {
    if (!user || venues.length === 0) {
      Object.values(subscriptionsRef.current).forEach((unsub) => unsub());
      subscriptionsRef.current = {};
      latestMessagesRef.current = {};
      setUnreadChatCount(0);
      return;
    }

    const activeVenueIds = new Set(venues.map(v => v.id));

    // 1. Unsubscribe from venues that are no longer active/loaded
    Object.keys(subscriptionsRef.current).forEach((id) => {
      if (!activeVenueIds.has(id)) {
        subscriptionsRef.current[id]();
        delete subscriptionsRef.current[id];
        delete latestMessagesRef.current[id];
      }
    });

    // 2. Subscribe to new active venues
    venues.forEach((venue) => {
      if (!subscriptionsRef.current[venue.id]) {
        const chatQuery = query(
          ref(realtimeDB, `venue_chats/${venue.id}`),
          limitToLast(1)
        );

        const unsub = subscribeToRTDB(chatQuery, (snapshot) => {
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

        subscriptionsRef.current[venue.id] = unsub;
      }
    });

    recalculateCount();
  }, [venues, user]);

  // Periodic pruning of expired messages (> 24 hours old)
  useEffect(() => {
    if (!user) return;

    const interval = setInterval(() => {
      recalculateCount();
    }, 15000); // Check every 15 seconds

    return () => clearInterval(interval);
  }, [user]);
};
