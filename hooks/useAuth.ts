import { useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, firestore } from '../services/firebase';
import { clearUsernameCache, subscribeUsername } from '../services/userService';
import { useAppStore } from './useAppStore';

/**
 * The parts of the user document the app routes on. Mirrored to AsyncStorage so
 * a launch with no network can restore the session to where the user left it.
 */
type CachedProfile = {
  isAdmin: boolean;
  hasAgreedToTerms: boolean;
  hiddenUsers: string[];
};

const EMPTY_PROFILE: CachedProfile = {
  isAdmin: false,
  hasAgreedToTerms: false,
  hiddenUsers: [],
};

const profileCacheKey = (uid: string) => `eventas_profile_${uid}`;

export const useAuth = () => {
  // Setters are stable references in zustand — selecting them individually
  // means this hook never re-renders its host (App) on store changes.
  const setUser = useAppStore((s) => s.setUser);
  const setIsLoading = useAppStore((s) => s.setIsLoading);
  const setIsAdmin = useAppStore((s) => s.setIsAdmin);
  const setHasAgreedToTerms = useAppStore((s) => s.setHasAgreedToTerms);
  const setHiddenUsers = useAppStore((s) => s.setHiddenUsers);

  useEffect(() => {
    let cancelled = false;
    let unsubProfile: (() => void) | null = null;
    let lastUid: string | null = null;
    let unsubOwnName: (() => void) | null = null;

    const stopProfileListener = () => {
      if (unsubOwnName) {
        unsubOwnName();
        unsubOwnName = null;
      }
      if (!unsubProfile) return;
      unsubProfile();
      unsubProfile = null;
    };

    const applyProfile = (p: CachedProfile) => {
      setIsAdmin(p.isAdmin);
      setHasAgreedToTerms(p.hasAgreedToTerms);
      setHiddenUsers(p.hiddenUsers);
    };

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      stopProfileListener();

      if (!user) {
        // A real sign-out. Drop the mirrored profile so the next person on this
        // device can't inherit the last one's flags or hidden-user list.
        if (lastUid) {
          AsyncStorage.removeItem(profileCacheKey(lastUid)).catch(() => {});
          lastUid = null;
        }
        // Usernames are cached process-wide and keyed by uid, so without this
        // the next account signed in on the device starts out reading the
        // previous one's names.
        clearUsernameCache();
        setUser(null);
        applyProfile(EMPTY_PROFILE);
        setIsLoading(false);
        return;
      }

      lastUid = user.uid;

      // Hold one listener on the signed-in user's own name for the life of the
      // session. It keeps the shared username registry warm — so a message can
      // be stamped with the right name without a round trip — and, because the
      // registry is what every screen renders from, a rename made on another
      // device is reflected here the moment it lands. No sign-out, no restart.
      unsubOwnName = subscribeUsername(user.uid, () => {});

      // The session comes back from AsyncStorage persistence and is valid with
      // or without a network, so commit it BEFORE anything that can fail.
      //
      // This used to be followed by an awaited getDoc whose catch called
      // setUser(null) — so launching with no connection signed the user out
      // over a failed profile read, dropped them on Login, and left them there:
      // Firebase's auth state never actually changed, so onAuthStateChanged had
      // no reason to fire again when the network returned and only a full
      // restart recovered the session.
      setUser(user);

      // Last known profile first, so an offline launch routes to the app the
      // user left rather than to the terms gate that `false` defaults imply.
      try {
        const raw = await AsyncStorage.getItem(profileCacheKey(user.uid));
        if (cancelled) return;
        if (raw) applyProfile(JSON.parse(raw) as CachedProfile);
      } catch (e) {
        console.warn('[useAuth] Could not read cached profile:', e);
      }
      if (cancelled) return;

      // Booting is over either way — nothing below this line blocks the UI.
      setIsLoading(false);

      // A listener rather than a one-shot read: it serves the cached document
      // immediately, keeps the app correct while the connection is down, and
      // delivers the server copy by itself the moment data comes back. That is
      // what makes the app self-correct on reconnect instead of needing a
      // restart — no connectivity polling and no extra dependency.
      unsubProfile = onSnapshot(
        doc(firestore, 'users', user.uid),
        (snap) => {
          // Only a server-confirmed snapshot is authoritative. A cache-sourced
          // one — offline, or simply before the first round trip lands — must
          // never downgrade the profile we restored from disk. Letting it
          // through reset hasAgreedToTerms and bounced a signed-in user to the
          // terms gate every time they opened the app without a connection.
          if (snap.metadata.fromCache) return;

          const data = snap.exists() ? snap.data() : null;
          const profile: CachedProfile = {
            isAdmin: data?.isAdmin === true,
            hasAgreedToTerms: data?.agreedToTerms === true,
            hiddenUsers: data?.hiddenUsers ?? [],
          };
          applyProfile(profile);
          AsyncStorage.setItem(profileCacheKey(user.uid), JSON.stringify(profile)).catch(() => {});
        },
        (error) => {
          // Keep the session and whatever profile we already have. A profile
          // read failing is a data problem, never a reason to sign someone out;
          // if the account is genuinely gone Firebase fails the token refresh
          // and onAuthStateChanged fires with null on its own.
          console.warn('[useAuth] User profile listener error:', error);
        }
      );
    });

    return () => {
      cancelled = true;
      stopProfileListener();
      unsubscribe();
    };
  }, [setUser, setIsLoading, setIsAdmin, setHasAgreedToTerms, setHiddenUsers]);
};
