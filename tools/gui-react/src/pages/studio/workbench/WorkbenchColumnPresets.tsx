// ── Preset toolbar: preset buttons, column picker, global filter ─────
import { useState, useRef, useEffect } from 'react';
import type { ColumnPreset } from './workbenchTypes';
import { PRESET_LABELS, ALL_COLUMN_IDS_WITH_LABELS } from './workbenchColumns';

interface Props {
  activePreset: ColumnPreset;
  onPreset: (preset: ColumnPreset) => void;
  columnVisibility: Record<string, boolean>;
  onToggleColumn: (id: string) => void;
  globalFilter: string;
  onGlobalFilter: (val: string) => void;
  onSave: () => void;
  onCompile: () => void;
  saving: boolean;
  compiling: boolean;
}

export function WorkbenchColumnPresets({
  activePreset,
  onPreset,
  columnVisibility,
  onToggleColumn,
  globalFilter,
  onGlobalFilter,
  onSave,
  onCompile,
  saving,
  compiling,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close picker on outside click
  useEffect(() => {
    if (!pickerOpen) return;
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [pickerOpen]);

  return (
    <div className="flex items-center gap-2 flex-wrap mb-2">
      {/* Preset buttons */}
      <div className="flex items-center gap-1">
        {PRESET_LABELS.map((p) => (
          <button
            key={p.id}
            onClick={() => onPreset(p.id)}
            className={`px-2 py-1 text-xs rounded font-medium transition-colors ${
              activePreset === p.id
                ? 'bg-accent/10 text-accent border border-accent/30'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border border-transparent'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Column picker */}
      <div className="relative" ref={pickerRef}>
        <button
          onClick={() => setPickerOpen(!pickerOpen)}
          className="px-2 py-1 text-xs rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border border-transparent"
          title="Pick columns"
        >
          Columns ▾
        </button>
        {pickerOpen && (
          <div className="absolute z-30 top-full mt-1 left-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded shadow-lg p-2 w-52 max-h-72 overflow-y-auto">
            {ALL_COLUMN_IDS_WITH_LABELS.map((col) => (
              <label key={col.id} className="flex items-center gap-2 py-0.5 text-xs cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 px-1 rounded">
                <input
                  type="checkbox"
                  checked={columnVisibility[col.id] !== false}
                  onChange={() => onToggleColumn(col.id)}
                  className="rounded border-gray-300"
                />
                {col.label}
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Filter fields..."
        value={globalFilter}
        onChange={(e) => onGlobalFilter(e.target.value)}
        className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 w-44 placeholder:text-gray-400"
      />

      <div className="flex-1" />

      {/* Actions */}
      <button
        onClick={onSave}
        disabled={saving}
        className="px-3 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save'}
      </button>
      <button
        onClick={onCompile}
        disabled={compiling}
        className="px-3 py-1 text-xs bg-accent text-white rounded hover:bg-blue-600 disabled:opacity-50"
      >
        {compiling ? 'Compiling...' : 'Compile'}
      </button>
    </div>
  );
}
