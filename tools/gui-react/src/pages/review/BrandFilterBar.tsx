import { useReviewStore } from '../../stores/reviewStore';
import type { ProductReviewPayload } from '../../types/review';

interface BrandFilterBarProps {
  brands: string[];
  products: ProductReviewPayload[];
}

export function BrandFilterBar({ brands, products }: BrandFilterBarProps) {
  const { brandFilter, setBrandFilterMode, toggleBrand } = useReviewStore();

  // Count products per brand
  const brandCounts = new Map<string, number>();
  for (const p of products) {
    const b = (p.identity?.brand || '').trim();
    if (b) brandCounts.set(b, (brandCounts.get(b) || 0) + 1);
  }

  const isAllSelected = brandFilter.mode === 'all';
  const isNoneSelected = brandFilter.mode === 'none';

  return (
    <div className="flex items-center gap-1.5 py-1 px-1 bg-gray-50 dark:bg-gray-800/50 rounded border border-gray-200 dark:border-gray-700 overflow-x-auto">
      <button
        onClick={() => setBrandFilterMode('all')}
        className={`shrink-0 px-2 py-0.5 text-[10px] rounded border ${
          isAllSelected
            ? 'bg-blue-600 text-white border-blue-600'
            : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'
        }`}
      >
        All
      </button>
      <button
        onClick={() => setBrandFilterMode('none')}
        className={`shrink-0 px-2 py-0.5 text-[10px] rounded border ${
          isNoneSelected
            ? 'bg-blue-600 text-white border-blue-600'
            : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'
        }`}
      >
        None
      </button>
      <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 shrink-0" />
      {brands.map((brand) => {
        const active = brandFilter.mode === 'all' || brandFilter.selected.has(brand);
        const count = brandCounts.get(brand) || 0;
        return (
          <button
            key={brand}
            onClick={() => toggleBrand(brand)}
            className={`shrink-0 px-1.5 py-0.5 text-[10px] rounded border transition-colors ${
              active
                ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700'
                : 'bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750'
            }`}
          >
            {brand} <span className="opacity-60">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
