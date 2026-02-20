import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useUiStore } from '../../stores/uiStore';
import { Spinner } from '../../components/common/Spinner';
import type { LlmRouteResponse, LlmRouteRow, LlmScope } from '../../types/llmSettings';

const scopes: Array<{ key: LlmScope; label: string }> = [
  { key: 'field', label: 'Field Keys' },
  { key: 'component', label: 'Component Review' },
  { key: 'list', label: 'List Review' }
];

const REQUIRED_LEVEL_RANK: Record<string, number> = {
  identity: 7,
  critical: 6,
  required: 5,
  expected: 4,
  optional: 3,
  editorial: 2,
  commerce: 1
};

const DIFFICULTY_RANK: Record<string, number> = {
  instrumented: 4,
  hard: 3,
  medium: 2,
  easy: 1
};

const AVAILABILITY_RANK: Record<string, number> = {
  always: 5,
  expected: 4,
  sometimes: 3,
  rare: 2,
  editorial_only: 1
};

type SortBy = 'route_key' | 'required_level' | 'difficulty' | 'availability' | 'effort';

const inputCls = 'px-2 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700';
const selectCls = inputCls;
const cardCls = 'bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4';

const PROMPT_FLAG_FIELDS: Array<keyof LlmRouteRow> = [
  'studio_key_navigation_sent_in_extract_review',
  'studio_contract_rules_sent_in_extract_review',
  'studio_extraction_guidance_sent_in_extract_review',
  'studio_tooltip_or_description_sent_when_present',
  'studio_enum_options_sent_when_present',
  'studio_component_variance_constraints_sent_in_component_review',
  'studio_parse_template_sent_direct_in_extract_review',
  'studio_ai_mode_difficulty_effort_sent_direct_in_extract_review',
  'studio_required_level_sent_in_extract_review',
  'studio_component_entity_set_sent_when_component_field',
  'studio_evidence_policy_sent_direct_in_extract_review',
  'studio_variance_policy_sent_in_component_review',
  'studio_constraints_sent_in_component_review',
  'studio_send_booleans_prompted_to_model'
];

function toEffortBand(effort: number) {
  const n = Math.max(1, Math.min(10, effort || 3));
  if (n <= 3) return '1-3';
  if (n <= 6) return '4-6';
  if (n <= 8) return '7-8';
  return '9-10';
}

function applyContextPack(row: LlmRouteRow, pack: 'minimal' | 'standard' | 'full') {
  const next = { ...row };
  if (pack === 'minimal') {
    for (const key of PROMPT_FLAG_FIELDS) next[key] = false as never;
    next.studio_key_navigation_sent_in_extract_review = true;
    next.studio_contract_rules_sent_in_extract_review = true;
    next.studio_parse_template_sent_direct_in_extract_review = true;
    next.studio_required_level_sent_in_extract_review = true;
    next.studio_evidence_policy_sent_direct_in_extract_review = true;
    next.studio_send_booleans_prompted_to_model = false;
    return next;
  }
  if (pack === 'full') {
    for (const key of PROMPT_FLAG_FIELDS) next[key] = true as never;
    next.studio_send_booleans_prompted_to_model = false;
    return next;
  }
  for (const key of PROMPT_FLAG_FIELDS) next[key] = true as never;
  next.studio_component_variance_constraints_sent_in_component_review = row.scope === 'component';
  next.studio_variance_policy_sent_in_component_review = row.scope === 'component';
  next.studio_constraints_sent_in_component_review = row.scope === 'component';
  next.studio_component_entity_set_sent_when_component_field = row.scope === 'component';
  next.studio_send_booleans_prompted_to_model = false;
  return next;
}

function routeTone(row: LlmRouteRow): string {
  if (row.required_level === 'identity' || row.required_level === 'critical' || row.required_level === 'required') {
    return 'border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-800';
  }
  if (row.difficulty === 'hard' || row.effort >= 7) {
    return 'border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800';
  }
  return 'border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800';
}

function routeSummary(row: LlmRouteRow) {
  return `${row.required_level} | ${row.difficulty} | ${row.availability} | effort ${row.effort}`;
}

