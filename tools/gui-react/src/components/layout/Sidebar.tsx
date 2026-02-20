import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useUiStore } from '../../stores/uiStore';
import { useProductStore } from '../../stores/productStore';
import { useRuntimeStore } from '../../stores/runtimeStore';
import { StatusBadge } from '../common/StatusBadge';
import { Spinner } from '../common/Spinner';
import { isTestCategory, formatTestCategory } from '../../utils/testMode';
import type { CatalogRow } from '../../types/product';

const VARIANT_PLACEHOLDERS = new Set(['unk', 'unknown', 'na', 'n/a', 'none', 'null', '']);
function cleanVariant(v: string): string {
  const s = (v ?? '').trim();
  return VARIANT_PLACEHOLDERS.has(s.toLowerCase()) ? '' : s;
}

const selectCls = 'w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700';
const labelCls = 'text-xs font-medium text-gray-500 dark:text-gray-400';

export function Sidebar() {
  const category = useUiStore((s) => s.category);
  const categories = useUiStore((s) => s.categories);
  const setCategory = useUiStore((s) => s.setCategory);
  const selectedProductId = useProductStore((s) => s.selectedProductId);
  const setSelectedProduct = useProductStore((s) => s.setSelectedProduct);
  const processStatus = useRuntimeStore((s) => s.processStatus);

  const testMode = isTestCategory(category);
  const realCategories = categories.filter((c) => !isTestCategory(c));
  const testCategories = categories.filter((c) => isTestCategory(c));

  // Cascading selector state
  const [selectedBrand, setSelectedBrand] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedVariant, setSelectedVariant] = useState('');

  const { data: catalog = [], isLoading: catalogLoading } = useQuery({
    queryKey: ['catalog', category],
    queryFn: () => api.get<CatalogRow[]>(`/catalog/${category}`),
    refetchInterval: 10_000,
  });

  // Derive unique brands (prefer inActive products first via sort)
  const brands = useMemo(() => {
    const brandSet = new Set<string>();
    // Add inActive brands first so they appear in the list
    for (const r of catalog) {
      if (r.brand) brandSet.add(r.brand);
    }
    return [...brandSet].sort();
  }, [catalog]);

  // Models filtered by selected brand
  const models = useMemo(() => {
    if (!selectedBrand) return [];
    const modelSet = new Set<string>();
    for (const r of catalog) {
      if (r.brand === selectedBrand && r.model) modelSet.add(r.model);
    }
    return [...modelSet].sort();
  }, [catalog, selectedBrand]);

  // Variants filtered by selected brand + model
  const variants = useMemo(() => {
    if (!selectedBrand || !selectedModel) return [];
    const varSet = new Set<string>();
    for (const r of catalog) {
      if (r.brand === selectedBrand && r.model === selectedModel) {
        const v = cleanVariant(r.variant);
        if (v) varSet.add(v);
      }
    }
    return [...varSet].sort();
  }, [catalog, selectedBrand, selectedModel]);

  // Auto-select productId when brand+model are chosen
  useEffect(() => {
    if (!selectedBrand || !selectedModel) {
      if (selectedProductId) setSelectedProduct('');
      return;
    }
    const match = catalog.find((r) =>
      r.brand === selectedBrand &&
      r.model === selectedModel &&
      (variants.length === 0 || !selectedVariant || cleanVariant(r.variant) === selectedVariant)
    );
    if (match) {
      setSelectedProduct(match.productId, match.brand, match.model);
    } else if (selectedProductId) {
      setSelectedProduct('');
    }
  }, [selectedBrand, selectedModel, selectedVariant, catalog, variants.length]);

  // Sync store → local when Overview row click updates productStore
  const storeBrand = useProductStore((s) => s.selectedBrand);
  const storeModel = useProductStore((s) => s.selectedModel);

  useEffect(() => {
    if (storeBrand && storeBrand !== selectedBrand) setSelectedBrand(storeBrand);
    if (storeModel && storeModel !== selectedModel) setSelectedModel(storeModel);
  }, [storeBrand, storeModel]);

  // Reset selectors when category changes
  useEffect(() => {
    setSelectedBrand('');
    setSelectedModel('');
    setSelectedVariant('');
    setSelectedProduct('');
  }, [category]);

  // Reset model when brand changes
  function handleBrandChange(brand: string) {
    setSelectedBrand(brand);
    setSelectedModel('');
    setSelectedVariant('');
  }

  // Reset variant when model changes
  function handleModelChange(model: string) {
    setSelectedModel(model);
    setSelectedVariant('');
  }

  return (
    <aside className="w-64 flex-shrink-0 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-4 overflow-y-auto">
      {/* Category */}
      <div>
        <h2 className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-1">Category</h2>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className={`${selectCls}${testMode ? ' border-amber-400 dark:border-amber-500 ring-1 ring-amber-300 dark:ring-amber-600' : ''}`}
        >
          <option value="all">All Categories</option>
          {realCategories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
          {testCategories.length > 0 && (
            <optgroup label="Test Categories">
              {testCategories.map((c) => (
                <option key={c} value={c}>{formatTestCategory(c)}</option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      {/* Cascading Product Selectors */}
      <div className="space-y-2">
        <h2 className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-1">Product</h2>

        {catalogLoading ? (
          <Spinner className="h-4 w-4" />
        ) : (
          <>
            {/* Brand */}
            <div>
              <label className={labelCls}>Brand</label>
              <select
                value={selectedBrand}
                onChange={(e) => handleBrandChange(e.target.value)}
                className={selectCls}
              >
                <option value="">-- select brand --</option>
                {brands.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>

            {/* Model (filtered by brand) */}
            <div>
              <label className={labelCls}>Model</label>
              <select
                value={selectedModel}
                onChange={(e) => handleModelChange(e.target.value)}
                className={selectCls}
                disabled={!selectedBrand}
              >
                <option value="">{selectedBrand ? '-- select model --' : '-- select brand first --'}</option>
                {models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            {/* Variant (shown when variants exist for brand+model) */}
            {variants.length > 0 && (
              <div>
                <label className={labelCls}>Variant</label>
                <select
                  value={selectedVariant}
                  onChange={(e) => setSelectedVariant(e.target.value)}
                  className={selectCls}
                >
                  <option value="">-- any --</option>
                  {variants.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}
      </div>

      {selectedProductId && (
        <div className="text-xs space-y-1">
          <p className="font-mono text-gray-600 dark:text-gray-300 truncate" title={selectedProductId}>
            {selectedProductId}
          </p>
          <p>Brands: {brands.length} | Models: {models.length}</p>
          {catalog.find((r) => r.productId === selectedProductId) && (
            <StatusBadge status={catalog.find((r) => r.productId === selectedProductId)!.status} />
          )}
        </div>
      )}

      <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
        {processStatus.running && (
          <p className="mt-2 text-xs text-gray-500">PID {processStatus.pid} running</p>
        )}
        {processStatus.command && !processStatus.running && (
          <p className="mt-1 text-xs text-gray-400 truncate" title={processStatus.command}>
            Last: {processStatus.command}
          </p>
        )}
      </div>
    </aside>
  );
}


