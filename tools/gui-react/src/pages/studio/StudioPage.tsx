import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
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

import { EnumConfigurator } from '../../components/common/EnumConfigurator';
import { humanizeField } from '../../utils/fieldNormalize';
import { FieldRulesWorkbench } from './workbench/FieldRulesWorkbench';
import { useFieldRulesStore } from './useFieldRulesStore';
import { validateNewKeyTs, rewriteConstraintsTs, constraintRefsKey, reorderFieldOrder, deriveGroupsTs, validateNewGroupTs, validateBulkRows, type BulkKeyRow } from './keyUtils';
import DraggableKeyList from './DraggableKeyList';
import { invalidateFieldRulesQueries } from './invalidateFieldRulesQueries';
import BulkPasteGrid, { type BulkGridRow } from '../../components/common/BulkPasteGrid';
import {
  selectCls, inputCls, labelCls,
  UNITS, UNKNOWN_TOKENS, GROUPS, COMPONENT_TYPES,
  PREFIXES, SUFFIXES,
  DOMAIN_HINT_SUGGESTIONS, CONTENT_TYPE_SUGGESTIONS, UNIT_ACCEPTS_SUGGESTIONS,
  STUDIO_TIPS, NORMALIZE_MODES,
} from './studioConstants';
import type {
  FieldRule,
  StudioPayload,
  WorkbookMapResponse,
  StudioConfig,
  TooltipBankResponse,
  DraftsResponse,
  ArtifactEntry,
  ComponentSource,
  ComponentSourceProperty,
  KnownValuesResponse,
  EnumEntry,
  ComponentDbResponse,
  PriorityProfile,
  AiAssistConfig,
} from '../../types/studio';
import type { ProcessStatus } from '../../types/events';
import type { ColumnDef } from '@tanstack/react-table';

interface DataListEntry {
  field: string;
  normalize: string;
  delimiter: string;
  manual_values: string[];
  priority?: PriorityProfile;
  ai_assist?: AiAssistConfig;
}

interface ComponentSourceRoles {
  maker?: string;
  aliases?: string[];
  links?: string[];
  properties?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

// â"€â"€ Display label resolution: label > humanized key â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
function displayLabel(key: string, rule?: Record<string, unknown> | null): string {
  if (!rule) return humanizeField(key);
  const ui = (rule.ui || {}) as Record<string, unknown>;
  return String(ui.label || rule.label || humanizeField(key));
}

// â"€â"€ Shared styles â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
const btnPrimary = 'px-4 py-2 text-sm bg-accent text-white rounded hover:bg-blue-600 disabled:opacity-50';
const btnSecondary = 'px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50';
const btnDanger = 'px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50';
const sectionCls = 'bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4';
const actionBtnWidth = 'w-56';

// â"€â"€ Field Rule Table Columns â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
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
  { accessorKey: 'key', header: 'Field', cell: ({ row }) => row.original.label, size: 180 },
  { accessorKey: 'group', header: 'Group', size: 120 },
  { accessorKey: 'type', header: 'Type', size: 80 },
  { accessorKey: 'required', header: 'Required', size: 80 },
  { accessorKey: 'unit', header: 'Unit', size: 80 },
  { accessorKey: 'enumName', header: 'Enum', size: 100 },
];

// â"€â"€ Role definitions â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
const ROLE_DEFS = [
  { id: 'aliases', label: 'Name Variants (Aliases)' },
  { id: 'maker', label: 'Maker (Brand)' },
  { id: 'links', label: 'Reference URLs (Links)' },
  { id: 'properties', label: 'Attributes (Properties)' },
] as const;

type RoleId = typeof ROLE_DEFS[number]['id'];

// â"€â"€ Property row type â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
interface PropertyMapping {
  field_key: string;
  variance_policy: 'authoritative' | 'upper_bound' | 'lower_bound' | 'range' | 'override_allowed';
  tolerance: number | null;
}

const VARIANCE_POLICIES = [
  { value: 'authoritative', label: 'Authoritative' },
  { value: 'upper_bound', label: 'Upper Bound' },
  { value: 'lower_bound', label: 'Lower Bound' },
  { value: 'range', label: 'Range (Â±tolerance)' },
] as const;

// Legacy property key â†' product field key mapping (used during migration)
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
    variance_policy: (['authoritative', 'upper_bound', 'lower_bound', 'range', 'override_allowed'].includes(String(p.variance_policy || ''))
      ? String(p.variance_policy)
      : 'authoritative') as PropertyMapping['variance_policy'],
    tolerance: p.tolerance != null ? Number(p.tolerance) : null,
  };
}


// â"€â"€ Tabs â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
const subTabs = [
  { id: 'mapping', label: '1) Mapping Studio' },
  { id: 'keys', label: '2) Key Navigator' },
  { id: 'contract', label: '3) Field Contract' },
  { id: 'reports', label: '4) Compile & Reports' },
];

function emptyComponentSource(): ComponentSource {
  return {
    component_type: '',
    roles: {
      maker: 'yes',
      aliases: [],
      links: [],
      properties: [],
    },
    priority: { ...DEFAULT_PRIORITY_PROFILE },
    ai_assist: normalizeAiAssistConfig(undefined),
  };
}

