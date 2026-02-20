import { useState, useMemo, useEffect } from 'react';
import { Tip } from './Tip';
import { TagPicker } from './TagPicker';
import { selectCls, inputCls, labelCls, STUDIO_TIPS, COMPONENT_TYPES } from '../../pages/studio/studioConstants';
import type { SheetPreview, EnumListEntry, ComponentDbItem, ComponentDbResponse } from '../../types/studio';

// ── Types ────────────────────────────────────────────────────────────
interface EnumConfiguratorProps {
  fieldKey: string;
  rule: Record<string, unknown>;
  knownValues: Record<string, string[]>;
  enumLists: EnumListEntry[];
  sheets: SheetPreview[];
  parseTemplate: string;
  componentDb: ComponentDbResponse;
  onUpdate: (path: string, value: unknown) => void;
}

type SourceTab = 'workbook' | 'manual' | 'component';

// ── Template constraints ─────────────────────────────────────────────
// Determines which parts of the Enum section are available based on parse template.
// boolean_yes_no_unk → lock enum to yes/no, disable workbook/component/manual
// number_with_unit / list_of_numbers_with_unit / list_numbers_or_ranges_with_unit → disable enums entirely
// url_field / date_field → disable enums entirely
// text_field / list_of_tokens_delimited / token_list / text_block → full enum config
// component_reference → enable Component DB, optional workbook, manual for suggestions

type TemplateMode = 'boolean' | 'numeric' | 'disabled' | 'full' | 'component';

function getTemplateMode(template: string): TemplateMode {
  if (template === 'boolean_yes_no_unk') return 'boolean';
  if (
    template === 'number_with_unit' ||
    template === 'list_of_numbers_with_unit' ||
    template === 'list_numbers_or_ranges_with_unit'
  ) return 'numeric';
  if (template === 'url_field' || template === 'date_field') return 'disabled';
  if (template === 'component_reference') return 'component';
  return 'full'; // text_field, list_of_tokens_delimited, token_list, text_block, empty
}

function templateModeLabel(mode: TemplateMode): string {
  switch (mode) {
    case 'boolean': return 'Locked to yes/no (boolean template)';
    case 'numeric': return 'Enum disabled (numeric template — values are numbers, not vocabulary)';
    case 'disabled': return 'Enum disabled (url/date template — values are not vocabulary)';
    case 'component': return 'Component reference — enum values come from Component DB';
    case 'full': return '';
  }
}

