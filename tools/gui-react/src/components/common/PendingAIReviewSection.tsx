import { useMutation, type QueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { DrawerSection } from './DrawerShell';
import type { ComponentReviewFlaggedItem, ComponentReviewBatchResult } from '../../types/componentReview';

interface PendingAIReviewSectionProps {
  items: ComponentReviewFlaggedItem[];
  category: string;
  queryClient: QueryClient;
}

export function PendingAIReviewSection({ items, category, queryClient }: PendingAIReviewSectionProps) {
  const batchMut = useMutation({
    mutationFn: () =>
      api.post<ComponentReviewBatchResult>(`/review-components/${category}/run-component-review-batch`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['componentReview', category] });
      queryClient.invalidateQueries({ queryKey: ['componentReviewData', category] });
      queryClient.invalidateQueries({ queryKey: ['reviewProductsIndex', category] });
    },
  });

  if (items.length === 0) return null;

  return (
    <DrawerSection title="Pending AI Review">
      <div className="px-3 py-2 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded text-xs text-purple-700 dark:text-purple-300 space-y-2">
        <div className="font-medium">
          {items.length} item{items.length !== 1 ? 's' : ''} awaiting AI confirmation
        </div>
        <div className="space-y-2">
          {items.slice(0, 8).map((item) => (
            <div key={item.review_id} className="space-y-0.5 border-b border-purple-200/50 dark:border-purple-800/50 pb-1 last:border-0">
              <div className="flex items-center gap-2 text-[10px]">
                <span className="font-mono font-medium truncate">{item.raw_query}</span>
                <span className="px-1 py-0.5 rounded bg-purple-200/50 dark:bg-purple-800/50 text-purple-600 dark:text-purple-300">
                  {item.match_type === 'fuzzy_flagged' ? `${Math.round(item.combined_score * 100)}%` : 'new'}
                </span>
                {item.matched_component && (
                  <span className="text-purple-400 truncate">→ {item.matched_component}</span>
                )}
              </div>
              {item.product_id && (
                <div className="text-[9px] text-purple-400">product: {item.product_id}</div>
              )}
              {item.alternatives && item.alternatives.length > 0 && (
                <div className="text-[9px] text-purple-400">
                  alternatives: {item.alternatives.slice(0, 3).map((a) => `${a.canonical_name} (${Math.round(a.score * 100)}%)`).join(', ')}
                </div>
              )}
              {item.product_attributes && Object.keys(item.product_attributes).length > 0 && (
                <div className="text-[9px] text-purple-400 truncate" title={JSON.stringify(item.product_attributes)}>
                  attrs: {Object.entries(item.product_attributes).slice(0, 4).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')}
                </div>
              )}
            </div>
          ))}
          {items.length > 8 && (
            <div className="text-[10px] text-purple-400">+{items.length - 8} more</div>
          )}
        </div>
        <button
          onClick={() => batchMut.mutate()}
          disabled={batchMut.isPending}
          className="w-full px-2 py-1.5 text-[11px] font-medium rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
        >
          {batchMut.isPending ? 'Running AI Review...' : `Run AI Review (${items.length})`}
        </button>
      </div>
    </DrawerSection>
  );
}
