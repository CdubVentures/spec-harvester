import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getExpandedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ExpandedState,
  type Row,
} from '@tanstack/react-table';
import { useState, useCallback, memo, Fragment, type ReactNode } from 'react';

interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  searchable?: boolean;
  maxHeight?: string;
  onRowClick?: (row: T) => void;
  onCellClick?: (row: T, columnId: string, rowIndex: number) => void;
  getRowClassName?: (row: T) => string;
  /** When provided, rows become expandable. Return content for the expanded area, or null to hide. */
  renderExpandedRow?: (row: T) => ReactNode | null;
  /** Control which rows can expand. Defaults to all rows when renderExpandedRow is set. */
  getCanExpand?: (row: T) => boolean;
}

function DataTableInner<T>({
  data,
  columns,
  searchable = false,
  maxHeight = 'max-h-[600px]',
  onRowClick,
  onCellClick,
  getRowClassName,
  renderExpandedRow,
  getCanExpand,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [expanded, setExpanded] = useState<ExpandedState>({});

  const canExpandRow = useCallback(
    (row: Row<T>) => {
      if (!renderExpandedRow) return false;
      if (getCanExpand) return getCanExpand(row.original);
      return true;
    },
    [renderExpandedRow, getCanExpand],
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, expanded },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onExpandedChange: setExpanded,
    getRowCanExpand: canExpandRow,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    ...(renderExpandedRow ? { getExpandedRowModel: getExpandedRowModel() } : {}),
  });

  const totalVisibleCols = table.getVisibleFlatColumns().length;

  return (
    <div>
      {searchable && (
        <input
          type="text"
          placeholder="Search..."
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="mb-2 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 w-full max-w-xs"
        />
      )}
      <div className={`overflow-auto ${maxHeight} border border-gray-200 dark:border-gray-700 rounded`}>
        <table className="min-w-full text-sm" style={{ tableLayout: 'fixed' }}>
          <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => {
                  const colSize = header.column.columnDef.size;
                  return (
                    <th
                      key={header.id}
                      className="px-2 py-1.5 text-left text-[10px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer select-none"
                      style={colSize ? { width: colSize, minWidth: colSize } : undefined}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <div className="flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {{ asc: ' \u25B2', desc: ' \u25BC' }[header.column.getIsSorted() as string] ?? ''}
                      </div>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {table.getRowModel().rows.map((row) => {
              const isExpanded = row.getIsExpanded();
              const expandedContent = isExpanded && renderExpandedRow ? renderExpandedRow(row.original) : null;
              return (
                <Fragment key={row.id}>
                  <tr
                    className={`hover:bg-gray-50 dark:hover:bg-gray-800 ${onRowClick || onCellClick ? 'cursor-pointer' : ''} ${getRowClassName?.(row.original) || ''}`}
                    onClick={onCellClick ? undefined : () => onRowClick?.(row.original)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className="px-2 py-1.5 whitespace-nowrap overflow-hidden"
                        onClick={onCellClick ? (e) => {
                          e.stopPropagation();
                          onCellClick(row.original, cell.column.id, row.index);
                        } : undefined}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                  {expandedContent && (
                    <tr className="bg-gray-50/50 dark:bg-gray-800/30">
                      <td colSpan={totalVisibleCols} className="px-3 py-2">
                        {expandedContent}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {table.getRowModel().rows.length === 0 && (
          <div className="text-center py-8 text-gray-400 text-sm">No data</div>
        )}
      </div>
    </div>
  );
}

// Memoize so parent re-renders (e.g. from store subscriptions) don't cascade
// through the entire table and cause editing inputs to lose focus.
export const DataTable = memo(DataTableInner) as typeof DataTableInner;
