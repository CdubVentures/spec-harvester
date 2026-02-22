import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, type QueryClient } from '@tanstack/react-query';
import * as Tooltip from '@radix-ui/react-tooltip';
import { api } from '../../api/client';
import { InlineCellEditor } from '../../components/common/InlineCellEditor';
import { ReviewValueCell, type ReviewValueCellState } from '../../components/common/ReviewValueCell';
import { CellDrawer } from '../../components/common/CellDrawer';
import { FlagIcon } from '../../components/common/FlagIcon';
import { FlagsSection } from '../../components/common/FlagsSection';
import { LinkedProductsList } from '../../components/common/LinkedProductsList';
import { useComponentReviewStore } from '../../stores/componentReviewStore';
import { hasKnownValue } from '../../utils/fieldNormalize';
import { useFieldLabels } from '../../hooks/useFieldLabels';
import { sourceBadgeClass, SOURCE_BADGE_FALLBACK } from '../../utils/colors';
import type { EnumReviewPayload, EnumFieldReview, EnumValueReviewItem } from '../../types/componentReview';

interface EnumSubTabProps {
  data: EnumReviewPayload;
  category: string;
  queryClient: QueryClient;
  debugLinkedProducts?: boolean;
}

function enumToCellState(valueItem: EnumValueReviewItem): ReviewValueCellState {
  return {
    selected: {
      value: valueItem.value,
      confidence: valueItem.confidence,
      color: valueItem.color,
    },
    needs_review: valueItem.needs_review,
    reason_codes: valueItem.needs_review ? ['needs_review'] : [],
    source: valueItem.source,
  };
}

function hasActionablePending(item: EnumValueReviewItem): boolean {
  if (!item?.needs_review) return false;
  const candidateRows = (item.candidates || []).filter((candidate) => {
    const candidateId = String(candidate?.candidate_id || '').trim();
    return Boolean(candidateId) && hasKnownValue(candidate?.value);
  });
  return candidateRows.some((candidate) => {
    if (candidate?.is_synthetic_selected) return false;
    const sharedStatus = String(candidate?.shared_review_status || '').trim().toLowerCase();
    return sharedStatus ? sharedStatus === 'pending' : true;
  });
}

function toPositiveId(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const id = Math.trunc(n);
  return id > 0 ? id : null;
}

