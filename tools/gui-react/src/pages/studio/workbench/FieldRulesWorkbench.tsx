// ── FieldRulesWorkbench: top-level orchestrator for Tab 3 ────────────
import { useState, useEffect, useMemo, useCallback } from 'react';
import type { UseMutationResult } from '@tanstack/react-query';
import type { SortingState } from '@tanstack/react-table';
import type { ColumnPreset } from './workbenchTypes';
import type { SheetPreview, EnumListEntry, ComponentDbResponse } from '../../../types/studio';
import type { ProcessStatus } from '../../../types/events';
import { buildWorkbenchRows, setNested } from './workbenchHelpers';
import { buildColumns, getPresetVisibility } from './workbenchColumns';
import { WorkbenchColumnPresets } from './WorkbenchColumnPresets';
import { WorkbenchTable } from './WorkbenchTable';
import { WorkbenchDrawer } from './WorkbenchDrawer';
import { WorkbenchBulkBar } from './WorkbenchBulkBar';

interface Props {
  category: string;
  fieldOrder: string[];
  rules: Record<string, Record<string, unknown>>;
  knownValues: Record<string, string[]>;
  enumLists: EnumListEntry[];
  sheets: SheetPreview[];
  componentDb: ComponentDbResponse;
  wbMap: Record<string, unknown>;
  guardrails?: Record<string, unknown> | null;
  onSaveRules: (rules: Record<string, unknown>) => void;
  saving: boolean;
  saveSuccess: boolean;
  compileMut: UseMutationResult<ProcessStatus, Error, void, unknown>;
}

