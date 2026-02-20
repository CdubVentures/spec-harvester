// ── WorkbenchTable: dense table with sticky pinned columns ───────────
import { useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type SortingState,
  type ColumnDef,
} from '@tanstack/react-table';
import type { WorkbenchRow } from './workbenchTypes';

interface Props {
  rows: WorkbenchRow[];
  columns: ColumnDef<WorkbenchRow, unknown>[];
  sorting: SortingState;
  onSortingChange: (s: SortingState) => void;
  globalFilter: string;
  columnVisibility: Record<string, boolean>;
  rowSelection: Record<string, boolean>;
  onRowClick: (key: string) => void;
  activeDrawerKey: string | null;
}

const PINNED_IDS = new Set(['select', 'status', 'group', 'displayName']);

export function WorkbenchTable({
  rows,
  columns,
  sorting,
  onSortingChange,
  globalFilter,
  columnVisibility,
  rowSelection,
  onRowClick,
  activeDrawerKey,
}: Props) {
  const table = useReactTable({
    data: rows,
    columns,
    state: {
      sorting,
      globalFilter,
      columnVisibility,
      columnPinning: { left: ['select', 'status', 'group', 'displayName'] },
    },
    enableRowSelection: true,
    getRowId: (row) => row.key,
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater;
      onSortingChange(next);
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: 'includesString',
  });

  // Compute sticky left offsets for pinned columns
  const pinnedOffsets = useMemo(() => {
    const offsets: Record<string, number> = {};
    let left = 0;
    for (const col of table.getLeftLeafColumns()) {
      offsets[col.id] = left;
      left += col.getSize();
    }
    return offsets;
  }, [table, columnVisibility]);

  return (
    <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded" style={{ maxHeight: 'calc(100vh - 380px)' }}>
      <table className="w-full text-xs border-collapse">
        <thead className="sticky top-0 z-20 bg-gray-50 dark:bg-gray-800">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((header) => {
                const isPinned = PINNED_IDS.has(header.column.id);
                return (
                  <th
                    key={header.id}
                    className={`px-2 py-1.5 text-left font-medium text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 whitespace-nowrap select-none ${
                      header.column.getCanSort() ? 'cursor-pointer hover:text-gray-700 dark:hover:text-gray-200' : ''
                    }`}
                    style={{
                      width: header.getSize(),
                      minWidth: header.getSize(),
                      ...(isPinned ? {
                        position: 'sticky',
                        left: pinnedOffsets[header.column.id] ?? 0,
                        zIndex: 21,
                        background: 'inherit',
                      } : {}),
                    }}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    <div className="flex items-center gap-1">
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getIsSorted() === 'asc' ? ' ▲' : ''}
                      {header.column.getIsSorted() === 'desc' ? ' ▼' : ''}
                    </div>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => {
            const isActive = row.original.key === activeDrawerKey;
            const hasError = row.original.hasErrors;
            return (
              <tr
                key={row.id}
                onClick={() => onRowClick(row.original.key)}
                className={`cursor-pointer transition-colors ${
                  isActive
                    ? 'bg-accent/5 dark:bg-accent/10'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                }${hasError ? ' border-l-2 border-l-red-400' : ''}${
                  rowSelection[row.original.key] ? ' bg-blue-50 dark:bg-blue-900/20' : ''
                }`}
              >
                {row.getVisibleCells().map((cell) => {
                  const isPinned = PINNED_IDS.has(cell.column.id);
                  return (
                    <td
                      key={cell.id}
                      className="px-2 py-1.5 border-b border-gray-100 dark:border-gray-800 whitespace-nowrap"
                      style={{
                        width: cell.column.getSize(),
                        minWidth: cell.column.getSize(),
                        ...(isPinned ? {
                          position: 'sticky',
                          left: pinnedOffsets[cell.column.id] ?? 0,
                          zIndex: 10,
                          background: isActive
                            ? undefined
                            : rowSelection[row.original.key]
                              ? undefined
                              : 'var(--wb-cell-bg, white)',
                        } : {}),
                      }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {/* CSS custom property for sticky cell background */}
      <style>{`
        .dark { --wb-cell-bg: #1f2937; }
        :root { --wb-cell-bg: white; }
      `}</style>
    </div>
  );
}