// â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
export function StudioPage() {
  const category = useUiStore((s) => s.category);
  const [activeTab, setActiveTab] = useState('mapping');
  const [selectedKey, setSelectedKey] = useState('');
  const setProcessStatus = useRuntimeStore((s) => s.setProcessStatus);
  const queryClient = useQueryClient();
  const autoSaveEnabled = useUiStore((s) => s.autoSaveEnabled);
  const setAutoSaveEnabled = useUiStore((s) => s.setAutoSaveEnabled);
  const autoSaveMapEnabled = useUiStore((s) => s.autoSaveMapEnabled);
  const setAutoSaveMapEnabled = useUiStore((s) => s.setAutoSaveMapEnabled);
  const hydrated = useRef(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saved'>('idle');

  // â"€â"€ Queries â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const { data: studio, isLoading } = useQuery({
    queryKey: ['studio', category],
    queryFn: () => api.get<StudioPayload>(`/studio/${category}/payload`),
  });

  const { data: wbMapRes } = useQuery({
    queryKey: ['studio-config', category],
    queryFn: () => api.get<WorkbookMapResponse>(`/studio/${category}/workbook-map`),
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

  // â"€â"€ Invalidate studio queries when any process finishes â"€â"€â"€â"€â"€â"€â"€â"€
  const processStatus = useRuntimeStore((s) => s.processStatus);
  useEffect(() => {
    if (!processStatus.running && processStatus.exitCode !== undefined) {
      invalidateFieldRulesQueries(queryClient, category);
    }
  }, [processStatus.running, processStatus.exitCode, category]);

  // â"€â"€ Mutations â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const compileMut = useMutation({
    mutationFn: () => api.post<ProcessStatus>(`/studio/${category}/compile`),
    onSuccess: (data) => setProcessStatus(data),
  });

  const validateRulesMut = useMutation({
    mutationFn: () => api.post<ProcessStatus>(`/studio/${category}/validate-rules`),
    onSuccess: (data) => setProcessStatus(data),
  });

  const saveMapMut = useMutation({
    mutationFn: (body: StudioConfig) => api.put<unknown>(`/studio/${category}/workbook-map`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['studio-config', category] });
    },
  });

  const saveEditsMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<unknown>(`/studio/${category}/save-drafts`, body),
    onSuccess: () => {
      fieldRulesStore.clearRenames();
      invalidateFieldRulesQueries(queryClient, category);
    },
  });

  // â"€â"€ Derived data â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const rules = studio?.fieldRules || {};
  const fieldOrder = studio?.fieldOrder || Object.keys(rules);
  const wbMap = wbMapRes?.map || ({} as StudioConfig);

  const enumListsWithValues: EnumEntry[] = (Array.isArray(wbMap.data_lists) && wbMap.data_lists.length > 0
    ? wbMap.data_lists
    : Array.isArray(wbMap.enum_lists) ? wbMap.enum_lists : []
  ).map((dl: Record<string, unknown>) => ({
    field: String(dl.field || ''),
    normalize: String(dl.normalize || 'lower_trim'),
    values: Array.isArray(dl.manual_values) ? dl.manual_values.map(String) : (Array.isArray(dl.values) ? dl.values.map(String) : []),
  }));

  // â"€â"€ Field Rules Store: centralized editable state â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const fieldRulesStore = useFieldRulesStore();

  useEffect(() => {
    if (Object.keys(rules).length > 0 && !fieldRulesStore.initialized) {
      fieldRulesStore.hydrate(rules, fieldOrder);
    }
  }, [rules, fieldOrder, fieldRulesStore.initialized]);

  const storeRules = fieldRulesStore.initialized ? fieldRulesStore.editedRules : rules;
  const storeFieldOrder = fieldRulesStore.initialized ? fieldRulesStore.editedFieldOrder : fieldOrder;

  const saveFromStore = useCallback(() => {
    const snap = useFieldRulesStore.getState().getSnapshot();
    saveEditsMut.mutate({
      fieldRulesDraft: {
        ...(Object.keys(snap.rules).length > 0 ? { fields: snap.rules } : {}),
        ...(snap.fieldOrder.length > 0 ? { fieldOrder: snap.fieldOrder } : {}),
      },
      ...(Object.keys(snap.renames).length > 0 ? { renames: snap.renames } : {}),
    }, {
      onSuccess: () => {
        if (autoSaveEnabled) {
          setAutoSaveStatus('saved');
          setTimeout(() => setAutoSaveStatus('idle'), 2000);
        }
      },
    });
  }, [saveEditsMut, autoSaveEnabled]);

  // Mark hydration complete after store has been initialized from server data
  useEffect(() => {
    if (fieldRulesStore.initialized) hydrated.current = true;
  }, [fieldRulesStore.initialized]);

  // Debounced auto-save
  const editedRules = fieldRulesStore.editedRules;
  const editedFieldOrder = fieldRulesStore.editedFieldOrder;
  useEffect(() => {
    if (!autoSaveEnabled || !fieldRulesStore.initialized || !hydrated.current) return;
    const timer = setTimeout(saveFromStore, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSaveEnabled, editedRules, editedFieldOrder, saveFromStore]);

  const hasUnsavedChanges = useMemo(
    () => Object.values(fieldRulesStore.editedRules).some((r: any) => r?._edited),
    [fieldRulesStore.editedRules],
  );

  const fieldRows: FieldRuleRow[] = useMemo(
    () =>
      fieldOrder.map((key) => {
        const rule = rules[key] || {};
        return {
          key,
          label: displayLabel(key, rule as Record<string, unknown>),
          group: rule.group || '',
          type: rule.contract?.type || 'string',
          required: rule.required_level || '',
          unit: rule.contract?.unit || '',
          enumName: rule.enum_name || '',
        };
      }),
    [rules, fieldOrder],
  );

  // â"€â"€ Compile errors/warnings from guardrails â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const compileErrors: string[] = [];
  const compileWarnings: string[] = [];
  if (studio?.guardrails) {
    const g = studio.guardrails as Record<string, unknown>;
    if (Array.isArray(g.errors)) compileErrors.push(...(g.errors as string[]));
    if (Array.isArray(g.warnings)) compileWarnings.push(...(g.warnings as string[]));
  }

  // â"€â"€ Tooltip coverage â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const tooltipEntries = tooltipBank?.entries || {};
  const tooltipCount = Object.keys(tooltipEntries).length;
  const tooltipCoverage = fieldOrder.length > 0
    ? Math.round((fieldOrder.filter((k) => k in tooltipEntries).length / fieldOrder.length) * 100)
    : 0;

  const saveStatus = (() => {
    if (saveEditsMut.isPending) {
      return { label: 'Savingâ€¦', dot: 'bg-gray-400', text: 'text-gray-500', border: 'border-gray-200 dark:border-gray-600' };
    }
    if (autoSaveEnabled) {
      if (autoSaveStatus === 'saved') {
        return { label: 'Auto-saved', dot: 'bg-green-500', text: 'text-green-600 dark:text-green-400', border: 'border-green-200 dark:border-green-700/60' };
      }
      return { label: 'Up to date', dot: 'bg-green-500', text: 'text-green-600 dark:text-green-400', border: 'border-green-200 dark:border-green-700/60' };
    }
    if (!fieldRulesStore.initialized) {
      return null;
    }
    if (hasUnsavedChanges) {
      return { label: 'Unsaved', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-200 dark:border-amber-700/60' };
    }
    return { label: 'All saved', dot: 'bg-green-500', text: 'text-green-600 dark:text-green-400', border: 'border-green-200 dark:border-green-700/60' };
  })();

  const compileStatus = (() => {
    if (compileMut.isPending) {
      return { label: 'Compilingâ€¦', dot: 'bg-gray-400', text: 'text-gray-500', border: 'border-gray-200 dark:border-gray-600' };
    }
    if (compileMut.isError) {
      return {
        label: (compileMut.error as Error)?.message ? (compileMut.error as Error).message.slice(0, 36) : 'Compile failed',
        dot: 'bg-red-500',
        text: 'text-red-600 dark:text-red-400',
        border: 'border-red-200 dark:border-red-700/60',
      };
    }
    if (compileMut.isSuccess) {
      return { label: 'Started', dot: 'bg-green-500', text: 'text-green-600 dark:text-green-400', border: 'border-green-200 dark:border-green-700/60' };
    }
    if (studio && studio.compileStale) {
      return { label: 'Not compiled', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-200 dark:border-amber-700/60' };
    }
    if (studio && !studio.compileStale) {
      return { label: 'Compiled', dot: 'bg-green-500', text: 'text-green-600 dark:text-green-400', border: 'border-green-200 dark:border-green-700/60' };
    }
    return null;
  })();
  const saveStatusLabel = saveStatus?.label || 'All saved';
  const saveStatusDot = saveStatus?.dot || 'bg-green-500';
  const compileStatusLabel = compileStatus?.label || 'Compiled';
  const compileStatusDot = compileStatus?.dot || 'bg-green-500';

  // â"€â"€ Category guard â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  if (category === 'all') {
    return <p className="text-gray-500 mt-8 text-center">Select a specific category from the sidebar to configure field rules.</p>;
  }

  // â"€â"€ Loading state â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
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
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-2">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => saveEditsMut.mutate({ fieldRulesDraft: drafts?.fieldRulesDraft, uiFieldCatalogDraft: drafts?.uiFieldCatalogDraft })}
            disabled={saveEditsMut.isPending || autoSaveEnabled}
            className={`${btnSecondary} relative h-11 min-h-11 text-sm rounded inline-flex items-center justify-center overflow-visible whitespace-nowrap ${actionBtnWidth}`}
          >
            <span className="w-full text-center font-medium truncate">Save Edits</span>
            <span className="absolute top-0 right-0 -ml-1 translate-x-1/2 -translate-y-1/2">
              <Tip text={'Save Edits (manual)\n\nWrite your edits to draft only (fast iteration).\nDraft changes are merged on top of compiled rules.'} />
            </span>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <span
                  tabIndex={0}
                  aria-label={`Save status: ${saveStatusLabel}`}
                  className={`absolute inline-block h-2.5 w-2.5 rounded-full ${saveStatusDot} border border-white/90 shadow-sm`}
                  style={{ right: '3px', bottom: '3px' }}
                />
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content
                  className="z-50 max-w-xs px-3 py-2 text-xs leading-snug whitespace-pre-line text-gray-900 bg-white border border-gray-200 rounded shadow-lg dark:text-gray-100 dark:bg-gray-900 dark:border-gray-700"
                  sideOffset={5}
                >
                  {saveStatusLabel}
                  <Tooltip.Arrow className="fill-white dark:fill-gray-900" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          </button>

          <button
            onClick={() => setAutoSaveEnabled(!autoSaveEnabled)}
            className={`${btnSecondary} relative h-11 min-h-11 text-sm rounded inline-flex items-center justify-center overflow-visible whitespace-nowrap ${actionBtnWidth} transition-colors ${
              autoSaveEnabled
                ? 'bg-accent/10 text-accent border-accent/40 shadow-inner dark:bg-accent/20 dark:border-accent/50'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            <span className="w-full text-center font-medium truncate">{autoSaveEnabled ? 'Auto-save On' : 'Auto-save Off'}</span>
            <span className="absolute top-0 right-0 -ml-1 translate-x-1/2 -translate-y-1/2">
              <Tip text={'Auto-save\n\nWhen enabled, saves are automatically persisted after 1.5s of inactivity.\nAuto-save applies to all field rule and catalog edits.'} />
            </span>
          </button>

          <button
            onClick={() => compileMut.mutate()}
            disabled={compileMut.isPending}
            className={`${btnPrimary} relative h-11 min-h-11 text-sm rounded inline-flex items-center justify-center overflow-visible whitespace-nowrap ${actionBtnWidth}`}
          >
            <span className="w-full text-center font-medium truncate">{compileMut.isPending ? 'Compiling�' : 'Compile & Generate'}</span>
            <span className="absolute top-0 right-0 -ml-1 translate-x-1/2 -translate-y-1/2">
              <Tip text={
                'Compile & Generate Artifacts\n\n'
                + 'Reads your workbook (Excel) + draft edits and generates production artifacts:\n\n'
                + '\u2022 field_rules.json \u2014 compiled field definitions\n'
                + '\u2022 component_db/*.json \u2014 component databases\n'
                + '\u2022 known_values.json \u2014 enum / known value lists\n'
                + '\u2022 parse_templates.json \u2014 extraction templates\n\n'
                + 'Workflow:\n'
                + '\u2022 Edit in Studio \u2192 Save Edits (fast preview)\n'
                + '\u2022 Ready to finalize \u2192 Compile (generates files)\n\n'
                + 'Status values:\n'
                + '\u2022 "Not compiled" \u2014 draft edits are newer than compile.\n'
                + '\u2022 "Compiled" \u2014 artifacts are up to date.'
              } />
            </span>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <span
                  tabIndex={0}
                  aria-label={`Compile status: ${compileStatusLabel}`}
                  className={`absolute inline-block h-2.5 w-2.5 rounded-full ${compileStatusDot} border border-white/90 shadow-sm`}
                  style={{ right: '3px', bottom: '3px' }}
                />
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content
                  className="z-50 max-w-xs px-3 py-2 text-xs leading-snug whitespace-pre-line text-gray-900 bg-white border border-gray-200 rounded shadow-lg dark:text-gray-100 dark:bg-gray-900 dark:border-gray-700"
                  sideOffset={5}
                >
                  {compileStatusLabel}
                  <Tooltip.Arrow className="fill-white dark:fill-gray-900" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          </button>

          <button
            onClick={async () => {
              await api.post(`/studio/${category}/invalidate-cache`);
              invalidateFieldRulesQueries(queryClient, category);
            }}
            className={`${btnSecondary} relative h-11 min-h-11 text-sm rounded inline-flex items-center justify-center overflow-visible whitespace-nowrap ${actionBtnWidth}`}
          >
            <span className="w-full text-center font-medium truncate">Refresh</span>
                <span className="absolute top-0 right-0 -ml-1 translate-x-1/2 -translate-y-1/2">
                  <Tip text={
                    'Refresh\n\n'
                    + 'Clears all caches and reloads from disk:\n\n'
                + '\u2022 Server field rules cache\n'
                + '\u2022 Server review layout cache\n'
                + '\u2022 Browser query cache\n\n'
                + 'When to use:\n'
                + '\u2022 After editing files outside the GUI\n'
                    + '\u2022 After a manual workbook change\n'
                    + '\u2022 If displayed data appears stale'
                  } />
                </span>
          </button>
        </div>
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

      {/* â"€â"€ Tab 1: Mapping Studio â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      {activeTab === 'mapping' ? (
        <MappingStudioTab
          wbMap={wbMap}
          tooltipCount={tooltipCount}
          tooltipCoverage={tooltipCoverage}
          tooltipFiles={tooltipBank?.files || []}
          onSaveMap={(map) => saveMapMut.mutate(map)}
          saving={saveMapMut.isPending}
          saveSuccess={saveMapMut.isSuccess}
          rules={storeRules}
          fieldOrder={storeFieldOrder}
          knownValues={knownValuesRes?.fields || {}}
          autoSaveMapEnabled={autoSaveMapEnabled}
          setAutoSaveMapEnabled={setAutoSaveMapEnabled}
        />
      ) : null}

      {/* â"€â"€ Tab 2: Key Navigator â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      {activeTab === 'keys' ? (
        <KeyNavigatorTab
          category={category}
          selectedKey={selectedKey}
          onSelectKey={setSelectedKey}
          onSave={saveFromStore}
          saving={saveEditsMut.isPending}
          saveSuccess={saveEditsMut.isSuccess}
          knownValues={knownValuesRes?.fields || {}}
          enumLists={enumListsWithValues}
          componentDb={componentDbRes || {}}
          componentSources={(wbMap.component_sources || []) as ComponentSource[]}
          autoSaveEnabled={autoSaveEnabled}
          setAutoSaveEnabled={setAutoSaveEnabled}
        />
      ) : null}

      {/* â"€â"€ Tab 3: Field Contract (Workbench) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      {activeTab === 'contract' ? (
        <FieldRulesWorkbench
          category={category}
          knownValues={knownValuesRes?.fields || {}}
          enumLists={enumListsWithValues}
          componentDb={componentDbRes || {}}
          componentSources={(wbMap.component_sources || []) as ComponentSource[]}
          wbMap={wbMap}
          guardrails={studio?.guardrails as Record<string, unknown> | undefined}
          onSave={saveFromStore}
          saving={saveEditsMut.isPending}
          saveSuccess={saveEditsMut.isSuccess}
          autoSaveEnabled={autoSaveEnabled}
          setAutoSaveEnabled={setAutoSaveEnabled}
        />
      ) : null}

      {/* â"€â"€ Tab 4: Compile & Reports â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Tab Components
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â"€â"€ Mapping Studio â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
function MappingStudioTab({
  wbMap,
  tooltipCount,
  tooltipCoverage,
  tooltipFiles,
  onSaveMap,
  saving,
  saveSuccess,
  rules,
  fieldOrder,
  knownValues,
  autoSaveMapEnabled,
  setAutoSaveMapEnabled,
}: {
  wbMap: StudioConfig;
  tooltipCount: number;
  tooltipCoverage: number;
  tooltipFiles: string[];
  onSaveMap: (map: StudioConfig) => void;
  saving: boolean;
  saveSuccess: boolean;
  rules: Record<string, FieldRule>;
  fieldOrder: string[];
  knownValues: Record<string, string[]>;
  autoSaveMapEnabled: boolean;
  setAutoSaveMapEnabled: (v: boolean) => void;
}) {
  const [tooltipPath, setTooltipPath] = useState('');
  const [compSources, setCompSources] = useState<ComponentSource[]>([]);
  const [dataLists, setDataLists] = useState<DataListEntry[]>([]);
  const [seededVersion, setSeededVersion] = useState('');
  const [showTooltipSource, setShowTooltipSource] = useState(false);
  const [showComponentSourceMapping, setShowComponentSourceMapping] = useState(false);
  const [showEnumSection, setShowEnumSection] = useState(false);

  const mapVersion = String(wbMap.version || '');
  useEffect(() => {
    if (!mapVersion || seededVersion === mapVersion) return;
    setTooltipPath(wbMap.tooltip_source?.path || '');
    const sources = wbMap.component_sources || [];
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
    const rawEnumLists = (Array.isArray(wbMap.data_lists) && wbMap.data_lists.length > 0
      ? wbMap.data_lists
      : Array.isArray(wbMap.enum_lists) ? wbMap.enum_lists : []) as EnumEntry[];
    const manualEnumValues = wbMap.manual_enum_values;
    const manualMap = manualEnumValues && typeof manualEnumValues === 'object' ? manualEnumValues : {} as Record<string, string[]>;
    const seenFields = new Set<string>();
    const seededLists: DataListEntry[] = [];
    for (const el of rawEnumLists) {
      seenFields.add(el.field);
      seededLists.push({
        field: el.field,
        normalize: el.normalize || 'lower_trim',
        delimiter: el.delimiter || '',
        manual_values: Array.isArray(el.values) ? el.values : (Array.isArray(el.manual_values) ? el.manual_values : (Array.isArray(manualMap[el.field]) ? manualMap[el.field] : [])),
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
          normalize: 'lower_trim',
          delimiter: '',
          manual_values: values,
          priority: { ...DEFAULT_PRIORITY_PROFILE },
          ai_assist: normalizeAiAssistConfig(undefined),
        });
      }
    }
    setDataLists(seededLists);
    setSeededVersion(mapVersion);
  }, [wbMap, mapVersion, seededVersion, rules]);

  const assembleMap = useCallback((): StudioConfig => {
    return {
      ...wbMap,
      tooltip_source: {
        path: tooltipPath,
      },
      component_sources: compSources.map((src) => ({
        ...src,
        priority: normalizePriorityProfile(src.priority),
        ai_assist: normalizeAiAssistConfig(src.ai_assist),
      })),
      enum_lists: dataLists.map(dl => ({
        field: dl.field,
        normalize: dl.normalize,
        values: dl.manual_values,
        priority: normalizePriorityProfile(dl.priority),
        ai_assist: normalizeAiAssistConfig(dl.ai_assist),
      })),
    };
  }, [wbMap, tooltipPath, compSources, dataLists]);

  function handleSave() {
    onSaveMap(assembleMap());
  }

  const mapHydrated = useRef(false);
  useEffect(() => {
    if (seededVersion) mapHydrated.current = true;
  }, [seededVersion]);

  useEffect(() => {
    if (!autoSaveMapEnabled || !mapHydrated.current) return;
    const timer = setTimeout(() => onSaveMap(assembleMap()), 1500);
    return () => clearTimeout(timer);
  }, [autoSaveMapEnabled, tooltipPath, compSources, dataLists, assembleMap, onSaveMap]);

  // â"€â"€ Component source handlers â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  function addComponentSource() {
    setCompSources((prev) => [...prev, emptyComponentSource()]);
  }

  function removeComponentSource(idx: number) {
    setCompSources((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateComponentSource(idx: number, updates: Partial<ComponentSource>) {
    setCompSources((prev) =>
      prev.map((src, i) => (i === idx ? { ...src, ...updates } : src))
    );
  }

  // â"€â"€ Data list handlers â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  function addDataList() {
    setDataLists((prev) => [...prev, {
      field: '',
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
      {/* -- Header: description left, save right -- */}
      <div className="flex items-center gap-3">
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed max-w-[50%]">
          Configure how the compiler reads your Excel workbook. Map tooltip sources, define component types and their property slots, and set up enum / data lists with normalization rules.
        </p>
        <div className="flex-1" />
        <button
          onClick={handleSave}
          disabled={saving || autoSaveMapEnabled}
          className={`${btnSecondary} relative h-11 min-h-11 text-sm rounded inline-flex items-center justify-center overflow-visible whitespace-nowrap ${actionBtnWidth}`}
        >
          <span className="w-full text-center font-medium truncate">Save Mapping</span>
          <span className="absolute top-0 right-0 -ml-1 translate-x-1/2 -translate-y-1/2">
            <Tip text={'Save Mapping (manual)\n\nWrites your workbook map configuration to disk.\nThis tells the compiler how to read your Excel workbook.'} />
          </span>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <span
                tabIndex={0}
                aria-label={`Map save status: ${saving ? 'Saving\u2026' : saveSuccess ? 'Saved' : 'Ready'}`}
                className={`absolute inline-block h-2.5 w-2.5 rounded-full ${saving ? 'bg-gray-400 animate-pulse' : saveSuccess ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'} border border-white/90 shadow-sm`}
                style={{ right: '3px', bottom: '3px' }}
              />
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                className="z-50 max-w-xs px-3 py-2 text-xs leading-snug whitespace-pre-line text-gray-900 bg-white border border-gray-200 rounded shadow-lg dark:text-gray-100 dark:bg-gray-900 dark:border-gray-700"
                sideOffset={5}
              >
                {saving ? 'Saving\u2026' : saveSuccess ? 'Saved' : 'Ready'}
                <Tooltip.Arrow className="fill-white dark:fill-gray-900" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </button>

        <button
          onClick={() => setAutoSaveMapEnabled(!autoSaveMapEnabled)}
          className={`${btnSecondary} relative h-11 min-h-11 text-sm rounded inline-flex items-center justify-center overflow-visible whitespace-nowrap ${actionBtnWidth} transition-colors ${
            autoSaveMapEnabled
              ? 'bg-accent/10 text-accent border-accent/40 shadow-inner dark:bg-accent/20 dark:border-accent/50'
              : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
        >
          <span className="w-full text-center font-medium truncate">{autoSaveMapEnabled ? 'Auto-save On' : 'Auto-save Off'}</span>
          <span className="absolute top-0 right-0 -ml-1 translate-x-1/2 -translate-y-1/2">
            <Tip text={'Auto-save Mapping\n\nWhen enabled, mapping changes are automatically\nsaved after 1.5s of inactivity.\n\nWhat gets saved:\n\u2022 Tooltip source configuration\n\u2022 Component source mappings\n\u2022 Enum / data list definitions\n\nDefault: on. Setting persists across sessions.'} />
          </span>
        </button>
      </div>

      {/* Tooltip Bank */}
      <div className={`${sectionCls} relative`}>
        <button
          type="button"
          aria-expanded={showTooltipSource}
          onClick={() => setShowTooltipSource((prev) => !prev)}
          className="w-full flex items-center justify-between gap-2 text-left text-sm font-semibold text-gray-700 dark:text-gray-100 hover:text-gray-900 dark:hover:text-white"
        >
          <span className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-5 h-5 border border-gray-300 dark:border-gray-600 rounded text-xs font-medium text-gray-500 dark:text-gray-300">{showTooltipSource ? '-' : '+'}</span>
            <span>Tooltips Source</span>
          </span>
        </button>
          <span className="absolute top-0 right-0 -ml-1 translate-x-1/2 -translate-y-1/2">
            <Tip text={STUDIO_TIPS.tooltip_section_tooltip_bank} />
          </span>
        {showTooltipSource ? (
          <div className="mt-3">
            <div className="grid grid-cols-4 gap-3">
              <div className="col-span-2">
                <div className={labelCls}>Tooltip Bank File (JS/JSON/MD)<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.tooltip_bank_file} /></div>
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
        ) : null}
      </div>

      {/* Component Source Mapping */}
      <div className={`${sectionCls} relative`}>
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            aria-expanded={showComponentSourceMapping}
            onClick={() => setShowComponentSourceMapping((prev) => !prev)}
            className="flex-1 flex items-center justify-between gap-2 text-left text-sm font-semibold text-gray-700 dark:text-gray-100 hover:text-gray-900 dark:hover:text-white"
          >
            <span className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-5 h-5 border border-gray-300 dark:border-gray-600 rounded text-xs font-medium text-gray-500 dark:text-gray-300">
                {showComponentSourceMapping ? '-' : '+'}
              </span>
              <span>Component Source Mapping</span>
            </span>
        </button>
        <span className="absolute top-0 right-0 -ml-1 translate-x-1/2 -translate-y-1/2">
          <Tip text={STUDIO_TIPS.tooltip_section_component_sources} />
        </span>
          <div className="pt-0.5">
            <p className="text-xs text-gray-500 mt-1">
              Required: Primary Identifier role. Optional: Maker, Name Variants, Reference URLs, Attributes.
            </p>
          </div>
        </div>
        {showComponentSourceMapping ? (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-3">
              <div>
              </div>
              <div className="flex gap-2">
                <button onClick={addComponentSource} className={btnSecondary}>
                  + Add Source
                </button>
              </div>
            </div>
            {compSources.length > 0 ? (
              <div className="space-y-6">
                {compSources.map((src, idx) => (
                  <EditableComponentSource
                    key={idx}
                    index={idx}
                    source={src}
                    onUpdate={(updates) => updateComponentSource(idx, updates)}
                    onRemove={() => removeComponentSource(idx)}
                    rules={rules}
                    fieldOrder={fieldOrder}
                    knownValues={knownValues}
                  />
                ))}
              </div>
            ) : (
              <div className="text-sm text-gray-400 text-center py-4">
                No component sources configured. Click "Add Source" to add one.
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Enum Value Lists */}
      <div className={`${sectionCls} relative`}>
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          aria-expanded={showEnumSection}
          onClick={() => setShowEnumSection((prev) => !prev)}
          className="flex-1 flex items-center justify-between gap-2 text-left text-sm font-semibold text-gray-700 dark:text-gray-100 hover:text-gray-900 dark:hover:text-white"
        >
          <span className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-5 h-5 border border-gray-300 dark:border-gray-600 rounded text-xs font-medium text-gray-500 dark:text-gray-300">
              {showEnumSection ? '-' : '+'}
            </span>
            <span>Enum</span>
          </span>
        </button>
        <span className="absolute top-0 right-0 -ml-1 translate-x-1/2 -translate-y-1/2">
          <Tip text={STUDIO_TIPS.tooltip_section_enums} />
        </span>
        <div className="pt-0.5">
          <p className="text-xs text-gray-500 mt-1">
            Define allowed values for enum fields.
          </p>
        </div>
      </div>
        {showEnumSection ? (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-3">
              <div></div>
              <button onClick={addDataList} className={btnSecondary}>
                + Add Enum
              </button>
            </div>
            {dataLists.length > 0 ? (
              <div className="space-y-3">
                {dataLists.map((dl, idx) => (
                  <EditableDataList
                    key={idx}
                    entry={dl}
                    index={idx}
                    isDuplicate={duplicateDataListFields.has(dl.field)}
                    onUpdate={(updates) => updateDataList(idx, updates)}
                    onRemove={() => removeDataList(idx)}
                  />
                ))}
              </div>
            ) : (
                <div className="text-sm text-gray-400 text-center py-4">
                  No enums configured. Click "+ Add Enum" to define enum value lists.
                </div>
            )}
          </div>
        ) : null}
      </div>

    </div>
  );
}

// â"€â"€ Constraint Editor â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
const CONSTRAINT_OPS = ['<=', '>=', '<', '>', '==', '!=', 'requires'] as const;

type FieldTypeGroup = 'numeric' | 'date' | 'boolean' | 'string';

function deriveTypeGroup(rule: Record<string, unknown>): FieldTypeGroup {
  const contract = (rule.contract || {}) as Record<string, unknown>;
  const parse = (rule.parse || {}) as Record<string, unknown>;
  const ct = String(contract.type || '').trim().toLowerCase();
  const pt = String(parse.template || '').trim().toLowerCase();
  if (ct === 'integer' || ct === 'number') return 'numeric';
  if (pt === 'date_field') return 'date';
  if (pt === 'boolean_yes_no_unk') return 'boolean';
  return 'string';
}

const TYPE_GROUP_OPS: Record<FieldTypeGroup, Set<string>> = {
  numeric: new Set(['<=', '>=', '<', '>', '==', '!=', 'requires']),
  date: new Set(['<=', '>=', '<', '>', '==', '!=', 'requires']),
  boolean: new Set(['==', '!=', 'requires']),
  string: new Set(['==', '!=', 'requires']),
};

function areTypesCompatible(a: FieldTypeGroup, b: FieldTypeGroup): boolean {
  if (a === b) return true;
  if (a === 'numeric' && b === 'numeric') return true;
  return false;
}

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
      return { value: key, label: displayLabel(key, rules[key] as Record<string, unknown>) };
    });
  }, [componentPropertyKeys, rules]);

  // Right side: product field keys
  const productOptions = useMemo(() => {
    return fieldOrder.filter((k) => !k.startsWith('__grp::')).map((key) => {
      return { value: key, label: displayLabel(key, rules[key] as Record<string, unknown>) };
    });
  }, [fieldOrder, rules]);

  return (
    <div className="px-3 py-1.5 border-t border-gray-200 dark:border-gray-700 text-[11px]">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-gray-500">Constraints<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.comp_constraints} /></span>
        {constraints.length > 0 ? (
          <span className="text-[9px] bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded font-medium">Migrate to Key Navigator</span>
        ) : null}
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

// â"€â"€ Range constraint pill grouping â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
const RANGE_LOWER_OPS = new Set(['>=', '>']);
const RANGE_UPPER_OPS = new Set(['<=', '<']);

interface RangePair { lowerIdx: number; upperIdx: number; lower: string; upper: string; display: string }

function groupRangeConstraints(constraints: string[], currentKey: string): { ranges: RangePair[]; singles: Array<{ idx: number; expr: string }> } {
  const parsed = constraints.map((expr, idx) => {
    const m = expr.match(/^(\S+)\s+(<=?|>=?|==|!=|requires)\s+(.+)$/);
    if (!m || m[1] !== currentKey) return { idx, expr, field: '', op: '', value: '' };
    return { idx, expr, field: m[1], op: m[2], value: m[3].trim() };
  });

  const lowers = parsed.filter((p) => p.field === currentKey && RANGE_LOWER_OPS.has(p.op));
  const uppers = parsed.filter((p) => p.field === currentKey && RANGE_UPPER_OPS.has(p.op));
  const pairedLower = new Set<number>();
  const pairedUpper = new Set<number>();
  const ranges: RangePair[] = [];

  for (const lo of lowers) {
    for (const up of uppers) {
      if (pairedUpper.has(up.idx)) continue;
      const loNum = Number(lo.value);
      const upNum = Number(up.value);
      if (!isNaN(loNum) && !isNaN(upNum) && loNum < upNum) {
        ranges.push({
          lowerIdx: lo.idx,
          upperIdx: up.idx,
          lower: lo.expr,
          upper: up.expr,
          display: `${lo.value} ${lo.op === '>=' ? '\u2264' : '<'} ${currentKey} ${up.op === '<=' ? '\u2264' : '<'} ${up.value}`,
        });
        pairedLower.add(lo.idx);
        pairedUpper.add(up.idx);
        break;
      }
    }
  }

  const allPaired = new Set([...pairedLower, ...pairedUpper]);
  const singles = parsed.filter((p) => !allPaired.has(p.idx)).map((p) => ({ idx: p.idx, expr: p.expr }));
  return { ranges, singles };
}

// â"€â"€ Key Constraint Editor (Key Navigator) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
function KeyConstraintEditor({
  currentKey,
  constraints,
  onChange,
  fieldOrder,
  rules,
}: {
  currentKey: string;
  constraints: string[];
  onChange: (next: string[]) => void;
  fieldOrder: string[];
  rules: Record<string, Record<string, unknown>>;
}) {
  const [adding, setAdding] = useState(false);
  const [op, setOp] = useState<string>('<=');
  const [rightMode, setRightMode] = useState<'field' | 'value' | 'range'>('field');
  const [rightField, setRightField] = useState('');
  const [rightLiteral, setRightLiteral] = useState('');
  const [rangeMin, setRangeMin] = useState('');
  const [rangeMax, setRangeMax] = useState('');
  const [rangeLowerOp, setRangeLowerOp] = useState<string>('<=');
  const [rangeUpperOp, setRangeUpperOp] = useState<string>('<=');

  const currentRule = rules[currentKey] || {};
  const currentTypeGroup = deriveTypeGroup(currentRule);
  const allowedOps = TYPE_GROUP_OPS[currentTypeGroup];
  const supportsRange = currentTypeGroup === 'numeric' || currentTypeGroup === 'date';

  function resetState() {
    setOp('<=');
    setRightField('');
    setRightLiteral('');
    setRightMode('field');
    setRangeMin('');
    setRangeMax('');
    setRangeLowerOp('<=');
    setRangeUpperOp('<=');
    setAdding(false);
  }

  function addConstraint() {
    if (rightMode === 'range') {
      const exprs: string[] = [];
      const min = rangeMin.trim();
      const max = rangeMax.trim();
      if (min) {
        const lowerOp = rangeLowerOp === '<=' ? '>=' : '>';
        exprs.push(`${currentKey} ${lowerOp} ${min}`);
      }
      if (max) {
        exprs.push(`${currentKey} ${rangeUpperOp} ${max}`);
      }
      if (exprs.length === 0) return;
      onChange([...constraints, ...exprs]);
      resetState();
      return;
    }
    const rightValue = rightMode === 'field' ? rightField : rightLiteral.trim();
    if (!rightValue) return;
    const expr = `${currentKey} ${op} ${rightValue}`;
    onChange([...constraints, expr]);
    resetState();
  }

  function removeConstraint(idx: number) {
    onChange(constraints.filter((_, i) => i !== idx));
  }

  function removeRangePair(lowerIdx: number, upperIdx: number) {
    onChange(constraints.filter((_, i) => i !== lowerIdx && i !== upperIdx));
  }

  const { compatible, incompatible } = useMemo(() => {
    const comp: Array<{ value: string; label: string }> = [];
    const incompat: Array<{ value: string; label: string }> = [];
    for (const key of fieldOrder) {
      if (key.startsWith('__grp::') || key === currentKey) continue;
      const rule = rules[key] || {};
      const targetGroup = deriveTypeGroup(rule);
      const entry = { value: key, label: key };
      if (op === 'requires' || areTypesCompatible(currentTypeGroup, targetGroup)) {
        comp.push(entry);
      } else {
        incompat.push(entry);
      }
    }
    return { compatible: comp, incompatible: incompat };
  }, [fieldOrder, currentKey, rules, currentTypeGroup, op]);

  const { ranges, singles } = useMemo(
    () => groupRangeConstraints(constraints, currentKey),
    [constraints, currentKey]
  );

  const literalPlaceholder = currentTypeGroup === 'numeric' ? '100' :
    currentTypeGroup === 'date' ? '2024-01-15' :
    currentTypeGroup === 'boolean' ? 'yes' : "'wireless'";
  const rangePlaceholder = currentTypeGroup === 'date' ? '2024-01-01' : '0';

  const isRequires = op === 'requires';
  const canAddField = rightMode === 'field' && rightField !== '';
  const canAddLiteral = rightMode === 'value' && rightLiteral.trim() !== '';
  const canAddRange = rightMode === 'range' && (rangeMin.trim() !== '' || rangeMax.trim() !== '');
  const canAdd = isRequires ? rightField !== '' : (canAddField || canAddLiteral || canAddRange);

  const fieldBadgesFor = useCallback((key: string): Array<{ text: string; cls: string }> => {
    const r = rules[key] || {};
    const badges: Array<{ text: string; cls: string }> = [];
    const tg = deriveTypeGroup(r);
    badges.push({ text: tg, cls: 'bg-gray-100 dark:bg-gray-700 text-gray-500' });
    const contract = (r.contract || {}) as Record<string, unknown>;
    const unit = String(contract.unit || '').trim();
    if (unit) badges.push({ text: unit, cls: 'bg-sky-100 dark:bg-sky-900/40 text-sky-600 dark:text-sky-300' });
    const shape = String(contract.shape || '').trim();
    if (shape && shape !== 'scalar') badges.push({ text: shape, cls: 'bg-teal-100 dark:bg-teal-900/40 text-teal-600 dark:text-teal-300' });
    return badges;
  }, [rules]);

  const currentBadges = useMemo(() => fieldBadgesFor(currentKey), [fieldBadgesFor, currentKey]);
  const rightBadges = useMemo(() => rightField ? fieldBadgesFor(rightField) : [], [fieldBadgesFor, rightField]);

  const pillCls = 'inline-flex items-center gap-1 bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 px-1.5 py-0.5 rounded text-[10px]';
  const removeBtnCls = 'text-orange-400 hover:text-orange-600 ml-0.5';
  const modeBtnBase = 'px-1.5 py-0.5';
  const modeBtnActive = 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-medium';
  const modeBtnInactive = 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700';
  const badgeCls = 'text-[9px] px-1 py-0 rounded';

  return (
    <div className="text-[11px]">
      <div className="flex items-center gap-2 flex-wrap">
        {ranges.map((rp) => (
          <span key={`rp-${rp.lowerIdx}-${rp.upperIdx}`} className={`${pillCls} bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300`}>
            {rp.display}
            <button
              onClick={() => removeRangePair(rp.lowerIdx, rp.upperIdx)}
              className="text-purple-400 hover:text-purple-600 ml-0.5"
              title="Remove range"
            >&#10005;</button>
          </span>
        ))}
        {singles.map((s) => (
          <span key={s.idx} className={pillCls}>
            {s.expr}
            <button
              onClick={() => removeConstraint(s.idx)}
              className={removeBtnCls}
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
        <div className="mt-1.5 space-y-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-[10px] text-gray-500 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">{currentKey}</span>
            {currentBadges.map((b, i) => (
              <span key={i} className={`${badgeCls} ${b.cls}`}>{b.text}</span>
            ))}
            {!isRequires ? (
              <span className="inline-flex rounded border border-gray-300 dark:border-gray-600 overflow-hidden text-[9px]">
                <button
                  onClick={() => setRightMode('field')}
                  className={`${modeBtnBase} ${rightMode === 'field' ? modeBtnActive : modeBtnInactive}`}
                >Field</button>
                <button
                  onClick={() => setRightMode('value')}
                  className={`${modeBtnBase} ${rightMode === 'value' ? modeBtnActive : modeBtnInactive}`}
                >Value</button>
                {supportsRange ? (
                  <button
                    onClick={() => setRightMode('range')}
                    className={`${modeBtnBase} ${rightMode === 'range' ? modeBtnActive : modeBtnInactive}`}
                  >Range</button>
                ) : null}
              </span>
            ) : null}
          </div>
          {rightMode === 'range' ? (
            <div className="flex items-center gap-1 flex-wrap">
              <input
                type="text"
                className={`${inputCls} text-[11px] py-0.5 w-20`}
                placeholder={rangePlaceholder}
                value={rangeMin}
                onChange={(e) => setRangeMin(e.target.value)}
              />
              <select
                className={`${selectCls} text-[11px] py-0.5 w-10`}
                value={rangeLowerOp}
                onChange={(e) => setRangeLowerOp(e.target.value)}
              >
                <option value="<=">{'\u2264'}</option>
                <option value="<">{'<'}</option>
              </select>
              <span className="font-mono text-[10px] text-gray-500 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">{currentKey}</span>
              <select
                className={`${selectCls} text-[11px] py-0.5 w-10`}
                value={rangeUpperOp}
                onChange={(e) => setRangeUpperOp(e.target.value)}
              >
                <option value="<=">{'\u2264'}</option>
                <option value="<">{'<'}</option>
              </select>
              <input
                type="text"
                className={`${inputCls} text-[11px] py-0.5 w-20`}
                placeholder={currentTypeGroup === 'date' ? '2025-12-31' : '30000'}
                value={rangeMax}
                onChange={(e) => setRangeMax(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addConstraint(); }}
              />
              <button
                onClick={addConstraint}
                disabled={!canAddRange}
                className="text-[10px] text-green-600 hover:text-green-800 disabled:opacity-40 font-medium"
              >Add</button>
              <button
                onClick={resetState}
                className="text-[10px] text-gray-400 hover:text-gray-600"
              >Cancel</button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 flex-wrap">
              <select
                className={`${selectCls} text-[11px] py-0.5 w-[4.5rem]`}
                value={op}
                onChange={(e) => {
                  setOp(e.target.value);
                  if (e.target.value === 'requires') setRightMode('field');
                }}
              >
                {CONSTRAINT_OPS.map((o) => (
                  <option key={o} value={o} disabled={!allowedOps.has(o)}>{o}</option>
                ))}
              </select>
              {(isRequires || rightMode === 'field') ? (
                <select
                  className={`${selectCls} text-[11px] py-0.5 min-w-0`}
                  value={rightField}
                  onChange={(e) => setRightField(e.target.value)}
                >
                  <option value="">Select field...</option>
                  {compatible.length > 0 ? (
                    <optgroup label="Compatible">
                      {compatible.map((f) => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))}
                    </optgroup>
                  ) : null}
                  {incompatible.length > 0 ? (
                    <optgroup label="Incompatible type">
                      {incompatible.map((f) => (
                        <option key={f.value} value={f.value} disabled>{f.label}</option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
              ) : (
                <input
                  type="text"
                  className={`${inputCls} text-[11px] py-0.5 w-28`}
                  placeholder={literalPlaceholder}
                  value={rightLiteral}
                  onChange={(e) => setRightLiteral(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addConstraint(); }}
                />
              )}
              {rightBadges.length > 0 ? (
                rightBadges.map((b, i) => (
                  <span key={i} className={`${badgeCls} ${b.cls}`}>{b.text}</span>
                ))
              ) : null}
              <button
                onClick={addConstraint}
                disabled={!canAdd}
                className="text-[10px] text-green-600 hover:text-green-800 disabled:opacity-40 font-medium"
              >Add</button>
              <button
                onClick={resetState}
                className="text-[10px] text-gray-400 hover:text-gray-600"
              >Cancel</button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// â"€â"€ Editable Enum List â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
function EditableDataList({
  entry,
  index,
  isDuplicate,
  onUpdate,
  onRemove,
}: {
  entry: DataListEntry;
  index: number;
  isDuplicate: boolean;
  onUpdate: (updates: Partial<DataListEntry>) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [showAiSections, setShowAiSections] = useState(false);

  const valueCount = entry.manual_values.length;
  const listPriority = normalizePriorityProfile(entry.priority);
  const listAiAssist = normalizeAiAssistConfig(entry.ai_assist);
  const listTitle = entry.field ? displayLabel(entry.field) : `Enum ${index + 1}`;
  function updatePriority(updates: Partial<PriorityProfile>) {
    onUpdate({ priority: { ...listPriority, ...updates } });
  }
  function updateAiAssist(updates: Partial<AiAssistConfig>) {
    onUpdate({ ai_assist: { ...listAiAssist, ...updates } });
  }

  // Collapsed view
  if (!expanded) {
    return (
      <div className="border border-gray-200 dark:border-gray-700 rounded bg-gray-50 dark:bg-gray-750">
        <div className="w-full flex items-center gap-2 px-3 py-2">
          <button
            type="button"
            onClick={() => {
              setExpanded(true);
              setConfirmingRemove(false);
            }}
            className="relative flex-1 min-w-0 py-2 text-sm font-semibold text-left text-gray-700 dark:text-gray-100 hover:text-gray-900 dark:hover:text-white"
          >
            <span className="absolute left-0 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-5 h-5 border border-gray-300 dark:border-gray-600 rounded text-xs font-medium text-gray-500 dark:text-gray-300">+</span>
            <span className="w-full text-left px-6 truncate">{listTitle}</span>
            <span className="absolute right-0 top-1/2 -translate-y-1/2 inline-flex items-center gap-2">
              {valueCount > 0 ? <span className="text-xs text-gray-500">{valueCount} values</span> : null}
              {isDuplicate ? <span className="text-xs text-red-500 font-medium">Duplicate!</span> : null}
            </span>
          </button>
          <div className="flex items-center gap-2">
            {confirmingRemove ? (
              <>
                <button
                  type="button"
                  onClick={() => setConfirmingRemove(false)}
                  className="px-2 py-1 text-[11px] rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingRemove(false);
                    onRemove();
                  }}
                  className={`${btnDanger} !px-2 !py-1 text-[11px]`}
                >
                  Confirm remove
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingRemove(true)}
                className="px-2 py-1 text-[11px] rounded border border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

    return (
      <div className="border border-gray-200 dark:border-gray-700 rounded p-3 space-y-3 bg-gray-50 dark:bg-gray-750">
      <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setExpanded(false);
              setConfirmingRemove(false);
          }}
          className="relative flex-1 min-w-0 py-2 text-sm font-semibold text-left text-gray-700 dark:text-gray-100 hover:text-gray-900 dark:hover:text-white"
        >
          <span className="absolute left-0 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-5 h-5 border border-gray-300 dark:border-gray-600 rounded text-xs font-medium text-gray-500 dark:text-gray-300">-</span>
          <span className="w-full text-left px-6 truncate">{listTitle}</span>
          <span className="absolute right-0 top-1/2 -translate-y-1/2 inline-flex items-center gap-2">
            {valueCount > 0 ? <span className="text-xs text-gray-500">{valueCount} values</span> : null}
            {isDuplicate ? <span className="text-xs text-red-500 font-medium">Duplicate!</span> : null}
          </span>
        </button>
        <div className="flex items-center gap-2">
          {confirmingRemove ? (
            <>
              <button
                type="button"
                onClick={() => setConfirmingRemove(false)}
                className="px-2 py-1 text-[11px] rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingRemove(false);
                  onRemove();
                }}
                className={`${btnDanger} !px-2 !py-1 text-[11px]`}
              >
                Confirm remove
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingRemove(true)}
              className="px-2 py-1 text-[11px] rounded border border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {isDuplicate && (
        <div className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 rounded px-2 py-1">
          Warning: Another data list uses the same field name "{entry.field}". Each field should have only one list.
        </div>
      )}

      {/* Identity row: field name + normalize */}
      <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
        <div>
          <label className={labelCls}>
            Field Name <Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.data_list_field} />
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
            Normalize <Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.data_list_normalize} />
          </label>
          <select
            className={selectCls + ' w-full'}
            value={entry.normalize}
            onChange={(e) => onUpdate({ normalize: e.target.value })}
          >
            {NORMALIZE_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
      </div>

      {/* List review priority / effort */}
      <button
        type="button"
        onClick={() => setShowAiSections((v) => !v)}
        className="w-full flex items-center gap-2 mb-2"
      >
        <span className="inline-flex items-center justify-center w-5 h-5 border border-gray-300 dark:border-gray-600 rounded text-xs font-medium text-gray-500 dark:text-gray-300">{showAiSections ? '-' : '+'}</span>
        <span className="text-xs font-semibold text-gray-500">AI Review Priority</span>
      </button>
      {showAiSections ? (
        <div className="border border-gray-200 dark:border-gray-600 rounded p-2.5 bg-white dark:bg-gray-800/40">
          <div className="grid grid-cols-4 gap-2">
            <div>
              <label className={labelCls}>Required Level <Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.required_level} /></label>
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
              <label className={labelCls}>Availability <Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.availability} /></label>
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
              <label className={labelCls}>Difficulty <Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.difficulty} /></label>
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
              <label className={labelCls}>Effort (1-10) <Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.effort} /></label>
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
      ) : null}

      {/* List-level AI assist (same controls as Key Navigator) */}
      <button
        type="button"
        onClick={() => setShowAiSections((v) => !v)}
        className="w-full flex items-center gap-2 mb-2 mt-2"
      >
        <span className="inline-flex items-center justify-center w-5 h-5 border border-gray-300 dark:border-gray-600 rounded text-xs font-medium text-gray-500 dark:text-gray-300">{showAiSections ? '-' : '+'}</span>
        <span className="text-xs font-semibold text-gray-500">AI Assist</span>
      </button>
      {showAiSections ? (() => {
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
            <h4 className="text-xs font-semibold text-gray-500 mb-2">AI Assist<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.ai_mode} /></h4>
            <div className="grid grid-cols-4 gap-2">
              <div>
                <label className={labelCls}>Mode<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.ai_mode} /></label>
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
                <label className={labelCls}>Model Strategy<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.ai_model_strategy} /></label>
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
              <label className={labelCls}>Max Calls<Tip text={STUDIO_TIPS.ai_max_calls} style={{ position: 'relative', left: '-3px', top: '-4px' }} /></label>
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
                <label className={labelCls}>Max Tokens<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.ai_max_tokens} /></label>
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
                <span className={labelCls.replace(' mb-1', '')}>Extraction Guidance (sent to LLM)<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.ai_reasoning_note} /></span>
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
      })() : null}

      {/* Manual values */}
      <div>
        <label className={labelCls}>
          Values <Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.data_list_manual_values} />
        </label>
        <TagPicker
          values={entry.manual_values}
          onChange={(v) => onUpdate({ manual_values: v })}
          placeholder="Type a value and press Enter..."
        />
      </div>

    </div>
  );
}

// â"€â"€ Editable Component Source â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
function EditableComponentSource({
  index,
  source,
  onUpdate,
  onRemove,
  rules,
  fieldOrder,
  knownValues,
}: {
  index: number;
  source: ComponentSource;
  onUpdate: (updates: Partial<ComponentSource>) => void;
  onRemove: () => void;
  rules: Record<string, FieldRule>;
  fieldOrder: string[];
  knownValues: Record<string, string[]>;
}) {
  const roles = source.roles || { maker: '', aliases: [], links: [], properties: [] };
  const sourcePriority = normalizePriorityProfile(source.priority);
  const sourceAiAssist = normalizeAiAssistConfig(source.ai_assist);
  const [activeRoles, setActiveRoles] = useState<Set<RoleId>>(() => {
    const set = new Set<RoleId>();
    if (roles.maker) set.add('maker');
    if (Array.isArray(roles.aliases) && roles.aliases.length > 0) set.add('aliases');
    if (Array.isArray(roles.links) && roles.links.length > 0) set.add('links');
    if (Array.isArray(roles.properties) && roles.properties.length > 0) set.add('properties');
    return set;
  });

  const [propertyRows, setPropertyRows] = useState<PropertyMapping[]>(() => {
    if (!Array.isArray(roles.properties)) return [];
    return (roles.properties as unknown as typeof roles.properties).map((p) => migrateProperty(p, rules));
  });
  const [pendingFieldKey, setPendingFieldKey] = useState('');
  const [showAiSections, setShowAiSections] = useState(false);
  const [showTrackedRoles, setShowTrackedRoles] = useState(false);
  const [showAttributes, setShowAttributes] = useState(false);

  // Group field keys by ui.group for the field key picker
  const fieldKeyGroups = useMemo(() => {
    const groups: Record<string, { key: string; label: string; type: string }[]> = {};
    const usedKeys = new Set(propertyRows.map((r) => r.field_key));
    for (const key of fieldOrder) {
      if (key.startsWith('__grp::') || usedKeys.has(key)) continue;
      const rule = rules[key] || {};
      const ui = rule.ui || {};
      const contract = rule.contract || {};
      const group = String(ui.group || rule.group || 'other');
      if (!groups[group]) groups[group] = [];
      groups[group].push({
        key,
        label: displayLabel(key, rule as Record<string, unknown>),
        type: String(contract.type || 'string'),
      });
    }
    return groups;
  }, [fieldOrder, rules, propertyRows]);

  // Get inherited info from field rules for a field key
  function getInheritedInfo(fieldKey: string): { type: string; unit: string; template: string; evidenceRefs: number; constraints: string[]; enumPolicy: string; enumSource: string; isBool: boolean; fieldValues: string[] } {
    const rule = rules[fieldKey] || {};
    const contract = rule.contract || {};
    const parse = (rule as Record<string, unknown>).parse as Record<string, unknown> | undefined;
    const evidence = (rule as Record<string, unknown>).evidence as Record<string, unknown> | undefined;
    const ruleAny = rule as Record<string, unknown>;
    const constraints = Array.isArray(ruleAny.constraints) ? ruleAny.constraints.map(String) : [];
    const contractAny = contract as Record<string, unknown>;
    const enumObj = ruleAny.enum as Record<string, unknown> | undefined;
    const enumPolicy = String(enumObj?.policy || contractAny.enum_policy || contractAny.list_policy || '');
    const enumSource = String(enumObj?.source || contractAny.enum_source || contractAny.list_source || contractAny.data_list || '');
    const contractType = String(contract.type || 'string');
    const isBool = contractType === 'boolean';
    const fieldValues = knownValues[fieldKey] || [];
    return {
      type: contractType,
      unit: String(contract.unit || ''),
      template: String(parse?.template || parse?.parse_template || ''),
      evidenceRefs: Number(evidence?.min_refs || evidence?.min_evidence_refs || 0),
      constraints,
      enumPolicy,
      enumSource,
      isBool,
      fieldValues,
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

  function selectFieldKey(pidx: number, fieldKey: string) {
    updatePropertyField(pidx, { field_key: fieldKey });
  }

  function addPropertyFromFieldKey(fieldKey: string) {
    if (propertyRows.some((r) => r.field_key === fieldKey)) return;
    const newRow: PropertyMapping = {
      field_key: fieldKey,
      variance_policy: 'authoritative',
      tolerance: null,
    };
    const next = [...propertyRows, newRow];
    setPropertyRows(next);
    updateRoles({ properties: next as unknown as typeof roles.properties });
  }

  const compType = source.component_type || source.type || '';
  const [expanded, setExpanded] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const sourceTitle = compType
    ? displayLabel(compType)
    : `Source ${index + 1}`;
  const trackedRoleCount = ['maker', 'aliases', 'links'].filter((role) => activeRoles.has(role as RoleId)).length;
  const componentSummary = [
    `${propertyRows.length} attribute${propertyRows.length !== 1 ? 's' : ''}`,
    `${trackedRoleCount} tracked role${trackedRoleCount !== 1 ? 's' : ''}`,
  ];

  if (!expanded) {
    return (
      <div className="border border-gray-200 dark:border-gray-700 rounded bg-gray-50 dark:bg-gray-750">
        <div className="w-full flex items-center gap-2 px-3 py-2">
          <button
            type="button"
            onClick={() => {
              setExpanded(true);
              setConfirmingRemove(false);
            }}
            className="relative flex-1 min-w-0 py-2 text-sm font-semibold text-left text-gray-700 dark:text-gray-100 hover:text-gray-900 dark:hover:text-white"
        >
            <span className="absolute left-0 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-5 h-5 border border-gray-300 dark:border-gray-600 rounded text-xs font-medium text-gray-500 dark:text-gray-300">+</span>
            <span className="w-full text-left px-6 truncate">{sourceTitle}</span>
            <span className="absolute right-0 top-1/2 -translate-y-1/2 inline-flex items-center gap-2">
              {componentSummary.length > 0 ? (
                <span className="text-xs text-gray-500">{componentSummary.slice(0, 2).join(' | ')}</span>
              ) : null}
            </span>
          </button>
          <div className="flex items-center gap-2">
            {confirmingRemove ? (
              <>
                <button
                  type="button"
                  onClick={() => setConfirmingRemove(false)}
                  className="px-2 py-1 text-[11px] rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingRemove(false);
                    onRemove();
                  }}
                  className={`${btnDanger} !px-2 !py-1 text-[11px]`}
                >
                  Confirm remove
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingRemove(true)}
                className="px-2 py-1 text-[11px] rounded border border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded p-4 bg-gray-50 dark:bg-gray-750">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setExpanded(false);
            setConfirmingRemove(false);
          }}
          className="relative flex-1 min-w-0 py-2 text-sm font-semibold text-left text-gray-700 dark:text-gray-100 hover:text-gray-900 dark:hover:text-white"
        >
          <span className="absolute left-0 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-5 h-5 border border-gray-300 dark:border-gray-600 rounded text-xs font-medium text-gray-500 dark:text-gray-300">-</span>
            <span className="w-full text-left px-6 truncate">{sourceTitle}</span>
            <span className="absolute right-0 top-1/2 -translate-y-1/2 inline-flex items-center gap-2">
              {componentSummary.length > 0 ? (
                <span className="text-xs text-gray-500">{componentSummary.slice(0, 2).join(' | ')}</span>
              ) : null}
            </span>
        </button>
        <div className="flex items-center gap-2 pt-0.5">
          {confirmingRemove ? (
            <>
              <button
                type="button"
                onClick={() => setConfirmingRemove(false)}
                className="px-2 py-1 text-[11px] rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingRemove(false);
                  onRemove();
                }}
                className={`${btnDanger} !px-2 !py-1 text-[11px]`}
              >
                Confirm remove
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingRemove(true)}
              className="px-2 py-1 text-[11px] rounded border border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {/* Basic fields */}
      <div className="mb-3">
        <div className={labelCls}>Component Type<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.component_type} /></div>
        <ComboSelect
          value={compType}
          onChange={(v) => onUpdate({ component_type: v, type: v })}
          options={COMPONENT_TYPES}
          placeholder="e.g. sensor"
        />
      </div>

      {/* Component-level full review priority/effort */}
      <button
        type="button"
        onClick={() => setShowAiSections((v) => !v)}
        className="w-full flex items-center gap-2 mb-2"
      >
        <span className="inline-flex items-center justify-center w-5 h-5 border border-gray-300 dark:border-gray-600 rounded text-xs font-medium text-gray-500 dark:text-gray-300">{showAiSections ? '-' : '+'}</span>
        <span className="text-xs font-semibold text-gray-500">AI Review Priority</span>
      </button>
      {showAiSections ? (
        <div className="border border-gray-200 dark:border-gray-700 rounded p-3 mb-4 bg-gray-50 dark:bg-gray-900/20">
          <div className="text-xs font-semibold text-gray-500 mb-2">AI Review Priority</div>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <div className={labelCls}>Required Level<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.required_level} /></div>
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
              <div className={labelCls}>Availability<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.availability} /></div>
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
              <div className={labelCls}>Difficulty<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.difficulty} /></div>
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
              <div className={labelCls}>Effort (1-10)<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.effort} /></div>
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
      ) : null}

      {/* Component table-level AI assist */}
      <button
        type="button"
        onClick={() => setShowAiSections((v) => !v)}
        className="w-full flex items-center gap-2 mb-2"
      >
        <span className="inline-flex items-center justify-center w-5 h-5 border border-gray-300 dark:border-gray-600 rounded text-xs font-medium text-gray-500 dark:text-gray-300">{showAiSections ? '-' : '+'}</span>
        <span className="text-xs font-semibold text-gray-500">AI Assist</span>
      </button>
      {showAiSections ? (() => {
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
            <h4 className="text-xs font-semibold text-gray-500 mb-2">AI Assist<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.ai_mode} /></h4>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <div className={labelCls}>Mode<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.ai_mode} /></div>
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
                <div className={labelCls}>Model Strategy<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.ai_model_strategy} /></div>
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
                <div className={labelCls}>Max Calls<Tip text={STUDIO_TIPS.ai_max_calls} style={{ position: 'relative', left: '-3px', top: '-4px' }} /></div>
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
                <div className={labelCls}>Max Tokens<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.ai_max_tokens} /></div>
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
                <span className={labelCls.replace(' mb-1', '')}>Extraction Guidance (sent to LLM)<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.ai_reasoning_note} /></span>
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
      })() : null}

      {/* Tracked Roles */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
        <button
          type="button"
          onClick={() => setShowTrackedRoles((v) => !v)}
          className="w-full flex items-center justify-between gap-2 mb-2"
        >
          <span className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-5 h-5 border border-gray-300 dark:border-gray-600 rounded text-xs font-medium text-gray-500 dark:text-gray-300">{showTrackedRoles ? '-' : '+'}</span>
            <span className="text-xs font-semibold text-gray-500">Tracked Roles</span>
          </span>
          <span className="text-[10px] text-gray-400">{trackedRoleCount} tracked roles</span>
        </button>
        {showTrackedRoles ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
          {([
            { id: 'name' as const, label: 'Name', alwaysOn: true },
            { id: 'maker' as const, label: 'Maker (Brand)', alwaysOn: false },
            { id: 'aliases' as const, label: 'Aliases', alwaysOn: false },
            { id: 'links' as const, label: 'Links (URLs)', alwaysOn: false },
          ] as const).map((role) => {
            const isOn = role.alwaysOn || (role.id === 'maker' ? activeRoles.has('maker') : role.id === 'aliases' ? activeRoles.has('aliases') : activeRoles.has('links'));
            return (
              <button
                key={role.id}
                disabled={role.alwaysOn}
                className={`px-3 py-1.5 text-xs font-medium rounded border transition-colors ${
                  isOn
                    ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 border-green-400 dark:border-green-700'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-500 border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-700'
                } ${role.alwaysOn ? 'cursor-default opacity-80' : ''}`}
                onClick={() => {
                  if (role.alwaysOn) return;
                  const next = new Set(activeRoles);
                  if (role.id === 'maker') {
                    if (next.has('maker')) { next.delete('maker'); updateRoles({ maker: '' }); }
                    else { next.add('maker'); updateRoles({ maker: 'yes' }); }
                  } else if (role.id === 'aliases') {
                    if (next.has('aliases')) { next.delete('aliases'); updateRoles({ aliases: [] }); }
                    else { next.add('aliases'); }
                  } else if (role.id === 'links') {
                    if (next.has('links')) { next.delete('links'); updateRoles({ links: [] }); }
                    else { next.add('links'); }
                  }
                  setActiveRoles(next);
                }}
              >
                {role.label}
              </button>
            );
          })}
        </div>
        <div className="text-[10px] text-gray-400 mb-3">
          All tracked roles use <span className="font-semibold text-gray-500">Authoritative</span> variance policy
        </div>

        {/* Alias values â€" shown when aliases role is active */}
        {activeRoles.has('aliases') ? (
          <div className="mb-4 border border-gray-200 dark:border-gray-700 rounded p-3 bg-gray-50 dark:bg-gray-900/20">
            <div className="flex items-center gap-2 mb-2">
              <div className={labelCls}>Alias Values</div>
            </div>
            <TagPicker
              values={Array.isArray(roles.aliases) ? roles.aliases.filter((a) => a.length > 1 || !/^[A-Z]$/.test(a)) : []}
              onChange={(v) => updateRoles({ aliases: v })}
              placeholder="Type an alias and press Enter..."
            />
          </div>
        ) : null}

        {/* Attributes (Properties) */}
        <button
          type="button"
          onClick={() => setShowAttributes((v) => !v)}
          className="w-full flex items-center justify-between gap-2 mb-2"
        >
          <span className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-5 h-5 border border-gray-300 dark:border-gray-600 rounded text-xs font-medium text-gray-500 dark:text-gray-300">{showAttributes ? '-' : '+'}</span>
            <span className="text-xs font-semibold text-gray-500">Attributes ({propertyRows.length})<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.comp_field_key} /></span>
          </span>
          <span className="text-xs text-gray-400">{propertyRows.length} attribute{propertyRows.length !== 1 ? 's' : ''}</span>
        </button>
        {showAttributes ? (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-2">
              <div className={labelCls}>Attributes ({propertyRows.length})<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.comp_field_key} /></div>
            {fieldOrder.length > 0 ? (
              <div className="flex items-center gap-2">
                <select
                  className={`${selectCls} text-xs min-w-[180px]`}
                  value={pendingFieldKey}
                  onChange={(e) => setPendingFieldKey(e.target.value)}
                >
                  <option value="">Select field key...</option>
                  {Object.entries(fieldKeyGroups).flatMap(([, keys]) =>
                    keys.map((k) => (
                      <option key={k.key} value={k.key}>{k.label} ({k.type})</option>
                    ))
                  )}
                </select>
                <button
                  className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40"
                  disabled={!pendingFieldKey}
                  onClick={() => {
                    if (pendingFieldKey) {
                      addPropertyFromFieldKey(pendingFieldKey);
                      setPendingFieldKey('');
                    }
                  }}
                >
                  + Add
                </button>
              </div>
            ) : null}
          </div>
          {propertyRows.length > 0 ? (
            <div className="space-y-2">
              {propertyRows.map((prop, pidx) => {
                const inherited = prop.field_key ? getInheritedInfo(prop.field_key) : null;
                const hasEnumSource = inherited ? !!inherited.enumSource : false;
                const isComponentDbEnum = hasEnumSource && inherited!.enumSource.startsWith('component_db');
                const isExternalEnum = hasEnumSource && !isComponentDbEnum;
                const varianceLocked = inherited ? (inherited.type !== 'number' || inherited.isBool || hasEnumSource) : false;
                const lockReason = inherited
                  ? inherited.isBool
                    ? 'Boolean field â€" variance locked to authoritative (yes/no only)'
                    : isComponentDbEnum
                      ? `enum.db (${inherited.enumSource.replace(/^component_db\./, '')}) â€" variance locked to authoritative`
                      : isExternalEnum
                        ? `Enum (${inherited.enumSource.replace(/^(known_values|data_lists)\./, '')}) â€" variance locked to authoritative`
                        : inherited.type !== 'number' && inherited.fieldValues.length > 0
                          ? `Manual values (${inherited.fieldValues.length}) â€" variance locked to authoritative`
                          : inherited.type !== 'number'
                            ? 'String property â€" variance locked to authoritative (only number fields without enums support variance)'
                            : ''
                  : '';
                return (
                  <div key={pidx} className="border border-gray-200 dark:border-gray-600 rounded overflow-hidden">
                    <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end p-3 pb-2">
                      <div>
                        <div className="text-[10px] text-gray-400 mb-0.5">
                          Field Key<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.comp_field_key} />
                        </div>
                        <select
                          className={`${selectCls} w-full`}
                          value={prop.field_key}
                          onChange={(e) => {
                            const newKey = e.target.value;
                            selectFieldKey(pidx, newKey);
                            if (newKey) {
                              const info = getInheritedInfo(newKey);
                              const shouldLock = info.type !== 'number' || info.isBool || !!info.enumSource;
                              if (shouldLock) {
                                updatePropertyField(pidx, { field_key: newKey, variance_policy: 'authoritative', tolerance: null });
                              }
                            }
                          }}
                        >
                          <option value="">(select field key)</option>
                          {prop.field_key && rules[prop.field_key] ? (() => {
                            const r = rules[prop.field_key];
                            const ct = r.contract || {};
                            return <option key={prop.field_key} value={prop.field_key}>{displayLabel(prop.field_key, r as Record<string, unknown>)} ({String(ct.type || 'string')}) &#10003;</option>;
                          })() : prop.field_key ? (
                            <option key={prop.field_key} value={prop.field_key}>{prop.field_key} &#10003;</option>
                          ) : null}
                          {Object.entries(fieldKeyGroups).flatMap(([, keys]) =>
                            keys.map((k) => (
                              <option key={k.key} value={k.key}>{k.label} ({k.type})</option>
                            ))
                          )}
                        </select>
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-400 mb-0.5">Variance<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.comp_variance_policy} /></div>
                        <select
                          className={`${selectCls} w-full ${varianceLocked || prop.variance_policy === 'override_allowed' ? 'opacity-50 cursor-not-allowed' : ''}`}
                          value={varianceLocked || prop.variance_policy === 'override_allowed' ? 'authoritative' : prop.variance_policy}
                          disabled={varianceLocked || prop.variance_policy === 'override_allowed'}
                          title={prop.variance_policy === 'override_allowed' ? 'Disabled â€" override checkbox is active' : lockReason}
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

                    {/* Variance lock reason + enriched type metadata */}
                    {varianceLocked && inherited ? (
                      <div className="px-3 pb-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500">authoritative (locked)</span>
                          {inherited.isBool ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">boolean: yes / no</span>
                          ) : null}
                          {isComponentDbEnum ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400 truncate max-w-[200px]" title={inherited.enumSource}>
                              enum.db: {inherited.enumSource.replace(/^component_db\./, '')}
                            </span>
                          ) : null}
                          {isExternalEnum ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400 truncate max-w-[200px]" title={inherited.enumSource}>
                              enum: {inherited.enumSource.replace(/^(known_values|data_lists)\./, '')}
                            </span>
                          ) : null}
                          {!inherited.isBool && !hasEnumSource && inherited.fieldValues.length > 0 && inherited.fieldValues.length <= 8 ? (
                            <div className="flex flex-wrap gap-0.5">
                              <span className="text-[10px] text-gray-400 mr-0.5">manual:</span>
                              {inherited.fieldValues.map(v => (
                                <span key={v} className="text-[9px] px-1 py-0.5 rounded bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400">{v}</span>
                              ))}
                            </div>
                          ) : null}
                          {!inherited.isBool && !hasEnumSource && inherited.fieldValues.length > 8 ? (
                            <span className="text-[10px] text-gray-400" title={inherited.fieldValues.join(', ')}>manual: {inherited.fieldValues.length} values</span>
                          ) : null}
                          {!inherited.isBool && !hasEnumSource && inherited.fieldValues.length === 0 && inherited.type !== 'number' ? (
                            <span className="text-[10px] text-gray-400 italic">string type</span>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    {/* Allow Product Override checkbox (shown for unlocked number fields) */}
                    {!varianceLocked ? (
                      <div className="px-3 pb-2">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={prop.variance_policy === 'override_allowed'}
                            onChange={(e) => updatePropertyField(pidx, {
                              variance_policy: e.target.checked ? 'override_allowed' : 'authoritative',
                              tolerance: e.target.checked ? null : prop.tolerance,
                            })}
                            className="rounded border-gray-300"
                          />
                          <span className="text-[10px] text-gray-500">Allow Product Override</span>
                          <Tip text={STUDIO_TIPS.comp_override_allowed} />
                        </label>
                      </div>
                    ) : null}

                    {/* Tolerance input (shown for unlocked numeric upper_bound/lower_bound/range) */}
                    {!varianceLocked && (prop.variance_policy === 'upper_bound' || prop.variance_policy === 'lower_bound' || prop.variance_policy === 'range') ? (
                      <div className="px-3 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-400">Tolerance<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.comp_tolerance} /></span>
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

                    {/* Inherited info banner */}
                    {inherited && prop.field_key ? (
                      <div className="bg-gray-50 dark:bg-gray-900/50 px-3 py-2 text-[11px] text-gray-500 border-t border-gray-200 dark:border-gray-700">
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
                          {isComponentDbEnum ? (
                            <span className="bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 px-1.5 py-0.5 rounded text-[10px]">enum.db: {inherited.enumSource.replace(/^component_db\./, '')}</span>
                          ) : isExternalEnum ? (
                            <span className="bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 px-1.5 py-0.5 rounded text-[10px]">enum: {inherited.enumSource.replace(/^(known_values|data_lists)\./, '')}</span>
                          ) : inherited.isBool ? (
                            <span className="bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded text-[10px]">boolean: yes / no</span>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    {/* Read-only constraints from field rule */}
                    {inherited && inherited.constraints.length > 0 ? (
                      <div className="px-3 py-1.5 border-t border-gray-200 dark:border-gray-700 text-[11px]">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-gray-500">Constraints</span>
                          {inherited.constraints.map((c, ci) => (
                            <span key={ci} className="bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 px-1.5 py-0.5 rounded text-[10px]">{c}</span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-gray-400">No attributes. Use the dropdown above to add field keys.</p>
          )}
        </div>
        ) : null}
      </div>
      ) : null}

      {/* Summary line */}
      <div className="mt-3 text-xs text-gray-400 flex flex-wrap gap-1.5">
        <span className="px-1.5 py-0.5 rounded bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400">{propertyRows.length} attribute{propertyRows.length !== 1 ? 's' : ''}</span>
        <span className="px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">{trackedRoleCount} tracked role{trackedRoleCount !== 1 ? 's' : ''}</span>
      </div>
    </div>
    </div>
  );
}

// â"€â"€ Key Navigator â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
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
function Section({
  title,
  children,
  defaultOpen = false,
  titleTooltip,
  centerTitle = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  titleTooltip?: string;
  centerTitle?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const titleCls = centerTitle ? 'text-center leading-snug' : 'text-left pl-1 leading-snug';
  return (
    <div className="relative border border-gray-200 dark:border-gray-700 rounded">
      <button
        onClick={() => setOpen(!open)}
        className="w-full min-h-9 flex items-center gap-2 px-3 py-2 text-sm font-semibold bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-t relative"
      >
      {centerTitle ? (
        <>
          <span className="absolute left-3 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-5 h-5 border border-gray-300 dark:border-gray-600 rounded text-xs font-medium text-gray-500 dark:text-gray-300">
            {open ? '-' : '+'}
          </span>
          <span className={`w-full ${titleCls}`}>{title}</span>
        </>
      ) : (
        <>
          <span className="inline-flex items-center justify-center w-5 h-5 border border-gray-300 dark:border-gray-600 rounded text-xs font-medium text-gray-500 dark:text-gray-300">
            {open ? '-' : '+'}
          </span>
          <span className={titleCls}>{title}</span>
        </>
      )}
      </button>
      {titleTooltip ? (
        <span
          className="absolute"
          style={{ right: '-10px', top: '-2px', transform: 'translateY(-16px)' }}
        >
          <Tip text={titleTooltip} />
        </span>
      ) : null}
      {open ? <div className="p-3 space-y-3">{children}</div> : null}
    </div>
  );
}

function KeyNavigatorTab({
  category,
  selectedKey,
  onSelectKey,
  onSave,
  saving,
  saveSuccess,
  knownValues,
  enumLists,
  componentDb,
  componentSources,
  autoSaveEnabled,
  setAutoSaveEnabled,
}: {
  category: string;
  selectedKey: string;
  onSelectKey: (key: string) => void;
  onSave: () => void;
  saving: boolean;
  saveSuccess: boolean;
  knownValues: Record<string, string[]>;
  enumLists: EnumEntry[];
  componentSources: ComponentSource[];
  componentDb: ComponentDbResponse;
  autoSaveEnabled: boolean;
  setAutoSaveEnabled: (v: boolean) => void;
}) {
  const {
    editedRules, editedFieldOrder, updateField,
    addKey, removeKey, renameKey, bulkAddKeys,
    reorder, addGroup, removeGroup, renameGroup,
  } = useFieldRulesStore();

  // Add key UI state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addKeyValue, setAddKeyValue] = useState('');
  const [addKeyGroup, setAddKeyGroup] = useState('');

  // Rename UI state
  const [renamingKey, setRenamingKey] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  // Label edit state
  const [editingLabel, setEditingLabel] = useState(false);
  const [editLabelValue, setEditLabelValue] = useState('');

  // Delete confirmation state
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Group UI state
  const [selectedGroup, setSelectedGroup] = useState('');
  const [showAddGroupForm, setShowAddGroupForm] = useState(false);
  const [addGroupValue, setAddGroupValue] = useState('');

  // Bulk paste modal state
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkGridRows, setBulkGridRows] = useState<BulkGridRow[]>([]);
  const [bulkGroup, setBulkGroup] = useState('');

  useEffect(() => {
    setRenamingKey(false);
    setEditingLabel(false);
    setConfirmDelete(false);
  }, [selectedKey]);

  const activeFieldOrder = editedFieldOrder;

  const groups = useMemo(() => {
    return deriveGroupsTs(activeFieldOrder, editedRules);
  }, [activeFieldOrder, editedRules]);

  const existingGroups = useMemo(() => {
    const gs = new Set<string>();
    for (const [g] of groups) gs.add(g);
    return Array.from(gs);
  }, [groups]);

  const existingLabels = useMemo(() => {
    return activeFieldOrder
      .filter(k => !k.startsWith('__grp::'))
      .map(k => displayLabel(k, editedRules[k]));
  }, [activeFieldOrder, editedRules]);

  const bulkPreviewRows: BulkKeyRow[] = useMemo(() => {
    const filled = bulkGridRows.filter(r => r.col1.trim() || r.col2.trim());
    if (filled.length === 0) return [];
    const lines = filled.map(r => r.col2.trim() ? `${r.col1}\t${r.col2}` : r.col1);
    const existingKeys = activeFieldOrder.filter(k => !k.startsWith('__grp::'));
    return validateBulkRows(lines, existingKeys, existingLabels);
  }, [bulkGridRows, activeFieldOrder, existingLabels]);

  const bulkCounts = useMemo(() => {
    const c = { ready: 0, existing: 0, duplicate: 0, invalid: 0 };
    for (const row of bulkPreviewRows) {
      if (row.status === 'ready') c.ready++;
      else if (row.status === 'duplicate_existing') c.existing++;
      else if (row.status === 'duplicate_in_paste') c.duplicate++;
      else c.invalid++;
    }
    return c;
  }, [bulkPreviewRows]);

  const bulkReadyRows = useMemo(() =>
    bulkPreviewRows.filter(r => r.status === 'ready'),
  [bulkPreviewRows]);

  const handleReorder = useCallback((activeItem: string, overItem: string) => {
    reorder(activeItem, overItem);
    onSave();
  }, [reorder, onSave]);

  function handleSaveAll() {
    onSave();
  }

  function handleAddKey() {
    const key = addKeyValue.trim();
    const err = validateNewKeyTs(key, activeFieldOrder);
    if (err) return;
    const label = key.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    addKey(key, { label, group: addKeyGroup || 'ungrouped', ui: { label, group: addKeyGroup || 'ungrouped' }, constraints: [] }, selectedKey || undefined);
    setShowAddForm(false);
    setAddKeyValue('');
    setAddKeyGroup('');
    setSelectedGroup('');
    onSelectKey(key);
    onSave();
  }

  function handleDeleteKey() {
    if (!selectedKey) return;
    const deletedKey = selectedKey;
    removeKey(deletedKey);
    setConfirmDelete(false);
    const nextOrder = activeFieldOrder.filter((k) => k !== deletedKey);
    const idx = activeFieldOrder.indexOf(deletedKey);
    const nextKey = nextOrder[Math.min(idx, nextOrder.length - 1)] || '';
    onSelectKey(nextKey);
    onSave();
  }

  function handleRenameKey() {
    const newKey = renameValue.trim();
    if (!selectedKey || !newKey || newKey === selectedKey) { setRenamingKey(false); return; }
    const err = validateNewKeyTs(newKey, activeFieldOrder.filter((k) => k !== selectedKey));
    if (err) { return; }
    renameKey(selectedKey, newKey, rewriteConstraintsTs, constraintRefsKey);
    setRenamingKey(false);
    onSelectKey(newKey);
    onSave();
  }

  function handleAddGroup() {
    const name = addGroupValue.trim();
    const err = validateNewGroupTs(name, existingGroups);
    if (err) return;
    addGroup(name);
    setShowAddGroupForm(false);
    setAddGroupValue('');
    onSave();
  }

  function handleBulkImport() {
    if (bulkReadyRows.length === 0) return;
    const group = bulkGroup || 'ungrouped';
    bulkAddKeys(bulkReadyRows.map((row) => ({
      key: row.key,
      rule: { label: row.label, group, ui: { label: row.label, group }, constraints: [] },
    })));
    onSave();
    setBulkOpen(false);
    setBulkGridRows([]);
    setBulkGroup('');
  }

  function handleDeleteGroup(group: string) {
    if (!window.confirm(`Delete group "${group}"? Fields in this group will become ungrouped.`)) return;
    removeGroup(group);
    setSelectedGroup('');
    onSave();
  }

  function handleRenameGroup(oldName: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    const otherGroups = existingGroups.filter(g => g.toLowerCase() !== oldName.toLowerCase());
    if (validateNewGroupTs(trimmed, otherGroups)) return;
    renameGroup(oldName, trimmed);
    setSelectedGroup(trimmed);
    onSave();
  }

  function handleSelectGroup(group: string) {
    setSelectedGroup((prev) => prev === group ? '' : group);
    onSelectKey('');
  }

  function handleSelectKey(key: string) {
    setSelectedGroup('');
    onSelectKey(key);
  }

  const currentRule = selectedKey ? (editedRules[selectedKey] || null) : null;

  return (
    <>
    <div className="flex gap-4" style={{ minHeight: 'calc(100vh - 350px)' }}>
      {/* Key list */}
      <div className="w-56 flex-shrink-0 border-r border-gray-200 dark:border-gray-700 pr-3 overflow-y-auto max-h-[calc(100vh-350px)]">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-gray-500">Click a key to edit</p>
          <span className="text-xs text-gray-400">{activeFieldOrder.filter(k => !k.startsWith('__grp::')).length} keys</span>
        </div>

        {/* Add Key Button + Add Group Button + Bulk Paste */}
        {!showAddForm && !showAddGroupForm && (
          <div className="flex flex-col gap-1 mb-2">
            <div className="flex gap-1">
              <button onClick={() => setShowAddForm(true)} className={`${btnSecondary} flex-1 text-xs`}>+ Add Key</button>
              <button onClick={() => setShowAddGroupForm(true)} className={`${btnSecondary} flex-1 text-xs`}>+ Add Group</button>
            </div>
            <button onClick={() => setBulkOpen(true)} className={`${btnSecondary} w-full text-xs`}>Bulk Paste</button>
          </div>
        )}

        {/* Add Key Inline Form */}
        {showAddForm && (
          <div className="mb-3 p-2 border border-blue-300 dark:border-blue-700 rounded bg-blue-50 dark:bg-blue-900/20 space-y-1.5">
            <input
              autoFocus
              className={`${inputCls} w-full text-xs`}
              placeholder="new_field_key"
              value={addKeyValue}
              onChange={(e) => setAddKeyValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddKey(); if (e.key === 'Escape') { setShowAddForm(false); setAddKeyValue(''); } }}
            />
            {addKeyValue && validateNewKeyTs(addKeyValue.trim(), activeFieldOrder) && (
              <p className="text-[10px] text-red-500">{validateNewKeyTs(addKeyValue.trim(), activeFieldOrder)}</p>
            )}
            <select className={`${selectCls} w-full text-xs`} value={addKeyGroup} onChange={(e) => setAddKeyGroup(e.target.value)}>
              <option value="">Group: ungrouped</option>
              {existingGroups.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <div className="flex gap-1">
              <button
                onClick={handleAddKey}
                disabled={!!validateNewKeyTs(addKeyValue.trim(), activeFieldOrder)}
                className={`${btnPrimary} text-xs py-1 flex-1`}
              >Create</button>
              <button onClick={() => { setShowAddForm(false); setAddKeyValue(''); }} className={`${btnSecondary} text-xs py-1 flex-1`}>Cancel</button>
            </div>
          </div>
        )}

        {/* Add Group Inline Form */}
        {showAddGroupForm && (
          <div className="mb-3 p-2 border border-green-300 dark:border-green-700 rounded bg-green-50 dark:bg-green-900/20 space-y-1.5">
            <input
              autoFocus
              className={`${inputCls} w-full text-xs`}
              placeholder="Group name"
              value={addGroupValue}
              onChange={(e) => setAddGroupValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddGroup(); if (e.key === 'Escape') { setShowAddGroupForm(false); setAddGroupValue(''); } }}
            />
            {addGroupValue && validateNewGroupTs(addGroupValue.trim(), existingGroups) && (
              <p className="text-[10px] text-red-500">{validateNewGroupTs(addGroupValue.trim(), existingGroups)}</p>
            )}
            <div className="flex gap-1">
              <button
                onClick={handleAddGroup}
                disabled={!!validateNewGroupTs(addGroupValue.trim(), existingGroups)}
                className={`${btnPrimary} text-xs py-1 flex-1`}
              >Create</button>
              <button onClick={() => { setShowAddGroupForm(false); setAddGroupValue(''); }} className={`${btnSecondary} text-xs py-1 flex-1`}>Cancel</button>
            </div>
          </div>
        )}

        <DraggableKeyList
          fieldOrder={activeFieldOrder}
          selectedKey={selectedKey}
          editedRules={editedRules}
          rules={editedRules}
          displayLabel={displayLabel}
          onSelectKey={handleSelectKey}
          onReorder={handleReorder}
          selectedGroup={selectedGroup}
          onSelectGroup={handleSelectGroup}
          onDeleteGroup={handleDeleteGroup}
          onRenameGroup={handleRenameGroup}
          existingGroups={existingGroups}
        />
      </div>

      {/* Key detail editor */}
      <div className="flex-1 overflow-y-auto max-h-[calc(100vh-350px)] pr-2">
        {selectedKey && currentRule ? (
          <div key={selectedKey} className="space-y-3">
            <div className="sticky top-0 bg-white dark:bg-gray-900 z-10 border-b border-gray-200 dark:border-gray-700 mb-1">
              {editingLabel ? (() => {
                const trimmedLabel = editLabelValue.trim();
                const otherLabels = activeFieldOrder
                  .filter(k => !k.startsWith('__grp::') && k !== selectedKey)
                  .map(k => displayLabel(k, editedRules[k]).toLowerCase());
                const labelDup = trimmedLabel && otherLabels.includes(trimmedLabel.toLowerCase())
                  ? 'A field with this label already exists'
                  : null;
                const labelDisabled = !trimmedLabel || !!labelDup;
                const commitLabel = () => {
                  if (labelDisabled) return;
                  updateField(selectedKey, 'ui.label', trimmedLabel);
                  setEditingLabel(false);
                };
                return <div className="flex flex-col justify-center gap-1 px-4 min-h-[44px]">
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      className={`${inputCls} text-lg font-semibold py-1 px-2 w-64`}
                      value={editLabelValue}
                      onChange={(e) => setEditLabelValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitLabel();
                        if (e.key === 'Escape') setEditingLabel(false);
                      }}
                    />
                    <button onClick={commitLabel} disabled={labelDisabled} className="px-3 py-1.5 text-xs font-medium bg-accent text-white rounded hover:bg-blue-600 disabled:opacity-50">Save</button>
                    <button onClick={() => setEditingLabel(false)} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Cancel</button>
                  </div>
                  {labelDup && <span className="text-[10px] text-red-500 pl-1">{labelDup}</span>}
                </div>;
              })() : renamingKey ? (() => {
                const renameErr = renameValue && renameValue.trim() !== selectedKey
                  ? validateNewKeyTs(renameValue.trim(), activeFieldOrder.filter((k) => k !== selectedKey))
                  : null;
                const renameDisabled = !renameValue.trim() || renameValue.trim() === selectedKey || !!renameErr;
                return <div className="flex flex-col justify-center gap-1 px-4 min-h-[44px]">
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      className={`${inputCls} text-sm font-mono py-1 px-2 w-52`}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !renameDisabled) handleRenameKey(); if (e.key === 'Escape') setRenamingKey(false); }}
                    />
                    {renameErr && <span className="text-[10px] text-red-500">{renameErr}</span>}
                    <button onClick={handleRenameKey} disabled={renameDisabled} className="px-3 py-1.5 text-xs font-medium bg-accent text-white rounded hover:bg-blue-600 disabled:opacity-50">Save</button>
                    <button onClick={() => setRenamingKey(false)} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Cancel</button>
                  </div>
                </div>;
              })() : (
                <div className="flex items-center gap-3 px-4 min-h-[44px]">
                  {/* Identity: label + key */}
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="text-lg font-semibold text-gray-900 dark:text-white truncate cursor-pointer hover:text-accent transition-colors leading-snug"
                      onClick={() => { setEditingLabel(true); setEditLabelValue(displayLabel(selectedKey, currentRule as Record<string, unknown>)); }}
                      title="Click to edit label"
                    >
                      {displayLabel(selectedKey, currentRule as Record<string, unknown>)}
                    </span>
                    <span
                      className="text-[10px] text-gray-400 cursor-pointer hover:text-accent transition-colors flex-shrink-0"
                      onClick={() => { setEditingLabel(true); setEditLabelValue(displayLabel(selectedKey, currentRule as Record<string, unknown>)); }}
                    >&#9998;</span>
                    <span className="text-gray-300 dark:text-gray-600 select-none text-lg leading-snug">|</span>
                    <span
                      className="text-sm text-gray-500 dark:text-gray-400 font-mono truncate cursor-pointer hover:text-accent transition-colors leading-snug"
                      onClick={() => { setRenamingKey(true); setRenameValue(selectedKey); }}
                      title="Click to rename key"
                    >
                      {selectedKey}
                    </span>
                    <span
                      className="text-[10px] text-gray-400 cursor-pointer hover:text-accent transition-colors flex-shrink-0"
                      onClick={() => { setRenamingKey(true); setRenameValue(selectedKey); }}
                    >&#9998;</span>
                    {Boolean(currentRule._edited) && (
                      <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 flex-shrink-0">Modified</span>
                    )}
                  </div>

                  <div className="flex-1" />

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={handleSaveAll}
                      disabled={saving || autoSaveEnabled}
                      className={`relative px-3 py-1.5 text-xs font-medium rounded border transition-colors ${
                        saving ? 'text-gray-400 border-gray-200 dark:border-gray-700' : 'text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'
                      } disabled:opacity-50`}
                    >
                      {saving ? 'Saving\u2026' : 'Save'}
                    </button>
                    <button
                      onClick={() => setAutoSaveEnabled(!autoSaveEnabled)}
                      className={`relative px-3 py-1.5 text-xs font-medium rounded border transition-colors overflow-visible ${
                        autoSaveEnabled
                          ? 'bg-accent/10 text-accent border-accent/40 shadow-inner dark:bg-accent/20 dark:border-accent/50'
                          : 'text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                    >
                      {autoSaveEnabled ? 'Auto-save On' : 'Auto-save Off'}
                      {saving && (
                        <span
                          className="absolute inline-block h-2 w-2 rounded-full bg-gray-400 animate-pulse border border-white/90 shadow-sm"
                          style={{ right: '2px', bottom: '2px' }}
                        />
                      )}
                      {!saving && saveSuccess && (
                        <span
                          className="absolute inline-block h-2 w-2 rounded-full bg-green-500 border border-white/90 shadow-sm"
                          style={{ right: '2px', bottom: '2px' }}
                        />
                      )}
                    </button>
                    {!confirmDelete ? (
                      <button
                        onClick={() => setConfirmDelete(true)}
                        className="px-3 py-1.5 text-xs font-medium text-red-600 rounded border border-red-300 dark:border-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                      >
                        Delete
                      </button>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <span className="text-xs text-red-500 font-medium">Delete?</span>
                        <button onClick={handleDeleteKey} className="px-2.5 py-1 text-xs font-medium bg-red-600 text-white rounded hover:bg-red-700">Yes</button>
                        <button onClick={() => setConfirmDelete(false)} className="px-2.5 py-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">No</button>
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* â"€â"€ Field Coupling Summary â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
            {(() => {
              const pt = strN(currentRule, 'parse.template', strN(currentRule, 'parse_template'));
              const es = strN(currentRule, 'enum.source', strN(currentRule, 'enum_source'));
              const ep = strN(currentRule, 'enum.policy', strN(currentRule, 'enum_policy', 'open'));
              const ct = strN(currentRule, 'component.type');
              const chipCls = 'px-2 py-0.5 text-[11px] rounded-full font-medium';
              const isComponent = pt === 'component_reference';
              const isBoolean = pt === 'boolean_yes_no_unk';
              const isNumeric = ['number_with_unit', 'list_of_numbers_with_unit', 'list_numbers_or_ranges_with_unit'].includes(pt);
              return (
                <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-xs">
                  <span className="text-gray-400 font-medium mr-1">Pipeline:</span>
                  <span className={`${chipCls} ${isComponent ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' : isBoolean ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' : isNumeric ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' : 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'}`}>
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

            {/* â"€â"€ Contract â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
            <Section title="Contract (Type, Shape, Unit)" titleTooltip={STUDIO_TIPS.key_section_contract}>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <div className={labelCls}>Data Type<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.data_type} /></div>
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
                  <div className={labelCls}>Shape<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.shape} /></div>
                  <select className={`${selectCls} w-full`} value={strN(currentRule, 'contract.shape', 'scalar')} onChange={(e) => updateField(selectedKey, 'contract.shape', e.target.value)}>
                    <option value="scalar">scalar</option>
                    <option value="list">list</option>
                    <option value="structured">structured</option>
                    <option value="key_value">key_value</option>
                  </select>
                </div>
                <div>
                  <div className={labelCls}>Unit<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.contract_unit} /></div>
                  <ComboSelect value={strN(currentRule, 'contract.unit')} onChange={(v) => updateField(selectedKey, 'contract.unit', v || null)} options={UNITS} placeholder="e.g. g, mm, Hz" />
                </div>
                <div>
                  <div className={labelCls}>Unknown Token<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.unknown_token} /></div>
                  <ComboSelect value={strN(currentRule, 'contract.unknown_token', 'unk')} onChange={(v) => updateField(selectedKey, 'contract.unknown_token', v)} options={UNKNOWN_TOKENS} placeholder="unk" />
                </div>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <div className={labelCls}>Rounding Decimals<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.rounding_decimals} /></div>
                  <input className={`${inputCls} w-full`} type="number" min={0} max={6} value={numN(currentRule, 'contract.rounding.decimals', 0)} onChange={(e) => updateField(selectedKey, 'contract.rounding.decimals', parseInt(e.target.value, 10) || 0)} />
                </div>
                <div>
                  <div className={labelCls}>Rounding Mode<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.rounding_mode} /></div>
                  <select className={`${selectCls} w-full`} value={strN(currentRule, 'contract.rounding.mode', 'nearest')} onChange={(e) => updateField(selectedKey, 'contract.rounding.mode', e.target.value)}>
                    <option value="nearest">nearest</option>
                    <option value="floor">floor</option>
                    <option value="ceil">ceil</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={boolN(currentRule, 'contract.unknown_reason_required', true)} onChange={(e) => updateField(selectedKey, 'contract.unknown_reason_required', e.target.checked)} className="rounded border-gray-300" />
                    <span className="text-xs text-gray-500">Require unknown reason<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.require_unknown_reason} /></span>
                  </label>
                </div>
              </div>
            </Section>

            {/* â"€â"€ Priority â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
            <Section title="Priority & Effort" titleTooltip={STUDIO_TIPS.key_section_priority}>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <div className={labelCls}>Required Level<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.required_level} /></div>
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
                  <div className={labelCls}>Availability<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.availability} /></div>
                  <select className={`${selectCls} w-full`} value={strN(currentRule, 'priority.availability', strN(currentRule, 'availability', 'expected'))} onChange={(e) => updateField(selectedKey, 'priority.availability', e.target.value)}>
                    <option value="always">always</option>
                    <option value="expected">expected</option>
                    <option value="sometimes">sometimes</option>
                    <option value="rare">rare</option>
                    <option value="editorial_only">editorial_only</option>
                  </select>
                </div>
                <div>
                  <div className={labelCls}>Difficulty<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.difficulty} /></div>
                  <select className={`${selectCls} w-full`} value={strN(currentRule, 'priority.difficulty', strN(currentRule, 'difficulty', 'easy'))} onChange={(e) => updateField(selectedKey, 'priority.difficulty', e.target.value)}>
                    <option value="easy">easy</option>
                    <option value="medium">medium</option>
                    <option value="hard">hard</option>
                    <option value="instrumented">instrumented</option>
                  </select>
                </div>
                <div>
                  <div className={labelCls}>Effort (1-10)<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.effort} /></div>
                  <input className={`${inputCls} w-full`} type="number" min={1} max={10} value={numN(currentRule, 'priority.effort', numN(currentRule, 'effort', 3))} onChange={(e) => updateField(selectedKey, 'priority.effort', parseInt(e.target.value, 10) || 1)} />
                </div>
              </div>
              <div className="flex gap-6">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={boolN(currentRule, 'priority.publish_gate', boolN(currentRule, 'publish_gate'))} onChange={(e) => updateField(selectedKey, 'priority.publish_gate', e.target.checked)} className="rounded border-gray-300" />
                  <span className="text-xs text-gray-500">Publish Gate<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.publish_gate} /></span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={boolN(currentRule, 'priority.block_publish_when_unk', boolN(currentRule, 'block_publish_when_unk'))} onChange={(e) => updateField(selectedKey, 'priority.block_publish_when_unk', e.target.checked)} className="rounded border-gray-300" />
                  <span className="text-xs text-gray-500">Block publish when unk<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.block_publish_when_unk} /></span>
                </label>
              </div>

              {/* AI Assist */}
              <h4 className="text-xs font-semibold text-gray-500 mt-4 mb-1">AI Assist<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.ai_mode} /></h4>
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

                // Resolve effective model â€" actual model names from env config
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
                        <div className={labelCls}>Mode<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.ai_mode} /></div>
                        <select className={`${selectCls} w-full`} value={explicitMode} onChange={(e) => updateField(selectedKey, 'ai_assist.mode', e.target.value || null)}>
                          <option value="">auto ({derivedMode})</option>
                          <option value="off">off &mdash; no LLM, deterministic only</option>
                          <option value="advisory">advisory &mdash; gpt-5-low, single pass</option>
                          <option value="planner">planner &mdash; gpt-5-low &rarr; gpt-5.2-high</option>
                          <option value="judge">judge &mdash; gpt-5.2-high, reasoning</option>
                        </select>
                      </div>
                      <div>
                        <div className={labelCls}>Model Strategy<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.ai_model_strategy} /></div>
                        <select className={`${selectCls} w-full`} value={strategy} onChange={(e) => updateField(selectedKey, 'ai_assist.model_strategy', e.target.value)}>
                          <option value="auto">auto &mdash; mode decides model</option>
                          <option value="force_fast">force_fast &mdash; always gpt-5-low</option>
                          <option value="force_deep">force_deep &mdash; always gpt-5.2-high</option>
                        </select>
                      </div>
                      <div>
                        <div className={labelCls}>Max Calls<Tip text={STUDIO_TIPS.ai_max_calls} style={{ position: 'relative', left: '-3px', top: '-4px' }} /></div>
                        <input className={`${inputCls} w-full`} type="number" min={1} max={10} value={explicitCalls || ''} onChange={(e) => updateField(selectedKey, 'ai_assist.max_calls', parseInt(e.target.value, 10) || null)} placeholder={`auto (${derivedCalls})`} />
                      </div>
                      <div>
                        <div className={labelCls}>Max Tokens<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.ai_max_tokens} /></div>
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
                      // â"€â"€ Auto-generate extraction guidance (mirrors backend autoGenerateExtractionGuidance) â"€â"€
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
                            <span className={labelCls.replace(' mb-1', '')}>Extraction Guidance (sent to LLM)<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.ai_reasoning_note} /></span>
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

            {/* â"€â"€ Parse â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
            <Section title="Parse Rules" titleTooltip={STUDIO_TIPS.key_section_parse}>
              {(() => {
                const pt = strN(currentRule, 'parse.template', strN(currentRule, 'parse_template'));
                const showUnits = pt === 'number_with_unit' || pt === 'list_of_numbers_with_unit' || pt === 'list_numbers_or_ranges_with_unit';
                return (
                  <>
                    <div className={showUnits ? 'grid grid-cols-4 gap-3' : ''}>
                      <div>
                        <div className={labelCls}>Parse Template<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.parse_template} /></div>
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
                            <div className={labelCls}>Parse Unit<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.parse_unit} /></div>
                            <ComboSelect value={strN(currentRule, 'parse.unit')} onChange={(v) => updateField(selectedKey, 'parse.unit', v)} options={UNITS} placeholder="e.g. g" />
                          </div>
                          <div className="col-span-2">
                            <div className={labelCls}>Unit Accepts<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.unit_accepts} /></div>
                            <TagPicker values={arrN(currentRule, 'parse.unit_accepts')} onChange={(v) => updateField(selectedKey, 'parse.unit_accepts', v)} suggestions={UNIT_ACCEPTS_SUGGESTIONS} placeholder="g, grams..." />
                          </div>
                        </>
                      ) : null}
                    </div>
                    {showUnits ? (
                      <div className="flex gap-6 flex-wrap">
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input type="checkbox" checked={boolN(currentRule, 'parse.allow_unitless')} onChange={(e) => updateField(selectedKey, 'parse.allow_unitless', e.target.checked)} className="rounded border-gray-300" />
                          <span className="text-xs text-gray-500">Allow unitless<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.allow_unitless} /></span>
                        </label>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input type="checkbox" checked={boolN(currentRule, 'parse.allow_ranges')} onChange={(e) => updateField(selectedKey, 'parse.allow_ranges', e.target.checked)} className="rounded border-gray-300" />
                          <span className="text-xs text-gray-500">Allow ranges<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.allow_ranges} /></span>
                        </label>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input type="checkbox" checked={boolN(currentRule, 'parse.strict_unit_required')} onChange={(e) => updateField(selectedKey, 'parse.strict_unit_required', e.target.checked)} className="rounded border-gray-300" />
                          <span className="text-xs text-gray-500">Strict unit required<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.strict_unit_required} /></span>
                        </label>
                      </div>
                    ) : null}
                    {!showUnits && pt ? (
                      <div className="text-xs text-gray-400 italic mt-1">
                        Unit settings hidden â€" {pt === 'boolean_yes_no_unk' ? 'boolean' : pt === 'component_reference' ? 'component reference' : pt.replace(/_/g, ' ')} template does not use units.
                      </div>
                    ) : null}
                  </>
                );
              })()}
            </Section>

            {/* â"€â"€ Enum â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
            <Section title="Enum Policy" titleTooltip={STUDIO_TIPS.key_section_enum}>
              <EnumConfigurator
                fieldKey={selectedKey}
                rule={currentRule}
                knownValues={knownValues}
                enumLists={enumLists}
                parseTemplate={strN(currentRule, 'parse.template', strN(currentRule, 'parse_template'))}
                onUpdate={(path, value) => updateField(selectedKey, path, value)}
              />
            </Section>


            {/* Components - Component DB & Match Settings */}
            <Section title="Components" titleTooltip={STUDIO_TIPS.key_section_components}>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <div className={labelCls}>Component DB<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.component_db} /></div>
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
                        // Cascade: Component DB â†' Parse Template + Enum + UI
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
              {strN(currentRule, 'component.type') ? (() => {
                const compType = strN(currentRule, 'component.type');
                const compSource = componentSources.find(
                  s => (s.component_type || s.type) === compType
                );
                const NUMERIC_ONLY_POLICIES = ['upper_bound', 'lower_bound', 'range'];
                const derivedProps = (compSource?.roles?.properties || []).filter(p => p.field_key);
                return (
                  <>
                    {/* â"€â"€ Match Settings â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
                    <div className="mt-3 border-t border-gray-200 dark:border-gray-700 pt-3">
                      <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">Match Settings</div>
                      {/* Name Matching */}
                      <div className="text-[11px] font-medium text-gray-400 mb-1">Name Matching</div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className={labelCls}>Fuzzy Threshold<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.comp_match_fuzzy_threshold} /></div>
                          <input type="number" min={0} max={1} step={0.05}
                            className={`${selectCls} w-full`}
                            value={numN(currentRule, 'component.match.fuzzy_threshold', 0.75)}
                            onChange={(e) => updateField(selectedKey, 'component.match.fuzzy_threshold', parseFloat(e.target.value) || 0.75)}
                          />
                        </div>
                        <div>
                          <div className={labelCls}>Name Weight<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.comp_match_name_weight} /></div>
                          <input type="number" min={0} max={1} step={0.05}
                            className={`${selectCls} w-full`}
                            value={numN(currentRule, 'component.match.name_weight', 0.4)}
                            onChange={(e) => updateField(selectedKey, 'component.match.name_weight', parseFloat(e.target.value) || 0.4)}
                          />
                        </div>
                        <div>
                          <div className={labelCls}>Auto-Accept Score<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.comp_match_auto_accept_score} /></div>
                          <input type="number" min={0} max={1} step={0.05}
                            className={`${selectCls} w-full`}
                            value={numN(currentRule, 'component.match.auto_accept_score', 0.95)}
                            onChange={(e) => updateField(selectedKey, 'component.match.auto_accept_score', parseFloat(e.target.value) || 0.95)}
                          />
                        </div>
                        <div>
                          <div className={labelCls}>Flag Review Score<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.comp_match_flag_review_score} /></div>
                          <input type="number" min={0} max={1} step={0.05}
                            className={`${selectCls} w-full`}
                            value={numN(currentRule, 'component.match.flag_review_score', 0.65)}
                            onChange={(e) => updateField(selectedKey, 'component.match.flag_review_score', parseFloat(e.target.value) || 0.65)}
                          />
                        </div>
                      </div>
                      {/* Property Matching */}
                      <div className="text-[11px] font-medium text-gray-400 mb-1 mt-3">Property Matching</div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className={labelCls}>Property Weight<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.comp_match_property_weight} /></div>
                          <input type="number" min={0} max={1} step={0.05}
                            className={`${selectCls} w-full`}
                            value={numN(currentRule, 'component.match.property_weight', 0.6)}
                            onChange={(e) => updateField(selectedKey, 'component.match.property_weight', parseFloat(e.target.value) || 0.6)}
                          />
                        </div>
                        <div className="col-span-2">
                          <div className={labelCls}>Property Keys<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.comp_match_property_keys} /></div>
                          <div className="space-y-1.5">
                            {derivedProps.map(p => {
                              const raw = p.variance_policy || 'authoritative';
                              const fieldRule = editedRules[p.field_key || ''] as Record<string, unknown> | undefined;
                              const contractType = fieldRule ? strN(fieldRule, 'contract.type') : '';
                              const parseTemplate = fieldRule ? strN(fieldRule, 'parse.template') : '';
                              const enumSrc = fieldRule ? strN(fieldRule, 'enum.source') : '';
                              const isBool = contractType === 'boolean';
                              const hasEnum = !!enumSrc;
                              const isComponentDb = hasEnum && enumSrc.startsWith('component_db');
                              const isExtEnum = hasEnum && !isComponentDb;
                              const isLocked = contractType !== 'number' || isBool || hasEnum;
                              const vp = isLocked && NUMERIC_ONLY_POLICIES.includes(raw) ? 'authoritative' : raw;
                              const fieldValues = knownValues[p.field_key || ''] || [];
                              const lockReason = isBool
                                ? 'Boolean field â€" variance locked to authoritative'
                                : isComponentDb
                                  ? `enum.db (${enumSrc.replace(/^component_db\./, '')}) â€" variance locked to authoritative`
                                  : isExtEnum
                                    ? `Enum (${enumSrc.replace(/^(known_values|data_lists)\./, '')}) â€" variance locked to authoritative`
                                    : contractType !== 'number' && fieldValues.length > 0
                                      ? `Manual values (${fieldValues.length}) â€" variance locked to authoritative`
                                      : isLocked
                                        ? 'String property â€" variance locked to authoritative'
                                        : '';
                              return (
                                <div key={p.field_key} className="flex items-start gap-2 px-2 py-1 rounded bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                                  <span className="text-[11px] font-medium text-blue-700 dark:text-blue-300 shrink-0">{p.field_key}</span>
                                  <span
                                    className={`text-[9px] px-1 rounded shrink-0 ${vp === 'override_allowed' ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300' : isLocked ? 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500' : 'bg-blue-100 text-blue-600 dark:bg-blue-800 dark:text-blue-300'}`}
                                    title={lockReason || (vp === 'override_allowed' ? 'Products can override this value without triggering review' : `Variance policy: ${vp}`)}
                                  >{vp === 'override_allowed' ? 'override' : vp}</span>
                                  {parseTemplate ? <span className="text-[9px] px-1 rounded bg-gray-50 text-gray-400 dark:bg-gray-800 dark:text-gray-500 shrink-0">{parseTemplate}</span> : null}
                                  {isBool ? (
                                    <span className="text-[9px] px-1 rounded bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400 shrink-0">boolean: yes / no</span>
                                  ) : null}
                                  {isComponentDb ? (
                                    <span className="text-[9px] px-1 rounded bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400 shrink-0 truncate max-w-[140px]" title={enumSrc}>enum.db: {enumSrc.replace(/^component_db\./, '')}</span>
                                  ) : null}
                                  {isExtEnum ? (
                                    <span className="text-[9px] px-1 rounded bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400 shrink-0 truncate max-w-[140px]" title={enumSrc}>enum: {enumSrc.replace(/^(known_values|data_lists)\./, '')}</span>
                                  ) : null}
                                  {!isBool && !hasEnum && isLocked && fieldValues.length > 0 && fieldValues.length <= 8 ? (
                                    <div className="flex flex-wrap gap-0.5">
                                      <span className="text-[9px] text-gray-400 mr-0.5">manual:</span>
                                      {fieldValues.map(v => (
                                        <span key={v} className="text-[9px] px-1 rounded bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400">{v}</span>
                                      ))}
                                    </div>
                                  ) : null}
                                  {!isBool && !hasEnum && isLocked && fieldValues.length > 8 ? (
                                    <span className="text-[9px] text-gray-400" title={fieldValues.join(', ')}>manual: {fieldValues.length} values</span>
                                  ) : null}
                                </div>
                              );
                            })}
                            {derivedProps.length === 0 ? (
                              <span className="text-xs text-gray-400 italic">No properties mapped â€" add in Mapping Studio</span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                );
              })() : null}
            </Section>

            <Section title="Cross-Field Constraints" titleTooltip={STUDIO_TIPS.key_section_constraints}>
              <KeyConstraintEditor
                currentKey={selectedKey}
                constraints={arrN(currentRule, 'constraints')}
                onChange={(next) => updateField(selectedKey, 'constraints', next)}
                fieldOrder={activeFieldOrder}
                rules={editedRules}
              />
            </Section>

            <Section title="Evidence Requirements" titleTooltip={STUDIO_TIPS.key_section_evidence}>
              <div className="grid grid-cols-3 gap-3 items-start">
                <div className="space-y-2">
                  <div>
                    <div className={labelCls}>Min Evidence Refs<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.min_evidence_refs} /></div>
                    <input className={`${inputCls} w-full`} type="number" min={0} max={10} value={numN(currentRule, 'evidence.min_evidence_refs', numN(currentRule, 'min_evidence_refs', 1))} onChange={(e) => updateField(selectedKey, 'evidence.min_evidence_refs', parseInt(e.target.value, 10) || 0)} />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={boolN(currentRule, 'evidence.required', boolN(currentRule, 'evidence_required', true))} onChange={(e) => updateField(selectedKey, 'evidence.required', e.target.checked)} className="rounded border-gray-300" />
                    <span className="text-xs text-gray-500">Evidence required<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.evidence_required} /></span>
                  </label>
                </div>
                <div>
                  <div className={labelCls}>Conflict Policy<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.conflict_policy} /></div>
                  <select className={`${selectCls} w-full`} value={strN(currentRule, 'evidence.conflict_policy', 'resolve_by_tier_else_unknown')} onChange={(e) => updateField(selectedKey, 'evidence.conflict_policy', e.target.value)}>
                    <option value="resolve_by_tier_else_unknown">resolve_by_tier_else_unknown</option>
                    <option value="prefer_highest_tier">prefer_highest_tier</option>
                    <option value="prefer_most_recent">prefer_most_recent</option>
                    <option value="flag_for_review">flag_for_review</option>
                  </select>
                </div>
                <div>
                  <div className={labelCls}>Tier Preference<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.tier_preference} /></div>
                  <TierPicker
                    value={arrN(currentRule, 'evidence.tier_preference').length > 0 ? arrN(currentRule, 'evidence.tier_preference') : ['tier1', 'tier2', 'tier3']}
                    onChange={(v) => updateField(selectedKey, 'evidence.tier_preference', v)}
                  />
                </div>
              </div>
            </Section>

            {/* â"€â"€ Extraction Hints & Aliases â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
            <Section title="Extraction Hints & Aliases" titleTooltip={STUDIO_TIPS.key_section_ui}>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className={labelCls}>Input Control<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.input_control} /></div>
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
              </div>
              <div>
                <div className={labelCls}>Tooltip / Guidance<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.tooltip_guidance} /></div>
                <textarea className={`${inputCls} w-full`} rows={2} value={strN(currentRule, 'ui.tooltip_md')} onChange={(e) => updateField(selectedKey, 'ui.tooltip_md', e.target.value)} placeholder="Define how this field should be interpreted..." />
              </div>
              <div>
                <div className={labelCls}>Aliases<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.aliases} /></div>
                <TagPicker values={arrN(currentRule, 'aliases')} onChange={(v) => updateField(selectedKey, 'aliases', v)} placeholder="alternative names for this key" />
              </div>
            </Section>

            {/* â"€â"€ Search Hints â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
            <Section title="Search Hints" titleTooltip={STUDIO_TIPS.key_section_search}>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className={labelCls}>Domain Hints<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.domain_hints} /></div>
                  <TagPicker values={arrN(currentRule, 'search_hints.domain_hints')} onChange={(v) => updateField(selectedKey, 'search_hints.domain_hints', v)} suggestions={DOMAIN_HINT_SUGGESTIONS} placeholder="manufacturer, rtings.com..." />
                </div>
                <div>
                  <div className={labelCls}>Content Types<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.content_types} /></div>
                  <TagPicker values={arrN(currentRule, 'search_hints.preferred_content_types')} onChange={(v) => updateField(selectedKey, 'search_hints.preferred_content_types', v)} suggestions={CONTENT_TYPE_SUGGESTIONS} placeholder="spec_sheet, datasheet..." />
                </div>
              </div>
              <div>
                <div className={labelCls}>Query Terms<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.query_terms} /></div>
                <TagPicker values={arrN(currentRule, 'search_hints.query_terms')} onChange={(v) => updateField(selectedKey, 'search_hints.query_terms', v)} placeholder="alternative search terms" />
              </div>
            </Section>

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

    {bulkOpen && (
      <div className="fixed inset-0 z-40 bg-black/45 p-4 flex items-start md:items-center justify-center">
        <div className="w-full max-w-5xl max-h-[92vh] overflow-hidden bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 shadow-2xl flex flex-col">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold">Bulk Paste Keys + Labels</h4>
              <p className="text-xs text-gray-500 mt-0.5">Paste two columns: <strong>Key</strong> and <strong>Label</strong> (tab-separated from Excel/Sheets).</p>
            </div>
            <button
              onClick={() => { setBulkOpen(false); setBulkGridRows([]); setBulkGroup(''); }}
                    className="text-gray-400 hover:text-gray-600 text-lg leading-snug"
              aria-label="Close bulk paste modal"
            >&times;</button>
          </div>

          <div className="p-4 space-y-3 overflow-auto">
            <div className="grid grid-cols-1 md:grid-cols-[260px,1fr] gap-3 items-end">
              <div>
                <label className={labelCls}>Group</label>
                <select
                  value={bulkGroup}
                  onChange={(e) => setBulkGroup(e.target.value)}
                  className={`${selectCls} w-full`}
                >
                  <option value="">ungrouped</option>
                  {existingGroups.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </div>
              <div className="text-xs text-gray-500">
                Type or paste two columns from a spreadsheet. Label is optional (auto-generated from key).
              </div>
            </div>

            <BulkPasteGrid
              col1Header="Key"
              col2Header="Label"
              col1Placeholder="sensor_dpi_max"
              col2Placeholder="Max DPI"
              rows={bulkGridRows}
              onChange={setBulkGridRows}
              col1Mono
            />

            <div className="flex flex-wrap gap-2 text-xs">
              <span className="px-2 py-1 rounded bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">Ready: {bulkCounts.ready}</span>
              <span className="px-2 py-1 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">Existing: {bulkCounts.existing}</span>
              <span className="px-2 py-1 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">Duplicates: {bulkCounts.duplicate}</span>
              <span className="px-2 py-1 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">Invalid: {bulkCounts.invalid}</span>
              <span className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">Rows: {bulkPreviewRows.length}</span>
            </div>

            {bulkPreviewRows.length > 0 && (
            <div className="border border-gray-200 dark:border-gray-700 rounded overflow-auto max-h-[24vh]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900/70 border-b border-gray-200 dark:border-gray-700">
                  <tr>
                    <th className="text-left px-2 py-1.5 w-12">#</th>
                    <th className="text-left px-2 py-1.5">Key</th>
                    <th className="text-left px-2 py-1.5">Label</th>
                    <th className="text-left px-2 py-1.5 w-36">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkPreviewRows.map((row) => {
                    const statusCls = row.status === 'ready'
                      ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
                      : row.status === 'duplicate_existing'
                        ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                        : row.status === 'duplicate_in_paste'
                          ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                          : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300';
                    return (
                      <tr key={`${row.rowNumber}-${row.key}-${row.raw}`} className="border-b border-gray-100 dark:border-gray-700/50">
                        <td className="px-2 py-1.5 text-gray-500">{row.rowNumber}</td>
                        <td className="px-2 py-1.5 font-mono">{row.key || <span className="italic text-gray-400">&mdash;</span>}</td>
                        <td className="px-2 py-1.5">{row.label || <span className="italic text-gray-400">&mdash;</span>}</td>
                        <td className="px-2 py-1.5">
                          <span className={`inline-block px-2 py-0.5 rounded-full ${statusCls}`}>{row.reason}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}
          </div>

          <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between gap-2">
            <div className="text-xs text-gray-500">
              Ready rows will be added to group <strong>{bulkGroup || 'ungrouped'}</strong>.
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setBulkOpen(false); setBulkGridRows([]); setBulkGroup(''); }}
                className={btnSecondary}
              >Close</button>
              <button
                onClick={handleBulkImport}
                disabled={bulkReadyRows.length === 0}
                className={btnPrimary}
              >
                {`Import ${bulkReadyRows.length} Ready Row${bulkReadyRows.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

// â"€â"€ Field Contract â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
function FieldContractTab({
  fieldRows,
  rules,
}: {
  fieldRows: FieldRuleRow[];
  rules: Record<string, Record<string, unknown>>;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">Field Contract Table<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.field_contract_table} /></h3>
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

// â"€â"€ Compile & Reports â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
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
        {compileMut.isSuccess ? <span className="text-sm text-green-600">Compile started â€" check Indexing Lab process output for logs</span> : null}
        {compileMut.isError ? <span className="text-sm text-red-600">{(compileMut.error as Error)?.message || 'Failed'}</span> : null}
        {validateRulesMut.isSuccess ? <span className="text-sm text-green-600">Validation started â€" check Indexing Lab process output</span> : null}
        {validateRulesMut.isError ? <span className="text-sm text-red-600">{(validateRulesMut.error as Error)?.message || 'Validation failed'}</span> : null}
      </div>

      {/* Errors */}
      {compileErrors.length > 0 ? (
        <div className={`${sectionCls} border-red-200 dark:border-red-700`}>
          <h4 className="text-sm font-semibold text-red-600 mb-2">Compile Errors ({compileErrors.length})<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.compile_errors} /></h4>
          <ul className="text-sm space-y-1">
            {compileErrors.map((e, i) => <li key={i} className="text-red-600">{e}</li>)}
          </ul>
        </div>
      ) : null}

      {/* Warnings */}
      {compileWarnings.length > 0 ? (
        <div className={`${sectionCls} border-yellow-200 dark:border-yellow-700`}>
          <h4 className="text-sm font-semibold text-yellow-600 mb-2">Compile Warnings ({compileWarnings.length})<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.compile_warnings} /></h4>
          <ul className="text-sm space-y-1">
            {compileWarnings.map((w, i) => <li key={i} className="text-yellow-600">{w}</li>)}
          </ul>
        </div>
      ) : null}

      {/* Generated Artifacts */}
      {artifacts.length > 0 ? (
        <div className={sectionCls}>
          <h4 className="text-sm font-semibold mb-2">Generated Artifacts ({artifacts.length} files)<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.generated_artifacts} /></h4>
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
          <h4 className="text-sm font-semibold mb-2">Guardrails Report<Tip style={{ position: 'relative', left: '-3px', top: '-4px' }} text={STUDIO_TIPS.guardrails_report} /></h4>
          <JsonViewer data={guardrails} />
        </div>
      ) : null}
    </div>
  );
}




