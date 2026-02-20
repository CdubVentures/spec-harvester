import { create } from 'zustand';
import type { RuntimeOverrides } from '../types/runtime';
import type { ProcessStatus } from '../types/events';

interface RuntimeState {
  overrides: RuntimeOverrides;
  processStatus: ProcessStatus;
  processOutput: string[];
  setOverrides: (o: RuntimeOverrides) => void;
  setProcessStatus: (s: ProcessStatus) => void;
  appendProcessOutput: (lines: string[]) => void;
  clearProcessOutput: () => void;
}

export const useRuntimeStore = create<RuntimeState>((set) => ({
  overrides: {},
  processStatus: { running: false },
  processOutput: [],
  setOverrides: (overrides) => set({ overrides }),
  setProcessStatus: (processStatus) => set({ processStatus }),
  appendProcessOutput: (lines) =>
    set((s) => ({ processOutput: [...s.processOutput, ...lines].slice(-2000) })),
  clearProcessOutput: () => set({ processOutput: [] }),
}));
