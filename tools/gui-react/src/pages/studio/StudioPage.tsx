import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Tooltip from '@radix-ui/react-tooltip';
import { api } from '../../api/client';
import { useUiStore } from '../../stores/uiStore';
import { useRuntimeStore } from '../../stores/runtimeStore';
import { DataTable } from '../../components/common/DataTable';
import { JsonViewer } from '../../components/common/JsonViewer';
import { Spinner } from '../../components/common/Spinner';
import { Tip } from '../../components/common/Tip';
import { ComboSelect } from '../../components/common/ComboSelect';
import { TagPicker } from '../../components/common/TagPicker';
import { TierPicker } from '../../components/common/TierPicker';
import { ColumnPicker } from '../../components/common/ColumnPicker';
import { EnumConfigurator } from '../../components/common/EnumConfigurator';
import { humanizeField } from '../../utils/fieldNormalize';
import { FieldRulesWorkbench } from './workbench/FieldRulesWorkbench';
import { WorkbookContextTab } from './WorkbookContextTab';
import {
  selectCls, inputCls, labelCls,
  UNITS, UNKNOWN_TOKENS, GROUPS, COMPONENT_TYPES,
  PREFIXES, SUFFIXES, AZ_COLUMNS,
  DOMAIN_HINT_SUGGESTIONS, CONTENT_TYPE_SUGGESTIONS, UNIT_ACCEPTS_SUGGESTIONS,
  STUDIO_TIPS, NORMALIZE_MODES,
} from './studioConstants';
import type {
  FieldRule,
  StudioPayload,
  WorkbookMapResponse,
  WorkbookMap,
  IntrospectResult,
  SheetPreview,
  TooltipBankResponse,
  DraftsResponse,
  ArtifactEntry,
  ComponentSource,
  WorkbookContextResponse,
  KnownValuesResponse,
  EnumListEntry,
  DataListEntry,
  ComponentDbResponse,
  PriorityProfile,
  AiAssistConfig,
} from '../../types/studio';
import type { ProcessStatus } from '../../types/events';
import type { ColumnDef } from '@tanstack/react-table';

// ── Shared styles ───────────────────────────────────────────────────
const btnPrimary = 'px-4 py-2 text-sm bg-accent text-white rounded hover:bg-blue-600 disabled:opacity-50';
const btnSecondary = 'px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50';
const btnDanger = 'px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50';
const sectionCls = 'bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4';

// ── Field Rule Table Columns ────────────────────────────────────────
interface FieldRuleRow {
  key: string;
  label: string;
  group: string;
  type: string;
  required: string;
  unit: string;
  enumName: string;
}

const fieldRuleColumns: ColumnDef<FieldRuleRow, unknown>[] = [
  { accessorKey: 'key', header: 'Field', cell: ({ getValue }) => humanizeField(getValue() as string), size: 180 },
  { accessorKey: 'group', header: 'Group', size: 120 },
  { accessorKey: 'type', header: 'Type', size: 80 },
  { accessorKey: 'required', header: 'Required', size: 80 },
  { accessorKey: 'unit', header: 'Unit', size: 80 },
  { accessorKey: 'enumName', header: 'Enum', size: 100 },
];

// ── Role definitions ────────────────────────────────────────────────
const ROLE_DEFS = [
  { id: 'aliases', label: 'Name Variants (Aliases)' },
  { id: 'maker', label: 'Maker (Brand)' },
  { id: 'links', label: 'Reference URLs (Links)' },
  { id: 'properties', label: 'Attributes (Properties)' },
] as const;

type RoleId = typeof ROLE_DEFS[number]['id'];

// ── Property row type ───────────────────────────────────────────────
interface PropertyMapping {
  field_key: string;
  column: string;
  column_header: string;
  mode: 'auto' | 'manual';
  variance_policy: 'authoritative' | 'upper_bound' | 'lower_bound' | 'range' | 'override_allowed';
  tolerance: number | null;
  constraints: string[];
  // Legacy (migration only):
  key?: string;
  type?: string;
  unit?: string;
  // Manual mode overrides:
  manual_header?: string;
  manual_type?: string;
  manual_unit?: string;
}

const VARIANCE_POLICIES = [
  { value: 'authoritative', label: 'Authoritative' },
  { value: 'upper_bound', label: 'Upper Bound' },
  { value: 'lower_bound', label: 'Lower Bound' },
  { value: 'range', label: 'Range (±tolerance)' },
  { value: 'override_allowed', label: 'Override Allowed' },
] as const;

const PROPERTY_TYPES = [
  { value: 'string', label: 'string' },
  { value: 'number', label: 'number' },
  { value: 'boolean_yes_no_unk', label: 'boolean (yes/no/unk)' },
  { value: 'date_field', label: 'date' },
  { value: 'url_field', label: 'url' },
] as const;

// Legacy property key → product field key mapping (used during migration)
const LEGACY_PROPERTY_MAP: Record<string, string> = {
  max_dpi: 'dpi',
  max_ips: 'ips',
  max_acceleration: 'acceleration',
  switch_force: 'click_force',
  polling_rate: 'polling_rate',
};

const DEFAULT_PRIORITY_PROFILE: Required<PriorityProfile> = {
  required_level: 'expected',
  availability: 'expected',
  difficulty: 'medium',
  effort: 3,
};

const PRIORITY_REQUIRED_LEVELS = ['identity', 'required', 'critical', 'expected', 'optional', 'editorial', 'commerce'];
const PRIORITY_AVAILABILITY_LEVELS = ['always', 'expected', 'sometimes', 'rare', 'editorial_only'];
const PRIORITY_DIFFICULTY_LEVELS = ['easy', 'medium', 'hard', 'instrumented'];
const REQUIRED_LEVEL_RANK: Record<string, number> = {
  identity: 6,
  critical: 5,
  required: 4,
  expected: 3,
  optional: 2,
  editorial: 1,
  commerce: 1,
};
const AVAILABILITY_RANK: Record<string, number> = {
  always: 5,
  expected: 4,
  sometimes: 3,
  rare: 2,
  editorial_only: 1,
};
const DIFFICULTY_RANK: Record<string, number> = {
  easy: 1,
  medium: 2,
  hard: 3,
  instrumented: 4,
};
const LIST_FIELD_ALIASES: Record<string, string[]> = {
  polling: ['polling_rate'],
  switches: ['switch'],
};

function normalizePriorityProfile(value: unknown): Required<PriorityProfile> {
  const input = (value && typeof value === 'object') ? value as Record<string, unknown> : {};
  const required_level = String(input.required_level || DEFAULT_PRIORITY_PROFILE.required_level);
  const availability = String(input.availability || DEFAULT_PRIORITY_PROFILE.availability);
  const difficulty = String(input.difficulty || DEFAULT_PRIORITY_PROFILE.difficulty);
  const effortRaw = Number.parseInt(String(input.effort ?? DEFAULT_PRIORITY_PROFILE.effort), 10);
  return {
    required_level: PRIORITY_REQUIRED_LEVELS.includes(required_level)
      ? required_level
      : DEFAULT_PRIORITY_PROFILE.required_level,
    availability: PRIORITY_AVAILABILITY_LEVELS.includes(availability)
      ? availability
      : DEFAULT_PRIORITY_PROFILE.availability,
    difficulty: PRIORITY_DIFFICULTY_LEVELS.includes(difficulty)
      ? difficulty
      : DEFAULT_PRIORITY_PROFILE.difficulty,
    effort: Math.max(1, Math.min(10, Number.isFinite(effortRaw) ? effortRaw : DEFAULT_PRIORITY_PROFILE.effort)),
  };
}

function hasExplicitPriority(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.required_level !== undefined
    || v.availability !== undefined
    || v.difficulty !== undefined
    || v.effort !== undefined;
}

function pickRankedToken(tokens: string[], rankMap: Record<string, number>, fallback: string): string {
  let best = fallback;
  let bestRank = rankMap[fallback] ?? 0;
  for (const token of tokens) {
    const rank = rankMap[token] ?? 0;
    if (rank > bestRank) {
      best = token;
      bestRank = rank;
    }
  }
  return best;
}

function resolveRulePriority(rule: FieldRule | undefined): Required<PriorityProfile> {
  const priority = (rule?.priority && typeof rule.priority === 'object')
    ? (rule.priority as Record<string, unknown>)
    : {};
  return normalizePriorityProfile({
    required_level: priority.required_level ?? rule?.required_level,
    availability: priority.availability ?? rule?.availability,
    difficulty: priority.difficulty ?? rule?.difficulty,
    effort: priority.effort ?? rule?.effort,
  });
}

function derivePriorityFromRuleKeys(ruleKeys: string[], rules: Record<string, FieldRule>): Required<PriorityProfile> {
  const priorities = ruleKeys
    .map((key) => rules[key])
    .filter(Boolean)
    .map((rule) => resolveRulePriority(rule));

  if (priorities.length === 0) {
    return { ...DEFAULT_PRIORITY_PROFILE };
  }

  const requiredLevels = priorities.map((p) => p.required_level);
  const availabilities = priorities.map((p) => p.availability);
  const difficulties = priorities.map((p) => p.difficulty);
  const effort = Math.max(...priorities.map((p) => Number(p.effort || DEFAULT_PRIORITY_PROFILE.effort)));

  return normalizePriorityProfile({
    required_level: pickRankedToken(requiredLevels, REQUIRED_LEVEL_RANK, DEFAULT_PRIORITY_PROFILE.required_level),
    availability: pickRankedToken(availabilities, AVAILABILITY_RANK, DEFAULT_PRIORITY_PROFILE.availability),
    difficulty: pickRankedToken(difficulties, DIFFICULTY_RANK, DEFAULT_PRIORITY_PROFILE.difficulty),
    effort,
  });
}

function deriveComponentSourcePriority(source: ComponentSource, rules: Record<string, FieldRule>): Required<PriorityProfile> {
  const keys = new Set<string>();
  const typeToken = String(source.type || source.component_type || '').trim();
  if (typeToken && rules[typeToken]) {
    keys.add(typeToken);
  }

  const properties = Array.isArray(source.roles?.properties) ? source.roles?.properties : [];
  for (const property of properties || []) {
    const fieldKey = String(property?.field_key || property?.key || '').trim();
    if (fieldKey && rules[fieldKey]) {
      keys.add(fieldKey);
    }
  }

  if (keys.size === 0 && typeToken) {
    const fallback = Object.keys(rules).find((k) => k.toLowerCase() === typeToken.toLowerCase());
    if (fallback) keys.add(fallback);
  }

  return derivePriorityFromRuleKeys(Array.from(keys), rules);
}

function deriveListPriority(field: string, rules: Record<string, FieldRule>): Required<PriorityProfile> {
  const key = String(field || '').trim();
  const candidates = [key, ...(LIST_FIELD_ALIASES[key] || [])];
  const matched = candidates.find((candidate) => candidate && rules[candidate]);
  if (!matched) return { ...DEFAULT_PRIORITY_PROFILE };
  return derivePriorityFromRuleKeys([matched], rules);
}

const AI_MODES = ['off', 'advisory', 'planner', 'judge'];
const AI_MODEL_STRATEGIES = ['auto', 'force_fast', 'force_deep'];

function normalizeAiAssistConfig(value: unknown): Required<AiAssistConfig> {
  const input = (value && typeof value === 'object') ? value as Record<string, unknown> : {};
  const modeToken = String(input.mode || '').trim().toLowerCase();
  const strategyToken = String(input.model_strategy || 'auto').trim().toLowerCase();
  const maxCallsRaw = Number.parseInt(String(input.max_calls ?? ''), 10);
  const maxTokensRaw = Number.parseInt(String(input.max_tokens ?? ''), 10);
  return {
    mode: AI_MODES.includes(modeToken) ? modeToken : null,
    model_strategy: AI_MODEL_STRATEGIES.includes(strategyToken) ? strategyToken : 'auto',
    max_calls: Number.isFinite(maxCallsRaw) && maxCallsRaw > 0 ? Math.max(1, Math.min(10, maxCallsRaw)) : null,
    max_tokens: Number.isFinite(maxTokensRaw) && maxTokensRaw > 0 ? Math.max(256, Math.min(65536, maxTokensRaw)) : null,
    reasoning_note: String(input.reasoning_note || ''),
  };
}

function deriveAiModeFromPriority(priority: Required<PriorityProfile>): string {
  const reqLvl = priority.required_level;
  const diff = priority.difficulty;
  if (['identity', 'required', 'critical'].includes(reqLvl)) return 'judge';
  if (reqLvl === 'expected' && diff === 'hard') return 'planner';
  if (reqLvl === 'expected') return 'advisory';
  return 'off';
}

function deriveAiCallsFromEffort(effort: number): number {
  if (effort <= 3) return 1;
  if (effort <= 6) return 2;
  return 3;
}

function migrateProperty(p: Record<string, unknown>, _rules: Record<string, FieldRule>): PropertyMapping {
  const legacyKey = String(p.key || p.field_key || '');
  const fieldKey = String(p.field_key || LEGACY_PROPERTY_MAP[legacyKey] || legacyKey);
  return {
    field_key: fieldKey,
    column: String(p.column || ''),
    column_header: String(p.column_header || ''),
    mode: (p.mode === 'manual' ? 'manual' : 'auto') as 'auto' | 'manual',
    variance_policy: (['authoritative', 'upper_bound', 'lower_bound', 'range', 'override_allowed'].includes(String(p.variance_policy || ''))
      ? String(p.variance_policy)
      : 'authoritative') as PropertyMapping['variance_policy'],
    tolerance: p.tolerance != null ? Number(p.tolerance) : null,
    constraints: Array.isArray(p.constraints) ? p.constraints.map(String) : [],
    key: legacyKey || undefined,
    type: p.type ? String(p.type) : undefined,
    unit: p.unit ? String(p.unit) : undefined,
  };
}

function autoMatchColumn(
  fieldKey: string,
  rule: FieldRule,
  headerOptions: { col: string; header: string }[]
): { col: string; header: string; score: number } | null {
  const ui = rule.ui || {};
  const aliases = Array.isArray(ui.aliases) ? ui.aliases.map(String) : [];
  const candidates = [
    fieldKey,
    fieldKey.replace(/_/g, ' '),
    ui.label ? String(ui.label) : '',
    ...aliases,
  ].filter(Boolean).map((s) => s.toLowerCase());

  let best: { col: string; header: string; score: number } | null = null;
  for (const { col, header } of headerOptions) {
    const hNorm = header.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const hText = header.toLowerCase();
    for (const candidate of candidates) {
      const cNorm = candidate.replace(/[^a-z0-9]+/g, '_');
      if (cNorm === hNorm || candidate === hText) {
        return { col, header, score: 1.0 };
      }
      if (hNorm.includes(cNorm) || cNorm.includes(hNorm)) {
        const score = Math.min(cNorm.length, hNorm.length) / Math.max(cNorm.length, hNorm.length);
        if (!best || score > best.score) best = { col, header, score };
      }
    }
  }
  return best && best.score >= 0.5 ? best : null;
}

// Excel column letter → numeric index (A=1, B=2, ..., Z=26, AA=27, ...)
function colToIdx(c: string): number {
  let n = 0;
  for (let i = 0; i < c.length; i++) n = n * 26 + (c.charCodeAt(i) - 64);
  return n;
}

// Build header map from sheet preview: { col: 'B', header: 'Brand' }[]
function buildHeaderOptions(sheets: SheetPreview[], sheetName: string, headerRow = 1) {
  const sheet = sheets.find((s) => s.name === sheetName);
  if (!sheet?.preview?.rows) return [];
  const hRow = sheet.preview.rows.find((r) => r.row === headerRow);
  if (!hRow?.cells) return [];
  return Object.entries(hRow.cells)
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([col, header]) => ({ col, header: String(header) }))
    .sort((a, b) => colToIdx(a.col) - colToIdx(b.col));
}

