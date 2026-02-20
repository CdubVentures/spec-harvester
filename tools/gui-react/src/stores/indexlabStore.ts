import { create } from 'zustand';

export interface IndexLabEvent {
  run_id: string;
  category?: string;
  product_id?: string;
  ts: string;
  stage: string;
  event: string;
  payload?: Record<string, unknown>;
}

interface IndexLabState {
  byRun: Record<string, IndexLabEvent[]>;
  appendEvents: (events: IndexLabEvent[]) => void;
  clearRun: (runId: string) => void;
  clearAll: () => void;
}

const MAX_PER_RUN = 4000;

export const useIndexLabStore = create<IndexLabState>((set) => ({
  byRun: {},
  appendEvents: (events) => set((state) => {
    if (!Array.isArray(events) || events.length === 0) return state;
    const next = { ...state.byRun };
    for (const row of events) {
      const runId = String(row?.run_id || '').trim();
      if (!runId) continue;
      const list = Array.isArray(next[runId]) ? [...next[runId]] : [];
      list.push(row);
      next[runId] = list.slice(-MAX_PER_RUN);
    }
    return { byRun: next };
  }),
  clearRun: (runId) => set((state) => {
    const token = String(runId || '').trim();
    if (!token || !state.byRun[token]) return state;
    const next = { ...state.byRun };
    delete next[token];
    return { byRun: next };
  }),
  clearAll: () => set({ byRun: {} })
}));

