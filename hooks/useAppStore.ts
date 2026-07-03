import { create } from 'zustand';
import { User } from 'firebase/auth';
import { LiveVenue } from './useLiveVenues';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
  hiddenUsers: string[];
  setHiddenUsers: (hiddenUsers: string[]) => void;
  pendingVenueId: string | null;
  setPendingVenueId: (id: string | null) => void;
  pendingVenueAction: 'details' | 'chat' | null;
  setPendingVenueAction: (action: 'details' | 'chat' | null) => void;
  unreadChatCount: number;
  setUnreadChatCount: (count: number) => void;
  lastViewedChats: Record<string, number>;
  setLastViewedChats: (lastViewed: Record<string, number>) => void;
  updateLastViewedChat: (venueId: string) => void;
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
  hiddenUsers: [],
  setHiddenUsers: (hiddenUsers) => set({ hiddenUsers }),
  pendingVenueId: null,
  setPendingVenueId: (pendingVenueId) => set({ pendingVenueId }),
  pendingVenueAction: null,
  setPendingVenueAction: (pendingVenueAction) => set({ pendingVenueAction }),
  unreadChatCount: 0,
  // Bail out when the count is unchanged: this setter is called on a 15s interval
  // and on every chat snapshot, and an unconditional set() re-renders every
  // store subscriber even when nothing changed.
  setUnreadChatCount: (unreadChatCount) =>
    set((state) => (state.unreadChatCount === unreadChatCount ? state : { unreadChatCount })),
  lastViewedChats: {},
  setLastViewedChats: (lastViewedChats) => set({ lastViewedChats }),
  updateLastViewedChat: (venueId) => set((state) => {
    const updated = { ...state.lastViewedChats, [venueId]: Date.now() };
    AsyncStorage.setItem('eventas_chat_last_viewed', JSON.stringify(updated)).catch(err => {
      console.error('Failed to save last viewed chats:', err);
    });
    return { lastViewedChats: updated };
  }),
}));