// ── Helpers ──────────────────────────────────────────────────────────
function getN(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((o: unknown, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}
function strN(obj: Record<string, unknown>, path: string, fallback = ''): string {
  const v = getN(obj, path);
  return v != null ? String(v) : fallback;
}
function numN(obj: Record<string, unknown>, path: string, fallback = 0): number {
  const v = getN(obj, path);
  return typeof v === 'number' ? v : (parseInt(String(v), 10) || fallback);
}
function arrN(obj: Record<string, unknown>, path: string): string[] {
  const v = getN(obj, path);
  return Array.isArray(v) ? v.map(String) : [];
}

function detectSourceTab(source: string, mode: TemplateMode): SourceTab {
  if (mode === 'component') return 'component';
  if (mode === 'boolean') return 'manual';
  if (source.startsWith('data_lists.')) return 'workbook';
  if (source.startsWith('component_db.')) return 'component';
  return 'manual';
}

// ── Chip styles ──────────────────────────────────────────────────────
const chipBase = 'inline-flex items-center px-2 py-0.5 text-xs rounded-full font-medium';
const chipBlue = `${chipBase} bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300`;
const chipAmber = `${chipBase} bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300`;
const chipGreen = `${chipBase} bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300`;
const chipGray = `${chipBase} bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300`;

// ── Tab styles ───────────────────────────────────────────────────────
const tabBase = 'px-3 py-1.5 text-xs font-medium rounded-t relative';
const tabActive = `${tabBase} font-semibold border border-b-0 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 -mb-px z-10`;
const tabInactive = `${tabBase} text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 cursor-pointer`;
const tabDisabled = `${tabBase} text-gray-300 dark:text-gray-600 cursor-not-allowed`;

const dotActive = 'absolute -top-1 -right-1 w-2 h-2 rounded-full';
const dotWorkbook = `${dotActive} bg-blue-500`;
const dotManual = `${dotActive} bg-amber-500`;
const dotComponent = `${dotActive} bg-purple-500`;

// ── Component ────────────────────────────────────────────────────────
export function EnumConfigurator({
  fieldKey,
  rule,
  knownValues,
  enumLists,
  sheets,
  parseTemplate,
  componentDb,
  onUpdate,
}: EnumConfiguratorProps) {
  const currentSource = strN(rule, 'enum.source', strN(rule, 'enum_source'));
  const currentPolicy = strN(rule, 'enum.policy', strN(rule, 'enum_policy', 'open'));
  const matchStrategy = strN(rule, 'enum.match.strategy', 'alias');

  // Template mode determines constraints
  const mode = getTemplateMode(parseTemplate);

  // Find the enum_list entry for this field (if workbook-sourced)
  const existingEnumList = useMemo(
    () => enumLists.find((e) => e.field === fieldKey),
    [enumLists, fieldKey],
  );

  // State
  const [activeTab, setActiveTab] = useState<SourceTab>(() => detectSourceTab(currentSource, mode));
  const [selectedSheet, setSelectedSheet] = useState(() => existingEnumList?.sheet || '');
  const [selectedColumn, setSelectedColumn] = useState(() => existingEnumList?.value_column || '');
  const [headerRowNum, setHeaderRowNum] = useState(() => existingEnumList?.header_row || 1);

  // Reset state when fieldKey changes
  useEffect(() => {
    const source = strN(rule, 'enum.source', strN(rule, 'enum_source'));
    const newMode = getTemplateMode(parseTemplate);
    setActiveTab(detectSourceTab(source, newMode));

    const enumEntry = enumLists.find((e) => e.field === fieldKey);
    setSelectedSheet(enumEntry?.sheet || '');
    setSelectedColumn(enumEntry?.value_column || '');
    setHeaderRowNum(enumEntry?.header_row || 1);
  }, [fieldKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Known values for this field
  const fieldKnownValues = knownValues[fieldKey] || [];
  const additionalValues = arrN(rule, 'enum.additional_values');

  // Sheet data for the selected sheet
  const sheetData = useMemo(() => sheets.find((s) => s.name === selectedSheet), [sheets, selectedSheet]);

  // Find the header row from preview data
  const headerCells = useMemo(() => {
    if (!sheetData?.preview?.rows) return {};
    const hRow = sheetData.preview.rows.find((r) => r.row === headerRowNum);
    return hRow?.cells || {};
  }, [sheetData, headerRowNum]);

  // Column options from the header row (sorted by Excel column position: A,B,...Z,AA,AB...)
  const columnOptions = useMemo(() => {
    const colIdx = (c: string) => {
      let n = 0;
      for (let i = 0; i < c.length; i++) n = n * 26 + (c.charCodeAt(i) - 64);
      return n;
    };
    return Object.entries(headerCells)
      .filter(([, v]) => v != null && String(v).trim() !== '')
      .map(([col, header]) => ({ col, header: String(header) }))
      .sort((a, b) => colIdx(a.col) - colIdx(b.col));
  }, [headerCells]);

  // Preview values from selected sheet+column
  const previewValues = useMemo(() => {
    if (!sheetData?.preview?.rows || !selectedColumn) return [];
    return sheetData.preview.rows
      .filter((r) => r.row > headerRowNum)
      .map((r) => r.cells[selectedColumn])
      .filter((v) => v != null && String(v).trim() !== '')
      .map(String);
  }, [sheetData, selectedColumn, headerRowNum]);

  // Categorize known values: workbook vs discovered
  const workbookValueSet = useMemo(
    () => new Set(previewValues.map((v) => v.toLowerCase().trim())),
    [previewValues],
  );

  // Component DB entities for this field's component type
  const componentType = currentSource.startsWith('component_db.')
    ? currentSource.replace('component_db.', '')
    : strN(rule, 'component.type');
  const componentEntities: ComponentDbItem[] = componentType ? (componentDb[componentType] || []) : [];

  // Which tabs have active data?
  const hasWorkbook = !!existingEnumList || currentSource.startsWith('data_lists.');
  const hasManual = currentSource === 'yes_no' || additionalValues.length > 0 || (mode === 'boolean');
  const hasComponent = currentSource.startsWith('component_db.') || !!strN(rule, 'component.type') || mode === 'component';

  // Tab availability based on template mode
  const workbookTabEnabled = mode === 'full' || mode === 'component';
  const manualTabEnabled = mode === 'full' || mode === 'boolean';
  const componentTabEnabled = mode === 'full' || mode === 'component';

  // ── If enum is fully disabled (numeric/url/date) ───────────────────
  if (mode === 'numeric' || mode === 'disabled') {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 px-3 py-2 rounded bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-xs text-gray-500">{templateModeLabel(mode)}</span>
        </div>
        <div className="grid grid-cols-3 gap-3 opacity-40 pointer-events-none">
          <div>
            <div className={labelCls}>Enum Policy</div>
            <select className={`${selectCls} w-full`} disabled value="open"><option value="open">open</option></select>
          </div>
          <div>
            <div className={labelCls}>Match Strategy</div>
            <select className={`${selectCls} w-full`} disabled value="alias"><option value="alias">alias</option></select>
          </div>
          <div />
        </div>
      </div>
    );
  }

  // ── Boolean mode: locked to yes/no ─────────────────────────────────
  if (mode === 'boolean') {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 px-3 py-2 rounded bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
          <svg className="w-4 h-4 text-blue-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <span className="text-xs text-blue-600 dark:text-blue-400">{templateModeLabel(mode)}</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <div className={labelCls}>Enum Policy<Tip text={STUDIO_TIPS.enum_policy} /></div>
            <select className={`${selectCls} w-full bg-gray-50 dark:bg-gray-700/50`} value="closed" disabled>
              <option value="closed">closed (yes/no)</option>
            </select>
          </div>
          <div>
            <div className={labelCls}>Enum Source</div>
            <select className={`${selectCls} w-full bg-gray-50 dark:bg-gray-700/50`} value="yes_no" disabled>
              <option value="yes_no">yes_no</option>
            </select>
          </div>
          <div>
            <div className={labelCls}>Match Strategy</div>
            <select className={`${selectCls} w-full bg-gray-50 dark:bg-gray-700/50`} value="exact" disabled>
              <option value="exact">exact</option>
            </select>
          </div>
        </div>
        <div>
          <div className={labelCls}>Known Values</div>
          <div className="flex flex-wrap gap-1">
            <span className={chipBlue}>yes</span>
            <span className={chipBlue}>no</span>
          </div>
        </div>
      </div>
    );
  }

  // ── Full mode / Component mode ─────────────────────────────────────

  // ── Handlers ───────────────────────────────────────────────────────
  function handleSheetChange(sheet: string) {
    setSelectedSheet(sheet);
    setSelectedColumn('');
  }

  function handleColumnChange(col: string) {
    setSelectedColumn(col);
    const header = headerCells[col];
    if (header && selectedSheet) {
      const headerName = String(header).trim().toLowerCase().replace(/\s+/g, '_');
      onUpdate('enum.source', `data_lists.${headerName}`);
      onUpdate('enum.excel_hints', {
        sheet: selectedSheet,
        column: col,
        header: String(header).trim(),
        header_row: headerRowNum,
      });
      // Workbook enum with closed policy → select input control
      if (currentPolicy === 'closed') {
        onUpdate('ui.input_control', 'select');
      }
    }
  }

  function handleTabSwitch(tab: SourceTab) {
    if (tab === 'workbook' && !workbookTabEnabled) return;
    if (tab === 'manual' && !manualTabEnabled) return;
    if (tab === 'component' && !componentTabEnabled) return;
    setActiveTab(tab);

    // Cascade input control when switching source tabs
    if (tab === 'component') {
      onUpdate('ui.input_control', 'component_picker');
    } else if (tab === 'workbook' && currentPolicy === 'closed') {
      onUpdate('ui.input_control', 'select');
    } else if (tab === 'manual') {
      onUpdate('ui.input_control', 'text');
    }
  }

  function handleComponentTypeChange(type: string) {
    if (type) {
      onUpdate('enum.source', `component_db.${type}`);
      onUpdate('component.type', type);
      onUpdate('enum.policy', 'open_prefer_known');
      onUpdate('ui.input_control', 'component_picker');
    } else {
      onUpdate('enum.source', '');
    }
  }

  function handleAdditionalValuesChange(values: string[]) {
    onUpdate('enum.additional_values', values);
  }

  return (
    <div className="space-y-4">
      {/* ── Row 1: Policy + Match Settings ──────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <div className={labelCls}>Enum Policy<Tip text={STUDIO_TIPS.enum_policy} /></div>
          <select
            className={`${selectCls} w-full`}
            value={currentPolicy}
            onChange={(e) => onUpdate('enum.policy', e.target.value)}
          >
            <option value="open">open</option>
            <option value="closed">closed</option>
            <option value="open_prefer_known">open_prefer_known</option>
          </select>
        </div>
        <div>
          <div className={labelCls}>Match Strategy<Tip text={STUDIO_TIPS.match_strategy} /></div>
          <select
            className={`${selectCls} w-full`}
            value={matchStrategy}
            onChange={(e) => onUpdate('enum.match.strategy', e.target.value)}
          >
            <option value="alias">alias</option>
            <option value="exact">exact</option>
            <option value="fuzzy">fuzzy</option>
          </select>
        </div>
        {matchStrategy === 'fuzzy' ? (
          <div>
            <div className={labelCls}>Fuzzy Threshold<Tip text={STUDIO_TIPS.fuzzy_threshold} /></div>
            <input
              className={`${inputCls} w-full`}
              type="number"
              step={0.01}
              min={0}
              max={1}
              value={numN(rule, 'enum.match.fuzzy_threshold', 0.92)}
              onChange={(e) => onUpdate('enum.match.fuzzy_threshold', parseFloat(e.target.value) || 0.92)}
            />
          </div>
        ) : (
          <div />
        )}
      </div>

      {/* ── Component mode hint ───────────────────────────────── */}
      {mode === 'component' ? (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800">
          <span className="text-xs text-purple-600 dark:text-purple-400">{templateModeLabel(mode)}</span>
        </div>
      ) : null}

      {/* ── Row 2: Value Source Tabs ─────────────────────────────── */}
      <div>
        <div className={labelCls}>Value Source<Tip text={STUDIO_TIPS.enum_value_source} /></div>
        <div className="flex items-end gap-0.5 border-b border-gray-200 dark:border-gray-700">
          <button
            className={activeTab === 'workbook' ? tabActive : (workbookTabEnabled ? tabInactive : tabDisabled)}
            onClick={() => handleTabSwitch('workbook')}
            disabled={!workbookTabEnabled}
            title={!workbookTabEnabled ? 'Not available for this parse template' : undefined}
          >
            From Workbook Sheet
            {hasWorkbook && workbookTabEnabled ? <span className={dotWorkbook} /> : null}
          </button>
          <button
            className={activeTab === 'manual' ? tabActive : (manualTabEnabled ? tabInactive : tabDisabled)}
            onClick={() => handleTabSwitch('manual')}
            disabled={!manualTabEnabled}
            title={!manualTabEnabled ? 'Not available for this parse template' : undefined}
          >
            Manual Values
            {hasManual && manualTabEnabled ? <span className={dotManual} /> : null}
          </button>
          <button
            className={activeTab === 'component' ? tabActive : (componentTabEnabled ? tabInactive : tabDisabled)}
            onClick={() => handleTabSwitch('component')}
            disabled={!componentTabEnabled}
            title={!componentTabEnabled ? 'Not available for this parse template' : undefined}
          >
            Component DB
            {hasComponent && componentTabEnabled ? <span className={dotComponent} /> : null}
          </button>
        </div>

        <div className="border border-t-0 border-gray-200 dark:border-gray-700 rounded-b p-3 bg-white dark:bg-gray-800">
          {/* ── Option A: From Workbook Sheet ──────────────────── */}
          {activeTab === 'workbook' ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <div className={labelCls}>Sheet</div>
                  <select
                    className={`${selectCls} w-full`}
                    value={selectedSheet}
                    onChange={(e) => handleSheetChange(e.target.value)}
                  >
                    <option value="">Select sheet...</option>
                    {sheets.map((s) => (
                      <option key={s.name} value={s.name}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className={labelCls}>Header Row</div>
                  <input
                    className={`${inputCls} w-full`}
                    type="number"
                    min={1}
                    max={20}
                    value={headerRowNum}
                    onChange={(e) => setHeaderRowNum(parseInt(e.target.value, 10) || 1)}
                  />
                </div>
                <div>
                  <div className={labelCls}>Column</div>
                  <select
                    className={`${selectCls} w-full`}
                    value={selectedColumn}
                    onChange={(e) => handleColumnChange(e.target.value)}
                    disabled={!selectedSheet}
                  >
                    <option value="">Select column...</option>
                    {columnOptions.map(({ col, header }) => (
                      <option key={col} value={col}>{col} &mdash; {header}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Show auto-generated source */}
              {currentSource.startsWith('data_lists.') ? (
                <div className="text-xs text-gray-500">
                  Source: <span className="font-mono text-accent">{currentSource}</span>
                </div>
              ) : null}

              {/* Preview values from sheet column */}
              {previewValues.length > 0 ? (
                <div>
                  <div className="text-xs text-gray-500 mb-1">Detected values from workbook ({previewValues.length}):</div>
                  <div className="flex flex-wrap gap-1">
                    {previewValues.map((v, i) => (
                      <span key={`${v}-${i}`} className={chipBlue}>{v}</span>
                    ))}
                  </div>
                </div>
              ) : selectedSheet && selectedColumn ? (
                <div className="text-xs text-gray-400 italic">No values found in this column (only preview rows are shown).</div>
              ) : null}
            </div>
          ) : null}

          {/* ── Option B: Manual Values ────────────────────────── */}
          {activeTab === 'manual' ? (
            <div className="space-y-3">
              {currentSource === 'yes_no' ? (
                <div className="text-xs text-gray-500 mb-1">
                  Source: <span className="font-mono text-accent">yes_no</span> (boolean enum)
                </div>
              ) : null}

              {/* Manual value entry */}
              <div>
                <div className={labelCls}>
                  Add Values
                  <Tip text={STUDIO_TIPS.enum_add_values} />
                </div>
                <TagPicker
                  values={additionalValues}
                  onChange={handleAdditionalValuesChange}
                  suggestions={fieldKnownValues}
                  placeholder="Type to add values..."
                />
              </div>

              {additionalValues.length > 0 ? (
                <div>
                  <div className="text-xs text-gray-500 mb-1">User-added values ({additionalValues.length}):</div>
                  <div className="flex flex-wrap gap-1">
                    {additionalValues.map((v) => (
                      <span key={v} className={chipGreen}>
                        {v}
                        <span className="ml-1 text-[10px] opacity-70">user-added</span>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* ── Option C: Component DB ─────────────────────────── */}
          {activeTab === 'component' ? (
            <div className="space-y-3">
              <div>
                <div className={labelCls}>Component Type<Tip text={STUDIO_TIPS.component_db} /></div>
                <select
                  className={`${selectCls} w-full`}
                  value={componentType}
                  onChange={(e) => handleComponentTypeChange(e.target.value)}
                >
                  <option value="">(none)</option>
                  {COMPONENT_TYPES.map((ct) => (
                    <option key={ct} value={ct}>{ct}</option>
                  ))}
                </select>
              </div>
              {componentType ? (
                <div className="text-xs text-gray-500">
                  Source: <span className="font-mono text-accent">component_db.{componentType}</span>
                </div>
              ) : null}

              {/* Show actual component entities */}
              {componentEntities.length > 0 ? (
                <div>
                  <div className={labelCls}>
                    Component Entities ({componentEntities.length})
                    <Tip text={STUDIO_TIPS.enum_component_values} />
                  </div>
                  <div className="max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded p-2 space-y-1">
                    {componentEntities.map((ent, i) => (
                      <div key={`${ent.maker}-${ent.name}-${i}`} className="flex items-center gap-2 text-xs">
                        <span className={chipBase + ' bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'}>
                          {ent.maker}
                        </span>
                        <span className="font-medium">{ent.name}</span>
                        {ent.aliases.length > 0 ? (
                          <span className="text-gray-400 italic">({ent.aliases.join(', ')})</span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : componentType ? (
                <div className="text-xs text-gray-400 italic">No entities found for {componentType}.</div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Row 3: Three-tier value display ─────────────────────── */}
      <div className="space-y-3">
        {/* Tier 1: Canonical/Known values (from workbook or component DB) */}
        {fieldKnownValues.length > 0 ? (
          <div>
            <div className={labelCls}>
              Known Values (Canonical) ({fieldKnownValues.length})
              <Tip text={STUDIO_TIPS.enum_detected_values} />
            </div>
            <div className="flex flex-wrap gap-1">
              {fieldKnownValues.map((v) => {
                const fromWorkbook = workbookValueSet.has(v.toLowerCase().trim());
                return (
                  <span key={v} className={fromWorkbook ? chipBlue : chipAmber}>
                    {v}
                    {!fromWorkbook ? (
                      <span className="ml-1 text-[10px] opacity-70">discovered</span>
                    ) : null}
                  </span>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Tier 2: Manual additions (user-added in Studio) — show outside of manual tab too */}
        {additionalValues.length > 0 && activeTab !== 'manual' ? (
          <div>
            <div className={labelCls}>Manual Additions ({additionalValues.length})</div>
            <div className="flex flex-wrap gap-1">
              {additionalValues.map((v) => (
                <span key={v} className={chipGreen}>
                  {v}
                  <span className="ml-1 text-[10px] opacity-70">user-added</span>
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {/* Tier 3: Observed/Pipeline values (discovered but not in canonical) */}
        {fieldKnownValues.length > 0 && previewValues.length > 0 ? (() => {
          const canonical = new Set(previewValues.map(v => v.toLowerCase().trim()));
          const observed = fieldKnownValues.filter(v => !canonical.has(v.toLowerCase().trim()));
          if (observed.length === 0) return null;
          return (
            <div>
              <div className={labelCls}>
                Observed / Pipeline ({observed.length})
                <Tip text={STUDIO_TIPS.enum_observed_values} />
              </div>
              <div className="flex flex-wrap gap-1">
                {observed.map((v) => (
                  <span key={v} className={chipGray}>
                    {v}
                    <span className="ml-1 text-[10px] opacity-70">pipeline</span>
                  </span>
                ))}
              </div>
            </div>
          );
        })() : null}

        {/* Open policy note */}
        {(currentPolicy === 'open' || currentPolicy === 'open_prefer_known') && fieldKnownValues.length > 0 ? (
          <p className="text-xs text-gray-400 italic">
            New values may be added during pipeline runs.
          </p>
        ) : null}
      </div>
    </div>
  );
}
