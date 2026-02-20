import { create } from 'zustand';
import type { RuntimeEvent } from '../types/events';

interface EventsState {
  events: RuntimeEvent[];
  appendEvents: (newEvents: RuntimeEvent[]) => void;
  setEvents: (events: RuntimeEvent[]) => void;
  clear: () => void;
}

const MAX_EVENTS = 5000;

export const useEventsStore = create<EventsState>((set) => ({
  events: [],
  appendEvents: (newEvents) =>
    set((s) => {
      const merged = [...s.events, ...newEvents];
      return { events: merged.slice(-MAX_EVENTS) };
    }),
  setEvents: (events) => set({ events: events.slice(-MAX_EVENTS) }),
  clear: () => set({ events: [] }),
}));
