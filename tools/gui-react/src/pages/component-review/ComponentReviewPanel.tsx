import { useState } from 'react';
import { useQuery, useMutation, type QueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type {
  ComponentReviewFlaggedItem,
  ComponentReviewDocument,
  ComponentReviewBatchResult,
} from '../../types/componentReview';

interface ComponentReviewPanelProps {
  category: string;
  queryClient: QueryClient;
  componentType?: string;
}

function statusBadge(status: string): { label: string; className: string } {
  switch (status) {
    case 'pending_ai':
      return { label: 'Pending AI', className: 'bg-purple-100 dark:bg-purple-900/50 text-purple-800 dark:text-purple-200' };
    case 'accepted_alias':
      return { label: 'Alias Added', className: 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-200' };
    case 'pending_human':
      return { label: 'Needs Review', className: 'bg-orange-100 dark:bg-orange-900/50 text-orange-800 dark:text-orange-200' };
    case 'approved_new':
      return { label: 'Approved', className: 'bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200' };
    case 'rejected_ai':
      return { label: 'Rejected', className: 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-200' };
    case 'dismissed':
      return { label: 'Dismissed', className: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300' };
    default:
      return { label: status, className: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300' };
  }
}

function ScoreBar({ score, label }: { score: number; label: string }) {
  const pct = Math.round(score * 100);
  const color = pct >= 90 ? 'bg-green-500' : pct >= 70 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-gray-500 w-14 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-gray-400 w-8 text-right">{pct}%</span>
    </div>
  );
}

function ReviewItemCard({
  item,
  onAction,
  isPending,
}: {
  item: ComponentReviewFlaggedItem;
  onAction: (reviewId: string, action: string, mergeTarget?: string) => void;
  isPending: boolean;
}) {
  const badge = statusBadge(item.status);

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-medium">{item.raw_query}</span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${badge.className}`}>
            {badge.label}
          </span>
          <span className="text-[10px] text-gray-400">{item.component_type}</span>
        </div>
        {item.matched_component && (
          <span className="text-[10px] text-gray-500">
            Candidate: <span className="font-mono">{item.matched_component}</span>
          </span>
        )}
      </div>

      <div className="space-y-0.5">
        <ScoreBar score={item.name_score} label="Name" />
        <ScoreBar score={item.property_score} label="Props" />
        <ScoreBar score={item.combined_score} label="Combined" />
      </div>

      {item.alternatives && item.alternatives.length > 0 && (
        <div className="text-[10px] text-gray-400">
          Alternatives: {item.alternatives.map((a) => `${a.canonical_name} (${Math.round(a.score * 100)}%)`).join(', ')}
        </div>
      )}

      {item.ai_decision && (
        <div className="bg-gray-50 dark:bg-gray-800 rounded p-2 text-xs space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">AI Decision:</span>
            <span className="font-mono">{item.ai_decision.decision}</span>
            <span className="text-gray-400">({Math.round(item.ai_decision.confidence * 100)}% confidence)</span>
          </div>
          {item.ai_decision.reasoning && (
            <div className="text-gray-500 italic">{item.ai_decision.reasoning}</div>
          )}
        </div>
      )}

      {item.status === 'pending_human' && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onAction(item.review_id, 'approve_new')}
            disabled={isPending}
            className="px-2 py-1 text-[10px] font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Approve New
          </button>
          {item.matched_component && (
            <button
              onClick={() => onAction(item.review_id, 'merge_alias', item.matched_component!)}
              disabled={isPending}
              className="px-2 py-1 text-[10px] font-medium rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
            >
              Merge as Alias
            </button>
          )}
          <button
            onClick={() => onAction(item.review_id, 'dismiss')}
            disabled={isPending}
            className="px-2 py-1 text-[10px] font-medium rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 disabled:opacity-50"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="text-[10px] text-gray-400">
        Product: {item.product_id || 'unknown'} | Created: {item.created_at ? new Date(item.created_at).toLocaleDateString() : 'unknown'}
      </div>
    </div>
  );
}

export function ComponentReviewPanel({ category, queryClient, componentType }: ComponentReviewPanelProps) {
  const [expanded, setExpanded] = useState(false);

  const reviewQuery = useQuery({
    queryKey: ['componentReview', category],
    queryFn: () => api.get<ComponentReviewDocument>(`/review-components/${category}/component-review`),
    staleTime: 30_000,
  });

  const actionMut = useMutation({
    mutationFn: (body: { review_id: string; action: string; merge_target?: string }) =>
      api.post(`/review-components/${category}/component-review-action`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['componentReview', category] });
      queryClient.invalidateQueries({ queryKey: ['componentReviewData', category] });
    },
  });

  const batchMut = useMutation({
    mutationFn: () =>
      api.post<ComponentReviewBatchResult>(`/review-components/${category}/run-component-review-batch`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['componentReview', category] });
      queryClient.invalidateQueries({ queryKey: ['componentReviewData', category] });
    },
  });

  const allItems = reviewQuery.data?.items || [];
  // Filter by componentType if provided (so each sub-tab shows its own count)
  const items = componentType ? allItems.filter((i) => i.component_type === componentType) : allItems;
  const pendingAI = items.filter((i) => i.status === 'pending_ai');
  const pendingHuman = items.filter((i) => i.status === 'pending_human');
  const acceptedAlias = items.filter((i) => i.status === 'accepted_alias');
  const rejected = items.filter((i) => i.status === 'rejected_ai' || i.status === 'dismissed');

  if (items.length === 0) return null;

  return (
    <div className="mb-3">
      {/* Compact action bar */}
      <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700/50 flex items-center justify-between rounded border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">Component Review</span>
          {pendingAI.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-100 dark:bg-purple-900/50 text-purple-800 dark:text-purple-200">
              {pendingAI.length} pending AI
            </span>
          )}
          {pendingHuman.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-orange-100 dark:bg-orange-900/50 text-orange-800 dark:text-orange-200">
              {pendingHuman.length} needs review
            </span>
          )}
          {acceptedAlias.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-200">
              {acceptedAlias.length} auto-aliased
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {pendingAI.length > 0 && (
            <button
              onClick={() => batchMut.mutate()}
              disabled={batchMut.isPending}
              className="px-2 py-1 text-[10px] font-medium rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
            >
              {batchMut.isPending ? 'Running...' : `Run AI Review All (${pendingAI.length})`}
            </button>
          )}
          <button
            onClick={() => setExpanded(!expanded)}
            className="px-2 py-1 text-[10px] font-medium rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600"
          >
            {expanded ? 'Hide Details' : 'Show Details'}
          </button>
        </div>
      </div>

      {/* Batch result toast */}
      {batchMut.isSuccess && (
        <div className="px-3 py-1.5 text-[10px] text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-400 border border-t-0 border-gray-200 dark:border-gray-700 rounded-b">
          Batch complete: {(batchMut.data as ComponentReviewBatchResult)?.accepted_alias ?? 0} aliases added,{' '}
          {(batchMut.data as ComponentReviewBatchResult)?.pending_human ?? 0} need review,{' '}
          {(batchMut.data as ComponentReviewBatchResult)?.rejected ?? 0} rejected
        </div>
      )}

      {/* Collapsible details */}
      {expanded && (
        <div className="p-3 space-y-3 max-h-[400px] overflow-y-auto border border-t-0 border-gray-200 dark:border-gray-700 rounded-b">
          {/* Pending human review items — always shown when expanded (needs human action) */}
          {pendingHuman.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-orange-600 dark:text-orange-400">
                Needs Human Review ({pendingHuman.length})
              </div>
              {pendingHuman.map((item) => (
                <ReviewItemCard
                  key={item.review_id}
                  item={item}
                  onAction={(reviewId, action, mergeTarget) =>
                    actionMut.mutate({ review_id: reviewId, action, merge_target: mergeTarget })
                  }
                  isPending={actionMut.isPending}
                />
              ))}
            </div>
          )}

          {/* AI-accepted aliases */}
          {acceptedAlias.length > 0 && (
            <details>
              <summary className="text-xs font-semibold text-green-600 dark:text-green-400 cursor-pointer">
                AI Added Aliases ({acceptedAlias.length})
              </summary>
              <div className="mt-2 space-y-1">
                {acceptedAlias.map((item) => (
                  <div key={item.review_id} className="text-[10px] text-gray-500 flex items-center gap-2">
                    <span className="font-mono">{item.raw_query}</span>
                    <span className="text-gray-400">→</span>
                    <span className="font-mono">{item.matched_component}</span>
                    {item.ai_decision?.reasoning && (
                      <span className="italic text-gray-400 truncate max-w-[300px]">{item.ai_decision.reasoning}</span>
                    )}
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Rejected items */}
          {rejected.length > 0 && (
            <details>
              <summary className="text-xs font-semibold text-gray-400 cursor-pointer">
                Rejected / Dismissed ({rejected.length})
              </summary>
              <div className="mt-2 space-y-1">
                {rejected.map((item) => (
                  <div key={item.review_id} className="text-[10px] text-gray-400 flex items-center gap-2">
                    <span className="font-mono">{item.raw_query}</span>
                    <span className={`px-1 py-0.5 rounded ${statusBadge(item.status).className}`}>
                      {statusBadge(item.status).label}
                    </span>
                    {item.ai_decision?.reasoning && (
                      <span className="italic truncate max-w-[300px]">{item.ai_decision.reasoning}</span>
                    )}
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Pending AI summary (no verbose listing) */}
          {pendingAI.length > 0 && pendingHuman.length === 0 && acceptedAlias.length === 0 && rejected.length === 0 && (
            <div className="text-[10px] text-gray-400">
              {pendingAI.length} items waiting for AI review. Click &ldquo;Run AI Review All&rdquo; above to process.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
