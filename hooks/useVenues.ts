import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { firestore } from '../services/firebase';

// ─── Type ─────────────────────────────────────────────────────────────────────
export interface Venue {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  description: string;
  simulatedUsersCount?: number;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export const useVenues = () => {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(firestore, 'venues'), orderBy('name'));

    // Real-time listener — auto-updates if venues are added/edited in Firestore
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data: Venue[] = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...(doc.data() as Omit<Venue, 'id'>),
        }));
        setVenues(data);
        setIsLoading(false);
      },
      (err) => {
        console.error('[useVenues] Firestore error:', err);
        setError(err.message);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  return { venues, isLoading, error };
};
