import { create } from 'zustand';

interface SelectedEntity {
  type: string;
  name: string;
  maker: string;
  rowIndex?: number;
}

interface FlaggedItem {
  type: string;
  name: string;
  maker: string;
  property?: string;
}

interface SelectedCell {
  name: string;
  maker: string;
  property: string;
  rowIndex: number;
}

interface ComponentReviewState {
  activeSubTab: string;
  selectedEntity: SelectedEntity | null;
  selectedProperty: string;
  drawerOpen: boolean;
  flaggedItems: FlaggedItem[];
  flagIndex: number;
  // Cell editing state
  selectedCell: SelectedCell | null;
  cellEditMode: boolean;
  cellEditValue: string;
  originalCellEditValue: string;
  // Enum tab state
  selectedEnumField: string;
  enumDrawerOpen: boolean;
  selectedEnumValue: string;

  setActiveSubTab: (tab: string) => void;
  openDrawer: (type: string, name: string, maker: string, rowIndex?: number) => void;
  closeDrawer: () => void;
  setSelectedProperty: (prop: string) => void;
  setFlaggedItems: (items: FlaggedItem[]) => void;
  nextFlagged: () => void;
  prevFlagged: () => void;
  setSelectedEnumField: (field: string) => void;
  openEnumDrawer: (field: string, value: string) => void;
  closeEnumDrawer: () => void;
  // Cell editing actions
  selectComponentCell: (name: string, maker: string, property: string, rowIndex: number) => void;
  selectAndEditComponentCell: (name: string, maker: string, property: string, value: string, rowIndex: number) => void;
  clearComponentCell: () => void;
  startComponentEdit: (value: string) => void;
  cancelComponentEdit: () => void;
  commitComponentEdit: () => void;
  setCellEditValue: (value: string) => void;
}

export const useComponentReviewStore = create<ComponentReviewState>((set, get) => ({
  activeSubTab: '',
  selectedEntity: null,
  selectedProperty: '',
  drawerOpen: false,
  flaggedItems: [],
  flagIndex: -1,
  selectedCell: null,
  cellEditMode: false,
  cellEditValue: '',
  originalCellEditValue: '',
  selectedEnumField: '',
  enumDrawerOpen: false,
  selectedEnumValue: '',

  setActiveSubTab: (tab) => set({ activeSubTab: tab, drawerOpen: false, enumDrawerOpen: false, selectedCell: null, cellEditMode: false }),
  openDrawer: (type, name, maker, rowIndex) => set({ selectedEntity: { type, name, maker, rowIndex }, drawerOpen: true }),
  closeDrawer: () => set({ drawerOpen: false }),
  setSelectedProperty: (prop) => set({ selectedProperty: prop }),
  setFlaggedItems: (items) => set({ flaggedItems: items, flagIndex: items.length > 0 ? 0 : -1 }),
  nextFlagged: () => {
    const { flaggedItems, flagIndex } = get();
    if (flaggedItems.length === 0) return;
    const next = (flagIndex + 1) % flaggedItems.length;
    const item = flaggedItems[next];
    set({ flagIndex: next, selectedEntity: { type: item.type, name: item.name, maker: item.maker }, drawerOpen: true });
  },
  prevFlagged: () => {
    const { flaggedItems, flagIndex } = get();
    if (flaggedItems.length === 0) return;
    const prev = (flagIndex - 1 + flaggedItems.length) % flaggedItems.length;
    const item = flaggedItems[prev];
    set({ flagIndex: prev, selectedEntity: { type: item.type, name: item.name, maker: item.maker }, drawerOpen: true });
  },
  setSelectedEnumField: (field) => set({ selectedEnumField: field }),
  openEnumDrawer: (field, value) => set({ selectedEnumField: field, selectedEnumValue: value, enumDrawerOpen: true }),
  closeEnumDrawer: () => set({ enumDrawerOpen: false }),
  // Cell editing
  selectComponentCell: (name, maker, property, rowIndex) => set({ selectedCell: { name, maker, property, rowIndex }, cellEditMode: false, cellEditValue: '', originalCellEditValue: '' }),
  selectAndEditComponentCell: (name, maker, property, value, rowIndex) => set({ selectedCell: { name, maker, property, rowIndex }, cellEditMode: true, cellEditValue: value, originalCellEditValue: value }),
  clearComponentCell: () => set({ selectedCell: null, cellEditMode: false, cellEditValue: '', originalCellEditValue: '' }),
  startComponentEdit: (value) => set({ cellEditMode: true, cellEditValue: value, originalCellEditValue: value }),
  cancelComponentEdit: () => set({ cellEditMode: false, cellEditValue: '', originalCellEditValue: '' }),
  commitComponentEdit: () => set({ cellEditMode: false }),
  setCellEditValue: (value) => set({ cellEditValue: value }),
}));
