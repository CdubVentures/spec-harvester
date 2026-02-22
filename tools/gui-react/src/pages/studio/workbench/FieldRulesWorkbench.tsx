// ── FieldRulesWorkbench: top-level orchestrator for Tab 3 ────────────
import { useState, useMemo, useCallback } from 'react';
import type { UseMutationResult } from '@tanstack/react-query';
import type { SortingState } from '@tanstack/react-table';
import type { ColumnPreset } from './workbenchTypes';
import type { EnumEntry, ComponentDbResponse, ComponentSource } from '../../../types/studio';
import type { ProcessStatus } from '../../../types/events';
import { buildWorkbenchRows } from './workbenchHelpers';
import { buildColumns, getPresetVisibility } from './workbenchColumns';
import { WorkbenchColumnPresets } from './WorkbenchColumnPresets';
import { WorkbenchTable } from './WorkbenchTable';
import { WorkbenchDrawer } from './WorkbenchDrawer';
import { WorkbenchBulkBar } from './WorkbenchBulkBar';
import { useFieldRulesStore } from '../useFieldRulesStore';

interface Props {
  category: string;
  knownValues: Record<string, string[]>;
  enumLists: EnumEntry[];
  componentDb: ComponentDbResponse;
  componentSources: ComponentSource[];
  wbMap: Record<string, unknown>;
  guardrails?: Record<string, unknown> | null;
  onSave: () => void;
  saving: boolean;
  saveSuccess: boolean;
  compileMut: UseMutationResult<ProcessStatus, Error, void, unknown>;
}

export function FieldRulesWorkbench({
  category: _category,
  knownValues,
  enumLists,
  componentDb,
  componentSources,
  wbMap: _wbMap,
  guardrails,
  onSave,
  saving,
  saveSuccess,
  compileMut,
}: Props) {
  const { editedRules, editedFieldOrder, updateField } = useFieldRulesStore();

  // ── Table state ──────────────────────────────────────────────────
  const [activePreset, setActivePreset] = useState<ColumnPreset>('minimal');
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(
    () => getPresetVisibility('minimal') || {},
  );
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [editingCell, setEditingCell] = useState<{ key: string; column: string } | null>(null);
  const [drawerKey, setDrawerKey] = useState<string | null>(null);

  // ── Build rows ───────────────────────────────────────────────────
  const rows = useMemo(
    () => buildWorkbenchRows(editedFieldOrder, editedRules, guardrails, knownValues),
    [editedFieldOrder, editedRules, guardrails, knownValues],
  );

  // ── Preset change ────────────────────────────────────────────────
  const handlePreset = useCallback((preset: ColumnPreset) => {
    setActivePreset(preset);
    const vis = getPresetVisibility(preset);
    setColumnVisibility(vis || {});
  }, []);

  const handleToggleColumn = useCallback((id: string) => {
    setColumnVisibility((prev) => ({ ...prev, [id]: prev[id] === false ? true : false }));
    setActivePreset('all'); // switch to "all" since we're manually overriding
  }, []);

  // ── Inline edit handlers ─────────────────────────────────────────
  const handleInlineCommit = useCallback((key: string, column: string, value: unknown) => {
    const pathMap: Record<string, string> = {
      requiredLevel: 'priority.required_level',
      parseTemplate: 'parse.template',
      enumPolicy: 'enum.policy',
      publishGate: 'priority.publish_gate',
      aiMode: 'ai_assist.mode',
      aiModelStrategy: 'ai_assist.model_strategy',
      aiMaxCalls: 'ai_assist.max_calls',
    };
    const path = pathMap[column];
    if (path) updateField(key, path, value);
    setEditingCell(null);
  }, [updateField]);

  // ── Row selection ────────────────────────────────────────────────
  const selectedCount = Object.values(rowSelection).filter(Boolean).length;

  const handleToggleRow = useCallback((key: string) => {
    setRowSelection((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleToggleAll = useCallback(() => {
    if (selectedCount === rows.length) {
      setRowSelection({});
    } else {
      const all: Record<string, boolean> = {};
      for (const r of rows) all[r.key] = true;
      setRowSelection(all);
    }
  }, [rows, selectedCount]);

  // ── Bulk apply ───────────────────────────────────────────────────
  const handleBulkApply = useCallback((field: string, value: unknown) => {
    const selectedKeys = Object.entries(rowSelection).filter(([, v]) => v).map(([k]) => k);
    for (const key of selectedKeys) {
      updateField(key, field, value);
    }
    setRowSelection({});
  }, [rowSelection, updateField]);

  // ── Save ─────────────────────────────────────────────────────────
  const handleSave = useCallback(() => {
    onSave();
  }, [onSave]);

  // ── Build columns ────────────────────────────────────────────────
  const columns = useMemo(
    () => buildColumns(
      editingCell,
      setEditingCell,
      handleInlineCommit,
      rowSelection,
      handleToggleRow,
      handleToggleAll,
      selectedCount === rows.length && rows.length > 0,
    ),
    [editingCell, handleInlineCommit, rowSelection, handleToggleRow, handleToggleAll, selectedCount, rows.length],
  );

  // ── Drawer ───────────────────────────────────────────────────────
  const drawerRule = drawerKey ? (editedRules[drawerKey] || null) : null;
  const drawerOpen = drawerKey !== null && drawerRule !== null;

  return (
    <div className={`grid ${drawerOpen ? 'grid-cols-[1fr,480px]' : 'grid-cols-1'} gap-3`}>
      <div className="overflow-hidden">
        <WorkbenchColumnPresets
          activePreset={activePreset}
          onPreset={handlePreset}
          columnVisibility={columnVisibility}
          onToggleColumn={handleToggleColumn}
          globalFilter={globalFilter}
          onGlobalFilter={setGlobalFilter}
          onSave={handleSave}
          onCompile={() => compileMut.mutate()}
          saving={saving}
          compiling={compileMut.isPending}
        />

        {saveSuccess && <div className="text-xs text-green-600 mb-1">Saved successfully</div>}

        <WorkbenchTable
          rows={rows}
          columns={columns}
          sorting={sorting}
          onSortingChange={setSorting}
          globalFilter={globalFilter}
          columnVisibility={columnVisibility}
          rowSelection={rowSelection}
          onRowClick={(key) => setDrawerKey(key === drawerKey ? null : key)}
          activeDrawerKey={drawerKey}
        />

        {selectedCount > 0 && (
          <WorkbenchBulkBar
            selectedCount={selectedCount}
            onApply={handleBulkApply}
            onClear={() => setRowSelection({})}
          />
        )}
      </div>

      {drawerOpen && drawerKey && drawerRule && (
        <WorkbenchDrawer
          fieldKey={drawerKey}
          rule={drawerRule}
          fieldOrder={editedFieldOrder}
          knownValues={knownValues}
          enumLists={enumLists}
          componentDb={componentDb}
          componentSources={componentSources}
          onClose={() => setDrawerKey(null)}
          onNavigate={(key) => setDrawerKey(key)}
        />
      )}
    </div>
  );
}