export function FieldRulesWorkbench({
  category: _category,
  fieldOrder,
  rules,
  knownValues,
  enumLists,
  sheets,
  componentDb,
  wbMap: _wbMap,
  guardrails,
  onSaveRules,
  saving,
  saveSuccess,
  compileMut,
}: Props) {
  // ── Local editable copy of rules ─────────────────────────────────
  const [editedRules, setEditedRules] = useState<Record<string, Record<string, unknown>>>({});
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (Object.keys(rules).length > 0 && !initialized) {
      setEditedRules(JSON.parse(JSON.stringify(rules)));
      setInitialized(true);
    }
  }, [rules, initialized]);

  const currentRules = Object.keys(editedRules).length > 0 ? editedRules : rules;

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
    () => buildWorkbenchRows(fieldOrder, currentRules, guardrails, knownValues),
    [fieldOrder, currentRules, guardrails, knownValues],
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

  // ── updateField with full coupling logic (same as KeyNavigator) ──
  const updateField = useCallback((key: string, path: string, value: unknown) => {
    setEditedRules((prev) => {
      const next = { ...prev };
      const rule = { ...(next[key] || {}) };

      setNested(rule, path, value);

      // Flat mirror properties
      if (path === 'contract.type') { rule.type = value; rule.data_type = value; }
      if (path === 'contract.shape') { rule.shape = value; rule.output_shape = value; rule.value_form = value; }
      if (path === 'contract.unit') { rule.unit = value; }
      if (path === 'priority.required_level') rule.required_level = value;
      if (path === 'priority.availability') rule.availability = value;
      if (path === 'priority.difficulty') rule.difficulty = value;
      if (path === 'priority.effort') rule.effort = value;
      if (path === 'priority.publish_gate') rule.publish_gate = value;
      if (path === 'evidence.required') rule.evidence_required = value;
      if (path === 'evidence.min_evidence_refs') rule.min_evidence_refs = value;
      if (path === 'enum.policy') rule.enum_policy = value;
      if (path === 'enum.source') rule.enum_source = value;
      if (path === 'parse.template') rule.parse_template = value;
      if (path === 'ui.group') rule.group = value;
      if (path === 'ui.label') rule.display_name = value;

      // Parse Template → Enum + UI coupling
      if (path === 'parse.template') {
        const tpl = String(value || '');
        if (tpl === 'boolean_yes_no_unk') {
          setNested(rule, 'enum.policy', 'closed');
          setNested(rule, 'enum.source', 'yes_no');
          setNested(rule, 'enum.match.strategy', 'exact');
          rule.enum_policy = 'closed'; rule.enum_source = 'yes_no';
          setNested(rule, 'ui.input_control', 'text');
        } else if (tpl === 'component_reference') {
          const COMP_MAP: Record<string, string> = { sensor: 'sensor', switch: 'switch', encoder: 'encoder', material: 'material' };
          const compType = COMP_MAP[key] || '';
          if (compType) {
            setNested(rule, 'component.type', compType);
            setNested(rule, 'enum.source', `component_db.${compType}`);
            rule.enum_source = `component_db.${compType}`;
          }
          setNested(rule, 'enum.policy', 'open_prefer_known');
          setNested(rule, 'enum.match.strategy', 'alias');
          rule.enum_policy = 'open_prefer_known';
          setNested(rule, 'ui.input_control', 'component_picker');
        } else if (['number_with_unit', 'list_of_numbers_with_unit', 'list_numbers_or_ranges_with_unit'].includes(tpl)) {
          setNested(rule, 'enum.policy', 'open');
          setNested(rule, 'enum.source', null);
          rule.enum_policy = 'open'; rule.enum_source = '';
          setNested(rule, 'ui.input_control', 'number');
        } else if (tpl === 'url_field') {
          setNested(rule, 'enum.policy', 'open');
          setNested(rule, 'enum.source', null);
          rule.enum_policy = 'open'; rule.enum_source = '';
          setNested(rule, 'ui.input_control', 'url');
        } else if (tpl === 'date_field') {
          setNested(rule, 'enum.policy', 'open');
          setNested(rule, 'enum.source', null);
          rule.enum_policy = 'open'; rule.enum_source = '';
          setNested(rule, 'ui.input_control', 'date');
        } else if (tpl === 'list_of_tokens_delimited' || tpl === 'token_list') {
          setNested(rule, 'ui.input_control', 'multi_select');
        }
      }

      // Enum source → UI coupling
      if (path === 'enum.source') {
        const src = String(value || '');
        if (src.startsWith('component_db.')) {
          setNested(rule, 'ui.input_control', 'component_picker');
        } else if (src === 'yes_no') {
          setNested(rule, 'ui.input_control', 'text');
        } else if (src.startsWith('data_lists.')) {
          const pol = String((rule.enum as Record<string, unknown>)?.policy || rule.enum_policy || 'open');
          setNested(rule, 'ui.input_control', pol === 'closed' ? 'select' : 'text');
        }
      }

      // Enum policy → UI coupling
      if (path === 'enum.policy') {
        const pol = String(value || 'open');
        const src = String((rule.enum as Record<string, unknown>)?.source || rule.enum_source || '');
        if (src.startsWith('data_lists.') && pol === 'closed') {
          setNested(rule, 'ui.input_control', 'select');
        } else if (src.startsWith('component_db.')) {
          setNested(rule, 'ui.input_control', 'component_picker');
        }
      }

      // Priority/difficulty/effort → auto-generate reasoning note
      if (['priority.required_level', 'priority.difficulty', 'priority.effort'].includes(path)) {
        const ai = (rule.ai_assist || {}) as Record<string, unknown>;
        const explicitMode = String(ai.mode || '');
        // Only auto-generate if no explicit AI mode override is set
        if (!explicitMode) {
          const rl = String((rule.priority as Record<string, unknown>)?.required_level || rule.required_level || 'expected');
          const diff = String((rule.priority as Record<string, unknown>)?.difficulty || rule.difficulty || 'easy');
          const eff = Number((rule.priority as Record<string, unknown>)?.effort || rule.effort || 3);
          let derivedMode = 'off';
          if (['identity', 'required', 'critical'].includes(rl)) derivedMode = 'judge';
          else if (rl === 'expected' && diff === 'hard') derivedMode = 'planner';
          else if (rl === 'expected') derivedMode = 'advisory';
          const maxCalls = eff <= 3 ? 1 : eff <= 6 ? 2 : 3;
          const note = derivedMode === 'off'
            ? `${rl} field - LLM extraction skipped (deterministic only)`
            : `${rl}/${diff} field (effort ${eff}) - auto: ${derivedMode}, budget ${maxCalls} call${maxCalls > 1 ? 's' : ''}`;
          setNested(rule, 'ai_assist.reasoning_note', note);
        }
      }

      // Component type → enum source coupling
      if (path === 'component.type') {
        const ct = String(value || '');
        if (ct) {
          setNested(rule, 'enum.source', `component_db.${ct}`);
          rule.enum_source = `component_db.${ct}`;
        }
      }

      rule._edited = true;
      next[key] = rule;
      return next;
    });
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
    onSaveRules(editedRules);
  }, [editedRules, onSaveRules]);

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
  const drawerRule = drawerKey ? (currentRules[drawerKey] || null) : null;
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
          fieldOrder={fieldOrder}
          knownValues={knownValues}
          enumLists={enumLists}
          sheets={sheets}
          componentDb={componentDb}
          onUpdate={updateField}
          onClose={() => setDrawerKey(null)}
          onNavigate={(key) => setDrawerKey(key)}
        />
      )}
    </div>
  );
}
