import { create } from 'zustand';
import type { CellMode, SaveStatus, BrandFilter } from '../types/review';

export type SortMode = 'brand' | 'recent' | 'confidence' | 'flags';

interface ActiveCell {
  productId: string;
  field: string;
}

interface ReviewState {
  selectedField: string;
  selectedProductId: string;
  activeCell: ActiveCell | null;
  drawerOpen: boolean;
  flaggedCells: ActiveCell[];
  flagIndex: number;

  // Cell mode + inline editing
  cellMode: CellMode;
  editingValue: string;
  originalEditingValue: string;
  saveStatus: SaveStatus;

  // Brand filter
  availableBrands: string[];
  brandFilter: BrandFilter;

  // Sort & filter
  sortMode: SortMode;
  showOnlyFlagged: boolean;

  // Existing actions
  setSelectedField: (field: string) => void;
  setActiveCell: (cell: ActiveCell | null) => void;
  openDrawer: (productId: string, field: string) => void;
  closeDrawer: () => void;
  setFlaggedCells: (cells: ActiveCell[]) => void;
  nextFlagged: () => void;
  prevFlagged: () => void;

  // Cell mode actions
  selectCell: (productId: string, field: string) => void;
  startEditing: (initialValue?: string) => void;
  cancelEditing: () => void;
  setEditingValue: (value: string) => void;
  commitEditing: () => void;
  setSaveStatus: (status: SaveStatus) => void;

  // Brand filter actions
  setAvailableBrands: (brands: string[]) => void;
  setBrandFilterMode: (mode: 'all' | 'none' | 'custom') => void;
  toggleBrand: (brand: string) => void;

  // Sort & filter actions
  setSortMode: (mode: SortMode) => void;
  setShowOnlyFlagged: (value: boolean) => void;
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  selectedField: '',
  selectedProductId: '',
  activeCell: null,
  drawerOpen: false,
  flaggedCells: [],
  flagIndex: -1,

  cellMode: 'viewing',
  editingValue: '',
  originalEditingValue: '',
  saveStatus: 'idle',

  availableBrands: [],
  brandFilter: { mode: 'all', selected: new Set<string>() },

  sortMode: 'brand',
  showOnlyFlagged: false,

  setSelectedField: (field) => set({ selectedField: field }),
  setActiveCell: (cell) => set({ activeCell: cell, selectedField: cell?.field ?? '', selectedProductId: cell?.productId ?? '' }),
  openDrawer: (productId, field) => {
    set({
      activeCell: { productId, field },
      selectedField: field,
      selectedProductId: productId,
      drawerOpen: true,
    });
  },
  closeDrawer: () => set({ drawerOpen: false }),
  setFlaggedCells: (cells) => set({ flaggedCells: cells, flagIndex: cells.length > 0 ? 0 : -1 }),
  nextFlagged: () => {
    const { flaggedCells, flagIndex } = get();
    if (flaggedCells.length === 0) return;
    const next = (flagIndex + 1) % flaggedCells.length;
    const cell = flaggedCells[next];
    set({ flagIndex: next, activeCell: cell, selectedField: cell.field, selectedProductId: cell.productId, drawerOpen: true });
  },
  prevFlagged: () => {
    const { flaggedCells, flagIndex } = get();
    if (flaggedCells.length === 0) return;
    const prev = (flagIndex - 1 + flaggedCells.length) % flaggedCells.length;
    const cell = flaggedCells[prev];
    set({ flagIndex: prev, activeCell: cell, selectedField: cell.field, selectedProductId: cell.productId, drawerOpen: true });
  },

  // Cell mode actions
  selectCell: (productId, field) => {
    set({
      activeCell: { productId, field },
      selectedField: field,
      selectedProductId: productId,
      cellMode: 'selected',
      editingValue: '',
      originalEditingValue: '',
    });
  },
  startEditing: (initialValue = '') => {
    // NOTE: does NOT touch drawerOpen — drawer stays open if it was open
    set({
      cellMode: 'editing',
      editingValue: initialValue,
      originalEditingValue: initialValue,
      saveStatus: 'idle',
    });
  },
  cancelEditing: () => {
    set({ cellMode: 'selected', editingValue: '', originalEditingValue: '', saveStatus: 'idle' });
  },
  setEditingValue: (value) => {
    const { originalEditingValue } = get();
    // Only mark unsaved if value actually changed from original
    if (value !== originalEditingValue) {
      set({ editingValue: value, saveStatus: 'unsaved' });
    } else {
      set({ editingValue: value, saveStatus: 'idle' });
    }
  },
  commitEditing: () => {
    set({ cellMode: 'viewing', saveStatus: 'idle' });
  },
  setSaveStatus: (status) => set({ saveStatus: status }),

  // Brand filter actions
  setAvailableBrands: (brands) => set({ availableBrands: brands }),
  setBrandFilterMode: (mode) => {
    const { availableBrands } = get();
    if (mode === 'all') {
      set({ brandFilter: { mode: 'all', selected: new Set(availableBrands) } });
    } else if (mode === 'none') {
      set({ brandFilter: { mode: 'none', selected: new Set<string>() } });
    } else {
      // custom — keep current selection
      set((state) => ({ brandFilter: { ...state.brandFilter, mode: 'custom' } }));
    }
  },
  toggleBrand: (brand) => {
    const { brandFilter, availableBrands } = get();
    const next = new Set(brandFilter.selected);
    if (next.has(brand)) {
      next.delete(brand);
    } else {
      next.add(brand);
    }
    // Determine mode: if all selected → 'all', none → 'none', else → 'custom'
    const mode = next.size === 0 ? 'none' : next.size === availableBrands.length ? 'all' : 'custom';
    set({ brandFilter: { mode, selected: next } });
  },

  // Sort & filter actions
  setSortMode: (mode) => set({ sortMode: mode }),
  setShowOnlyFlagged: (value) => set({ showOnlyFlagged: value }),
}));
