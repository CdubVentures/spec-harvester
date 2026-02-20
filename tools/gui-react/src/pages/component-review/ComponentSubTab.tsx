import { useMemo, useCallback, useRef } from 'react';
import { useQuery, useMutation, type QueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import * as Tooltip from '@radix-ui/react-tooltip';
import { DataTable } from '../../components/common/DataTable';
import { InlineCellEditor } from '../../components/common/InlineCellEditor';
import { ReviewValueCell } from '../../components/common/ReviewValueCell';
import { LinkedProductsList } from '../../components/common/LinkedProductsList';
import { useComponentReviewStore } from '../../stores/componentReviewStore';
import { api } from '../../api/client';
import { hasKnownValue, humanizeField } from '../../utils/fieldNormalize';
import { FlagIcon } from '../../components/common/FlagIcon';
import { ComponentReviewDrawer } from './ComponentReviewDrawer';
import { ComponentReviewPanel } from './ComponentReviewPanel';
import type { ComponentReviewPayload, ComponentReviewItem, ComponentPropertyState, ComponentReviewDocument, ComponentReviewFlaggedItem } from '../../types/componentReview';

/** Extended item type that can carry synthetic-row metadata */
type ExtendedComponentReviewItem = ComponentReviewItem & {
  _isSynthetic?: boolean;
  _reviewItems?: ComponentReviewFlaggedItem[];
};

interface ComponentSubTabProps {
  data: ComponentReviewPayload;
  category: string;
  queryClient: QueryClient;
  debugLinkedProducts?: boolean;
}

/** Check if a selectedCell matches a specific row + property using row index for uniqueness */
function isCellSelected(
  selectedCell: { name: string; maker: string; property: string; rowIndex: number } | null,
  rowIndex: number,
  property: string,
): boolean {
  return selectedCell?.rowIndex === rowIndex && selectedCell?.property === property;
}

function toPositiveId(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  const id = Math.trunc(n);
  return id > 0 ? id : undefined;
}

function hasActionablePending(state?: ComponentReviewItem['name_tracked'] | ComponentPropertyState): boolean {
  if (!state?.needs_review) return false;
  const candidateRows = (state?.candidates || []).filter((candidate) => {
    const candidateId = String(candidate?.candidate_id || '').trim();
    return Boolean(candidateId) && hasKnownValue(candidate?.value);
  });
  return candidateRows.some((candidate) => {
    if (candidate?.is_synthetic_selected) return false;
    const sharedStatus = String(candidate?.shared_review_status || '').trim().toLowerCase();
    return sharedStatus ? sharedStatus === 'pending' : true;
  });
}

/**
 * Standalone editing cell that reads value from the store directly.
 * This prevents the columns useMemo from depending on cellEditValue,
 * which would cause full table re-renders on every keystroke.
 */
function ComponentEditingCell({ onCommit, onCancel, className }: {
  onCommit: () => void;
  onCancel: () => void;
  className?: string;
}) {
  const cellEditValue = useComponentReviewStore((s) => s.cellEditValue);
  const setCellEditValue = useComponentReviewStore((s) => s.setCellEditValue);
  return (
    <InlineCellEditor
      value={cellEditValue}
      onChange={setCellEditValue}
      onCommit={onCommit}
      onCancel={onCancel}
      className={className}
      stopClickPropagation
    />
  );
}

/** Optimistically apply an override to the component review cache.
 *  User overrides → source='user', overridden=true. */
function applyComponentOptimisticOverride(
  payload: ComponentReviewPayload,
  rowIndex: number,
  property: string,
  value: string,
): ComponentReviewPayload {
  const now = new Date().toISOString();
  return {
    ...payload,
    items: payload.items.map((item, i) => {
      // Match on exact row index to avoid updating duplicate name+maker entries
      if (i !== rowIndex) return item;
      const greenSelected = { value, confidence: 1.0, status: 'override', color: 'green' as const };

      if (property === '__name') {
        return { ...item, name: value, name_tracked: { ...item.name_tracked, selected: greenSelected, source: 'user', source_timestamp: now, overridden: true, needs_review: false, reason_codes: ['manual_override'] } };
      }
      if (property === '__maker') {
        return { ...item, maker: value, maker_tracked: { ...item.maker_tracked, selected: greenSelected, source: 'user', source_timestamp: now, overridden: true, needs_review: false, reason_codes: ['manual_override'] } };
      }

      const prop = item.properties[property];
      if (!prop) return item;
      return {
        ...item,
        properties: {
          ...item.properties,
          [property]: { ...prop, selected: greenSelected, source: 'user', source_timestamp: now, overridden: true, needs_review: false, reason_codes: ['manual_override'] },
        },
      };
    }),
  };
}

export function ComponentSubTab({
  data,
  category,
  queryClient,
  debugLinkedProducts = false,
}: ComponentSubTabProps) {
  // Query component review items to show inline pending_ai indicators
  const { data: reviewDoc } = useQuery({
    queryKey: ['componentReview', category],
    queryFn: () => api.get<ComponentReviewDocument>(`/review-components/${category}/component-review`),
    staleTime: 30_000,
  });
  // Richer lookup maps for pending AI review items
  // Index by matched_component (for fuzzy_flagged) AND by raw_query (for new_component
  // items whose raw_query matches an existing DB row name — these shouldn't become
  // synthetic rows, they should attach to the existing row as pending AI items).
  // Case-insensitive map: lowercase name → actual DB row name
  const existingNameMap = useMemo(
    () => {
      const map = new Map<string, string>();
      for (const i of data.items) map.set(i.name.toLowerCase(), i.name);
      return map;
    },
    [data.items],
  );
  const pendingAIByComponent = useMemo(() => {
    const byComponent = new Map<string, ComponentReviewFlaggedItem[]>();
    const pushPending = (rawName: string, reviewItem: ComponentReviewFlaggedItem) => {
      const key = String(rawName || '').trim().toLowerCase();
      if (!key) return;
      const existing = byComponent.get(key) || [];
      existing.push(reviewItem);
      byComponent.set(key, existing);
    };
    if (reviewDoc?.items) {
      for (const item of reviewDoc.items) {
        if (item.status !== 'pending_ai') continue;
        if (item.matched_component) {
          const matchedDbName = existingNameMap.get(String(item.matched_component).toLowerCase()) || item.matched_component;
          pushPending(matchedDbName, item);
        } else {
          // new_component item: check if raw_query matches an existing DB row (case-insensitive)
          const dbName = existingNameMap.get(item.raw_query.toLowerCase());
          if (dbName) {
            // Attach to existing row using the actual DB name as key
            pushPending(dbName, item);
          }
        }
      }
    }
    return byComponent;
  }, [reviewDoc?.items, existingNameMap]);
  const mergedItems = useMemo<ExtendedComponentReviewItem[]>(
    () => data.items,
    [data.items],
  );

  // Individual selectors: only re-render when these specific slices change.
  // Critically, cellEditValue changes (typing) do NOT trigger a re-render here.
  const selectedEntity = useComponentReviewStore((s) => s.selectedEntity);
  const drawerOpen = useComponentReviewStore((s) => s.drawerOpen);
  const openDrawer = useComponentReviewStore((s) => s.openDrawer);
  const closeDrawer = useComponentReviewStore((s) => s.closeDrawer);
  const selectedCell = useComponentReviewStore((s) => s.selectedCell);
  const cellEditMode = useComponentReviewStore((s) => s.cellEditMode);
  const selectAndEditComponentCell = useComponentReviewStore((s) => s.selectAndEditComponentCell);
  const cancelComponentEdit = useComponentReviewStore((s) => s.cancelComponentEdit);
  const commitComponentEdit = useComponentReviewStore((s) => s.commitComponentEdit);
  const clearComponentCell = useComponentReviewStore((s) => s.clearComponentCell);

  const overrideMut = useMutation({
    mutationFn: (body: {
      componentType: string;
      name: string;
      maker: string;
      property: string;
      value: string;
      componentIdentityId?: number;
      componentValueId?: number;
    }) =>
      api.post(`/review-components/${category}/component-override`, body),
    onMutate: async (body) => {
      const isIdentityProperty = String(body?.property || '').trim().startsWith('__');
      const hasRequiredId = isIdentityProperty
        ? Boolean(toPositiveId(body?.componentIdentityId))
        : Boolean(toPositiveId(body?.componentValueId));
      if (!hasRequiredId) return;
      const queryKey = ['componentReviewData', category, data.componentType];
      await queryClient.cancelQueries({ queryKey });
      // Use rowIndex from current selectedCell for precise targeting
      const { selectedCell: cell } = useComponentReviewStore.getState();
      const idx = cell?.rowIndex ?? -1;
      // Guard: skip optimistic update for synthetic row indices (idx >= real items count)
      queryClient.setQueryData<ComponentReviewPayload>(queryKey, (old) =>
        old && idx >= 0 && idx < old.items.length ? applyComponentOptimisticOverride(old, idx, body.property, body.value) : old,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['componentReviewData', category, data.componentType] });
      queryClient.invalidateQueries({ queryKey: ['reviewProductsIndex', category] });
      queryClient.invalidateQueries({ queryKey: ['product', category] });
      queryClient.invalidateQueries({ queryKey: ['componentImpact'] });
    },
  });

  const runComponentAiMut = useMutation({
    mutationFn: () =>
      api.post(`/review-components/${category}/run-component-review-batch`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['componentReview', category] });
      queryClient.invalidateQueries({ queryKey: ['componentReviewData', category, data.componentType] });
      queryClient.invalidateQueries({ queryKey: ['reviewProductsIndex', category] });
    },
  });

  // Ref-stabilize overrideMut so handleCommitEdit doesn't change when mutation state cycles
  const overrideMutRef = useRef(overrideMut);
  overrideMutRef.current = overrideMut;

  const handleCellClick = useCallback((row: ExtendedComponentReviewItem, columnId: string, _visualIndex: number) => {
    // Compute original array index (visual index from TanStack may differ after sort/filter)
    const originalIndex = mergedItems.indexOf(row);
    const rowIndex = originalIndex >= 0 ? originalIndex : _visualIndex;
    const isSynthetic = Boolean(row._isSynthetic);

    // Determine which property this column maps to
    let property: string | null = null;
    let currentValue = '';
    if (columnId === 'name') {
      property = '__name';
      currentValue = row.name || '';
    } else if (columnId === 'maker') {
      property = '__maker';
      currentValue = row.maker || '';
    } else if (columnId.startsWith('prop_')) {
      property = columnId.replace(/^prop_/, '');
      const v = row.properties[property]?.selected.value;
      currentValue = v != null ? String(v) : '';
    }

    if (!property) {
      clearComponentCell();
      openDrawer(data.componentType, row.name, row.maker, rowIndex);
      return;
    }

    if (isSynthetic) {
      // Synthetic rows: open drawer with cell selection but no inline editing
      openDrawer(data.componentType, row.name, row.maker, rowIndex);
      selectAndEditComponentCell(row.name, row.maker, property, currentValue, rowIndex);
      // Immediately cancel edit mode since we can't edit synthetic rows inline
      cancelComponentEdit();
      return;
    }

    // If already editing this exact cell (by rowIndex), let the input handle clicks
    const { selectedCell: currentSel, cellEditMode: currentEdit } = useComponentReviewStore.getState();
    if (currentSel?.rowIndex === rowIndex && currentSel?.property === property && currentEdit) return;

    // Single click: select + open drawer + enter edit mode immediately
    openDrawer(data.componentType, row.name, row.maker, rowIndex);
    selectAndEditComponentCell(row.name, row.maker, property, currentValue, rowIndex);
  }, [data.componentType, mergedItems, openDrawer, selectAndEditComponentCell, clearComponentCell]);

  // Use getState() + ref so this callback is stable regardless of mutation state or typing
  const handleCommitEdit = useCallback(() => {
    const { selectedCell: cell, cellEditValue: editVal, originalCellEditValue: origVal } = useComponentReviewStore.getState();
    if (cell && editVal != null && editVal !== origVal) {
      const queryKey = ['componentReviewData', category, data.componentType] as const;
      const payload = queryClient.getQueryData<ComponentReviewPayload>(queryKey);
      const row = (
        Number.isFinite(Number(cell.rowIndex))
        && cell.rowIndex >= 0
        && payload?.items?.[cell.rowIndex]
      )
        ? payload.items[cell.rowIndex]
        : payload?.items?.find((entry) => entry.name === cell.name && entry.maker === cell.maker);
      const componentIdentityId = toPositiveId(row?.component_identity_id);
      const componentValueId = cell.property.startsWith('__')
        ? undefined
        : toPositiveId(row?.properties?.[cell.property]?.slot_id);
      if (cell.property.startsWith('__')) {
        if (!componentIdentityId) {
          commitComponentEdit();
          return;
        }
      } else if (!componentValueId) {
        commitComponentEdit();
        return;
      }
      overrideMutRef.current.mutate({
        componentType: data.componentType,
        name: cell.name,
        maker: cell.maker,
        property: cell.property,
        value: editVal,
        componentIdentityId,
        componentValueId,
      });
    }
    commitComponentEdit();
  }, [data.componentType, commitComponentEdit, queryClient, category]);

  const columns = useMemo<ColumnDef<ExtendedComponentReviewItem, unknown>[]>(() => {
    const cols: ColumnDef<ExtendedComponentReviewItem, unknown>[] = [
      {
        accessorKey: 'name',
        header: 'Name',
        size: 200,
        cell: ({ row }) => {
          const isSelected = isCellSelected(selectedCell, row.index, '__name');
          const isEditing = isSelected && cellEditMode;
          const isSynthetic = Boolean(row.original._isSynthetic);
          const cellIsPendingAI = isSynthetic || hasActionablePending(row.original.name_tracked);

          if (isEditing && !isSynthetic) {
            return (
              <ComponentEditingCell
                onCommit={handleCommitEdit}
                onCancel={cancelComponentEdit}
                className="w-full px-1 py-0.5 text-[11px] bg-white dark:bg-gray-800 border-0 outline-none ring-2 ring-accent rounded font-semibold"
              />
            );
          }

          return (
            <ReviewValueCell
              state={row.original.name_tracked}
              selected={isSelected}
              valueClassName="font-semibold"
              valueMaxChars={cellIsPendingAI ? 50 : 60}
              showConfidence
              showOverrideBadge
              pendingAI={cellIsPendingAI}
              showLinkedProductBadge={debugLinkedProducts}
              linkedProductCount={row.original.linked_products?.length ?? 0}
              emptyWhenMissing={<span className="font-semibold text-gray-900 dark:text-gray-100">{row.original.name}</span>}
            />
          );
        },
      },
      {
        accessorKey: 'maker',
        header: 'Maker',
        size: 150,
        cell: ({ row }) => {
          const isSelected = isCellSelected(selectedCell, row.index, '__maker');
          const isEditing = isSelected && cellEditMode;
          const isSynthetic = Boolean(row.original._isSynthetic);
          const cellIsPendingAI = isSynthetic || hasActionablePending(row.original.maker_tracked);

          if (isEditing) {
            return (
              <ComponentEditingCell
                onCommit={handleCommitEdit}
                onCancel={cancelComponentEdit}
                className="w-full px-1 py-0.5 text-[11px] bg-white dark:bg-gray-800 border-0 outline-none ring-2 ring-accent rounded"
              />
            );
          }

          return (
            <ReviewValueCell
              state={row.original.maker_tracked}
              selected={isSelected}
              valueMaxChars={40}
              showConfidence
              showOverrideBadge
              pendingAI={cellIsPendingAI}
              showLinkedProductBadge={debugLinkedProducts}
              linkedProductCount={row.original.linked_products?.length ?? 0}
              emptyWhenMissing={<span className="text-gray-700 dark:text-gray-300">{row.original.maker || ''}</span>}
            />
          );
        },
      },
      {
        id: 'aliases',
        header: 'Aliases',
        size: 180,
        accessorFn: (row) => row.aliases.join(', '),
        cell: ({ row }) => {
          const aliases = row.original.aliases;
          if (!aliases || aliases.length === 0) return null;
          return (
            <span className="text-[11px] text-gray-600 dark:text-gray-400 truncate block max-w-[180px]" title={aliases.join(', ')}>
              {aliases.join(', ')}
            </span>
          );
        },
      },
      {
        id: 'linked_products',
        header: 'Products',
        size: 100,
        accessorFn: (row) => row.linked_products?.length ?? 0,
        cell: ({ row }) => {
          const count = row.original.linked_products?.length ?? 0;
          if (count === 0) return <span className="text-[10px] text-gray-400">-</span>;
          const isExpanded = row.getIsExpanded();
          return (
            <button
              onClick={(e) => {
                e.stopPropagation();
                row.toggleExpanded();
              }}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                isExpanded
                  ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-blue-900/30'
              }`}
              title={`${count} linked product${count !== 1 ? 's' : ''} - click to ${isExpanded ? 'collapse' : 'expand'}`}
            >
              <span>{isExpanded ? '\u25BC' : '\u25B6'}</span>
              <span>{count} product{count !== 1 ? 's' : ''}</span>
            </button>
          );
        },
      },
    ];

    for (const propKey of data.property_columns) {
      const propAICount = mergedItems.filter((item) => (
        item._isSynthetic || hasActionablePending(item.properties[propKey])
      )).length;
      const propFlagCount = mergedItems.filter((item) => {
        if (item._isSynthetic) return false;
        const state = item.properties[propKey];
        return Boolean(state?.needs_review) && !hasActionablePending(state);
      }).length;
      cols.push({
        id: `prop_${propKey}`,
        size: 160,
        header: () => (
          <span className="flex items-center gap-1" title={propKey}>
            {humanizeField(propKey)}
            {propAICount > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[9px] text-purple-600 dark:text-purple-400">
                AI {propAICount}
              </span>
            )}
            {propFlagCount > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[9px] text-amber-600 dark:text-amber-400">
                <FlagIcon className="w-2.5 h-2.5" />
                {propFlagCount}
              </span>
            )}
          </span>
        ),
        accessorFn: (row) => {
          const state = row.properties[propKey];
          return state?.selected?.value ?? '';
        },
        cell: ({ row }) => {
          const state = row.original.properties[propKey];
          const isSelected = isCellSelected(selectedCell, row.index, propKey);
          const isEditing = isSelected && cellEditMode;
          const isSynthetic = Boolean(row.original._isSynthetic);

          if (isEditing && !isSynthetic) {
            return (
              <ComponentEditingCell
                onCommit={handleCommitEdit}
                onCancel={cancelComponentEdit}
                className="w-full px-1 py-0.5 text-[11px] bg-white dark:bg-gray-800 border-0 outline-none ring-2 ring-accent rounded"
              />
            );
          }

          const flagCount = state?.needs_review ? (state.reason_codes?.length || 1) : 0;
          const cellIsPendingAI = isSynthetic || hasActionablePending(state);
          return (
            <ReviewValueCell
              state={state}
              selected={isSelected}
              valueMaxChars={28}
              showConfidence
              showOverrideBadge
              flagCount={flagCount}
              pendingAI={cellIsPendingAI}
              showLinkedProductBadge={debugLinkedProducts}
              linkedProductCount={row.original.linked_products?.length ?? 0}
            />
          );
        },
      });
    }

    cols.push({
      id: 'flags',
      header: 'Flags',
      size: 65,
      accessorFn: (row) => row.metrics.flags,
      cell: ({ row }) => {
        const flags = row.original.metrics.flags;
        const isSynthetic = Boolean((row.original as ExtendedComponentReviewItem)._isSynthetic);
        if (isSynthetic) {
          return (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300" title="Pending AI Review">
              AI
            </span>
          );
        }
        if (flags === 0) return <span className="text-green-500 text-xs">0</span>;
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 text-xs rounded hover:bg-amber-200 dark:hover:bg-amber-900/70 cursor-pointer" title="Click to review all flags">
            <FlagIcon className="w-3 h-3" />
            {flags}
          </span>
        );
      },
    });

    cols.push({
      id: 'ai',
      header: 'AI',
      size: 90,
      cell: ({ row }) => {
        const isSynthetic = Boolean((row.original as ExtendedComponentReviewItem)._isSynthetic);
        const hasPending = isSynthetic || pendingAIByComponent.has(row.original.name.toLowerCase());
        return (
          <button
            onClick={(event) => {
              event.stopPropagation();
              runComponentAiMut.mutate();
            }}
            disabled={runComponentAiMut.isPending}
            title={hasPending
              ? 'Run AI review for pending component/list matches (batch run).'
              : 'Run AI review batch for this category.'
            }
            className={`px-2 py-0.5 text-[10px] font-medium rounded text-white disabled:opacity-50 ${
              hasPending
                ? 'bg-purple-600 hover:bg-purple-700'
                : 'bg-indigo-600 hover:bg-indigo-700'
            }`}
          >
            {runComponentAiMut.isPending ? 'Running...' : 'Run AI'}
          </button>
        );
      },
    });

    return cols;
  }, [
    data.property_columns,
    mergedItems,
    pendingAIByComponent,
    runComponentAiMut,
    selectedCell,
    cellEditMode,
    handleCommitEdit,
    cancelComponentEdit,
    debugLinkedProducts,
  ]);

  const selectedItem = useMemo<ExtendedComponentReviewItem | null>(() => {
    if (!drawerOpen || !selectedEntity) return null;
    // Prefer exact rowIndex when it still points to the same identity.
    // If identity changed (rename/maker edit), fallback to identity lookup, then rowIndex.
    if (selectedEntity.rowIndex != null && selectedEntity.rowIndex >= 0 && selectedEntity.rowIndex < mergedItems.length) {
      const byIndex = mergedItems[selectedEntity.rowIndex];
      if (byIndex.name === selectedEntity.name && byIndex.maker === selectedEntity.maker) {
        return byIndex;
      }
      const byIdentity = mergedItems.find((item) => item.name === selectedEntity.name && item.maker === selectedEntity.maker) || null;
      return byIdentity || byIndex || null;
    }
    // Fallback for flag navigation or stale index
    return mergedItems.find((item) => item.name === selectedEntity.name && item.maker === selectedEntity.maker) || null;
  }, [drawerOpen, selectedEntity, mergedItems]);

  return (
    <Tooltip.Provider delayDuration={200}>
      <ComponentReviewPanel category={category} queryClient={queryClient} componentType={data.componentType} />
      <div className={`grid ${drawerOpen && selectedItem ? 'grid-cols-[1fr,340px]' : 'grid-cols-1'} gap-3 min-w-0`}>
        <DataTable
          data={mergedItems}
          columns={columns}
          searchable
          maxHeight="max-h-[calc(100vh-320px)]"
          onCellClick={handleCellClick}
          getRowClassName={(row: ExtendedComponentReviewItem) => {
            if (row._isSynthetic) return 'bg-purple-50 dark:bg-purple-950/30';
            if (pendingAIByComponent.has(row.name.toLowerCase())) return 'bg-purple-50/50 dark:bg-purple-950/20';
            return '';
          }}
          getCanExpand={(row: ExtendedComponentReviewItem) => (row.linked_products?.length ?? 0) > 0}
          renderExpandedRow={(row: ExtendedComponentReviewItem) => {
            if (!row.linked_products || row.linked_products.length === 0) return null;
            return (
              <LinkedProductsList
                products={row.linked_products}
                headerLabel={row.name}
                maxHeight={200}
                defaultExpanded
              />
            );
          }}
        />

        {drawerOpen && selectedItem && (() => {
          const reviewItemsForDrawer = selectedItem._reviewItems
            || pendingAIByComponent.get(selectedItem.name.toLowerCase())
            || (selectedEntity?.name ? pendingAIByComponent.get(selectedEntity.name.toLowerCase()) : undefined)
            || [];
          return (
            <ComponentReviewDrawer
              item={selectedItem}
              componentType={data.componentType}
              category={category}
              onClose={closeDrawer}
              queryClient={queryClient}
              focusedProperty={
                selectedCell?.rowIndex != null
                && selectedEntity?.rowIndex != null
                && selectedCell.rowIndex === selectedEntity.rowIndex
                  ? selectedCell.property
                  : undefined
              }
              rowIndex={selectedEntity?.rowIndex}
              pendingReviewItems={reviewItemsForDrawer}
              isSynthetic={Boolean(selectedItem._isSynthetic)}
              debugLinkedProducts={debugLinkedProducts}
            />
          );
        })()}
      </div>
    </Tooltip.Provider>
  );
}
