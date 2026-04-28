import { create } from 'zustand';
import { User } from 'firebase/auth';
import { Venue } from './useVenues';

interface AppState {
  hasInitialized: boolean;
  setInitialized: (value: boolean) => void;
  user: User | null;
  setUser: (user: User | null) => void;
  isLoading: boolean;
  setIsLoading: (isLoading: boolean) => void;
  selectedMapVenue: Venue | null;
  setSelectedMapVenue: (venue: Venue | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  hasInitialized: false,
  setInitialized: (value) => set({ hasInitialized: value }),
  user: null,
  setUser: (user) => set({ user }),
  isLoading: true,
  setIsLoading: (isLoading) => set({ isLoading }),
  selectedMapVenue: null,
  setSelectedMapVenue: (venue) => set({ selectedMapVenue: venue }),
}));
