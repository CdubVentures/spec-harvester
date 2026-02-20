import { create } from 'zustand';

interface StudioState {
  activeSubTab: string;
  setActiveSubTab: (tab: string) => void;
}

export const useStudioStore = create<StudioState>((set) => ({
  activeSubTab: 'mapping',
  setActiveSubTab: (activeSubTab) => set({ activeSubTab }),
}));
