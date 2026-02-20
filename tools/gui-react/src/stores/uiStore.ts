import { create } from 'zustand';

interface UiState {
  category: string;
  categories: string[];
  darkMode: boolean;
  devMode: boolean;
  setCategory: (cat: string) => void;
  setCategories: (cats: string[]) => void;
  toggleDarkMode: () => void;
  toggleDevMode: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  category: 'mouse',
  categories: [],
  darkMode: false,
  devMode: false,
  setCategory: (category) => set({ category }),
  setCategories: (categories) => set({ categories }),
  toggleDarkMode: () =>
    set((s) => {
      const next = !s.darkMode;
      document.documentElement.classList.toggle('dark', next);
      return { darkMode: next };
    }),
  toggleDevMode: () => set((s) => ({ devMode: !s.devMode })),
}));
