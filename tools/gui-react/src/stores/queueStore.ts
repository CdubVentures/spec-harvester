import { create } from 'zustand';
import type { QueueProduct } from '../types/product';

interface QueueState {
  products: QueueProduct[];
  setProducts: (p: QueueProduct[]) => void;
}

export const useQueueStore = create<QueueState>((set) => ({
  products: [],
  setProducts: (products) => set({ products }),
}));
