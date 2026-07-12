/**
 * useCreatorStatus — real-time creator gate.
 *
 * Listens to users/{uid} so creator features unlock the moment an admin
 * approves, and — critically — lock the moment an admin revokes. Every
 * creator-only surface must gate on `isCreator` from this hook rather than
 * caching the flag.
 */
import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { firestore } from '../services/firebase';
import { useAppStore } from './useAppStore';
import type { CreatorProfile } from '../services/creatorService';

export interface CreatorStatus {
  loading: boolean;
  isCreator: boolean;
  creatorProfile: CreatorProfile | null;
}

export function useCreatorStatus(): CreatorStatus {
  const user = useAppStore((s) => s.user);
  const [state, setState] = useState<CreatorStatus>({
    loading: true,
    isCreator: false,
    creatorProfile: null,
  });

  useEffect(() => {
    if (!user?.uid) {
      setState({ loading: false, isCreator: false, creatorProfile: null });
      return;
    }
    const unsub = onSnapshot(doc(firestore, 'users', user.uid), (snap) => {
      const data = snap.exists() ? snap.data() : null;
      const isCreator = data?.accountType === 'creator' && data?.creator?.status === 'active';
      setState({
        loading: false,
        isCreator,
        creatorProfile: isCreator ? (data!.creator as CreatorProfile) : null,
      });
    }, () => setState({ loading: false, isCreator: false, creatorProfile: null }));
    return () => unsub();
  }, [user?.uid]);

  return state;
}