// Header-aware column select: shows "C — Sensor" instead of just "C"
function HeaderColumnSelect({
  value,
  onChange,
  headerOptions,
  placeholder = '(select)',
  allowEmpty = false,
}: {
  value: string;
  onChange: (col: string) => void;
  headerOptions: { col: string; header: string }[];
  placeholder?: string;
  allowEmpty?: boolean;
}) {
  return (
    <select
      className={`${selectCls} w-full`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {allowEmpty ? <option value="">{placeholder}</option> : null}
      {headerOptions.map(({ col, header }) => (
        <option key={col} value={col}>
          {col} — {header}
        </option>
      ))}
    </select>
  );
}

// ── Tabs ────────────────────────────────────────────────────────────
const subTabs = [
  { id: 'mapping', label: '1) Mapping Studio' },
  { id: 'keys', label: '2) Key Navigator' },
  { id: 'contract', label: '3) Field Contract' },
  { id: 'context', label: '4) Workbook Context' },
  { id: 'reports', label: '5) Compile & Reports' },
];

// ── Default empty component source ──────────────────────────────────
function emptyComponentSource(): ComponentSource {
  return {
    sheet: '',
    component_type: '',
    header_row: 1,
    first_data_row: 2,
    stop_after_blank_primary: 10,
    auto_derive_aliases: true,
    roles: {
      primary_identifier: 'A',
      maker: '',
      aliases: [],
      links: [],
      properties: [],
    },
    priority: { ...DEFAULT_PRIORITY_PROFILE },
    ai_assist: normalizeAiAssistConfig(undefined),
  };
}

function emptyComponentSourceForScratch(): ComponentSource {
  return {
    sheet: '',
    component_type: '',
    header_row: 1,
    first_data_row: 2,
    stop_after_blank_primary: 10,
    auto_derive_aliases: true,
    roles: {
      primary_identifier: 'A',
      maker: 'B',
      aliases: [],
      links: [],
      properties: [],
    },
    priority: { ...DEFAULT_PRIORITY_PROFILE },
    ai_assist: normalizeAiAssistConfig(undefined),
  };
}

// ────────────────────────────────────────────────────────────────────
export function StudioPage() {
  const category = useUiStore((s) => s.category);
  const [activeTab, setActiveTab] = useState('mapping');
  const [selectedKey, setSelectedKey] = useState('');
  const setProcessStatus = useRuntimeStore((s) => s.setProcessStatus);
  const queryClient = useQueryClient();

  // ── Queries ─────────────────────────────────────────────────────
  const { data: studio, isLoading } = useQuery({
    queryKey: ['studio', category],
    queryFn: () => api.get<StudioPayload>(`/studio/${category}/payload`),
  });

  const { data: wbMapRes } = useQuery({
    queryKey: ['studio-workbook-map', category],
    queryFn: () => api.get<WorkbookMapResponse>(`/studio/${category}/workbook-map`),
  });

  const { data: introspect } = useQuery({
    queryKey: ['studio-introspect', category],
    queryFn: () => api.get<IntrospectResult>(`/studio/${category}/introspect`),
    enabled: activeTab === 'mapping' || activeTab === 'context' || activeTab === 'keys',
  });

  const { data: tooltipBank } = useQuery({
    queryKey: ['studio-tooltip-bank', category],
    queryFn: () => api.get<TooltipBankResponse>(`/studio/${category}/tooltip-bank`),
    enabled: activeTab === 'mapping',
  });

  const { data: drafts } = useQuery({
    queryKey: ['studio-drafts', category],
    queryFn: () => api.get<DraftsResponse>(`/studio/${category}/drafts`),
    enabled: activeTab === 'contract' || activeTab === 'keys',
  });

  const { data: artifacts } = useQuery({
    queryKey: ['studio-artifacts', category],
    queryFn: () => api.get<ArtifactEntry[]>(`/studio/${category}/artifacts`),
    enabled: activeTab === 'reports',
  });

  const { data: contextData, isLoading: contextLoading } = useQuery({
    queryKey: ['workbook-context', category],
    queryFn: () => api.get<WorkbookContextResponse>(`/workbook/${category}/context`),
    enabled: activeTab === 'context',
  });

  const { data: knownValuesRes } = useQuery({
    queryKey: ['studio-known-values', category],
    queryFn: () => api.get<KnownValuesResponse>(`/studio/${category}/known-values`),
    enabled: activeTab === 'mapping' || activeTab === 'keys' || activeTab === 'contract' || activeTab === 'context',
  });

  const { data: componentDbRes } = useQuery({
    queryKey: ['studio-component-db', category],
    queryFn: () => api.get<ComponentDbResponse>(`/studio/${category}/component-db`),
    enabled: activeTab === 'keys' || activeTab === 'contract' || activeTab === 'context',
  });

  // ── Invalidate studio queries when any process finishes ────────
  const processStatus = useRuntimeStore((s) => s.processStatus);
  useEffect(() => {
    if (!processStatus.running && processStatus.exitCode !== undefined) {
      // Studio's own data
      queryClient.invalidateQueries({ queryKey: ['studio', category] });
      queryClient.invalidateQueries({ queryKey: ['studio-known-values', category] });
      queryClient.invalidateQueries({ queryKey: ['studio-component-db', category] });
      queryClient.invalidateQueries({ queryKey: ['studio-artifacts', category] });
      queryClient.invalidateQueries({ queryKey: ['studio-introspect', category] });
      // Downstream views that depend on compiled rules
      queryClient.invalidateQueries({ queryKey: ['catalog', category] });
      queryClient.invalidateQueries({ queryKey: ['reviewProductsIndex', category] });
      queryClient.invalidateQueries({ queryKey: ['reviewLayout', category] });
      queryClient.invalidateQueries({ queryKey: ['componentReviewData', category] });
      queryClient.invalidateQueries({ queryKey: ['componentReviewLayout', category] });
      queryClient.invalidateQueries({ queryKey: ['enumReviewData', category] });
      queryClient.invalidateQueries({ queryKey: ['product', category] });
    }
  }, [processStatus.running, processStatus.exitCode, category]);

  // ── Mutations ───────────────────────────────────────────────────
  const compileMut = useMutation({
    mutationFn: () => api.post<ProcessStatus>(`/studio/${category}/compile`),
    onSuccess: (data) => setProcessStatus(data),
  });

  const validateRulesMut = useMutation({
    mutationFn: () => api.post<ProcessStatus>(`/studio/${category}/validate-rules`),
    onSuccess: (data) => setProcessStatus(data),
  });

  const saveMapMut = useMutation({
    mutationFn: (body: WorkbookMap) => api.put<unknown>(`/studio/${category}/workbook-map`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['studio-workbook-map', category] });
      queryClient.invalidateQueries({ queryKey: ['studio-introspect', category] });
    },
  });

  const saveDraftsMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<unknown>(`/studio/${category}/save-drafts`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['studio-drafts', category] }),
  });

  // ── Derived data ────────────────────────────────────────────────
  const rules = studio?.fieldRules || {};
  const fieldOrder = studio?.fieldOrder || Object.keys(rules);
  const wbMap = wbMapRes?.map || ({} as WorkbookMap);
  const sheets = introspect?.sheets || [];
  const sheetNames = sheets.map((s) => s.name);

  const fieldRows: FieldRuleRow[] = useMemo(
    () =>
      fieldOrder.map((key) => {
        const rule = rules[key] || {};
        return {
          key,
          label: rule.label || key,
          group: rule.group || '',
          type: rule.contract?.type || 'string',
          required: rule.required_level || '',
          unit: rule.contract?.unit || '',
          enumName: rule.enum_name || '',
        };
      }),
    [rules, fieldOrder],
  );

  // ── Compile errors/warnings from guardrails ─────────────────────
  const compileErrors: string[] = [];
  const compileWarnings: string[] = [];
  if (studio?.guardrails) {
    const g = studio.guardrails as Record<string, unknown>;
    if (Array.isArray(g.errors)) compileErrors.push(...(g.errors as string[]));
    if (Array.isArray(g.warnings)) compileWarnings.push(...(g.warnings as string[]));
  }

  // ── Tooltip coverage ────────────────────────────────────────────
  const tooltipEntries = tooltipBank?.entries || {};
  const tooltipCount = Object.keys(tooltipEntries).length;
  const tooltipCoverage = fieldOrder.length > 0
    ? Math.round((fieldOrder.filter((k) => k in tooltipEntries).length / fieldOrder.length) * 100)
    : 0;

  // ── Category guard ────────────────────────────────────────────
  if (category === 'all') {
    return <p className="text-gray-500 mt-8 text-center">Select a specific category from the sidebar to configure field rules.</p>;
  }

  // ── Loading state ───────────────────────────────────────────────
  if (isLoading) return <Spinner className="h-8 w-8 mx-auto mt-12" />;

  return (
    <Tooltip.Provider delayDuration={300}>
    <div className="space-y-4">
      {/* Header metrics */}
      <div className="grid grid-cols-4 gap-3">
        <div className={sectionCls}>
          <div className={labelCls}>Category</div>
          <div className="text-lg font-semibold">{category}</div>
        </div>
        <div className={sectionCls}>
          <div className={labelCls}>Contract Keys</div>
          <div className="text-lg font-semibold">{fieldOrder.length}</div>
        </div>
        <div className={sectionCls}>
          <div className={labelCls}>Compile Errors</div>
          <div className={`text-lg font-semibold ${compileErrors.length > 0 ? 'text-red-600' : 'text-green-600'}`}>
            {compileErrors.length}
          </div>
        </div>
        <div className={sectionCls}>
          <div className={labelCls}>Compile Warnings</div>
          <div className={`text-lg font-semibold ${compileWarnings.length > 0 ? 'text-yellow-600' : 'text-green-600'}`}>
            {compileWarnings.length}
          </div>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => saveDraftsMut.mutate({ fieldRulesDraft: drafts?.fieldRulesDraft, uiFieldCatalogDraft: drafts?.uiFieldCatalogDraft })}
          disabled={saveDraftsMut.isPending}
          className={btnSecondary}
        >
          {saveDraftsMut.isPending ? 'Saving...' : 'Save Draft'}
        </button>
        <button
          onClick={() => compileMut.mutate()}
          disabled={compileMut.isPending}
          className={btnPrimary}
        >
          {compileMut.isPending ? 'Starting...' : 'Compile & Generate Artifacts'}
        </button>
        {compileMut.isSuccess ? <span className="text-sm text-green-600">Compile started — check Indexing Lab process output</span> : null}
        {compileMut.isError ? <span className="text-sm text-red-600">{(compileMut.error as Error)?.message || 'Failed'}</span> : null}
        <button onClick={() => queryClient.invalidateQueries()} className={btnSecondary}>Refresh</button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        {subTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 text-sm font-medium border-b-2 ${
              activeTab === tab.id
                ? 'border-accent text-accent'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab 1: Mapping Studio ────────────────────────────────── */}
      {activeTab === 'mapping' ? (
        <MappingStudioTab
          wbMap={wbMap}
          sheets={sheets}
          sheetNames={sheetNames}
          tooltipCount={tooltipCount}
          tooltipCoverage={tooltipCoverage}
          tooltipFiles={tooltipBank?.files || []}
          onSaveMap={(map) => saveMapMut.mutate(map)}
          saving={saveMapMut.isPending}
          saveSuccess={saveMapMut.isSuccess}
          introspectError={introspect?.error}
          rules={rules}
          fieldOrder={fieldOrder}
          knownValues={knownValuesRes?.fields || {}}
        />
      ) : null}

      {/* ── Tab 2: Key Navigator ─────────────────────────────────── */}
      {activeTab === 'keys' ? (
        <KeyNavigatorTab
          category={category}
          fieldOrder={fieldOrder}
          rules={rules}
          selectedKey={selectedKey}
          onSelectKey={setSelectedKey}
          onSaveRules={(updatedRules) => saveDraftsMut.mutate({ fieldRulesDraft: { fields: updatedRules } })}
          saving={saveDraftsMut.isPending}
          saveSuccess={saveDraftsMut.isSuccess}
          knownValues={knownValuesRes?.fields || {}}
          enumLists={(wbMap.enum_lists || []) as EnumListEntry[]}
          sheets={sheets}
          componentDb={componentDbRes || {}}
        />
      ) : null}

      {/* ── Tab 3: Field Contract (Workbench) ─────────────────────── */}
      {activeTab === 'contract' ? (
        <FieldRulesWorkbench
          category={category}
          fieldOrder={fieldOrder}
          rules={rules}
          knownValues={knownValuesRes?.fields || {}}
          enumLists={(wbMap.enum_lists || []) as EnumListEntry[]}
          sheets={sheets}
          componentDb={componentDbRes || {}}
          wbMap={wbMap}
          guardrails={studio?.guardrails as Record<string, unknown> | undefined}
          onSaveRules={(updatedRules) => saveDraftsMut.mutate({ fieldRulesDraft: { fields: updatedRules } })}
          saving={saveDraftsMut.isPending}
          saveSuccess={saveDraftsMut.isSuccess}
          compileMut={compileMut}
        />
      ) : null}

      {/* ── Tab 4: Workbook Context ──────────────────────────────── */}
      {activeTab === 'context' ? (
        <WorkbookContextTab
          contextData={contextData}
          isLoading={contextLoading}
          fieldRulesKeys={fieldOrder}
          knownValues={knownValuesRes?.fields || {}}
          componentDb={componentDbRes || {}}
          wbMap={wbMap}
          onEditMapping={() => setActiveTab('mapping')}
        />
      ) : null}

      {/* ── Tab 5: Compile & Reports ─────────────────────────────── */}
      {activeTab === 'reports' ? (
        <CompileReportsTab
          artifacts={artifacts || []}
          compileErrors={compileErrors}
          compileWarnings={compileWarnings}
          guardrails={studio?.guardrails}
          compileMut={compileMut}
          validateRulesMut={validateRulesMut}
        />
      ) : null}

    </div>
    </Tooltip.Provider>
  );
}

// ════════════════════════════════════════════════════════════════════
// Tab Components
// ════════════════════════════════════════════════════════════════════