function prettyToken(value: string) {
  return String(value || '')
    .replace(/_/g, ' ')
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function presetDisplayName(row: LlmRouteRow) {
  const required = prettyToken(row.required_level);
  const difficulty = prettyToken(row.difficulty);
  const availability = prettyToken(row.availability);
  return `${required} | ${difficulty} | ${availability}`;
}

function rowDefaultsComparable(row: LlmRouteRow) {
  return {
    scope: row.scope,
    required_level: row.required_level,
    difficulty: row.difficulty,
    availability: row.availability,
    effort: row.effort,
    effort_band: row.effort_band,
    single_source_data: row.single_source_data,
    all_source_data: row.all_source_data,
    enable_websearch: row.enable_websearch,
    model_ladder_today: row.model_ladder_today,
    all_sources_confidence_repatch: row.all_sources_confidence_repatch,
    max_tokens: row.max_tokens,
    studio_key_navigation_sent_in_extract_review: row.studio_key_navigation_sent_in_extract_review,
    studio_contract_rules_sent_in_extract_review: row.studio_contract_rules_sent_in_extract_review,
    studio_extraction_guidance_sent_in_extract_review: row.studio_extraction_guidance_sent_in_extract_review,
    studio_tooltip_or_description_sent_when_present: row.studio_tooltip_or_description_sent_when_present,
    studio_enum_options_sent_when_present: row.studio_enum_options_sent_when_present,
    studio_component_variance_constraints_sent_in_component_review: row.studio_component_variance_constraints_sent_in_component_review,
    studio_parse_template_sent_direct_in_extract_review: row.studio_parse_template_sent_direct_in_extract_review,
    studio_ai_mode_difficulty_effort_sent_direct_in_extract_review: row.studio_ai_mode_difficulty_effort_sent_direct_in_extract_review,
    studio_required_level_sent_in_extract_review: row.studio_required_level_sent_in_extract_review,
    studio_component_entity_set_sent_when_component_field: row.studio_component_entity_set_sent_when_component_field,
    studio_evidence_policy_sent_direct_in_extract_review: row.studio_evidence_policy_sent_direct_in_extract_review,
    studio_variance_policy_sent_in_component_review: row.studio_variance_policy_sent_in_component_review,
    studio_constraints_sent_in_component_review: row.studio_constraints_sent_in_component_review,
    studio_send_booleans_prompted_to_model: row.studio_send_booleans_prompted_to_model,
    scalar_linked_send: row.scalar_linked_send,
    component_values_send: row.component_values_send,
    list_values_send: row.list_values_send,
    llm_output_min_evidence_refs_required: row.llm_output_min_evidence_refs_required,
    insufficient_evidence_action: row.insufficient_evidence_action
  };
}

function applyRoutePreset(row: LlmRouteRow, preset: 'fast' | 'balanced' | 'deep') {
  if (preset === 'fast') {
    return {
      ...row,
      single_source_data: true,
      all_source_data: false,
      enable_websearch: false,
      all_sources_confidence_repatch: true,
      model_ladder_today: 'gpt-5-low -> gpt-5-medium',
      max_tokens: Math.max(2048, Math.min(6144, row.max_tokens)),
      llm_output_min_evidence_refs_required: 1,
    };
  }
  if (preset === 'deep') {
    return {
      ...row,
      single_source_data: true,
      all_source_data: true,
      enable_websearch: true,
      all_sources_confidence_repatch: true,
      model_ladder_today: 'gpt-5.2-high -> gpt-5.1-high',
      max_tokens: Math.max(12288, row.max_tokens),
      llm_output_min_evidence_refs_required: Math.max(2, row.llm_output_min_evidence_refs_required),
    };
  }
  return {
    ...row,
    single_source_data: true,
    all_source_data: row.required_level === 'required' || row.required_level === 'critical' || row.difficulty === 'hard',
    enable_websearch: row.availability === 'rare' || row.difficulty === 'hard' || row.required_level === 'critical' || row.required_level === 'identity',
    all_sources_confidence_repatch: true,
    model_ladder_today: row.model_ladder_today || 'gpt-5-medium -> gpt-5.1-medium',
    max_tokens: Math.max(4096, Math.min(8192, row.max_tokens)),
  };
}

function flagLabel(key: keyof LlmRouteRow): string {
  return String(key)
    .replace(/^studio_/, '')
    .replace(/_sent_/, ' ')
    .replace(/_in_/, ' in ')
    .replace(/_when_/, ' when ')
    .replace(/_/g, ' ');
}

function rankForSort(row: LlmRouteRow, sortBy: SortBy): number | string {
  if (sortBy === 'effort') return row.effort;
  if (sortBy === 'required_level') return REQUIRED_LEVEL_RANK[row.required_level] || 0;
  if (sortBy === 'difficulty') return DIFFICULTY_RANK[row.difficulty] || 0;
  if (sortBy === 'availability') return AVAILABILITY_RANK[row.availability] || 0;
  return row.route_key;
}

function tagCls(kind: 'required' | 'difficulty' | 'availability' | 'effort', value: string) {
  if (kind === 'required') {
    if (['identity', 'critical', 'required'].includes(value)) return 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800';
    if (value === 'expected') return 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800';
    return 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600';
  }
  if (kind === 'difficulty') {
    if (value === 'hard' || value === 'instrumented') return 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800';
    if (value === 'medium') return 'bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-300 dark:border-cyan-800';
    return 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800';
  }
  if (kind === 'availability') {
    if (value === 'always' || value === 'expected') return 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800';
    if (value === 'sometimes') return 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-800';
    return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600';
  }
  return 'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-800';
}

export function LlmSettingsPage() {
  const category = useUiStore((s) => s.category);
  const isAll = category === 'all';
  const [activeScope, setActiveScope] = useState<LlmScope>('field');
  const [selectedRouteKey, setSelectedRouteKey] = useState('');
  const [rows, setRows] = useState<LlmRouteRow[]>([]);
  const [defaultRowsByKey, setDefaultRowsByKey] = useState<Record<string, LlmRouteRow>>({});
  const [dirty, setDirty] = useState(false);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);
  const [sortBy, setSortBy] = useState<SortBy>('effort');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [filterRequiredLevel, setFilterRequiredLevel] = useState('all');
  const [filterDifficulty, setFilterDifficulty] = useState('all');
  const [filterAvailability, setFilterAvailability] = useState('all');
  const [filterEffortBand, setFilterEffortBand] = useState('all');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const editVersionRef = useRef(0);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['llm-settings-routes', category],
    queryFn: () => api.get<LlmRouteResponse>(`/llm-settings/${category}/routes`),
    enabled: !isAll,
  });

  useEffect(() => {
    setDefaultRowsByKey({});
  }, [category]);

  useEffect(() => {
    if (!data?.rows) return;
    setRows(data.rows);
    setDirty(false);
    setDefaultRowsByKey((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      return Object.fromEntries((data.rows || []).map((row) => [row.route_key, row]));
    });
  }, [data]);

  const scopeRows = useMemo(
    () => rows.filter((row) => row.scope === activeScope),
    [rows, activeScope]
  );

  const scopeCounts = useMemo<Record<LlmScope, number>>(() => {
    const counts: Record<LlmScope, number> = { field: 0, component: 0, list: 0 };
    for (const row of rows) {
      counts[row.scope] = (counts[row.scope] || 0) + 1;
    }
    return counts;
  }, [rows]);

  useEffect(() => {
    setFilterRequiredLevel('all');
    setFilterDifficulty('all');
    setFilterAvailability('all');
    setFilterEffortBand('all');
  }, [activeScope]);

  const filterOptions = useMemo(() => ({
    required: [...new Set(scopeRows.map((row) => row.required_level).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    difficulty: [...new Set(scopeRows.map((row) => row.difficulty).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    availability: [...new Set(scopeRows.map((row) => row.availability).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    effortBand: [...new Set(scopeRows.map((row) => row.effort_band).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  }), [scopeRows]);

  const filteredScopeRows = useMemo(() => {
    return scopeRows.filter((row) => {
      if (filterRequiredLevel !== 'all' && row.required_level !== filterRequiredLevel) return false;
      if (filterDifficulty !== 'all' && row.difficulty !== filterDifficulty) return false;
      if (filterAvailability !== 'all' && row.availability !== filterAvailability) return false;
      if (filterEffortBand !== 'all' && row.effort_band !== filterEffortBand) return false;
      return true;
    });
  }, [scopeRows, filterRequiredLevel, filterDifficulty, filterAvailability, filterEffortBand]);

  const sortedScopeRows = useMemo(() => {
    const copy = [...filteredScopeRows];
    copy.sort((a, b) => {
      const av = rankForSort(a, sortBy);
      const bv = rankForSort(b, sortBy);
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [filteredScopeRows, sortBy, sortDir]);
  const userSetByRouteKey = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const row of rows) {
      const baseline = defaultRowsByKey[row.route_key];
      if (!baseline) {
        map[row.route_key] = false;
        continue;
      }
      map[row.route_key] = JSON.stringify(rowDefaultsComparable(row)) !== JSON.stringify(rowDefaultsComparable(baseline));
    }
    return map;
  }, [rows, defaultRowsByKey]);

  useEffect(() => {
    if (sortedScopeRows.length === 0) {
      setSelectedRouteKey('');
      return;
    }
    const hasSelected = sortedScopeRows.some((row) => row.route_key === selectedRouteKey);
    if (!hasSelected) {
      setSelectedRouteKey(sortedScopeRows[0].route_key);
    }
  }, [sortedScopeRows, selectedRouteKey]);

  const selectedRow = useMemo(
    () => sortedScopeRows.find((row) => row.route_key === selectedRouteKey) || null,
    [sortedScopeRows, selectedRouteKey]
  );
  const selectedIsUserSet = selectedRow ? Boolean(userSetByRouteKey[selectedRow.route_key]) : false;

  const saveMut = useMutation({
    mutationFn: (payload: { rows: LlmRouteRow[]; version: number }) =>
      api.put<LlmRouteResponse>(`/llm-settings/${category}/routes`, { rows: payload.rows }),
    onSuccess: (resp, payload) => {
      if (payload.version >= editVersionRef.current) {
        setRows(resp.rows || []);
        setDirty(false);
      }
      setLastSavedAt(new Date().toLocaleTimeString());
    }
  });

  const resetMut = useMutation({
    mutationFn: () => api.post<LlmRouteResponse>(`/llm-settings/${category}/routes/reset`),
    onSuccess: (resp) => {
      setRows(resp.rows || []);
      setDefaultRowsByKey(Object.fromEntries((resp.rows || []).map((row) => [row.route_key, row])));
      setDirty(false);
      editVersionRef.current += 1;
      setLastSavedAt(new Date().toLocaleTimeString());
    }
  });

  useEffect(() => {
    if (!autoSaveEnabled || !dirty || saveMut.isPending || resetMut.isPending) return;
    const timer = setTimeout(() => {
      saveMut.mutate({ rows, version: editVersionRef.current });
    }, 700);
    return () => clearTimeout(timer);
  }, [autoSaveEnabled, dirty, rows, saveMut, saveMut.isPending, resetMut.isPending]);

  function updateRow(routeKey: string, patch: Partial<LlmRouteRow>) {
    setRows((prev) => prev.map((row) => {
      if (row.route_key !== routeKey) return row;
      const merged = { ...row, ...patch };
      if (patch.effort !== undefined && patch.effort_band === undefined) {
        merged.effort_band = toEffortBand(merged.effort);
      }
      return merged;
    }));
    editVersionRef.current += 1;
    setDirty(true);
  }

  function updateSelected(patch: Partial<LlmRouteRow>) {
    if (!selectedRow) return;
    updateRow(selectedRow.route_key, patch);
  }

  if (isAll) {
    return <p className="text-gray-500 mt-8 text-center">Select a specific category to manage LLM settings.</p>;
  }

  if (isLoading && rows.length === 0) {
    return <Spinner className="h-6 w-6" />;
  }

  return (
    <div className="space-y-4">
      <div className={cardCls}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">LLM Settings Studio</h2>
            <p className="text-xs text-gray-500 mt-1">
              Route presets on the left, selected preset controls on the right.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              className="px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              Reload
            </button>
            <button
              onClick={() => resetMut.mutate()}
              disabled={resetMut.isPending}
              className="px-3 py-1.5 text-xs border border-amber-300 text-amber-700 rounded hover:bg-amber-50 disabled:opacity-50"
            >
              {resetMut.isPending ? 'Resetting...' : 'Reset Defaults'}
            </button>
            <button
              onClick={() => saveMut.mutate({ rows, version: editVersionRef.current })}
              disabled={!dirty || saveMut.isPending}
              className="px-3 py-1.5 text-xs bg-accent text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saveMut.isPending ? 'Saving...' : autoSaveEnabled ? 'Save Now' : 'Save LLM Settings'}
            </button>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <div className="text-[11px] text-gray-500">
            {dirty ? 'Unsaved changes.' : 'All changes saved.'}
            {lastSavedAt ? ` Last save: ${lastSavedAt}` : ''}
          </div>
          <label className="text-xs flex items-center gap-2">
            <input
              type="checkbox"
              checked={autoSaveEnabled}
              onChange={(e) => setAutoSaveEnabled(e.target.checked)}
            />
            <span>Auto Save</span>
          </label>
        </div>
      </div>

      <div className="flex border-b border-gray-200 dark:border-gray-700">
        {scopes.map((scope) => (
          <button
            key={scope.key}
            onClick={() => setActiveScope(scope.key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 ${
              activeScope === scope.key
                ? 'border-accent text-accent'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {scope.label} ({scopeCounts[scope.key] || 0})
          </button>
        ))}
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-4">
          <div className={`${cardCls} p-0 overflow-hidden`}>
            <div className="sticky top-0 z-20 bg-white dark:bg-gray-800 px-4 py-3 border-b border-gray-200 dark:border-gray-700 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold">Preset Buttons</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">Select a preset button, then tune it with Priority Mixer.</div>
                </div>
                <div className="text-right text-[10px] text-gray-500">
                  <div>
                    Showing {sortedScopeRows.length} / {scopeCounts[activeScope] || 0}
                  </div>
                  <div>Total loaded {scopeCounts[activeScope] || 0}</div>
                </div>
              </div>
              <div className="text-[10px] text-gray-500">
                Button imported from Field Rules {category} Contract
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] text-gray-500 mb-1">Sort By</div>
                  <select className={`${selectCls} w-full`} value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
                    <option value="effort">effort</option>
                    <option value="required_level">required_level</option>
                    <option value="difficulty">difficulty</option>
                    <option value="availability">availability</option>
                    <option value="route_key">route_key</option>
                  </select>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 mb-1">Direction</div>
                  <button
                    className="w-full px-2 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                    onClick={() => setSortDir((d) => d === 'asc' ? 'desc' : 'asc')}
                  >
                    {sortDir}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] text-gray-500 mb-1">Filter Required</div>
                  <select className={`${selectCls} w-full`} value={filterRequiredLevel} onChange={(e) => setFilterRequiredLevel(e.target.value)}>
                    <option value="all">all</option>
                    {filterOptions.required.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 mb-1">Filter Difficulty</div>
                  <select className={`${selectCls} w-full`} value={filterDifficulty} onChange={(e) => setFilterDifficulty(e.target.value)}>
                    <option value="all">all</option>
                    {filterOptions.difficulty.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 mb-1">Filter Availability</div>
                  <select className={`${selectCls} w-full`} value={filterAvailability} onChange={(e) => setFilterAvailability(e.target.value)}>
                    <option value="all">all</option>
                    {filterOptions.availability.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <div className="text-[10px] text-gray-500 mb-1">Filter Effort Band</div>
                  <select className={`${selectCls} w-full`} value={filterEffortBand} onChange={(e) => setFilterEffortBand(e.target.value)}>
                    <option value="all">all</option>
                    {filterOptions.effortBand.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div className="max-h-[calc(100vh-360px)] overflow-y-auto p-3 space-y-2">
              {sortedScopeRows.map((row) => (
                <button
                  key={row.route_key}
                  onClick={() => setSelectedRouteKey(row.route_key)}
                  className={`w-full text-left rounded border px-3 py-2 transition ${
                    row.route_key === selectedRouteKey
                      ? `ring-2 ring-accent ${routeTone(row)}`
                      : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-accent/50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs font-semibold">{presetDisplayName(row)}</div>
                    {userSetByRouteKey[row.route_key] ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-300">
                        User Set ✓
                      </span>
                    ) : null}
                  </div>
                  <div className="text-[11px] text-gray-500 mt-1">Effort band {row.effort_band}</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">{row.route_key}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${tagCls('required', row.required_level)}`}>
                      {row.required_level}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${tagCls('difficulty', row.difficulty)}`}>
                      {row.difficulty}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${tagCls('availability', row.availability)}`}>
                      {row.availability}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${tagCls('effort', String(row.effort))}`}>
                      effort {row.effort}
                    </span>
                  </div>
                </button>
              ))}

              {sortedScopeRows.length === 0 && (
                <div className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2">
                  <p className="text-xs text-gray-500">No routes match current filters.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="col-span-12 lg:col-span-8">
          {!selectedRow ? (
            <div className={cardCls}>
              <p className="text-xs text-gray-500">Select a preset button to edit its settings.</p>
            </div>
          ) : (
            <div className={`${cardCls} p-0 overflow-hidden`}>
              <div className="sticky top-0 z-20 bg-white dark:bg-gray-800 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <div className="text-sm font-semibold">Priority Mixer</div>
                    <div className="text-[11px] text-gray-500 mt-0.5">{presetDisplayName(selectedRow)}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{selectedRow.route_key}</div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${selectedIsUserSet ? 'border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-300' : 'border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300'}`}>
                      {selectedIsUserSet ? 'User Set ✓' : 'Default'}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${tagCls('required', selectedRow.required_level)}`}>
                      {selectedRow.required_level}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${tagCls('difficulty', selectedRow.difficulty)}`}>
                      {selectedRow.difficulty}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${tagCls('availability', selectedRow.availability)}`}>
                      {selectedRow.availability}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${tagCls('effort', String(selectedRow.effort))}`}>
                      effort {selectedRow.effort}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <div className="text-[11px] text-gray-500 mb-1">Required Level</div>
                    <select className={`${selectCls} w-full`} value={selectedRow.required_level} onChange={(e) => updateSelected({ required_level: e.target.value })}>
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
                    <div className="text-[11px] text-gray-500 mb-1">Availability</div>
                    <select className={`${selectCls} w-full`} value={selectedRow.availability} onChange={(e) => updateSelected({ availability: e.target.value })}>
                      <option value="always">always</option>
                      <option value="expected">expected</option>
                      <option value="sometimes">sometimes</option>
                      <option value="rare">rare</option>
                      <option value="editorial_only">editorial_only</option>
                    </select>
                  </div>
                  <div>
                    <div className="text-[11px] text-gray-500 mb-1">Difficulty</div>
                    <select className={`${selectCls} w-full`} value={selectedRow.difficulty} onChange={(e) => updateSelected({ difficulty: e.target.value })}>
                      <option value="easy">easy</option>
                      <option value="medium">medium</option>
                      <option value="hard">hard</option>
                      <option value="instrumented">instrumented</option>
                    </select>
                  </div>
                  <div>
                    <div className="text-[11px] text-gray-500 mb-1">Effort: {selectedRow.effort}</div>
                    <input
                      className="w-full"
                      type="range"
                      min={1}
                      max={10}
                      value={selectedRow.effort}
                      onChange={(e) => updateSelected({ effort: Math.max(1, Math.min(10, Number.parseInt(e.target.value, 10) || 1)) })}
                    />
                    <div className="text-[10px] text-gray-500 mt-1">Band: {selectedRow.effort_band}</div>
                  </div>
                </div>
              </div>

              <div className="max-h-[calc(100vh-360px)] overflow-y-auto p-4 space-y-4">
                <div className={cardCls}>
                  <div className="text-sm font-semibold mb-2">Source Package</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <label className="text-xs flex items-center gap-2">
                      <input type="checkbox" checked={selectedRow.single_source_data} onChange={(e) => updateSelected({ single_source_data: e.target.checked })} />
                      <span>Single Source Data</span>
                    </label>
                    <label className="text-xs flex items-center gap-2">
                      <input type="checkbox" checked={selectedRow.all_source_data} onChange={(e) => updateSelected({ all_source_data: e.target.checked })} />
                      <span>All Source Data</span>
                    </label>
                    <label className="text-xs flex items-center gap-2">
                      <input type="checkbox" checked={selectedRow.enable_websearch} onChange={(e) => updateSelected({ enable_websearch: e.target.checked })} />
                      <span>Enable Web Search</span>
                    </label>
                    <label className="text-xs flex items-center gap-2">
                      <input type="checkbox" checked={selectedRow.all_sources_confidence_repatch} onChange={(e) => updateSelected({ all_sources_confidence_repatch: e.target.checked })} />
                      <span>All Confidence Repatch</span>
                    </label>
                    <div>
                      <div className="text-[11px] text-gray-500 mb-1">Context Pack</div>
                      <select className={`${selectCls} w-full`} defaultValue="standard" onChange={(e) => updateSelected(applyContextPack(selectedRow, e.target.value as 'minimal' | 'standard' | 'full'))}>
                        <option value="standard">standard</option>
                        <option value="minimal">minimal</option>
                        <option value="full">full</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                    <div>
                      <div className="text-[11px] text-gray-500 mb-1">Scalar Send</div>
                      <select className={`${selectCls} w-full`} value={selectedRow.scalar_linked_send} onChange={(e) => updateSelected({ scalar_linked_send: e.target.value })}>
                        <option value="scalar value">scalar value</option>
                        <option value="scalar value + prime sources">scalar value + prime sources</option>
                      </select>
                    </div>
                    <div>
                      <div className="text-[11px] text-gray-500 mb-1">Component Send</div>
                      <select className={`${selectCls} w-full`} value={selectedRow.component_values_send} onChange={(e) => updateSelected({ component_values_send: e.target.value })}>
                        <option value="component values">component values</option>
                        <option value="component values + prime sources">component values + prime sources</option>
                      </select>
                    </div>
                    <div>
                      <div className="text-[11px] text-gray-500 mb-1">List Send</div>
                      <select className={`${selectCls} w-full`} value={selectedRow.list_values_send} onChange={(e) => updateSelected({ list_values_send: e.target.value })}>
                        <option value="list values">list values</option>
                        <option value="list values prime sources">list values prime sources</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className={cardCls}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-semibold">Model Deck</div>
                    <div className="flex items-center gap-2">
                      <button className="px-2 py-1 text-[11px] rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => updateSelected(applyRoutePreset(selectedRow, 'fast'))}>Fast</button>
                      <button className="px-2 py-1 text-[11px] rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => updateSelected(applyRoutePreset(selectedRow, 'balanced'))}>Balanced</button>
                      <button className="px-2 py-1 text-[11px] rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => updateSelected(applyRoutePreset(selectedRow, 'deep'))}>Deep</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <div className="text-[11px] text-gray-500 mb-1">Model Ladder (today)</div>
                      <input className={`${inputCls} w-full`} value={selectedRow.model_ladder_today} onChange={(e) => updateSelected({ model_ladder_today: e.target.value })} />
                    </div>
                    <div>
                      <div className="text-[11px] text-gray-500 mb-1">Max Tokens: {selectedRow.max_tokens}</div>
                      <input
                        className="w-full"
                        type="range"
                        min={1024}
                        max={32768}
                        step={256}
                        value={selectedRow.max_tokens}
                        onChange={(e) => updateSelected({ max_tokens: Math.max(256, Math.min(65536, Number.parseInt(e.target.value, 10) || 256)) })}
                      />
                    </div>
                  </div>
                </div>

                <div className={cardCls}>
                  <div className="text-sm font-semibold mb-2">Evidence Gate</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <div className="text-[11px] text-gray-500 mb-1">Min Evidence Refs: {selectedRow.llm_output_min_evidence_refs_required}</div>
                      <input
                        className="w-full"
                        type="range"
                        min={1}
                        max={5}
                        value={selectedRow.llm_output_min_evidence_refs_required}
                        onChange={(e) => updateSelected({ llm_output_min_evidence_refs_required: Math.max(1, Math.min(5, Number.parseInt(e.target.value, 10) || 1)) })}
                      />
                    </div>
                    <div>
                      <div className="text-[11px] text-gray-500 mb-1">Insufficient Evidence Action</div>
                      <select className={`${selectCls} w-full`} value={selectedRow.insufficient_evidence_action} onChange={(e) => updateSelected({ insufficient_evidence_action: e.target.value })}>
                        <option value="threshold_unmet">threshold_unmet</option>
                        <option value="return_unk">return_unk</option>
                        <option value="escalate">escalate</option>
                      </select>
                    </div>
                  </div>
                </div>

                <details className={cardCls}>
                  <summary className="cursor-pointer text-xs text-gray-500">Advanced Prompt Flags</summary>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
                    {PROMPT_FLAG_FIELDS.map((key) => (
                      <label key={key} className="text-xs flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={Boolean(selectedRow[key])}
                          onChange={(e) => updateSelected({ [key]: e.target.checked } as Partial<LlmRouteRow>)}
                        />
                        <span>{flagLabel(key)}</span>
                      </label>
                    ))}
                  </div>
                </details>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
