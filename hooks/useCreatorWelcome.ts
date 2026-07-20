/**
 * useCreatorWelcome — fires the one-time "you're now a Creator" celebration.
 *
 * Shows the congratulations + walkthrough the first time a user opens the app
 * with an active creator account they haven't been welcomed for yet. The
 * "seen" marker is `users/{uid}.creatorWelcomeSeenAt` (ms epoch) — a field
 * OUTSIDE the admin-guarded `accountType`/`creator` keys, so the owner is
 * allowed to write it (see firestore.rules). Persisting it server-side (rather
 * than in AsyncStorage) means the welcome shows exactly once across devices and
 * reinstalls.
 *
 * Re-approval re-welcomes: `seenAt < approvedAt` is only false once the user
 * has dismissed a welcome newer than their latest approval, so a revoke →
 * re-approve (which bumps `creator.approvedAt`) naturally triggers it again.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { firestore } from '../services/firebase';
import { useAppStore } from './useAppStore';
import type { CreatorProfile } from '../services/creatorService';

export interface CreatorWelcomeState {
  shouldShow: boolean;
  creatorProfile: CreatorProfile | null;
  dismiss: () => void;
}

export function useCreatorWelcome(): CreatorWelcomeState {
  const user = useAppStore((s) => s.user);
  const [shouldShow, setShouldShow] = useState(false);
  const [creatorProfile, setCreatorProfile] = useState<CreatorProfile | null>(null);

  // Guards the window between the local dismiss and the snapshot that reflects
  // the persisted `creatorWelcomeSeenAt`, so the modal can't flash back open.
  const dismissedRef = useRef(false);

  useEffect(() => {
    if (!user?.uid) {
      setShouldShow(false);
      setCreatorProfile(null);
      dismissedRef.current = false;
      return;
    }

    const unsub = onSnapshot(
      doc(firestore, 'users', user.uid),
      (snap) => {
        const data = snap.exists() ? snap.data() : null;
        const isCreator =
          data?.accountType === 'creator' && data?.creator?.status === 'active';

        if (!isCreator) {
          setCreatorProfile(null);
          setShouldShow(false);
          return;
        }

        const profile = data!.creator as CreatorProfile;
        setCreatorProfile(profile);

        const approvedAt = profile.approvedAt ?? 0;
        const seenAt = (data?.creatorWelcomeSeenAt as number) ?? 0;
        setShouldShow(!dismissedRef.current && seenAt < approvedAt);
      },
      () => {
        setShouldShow(false);
        setCreatorProfile(null);
      }
    );
    return () => unsub();
  }, [user?.uid]);

  const dismiss = useCallback(() => {
    dismissedRef.current = true;
    setShouldShow(false);
    if (user?.uid) {
      updateDoc(doc(firestore, 'users', user.uid), {
        creatorWelcomeSeenAt: Date.now(),
      }).catch((err) => {
        // Non-fatal: the modal is already closed for this session; worst case it
        // reappears next launch, which is preferable to blocking the user.
        console.warn('[useCreatorWelcome] failed to persist seen marker:', err);
      });
    }
  }, [user?.uid]);

  return { shouldShow, creatorProfile, dismiss };
}
