import { create } from 'zustand';
import { User } from 'firebase/auth';
import { LiveVenue } from './useLiveVenues';

interface AppState {
  hasInitialized: boolean;
  setInitialized: (value: boolean) => void;
  user: User | null;
  setUser: (user: User | null) => void;
  isLoading: boolean;
  setIsLoading: (isLoading: boolean) => void;
  selectedMapVenue: LiveVenue | null;
  setSelectedMapVenue: (venue: LiveVenue | null) => void;
  isAdmin: boolean;
  setIsAdmin: (isAdmin: boolean) => void;
  isSimulationRunning: boolean;
  setIsSimulationRunning: (isRunning: boolean) => void;
  hasAgreedToTerms: boolean;
  setHasAgreedToTerms: (value: boolean) => void;
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
  isAdmin: false,
  setIsAdmin: (isAdmin) => set({ isAdmin }),
  isSimulationRunning: true,
  setIsSimulationRunning: (isSimulationRunning) => set({ isSimulationRunning }),
  hasAgreedToTerms: false,
  setHasAgreedToTerms: (hasAgreedToTerms) => set({ hasAgreedToTerms }),
}));
