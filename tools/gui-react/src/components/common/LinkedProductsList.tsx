import { useState } from 'react';
import type { LinkedProduct } from '../../types/componentReview';

/**
 * Parse a product_id like "mouse-corsair-m75-air-wireless" into display parts.
 * Format: {category}-{brand}-{model...}
 * Returns { brand, model } with best-effort title casing.
 */
function parseProductId(productId: string): { brand: string; model: string } {
  const parts = productId.split('-');
  if (parts.length < 3) {
    return { brand: '', model: productId };
  }
  // First segment is category (skip), second is brand, rest is model
  const brand = parts[1];
  const model = parts.slice(2).join(' ');
  return {
    brand: brand.charAt(0).toUpperCase() + brand.slice(1),
    model: model
      .split(' ')
      .map(w => {
        // Preserve all-caps short segments (likely model numbers: v3, x2, g502)
        if (w.length <= 4 && /^[a-z0-9]+$/i.test(w)) return w.toUpperCase();
        return w.charAt(0).toUpperCase() + w.slice(1);
      })
      .join(' '),
  };
}

interface LinkedProductsListProps {
  /** Array of linked product entries from the API */
  products: LinkedProduct[];
  /** Header label context — displayed in the section header */
  headerLabel: string;
  /** Max height of the scrollable list in px (default: 200) */
  maxHeight?: number;
  /** Start in expanded state (default: false) */
  defaultExpanded?: boolean;
}

export function LinkedProductsList({ products, headerLabel, maxHeight = 200, defaultExpanded = false }: LinkedProductsListProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (!products || products.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-2 py-1.5 text-[11px] font-medium text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors"
      >
        <span className="truncate">
          Linked Products{headerLabel ? ` by ${headerLabel}` : ''}{' '}
          <span className="text-gray-400">({products.length})</span>
        </span>
        <span className="flex-shrink-0 ml-1 text-[10px] text-gray-400">
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {expanded && (
        <div
          className="mt-1 border border-gray-200 dark:border-gray-700 rounded overflow-y-auto"
          style={{ maxHeight }}
        >
          <table className="w-full text-[10px]">
            <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800">
              <tr className="text-left text-gray-500 dark:text-gray-400">
                <th className="px-2 py-1 font-medium">Brand</th>
                <th className="px-2 py-1 font-medium">Model</th>
                {products.some(p => p.match_type) && (
                  <th className="px-2 py-1 font-medium text-right">Match</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {products.map((p, i) => {
                const { brand, model } = parseProductId(p.product_id);
                return (
                  <tr
                    key={`${p.product_id}-${i}`}
                    className="hover:bg-gray-50 dark:hover:bg-gray-800/50"
                  >
                    <td className="px-2 py-1 font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      {brand}
                    </td>
                    <td className="px-2 py-1 text-gray-600 dark:text-gray-400 truncate max-w-[160px]" title={model}>
                      {model}
                    </td>
                    {products.some(pp => pp.match_type) && (
                      <td className="px-2 py-1 text-right whitespace-nowrap">
                        {p.match_type && (
                          <span className={`inline-block px-1 py-0.5 rounded text-[9px] font-medium ${
                            p.match_type === 'exact'
                              ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
                              : p.match_type === 'alias'
                                ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                                : 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300'
                          }`}>
                            {p.match_type}
                            {p.match_score != null ? ` ${Math.round(p.match_score * 100)}%` : ''}
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
