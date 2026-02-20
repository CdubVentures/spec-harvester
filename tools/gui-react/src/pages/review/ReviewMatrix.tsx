import { useMemo, useRef, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import * as Tooltip from '@radix-ui/react-tooltip';
import { pct } from '../../utils/formatting';
import { isKeyReviewLanePending } from '../../utils/keyReview';
import { InlineCellEditor } from '../../components/common/InlineCellEditor';
import { ReviewValueCell } from '../../components/common/ReviewValueCell';
import { FlagIcon } from '../../components/common/FlagIcon';
import type { ReviewLayout, ProductReviewPayload, CellMode } from '../../types/review';

interface ReviewMatrixProps {
  layout: ReviewLayout;
  products: ProductReviewPayload[];
  onCellClick: (productId: string, field: string) => void;
  activeCell: { productId: string; field: string } | null;
  cellMode: CellMode;
  editingValue: string;
  onEditingValueChange: (value: string) => void;
  onCommitEditing: () => void;
  onCancelEditing: () => void;
  onStartEditing: (productId: string, field: string, initialValue: string) => void;
}

const COL_WIDTH = 170;
const ROW_HEIGHT = 30;
const FIELD_COL_WIDTH = 190;
const HEADER_HEIGHT = 56;

export function ReviewMatrix({
  layout,
  products,
  onCellClick,
  activeCell,
  cellMode,
  editingValue,
  onEditingValueChange,
  onCommitEditing,
  onCancelEditing,
  onStartEditing,
}: ReviewMatrixProps) {
  const rows = layout.rows;
  const parentRef = useRef<HTMLDivElement>(null);

  // Row virtualization
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 15,
  });

  // Column virtualization for products
  const colVirtualizer = useVirtualizer({
    horizontal: true,
    count: products.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => COL_WIDTH,
    overscan: 5,
  });

  // Group tracking for row labels
  const groupMap = useMemo(() => {
    const map = new Map<number, string>();
    let currentGroup = '';
    rows.forEach((row, i) => {
      if (row.group) currentGroup = row.group;
      map.set(i, currentGroup);
    });
    return map;
  }, [rows]);

  // Typing while selected enters edit mode with typed character.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (cellMode !== 'selected' || !activeCell) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.length !== 1) return;
      event.preventDefault();
      onStartEditing(activeCell.productId, activeCell.field, event.key);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cellMode, activeCell, onStartEditing]);

  const totalColWidth = FIELD_COL_WIDTH + colVirtualizer.getTotalSize();

  return (
    <Tooltip.Provider delayDuration={200}>
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <div
          ref={parentRef}
          className="overflow-auto"
          style={{ height: 'calc(100vh - 340px)' }}
        >
          <div style={{ width: totalColWidth, position: 'relative' }}>
            <div
              className="flex bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-20"
              style={{ width: totalColWidth, height: HEADER_HEIGHT }}
            >
              <div
                className="shrink-0 border-r border-gray-200 dark:border-gray-700 px-2 py-1 text-[10px] font-semibold text-gray-500 uppercase flex items-center sticky left-0 z-30 bg-gray-50 dark:bg-gray-800"
                style={{ width: FIELD_COL_WIDTH, minWidth: FIELD_COL_WIDTH }}
              >
                Field
              </div>
              <div style={{ width: colVirtualizer.getTotalSize(), position: 'relative', height: HEADER_HEIGHT }}>
                {colVirtualizer.getVirtualItems().map((vCol) => {
                  const p = products[vCol.index];
                  const dimmed = p.hasRun === false;
                  return (
                    <div
                      key={p.product_id}
                      className={`absolute top-0 border-r border-gray-200 dark:border-gray-700 px-1.5 py-1 text-center flex flex-col justify-center ${dimmed ? 'opacity-40 bg-gray-50 dark:bg-gray-800/50' : ''}`}
                      style={{ width: vCol.size, left: vCol.start, height: HEADER_HEIGHT }}
                    >
                      <div className="text-[11px] font-semibold truncate">{p.identity.brand}</div>
                      <div className="text-[10px] text-gray-500 truncate">{p.identity.model}</div>
                      <div className="text-[9px] text-gray-400 font-mono truncate">
                        {p.identity.id ? `#${p.identity.id}` : '#--'} | {p.identity.identifier ? p.identity.identifier.slice(0, 6) : 'no-id'}
                      </div>
                      <div className="text-[9px] text-gray-400 flex items-center justify-center gap-1">
                        <span>{pct(p.metrics.confidence)}</span>
                        <span>|</span>
                        {p.metrics.flags > 0 ? (
                          <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
                            <FlagIcon className="w-2.5 h-2.5" />
                            {p.metrics.flags}
                          </span>
                        ) : (
                          <span className="text-green-500">0f</span>
                        )}
                        <span>{p.metrics.missing}m</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
              {rowVirtualizer.getVirtualItems().map((vRow) => {
                const row = rows[vRow.index];
                const group = groupMap.get(vRow.index) || '';
                const showGroup = vRow.index === 0 || groupMap.get(vRow.index - 1) !== group;

                return (
                  <div
                    key={row.key}
                    className="absolute flex w-full border-b border-gray-100 dark:border-gray-800"
                    style={{
                      height: ROW_HEIGHT,
                      top: vRow.start,
                      width: totalColWidth,
                    }}
                  >
                    <div
                      className="shrink-0 flex items-center gap-1 border-r border-gray-200 dark:border-gray-700 px-2 bg-white dark:bg-gray-900 sticky left-0 z-[5]"
                      style={{ width: FIELD_COL_WIDTH, minWidth: FIELD_COL_WIDTH }}
                    >
                      {showGroup ? (
                        <span className="text-[8px] text-gray-400 uppercase w-14 truncate" title={group}>
                          {group}
                        </span>
                      ) : (
                        <span className="w-14" />
                      )}
                      <span className="text-[11px] truncate" title={row.label}>
                        {row.label}
                      </span>
                      {(() => {
                        const r = row.field_rule;
                        const parts: string[] = [];
                        parts.push(`Type: ${r.type}`);
                        if (r.required) parts.push('Required');
                        if (r.units) parts.push(`Units: ${r.units}`);
                        if (r.enum_name) parts.push(`Enum: ${r.enum_name}`);
                        return r.required ? (
                          <span
                            className="ml-auto inline-block w-2 h-2 rounded-full bg-red-400 flex-shrink-0 cursor-help"
                            title={parts.join(' · ')}
                          />
                        ) : r.units || r.enum_name ? (
                          <span
                            className="ml-auto inline-block w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600 flex-shrink-0 cursor-help"
                            title={parts.join(' · ')}
                          />
                        ) : null;
                      })()}
                    </div>

                    <div style={{ width: colVirtualizer.getTotalSize(), position: 'relative', height: ROW_HEIGHT }}>
                      {colVirtualizer.getVirtualItems().map((vCol) => {
                        const p = products[vCol.index];
                        const fieldState = p.fields[row.key];
                        const isActive = activeCell?.productId === p.product_id && activeCell?.field === row.key;
                        const isEditing = isActive && cellMode === 'editing';
                        const isSelected = isActive && cellMode === 'selected';
                        const dimmed = p.hasRun === false;
                        // Two-lane pending: derive from keyReview data + layout field_rule
                        // Only show AI badges for products that have run data with actual field state
                        const kr = fieldState?.keyReview;
                        const hasFieldData = p.hasRun !== false && !!fieldState;
                        // Primary (item-level): pending until explicitly confirmed.
                        const hasPendingAIPrimary = hasFieldData && (kr
                          ? isKeyReviewLanePending({
                            status: kr.primaryStatus,
                            userAcceptStatus: kr.userAcceptPrimary,
                            override: kr.overridePrimary,
                          })
                          : true);  // no row = AI review never ran = pending
                        return (
                          <div
                            key={p.product_id}
                            data-product-id={p.product_id}
                            data-field-key={row.key}
                            className={`absolute top-0 flex items-center border-r border-gray-100 dark:border-gray-800 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 ${
                              isEditing
                                ? 'bg-white dark:bg-gray-800'
                                : isSelected
                                  ? 'ring-2 ring-accent ring-inset bg-blue-50 dark:bg-blue-900/30'
                                  : isActive
                                    ? 'ring-2 ring-accent ring-inset bg-blue-50 dark:bg-blue-900/30'
                                    : dimmed
                                      ? 'bg-gray-50 dark:bg-gray-800/50'
                                      : ''
                            }`}
                            style={{ width: vCol.size, left: vCol.start, height: ROW_HEIGHT }}
                            onClick={() => onCellClick(p.product_id, row.key)}
                          >
                            {isEditing ? (
                              <InlineCellEditor
                                value={editingValue}
                                onChange={onEditingValueChange}
                                onCommit={onCommitEditing}
                                onCancel={onCancelEditing}
                                className="w-full h-full px-1 text-[11px] bg-white dark:bg-gray-800 border-0 outline-none ring-2 ring-accent"
                                stopClickPropagation
                              />
                            ) : (
                              <ReviewValueCell
                                state={fieldState}
                                hasRun={p.hasRun}
                                pendingAIPrimary={hasPendingAIPrimary}
                                pendingAIShared={false}
                                className="px-1 w-full"
                                valueClassName="text-[11px]"
                                valueMaxChars={22}
                                unknownLabel="unk"
                                showConfidence
                                showOverrideBadge
                                flagCount={fieldState?.needs_review ? (fieldState.reason_codes?.length || 1) : 0}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </Tooltip.Provider>
  );
}
