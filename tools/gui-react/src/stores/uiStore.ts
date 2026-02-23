import { create } from 'zustand';

interface UiState {
  category: string;
  categories: string[];
  darkMode: boolean;
  devMode: boolean;
  autoSaveEnabled: boolean;
  autoSaveMapEnabled: boolean;
  setCategory: (cat: string) => void;
  setCategories: (cats: string[]) => void;
  toggleDarkMode: () => void;
  toggleDevMode: () => void;
  setAutoSaveEnabled: (v: boolean) => void;
  setAutoSaveMapEnabled: (v: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  category: 'mouse',
  categories: [],
  darkMode: false,
  devMode: false,
  autoSaveEnabled: typeof localStorage !== 'undefined' && localStorage.getItem('autoSaveEnabled') === 'true',
  autoSaveMapEnabled: typeof localStorage === 'undefined' || localStorage.getItem('autoSaveMapEnabled') !== 'false',
  setCategory: (category) => set({ category }),
  setCategories: (categories) => set({ categories }),
  toggleDarkMode: () =>
    set((s) => {
      const next = !s.darkMode;
      document.documentElement.classList.toggle('dark', next);
      return { darkMode: next };
    }),
  toggleDevMode: () => set((s) => ({ devMode: !s.devMode })),
  setAutoSaveEnabled: (v) => {
    localStorage.setItem('autoSaveEnabled', String(v));
    set({ autoSaveEnabled: v });
  },
  setAutoSaveMapEnabled: (v) => {
    localStorage.setItem('autoSaveMapEnabled', String(v));
    set({ autoSaveMapEnabled: v });
  },
}));