// ── Mapping Studio ──────────────────────────────────────────────────
function MappingStudioTab({
  wbMap,
  sheets,
  sheetNames,
  tooltipCount,
  tooltipCoverage,
  tooltipFiles,
  onSaveMap,
  saving,
  saveSuccess,
  introspectError,
  rules,
  fieldOrder,
  knownValues,
}: {
  wbMap: WorkbookMap;
  sheets: SheetPreview[];
  sheetNames: string[];
  tooltipCount: number;
  tooltipCoverage: number;
  tooltipFiles: string[];
  onSaveMap: (map: WorkbookMap) => void;
  saving: boolean;
  saveSuccess: boolean;
  introspectError?: string;
  rules: Record<string, FieldRule>;
  fieldOrder: string[];
  knownValues: Record<string, string[]>;
}) {
  // ── Local editable state, seeded from server data ──────────────
  const [workbookPath, setWorkbookPath] = useState('');
  const [keySheet, setKeySheet] = useState('');
  const [keyColumn, setKeyColumn] = useState('B');
  const [keyRowStart, setKeyRowStart] = useState(9);
  const [keyRowEnd, setKeyRowEnd] = useState(83);
  const [prodSheet, setProdSheet] = useState('');
  const [prodLayout, setProdLayout] = useState('matrix');
  const [valueColStart, setValueColStart] = useState('C');
  const [valueColEnd, setValueColEnd] = useState('');
  const [brandRow, setBrandRow] = useState(3);
  const [modelRow, setModelRow] = useState(4);
  const [variantRow, setVariantRow] = useState(5);
  const [idRow, setIdRow] = useState(0);
  const [identifierRow, setIdentifierRow] = useState(0);
  const [tooltipPath, setTooltipPath] = useState('');
  const [compSources, setCompSources] = useState<ComponentSource[]>([]);
  const [dataLists, setDataLists] = useState<DataListEntry[]>([]);
  const [seededVersion, setSeededVersion] = useState('');

  // Scratch mode: no workbook loaded (no sheets detected)
  const isScratch = sheets.length === 0;

  // Seed from server data once loaded — use workbook_path as version key
  // to detect when real data has arrived (empty map has no workbook_path)
  const mapVersion = wbMap.workbook_path || '';
  useEffect(() => {
    // Only seed when we have actual data (workbook_path exists) and haven't seeded this version
    if (!mapVersion || seededVersion === mapVersion) return;
    const kl = wbMap.key_list || {};
    const pt = wbMap.product_table || {};
    setWorkbookPath(wbMap.workbook_path || '');
    setKeySheet(kl.sheet || '');
    setKeyColumn(kl.column || 'B');
    setKeyRowStart(kl.row_start || 9);
    setKeyRowEnd(kl.row_end || 83);
    setProdSheet(pt.sheet || '');
    setProdLayout(pt.layout || 'matrix');
    setValueColStart(pt.value_col_start || 'C');
    setValueColEnd(pt.value_col_end || '');
    setBrandRow(pt.brand_row || 3);
    setModelRow(pt.model_row || 4);
    setVariantRow(pt.variant_row || 5);
    setIdRow(pt.id_row || 0);
    setIdentifierRow(pt.identifier_row || 0);
    setTooltipPath(wbMap.tooltip_source?.path || '');
    const sources = wbMap.component_sources || wbMap.component_sheets || [];
    const normalizedCompSources = (Array.isArray(sources) ? sources : []).map((src) => {
      const source = (src || {}) as ComponentSource;
      const inferredPriority = deriveComponentSourcePriority(source, rules);
      return {
        ...source,
        priority: hasExplicitPriority(source.priority)
          ? normalizePriorityProfile(source.priority)
          : inferredPriority,
        ai_assist: normalizeAiAssistConfig(source.ai_assist),
      } as ComponentSource;
    });
    setCompSources(normalizedCompSources);
    // Seed data lists: prefer data_lists when available, otherwise derive from enum_lists + manual_enum_values.
    const rawDataLists = Array.isArray((wbMap as Record<string, unknown>).data_lists)
      ? ((wbMap as Record<string, unknown>).data_lists as DataListEntry[])
      : [];
    if (rawDataLists.length > 0) {
      setDataLists(rawDataLists.map((dl) => ({
        field: dl.field || '',
        mode: dl.mode === 'scratch' ? 'scratch' : 'workbook',
        sheet: dl.sheet || '',
        value_column: dl.value_column || '',
        header_row: dl.header_row || 0,
        row_start: dl.row_start || 2,
        row_end: dl.row_end || 0,
        normalize: dl.normalize || 'lower_trim',
        delimiter: dl.delimiter || '',
        manual_values: Array.isArray(dl.manual_values) ? dl.manual_values : [],
        priority: hasExplicitPriority(dl.priority)
          ? normalizePriorityProfile(dl.priority)
          : deriveListPriority(dl.field || '', rules),
        ai_assist: normalizeAiAssistConfig(dl.ai_assist),
      })));
    } else {
      const rawEnumLists = Array.isArray(wbMap.enum_lists) ? wbMap.enum_lists as EnumListEntry[] : [];
      const manualEnumValues = (wbMap as Record<string, unknown>).manual_enum_values as Record<string, string[]> | undefined;
      const manualMap = manualEnumValues && typeof manualEnumValues === 'object' ? manualEnumValues : {};
      const seenFields = new Set<string>();
      const seededLists: DataListEntry[] = [];
      for (const el of rawEnumLists) {
        seenFields.add(el.field);
        seededLists.push({
          field: el.field,
          mode: 'workbook',
          sheet: el.sheet || '',
          value_column: el.value_column || '',
          header_row: el.header_row || 0,
          row_start: el.row_start || 2,
          row_end: el.row_end || 0,
          normalize: el.normalize || 'lower_trim',
          delimiter: el.delimiter || '',
          manual_values: Array.isArray(manualMap[el.field]) ? manualMap[el.field] : [],
          priority: hasExplicitPriority(el.priority)
            ? normalizePriorityProfile(el.priority)
            : deriveListPriority(el.field, rules),
          ai_assist: normalizeAiAssistConfig(el.ai_assist),
        });
      }
      for (const [field, values] of Object.entries(manualMap)) {
        if (!seenFields.has(field) && Array.isArray(values) && values.length > 0) {
          seededLists.push({
            field,
            mode: 'scratch',
            sheet: '',
            value_column: '',
            header_row: 0,
            row_start: 2,
            row_end: 0,
            normalize: 'lower_trim',
            delimiter: '',
            manual_values: values,
            priority: { ...DEFAULT_PRIORITY_PROFILE },
            ai_assist: normalizeAiAssistConfig(undefined),
          });
        }
      }
      setDataLists(seededLists);
    }
    setSeededVersion(mapVersion);
  }, [wbMap, mapVersion, seededVersion, rules]);

  // Combine sheet names: from introspection + from existing map
  const allSheetNames = useMemo(() => {
    const set = new Set<string>(sheetNames);
    if (keySheet) set.add(keySheet);
    if (prodSheet) set.add(prodSheet);
    for (const cs of compSources) {
      if (cs.sheet) set.add(cs.sheet);
    }
    return [...set].sort();
  }, [sheetNames, keySheet, prodSheet, compSources]);

  // ── Assemble workbook map for saving ──────────────────────────
  const assembleMap = useCallback((): WorkbookMap => {
    const scratchKeyRowStart = 7;
    const scratchKeyRowEnd = fieldOrder.length > 0 ? 6 + fieldOrder.length : 0;
    return {
      ...wbMap,
      workbook_path: workbookPath,
      key_list: {
        ...(wbMap.key_list || {}),
        sheet: keySheet,
        column: isScratch ? 'A' : keyColumn,
        row_start: isScratch ? scratchKeyRowStart : keyRowStart,
        row_end: isScratch ? scratchKeyRowEnd : keyRowEnd,
        source: 'column_range',
      },
      product_table: {
        ...(wbMap.product_table || {}),
        sheet: prodSheet,
        layout: isScratch ? 'matrix' : prodLayout,
        value_col_start: isScratch ? 'B' : valueColStart,
        value_col_end: isScratch ? undefined : (valueColEnd || undefined),
        id_row: isScratch ? 2 : idRow,
        identifier_row: isScratch ? 3 : identifierRow,
        brand_row: isScratch ? 4 : brandRow,
        model_row: isScratch ? 5 : modelRow,
        variant_row: isScratch ? 6 : variantRow,
        key_column: isScratch ? 'A' : keyColumn,
      },
      tooltip_source: {
        path: tooltipPath,
      },
      component_sources: compSources.map((src) => ({
        ...src,
        priority: normalizePriorityProfile(src.priority),
        ai_assist: normalizeAiAssistConfig(src.ai_assist),
      })),
      component_sheets: [],
      data_lists: dataLists.map((dl) => ({
        ...dl,
        priority: normalizePriorityProfile(dl.priority),
        ai_assist: normalizeAiAssistConfig(dl.ai_assist),
      })),
      enum_lists: dataLists
        .filter(dl => dl.mode === 'workbook' && dl.field && dl.sheet && dl.value_column)
        .map(dl => ({
          field: dl.field,
          sheet: dl.sheet,
          value_column: dl.value_column,
          header_row: dl.header_row,
          row_start: dl.row_start,
          row_end: dl.row_end,
          normalize: dl.normalize,
          delimiter: dl.delimiter,
          priority: normalizePriorityProfile(dl.priority),
          ai_assist: normalizeAiAssistConfig(dl.ai_assist),
        })),
      manual_enum_values: Object.fromEntries(
        dataLists
          .filter(dl => dl.field && dl.manual_values.length > 0)
          .map(dl => [dl.field, dl.manual_values])
      ),
    };
  }, [wbMap, workbookPath, keySheet, keyColumn, keyRowStart, keyRowEnd, prodSheet, prodLayout, valueColStart, valueColEnd, idRow, identifierRow, brandRow, modelRow, variantRow, tooltipPath, compSources, dataLists, isScratch, fieldOrder]);

  function handleSave() {
    onSaveMap(assembleMap());
  }

  // ── Component source handlers ─────────────────────────────────
  function addComponentSource() {
    const isScratch = sheets.length === 0;
    setCompSources((prev) => [...prev, isScratch ? emptyComponentSourceForScratch() : emptyComponentSource()]);
  }

  function removeComponentSource(idx: number) {
    setCompSources((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateComponentSource(idx: number, updates: Partial<ComponentSource>) {
    setCompSources((prev) =>
      prev.map((src, i) => (i === idx ? { ...src, ...updates } : src))
    );
  }

  // ── Data list handlers ──────────────────────────────────────────
  function addDataList() {
    setDataLists((prev) => [...prev, {
      field: '',
      mode: sheets.length > 0 ? 'workbook' : 'scratch',
      sheet: '',
      value_column: '',
      header_row: 0,
      row_start: 2,
      row_end: 0,
      normalize: 'lower_trim',
      delimiter: '',
      manual_values: [],
      priority: { ...DEFAULT_PRIORITY_PROFILE },
      ai_assist: normalizeAiAssistConfig(undefined),
    }]);
  }

  function removeDataList(idx: number) {
    setDataLists((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateDataList(idx: number, updates: Partial<DataListEntry>) {
    setDataLists((prev) =>
      prev.map((dl, i) => (i === idx ? { ...dl, ...updates } : dl))
    );
  }

  // Detect duplicate field names in data lists
  const duplicateDataListFields = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const dl of dataLists) {
      if (dl.field) counts[dl.field] = (counts[dl.field] || 0) + 1;
    }
    return new Set(Object.keys(counts).filter(k => counts[k] > 1));
  }, [dataLists]);

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500">
        Configure workbook key source, product sampling, tooltip source, and component mappings. All changes are local until you click "Save Mapping".
      </p>

      {introspectError ? (
        <div className="text-sm bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 p-3 rounded border border-yellow-200 dark:border-yellow-700">
          Workbook introspection: {introspectError}
        </div>
      ) : null}

      {/* Workbook path */}
      <div className={sectionCls}>
        <h3 className="text-sm font-semibold mb-3">Workbook File<Tip text={STUDIO_TIPS.workbook_file} /></h3>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={workbookPath}
            onChange={(e) => setWorkbookPath(e.target.value)}
            className={`${inputCls} flex-1 font-mono text-xs`}
            placeholder="helper_files/{category}/_source/workbook.xlsx"
          />
          {sheets.length > 0 ? (
            <span className="text-xs text-green-600">{sheets.length} sheets detected</span>
          ) : null}
        </div>
      </div>

      {/* Key Source */}
      <div className={sectionCls}>
        <h3 className="text-sm font-semibold mb-3">
          Key Source Configuration
          {isScratch && <span className="ml-2 text-[10px] font-normal bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded">scratch</span>}
        </h3>
        {isScratch ? (
          <div className="grid grid-cols-4 gap-3">
            {/* Unified sheet name (shared with product sampling) */}
            <div className="col-span-2">
              <div className={labelCls}>Sheet Name</div>
              <ComboSelect
                value={keySheet}
                onChange={(v: string) => { setKeySheet(v); setProdSheet(v); }}
                options={allSheetNames}
                placeholder="e.g. dataEntry"
              />
              <div className="text-[10px] text-gray-400 mt-0.5">Keys and products share the same sheet</div>
            </div>
            {/* Key Column — locked to A */}
            <div>
              <div className={labelCls}>Key Column</div>
              <div className={`${inputCls} w-full bg-gray-100 dark:bg-gray-700 cursor-not-allowed`}>
                A <span className="text-[10px] text-gray-400">(locked)</span>
              </div>
            </div>
            {/* First Key Row — auto-computed */}
            <div>
              <div className={labelCls}>First Key Row</div>
              <div className={`${inputCls} w-full bg-gray-100 dark:bg-gray-700 cursor-not-allowed`}>
                7 <span className="text-[10px] text-gray-400">(after metadata)</span>
              </div>
            </div>
            {/* Last Key Row — auto-computed */}
            <div className="col-span-2">
              <div className={labelCls}>Last Key Row</div>
              <div className={`${inputCls} w-full bg-gray-100 dark:bg-gray-700 cursor-not-allowed`}>
                {fieldOrder.length > 0 ? 6 + fieldOrder.length : '(auto)'}
                <span className="text-[10px] text-gray-400 ml-1">{fieldOrder.length} keys</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-3">
            <div>
              <div className={labelCls}>Key Sheet<Tip text={STUDIO_TIPS.key_sheet} /></div>
              <select
                className={`${selectCls} w-full`}
                value={keySheet}
                onChange={(e) => setKeySheet(e.target.value)}
              >
                <option value="">(not set)</option>
                {allSheetNames.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <div className={labelCls}>Key Column<Tip text={STUDIO_TIPS.key_column} /></div>
              <ColumnPicker value={keyColumn} onChange={setKeyColumn} />
            </div>
            <div>
              <div className={labelCls}>First Key Row<Tip text={STUDIO_TIPS.first_key_row} /></div>
              <input
                className={`${inputCls} w-full`}
                type="number"
                min={1}
                value={keyRowStart}
                onChange={(e) => setKeyRowStart(parseInt(e.target.value, 10) || 1)}
              />
            </div>
            <div>
              <div className={labelCls}>Last Key Row<Tip text={STUDIO_TIPS.last_key_row} /></div>
              <input
                className={`${inputCls} w-full`}
                type="number"
                min={0}
                value={keyRowEnd}
                onChange={(e) => setKeyRowEnd(parseInt(e.target.value, 10) || 0)}
                title="0 = auto-detect until blank"
              />
            </div>
          </div>
        )}
      </div>

      {/* Product Table */}
      <div className={sectionCls}>
        <h3 className="text-sm font-semibold mb-3">
          Product Sampling Configuration
          {isScratch && <span className="ml-2 text-[10px] font-normal bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded">scratch</span>}
        </h3>
        {isScratch ? (
          <div className="grid grid-cols-2 gap-4">
            {/* Locked field summary */}
            <div className="space-y-2">
              <div>
                <div className={labelCls}>Layout</div>
                <div className={`${inputCls} w-full bg-gray-100 dark:bg-gray-700 cursor-not-allowed`}>
                  matrix <span className="text-[10px] text-gray-400">(locked)</span>
                </div>
              </div>
              <div>
                <div className={labelCls}>Key Column</div>
                <div className={`${inputCls} w-full bg-gray-100 dark:bg-gray-700 cursor-not-allowed`}>
                  A <span className="text-[10px] text-gray-400">(matches key source)</span>
                </div>
              </div>
              <div>
                <div className={labelCls}>Value Start Column</div>
                <div className={`${inputCls} w-full bg-gray-100 dark:bg-gray-700 cursor-not-allowed`}>
                  B <span className="text-[10px] text-gray-400">(locked)</span>
                </div>
              </div>
              <div>
                <div className={labelCls}>Value End Column</div>
                <div className={`${inputCls} w-full bg-gray-100 dark:bg-gray-700 cursor-not-allowed`}>
                  (auto-detect) <span className="text-[10px] text-gray-400">(locked)</span>
                </div>
              </div>
            </div>
            {/* Visual metadata row map */}
            <div className="bg-gray-50 dark:bg-gray-900/30 rounded p-3 text-xs font-mono space-y-0.5">
              <div className="text-gray-400 mb-1 font-sans font-medium">Sheet Row Layout</div>
              <div>Row 1: <span className="text-gray-600 dark:text-gray-300">Header</span></div>
              <div>Row 2: <span className="text-blue-600 dark:text-blue-400">ID#</span></div>
              <div>Row 3: <span className="text-blue-600 dark:text-blue-400">Identifier</span></div>
              <div>Row 4: <span className="text-green-600 dark:text-green-400">Brand</span></div>
              <div>Row 5: <span className="text-green-600 dark:text-green-400">Model</span></div>
              <div>Row 6: <span className="text-green-600 dark:text-green-400">Variant</span></div>
              <div>Row 7+: <span className="text-purple-600 dark:text-purple-400">Field Keys ({fieldOrder.length})</span></div>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <div className={labelCls}>Sampling Sheet<Tip text={STUDIO_TIPS.sampling_sheet} /></div>
                <select
                  className={`${selectCls} w-full`}
                  value={prodSheet}
                  onChange={(e) => setProdSheet(e.target.value)}
                >
                  <option value="">(not set)</option>
                  {allSheetNames.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <div className={labelCls}>Layout<Tip text={STUDIO_TIPS.layout} /></div>
                <select
                  className={`${selectCls} w-full`}
                  value={prodLayout}
                  onChange={(e) => setProdLayout(e.target.value)}
                >
                  <option value="matrix">Matrix</option>
                  <option value="row_table">Row Table</option>
                  <option value="none">None</option>
                </select>
              </div>
              <div>
                <div className={labelCls}>Value Start Column<Tip text={STUDIO_TIPS.value_start_column} /></div>
                <ColumnPicker value={valueColStart} onChange={setValueColStart} />
              </div>
              <div>
                <div className={labelCls}>Brand Row<Tip text={STUDIO_TIPS.brand_row} /></div>
                <input
                  className={`${inputCls} w-full`}
                  type="number"
                  min={1}
                  value={brandRow}
                  onChange={(e) => setBrandRow(parseInt(e.target.value, 10) || 1)}
                />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3 mt-3">
              <div>
                <div className={labelCls}>Model Row<Tip text={STUDIO_TIPS.model_row} /></div>
                <input
                  className={`${inputCls} w-full`}
                  type="number"
                  min={1}
                  value={modelRow}
                  onChange={(e) => setModelRow(parseInt(e.target.value, 10) || 1)}
                />
              </div>
              <div>
                <div className={labelCls}>Variant Row<Tip text={STUDIO_TIPS.variant_row} /></div>
                <input
                  className={`${inputCls} w-full`}
                  type="number"
                  min={0}
                  value={variantRow}
                  onChange={(e) => setVariantRow(parseInt(e.target.value, 10) || 0)}
                  title="0 = no variant row"
                />
              </div>
              <div>
                <div className={labelCls}>Value End Column<Tip text={STUDIO_TIPS.value_end_column} /></div>
                <ColumnPicker value={valueColEnd} onChange={setValueColEnd} />
              </div>
              <div className="flex items-end">
                <span className="text-xs text-gray-400">Leave end column empty for auto-detect to last populated column.</span>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3 mt-3">
              <div>
                <div className={labelCls}>ID# Row</div>
                <input
                  className={`${inputCls} w-full`}
                  type="number"
                  min={0}
                  value={idRow}
                  onChange={(e) => setIdRow(parseInt(e.target.value, 10) || 0)}
                  title="0 = not present"
                />
              </div>
              <div>
                <div className={labelCls}>Identifier Row</div>
                <input
                  className={`${inputCls} w-full`}
                  type="number"
                  min={0}
                  value={identifierRow}
                  onChange={(e) => setIdentifierRow(parseInt(e.target.value, 10) || 0)}
                  title="0 = not present"
                />
              </div>
              <div className="col-span-2 flex items-end">
                <span className="text-xs text-gray-400">Set to 0 if the workbook does not have ID/Identifier rows.</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Tooltip Bank */}
      <div className={sectionCls}>
        <h3 className="text-sm font-semibold mb-3">Tooltip Source</h3>
        <div className="grid grid-cols-4 gap-3">
          <div className="col-span-2">
            <div className={labelCls}>Tooltip Bank File (JS/JSON/MD)<Tip text={STUDIO_TIPS.tooltip_bank_file} /></div>
            <input
              className={`${inputCls} w-full font-mono text-xs`}
              value={tooltipPath}
              onChange={(e) => setTooltipPath(e.target.value)}
              placeholder="(auto-discover hbs_tooltips*)"
            />
          </div>
          <div>
            <div className={labelCls}>Bank Keys</div>
            <span className="text-lg font-semibold">{tooltipCount}</span>
          </div>
          <div>
            <div className={labelCls}>Coverage</div>
            <span className="text-lg font-semibold">{tooltipCoverage}%</span>
          </div>
        </div>
        {tooltipFiles.length > 0 ? (
          <p className="text-xs text-gray-400 mt-2">Files: {tooltipFiles.join(', ')}</p>
        ) : null}
      </div>

      {/* Component Source Mapping */}
      <div className={sectionCls}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold">Component Source Mapping</h3>
            <p className="text-xs text-gray-500 mt-1">
              Required: Primary Identifier role. Optional: Maker, Name Variants, Reference URLs, Attributes.
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={addComponentSource} className={btnSecondary}>
              + Add Source
            </button>
            {compSources.length > 1 ? (
              <button
                onClick={() => removeComponentSource(compSources.length - 1)}
                className={btnDanger}
              >
                Remove Last
              </button>
            ) : null}
          </div>
        </div>

        {compSources.length > 0 ? (
          <div className="space-y-6">
            {compSources.map((src, idx) => (
              <EditableComponentSource
                key={idx}
                index={idx}
                source={src}
                sheetNames={allSheetNames}
                sheets={sheets}
                onUpdate={(updates) => updateComponentSource(idx, updates)}
                onRemove={() => removeComponentSource(idx)}
                rules={rules}
                fieldOrder={fieldOrder}
              />
            ))}
          </div>
        ) : (
          <div className="text-sm text-gray-400 text-center py-4">
            No component sources configured. Click "Add Source" to add one.
          </div>
        )}
      </div>

      {/* Data Lists (Enum Value Lists) */}
      <div className={sectionCls}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold">Data Lists</h3>
            <p className="text-xs text-gray-500 mt-1">
              Define allowed values for enum fields. Import from workbook columns or create from scratch.
            </p>
          </div>
          <button onClick={addDataList} className={btnSecondary}>
            + Add List
          </button>
        </div>

        {dataLists.length > 0 ? (
          <div className="space-y-3">
            {dataLists.map((dl, idx) => (
              <EditableDataList
                key={idx}
                entry={dl}
                index={idx}
                sheetNames={allSheetNames}
                sheets={sheets}
                knownValues={knownValues}
                isDuplicate={duplicateDataListFields.has(dl.field)}
                onUpdate={(updates) => updateDataList(idx, updates)}
                onRemove={() => removeDataList(idx)}
              />
            ))}
          </div>
        ) : (
          <div className="text-sm text-gray-400 text-center py-4">
            No data lists configured. Click "+ Add List" to define enum value lists.
          </div>
        )}
      </div>

      {/* Save Mapping Button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className={`${btnPrimary} px-6 py-2.5`}
        >
          {saving ? 'Saving...' : 'Save Mapping'}
        </button>
        {saveSuccess ? <span className="text-sm text-green-600">Mapping saved to _control_plane/workbook_map.json</span> : null}
      </div>

      {/* Sheet Introspection Preview */}
      {sheets.length > 0 ? (
        <div className={sectionCls}>
          <h3 className="text-sm font-semibold mb-3">Detected Sheets</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {sheets.map((sheet) => (
              <SheetCard key={sheet.name} sheet={sheet} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Constraint Editor ────────────────────────────────────────────────
const CONSTRAINT_OPS = ['<=', '>=', '<', '>', '==', '!='] as const;

function ConstraintEditor({
  constraints,
  onChange,
  componentPropertyKeys,
  fieldOrder,
  rules,
}: {
  constraints: string[];
  onChange: (next: string[]) => void;
  componentPropertyKeys: string[];
  fieldOrder: string[];
  rules: Record<string, FieldRule>;
}) {
  const [adding, setAdding] = useState(false);
  const [leftField, setLeftField] = useState('');
  const [op, setOp] = useState<string>('<=');
  const [rightField, setRightField] = useState('');

  function addConstraint() {
    const expr = `${leftField} ${op} ${rightField}`.trim();
    if (!leftField || !rightField) return;
    onChange([...constraints, expr]);
    setLeftField('');
    setOp('<=');
    setRightField('');
    setAdding(false);
  }

  function removeConstraint(idx: number) {
    onChange(constraints.filter((_, i) => i !== idx));
  }

  // Left side: component property keys from this source
  const componentOptions = useMemo(() => {
    return componentPropertyKeys.map((key) => {
      const rule = rules[key] || {};
      const ui = rule.ui || {};
      return { value: key, label: String(ui.label || rule.label || key) };
    });
  }, [componentPropertyKeys, rules]);

  // Right side: product field keys
  const productOptions = useMemo(() => {
    return fieldOrder.map((key) => {
      const rule = rules[key] || {};
      const ui = rule.ui || {};
      return { value: key, label: String(ui.label || rule.label || key) };
    });
  }, [fieldOrder, rules]);

  return (
    <div className="px-3 py-1.5 border-t border-gray-200 dark:border-gray-700 text-[11px]">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-gray-500">Constraints<Tip text={STUDIO_TIPS.comp_constraints} /></span>
        {constraints.map((c, ci) => (
          <span key={ci} className="inline-flex items-center gap-1 bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 px-1.5 py-0.5 rounded text-[10px]">
            {c}
            <button
              onClick={() => removeConstraint(ci)}
              className="text-orange-400 hover:text-orange-600 ml-0.5"
              title="Remove constraint"
            >&#10005;</button>
          </span>
        ))}
        {!adding ? (
          <button
            onClick={() => setAdding(true)}
            className="text-[10px] text-blue-500 hover:text-blue-700"
          >+ Add constraint</button>
        ) : null}
      </div>
      {adding ? (
        <div className="flex items-center gap-1.5 mt-1.5">
          <select
            className={`${selectCls} text-[11px] py-0.5 min-w-0`}
            value={leftField}
            onChange={(e) => setLeftField(e.target.value)}
          >
            <option value="">Component prop...</option>
            {componentOptions.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
          <select
            className={`${selectCls} text-[11px] py-0.5 w-14`}
            value={op}
            onChange={(e) => setOp(e.target.value)}
          >
            {CONSTRAINT_OPS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <select
            className={`${selectCls} text-[11px] py-0.5 min-w-0`}
            value={rightField}
            onChange={(e) => setRightField(e.target.value)}
          >
            <option value="">Product field...</option>
            {productOptions.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
          <button
            onClick={addConstraint}
            disabled={!leftField || !rightField}
            className="text-[10px] text-green-600 hover:text-green-800 disabled:opacity-40 font-medium"
          >Add</button>
          <button
            onClick={() => setAdding(false)}
            className="text-[10px] text-gray-400 hover:text-gray-600"
          >Cancel</button>
        </div>
      ) : null}
    </div>
  );
}

// ── Editable Data List ───────────────────────────────────────────────
function EditableDataList({
  entry,
  index,
  sheetNames,
  sheets,
  knownValues,
  isDuplicate,
  onUpdate,
  onRemove,
}: {
  entry: DataListEntry;
  index: number;
  sheetNames: string[];
  sheets: SheetPreview[];
  knownValues: Record<string, string[]>;
  isDuplicate: boolean;
  onUpdate: (updates: Partial<DataListEntry>) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(!entry.field);

  // Build header options for column picker in workbook mode
  const headerOptions = useMemo(
    () => buildHeaderOptions(sheets, entry.sheet, entry.header_row || 1),
    [sheets, entry.sheet, entry.header_row],
  );

  // Preview values from sheet column
  const previewValues = useMemo(() => {
    if (entry.mode !== 'workbook' || !entry.sheet || !entry.value_column) return [];
    const sheet = sheets.find(s => s.name === entry.sheet);
    if (!sheet?.preview?.rows) return [];
    const start = entry.row_start || 2;
    const end = entry.row_end || 9999;
    const vals: string[] = [];
    for (const row of sheet.preview.rows) {
      if (row.row < start || row.row > end) continue;
      const cell = row.cells[entry.value_column];
      if (cell != null && String(cell).trim()) {
        if (entry.delimiter) {
          for (const part of String(cell).split(entry.delimiter)) {
            const t = part.trim();
            if (t && !vals.includes(t)) vals.push(t);
          }
        } else {
          const t = String(cell).trim();
          if (!vals.includes(t)) vals.push(t);
        }
      }
    }
    return vals;
  }, [sheets, entry.sheet, entry.value_column, entry.row_start, entry.row_end, entry.delimiter, entry.mode]);

  const compiledValues = knownValues[entry.field] || [];
  const valueCount = entry.mode === 'workbook'
    ? compiledValues.length || previewValues.length
    : entry.manual_values.length;
  const listPriority = normalizePriorityProfile(entry.priority);
  const listAiAssist = normalizeAiAssistConfig(entry.ai_assist);
  function updatePriority(updates: Partial<PriorityProfile>) {
    onUpdate({ priority: { ...listPriority, ...updates } });
  }
  function updateAiAssist(updates: Partial<AiAssistConfig>) {
    onUpdate({ ai_assist: { ...listAiAssist, ...updates } });
  }

  // Collapsed view
  if (!expanded) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-750 rounded border border-gray-200 dark:border-gray-600">
        <span className="text-sm font-medium flex-1 min-w-0 truncate">{entry.field || <span className="italic text-gray-400">unnamed</span>}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${entry.mode === 'workbook' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' : 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'}`}>
          {entry.mode === 'workbook' ? 'Workbook' : 'Scratch'}
        </span>
        {valueCount > 0 && <span className="text-xs text-gray-500">{valueCount} values</span>}
        {isDuplicate && <span className="text-xs text-red-500 font-medium">Duplicate!</span>}
        <button onClick={() => setExpanded(true)} className="text-xs text-accent hover:underline">expand</button>
        <button onClick={onRemove} className="text-xs text-red-500 hover:text-red-700">&times;</button>
      </div>
    );
  }

  return (
    <div className="border border-gray-200 dark:border-gray-600 rounded p-3 space-y-3 bg-gray-50 dark:bg-gray-750">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase">Data List #{index + 1}</span>
        <div className="flex gap-2">
          <button onClick={() => setExpanded(false)} className="text-xs text-accent hover:underline">collapse</button>
          <button onClick={onRemove} className={btnDanger + ' text-xs !px-2 !py-0.5'}>Remove</button>
        </div>
      </div>

      {isDuplicate && (
        <div className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 rounded px-2 py-1">
          Warning: Another data list uses the same field name "{entry.field}". Each field should have only one list.
        </div>
      )}

      {/* Identity row: field name + mode toggle */}
      <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
        <div>
          <label className={labelCls}>
            Field Name <Tip text={STUDIO_TIPS.data_list_field} />
          </label>
          <input
            className={inputCls + ' w-full'}
            value={entry.field}
            onChange={(e) => onUpdate({ field: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '') })}
            placeholder="e.g. form_factor"
          />
        </div>
        <div>
          <label className={labelCls}>
            Mode <Tip text={STUDIO_TIPS.data_list_mode} />
          </label>
          <div className="flex rounded overflow-hidden border border-gray-300 dark:border-gray-600">
            <button
              className={`px-3 py-1.5 text-xs font-medium ${entry.mode === 'workbook' ? 'bg-accent text-white' : 'bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600'}`}
              onClick={() => onUpdate({ mode: 'workbook' })}
            >
              Workbook
            </button>
            <button
              className={`px-3 py-1.5 text-xs font-medium ${entry.mode === 'scratch' ? 'bg-accent text-white' : 'bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600'}`}
              onClick={() => onUpdate({ mode: 'scratch' })}
            >
              Scratch
            </button>
          </div>
        </div>
      </div>

      {/* Workbook mode panel */}
      {entry.mode === 'workbook' && (
        <div className="space-y-2 pl-2 border-l-2 border-blue-300 dark:border-blue-700">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div>
              <label className={labelCls}>Sheet <Tip text={STUDIO_TIPS.data_list_sheet} /></label>
              <select
                className={selectCls + ' w-full'}
                value={entry.sheet}
                onChange={(e) => onUpdate({ sheet: e.target.value })}
              >
                <option value="">Select sheet...</option>
                {sheetNames.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Header Row</label>
              <input
                type="number"
                className={inputCls + ' w-full'}
                value={entry.header_row}
                onChange={(e) => onUpdate({ header_row: parseInt(e.target.value) || 0 })}
                min={0}
              />
            </div>
            <div>
              <label className={labelCls}>Column <Tip text={STUDIO_TIPS.data_list_column} /></label>
              {headerOptions.length > 0 ? (
                <select
                  className={selectCls + ' w-full'}
                  value={entry.value_column}
                  onChange={(e) => onUpdate({ value_column: e.target.value })}
                >
                  <option value="">Select column...</option>
                  {headerOptions.map(h => (
                    <option key={h.col} value={h.col}>{h.col} &mdash; {h.header}</option>
                  ))}
                </select>
              ) : (
                <select
                  className={selectCls + ' w-full'}
                  value={entry.value_column}
                  onChange={(e) => onUpdate({ value_column: e.target.value })}
                >
                  <option value="">Column...</option>
                  {AZ_COLUMNS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
            </div>
            <div>
              <label className={labelCls}>Normalize <Tip text={STUDIO_TIPS.data_list_normalize} /></label>
              <select
                className={selectCls + ' w-full'}
                value={entry.normalize}
                onChange={(e) => onUpdate({ normalize: e.target.value })}
              >
                {NORMALIZE_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className={labelCls}>Row Start</label>
              <input
                type="number"
                className={inputCls + ' w-full'}
                value={entry.row_start}
                onChange={(e) => onUpdate({ row_start: parseInt(e.target.value) || 2 })}
                min={1}
              />
            </div>
            <div>
              <label className={labelCls}>Row End <span className="text-gray-400">(0 = auto)</span></label>
              <input
                type="number"
                className={inputCls + ' w-full'}
                value={entry.row_end}
                onChange={(e) => onUpdate({ row_end: parseInt(e.target.value) || 0 })}
                min={0}
              />
            </div>
            <div>
              <label className={labelCls}>Delimiter <Tip text={STUDIO_TIPS.data_list_delimiter} /></label>
              <input
                className={inputCls + ' w-full'}
                value={entry.delimiter}
                onChange={(e) => onUpdate({ delimiter: e.target.value })}
                placeholder="e.g. , or ;"
              />
            </div>
          </div>
          {/* Preview values from sheet */}
          {previewValues.length > 0 && (
            <div>
              <label className={labelCls}>Sheet Preview ({previewValues.length} values)</label>
              <div className="flex flex-wrap gap-1">
                {previewValues.slice(0, 30).map(v => (
                  <span key={v} className="text-[11px] px-1.5 py-0.5 bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 rounded">{v}</span>
                ))}
                {previewValues.length > 30 && <span className="text-[11px] text-gray-400">+{previewValues.length - 30} more</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Scratch mode note */}
      {entry.mode === 'scratch' && (
        <p className="text-xs text-gray-500 italic pl-2 border-l-2 border-purple-300 dark:border-purple-700">
          Define values manually without a workbook column.
        </p>
      )}

      {/* List review priority / effort */}
      <div className="border border-gray-200 dark:border-gray-600 rounded p-2.5 bg-white dark:bg-gray-800/40">
        <div className="text-xs font-semibold text-gray-500 mb-2">AI Review Priority</div>
        <div className="grid grid-cols-4 gap-2">
          <div>
            <label className={labelCls}>Required Level <Tip text={STUDIO_TIPS.required_level} /></label>
            <select
              className={selectCls + ' w-full'}
              value={listPriority.required_level}
              onChange={(e) => updatePriority({ required_level: e.target.value })}
            >
              <option value="identity">identity</option>
              <option value="required">required</option>
              <option value="critical">critical</option>
              <option value="expected">expected</option>
              <option value="optional">optional</option>
              <option value="editorial">editorial</option>
              <option value="commerce">commerce</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Availability <Tip text={STUDIO_TIPS.availability} /></label>
            <select
              className={selectCls + ' w-full'}
              value={listPriority.availability}
              onChange={(e) => updatePriority({ availability: e.target.value })}
            >
              <option value="always">always</option>
              <option value="expected">expected</option>
              <option value="sometimes">sometimes</option>
              <option value="rare">rare</option>
              <option value="editorial_only">editorial_only</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Difficulty <Tip text={STUDIO_TIPS.difficulty} /></label>
            <select
              className={selectCls + ' w-full'}
              value={listPriority.difficulty}
              onChange={(e) => updatePriority({ difficulty: e.target.value })}
            >
              <option value="easy">easy</option>
              <option value="medium">medium</option>
              <option value="hard">hard</option>
              <option value="instrumented">instrumented</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Effort (1-10) <Tip text={STUDIO_TIPS.effort} /></label>
            <input
              type="number"
              min={1}
              max={10}
              className={inputCls + ' w-full'}
              value={listPriority.effort}
              onChange={(e) => updatePriority({ effort: Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)) })}
            />
          </div>
        </div>
      </div>

      {/* List-level AI assist (same controls as Key Navigator) */}
      {(() => {
        const explicitMode = listAiAssist.mode || '';
        const strategy = listAiAssist.model_strategy || 'auto';
        const explicitCalls = listAiAssist.max_calls || 0;
        const reqLvl = listPriority.required_level;
        const diff = listPriority.difficulty;
        const effort = listPriority.effort;

        const derivedMode = deriveAiModeFromPriority(listPriority);
        const effectiveMode = explicitMode || derivedMode;

        const derivedCalls = deriveAiCallsFromEffort(effort);
        const effectiveCalls = explicitCalls > 0 ? Math.min(explicitCalls, 10) : derivedCalls;

        const modeToModel: Record<string, { model: string; reasoning: boolean }> = {
          off: { model: 'none', reasoning: false },
          advisory: { model: 'gpt-5-low', reasoning: false },
          planner: { model: 'gpt-5-low -> gpt-5.2-high on escalation', reasoning: false },
          judge: { model: 'gpt-5.2-high', reasoning: true },
        };
        let effectiveModel = modeToModel[effectiveMode] || modeToModel.off;
        if (strategy === 'force_fast') effectiveModel = { model: 'gpt-5-low (forced)', reasoning: false };
        else if (strategy === 'force_deep') effectiveModel = { model: 'gpt-5.2-high (forced)', reasoning: true };

        const explicitNote = listAiAssist.reasoning_note || '';
        const autoNote = [
          `List review for "${entry.field || 'list'}".`,
          `Apply ${effectiveMode} mode with evidence-first extraction.`,
          `Required level ${reqLvl}, availability ${listPriority.availability}, difficulty ${diff}, effort ${effort}.`,
          'Return normalized values that match the list policy and preserve supporting evidence refs.'
        ].join(' ');
        const hasExplicit = explicitNote.length > 0;

        return (
          <div className="border border-gray-200 dark:border-gray-600 rounded p-2.5 bg-white dark:bg-gray-800/40">
            <h4 className="text-xs font-semibold text-gray-500 mb-2">AI Assist<Tip text={STUDIO_TIPS.ai_mode} /></h4>
            <div className="grid grid-cols-4 gap-2">
              <div>
                <label className={labelCls}>Mode<Tip text={STUDIO_TIPS.ai_mode} /></label>
                <select
                  className={selectCls + ' w-full'}
                  value={explicitMode}
                  onChange={(e) => updateAiAssist({ mode: e.target.value || null })}
                >
                  <option value="">auto ({derivedMode})</option>
                  <option value="off">off - no LLM, deterministic only</option>
                  <option value="advisory">advisory - gpt-5-low, single pass</option>
                  <option value="planner">planner - gpt-5-low -&gt; gpt-5.2-high</option>
                  <option value="judge">judge - gpt-5.2-high, reasoning</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Model Strategy<Tip text={STUDIO_TIPS.ai_model_strategy} /></label>
                <select
                  className={selectCls + ' w-full'}
                  value={strategy}
                  onChange={(e) => updateAiAssist({ model_strategy: e.target.value })}
                >
                  <option value="auto">auto - mode decides model</option>
                  <option value="force_fast">force_fast - always gpt-5-low</option>
                  <option value="force_deep">force_deep - always gpt-5.2-high</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Max Calls<Tip text={STUDIO_TIPS.ai_max_calls} /></label>
                <input
                  className={inputCls + ' w-full'}
                  type="number"
                  min={1}
                  max={10}
                  value={explicitCalls || ''}
                  onChange={(e) => updateAiAssist({ max_calls: parseInt(e.target.value, 10) || null })}
                  placeholder={`auto (${derivedCalls})`}
                />
              </div>
              <div>
                <label className={labelCls}>Max Tokens<Tip text={STUDIO_TIPS.ai_max_tokens} /></label>
                <input
                  className={inputCls + ' w-full'}
                  type="number"
                  min={256}
                  max={65536}
                  step={1024}
                  value={listAiAssist.max_tokens || ''}
                  onChange={(e) => updateAiAssist({ max_tokens: parseInt(e.target.value, 10) || null })}
                  placeholder={`auto (${effectiveMode === 'off' ? '0' : effectiveMode === 'advisory' ? '4096' : effectiveMode === 'planner' ? '8192' : '16384'})`}
                />
              </div>
            </div>

            <div className="mt-2 text-[11px] bg-gray-50 dark:bg-gray-800/50 rounded p-2 border border-gray-200 dark:border-gray-700 space-y-1">
              <div className="text-[10px] font-semibold text-gray-400 mb-1">Effective AI Configuration</div>
              <div className="flex items-center gap-2">
                <span className="text-gray-400 w-14">Mode:</span>
                <span className="text-gray-600 dark:text-gray-300">{effectiveMode}</span>
                {!explicitMode && <span className="text-gray-400 italic text-[10px]">(auto from {reqLvl}{diff !== 'easy' ? ` + ${diff}` : ''})</span>}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-400 w-14">Model:</span>
                <span className="text-gray-600 dark:text-gray-300 font-mono text-[10px]">{effectiveModel.model}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-400 w-14">Budget:</span>
                <span className="text-gray-600 dark:text-gray-300">{effectiveMode === 'off' ? '0' : effectiveCalls} call{effectiveCalls !== 1 ? 's' : ''}</span>
                {!explicitCalls && effectiveMode !== 'off' && <span className="text-gray-400 italic text-[10px]">(auto from effort {effort})</span>}
              </div>
            </div>

            <div className="mt-2">
              <div className="flex items-center gap-2 mb-1">
                <span className={labelCls.replace(' mb-1', '')}>Extraction Guidance (sent to LLM)<Tip text={STUDIO_TIPS.ai_reasoning_note} /></span>
                {!hasExplicit && <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500 italic font-medium">Auto</span>}
              </div>
              <textarea
                className={`${inputCls} w-full`}
                rows={3}
                value={explicitNote}
                onChange={(e) => updateAiAssist({ reasoning_note: e.target.value })}
                placeholder={`Auto: ${autoNote}`}
              />
              {hasExplicit && (
                <button
                  className="text-[10px] text-blue-500 hover:text-blue-700 mt-1"
                  onClick={() => updateAiAssist({ reasoning_note: '' })}
                >
                  Clear &amp; revert to auto-generated guidance
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* Manual values (shown in both modes) */}
      <div>
        <label className={labelCls}>
          {entry.mode === 'workbook' ? 'Additional Values' : 'Values'} <Tip text={STUDIO_TIPS.data_list_manual_values} />
        </label>
        {entry.mode === 'workbook' && (
          <p className="text-[10px] text-gray-400 mb-1">Merged with workbook values during compile</p>
        )}
        <TagPicker
          values={entry.manual_values}
          onChange={(v) => onUpdate({ manual_values: v })}
          placeholder="Type a value and press Enter..."
        />
      </div>

      {/* Compiled values display */}
      {compiledValues.length > 0 && (
        <div>
          <label className={labelCls}>
            Compiled Values ({compiledValues.length}) <Tip text={STUDIO_TIPS.data_list_compiled_values} />
          </label>
          <div className="flex flex-wrap gap-1">
            {compiledValues.map(v => (
              <span
                key={v}
                className={`text-[11px] px-1.5 py-0.5 rounded ${
                  entry.manual_values.includes(v)
                    ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                    : 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                }`}
              >
                {v}
              </span>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-1">Preview only — compile to refresh</p>
        </div>
      )}
    </div>
  );
}

// ── Editable Component Source ─────────────────────────────────────────
function EditableComponentSource({
  index,
  source,
  sheetNames,
  sheets,
  onUpdate,
  onRemove,
  rules,
  fieldOrder,
}: {
  index: number;
  source: ComponentSource;
  sheetNames: string[];
  sheets: SheetPreview[];
  onUpdate: (updates: Partial<ComponentSource>) => void;
  onRemove: () => void;
  rules: Record<string, FieldRule>;
  fieldOrder: string[];
}) {
  const roles = source.roles || { primary_identifier: 'A', maker: '', aliases: [], links: [], properties: [] };
  const sourcePriority = normalizePriorityProfile(source.priority);
  const sourceAiAssist = normalizeAiAssistConfig(source.ai_assist);
  const [activeRoles, setActiveRoles] = useState<Set<RoleId>>(() => {
    const set = new Set<RoleId>();
    if (roles.maker) set.add('maker');
    if (Array.isArray(roles.aliases) && roles.aliases.length > 0) set.add('aliases');
    if (source.auto_derive_aliases) set.add('aliases');
    if (Array.isArray(roles.links) && roles.links.length > 0) set.add('links');
    if (Array.isArray(roles.properties) && roles.properties.length > 0) set.add('properties');
    return set;
  });

  const [propertyRows, setPropertyRows] = useState<PropertyMapping[]>(() => {
    if (!Array.isArray(roles.properties)) return [];
    return (roles.properties as unknown as typeof roles.properties).map((p) => migrateProperty(p, rules));
  });

  // Build header options from sheet preview data for this source's sheet
  const headerOptions = useMemo(
    () => buildHeaderOptions(sheets, source.sheet || '', source.header_row || 1),
    [sheets, source.sheet, source.header_row],
  );

  // Build header→column lookup for quick auto-fill
  const headerToCol = useMemo(() => {
    const map = new Map<string, string>();
    for (const { col, header } of headerOptions) {
      map.set(header.toLowerCase(), col);
    }
    return map;
  }, [headerOptions]);

  // Columns already used by primary/maker/aliases/links/properties
  const usedColumns = useMemo(() => {
    const set = new Set<string>();
    if (roles.primary_identifier) set.add(roles.primary_identifier);
    if (roles.maker) set.add(roles.maker);
    for (const a of (Array.isArray(roles.aliases) ? roles.aliases : [])) set.add(a);
    for (const l of (Array.isArray(roles.links) ? roles.links : [])) set.add(l);
    return set;
  }, [roles]);

  // Available header options for property key selection (exclude already-used role columns)
  const availablePropertyHeaders = useMemo(
    () => headerOptions.filter(({ col }) => !usedColumns.has(col)),
    [headerOptions, usedColumns],
  );

  // Group field keys by ui.group for the field key picker
  const fieldKeyGroups = useMemo(() => {
    const groups: Record<string, { key: string; label: string; type: string }[]> = {};
    const usedKeys = new Set(propertyRows.map((r) => r.field_key));
    for (const key of fieldOrder) {
      if (usedKeys.has(key)) continue;
      const rule = rules[key] || {};
      const ui = rule.ui || {};
      const contract = rule.contract || {};
      const group = String(ui.group || rule.group || 'other');
      if (!groups[group]) groups[group] = [];
      groups[group].push({
        key,
        label: String(ui.label || rule.label || key),
        type: String(contract.type || 'string'),
      });
    }
    return groups;
  }, [fieldOrder, rules, propertyRows]);

  // Get preview values for a column from the sheet data
  function getColumnPreview(col: string, maxValues = 5): string[] {
    if (!col) return [];
    const sheet = sheets.find((s) => s.name === source.sheet);
    if (!sheet?.preview?.rows) return [];
    const dataRows = sheet.preview.rows.filter((r) => r.row >= (source.first_data_row || 2));
    const values: string[] = [];
    for (const row of dataRows) {
      const val = row.cells[col];
      if (val != null && String(val).trim() !== '') {
        values.push(String(val).trim());
        if (values.length >= maxValues) break;
      }
    }
    return values;
  }

  // Get inherited info from field rules for a field key
  function getInheritedInfo(fieldKey: string): { type: string; unit: string; template: string; evidenceRefs: number } {
    const rule = rules[fieldKey] || {};
    const contract = rule.contract || {};
    const parse = (rule as Record<string, unknown>).parse as Record<string, unknown> | undefined;
    const evidence = (rule as Record<string, unknown>).evidence as Record<string, unknown> | undefined;
    return {
      type: String(contract.type || 'string'),
      unit: String(contract.unit || ''),
      template: String(parse?.template || parse?.parse_template || ''),
      evidenceRefs: Number(evidence?.min_refs || evidence?.min_evidence_refs || 0),
    };
  }

  function updateRoles(updates: Partial<typeof roles>) {
    onUpdate({ roles: { ...roles, ...updates } });
  }

  function updatePriority(updates: Partial<PriorityProfile>) {
    onUpdate({ priority: { ...sourcePriority, ...updates } });
  }
  function updateAiAssist(updates: Partial<AiAssistConfig>) {
    onUpdate({ ai_assist: { ...sourceAiAssist, ...updates } });
  }

  // Derive a header title from a field key: use UI label from rules, else humanize the key
  function deriveHeader(fieldKey: string): string {
    if (!fieldKey) return '';
    const rule = rules[fieldKey];
    if (rule?.ui?.label) return String(rule.ui.label);
    if (rule?.label) return String(rule.label);
    return fieldKey.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function toggleRole(roleId: RoleId) {
    const next = new Set(activeRoles);
    if (next.has(roleId)) {
      next.delete(roleId);
      if (roleId === 'maker') updateRoles({ maker: '' });
      if (roleId === 'aliases') {
        updateRoles({ aliases: [] });
        onUpdate({ auto_derive_aliases: false });
      }
      if (roleId === 'links') updateRoles({ links: [] });
      if (roleId === 'properties') {
        updateRoles({ properties: [] });
        setPropertyRows([]);
      }
    } else {
      next.add(roleId);
    }
    setActiveRoles(next);
  }

  function addPropertyRow() {
    const next: PropertyMapping[] = [...propertyRows, {
      field_key: '',
      column: buildMode === 'scratch' ? nextAvailableColumn() : '',
      column_header: '',
      mode: 'manual',
      variance_policy: 'authoritative',
      tolerance: null,
      constraints: [],
    }];
    setPropertyRows(next);
    updateRoles({ properties: next as unknown as typeof roles.properties });
  }

  function removePropertyRow(pidx: number) {
    const next = propertyRows.filter((_, i) => i !== pidx);
    setPropertyRows(next);
    updateRoles({ properties: next as unknown as typeof roles.properties });
  }

  function updatePropertyField(pidx: number, updates: Partial<PropertyMapping>) {
    const next = propertyRows.map((row, i) =>
      i === pidx ? { ...row, ...updates } : row
    );
    setPropertyRows(next);
    updateRoles({ properties: next as unknown as typeof roles.properties });
  }

  // Select a field key → auto-match column
  function selectFieldKey(pidx: number, fieldKey: string) {
    const rule = rules[fieldKey] || {};
    const match = autoMatchColumn(fieldKey, rule, headerOptions);
    const updates: Partial<PropertyMapping> = {
      field_key: fieldKey,
      mode: 'auto',
    };
    if (match) {
      updates.column = match.col;
      updates.column_header = match.header;
    } else {
      // No sheet match — derive header from the field key
      updates.column_header = deriveHeader(fieldKey);
    }
    updatePropertyField(pidx, updates);
  }

  // Add property from field key picker
  function addPropertyFromFieldKey(fieldKey: string) {
    if (propertyRows.some((r) => r.field_key === fieldKey)) return;
    const rule = rules[fieldKey] || {};
    const match = autoMatchColumn(fieldKey, rule, headerOptions);
    const newRow: PropertyMapping = {
      field_key: fieldKey,
      column: match?.col || (buildMode === 'scratch' ? nextAvailableColumn() : ''),
      column_header: match?.header || deriveHeader(fieldKey),
      mode: 'auto',
      variance_policy: 'authoritative',
      tolerance: null,
      constraints: [],
    };
    const next = [...propertyRows, newRow];
    setPropertyRows(next);
    updateRoles({ properties: next as unknown as typeof roles.properties });
  }

  const compType = source.component_type || source.type || '';
  const hasHeaders = headerOptions.length > 0;
  const buildMode: 'existing' | 'scratch' = hasHeaders ? 'existing' : 'scratch';

  // All columns in use across roles + properties (for collision detection & auto-assign)
  const allUsedColumns = useMemo(() => {
    const set = new Set<string>();
    if (roles.primary_identifier) set.add(roles.primary_identifier);
    if (roles.maker) set.add(roles.maker);
    for (const a of (Array.isArray(roles.aliases) ? roles.aliases : [])) set.add(a);
    for (const l of (Array.isArray(roles.links) ? roles.links : [])) set.add(l);
    for (const p of propertyRows) if (p.column) set.add(p.column);
    return set;
  }, [roles, propertyRows]);

  function nextAvailableColumn(): string {
    for (const col of AZ_COLUMNS) {
      if (!allUsedColumns.has(col)) return col;
    }
    return '';
  }

  // Find header text for a column letter
  const colHeader = (col: string) => {
    const h = headerOptions.find((o) => o.col === col);
    return h ? `${col} — ${h.header}` : col;
  };

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded p-4 relative">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold font-mono">
          {compType || `source_${index + 1}`}
          {buildMode === 'scratch' ? (
            <span className="ml-2 text-[10px] font-normal bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded">scratch</span>
          ) : null}
        </h4>
        <button onClick={onRemove} className="text-xs text-red-500 hover:text-red-700">Remove</button>
      </div>

      {/* Basic fields */}
      <div className="grid grid-cols-4 gap-3 mb-3">
        <div>
          <div className={labelCls}>Component Type<Tip text={STUDIO_TIPS.component_type} /></div>
          <ComboSelect
            value={compType}
            onChange={(v) => onUpdate({ component_type: v, type: v })}
            options={COMPONENT_TYPES}
            placeholder="e.g. sensor"
          />
        </div>
        <div>
          <div className={labelCls}>Sheet<Tip text={STUDIO_TIPS.comp_sheet} /></div>
          {buildMode === 'scratch' ? (
            <ComboSelect
              value={source.sheet || ''}
              onChange={(v) => onUpdate({ sheet: v })}
              options={sheetNames}
              placeholder="Type sheet name, e.g. sensors"
            />
          ) : (
            <select
              className={`${selectCls} w-full`}
              value={source.sheet || ''}
              onChange={(e) => onUpdate({ sheet: e.target.value })}
            >
              <option value="">(select sheet)</option>
              {sheetNames.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
        </div>
        <div>
          <div className={labelCls}>Header Row<Tip text={STUDIO_TIPS.header_row} /></div>
          {buildMode === 'scratch' ? (
            <div className={`${inputCls} w-full bg-gray-100 dark:bg-gray-700 cursor-not-allowed`}>1 <span className="text-[10px] text-gray-400">(locked)</span></div>
          ) : (
            <input
              className={`${inputCls} w-full`}
              type="number"
              min={1}
              value={source.header_row || 1}
              onChange={(e) => onUpdate({ header_row: parseInt(e.target.value, 10) || 1 })}
            />
          )}
        </div>
        <div>
          <div className={labelCls}>First Data Row<Tip text={STUDIO_TIPS.first_data_row} /></div>
          {buildMode === 'scratch' ? (
            <div className={`${inputCls} w-full bg-gray-100 dark:bg-gray-700 cursor-not-allowed`}>2 <span className="text-[10px] text-gray-400">(locked)</span></div>
          ) : (
            <input
              className={`${inputCls} w-full`}
              type="number"
              min={1}
              value={source.first_data_row || 2}
              onChange={(e) => onUpdate({ first_data_row: parseInt(e.target.value, 10) || 2 })}
            />
          )}
        </div>
      </div>

      {/* Component-level full review priority/effort */}
      <div className="border border-gray-200 dark:border-gray-700 rounded p-3 mb-4 bg-gray-50 dark:bg-gray-900/20">
        <div className="text-xs font-semibold text-gray-500 mb-2">AI Review Priority</div>
        <div className="grid grid-cols-4 gap-3">
          <div>
            <div className={labelCls}>Required Level<Tip text={STUDIO_TIPS.required_level} /></div>
            <select
              className={`${selectCls} w-full`}
              value={sourcePriority.required_level}
              onChange={(e) => updatePriority({ required_level: e.target.value })}
            >
              <option value="identity">identity</option>
              <option value="required">required</option>
              <option value="critical">critical</option>
              <option value="expected">expected</option>
              <option value="optional">optional</option>
              <option value="editorial">editorial</option>
              <option value="commerce">commerce</option>
            </select>
          </div>
          <div>
            <div className={labelCls}>Availability<Tip text={STUDIO_TIPS.availability} /></div>
            <select
              className={`${selectCls} w-full`}
              value={sourcePriority.availability}
              onChange={(e) => updatePriority({ availability: e.target.value })}
            >
              <option value="always">always</option>
              <option value="expected">expected</option>
              <option value="sometimes">sometimes</option>
              <option value="rare">rare</option>
              <option value="editorial_only">editorial_only</option>
            </select>
          </div>
          <div>
            <div className={labelCls}>Difficulty<Tip text={STUDIO_TIPS.difficulty} /></div>
            <select
              className={`${selectCls} w-full`}
              value={sourcePriority.difficulty}
              onChange={(e) => updatePriority({ difficulty: e.target.value })}
            >
              <option value="easy">easy</option>
              <option value="medium">medium</option>
              <option value="hard">hard</option>
              <option value="instrumented">instrumented</option>
            </select>
          </div>
          <div>
            <div className={labelCls}>Effort (1-10)<Tip text={STUDIO_TIPS.effort} /></div>
            <input
              className={`${inputCls} w-full`}
              type="number"
              min={1}
              max={10}
              value={sourcePriority.effort}
              onChange={(e) => updatePriority({ effort: Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)) })}
            />
          </div>
        </div>
      </div>

      {/* Component table-level AI assist */}
      {(() => {
        const explicitMode = sourceAiAssist.mode || '';
        const strategy = sourceAiAssist.model_strategy || 'auto';
        const explicitCalls = sourceAiAssist.max_calls || 0;
        const reqLvl = sourcePriority.required_level;
        const diff = sourcePriority.difficulty;
        const effort = sourcePriority.effort;

        const derivedMode = deriveAiModeFromPriority(sourcePriority);
        const effectiveMode = explicitMode || derivedMode;

        const derivedCalls = deriveAiCallsFromEffort(effort);
        const effectiveCalls = explicitCalls > 0 ? Math.min(explicitCalls, 10) : derivedCalls;

        const modeToModel: Record<string, { model: string; reasoning: boolean }> = {
          off: { model: 'none', reasoning: false },
          advisory: { model: 'gpt-5-low', reasoning: false },
          planner: { model: 'gpt-5-low -> gpt-5.2-high on escalation', reasoning: false },
          judge: { model: 'gpt-5.2-high', reasoning: true },
        };
        let effectiveModel = modeToModel[effectiveMode] || modeToModel.off;
        if (strategy === 'force_fast') effectiveModel = { model: 'gpt-5-low (forced)', reasoning: false };
        else if (strategy === 'force_deep') effectiveModel = { model: 'gpt-5.2-high (forced)', reasoning: true };

        const explicitNote = sourceAiAssist.reasoning_note || '';
        const autoNote = [
          `Full component table review for "${compType || 'component'}".`,
          `Apply ${effectiveMode} mode across all linked component rows and evidence.`,
          `Required level ${reqLvl}, availability ${sourcePriority.availability}, difficulty ${diff}, effort ${effort}.`,
          'Resolve conflicts across sources and keep output normalized for component identity + properties.'
        ].join(' ');
        const hasExplicit = explicitNote.length > 0;

        return (
          <div className="border border-gray-200 dark:border-gray-700 rounded p-3 mb-4 bg-gray-50 dark:bg-gray-900/20">
            <h4 className="text-xs font-semibold text-gray-500 mb-2">AI Assist<Tip text={STUDIO_TIPS.ai_mode} /></h4>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <div className={labelCls}>Mode<Tip text={STUDIO_TIPS.ai_mode} /></div>
                <select
                  className={`${selectCls} w-full`}
                  value={explicitMode}
                  onChange={(e) => updateAiAssist({ mode: e.target.value || null })}
                >
                  <option value="">auto ({derivedMode})</option>
                  <option value="off">off - no LLM, deterministic only</option>
                  <option value="advisory">advisory - gpt-5-low, single pass</option>
                  <option value="planner">planner - gpt-5-low -&gt; gpt-5.2-high</option>
                  <option value="judge">judge - gpt-5.2-high, reasoning</option>
                </select>
              </div>
              <div>
                <div className={labelCls}>Model Strategy<Tip text={STUDIO_TIPS.ai_model_strategy} /></div>
                <select
                  className={`${selectCls} w-full`}
                  value={strategy}
                  onChange={(e) => updateAiAssist({ model_strategy: e.target.value })}
                >
                  <option value="auto">auto - mode decides model</option>
                  <option value="force_fast">force_fast - always gpt-5-low</option>
                  <option value="force_deep">force_deep - always gpt-5.2-high</option>
                </select>
              </div>
              <div>
                <div className={labelCls}>Max Calls<Tip text={STUDIO_TIPS.ai_max_calls} /></div>
                <input
                  className={`${inputCls} w-full`}
                  type="number"
                  min={1}
                  max={10}
                  value={explicitCalls || ''}
                  onChange={(e) => updateAiAssist({ max_calls: parseInt(e.target.value, 10) || null })}
                  placeholder={`auto (${derivedCalls})`}
                />
              </div>
              <div>
                <div className={labelCls}>Max Tokens<Tip text={STUDIO_TIPS.ai_max_tokens} /></div>
                <input
                  className={`${inputCls} w-full`}
                  type="number"
                  min={256}
                  max={65536}
                  step={1024}
                  value={sourceAiAssist.max_tokens || ''}
                  onChange={(e) => updateAiAssist({ max_tokens: parseInt(e.target.value, 10) || null })}
                  placeholder={`auto (${effectiveMode === 'off' ? '0' : effectiveMode === 'advisory' ? '4096' : effectiveMode === 'planner' ? '8192' : '16384'})`}
                />
              </div>
            </div>

            <div className="mt-2 text-[11px] bg-gray-50 dark:bg-gray-800/50 rounded p-2.5 border border-gray-200 dark:border-gray-700 space-y-1">
              <div className="text-[10px] font-semibold text-gray-400 mb-1">Effective AI Configuration</div>
              <div className="flex items-center gap-2">
                <span className="text-gray-400 w-14">Mode:</span>
                <span className="text-gray-600 dark:text-gray-300">{effectiveMode}</span>
                {!explicitMode && <span className="text-gray-400 italic text-[10px]">(auto from {reqLvl}{diff !== 'easy' ? ` + ${diff}` : ''})</span>}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-400 w-14">Model:</span>
                <span className="text-gray-600 dark:text-gray-300 font-mono text-[10px]">{effectiveModel.model}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-400 w-14">Budget:</span>
                <span className="text-gray-600 dark:text-gray-300">{effectiveMode === 'off' ? '0' : effectiveCalls} call{effectiveCalls !== 1 ? 's' : ''}</span>
                {!explicitCalls && effectiveMode !== 'off' && <span className="text-gray-400 italic text-[10px]">(auto from effort {effort})</span>}
              </div>
            </div>

            <div className="mt-2">
              <div className="flex items-center gap-2 mb-1">
                <span className={labelCls.replace(' mb-1', '')}>Extraction Guidance (sent to LLM)<Tip text={STUDIO_TIPS.ai_reasoning_note} /></span>
                {!hasExplicit && <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500 italic font-medium">Auto</span>}
              </div>
              <textarea
                className={`${inputCls} w-full`}
                rows={3}
                value={explicitNote}
                onChange={(e) => updateAiAssist({ reasoning_note: e.target.value })}
                placeholder={`Auto: ${autoNote}`}
              />
              {hasExplicit && (
                <button
                  className="text-[10px] text-blue-500 hover:text-blue-700 mt-1"
                  onClick={() => updateAiAssist({ reasoning_note: '' })}
                >
                  Clear &amp; revert to auto-generated guidance
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {buildMode === 'scratch' ? (
        <>
          <div className="grid grid-cols-4 gap-3 mb-4">
            <div>
              <div className={labelCls}>Primary Identifier Column<Tip text={STUDIO_TIPS.primary_identifier} /></div>
              <ColumnPicker
                value={roles.primary_identifier || 'A'}
                onChange={(v) => updateRoles({ primary_identifier: v || 'A' })}
              />
              <span className="inline-block mt-1 px-1.5 py-0.5 text-[9px] font-medium text-gray-400 bg-gray-100 dark:bg-gray-800 rounded">Variance: Authoritative</span>
            </div>
            <div className="col-span-3 flex items-end gap-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!source.auto_derive_aliases}
                  onChange={(e) => onUpdate({ auto_derive_aliases: e.target.checked })}
                  className="rounded border-gray-300"
                />
                <span className="text-xs text-gray-500">Auto-derive aliases<Tip text={STUDIO_TIPS.auto_derive_aliases} /></span>
              </label>
            </div>
          </div>
          <details className="mt-3 mb-4 text-xs">
            <summary className="cursor-pointer text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 select-none">
              Advanced Settings
            </summary>
            <div className="grid grid-cols-4 gap-3 mt-2 p-2 bg-gray-50 dark:bg-gray-900/30 rounded">
              <div>
                <div className={labelCls}>Stop After Blank Primary<Tip text={STUDIO_TIPS.stop_after_blank_primary} /></div>
                <input
                  className={`${inputCls} w-full`}
                  type="number"
                  min={1}
                  max={200}
                  value={source.stop_after_blank_primary || 10}
                  onChange={(e) => onUpdate({ stop_after_blank_primary: parseInt(e.target.value, 10) || 10 })}
                />
              </div>
            </div>
          </details>
        </>
      ) : (
        <div className="grid grid-cols-4 gap-3 mb-4">
          <div>
            <div className={labelCls}>Stop After Blank Primary<Tip text={STUDIO_TIPS.stop_after_blank_primary} /></div>
            <input
              className={`${inputCls} w-full`}
              type="number"
              min={1}
              max={200}
              value={source.stop_after_blank_primary || 10}
              onChange={(e) => onUpdate({ stop_after_blank_primary: parseInt(e.target.value, 10) || 10 })}
            />
          </div>
          <div>
            <div className={labelCls}>Primary Identifier Column<Tip text={STUDIO_TIPS.primary_identifier} /></div>
            {hasHeaders ? (
              <HeaderColumnSelect
                value={roles.primary_identifier || 'A'}
                onChange={(v) => updateRoles({ primary_identifier: v || 'A' })}
                headerOptions={headerOptions}
              />
            ) : (
              <ColumnPicker
                value={roles.primary_identifier || 'A'}
                onChange={(v) => updateRoles({ primary_identifier: v || 'A' })}
              />
            )}
            <span className="inline-block mt-1 px-1.5 py-0.5 text-[9px] font-medium text-gray-400 bg-gray-100 dark:bg-gray-800 rounded">Variance: Authoritative</span>
          </div>
          <div className="col-span-2 flex items-end gap-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={!!source.auto_derive_aliases}
                onChange={(e) => onUpdate({ auto_derive_aliases: e.target.checked })}
                className="rounded border-gray-300"
              />
              <span className="text-xs text-gray-500">Auto-derive aliases<Tip text={STUDIO_TIPS.auto_derive_aliases} /></span>
            </label>
          </div>
        </div>
      )}

      {/* Role Management */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
        {buildMode === 'scratch' ? (
          <>
            {/* Scratch mode: all roles visible in a grid, no toggles */}
            <div className="text-xs font-medium text-gray-500 mb-2">Column Roles<Tip text={STUDIO_TIPS.scratch_mode} /></div>
            <div className="grid grid-cols-4 gap-3 mb-3">
              <div>
                <div className={labelCls}>Name (Primary)*</div>
                <ColumnPicker
                  value={roles.primary_identifier || 'A'}
                  onChange={(v) => updateRoles({ primary_identifier: v || 'A' })}
                />
                <div className="text-[10px] text-gray-400 mt-0.5">Header: &quot;Name&quot;</div>
                <span className="inline-block mt-1 px-1.5 py-0.5 text-[9px] font-medium text-gray-400 bg-gray-100 dark:bg-gray-800 rounded">Variance: Authoritative</span>
              </div>
              <div>
                <div className={labelCls}>Maker (Brand)</div>
                <ColumnPicker
                  value={roles.maker || ''}
                  onChange={(v) => {
                    updateRoles({ maker: v });
                    const next = new Set(activeRoles);
                    if (v) next.add('maker'); else next.delete('maker');
                    setActiveRoles(next);
                  }}
                />
                {roles.maker ? <div className="text-[10px] text-gray-400 mt-0.5">Header: &quot;Maker&quot;</div> : null}
                <span className="inline-block mt-1 px-1.5 py-0.5 text-[9px] font-medium text-gray-400 bg-gray-100 dark:bg-gray-800 rounded">Variance: Authoritative</span>
              </div>
              <div>
                <div className={labelCls}>Aliases</div>
                <TagPicker
                  values={Array.isArray(roles.aliases) ? roles.aliases : []}
                  onChange={(v) => {
                    updateRoles({ aliases: v });
                    const next = new Set(activeRoles);
                    if (v.length > 0) next.add('aliases'); else next.delete('aliases');
                    setActiveRoles(next);
                  }}
                  suggestions={AZ_COLUMNS}
                  placeholder="Add column..."
                />
              </div>
              <div>
                <div className={labelCls}>Links (URLs)</div>
                <TagPicker
                  values={Array.isArray(roles.links) ? roles.links : []}
                  onChange={(v) => {
                    updateRoles({ links: v });
                    const next = new Set(activeRoles);
                    if (v.length > 0) next.add('links'); else next.delete('links');
                    setActiveRoles(next);
                  }}
                  suggestions={AZ_COLUMNS}
                  placeholder="Add column..."
                />
                <span className="inline-block mt-1 px-1.5 py-0.5 text-[9px] font-medium text-gray-400 bg-gray-100 dark:bg-gray-800 rounded">Variance: Authoritative</span>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Existing mode: toggle-based roles */}
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs font-medium text-gray-500">Optional Roles:</span>
              {ROLE_DEFS.map((rd) => (
                <button
                  key={rd.id}
                  onClick={() => toggleRole(rd.id)}
                  className={`text-xs px-2 py-1 rounded border ${
                    activeRoles.has(rd.id)
                      ? 'bg-accent/10 border-accent text-accent'
                      : 'border-gray-300 dark:border-gray-600 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  {activeRoles.has(rd.id) ? '- ' : '+ '}{rd.label}
                </button>
              ))}
            </div>

            {/* Role column assignments */}
            <div className="grid grid-cols-2 gap-3">
              {activeRoles.has('maker') ? (
                <div>
                  <div className={labelCls}>Maker Column<Tip text={STUDIO_TIPS.maker_column} /></div>
                  {hasHeaders ? (
                    <HeaderColumnSelect
                      value={roles.maker || ''}
                      onChange={(v) => updateRoles({ maker: v })}
                      headerOptions={headerOptions}
                      allowEmpty
                      placeholder="(none)"
                    />
                  ) : (
                    <ColumnPicker
                      value={roles.maker || ''}
                      onChange={(v) => updateRoles({ maker: v })}
                    />
                  )}
                  <span className="inline-block mt-1 px-1.5 py-0.5 text-[9px] font-medium text-gray-400 bg-gray-100 dark:bg-gray-800 rounded">Variance: Authoritative</span>
                </div>
              ) : null}
              {activeRoles.has('aliases') ? (
                <div>
                  <div className={labelCls}>Aliases Columns<Tip text={STUDIO_TIPS.aliases_columns} /></div>
                  {hasHeaders ? (
                    <TagPicker
                      values={Array.isArray(roles.aliases) ? roles.aliases : []}
                      onChange={(v) => updateRoles({ aliases: v })}
                      suggestions={headerOptions.map(({ col, header }) => `${col} — ${header}`)}
                      placeholder="Add column..."
                      normalize={(v) => v.split(' — ')[0] || v}
                    />
                  ) : (
                    <TagPicker
                      values={Array.isArray(roles.aliases) ? roles.aliases : []}
                      onChange={(v) => updateRoles({ aliases: v })}
                      suggestions={AZ_COLUMNS}
                      placeholder="Add column..."
                    />
                  )}
                </div>
              ) : null}
              {activeRoles.has('links') ? (
                <div>
                  <div className={labelCls}>Reference URL Columns<Tip text={STUDIO_TIPS.reference_url_columns} /></div>
                  {hasHeaders ? (
                    <TagPicker
                      values={Array.isArray(roles.links) ? roles.links : []}
                      onChange={(v) => updateRoles({ links: v })}
                      suggestions={headerOptions.map(({ col, header }) => `${col} — ${header}`)}
                      placeholder="Add column..."
                      normalize={(v) => v.split(' — ')[0] || v}
                    />
                  ) : (
                    <TagPicker
                      values={Array.isArray(roles.links) ? roles.links : []}
                      onChange={(v) => updateRoles({ links: v })}
                      suggestions={AZ_COLUMNS}
                      placeholder="Add column..."
                    />
                  )}
                  <span className="inline-block mt-1 px-1.5 py-0.5 text-[9px] font-medium text-gray-400 bg-gray-100 dark:bg-gray-800 rounded">Variance: Authoritative</span>
                </div>
              ) : null}
            </div>
          </>
        )}

        {/* Properties (Redesigned) */}
        {(buildMode === 'scratch' || activeRoles.has('properties')) ? (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <div className={labelCls}>Attributes (Properties)<Tip text={STUDIO_TIPS.comp_field_key} /></div>
              <div className="flex gap-2">
                {/* Add from field keys */}
                {fieldOrder.length > 0 ? (
                  <select
                    className={`${selectCls} text-xs`}
                    value=""
                    onChange={(e) => {
                      if (!e.target.value) return;
                      addPropertyFromFieldKey(e.target.value);
                    }}
                  >
                    <option value="">+ Add from field keys...</option>
                    {Object.entries(fieldKeyGroups).sort(([a], [b]) => a.localeCompare(b)).map(([group, keys]) => (
                      <optgroup key={group} label={group}>
                        {keys.map((k) => (
                          <option key={k.key} value={k.key}>{k.label} ({k.type})</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                ) : null}
                <button onClick={addPropertyRow} className={btnSecondary}>+ Manual</button>
              </div>
            </div>
            {propertyRows.length > 0 ? (
              <div className="space-y-3">
                {propertyRows.map((prop, pidx) => {
                  const inherited = prop.field_key ? getInheritedInfo(prop.field_key) : null;
                  const preview = getColumnPreview(prop.column);
                  const isAutoMatched = prop.mode === 'auto' && prop.column && prop.column_header;
                  const isManual = prop.mode === 'manual';
                  return (
                    <div key={pidx} className="border border-gray-200 dark:border-gray-600 rounded overflow-hidden">
                      {/* Top row: Field Key, Column, Variance, Remove */}
                      <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end p-3 pb-2">
                        <div>
                          <div className="text-[10px] text-gray-400 mb-0.5">
                            {isManual ? 'Key (manual)' : 'Field Key'}<Tip text={STUDIO_TIPS.comp_field_key} />
                            {!isManual && prop.field_key ? (
                              <button
                                onClick={() => updatePropertyField(pidx, { mode: 'manual' })}
                                className="ml-2 text-[10px] text-blue-500 hover:text-blue-700"
                              >Manual</button>
                            ) : null}
                            {isManual ? (
                              <button
                                onClick={() => {
                                  if (prop.field_key && rules[prop.field_key]) {
                                    updatePropertyField(pidx, { mode: 'auto' });
                                  }
                                }}
                                className="ml-2 text-[10px] text-blue-500 hover:text-blue-700"
                              >Auto</button>
                            ) : null}
                          </div>
                          {isManual ? (
                            <input
                              className={`${inputCls} w-full`}
                              value={prop.field_key}
                              onChange={(e) => {
                                const key = e.target.value;
                                updatePropertyField(pidx, {
                                  field_key: key,
                                  column_header: deriveHeader(key),
                                });
                              }}
                              placeholder="e.g. max_dpi"
                            />
                          ) : (
                            <select
                              className={`${selectCls} w-full`}
                              value={prop.field_key}
                              onChange={(e) => selectFieldKey(pidx, e.target.value)}
                            >
                              <option value="">(select field key)</option>
                              {/* Include the currently selected key so the select shows its value */}
                              {prop.field_key && rules[prop.field_key] ? (() => {
                                const r = rules[prop.field_key];
                                const ui = r.ui || {};
                                const ct = r.contract || {};
                                return <option key={prop.field_key} value={prop.field_key}>{String(ui.label || r.label || prop.field_key)} ({String(ct.type || 'string')}) &#10003;</option>;
                              })() : prop.field_key ? (
                                <option key={prop.field_key} value={prop.field_key}>{prop.field_key} &#10003;</option>
                              ) : null}
                              {Object.entries(fieldKeyGroups).sort(([a], [b]) => a.localeCompare(b)).map(([group, keys]) => (
                                <optgroup key={group} label={group}>
                                  {keys.map((k) => (
                                    <option key={k.key} value={k.key}>{k.label} ({k.type})</option>
                                  ))}
                                </optgroup>
                              ))}
                            </select>
                          )}
                        </div>
                        <div>
                          <div className="text-[10px] text-gray-400 mb-0.5">
                            Column<Tip text={STUDIO_TIPS.comp_column} />
                            {isAutoMatched ? (
                              <span className="ml-1 text-green-600" title="Auto-matched">&#10003;</span>
                            ) : prop.mode === 'auto' && prop.field_key && !prop.column ? (
                              <span className="ml-1 text-yellow-500" title="No auto-match found">&#9888;</span>
                            ) : null}
                          </div>
                          {hasHeaders ? (
                            <HeaderColumnSelect
                              value={prop.column}
                              onChange={(v) => {
                                const hdr = headerOptions.find((h) => h.col === v);
                                updatePropertyField(pidx, { column: v, column_header: hdr?.header || '' });
                              }}
                              headerOptions={headerOptions}
                              allowEmpty
                              placeholder="(pick)"
                            />
                          ) : (
                            <ColumnPicker
                              value={prop.column}
                              onChange={(v) => updatePropertyField(pidx, { column: v, column_header: prop.column_header || deriveHeader(prop.field_key) })}
                            />
                          )}
                          {prop.column_header ? (
                            <div className="text-[10px] text-gray-400 mt-0.5">
                              Header: &quot;{prop.column_header}&quot;
                              {isAutoMatched ? (
                                <span className="text-green-600 ml-1">(from sheet)</span>
                              ) : prop.field_key ? (
                                <span className="text-amber-500 ml-1">(from key)</span>
                              ) : null}
                            </div>
                          ) : prop.field_key ? (
                            <div className="text-[10px] text-amber-500 mt-0.5">
                              Header: &quot;{deriveHeader(prop.field_key)}&quot; (from key)
                            </div>
                          ) : null}
                          {prop.column && (() => {
                            const others = new Set<string>();
                            if (roles.primary_identifier) others.add(roles.primary_identifier);
                            if (roles.maker) others.add(roles.maker);
                            for (const a of (Array.isArray(roles.aliases) ? roles.aliases : [])) others.add(a);
                            for (const l of (Array.isArray(roles.links) ? roles.links : [])) others.add(l);
                            for (const pr of propertyRows) if (pr !== prop && pr.column) others.add(pr.column);
                            return others.has(prop.column) ? (
                              <span className="text-red-500 text-[10px]">&#9888; Column in use</span>
                            ) : null;
                          })()}
                        </div>
                        <div>
                          <div className="text-[10px] text-gray-400 mb-0.5">Variance<Tip text={STUDIO_TIPS.comp_variance_policy} /></div>
                          <select
                            className={`${selectCls} w-full`}
                            value={prop.variance_policy}
                            onChange={(e) => updatePropertyField(pidx, { variance_policy: e.target.value as PropertyMapping['variance_policy'] })}
                          >
                            {VARIANCE_POLICIES.map((vp) => (
                              <option key={vp.value} value={vp.value}>{vp.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <button
                            onClick={() => removePropertyRow(pidx)}
                            className="text-xs text-red-500 hover:text-red-700 py-1.5 px-2"
                            title="Remove"
                          >&#10005;</button>
                        </div>
                      </div>

                      {/* Tolerance input (shown for upper_bound/lower_bound/range) */}
                      {(prop.variance_policy === 'upper_bound' || prop.variance_policy === 'lower_bound' || prop.variance_policy === 'range') ? (
                        <div className="px-3 pb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-400">Tolerance<Tip text={STUDIO_TIPS.comp_tolerance} /></span>
                            <input
                              className={`${inputCls} w-24`}
                              type="number"
                              min={0}
                              step="any"
                              value={prop.tolerance ?? ''}
                              onChange={(e) => updatePropertyField(pidx, { tolerance: e.target.value ? Number(e.target.value) : null })}
                              placeholder="e.g. 5"
                            />
                          </div>
                        </div>
                      ) : null}

                      {/* Bottom banner: Inherited info + preview */}
                      <div className="bg-gray-50 dark:bg-gray-900/50 px-3 py-2 text-[11px] text-gray-500 border-t border-gray-200 dark:border-gray-700">
                        {/* Auto mode: show inherited properties */}
                        {!isManual && inherited && prop.field_key ? (
                          <div className="flex flex-wrap gap-1.5 items-center">
                            <span className="font-medium text-gray-600 dark:text-gray-300">Inherited:</span>
                            <span className="bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded text-[10px]">{inherited.type}</span>
                            {inherited.unit ? (
                              <span className="bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded text-[10px]">{inherited.unit}</span>
                            ) : null}
                            {inherited.template ? (
                              <span className="bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded text-[10px]">{inherited.template}</span>
                            ) : null}
                            {inherited.evidenceRefs > 0 ? (
                              <span className="bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded text-[10px]">evidence:{inherited.evidenceRefs} refs</span>
                            ) : null}
                          </div>
                        ) : null}
                        {/* Manual mode: show type/unit overrides */}
                        {isManual ? (
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-gray-400">Type:</span>
                              <select
                                className={`${selectCls} text-[11px] py-0.5`}
                                value={prop.manual_type || prop.type || 'string'}
                                onChange={(e) => updatePropertyField(pidx, { manual_type: e.target.value })}
                              >
                                {PROPERTY_TYPES.map((t) => (
                                  <option key={t.value} value={t.value}>{t.label}</option>
                                ))}
                              </select>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-gray-400">Unit:</span>
                              <ComboSelect
                                value={prop.manual_unit || prop.unit || ''}
                                onChange={(v) => updatePropertyField(pidx, { manual_unit: v })}
                                options={UNITS}
                                placeholder="e.g. mm"
                              />
                            </div>
                            <span className="text-yellow-500 text-[10px]">&#9888; Draft</span>
                          </div>
                        ) : null}
                        {/* Value preview */}
                        {preview.length > 0 ? (
                          <div className="mt-1">
                            <span className="text-gray-400">Preview:</span>{' '}
                            <span className="font-mono text-gray-600 dark:text-gray-300">{preview.join(', ')}</span>
                            <span className="text-gray-400 ml-1">({preview.length} values)</span>
                          </div>
                        ) : prop.column ? (
                          <div className="mt-1 text-gray-400">(no preview data)</div>
                        ) : null}
                      </div>

                      {/* Constraints (interactive) */}
                      <ConstraintEditor
                        constraints={prop.constraints || []}
                        onChange={(next) => updatePropertyField(pidx, { constraints: next })}
                        componentPropertyKeys={propertyRows.map((r) => r.field_key).filter(Boolean)}
                        fieldOrder={fieldOrder}
                        rules={rules}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-gray-400">No property rows. Use "Add from field keys" to bind attributes, or "Manual" to create custom properties.</p>
            )}
          </div>
        ) : null}
      </div>

      {/* Summary line */}
      <div className="mt-3 text-xs text-gray-400">
        Primary: <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">{colHeader(roles.primary_identifier || '?')}</code>
        {(roles.maker || activeRoles.has('maker')) ? (
          <> | Maker: <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">{roles.maker ? colHeader(roles.maker) : '-'}</code></>
        ) : null}
        {(activeRoles.has('aliases') || (Array.isArray(roles.aliases) && roles.aliases.length > 0)) ? (
          <> | Aliases: <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">{Array.isArray(roles.aliases) ? roles.aliases.map((a) => colHeader(a)).join(', ') || '-' : '-'}</code></>
        ) : null}
        {(activeRoles.has('links') || (Array.isArray(roles.links) && roles.links.length > 0)) ? (
          <> | Links: <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">{Array.isArray(roles.links) ? roles.links.map((l) => colHeader(l)).join(', ') || '-' : '-'}</code></>
        ) : null}
        {(buildMode === 'scratch' || activeRoles.has('properties')) ? (
          <> | Props: {propertyRows.length}</>
        ) : null}
        {source.auto_derive_aliases ? ' | auto-derive' : ''}
      </div>
    </div>
  );
}

// ── Sheet Card ──────────────────────────────────────────────────────
function SheetCard({ sheet }: { sheet: SheetPreview }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="font-mono text-sm font-medium">{sheet.name}</span>
        <div className="flex gap-2 text-xs text-gray-400">
          <span>{sheet.non_empty_cells} cells</span>
          <span>{sheet.max_row}r x {sheet.max_col}c</span>
        </div>
      </div>
      {sheet.detected_roles && sheet.detected_roles.length > 0 ? (
        <div className="flex gap-1 mb-2">
          {sheet.detected_roles.map((role) => (
            <span key={role} className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">{role}</span>
          ))}
        </div>
      ) : null}
      {sheet.preview ? (
        <>
          <button onClick={() => setExpanded(!expanded)} className="text-xs text-accent hover:underline">
            {expanded ? 'Hide preview' : 'Show preview'}
          </button>
          {expanded && sheet.preview.rows ? (
            <div className="mt-2 overflow-x-auto">
              <table className="text-xs border-collapse">
                <thead>
                  <tr>
                    {sheet.preview.columns.map((col) => (
                      <th key={col} className="border border-gray-200 dark:border-gray-600 px-2 py-1 bg-gray-50 dark:bg-gray-700 font-mono">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sheet.preview.rows.slice(0, 8).map((row, i) => (
                    <tr key={i}>
                      {sheet.preview!.columns.map((col) => (
                        <td key={col} className="border border-gray-200 dark:border-gray-600 px-2 py-1 max-w-[200px] truncate">{String(row.cells?.[col] ?? '')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

// ── Key Navigator ───────────────────────────────────────────────────
// Helper to safely get nested values
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
function boolN(obj: Record<string, unknown>, path: string, fallback = false): boolean {
  const v = getN(obj, path);
  return typeof v === 'boolean' ? v : fallback;
}
function arrN(obj: Record<string, unknown>, path: string): string[] {
  const v = getN(obj, path);
  return Array.isArray(v) ? v.map(String) : [];
}

// Collapsible section component
function Section({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-semibold bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-t"
      >
        <span>{title}</span>
        <span className="text-gray-400">{open ? '\u25B2' : '\u25BC'}</span>
      </button>
      {open ? <div className="p-3 space-y-3">{children}</div> : null}
    </div>
  );
}

function KeyNavigatorTab({
  category,
  fieldOrder,
  rules,
  selectedKey,
  onSelectKey,
  onSaveRules,
  saving,
  saveSuccess,
  knownValues,
  enumLists,
  sheets,
  componentDb,
}: {
  category: string;
  fieldOrder: string[];
  rules: Record<string, Record<string, unknown>>;
  selectedKey: string;
  onSelectKey: (key: string) => void;
  onSaveRules: (rules: Record<string, unknown>) => void;
  saving: boolean;
  saveSuccess: boolean;
  knownValues: Record<string, string[]>;
  enumLists: EnumListEntry[];
  sheets: SheetPreview[];
  componentDb: ComponentDbResponse;
}) {
  // Local editable copy of all rules
  const [editedRules, setEditedRules] = useState<Record<string, Record<string, unknown>>>({});
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (Object.keys(rules).length > 0 && !initialized) {
      setEditedRules(JSON.parse(JSON.stringify(rules)));
      setInitialized(true);
    }
  }, [rules, initialized]);

  const groups = useMemo(() => {
    const source = Object.keys(editedRules).length > 0 ? editedRules : rules;
    const map: Record<string, string[]> = {};
    for (const key of fieldOrder) {
      const r = source[key] as Record<string, unknown> | undefined;
      const uiGroup = r?.ui ? strN(r, 'ui.group', '') : '';
      const group = uiGroup || String(r?.group || 'ungrouped');
      (map[group] = map[group] || []).push(key);
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [fieldOrder, editedRules, rules]);

  // Update a field in the local edited rules
  // Helper: set a nested value on a rule object (mutates in place)
  function setNested(rule: Record<string, unknown>, dotPath: string, val: unknown) {
    const p = dotPath.split('.');
    if (p.length === 1) { rule[p[0]] = val; return; }
    if (p.length === 2) {
      const parent = { ...((rule[p[0]] || {}) as Record<string, unknown>) };
      parent[p[1]] = val;
      rule[p[0]] = parent;
      return;
    }
    if (p.length === 3) {
      const p1 = { ...((rule[p[0]] || {}) as Record<string, unknown>) };
      const p2 = { ...((p1[p[1]] || {}) as Record<string, unknown>) };
      p2[p[2]] = val;
      p1[p[1]] = p2;
      rule[p[0]] = p1;
    }
  }

  function updateField(key: string, path: string, value: unknown) {
    setEditedRules((prev) => {
      const next = { ...prev };
      const rule = { ...(next[key] || {}) };

      // Apply the primary update
      setNested(rule, path, value);

      // ── Flat mirror properties for backward compat ──────────
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

      // ── Global coupling: Parse Template → Enum + UI ────────
      if (path === 'parse.template') {
        const tpl = String(value || '');

        if (tpl === 'boolean_yes_no_unk') {
          // Boolean locks enum to yes/no
          setNested(rule, 'enum.policy', 'closed');
          setNested(rule, 'enum.source', 'yes_no');
          setNested(rule, 'enum.match.strategy', 'exact');
          rule.enum_policy = 'closed';
          rule.enum_source = 'yes_no';
          setNested(rule, 'ui.input_control', 'text');
        } else if (tpl === 'component_reference') {
          // Auto-detect component type from field key
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
          // Numeric — disable enum, enable unit controls
          setNested(rule, 'enum.policy', 'open');
          setNested(rule, 'enum.source', null);
          rule.enum_policy = 'open';
          rule.enum_source = '';
          setNested(rule, 'ui.input_control', 'number');
        } else if (tpl === 'url_field') {
          setNested(rule, 'enum.policy', 'open');
          setNested(rule, 'enum.source', null);
          rule.enum_policy = 'open';
          rule.enum_source = '';
          setNested(rule, 'ui.input_control', 'url');
        } else if (tpl === 'date_field') {
          setNested(rule, 'enum.policy', 'open');
          setNested(rule, 'enum.source', null);
          rule.enum_policy = 'open';
          rule.enum_source = '';
          setNested(rule, 'ui.input_control', 'date');
        } else if (tpl === 'list_of_tokens_delimited' || tpl === 'token_list') {
          // Token list — enable enum, suggest multi_select
          setNested(rule, 'ui.input_control', 'multi_select');
        }
        // text_field / text_block — keep current enum config, no auto-change
      }

      // ── Global coupling: Value Source → UI input control ────
      if (path === 'enum.source') {
        const src = String(value || '');
        if (src.startsWith('component_db.')) {
          setNested(rule, 'ui.input_control', 'component_picker');
        } else if (src === 'yes_no') {
          setNested(rule, 'ui.input_control', 'text');
        } else if (src.startsWith('data_lists.')) {
          // Workbook enum — suggest select for closed, text otherwise
          const pol = String((rule.enum as Record<string, unknown>)?.policy || rule.enum_policy || 'open');
          setNested(rule, 'ui.input_control', pol === 'closed' ? 'select' : 'text');
        }
      }

      // ── Global coupling: Enum Policy → UI input control ────
      if (path === 'enum.policy') {
        const pol = String(value || 'open');
        const src = String((rule.enum as Record<string, unknown>)?.source || rule.enum_source || '');
        if (src.startsWith('data_lists.') && pol === 'closed') {
          setNested(rule, 'ui.input_control', 'select');
        } else if (src.startsWith('component_db.')) {
          setNested(rule, 'ui.input_control', 'component_picker');
        }
      }

      // ── Priority/difficulty/effort changes: clear auto-written notes so placeholder takes over ──
      if (['priority.required_level', 'priority.difficulty', 'priority.effort'].includes(path)) {
        const ai = (rule.ai_assist || {}) as Record<string, unknown>;
        const existingNote = String(ai.reasoning_note || '');
        // If the note looks auto-generated (contains " - auto: " or "LLM extraction skipped"), clear it
        if (existingNote && (existingNote.includes(' - auto: ') || existingNote.includes('LLM extraction skipped'))) {
          setNested(rule, 'ai_assist.reasoning_note', '');
        }
      }

      // ── Global coupling: Component type → enum source ──────
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
  }

  function handleSaveAll() {
    onSaveRules(editedRules);
  }

  const currentRule = selectedKey ? (editedRules[selectedKey] || rules[selectedKey] || null) : null;

  return (
    <div className="flex gap-4" style={{ minHeight: 'calc(100vh - 350px)' }}>
      {/* Key list */}
      <div className="w-56 flex-shrink-0 border-r border-gray-200 dark:border-gray-700 pr-3 overflow-y-auto max-h-[calc(100vh-350px)]">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-gray-500">Click a key to edit</p>
          <span className="text-xs text-gray-400">{fieldOrder.length} keys</span>
        </div>
        {groups.map(([group, keys]) => (
          <div key={group} className="mb-3">
            <h4 className="text-xs font-semibold uppercase text-gray-400 mb-1">{group}</h4>
            {keys.map((key) => (
              <button
                key={key}
                onClick={() => onSelectKey(key)}
                className={`block w-full text-left px-2 py-1 text-sm rounded ${
                  selectedKey === key
                    ? 'bg-accent/10 text-accent font-medium'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                }${editedRules[key]?._edited ? ' border-l-2 border-amber-400' : ''}`}
              >
                {humanizeField(key)}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Key detail editor */}
      <div className="flex-1 overflow-y-auto max-h-[calc(100vh-350px)] pr-2">
        {selectedKey && currentRule ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between sticky top-0 bg-white dark:bg-gray-900 py-2 z-10 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h3 className="text-lg font-semibold font-mono">{humanizeField(selectedKey)}</h3>
                <span className="text-xs text-gray-400 font-mono">{selectedKey}</span>
              </div>
              <div className="flex items-center gap-2">
                {currentRule._edited ? <span className="text-xs text-amber-500">Modified</span> : null}
                <button onClick={handleSaveAll} disabled={saving} className={btnPrimary}>
                  {saving ? 'Saving...' : 'Save All Changes'}
                </button>
                {saveSuccess ? <span className="text-xs text-green-600">Saved</span> : null}
              </div>
            </div>

            {/* ── Field Coupling Summary ────────────────────────────── */}
            {(() => {
              const pt = strN(currentRule, 'parse.template', strN(currentRule, 'parse_template'));
              const es = strN(currentRule, 'enum.source', strN(currentRule, 'enum_source'));
              const ep = strN(currentRule, 'enum.policy', strN(currentRule, 'enum_policy', 'open'));
              const ic = strN(currentRule, 'ui.input_control', 'text');
              const ct = strN(currentRule, 'component.type');
              const chipCls = 'px-2 py-0.5 text-[11px] rounded-full font-medium';
              const isComponent = pt === 'component_reference';
              const isBoolean = pt === 'boolean_yes_no_unk';
              const isNumeric = ['number_with_unit', 'list_of_numbers_with_unit', 'list_numbers_or_ranges_with_unit'].includes(pt);
              const isDisabled = pt === 'url_field' || pt === 'date_field';
              return (
                <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-xs">
                  <span className="text-gray-400 font-medium mr-1">Coupling:</span>
                  <span className={`${chipCls} ${isComponent ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' : isBoolean ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' : isNumeric ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' : isDisabled ? 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400' : 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'}`}>
                    {pt || 'none'}
                  </span>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <span className="text-gray-500">Enum: <span className="font-mono">{ep}</span></span>
                  {es ? (
                    <>
                      <span className="text-gray-300 dark:text-gray-600">|</span>
                      <span className="text-gray-500">Source: <span className="font-mono">{es}</span></span>
                    </>
                  ) : null}
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <span className="text-gray-500">Input: <span className="font-mono">{ic}</span></span>
                  {ct ? (
                    <>
                      <span className="text-gray-300 dark:text-gray-600">|</span>
                      <span className={`${chipCls} bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300`}>
                        DB: {ct}
                      </span>
                    </>
                  ) : null}
                </div>
              );
            })()}

            {/* ── Contract ────────────────────────────────────────── */}
            <Section title="Contract (Type, Shape, Unit)" defaultOpen>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <div className={labelCls}>Data Type<Tip text={STUDIO_TIPS.data_type} /></div>
                  <select className={`${selectCls} w-full`} value={strN(currentRule, 'contract.type', 'string')} onChange={(e) => updateField(selectedKey, 'contract.type', e.target.value)}>
                    <option value="string">string</option>
                    <option value="number">number</option>
                    <option value="integer">integer</option>
                    <option value="boolean">boolean</option>
                    <option value="date">date</option>
                    <option value="url">url</option>
                    <option value="enum">enum</option>
                  </select>
                </div>
                <div>
                  <div className={labelCls}>Shape<Tip text={STUDIO_TIPS.shape} /></div>
                  <select className={`${selectCls} w-full`} value={strN(currentRule, 'contract.shape', 'scalar')} onChange={(e) => updateField(selectedKey, 'contract.shape', e.target.value)}>
                    <option value="scalar">scalar</option>
                    <option value="list">list</option>
                    <option value="structured">structured</option>
                    <option value="key_value">key_value</option>
                  </select>
                </div>
                <div>
                  <div className={labelCls}>Unit<Tip text={STUDIO_TIPS.contract_unit} /></div>
                  <ComboSelect value={strN(currentRule, 'contract.unit')} onChange={(v) => updateField(selectedKey, 'contract.unit', v || null)} options={UNITS} placeholder="e.g. g, mm, Hz" />
                </div>
                <div>
                  <div className={labelCls}>Unknown Token<Tip text={STUDIO_TIPS.unknown_token} /></div>
                  <ComboSelect value={strN(currentRule, 'contract.unknown_token', 'unk')} onChange={(v) => updateField(selectedKey, 'contract.unknown_token', v)} options={UNKNOWN_TOKENS} placeholder="unk" />
                </div>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <div className={labelCls}>Rounding Decimals<Tip text={STUDIO_TIPS.rounding_decimals} /></div>
                  <input className={`${inputCls} w-full`} type="number" min={0} max={6} value={numN(currentRule, 'contract.rounding.decimals', 0)} onChange={(e) => updateField(selectedKey, 'contract.rounding.decimals', parseInt(e.target.value, 10) || 0)} />
                </div>
                <div>
                  <div className={labelCls}>Rounding Mode<Tip text={STUDIO_TIPS.rounding_mode} /></div>
                  <select className={`${selectCls} w-full`} value={strN(currentRule, 'contract.rounding.mode', 'nearest')} onChange={(e) => updateField(selectedKey, 'contract.rounding.mode', e.target.value)}>
                    <option value="nearest">nearest</option>
                    <option value="floor">floor</option>
                    <option value="ceil">ceil</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={boolN(currentRule, 'contract.unknown_reason_required', true)} onChange={(e) => updateField(selectedKey, 'contract.unknown_reason_required', e.target.checked)} className="rounded border-gray-300" />
                    <span className="text-xs text-gray-500">Require unknown reason<Tip text={STUDIO_TIPS.require_unknown_reason} /></span>
                  </label>
                </div>
              </div>
            </Section>

            {/* ── Priority ────────────────────────────────────────── */}
            <Section title="Priority & Effort" defaultOpen>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <div className={labelCls}>Required Level<Tip text={STUDIO_TIPS.required_level} /></div>
                  <select className={`${selectCls} w-full`} value={strN(currentRule, 'priority.required_level', strN(currentRule, 'required_level', 'expected'))} onChange={(e) => updateField(selectedKey, 'priority.required_level', e.target.value)}>
                    <option value="identity">identity</option>
                    <option value="required">required</option>
                    <option value="critical">critical</option>
                    <option value="expected">expected</option>
                    <option value="optional">optional</option>
                    <option value="editorial">editorial</option>
                    <option value="commerce">commerce</option>
                  </select>
                </div>
                <div>
                  <div className={labelCls}>Availability<Tip text={STUDIO_TIPS.availability} /></div>
                  <select className={`${selectCls} w-full`} value={strN(currentRule, 'priority.availability', strN(currentRule, 'availability', 'expected'))} onChange={(e) => updateField(selectedKey, 'priority.availability', e.target.value)}>
                    <option value="always">always</option>
                    <option value="expected">expected</option>
                    <option value="sometimes">sometimes</option>
                    <option value="rare">rare</option>
                    <option value="editorial_only">editorial_only</option>
                  </select>
                </div>
                <div>
                  <div className={labelCls}>Difficulty<Tip text={STUDIO_TIPS.difficulty} /></div>
                  <select className={`${selectCls} w-full`} value={strN(currentRule, 'priority.difficulty', strN(currentRule, 'difficulty', 'easy'))} onChange={(e) => updateField(selectedKey, 'priority.difficulty', e.target.value)}>
                    <option value="easy">easy</option>
                    <option value="medium">medium</option>
                    <option value="hard">hard</option>
                    <option value="instrumented">instrumented</option>
                  </select>
                </div>
                <div>
                  <div className={labelCls}>Effort (1-10)<Tip text={STUDIO_TIPS.effort} /></div>
                  <input className={`${inputCls} w-full`} type="number" min={1} max={10} value={numN(currentRule, 'priority.effort', numN(currentRule, 'effort', 3))} onChange={(e) => updateField(selectedKey, 'priority.effort', parseInt(e.target.value, 10) || 1)} />
                </div>
              </div>
              <div className="flex gap-6">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={boolN(currentRule, 'priority.publish_gate', boolN(currentRule, 'publish_gate'))} onChange={(e) => updateField(selectedKey, 'priority.publish_gate', e.target.checked)} className="rounded border-gray-300" />
                  <span className="text-xs text-gray-500">Publish Gate<Tip text={STUDIO_TIPS.publish_gate} /></span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={boolN(currentRule, 'priority.block_publish_when_unk', boolN(currentRule, 'block_publish_when_unk'))} onChange={(e) => updateField(selectedKey, 'priority.block_publish_when_unk', e.target.checked)} className="rounded border-gray-300" />
                  <span className="text-xs text-gray-500">Block publish when unk<Tip text={STUDIO_TIPS.block_publish_when_unk} /></span>
                </label>
              </div>

              {/* AI Assist */}
              <h4 className="text-xs font-semibold text-gray-500 mt-4 mb-1">AI Assist<Tip text={STUDIO_TIPS.ai_mode} /></h4>
              {(() => {
                const explicitMode = strN(currentRule, 'ai_assist.mode');
                const strategy = strN(currentRule, 'ai_assist.model_strategy', 'auto');
                const explicitCalls = numN(currentRule, 'ai_assist.max_calls', 0);
                const reqLvl = strN(currentRule, 'priority.required_level', strN(currentRule, 'required_level', 'expected'));
                const diff = strN(currentRule, 'priority.difficulty', strN(currentRule, 'difficulty', 'easy'));
                const effort = numN(currentRule, 'priority.effort', numN(currentRule, 'effort', 3));

                // Derive effective mode
                let derivedMode = 'off';
                if (['identity', 'required', 'critical'].includes(reqLvl)) derivedMode = 'judge';
                else if (reqLvl === 'expected' && diff === 'hard') derivedMode = 'planner';
                else if (reqLvl === 'expected') derivedMode = 'advisory';
                const effectiveMode = explicitMode || derivedMode;

                // Derive effective max_calls
                const derivedCalls = effort <= 3 ? 1 : effort <= 6 ? 2 : 3;
                const effectiveCalls = explicitCalls > 0 ? Math.min(explicitCalls, 10) : derivedCalls;

                // Resolve effective model — actual model names from env config
                const modeToModel: Record<string, { model: string; reasoning: boolean }> = {
                  off: { model: 'none', reasoning: false },
                  advisory: { model: 'gpt-5-low', reasoning: false },
                  planner: { model: 'gpt-5-low \u2192 gpt-5.2-high on escalation', reasoning: false },
                  judge: { model: 'gpt-5.2-high', reasoning: true },
                };
                let effectiveModel = modeToModel[effectiveMode] || modeToModel.off;
                if (strategy === 'force_fast') effectiveModel = { model: 'gpt-5-low (forced)', reasoning: false };
                else if (strategy === 'force_deep') effectiveModel = { model: 'gpt-5.2-high (forced)', reasoning: true };

                return (
                  <>
                    <div className="grid grid-cols-4 gap-3">
                      <div>
                        <div className={labelCls}>Mode<Tip text={STUDIO_TIPS.ai_mode} /></div>
                        <select className={`${selectCls} w-full`} value={explicitMode} onChange={(e) => updateField(selectedKey, 'ai_assist.mode', e.target.value || null)}>
                          <option value="">auto ({derivedMode})</option>
                          <option value="off">off &mdash; no LLM, deterministic only</option>
                          <option value="advisory">advisory &mdash; gpt-5-low, single pass</option>
                          <option value="planner">planner &mdash; gpt-5-low &rarr; gpt-5.2-high</option>
                          <option value="judge">judge &mdash; gpt-5.2-high, reasoning</option>
                        </select>
                      </div>
                      <div>
                        <div className={labelCls}>Model Strategy<Tip text={STUDIO_TIPS.ai_model_strategy} /></div>
                        <select className={`${selectCls} w-full`} value={strategy} onChange={(e) => updateField(selectedKey, 'ai_assist.model_strategy', e.target.value)}>
                          <option value="auto">auto &mdash; mode decides model</option>
                          <option value="force_fast">force_fast &mdash; always gpt-5-low</option>
                          <option value="force_deep">force_deep &mdash; always gpt-5.2-high</option>
                        </select>
                      </div>
                      <div>
                        <div className={labelCls}>Max Calls<Tip text={STUDIO_TIPS.ai_max_calls} /></div>
                        <input className={`${inputCls} w-full`} type="number" min={1} max={10} value={explicitCalls || ''} onChange={(e) => updateField(selectedKey, 'ai_assist.max_calls', parseInt(e.target.value, 10) || null)} placeholder={`auto (${derivedCalls})`} />
                      </div>
                      <div>
                        <div className={labelCls}>Max Tokens<Tip text={STUDIO_TIPS.ai_max_tokens} /></div>
                        <input className={`${inputCls} w-full`} type="number" min={256} max={65536} step={1024} value={numN(currentRule, 'ai_assist.max_tokens', 0) || ''} onChange={(e) => updateField(selectedKey, 'ai_assist.max_tokens', parseInt(e.target.value, 10) || null)} placeholder={`auto (${effectiveMode === 'off' ? '0' : effectiveMode === 'advisory' ? '4096' : effectiveMode === 'planner' ? '8192' : '16384'})`} />
                      </div>
                    </div>

                    {/* Effective resolution summary */}
                    <div className="mt-2 text-[11px] bg-gray-50 dark:bg-gray-800/50 rounded p-2.5 border border-gray-200 dark:border-gray-700 space-y-1">
                      <div className="text-[10px] font-semibold text-gray-400 mb-1.5">Effective AI Configuration</div>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400 w-14">Mode:</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          effectiveMode === 'judge' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
                          : effectiveMode === 'planner' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                          : effectiveMode === 'advisory' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                          : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                        }`}>
                          {effectiveMode}
                        </span>
                        {!explicitMode && <span className="text-gray-400 italic text-[10px]">(auto from {reqLvl}{diff !== 'easy' ? ` + ${diff}` : ''})</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400 w-14">Model:</span>
                        <span className="text-gray-600 dark:text-gray-300 font-mono text-[10px]">{effectiveModel.model}</span>
                        {effectiveModel.reasoning && <span className="text-[9px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 font-medium">REASONING</span>}
                        {effectiveMode === 'off' && <span className="text-[9px] px-1 py-0.5 rounded bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400">NO API CALLS</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400 w-14">Budget:</span>
                        <span className="text-gray-600 dark:text-gray-300">{effectiveMode === 'off' ? '0' : effectiveCalls} call{effectiveCalls !== 1 ? 's' : ''}</span>
                        {!explicitCalls && effectiveMode !== 'off' && <span className="text-gray-400 italic text-[10px]">(auto from effort {effort})</span>}
                      </div>
                      {effectiveMode === 'planner' && (
                        <div className="text-[10px] text-gray-400 mt-1 border-t border-gray-200 dark:border-gray-600 pt-1">
                          Starts with fast model. Escalates to reasoning model if conflicts detected or confidence is low.
                        </div>
                      )}
                      {effectiveMode === 'judge' && (
                        <div className="text-[10px] text-gray-400 mt-1 border-t border-gray-200 dark:border-gray-600 pt-1">
                          Uses reasoning model from the start. Full conflict resolution, evidence audit, multi-source verification.
                        </div>
                      )}
                    </div>

                    {(() => {
                      // ── Auto-generate extraction guidance (mirrors backend autoGenerateExtractionGuidance) ──
                      const explicitNote = strN(currentRule, 'ai_assist.reasoning_note');
                      const type = strN(currentRule, 'contract.data_type', strN(currentRule, 'data_type', 'string'));
                      const shape = strN(currentRule, 'contract.shape', strN(currentRule, 'shape', 'scalar'));
                      const unit = strN(currentRule, 'contract.unit', strN(currentRule, 'unit'));
                      const enumPolicy = strN(currentRule, 'enum.policy', strN(currentRule, 'enum_policy', 'open'));
                      const enumSource = strN(currentRule, 'enum.source', strN(currentRule, 'enum_source'));
                      const evidenceReq = boolN(currentRule, 'evidence.evidence_required', boolN(currentRule, 'evidence_required'));
                      const minRefs = numN(currentRule, 'evidence.min_evidence_refs', numN(currentRule, 'min_evidence_refs', 1));
                      const parseTemplate = strN(currentRule, 'parse.template', strN(currentRule, 'parse_template'));
                      const componentType = strN(currentRule, 'component.type', strN(currentRule, 'component_type'));

                      const guidanceParts: string[] = [];

                      // Identity fields
                      if (reqLvl === 'identity') {
                        guidanceParts.push('Identity field \u2014 must exactly match the product. Do not infer or guess. Cross-reference multiple sources to confirm.');
                      }

                      // Component reference
                      if (componentType || parseTemplate === 'component_reference') {
                        const cType = componentType || enumSource.replace('component_db.', '');
                        guidanceParts.push(`Component reference (${cType}). Match to known component names and aliases in the database. If not listed, provide the full name exactly as stated in the source.`);
                      }

                      // Data type guidance
                      if (type === 'boolean' || parseTemplate === 'boolean' || parseTemplate.startsWith('boolean_')) {
                        guidanceParts.push('Boolean field \u2014 determine yes or no from explicit evidence. If the feature is not mentioned, it likely means no, but confirm before assuming.');
                      } else if ((type === 'number' || type === 'integer') && unit) {
                        guidanceParts.push(`Numeric field \u2014 extract the exact value in ${unit}. Convert from other units if needed. If a range is given, extract the primary/default value.`);
                      } else if (type === 'url') {
                        guidanceParts.push('URL field \u2014 extract the full, valid URL. Prefer manufacturer or official sources.');
                      } else if (type === 'date' || (selectedKey || '').includes('date')) {
                        guidanceParts.push('Date field \u2014 extract the actual date. Prefer official announcement or first-availability dates from manufacturer sources.');
                      } else if (type === 'string' && !componentType && !parseTemplate.startsWith('boolean_')) {
                        guidanceParts.push('Text field \u2014 extract the exact value as stated in the source. Do not paraphrase or abbreviate.');
                      }

                      // List shape
                      if (shape === 'list') {
                        guidanceParts.push('Multiple values \u2014 extract all distinct values found across sources.');
                      }

                      // Enum constraint
                      if (enumPolicy === 'closed' && enumSource) {
                        guidanceParts.push(`Closed enum \u2014 value must match one of the known options from ${enumSource}.`);
                      } else if (enumPolicy === 'open_prefer_known' && enumSource) {
                        guidanceParts.push(`Prefer known values from ${enumSource}, but accept new values if backed by clear evidence.`);
                      }

                      // Difficulty
                      if (diff === 'hard') {
                        guidanceParts.push('Often inconsistent across sources \u2014 check manufacturer spec sheets and PDFs first.');
                      } else if (diff === 'instrumented') {
                        guidanceParts.push('Lab-measured value \u2014 only accept from independent test labs.');
                      }

                      // Evidence
                      if (evidenceReq && minRefs >= 2) {
                        guidanceParts.push(`Requires ${minRefs}+ independent source references.`);
                      }

                      // Required/critical
                      if ((reqLvl === 'required' || reqLvl === 'critical') && !guidanceParts.some((p) => p.includes('Identity'))) {
                        guidanceParts.push('High-priority \u2014 publication blocked if unknown.');
                      }

                      // Baseline fallback
                      if (guidanceParts.length === 0) {
                        guidanceParts.push('Extract from the most authoritative available source.');
                      }

                      const autoNote = guidanceParts.join(' ');
                      const hasExplicit = explicitNote.length > 0;

                      return (
                        <div className="mt-2">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={labelCls.replace(' mb-1', '')}>Extraction Guidance (sent to LLM)<Tip text={STUDIO_TIPS.ai_reasoning_note} /></span>
                            {!hasExplicit && <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500 italic font-medium">Auto</span>}
                          </div>
                          <textarea
                            className={`${inputCls} w-full`}
                            rows={3}
                            value={explicitNote}
                            onChange={(e) => updateField(selectedKey!, 'ai_assist.reasoning_note', e.target.value)}
                            placeholder={`Auto: ${autoNote}`}
                          />
                          {hasExplicit && (
                            <button
                              className="text-[10px] text-blue-500 hover:text-blue-700 mt-1"
                              onClick={() => updateField(selectedKey!, 'ai_assist.reasoning_note', '')}
                            >
                              Clear &amp; revert to auto-generated guidance
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </>
                );
              })()}
            </Section>

            {/* ── Parse ───────────────────────────────────────────── */}
            <Section title="Parse Rules" defaultOpen>
              {(() => {
                const pt = strN(currentRule, 'parse.template', strN(currentRule, 'parse_template'));
                const showUnits = pt === 'number_with_unit' || pt === 'list_of_numbers_with_unit' || pt === 'list_numbers_or_ranges_with_unit';
                return (
                  <>
                    <div className={showUnits ? 'grid grid-cols-4 gap-3' : ''}>
                      <div>
                        <div className={labelCls}>Parse Template<Tip text={STUDIO_TIPS.parse_template} /></div>
                        <select className={`${selectCls} w-full`} value={pt} onChange={(e) => updateField(selectedKey, 'parse.template', e.target.value)}>
                          <option value="">none</option>
                          <option value="text_field">text_field</option>
                          <option value="number_with_unit">number_with_unit</option>
                          <option value="boolean_yes_no_unk">boolean_yes_no_unk</option>
                          <option value="component_reference">component_reference</option>
                          <option value="date_field">date_field</option>
                          <option value="url_field">url_field</option>
                          <option value="list_of_numbers_with_unit">list_of_numbers_with_unit</option>
                          <option value="list_numbers_or_ranges_with_unit">list_numbers_or_ranges_with_unit</option>
                          <option value="list_of_tokens_delimited">list_of_tokens_delimited</option>
                          <option value="token_list">token_list</option>
                          <option value="text_block">text_block</option>
                        </select>
                      </div>
                      {showUnits ? (
                        <>
                          <div>
                            <div className={labelCls}>Parse Unit<Tip text={STUDIO_TIPS.parse_unit} /></div>
                            <ComboSelect value={strN(currentRule, 'parse.unit')} onChange={(v) => updateField(selectedKey, 'parse.unit', v)} options={UNITS} placeholder="e.g. g" />
                          </div>
                          <div className="col-span-2">
                            <div className={labelCls}>Unit Accepts<Tip text={STUDIO_TIPS.unit_accepts} /></div>
                            <TagPicker values={arrN(currentRule, 'parse.unit_accepts')} onChange={(v) => updateField(selectedKey, 'parse.unit_accepts', v)} suggestions={UNIT_ACCEPTS_SUGGESTIONS} placeholder="g, grams..." />
                          </div>
                        </>
                      ) : null}
                    </div>
                    {showUnits ? (
                      <div className="flex gap-6 flex-wrap">
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input type="checkbox" checked={boolN(currentRule, 'parse.allow_unitless')} onChange={(e) => updateField(selectedKey, 'parse.allow_unitless', e.target.checked)} className="rounded border-gray-300" />
                          <span className="text-xs text-gray-500">Allow unitless<Tip text={STUDIO_TIPS.allow_unitless} /></span>
                        </label>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input type="checkbox" checked={boolN(currentRule, 'parse.allow_ranges')} onChange={(e) => updateField(selectedKey, 'parse.allow_ranges', e.target.checked)} className="rounded border-gray-300" />
                          <span className="text-xs text-gray-500">Allow ranges<Tip text={STUDIO_TIPS.allow_ranges} /></span>
                        </label>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input type="checkbox" checked={boolN(currentRule, 'parse.strict_unit_required')} onChange={(e) => updateField(selectedKey, 'parse.strict_unit_required', e.target.checked)} className="rounded border-gray-300" />
                          <span className="text-xs text-gray-500">Strict unit required<Tip text={STUDIO_TIPS.strict_unit_required} /></span>
                        </label>
                      </div>
                    ) : null}
                    {!showUnits && pt ? (
                      <div className="text-xs text-gray-400 italic mt-1">
                        Unit settings hidden — {pt === 'boolean_yes_no_unk' ? 'boolean' : pt === 'component_reference' ? 'component reference' : pt.replace(/_/g, ' ')} template does not use units.
                      </div>
                    ) : null}
                  </>
                );
              })()}
            </Section>

            {/* ── Enum ────────────────────────────────────────────── */}
            <Section title="Enum Policy" defaultOpen>
              <EnumConfigurator
                fieldKey={selectedKey}
                rule={currentRule}
                knownValues={knownValues}
                enumLists={enumLists}
                sheets={sheets}
                parseTemplate={strN(currentRule, 'parse.template', strN(currentRule, 'parse_template'))}
                componentDb={componentDb}
                onUpdate={(path, value) => updateField(selectedKey, path, value)}
              />
            </Section>

            {/* ── Evidence ─────────────────────────────────────────── */}
            <Section title="Evidence Requirements">
              <div className="grid grid-cols-4 gap-3">
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={boolN(currentRule, 'evidence.required', boolN(currentRule, 'evidence_required', true))} onChange={(e) => updateField(selectedKey, 'evidence.required', e.target.checked)} className="rounded border-gray-300" />
                    <span className="text-xs text-gray-500">Evidence Required<Tip text={STUDIO_TIPS.evidence_required} /></span>
                  </label>
                </div>
                <div>
                  <div className={labelCls}>Min Evidence Refs<Tip text={STUDIO_TIPS.min_evidence_refs} /></div>
                  <input className={`${inputCls} w-full`} type="number" min={0} max={10} value={numN(currentRule, 'evidence.min_evidence_refs', numN(currentRule, 'min_evidence_refs', 1))} onChange={(e) => updateField(selectedKey, 'evidence.min_evidence_refs', parseInt(e.target.value, 10) || 0)} />
                </div>
                <div>
                  <div className={labelCls}>Conflict Policy<Tip text={STUDIO_TIPS.conflict_policy} /></div>
                  <select className={`${selectCls} w-full`} value={strN(currentRule, 'evidence.conflict_policy', 'resolve_by_tier_else_unknown')} onChange={(e) => updateField(selectedKey, 'evidence.conflict_policy', e.target.value)}>
                    <option value="resolve_by_tier_else_unknown">resolve_by_tier_else_unknown</option>
                    <option value="prefer_highest_tier">prefer_highest_tier</option>
                    <option value="prefer_most_recent">prefer_most_recent</option>
                    <option value="flag_for_review">flag_for_review</option>
                  </select>
                </div>
                <div>
                  <div className={labelCls}>Tier Preference<Tip text={STUDIO_TIPS.tier_preference} /></div>
                  <TierPicker
                    value={arrN(currentRule, 'evidence.tier_preference').length > 0 ? arrN(currentRule, 'evidence.tier_preference') : ['tier1', 'tier2', 'tier3']}
                    onChange={(v) => updateField(selectedKey, 'evidence.tier_preference', v)}
                  />
                </div>
              </div>
            </Section>

            {/* ── UI & Display ─────────────────────────────────────── */}
            <Section title="UI & Display">
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <div className={labelCls}>Label<Tip text={STUDIO_TIPS.ui_label} /></div>
                  <input className={`${inputCls} w-full`} value={strN(currentRule, 'ui.label', strN(currentRule, 'display_name'))} onChange={(e) => updateField(selectedKey, 'ui.label', e.target.value)} />
                </div>
                <div>
                  <div className={labelCls}>Group<Tip text={STUDIO_TIPS.ui_group} /></div>
                  <ComboSelect value={strN(currentRule, 'ui.group', strN(currentRule, 'group'))} onChange={(v) => updateField(selectedKey, 'ui.group', v)} options={GROUPS} placeholder="e.g. sensor_performance" />
                </div>
                <div>
                  <div className={labelCls}>Input Control<Tip text={STUDIO_TIPS.input_control} /></div>
                  <select className={`${selectCls} w-full`} value={strN(currentRule, 'ui.input_control', 'text')} onChange={(e) => updateField(selectedKey, 'ui.input_control', e.target.value)}>
                    <option value="text">text</option>
                    <option value="number">number</option>
                    <option value="select">select</option>
                    <option value="multi_select">multi_select</option>
                    <option value="component_picker">component_picker</option>
                    <option value="checkbox">checkbox</option>
                    <option value="token_list">token_list</option>
                    <option value="text_list">text_list</option>
                    <option value="date">date</option>
                    <option value="url">url</option>
                  </select>
                </div>
                <div>
                  <div className={labelCls}>Display Mode<Tip text={STUDIO_TIPS.display_mode} /></div>
                  <select className={`${selectCls} w-full`} value={strN(currentRule, 'ui.display_mode', 'all')} onChange={(e) => updateField(selectedKey, 'ui.display_mode', e.target.value)}>
                    <option value="all">all</option>
                    <option value="summary">summary</option>
                    <option value="detailed">detailed</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <div className={labelCls}>Suffix<Tip text={STUDIO_TIPS.ui_suffix} /></div>
                  <ComboSelect value={strN(currentRule, 'ui.suffix')} onChange={(v) => updateField(selectedKey, 'ui.suffix', v || null)} options={SUFFIXES} placeholder="e.g. g, mm" />
                </div>
                <div>
                  <div className={labelCls}>Prefix<Tip text={STUDIO_TIPS.ui_prefix} /></div>
                  <ComboSelect value={strN(currentRule, 'ui.prefix')} onChange={(v) => updateField(selectedKey, 'ui.prefix', v || null)} options={PREFIXES} placeholder="e.g. $" />
                </div>
                <div>
                  <div className={labelCls}>Display Decimals<Tip text={STUDIO_TIPS.display_decimals} /></div>
                  <input className={`${inputCls} w-full`} type="number" min={0} max={6} value={numN(currentRule, 'ui.display_decimals', 0)} onChange={(e) => updateField(selectedKey, 'ui.display_decimals', parseInt(e.target.value, 10) || 0)} />
                </div>
                <div>
                  <div className={labelCls}>Order<Tip text={STUDIO_TIPS.ui_order} /></div>
                  <input className={`${inputCls} w-full`} type="number" min={0} value={numN(currentRule, 'ui.order', 0)} onChange={(e) => updateField(selectedKey, 'ui.order', parseInt(e.target.value, 10) || 0)} />
                </div>
              </div>
              <div>
                <div className={labelCls}>Tooltip / Guidance<Tip text={STUDIO_TIPS.tooltip_guidance} /></div>
                <textarea className={`${inputCls} w-full`} rows={2} value={strN(currentRule, 'ui.tooltip_md')} onChange={(e) => updateField(selectedKey, 'ui.tooltip_md', e.target.value)} placeholder="Define how this field should be interpreted..." />
              </div>
              <div>
                <div className={labelCls}>Aliases<Tip text={STUDIO_TIPS.aliases} /></div>
                <TagPicker values={arrN(currentRule, 'aliases')} onChange={(v) => updateField(selectedKey, 'aliases', v)} placeholder="alternative names for this key" />
              </div>
            </Section>

            {/* ── Search Hints ──────────────────────────────────────── */}
            <Section title="Search Hints">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className={labelCls}>Domain Hints<Tip text={STUDIO_TIPS.domain_hints} /></div>
                  <TagPicker values={arrN(currentRule, 'search_hints.domain_hints')} onChange={(v) => updateField(selectedKey, 'search_hints.domain_hints', v)} suggestions={DOMAIN_HINT_SUGGESTIONS} placeholder="manufacturer, rtings.com..." />
                </div>
                <div>
                  <div className={labelCls}>Content Types<Tip text={STUDIO_TIPS.content_types} /></div>
                  <TagPicker values={arrN(currentRule, 'search_hints.preferred_content_types')} onChange={(v) => updateField(selectedKey, 'search_hints.preferred_content_types', v)} suggestions={CONTENT_TYPE_SUGGESTIONS} placeholder="spec_sheet, datasheet..." />
                </div>
              </div>
              <div>
                <div className={labelCls}>Query Terms<Tip text={STUDIO_TIPS.query_terms} /></div>
                <TagPicker values={arrN(currentRule, 'search_hints.query_terms')} onChange={(v) => updateField(selectedKey, 'search_hints.query_terms', v)} placeholder="alternative search terms" />
              </div>
            </Section>

            {/* ── Component Reference ─────────────────────────────── */}
            <Section title="Component & Excel">
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <div className={labelCls}>Component DB<Tip text={STUDIO_TIPS.component_db} /></div>
                  <select
                    className={`${selectCls} w-full`}
                    value={strN(currentRule, 'component.type')}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) {
                        updateField(selectedKey, 'component', null);
                        // Clear component reference coupling
                        if (strN(currentRule, 'parse.template') === 'component_reference') {
                          updateField(selectedKey, 'parse.template', 'text_field');
                        }
                      } else {
                        updateField(selectedKey, 'component', {
                          type: v,
                          source: `component_db.${v}`,
                          allow_new_components: true,
                          require_identity_evidence: true,
                        });
                        // Cascade: Component DB → Parse Template + Enum + UI
                        updateField(selectedKey, 'parse.template', 'component_reference');
                        updateField(selectedKey, 'enum.source', `component_db.${v}`);
                        updateField(selectedKey, 'enum.policy', 'open_prefer_known');
                        updateField(selectedKey, 'enum.match.strategy', 'alias');
                        updateField(selectedKey, 'ui.input_control', 'component_picker');
                      }
                    }}
                  >
                    <option value="">(none)</option>
                    {COMPONENT_TYPES.map((ct) => (
                      <option key={ct} value={ct}>{ct}</option>
                    ))}
                  </select>
                </div>
                {strN(currentRule, 'component.type') ? (
                  <>
                    <div className="col-span-3 flex items-end">
                      <div className="flex items-center gap-3 text-xs">
                        <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 font-medium">
                          component_reference
                        </span>
                        <span className="text-gray-400">
                          Parse: <span className="font-mono">{strN(currentRule, 'parse.template')}</span>
                          {' | '}Enum: <span className="font-mono">{strN(currentRule, 'enum.source')}</span>
                          {' | '}Input: <span className="font-mono">{strN(currentRule, 'ui.input_control')}</span>
                        </span>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
              {strN(currentRule, 'component.type') ? (
                <>
                  {/* ── Match Settings ─────────────────────────────── */}
                  <div className="mt-3 border-t border-gray-200 dark:border-gray-700 pt-3">
                    <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">Match Settings</div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <div className={labelCls}>Fuzzy Threshold</div>
                        <input type="number" min={0} max={1} step={0.05}
                          className={`${selectCls} w-full`}
                          value={numN(currentRule, 'component.match.fuzzy_threshold', 0.75)}
                          onChange={(e) => updateField(selectedKey, 'component.match.fuzzy_threshold', parseFloat(e.target.value) || 0.75)}
                        />
                      </div>
                      <div>
                        <div className={labelCls}>Property Weight</div>
                        <input type="number" min={0} max={1} step={0.05}
                          className={`${selectCls} w-full`}
                          value={numN(currentRule, 'component.match.property_weight', 0.6)}
                          onChange={(e) => updateField(selectedKey, 'component.match.property_weight', parseFloat(e.target.value) || 0.6)}
                        />
                      </div>
                      <div>
                        <div className={labelCls}>Name Weight</div>
                        <input type="number" min={0} max={1} step={0.05}
                          className={`${selectCls} w-full`}
                          value={numN(currentRule, 'component.match.name_weight', 0.4)}
                          onChange={(e) => updateField(selectedKey, 'component.match.name_weight', parseFloat(e.target.value) || 0.4)}
                        />
                      </div>
                      <div>
                        <div className={labelCls}>Auto-Accept Score</div>
                        <input type="number" min={0} max={1} step={0.05}
                          className={`${selectCls} w-full`}
                          value={numN(currentRule, 'component.match.auto_accept_score', 0.95)}
                          onChange={(e) => updateField(selectedKey, 'component.match.auto_accept_score', parseFloat(e.target.value) || 0.95)}
                        />
                      </div>
                      <div>
                        <div className={labelCls}>Flag Review Score</div>
                        <input type="number" min={0} max={1} step={0.05}
                          className={`${selectCls} w-full`}
                          value={numN(currentRule, 'component.match.flag_review_score', 0.65)}
                          onChange={(e) => updateField(selectedKey, 'component.match.flag_review_score', parseFloat(e.target.value) || 0.65)}
                        />
                      </div>
                      <div>
                        <div className={labelCls}>Property Keys</div>
                        <TagPicker values={arrN(currentRule, 'component.match.property_keys')} onChange={(v) => updateField(selectedKey, 'component.match.property_keys', v)} placeholder="dpi, ips..." />
                      </div>
                    </div>
                  </div>
                  {/* ── AI Settings ────────────────────────────────── */}
                  <div className="mt-3 border-t border-gray-200 dark:border-gray-700 pt-3">
                    <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">AI Review Settings</div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <div className={labelCls}>Mode</div>
                        <select className={`${selectCls} w-full`}
                          value={strN(currentRule, 'component.ai.mode', 'off')}
                          onChange={(e) => updateField(selectedKey, 'component.ai.mode', e.target.value)}
                        >
                          <option value="off">off</option>
                          <option value="judge">judge (thinking model)</option>
                          <option value="planner">planner (escalate if uncertain)</option>
                          <option value="advisory">advisory (fast only)</option>
                        </select>
                      </div>
                      <div>
                        <div className={labelCls}>Model Strategy</div>
                        <select className={`${selectCls} w-full`}
                          value={strN(currentRule, 'component.ai.model_strategy', 'auto')}
                          onChange={(e) => updateField(selectedKey, 'component.ai.model_strategy', e.target.value)}
                        >
                          <option value="auto">auto</option>
                          <option value="force_deep">force_deep (reasoning model)</option>
                          <option value="fast_only">fast_only</option>
                        </select>
                      </div>
                      <div>
                        <div className={labelCls}>Context Level</div>
                        <select className={`${selectCls} w-full`}
                          value={strN(currentRule, 'component.ai.context_level', 'properties')}
                          onChange={(e) => updateField(selectedKey, 'component.ai.context_level', e.target.value)}
                        >
                          <option value="name_only">name_only</option>
                          <option value="properties">properties</option>
                          <option value="properties_and_evidence">properties_and_evidence</option>
                        </select>
                      </div>
                    </div>
                    <div className="mt-2">
                      <div className={labelCls}>Reasoning Note</div>
                      <textarea
                        className={`${selectCls} w-full h-16 resize-y`}
                        value={strN(currentRule, 'component.ai.reasoning_note')}
                        onChange={(e) => updateField(selectedKey, 'component.ai.reasoning_note', e.target.value)}
                        placeholder="Human-authored guidance for the AI about this component type..."
                      />
                    </div>
                  </div>
                  {/* ── Component Priority ─────────────────────────── */}
                  <div className="mt-3 border-t border-gray-200 dark:border-gray-700 pt-3">
                    <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">Component Priority</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className={labelCls}>Difficulty</div>
                        <select className={`${selectCls} w-full`}
                          value={strN(currentRule, 'component.priority.difficulty', 'medium')}
                          onChange={(e) => updateField(selectedKey, 'component.priority.difficulty', e.target.value)}
                        >
                          <option value="easy">easy</option>
                          <option value="medium">medium</option>
                          <option value="hard">hard</option>
                        </select>
                      </div>
                      <div>
                        <div className={labelCls}>Effort (1-10)</div>
                        <input type="number" min={1} max={10} step={1}
                          className={`${selectCls} w-full`}
                          value={numN(currentRule, 'component.priority.effort', 5)}
                          onChange={(e) => updateField(selectedKey, 'component.priority.effort', parseInt(e.target.value, 10) || 5)}
                        />
                      </div>
                    </div>
                  </div>
                </>
              ) : null}
              {(currentRule as Record<string, unknown>).excel_hints ? (
                <div className="mt-2">
                  <div className={labelCls}>Excel Hints (read-only)</div>
                  <JsonViewer data={(currentRule as Record<string, unknown>).excel_hints} maxDepth={2} />
                </div>
              ) : null}
            </Section>

            {/* ── Raw JSON ────────────────────────────────────────── */}
            <details className="mt-2">
              <summary className="text-xs text-gray-400 cursor-pointer">Full Rule JSON</summary>
              <div className="mt-2"><JsonViewer data={currentRule} maxDepth={3} /></div>
            </details>
          </div>
        ) : (
          <div className="text-sm text-gray-400 mt-12 text-center">
            Select a key from the list to configure its field rule. Each key has Contract, Priority, Parse, Enum, Evidence, UI, and Search settings.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Field Contract ──────────────────────────────────────────────────
function FieldContractTab({
  fieldRows,
  rules,
}: {
  fieldRows: FieldRuleRow[];
  rules: Record<string, Record<string, unknown>>;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">Field Contract Table<Tip text={STUDIO_TIPS.field_contract_table} /></h3>
      <DataTable data={fieldRows} columns={fieldRuleColumns} searchable maxHeight="max-h-[calc(100vh-350px)]" />

      <details className="mt-4">
        <summary className="text-sm text-gray-400 cursor-pointer">Full Field Contract JSON</summary>
        <div className="mt-2">
          <JsonViewer data={Object.fromEntries(Object.entries(rules).map(([k, v]) => [k, (v as Record<string, unknown>)?.contract]))} />
        </div>
      </details>
    </div>
  );
}

// ── Compile & Reports ───────────────────────────────────────────────
function CompileReportsTab({
  artifacts,
  compileErrors,
  compileWarnings,
  guardrails,
  compileMut,
  validateRulesMut,
}: {
  artifacts: ArtifactEntry[];
  compileErrors: string[];
  compileWarnings: string[];
  guardrails?: Record<string, unknown> | null;
  compileMut: ReturnType<typeof useMutation<ProcessStatus, Error>>;
  validateRulesMut: ReturnType<typeof useMutation<ProcessStatus, Error>>;
}) {
  return (
    <div className="space-y-4">
      {/* Compile + Validate buttons */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => compileMut.mutate()}
          disabled={compileMut.isPending}
          className={btnPrimary}
        >
          {compileMut.isPending ? 'Starting...' : 'Run Category Compile'}
        </button>
        <button
          onClick={() => validateRulesMut.mutate()}
          disabled={validateRulesMut.isPending}
          className="px-3 py-1.5 text-sm bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50"
        >
          {validateRulesMut.isPending ? 'Validating...' : 'Validate Rules'}
        </button>
        <Tip text={STUDIO_TIPS.run_compile} />
        {compileMut.isSuccess ? <span className="text-sm text-green-600">Compile started — check Indexing Lab process output for logs</span> : null}
        {compileMut.isError ? <span className="text-sm text-red-600">{(compileMut.error as Error)?.message || 'Failed'}</span> : null}
        {validateRulesMut.isSuccess ? <span className="text-sm text-green-600">Validation started — check Indexing Lab process output</span> : null}
        {validateRulesMut.isError ? <span className="text-sm text-red-600">{(validateRulesMut.error as Error)?.message || 'Validation failed'}</span> : null}
      </div>

      {/* Errors */}
      {compileErrors.length > 0 ? (
        <div className={`${sectionCls} border-red-200 dark:border-red-700`}>
          <h4 className="text-sm font-semibold text-red-600 mb-2">Compile Errors ({compileErrors.length})<Tip text={STUDIO_TIPS.compile_errors} /></h4>
          <ul className="text-sm space-y-1">
            {compileErrors.map((e, i) => <li key={i} className="text-red-600">{e}</li>)}
          </ul>
        </div>
      ) : null}

      {/* Warnings */}
      {compileWarnings.length > 0 ? (
        <div className={`${sectionCls} border-yellow-200 dark:border-yellow-700`}>
          <h4 className="text-sm font-semibold text-yellow-600 mb-2">Compile Warnings ({compileWarnings.length})<Tip text={STUDIO_TIPS.compile_warnings} /></h4>
          <ul className="text-sm space-y-1">
            {compileWarnings.map((w, i) => <li key={i} className="text-yellow-600">{w}</li>)}
          </ul>
        </div>
      ) : null}

      {/* Generated Artifacts */}
      {artifacts.length > 0 ? (
        <div className={sectionCls}>
          <h4 className="text-sm font-semibold mb-2">Generated Artifacts ({artifacts.length} files)<Tip text={STUDIO_TIPS.generated_artifacts} /></h4>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left py-1 px-2">File</th>
                <th className="text-right py-1 px-2">Size</th>
                <th className="text-right py-1 px-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {artifacts.map((a) => (
                <tr key={a.name} className="border-b border-gray-100 dark:border-gray-700">
                  <td className="py-1 px-2 font-mono text-xs">{a.name}</td>
                  <td className="py-1 px-2 text-right text-gray-500">{(a.size / 1024).toFixed(1)} KB</td>
                  <td className="py-1 px-2 text-right text-gray-400 text-xs">{a.updated ? new Date(a.updated).toLocaleString() : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Guardrails */}
      {guardrails && Object.keys(guardrails).length > 0 ? (
        <div className={sectionCls}>
          <h4 className="text-sm font-semibold mb-2">Guardrails Report<Tip text={STUDIO_TIPS.guardrails_report} /></h4>
          <JsonViewer data={guardrails} />
        </div>
      ) : null}
    </div>
  );
}
