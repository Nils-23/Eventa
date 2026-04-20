import { create } from 'zustand';

interface AppState {
  hasInitialized: boolean;
  setInitialized: (value: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  hasInitialized: false,
  setInitialized: (value) => set({ hasInitialized: value }),
}));