function FieldListItem({
  field,
  isSelected,
  onClick,
  getLabel,
}: {
  field: EnumFieldReview;
  isSelected: boolean;
  onClick: () => void;
  getLabel: (key: string) => string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between rounded transition-colors ${
        isSelected
          ? 'bg-accent/10 text-accent dark:bg-accent-dark/10 dark:text-accent-dark border-l-2 border-accent'
          : 'hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
      }`}
    >
      <span className="truncate">{getLabel(field.field)}</span>
      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
        <span className="text-[10px] text-gray-400">{field.metrics.total}</span>
        {(() => {
          const pipelineReviewCount = field.values.filter((v) => hasActionablePending(v) && v.source === 'pipeline').length;
          const otherFlagCount = field.metrics.flags - pipelineReviewCount;
          return (
            <>
              {pipelineReviewCount > 0 && (
                <span className="px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 text-[10px] rounded">
                  {pipelineReviewCount} AI
                </span>
              )}
              {otherFlagCount > 0 && (
                <span className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 text-[10px] rounded">
                  {otherFlagCount}
                </span>
              )}
            </>
          );
        })()}
      </div>
    </button>
  );
}

const sourceBadge = sourceBadgeClass;

function ValueRow({
  item,
  isEditing,
  isSelected,
  editText,
  onEditChange,
  onEditCommit,
  onEditCancel,
  onRunAIReview,
  aiPending,
  onClick,
  debugLinkedProducts,
}: {
  item: EnumValueReviewItem;
  isEditing: boolean;
  isSelected: boolean;
  editText: string;
  onEditChange: (v: string) => void;
  onEditCommit: () => void;
  onEditCancel: () => void;
  onRunAIReview: () => void;
  aiPending: boolean;
  onClick: () => void;
  debugLinkedProducts: boolean;
}) {
  const [linksExpanded, setLinksExpanded] = useState(false);
  const linkedCount = item.linked_products?.length ?? 0;

  if (isEditing) {
    return (
      <div className="w-full px-3 py-1 flex items-center gap-2 rounded bg-blue-50 dark:bg-blue-900/30">
        <InlineCellEditor
          value={editText}
          onChange={onEditChange}
          onCommit={onEditCommit}
          onCancel={onEditCancel}
          className="w-48 max-w-[50%] px-2 py-0.5 text-[11px] bg-white dark:bg-gray-800 border-0 outline-none ring-2 ring-accent rounded"
          stopClickPropagation
        />
        <span className={`ml-auto px-1.5 py-0.5 rounded text-[9px] font-medium flex-shrink-0 ${sourceBadge[item.source] || SOURCE_BADGE_FALLBACK}`}>
          {item.source}
        </span>
      </div>
    );
  }

  const isPipelineReview = hasActionablePending(item) && item.source === 'pipeline';

  return (
    <div>
      <button
        onClick={onClick}
        className={`w-full text-left px-3 py-1 flex items-center gap-2 rounded transition-colors ${
          isSelected
            ? 'bg-blue-50 dark:bg-blue-900/30'
            : isPipelineReview
              ? 'bg-purple-50/50 dark:bg-purple-950/20 hover:bg-purple-50 dark:hover:bg-purple-950/30'
              : 'hover:bg-gray-50 dark:hover:bg-gray-800'
        } ${item.needs_review ? (isPipelineReview ? 'border-l-2 border-purple-400' : 'border-l-2 border-yellow-400') : ''}`}
      >
        {item.needs_review && (
          <span className={`inline-flex items-center flex-shrink-0 ${isPipelineReview ? 'text-purple-600 dark:text-purple-400' : 'text-amber-600 dark:text-amber-400'}`} title="Needs review">
            <FlagIcon className="w-2.5 h-2.5" />
          </span>
        )}
        <ReviewValueCell
          state={enumToCellState(item)}
          className="flex-1 min-w-0"
          valueMaxChars={linkedCount > 0 ? 36 : 48}
          showConfidence
          pendingAI={isPipelineReview}
          showLinkedProductBadge={debugLinkedProducts}
          linkedProductCount={linkedCount}
        />
        {linkedCount > 0 && (
          <span
            onClick={(e) => { e.stopPropagation(); setLinksExpanded(!linksExpanded); }}
            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium flex-shrink-0 cursor-pointer transition-colors ${
              linksExpanded
                ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-blue-900/30'
            }`}
            title={`${linkedCount} linked product${linkedCount !== 1 ? 's' : ''} - click to ${linksExpanded ? 'collapse' : 'expand'}`}
          >
            <span className="text-[8px]">{linksExpanded ? '\u25BC' : '\u25B6'}</span>
            {linkedCount}p
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRunAIReview();
          }}
          disabled={aiPending}
          title="Run AI review for list/component pending matches (batch run)."
          className="px-1.5 py-0.5 rounded text-[9px] font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 flex-shrink-0"
        >
          {aiPending ? '...' : 'AI'}
        </button>
        <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium flex-shrink-0 ${sourceBadge[item.source] || SOURCE_BADGE_FALLBACK}`}>
          {item.source}
        </span>
      </button>
      {linksExpanded && item.linked_products && item.linked_products.length > 0 && (
        <div className="ml-6 mr-2 mb-1">
          <LinkedProductsList
            products={item.linked_products}
            headerLabel={item.value}
            maxHeight={160}
            defaultExpanded
          />
        </div>
      )}
    </div>
  );
}

export function EnumSubTab({
  data,
  category,
  queryClient,
  debugLinkedProducts = false,
}: EnumSubTabProps) {
  const { getLabel } = useFieldLabels(category);
  // Individual selectors to avoid re-renders from unrelated store changes
  const selectedEnumField = useComponentReviewStore((s) => s.selectedEnumField);
  const setSelectedEnumField = useComponentReviewStore((s) => s.setSelectedEnumField);
  const enumDrawerOpen = useComponentReviewStore((s) => s.enumDrawerOpen);
  const openEnumDrawer = useComponentReviewStore((s) => s.openEnumDrawer);
  const closeEnumDrawer = useComponentReviewStore((s) => s.closeEnumDrawer);
  const selectedEnumValue = useComponentReviewStore((s) => s.selectedEnumValue);
  const [newValue, setNewValue] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [selectedValueIndex, setSelectedValueIndex] = useState<number | null>(null);

  // ── Drawer mutations (moved from EnumReviewDrawer) ──────────────
  function optimisticAccept(field: string, valueIndex: number, candidateId?: string | null, candidateValue?: string) {
    const now = new Date().toISOString();
    queryClient.setQueryData<EnumReviewPayload>(
      ['enumReviewData', category],
      (old) => {
        if (!old) return old;
        return {
          ...old,
          fields: old.fields.map((f) => {
            if (f.field !== field) return f;
            const nextValues = f.values.map((v, i) =>
              i === valueIndex
                ? {
                  ...v,
                  value: candidateValue ?? v.value,
                  confidence: 1.0,
                  color: 'green' as const,
                  // Accept must not implicitly confirm shared AI.
                  needs_review: v.needs_review,
                  source_timestamp: now,
                  overridden: false,
                  accepted_candidate_id: candidateId ?? null,
                }
                : v,
            );
            return {
              ...f,
              values: nextValues,
              metrics: {
                ...f.metrics,
                flags: nextValues.filter((v) => v.needs_review).length,
              },
            };
          }),
        };
      },
    );
  }

  function optimisticRemove(field: string, valueIndex: number) {
    queryClient.setQueryData<EnumReviewPayload>(
      ['enumReviewData', category],
      (old) => {
        if (!old) return old;
        return {
          ...old,
          fields: old.fields.map((f) => {
            if (f.field !== field) return f;
            const newValues = f.values.filter((_, i) => i !== valueIndex);
            return {
              ...f,
              values: newValues,
              metrics: { total: newValues.length, flags: newValues.filter((v) => v.needs_review).length },
            };
          }),
        };
      },
    );
  }

  const acceptMutation = useMutation({
    mutationFn: (body: {
      field: string;
      action: string;
      value: string;
      candidateId?: string;
      candidateSource?: string;
      oldValue?: string;
      listValueId?: number;
      enumListId?: number;
    }) =>
      api.post(`/review-components/${category}/enum-override`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enumReviewData', category] });
      queryClient.invalidateQueries({ queryKey: ['reviewProductsIndex', category] });
      queryClient.invalidateQueries({ queryKey: ['studio-known-values', category] });
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['enumReviewData', category] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (body: { field: string; action: string; value: string; listValueId?: number; enumListId?: number }) =>
      api.post(`/review-components/${category}/enum-override`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enumReviewData', category] });
      queryClient.invalidateQueries({ queryKey: ['reviewProductsIndex', category] });
      queryClient.invalidateQueries({ queryKey: ['studio-known-values', category] });
      closeEnumDrawer();
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['enumReviewData', category] });
    },
  });

  const drawerRenameMutation = useMutation({
    mutationFn: ({
      field,
      oldValue,
      newValue: newVal,
      listValueId,
      enumListId,
    }: {
      field: string;
      oldValue: string;
      newValue: string;
      valueIndex?: number;
      listValueId?: number;
      enumListId?: number;
    }) => api.post(`/review-components/${category}/enum-rename`, {
      field,
      oldValue,
      newValue: newVal,
      listValueId,
      enumListId,
    }),
    onMutate: async ({ field, newValue: newVal, valueIndex, listValueId }) => {
      if (!toPositiveId(listValueId)) return;
      queryClient.setQueryData<EnumReviewPayload>(
        ['enumReviewData', category],
        (old) => {
          if (!old) return old;
          return {
            ...old,
            fields: old.fields.map((f) => {
              if (f.field !== field) return f;
              return { ...f, values: f.values.map((v, i) => (valueIndex != null ? i === valueIndex : false) ? { ...v, value: newVal } : v) };
            }),
          };
        },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enumReviewData', category] });
      queryClient.invalidateQueries({ queryKey: ['reviewProductsIndex', category] });
      queryClient.invalidateQueries({ queryKey: ['studio-known-values', category] });
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['enumReviewData', category] });
    },
  });

  // AI review batch mutation for enum pipeline values
  const aiReviewBatchMut = useMutation({
    mutationFn: () =>
      api.post(`/review-components/${category}/run-component-review-batch`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['componentReview', category] });
      queryClient.invalidateQueries({ queryKey: ['enumReviewData', category] });
      queryClient.invalidateQueries({ queryKey: ['reviewProductsIndex', category] });
    },
  });

  useEffect(() => {
    if (!selectedEnumField && data.fields.length > 0) {
      setSelectedEnumField(data.fields[0].field);
    }
  }, [selectedEnumField, data.fields, setSelectedEnumField]);

  const selectedFieldData = useMemo(
    () => data.fields.find((field) => field.field === selectedEnumField),
    [data.fields, selectedEnumField],
  );

  const resolvedSelectedValueIndex = useMemo(() => {
    if (!selectedFieldData) return null;
    const token = String(selectedEnumValue || '').trim().toLowerCase();
    if (token) {
      const idxByValue = selectedFieldData.values.findIndex((v) => String(v.value || '').trim().toLowerCase() === token);
      if (idxByValue >= 0) return idxByValue;
    }
    if (
      selectedValueIndex != null
      && selectedValueIndex >= 0
      && selectedValueIndex < selectedFieldData.values.length
    ) {
      return selectedValueIndex;
    }
    return null;
  }, [selectedFieldData, selectedEnumValue, selectedValueIndex]);

  const selectedValueItem = useMemo(
    () => resolvedSelectedValueIndex != null && selectedFieldData ? selectedFieldData.values[resolvedSelectedValueIndex] ?? null : null,
    [selectedFieldData, resolvedSelectedValueIndex],
  );

  const handleEnumEditCommit = useCallback(async () => {
    if (editingIndex == null || !editText.trim() || !selectedEnumField || !selectedFieldData) return;
    const oldVal = selectedFieldData.values[editingIndex]?.value;
    if (!oldVal || editText.trim() === oldVal) { setEditingIndex(null); return; }
    const slotId = toPositiveId(selectedFieldData.values[editingIndex]?.list_value_id);
    if (!slotId) {
      setEditingIndex(null);
      return;
    }

    const trimmed = editText.trim();
    const field = selectedEnumField;
    const idx = editingIndex;

    // Optimistic rename in cache — match by index
    queryClient.setQueryData<EnumReviewPayload>(['enumReviewData', category], (old) => {
      if (!old) return old;
      return {
        ...old,
        fields: old.fields.map((f) => {
          if (f.field !== field) return f;
          return { ...f, values: f.values.map((v, i) => i === idx ? { ...v, value: trimmed } : v) };
        }),
      };
    });

    try {
      const enumListId = toPositiveId(selectedFieldData.enum_list_id);
      await api.post(`/review-components/${category}/enum-rename`, {
        field,
        oldValue: oldVal,
        newValue: trimmed,
        listValueId: slotId,
        enumListId: enumListId ?? undefined,
      });
    } catch (err) {
      console.error('Enum rename failed:', err);
    } finally {
      queryClient.invalidateQueries({ queryKey: ['enumReviewData', category] });
      queryClient.invalidateQueries({ queryKey: ['reviewProductsIndex', category] });
      queryClient.invalidateQueries({ queryKey: ['studio-known-values', category] });
    }
    setEditingIndex(null);
  }, [editingIndex, editText, selectedEnumField, selectedFieldData, queryClient, category]);

  const handleAddValue = useCallback(async () => {
    if (!newValue.trim() || !selectedEnumField) return;
    const enumListId = toPositiveId(selectedFieldData?.enum_list_id);
    if (!enumListId) return;

    const trimmed = newValue.trim();
    const field = selectedEnumField;

    // Optimistic add to cache
    const now = new Date().toISOString();
    queryClient.setQueryData<EnumReviewPayload>(['enumReviewData', category], (old) => {
      if (!old) return old;
      return {
        ...old,
        fields: old.fields.map((f) => {
          if (f.field !== field) return f;
          const newValues = [...f.values, { value: trimmed, source: 'manual' as const, source_timestamp: now, confidence: 1.0, color: 'green' as const, needs_review: false, candidates: [] }];
          return { ...f, values: newValues, metrics: { total: newValues.length, flags: f.values.filter((v) => v.needs_review).length } };
        }),
      };
    });

    try {
      await api.post(`/review-components/${category}/enum-override`, {
        field,
        action: 'add',
        value: trimmed,
        enumListId,
      });
    } catch (err) {
      console.error('Failed to add enum value:', err);
    } finally {
      queryClient.invalidateQueries({ queryKey: ['enumReviewData', category] });
      queryClient.invalidateQueries({ queryKey: ['reviewProductsIndex', category] });
      queryClient.invalidateQueries({ queryKey: ['studio-known-values', category] });
    }
    setNewValue('');
  }, [newValue, selectedEnumField, selectedFieldData, queryClient, category]);

  const handleValueClick = useCallback((valueItem: EnumValueReviewItem, valueIndex: number) => {
    if (!selectedFieldData) return;
    // If already selected, enter edit mode
    if (selectedValueIndex === valueIndex && enumDrawerOpen) {
      setEditingIndex(valueIndex);
      setEditText(valueItem.value);
      return;
    }
    // First click: select + open drawer
    setSelectedValueIndex(valueIndex);
    openEnumDrawer(selectedFieldData.field, valueItem.value);
    setEditingIndex(null);
  }, [selectedFieldData, selectedValueIndex, enumDrawerOpen, openEnumDrawer]);

  return (
    <Tooltip.Provider delayDuration={200}>
      <div className="grid grid-cols-[220px,1fr] gap-3" style={{ minHeight: '400px' }}>
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-y-auto max-h-[calc(100vh-320px)]">
          <div className="sticky top-0 bg-gray-50 dark:bg-gray-800 px-3 py-2 border-b border-gray-200 dark:border-gray-700">
            <p className="text-xs font-medium text-gray-500">Fields ({data.fields.length})</p>
          </div>
          <div className="p-1 space-y-0.5">
            {[...data.fields].sort((a, b) => a.field.localeCompare(b.field)).map((field) => (
              <FieldListItem
                key={field.field}
                field={field}
                isSelected={field.field === selectedEnumField}
                getLabel={getLabel}
                onClick={() => {
                  setSelectedEnumField(field.field);
                  closeEnumDrawer();
                  setEditingIndex(null);
                  setSelectedValueIndex(null);
                }}
              />
            ))}
          </div>
        </div>

        <div className={`grid ${enumDrawerOpen && selectedValueItem ? 'grid-cols-[1fr,320px]' : 'grid-cols-1'} gap-3 min-w-0`}>
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-y-auto max-h-[calc(100vh-320px)] min-w-0">
            {selectedFieldData ? (
              <>
                <div className="sticky top-0 bg-gray-50 dark:bg-gray-800 px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                  <p className="text-xs font-medium text-gray-500">
                    {getLabel(selectedFieldData.field)} - {selectedFieldData.values.length} values
                  </p>
                  {(() => {
                    const pipelineCount = selectedFieldData.values.filter((v) => hasActionablePending(v) && v.source === 'pipeline').length;
                    const otherCount = selectedFieldData.metrics.flags - pipelineCount;
                    return (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => aiReviewBatchMut.mutate()}
                          disabled={aiReviewBatchMut.isPending}
                          className="px-2 py-0.5 bg-purple-600 text-white text-[10px] rounded hover:bg-purple-700 disabled:opacity-50"
                          title="Run AI review for list/component pending matches (batch run)."
                        >
                          {aiReviewBatchMut.isPending ? 'Running...' : 'Run AI Review'}
                        </button>
                        {pipelineCount > 0 && (
                          <span className="px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 text-[10px] rounded">
                            {pipelineCount} AI review
                          </span>
                        )}
                        {otherCount > 0 && (
                          <span className="px-1.5 py-0.5 bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-300 text-[10px] rounded">
                            {otherCount} needs review
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>
                <div className="p-1 space-y-0.5">
                  {selectedFieldData.values.map((valueItem, valueIndex) => (
                    <ValueRow
                      key={`${valueItem.value}-${valueIndex}`}
                      item={valueItem}
                      isEditing={editingIndex === valueIndex}
                      isSelected={resolvedSelectedValueIndex === valueIndex && enumDrawerOpen}
                      editText={editText}
                      onEditChange={setEditText}
                      onEditCommit={() => { void handleEnumEditCommit(); }}
                      onEditCancel={() => { setEditingIndex(null); }}
                      onRunAIReview={() => aiReviewBatchMut.mutate()}
                      aiPending={aiReviewBatchMut.isPending}
                      onClick={() => handleValueClick(valueItem, valueIndex)}
                      debugLinkedProducts={debugLinkedProducts}
                    />
                  ))}
                </div>

                <div className="sticky bottom-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newValue}
                      onChange={(event) => setNewValue(event.target.value)}
                      className="flex-1 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                      placeholder="Add new value..."
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && newValue.trim()) {
                          void handleAddValue();
                        }
                      }}
                    />
                    <button
                      onClick={() => { void handleAddValue(); }}
                      disabled={!newValue.trim()}
                      className="px-3 py-1 text-sm bg-accent text-white rounded hover:bg-blue-600 disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                Select a field from the list
              </div>
            )}
          </div>

          {enumDrawerOpen && selectedValueItem && selectedFieldData && resolvedSelectedValueIndex != null && (() => {
            const vi = selectedValueItem;
            const fd = selectedFieldData;
            const viIndex = resolvedSelectedValueIndex;
            const listValueId = toPositiveId(vi.list_value_id);
            const enumListId = toPositiveId(fd.enum_list_id);
            const canMutateValueSlot = Boolean(listValueId);
            const drawerBadges: Array<{ label: string; className: string }> = [];
            if (vi.needs_review) {
              drawerBadges.push({ label: 'needs_review', className: 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-200' });
            }
            const hasMeaningfulValue = hasKnownValue(vi.value);
            const isAccepted = hasMeaningfulValue
              && !vi.needs_review
              && (vi.source === 'manual' || vi.source === 'workbook' || vi.source === 'reference' || Boolean(vi.accepted_candidate_id));
            const drawerIsPending = acceptMutation.isPending || removeMutation.isPending || drawerRenameMutation.isPending;

            const extraActions = (
              <button
                onClick={() => {
                  // Capture values, fire mutation first, then update UI
                  const field = fd.field;
                  const value = vi.value;
                  const idx = viIndex;
                  removeMutation.mutate({
                    field,
                    action: 'remove',
                    value,
                    listValueId: listValueId ?? undefined,
                    enumListId: enumListId ?? undefined,
                  });
                  optimisticRemove(field, idx);
                  setSelectedValueIndex(null);
                }}
                disabled={removeMutation.isPending || !canMutateValueSlot}
                className="w-full px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              >
                {removeMutation.isPending ? 'Removing...' : 'Remove Value'}
              </button>
            );

            const hasSharedPending = hasActionablePending(vi);
            const pendingSharedCandidateIds = hasSharedPending
              ? (() => {
                const candidates = (vi.candidates || []).filter((candidate) => {
                  const candidateId = String(candidate?.candidate_id || '').trim();
                  return Boolean(candidateId) && hasKnownValue(candidate?.value);
                });
                const pendingCandidates = candidates.filter((candidate) => {
                  if (candidate?.is_synthetic_selected) return false;
                  const sharedStatus = String(candidate?.shared_review_status || '').trim().toLowerCase();
                  return !sharedStatus || sharedStatus === 'pending';
                });
                const matches = pendingCandidates
                  .map((candidate) => String(candidate?.candidate_id || '').trim())
                  .filter(Boolean);
                return [...new Set(matches)];
              })()
              : [];
            const fallbackSharedConfirmCandidateId = String(
              vi.accepted_candidate_id
              || pendingSharedCandidateIds[0]
              || '',
            ).trim() || undefined;

            return (
              <CellDrawer
                title={vi.value}
                subtitle={getLabel(fd.field)}
                onClose={closeEnumDrawer}
                currentValue={{
                  value: vi.value,
                  confidence: vi.confidence,
                  color: vi.color,
                  source: vi.source,
                  sourceTimestamp: vi.source_timestamp,
                  overridden: vi.source === 'manual',
                  acceptedCandidateId: vi.accepted_candidate_id ?? null,
                }}
                badges={drawerBadges}
                isCurrentAccepted={isAccepted}
                pendingAIConfirmation={hasSharedPending}
                pendingSharedCandidateIds={pendingSharedCandidateIds}
                candidateUiContext="shared"
                showCandidateDebugIds={debugLinkedProducts}
                onManualOverride={(newVal) => {
                  if (!canMutateValueSlot) return;
                  const trimmed = String(newVal || '').trim();
                  if (!trimmed) return;
                  openEnumDrawer(fd.field, trimmed);
                  setSelectedValueIndex(viIndex);
                  drawerRenameMutation.mutate({
                    field: fd.field,
                    oldValue: vi.value,
                    newValue: trimmed,
                    valueIndex: viIndex,
                    listValueId: listValueId ?? undefined,
                    enumListId: enumListId ?? undefined,
                  });
                }}
                manualOverrideLabel="Rename Value"
                manualOverridePlaceholder="Enter corrected value..."
                isPending={drawerIsPending}
                candidates={vi.candidates ?? []}
                onAcceptCandidate={canMutateValueSlot ? (candidateId, candidate) => {
                  const cid = String(candidateId || '').trim();
                  const acceptedValue = String(candidate.value ?? '').trim();
                  if (!cid || !acceptedValue) return;
                  optimisticAccept(fd.field, viIndex, candidateId, acceptedValue);
                  openEnumDrawer(fd.field, acceptedValue);
                  setSelectedValueIndex(viIndex);
                  acceptMutation.mutate({
                    field: fd.field,
                    action: 'accept',
                    value: acceptedValue,
                    oldValue: String(vi.value ?? '').trim(),
                    candidateId,
                    candidateSource: candidate.source_id || candidate.source || '',
                    listValueId: listValueId ?? undefined,
                    enumListId: enumListId ?? undefined,
                  });
                } : undefined}
                onConfirmSharedCandidate={hasSharedPending && canMutateValueSlot ? (candidateId, candidate) => {
                  const candidateValue = String(candidate?.value ?? '').trim();
                  const confirmValue = candidateValue || String(vi.value ?? '').trim();
                  if (!confirmValue) return;
                  acceptMutation.mutate({
                    field: fd.field,
                    action: 'confirm',
                    value: confirmValue,
                    candidateId: String(candidateId || '').trim() || undefined,
                    candidateSource: candidate.source_id || candidate.source || '',
                    listValueId: listValueId ?? undefined,
                    enumListId: enumListId ?? undefined,
                  });
                } : undefined}
                onConfirmShared={hasSharedPending && canMutateValueSlot ? () => {
                  const confirmValue = String(vi.value ?? '').trim();
                  if (!confirmValue) return;
                  acceptMutation.mutate({
                    field: fd.field,
                    action: 'confirm',
                    value: confirmValue,
                    candidateId: fallbackSharedConfirmCandidateId,
                    listValueId: listValueId ?? undefined,
                    enumListId: enumListId ?? undefined,
                  });
                } : undefined}
                extraActions={extraActions}
                extraSections={
                  <>
                    {vi.needs_review && <FlagsSection reasonCodes={['needs_review']} />}
                    {vi.linked_products && vi.linked_products.length > 0 && (
                      <LinkedProductsList
                        products={vi.linked_products}
                        headerLabel={[vi.normalized_value, vi.enum_policy].filter(Boolean).join(', ') || 'Value'}
                        maxHeight={180}
                        defaultExpanded
                      />
                    )}
                    {debugLinkedProducts && (
                      <div className="px-3 py-2 border border-cyan-200 dark:border-cyan-800 rounded bg-cyan-50/60 dark:bg-cyan-900/20 text-[10px] text-cyan-700 dark:text-cyan-300 space-y-0.5">
                        <div>{`field: ${fd.field}`}</div>
                        <div>{`value: ${vi.value}`}</div>
                        <div>{`listValueId: ${listValueId ?? 'n/a'}`}</div>
                        <div>{`enumListId: ${enumListId ?? 'n/a'}`}</div>
                      </div>
                    )}
                  </>
                }
              />
            );
          })()}
        </div>
      </div>
    </Tooltip.Provider>
  );
}
