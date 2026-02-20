import { create } from 'zustand';

interface ProductState {
  selectedProductId: string;
  selectedBrand: string;
  selectedModel: string;
  setSelectedProduct: (productId: string, brand?: string, model?: string) => void;
}

export const useProductStore = create<ProductState>((set) => ({
  selectedProductId: '',
  selectedBrand: '',
  selectedModel: '',
  setSelectedProduct: (productId, brand = '', model = '') =>
    set({ selectedProductId: productId, selectedBrand: brand, selectedModel: model }),
}));
