import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useUiStore } from '../../stores/uiStore';
import { useRuntimeStore } from '../../stores/runtimeStore';
import { useIndexLabStore } from '../../stores/indexlabStore';
import { Tip } from '../../components/common/Tip';
import type { ProcessStatus } from '../../types/events';
import type { CatalogRow } from '../../types/product';
import type { IndexLabEvent } from '../../stores/indexlabStore';

interface IndexLabRunSummary {
  run_id: string;
  category: string;
  product_id: string;
  status: string;
  started_at: string;
  ended_at: string;
}

interface IndexLabRunsResponse {
  root: string;
  runs: IndexLabRunSummary[];
}

interface IndexLabRunEventsResponse {
  run_id: string;
  count: number;
  events: IndexLabEvent[];
}

interface IndexLabNeedSetRow {
  field_key: string;
  required_level: string;
  confidence: number | null;
  best_tier_seen: number | null;
  refs_found: number;
  min_refs: number;
  reasons: string[];
  need_score: number;
}

interface IndexLabNeedSetSnapshot {
  ts: string;
  needset_size: number;
}

interface IndexLabNeedSetResponse {
  run_id: string;
  category?: string;
  product_id?: string;
  generated_at?: string;
  total_fields?: number;
  needset_size?: number;
  reason_counts?: Record<string, number>;
  required_level_counts?: Record<string, number>;
  needs?: IndexLabNeedSetRow[];
  snapshots?: IndexLabNeedSetSnapshot[];
}

interface IndexLabSearchProfileAlias {
  alias: string;
  source?: string;
  weight?: number;
}

interface IndexLabSearchProfileQueryRow {
  query: string;
  hint_source?: string;
  target_fields?: string[];
  doc_hint?: string;
  alias?: string;
  domain_hint?: string;
  result_count?: number;
  attempts?: number;
  providers?: string[];
}

interface IndexLabSearchProfileResponse {
  run_id: string;
  category?: string;
  product_id?: string;
  generated_at?: string;
  status?: string;
  focus_fields?: string[];
  identity_aliases?: IndexLabSearchProfileAlias[];
  query_rows?: IndexLabSearchProfileQueryRow[];
  selected_queries?: string[];
  selected_query_count?: number;
  query_stats?: Array<{
    query: string;
    attempts: number;
    result_count: number;
    providers?: string[];
  }>;
  negative_terms?: string[];
  field_target_queries?: Record<string, string[]>;
  doc_hint_queries?: Array<{
    doc_hint: string;
    queries: string[];
  }>;
  hint_source_counts?: Record<string, number>;
  key?: string;
  run_key?: string;
  latest_key?: string;
  llm_query_planning?: boolean;
  llm_query_model?: string;
  llm_serp_triage?: boolean;
  llm_serp_triage_model?: string;
  serp_explorer?: IndexLabSerpExplorerResponse;
}

interface IndexLabSerpCandidateRow {
  url: string;
  title?: string;
  snippet?: string;
  host?: string;
  tier?: number | null;
  tier_name?: string;
  doc_kind?: string;
  triage_score?: number;
  triage_reason?: string;
  decision?: string;
  reason_codes?: string[];
  providers?: string[];
}

interface IndexLabSerpQueryRow {
  query: string;
  hint_source?: string;
  target_fields?: string[];
  doc_hint?: string;
  domain_hint?: string;
  result_count?: number;
  attempts?: number;
  providers?: string[];
  candidate_count?: number;
  selected_count?: number;
  candidates?: IndexLabSerpCandidateRow[];
}

interface IndexLabSerpExplorerResponse {
  run_id?: string;
  generated_at?: string;
  provider?: string;
  llm_triage_enabled?: boolean;
  llm_triage_applied?: boolean;
  llm_triage_model?: string;
  query_count?: number;
  candidates_checked?: number;
  urls_triaged?: number;
  urls_selected?: number;
  urls_rejected?: number;
  dedupe_input?: number;
  dedupe_output?: number;
  duplicates_removed?: number;
  queries?: IndexLabSerpQueryRow[];
}

interface SearxngStatusResponse {
  container_name: string;
  compose_path: string;
  compose_file_exists: boolean;
  base_url: string;
  docker_available: boolean;
  container_found: boolean;
  running: boolean;
  status: string;
  ports: string;
  http_ready: boolean;
  http_status: number;
  can_start: boolean;
  needs_start: boolean;
  message: string;
  docker_error?: string;
  http_error?: string;
}

interface IndexingLlmConfigResponse {
  generated_at?: string;
  phase2?: {
    enabled_default?: boolean;
    model_default?: string;
  };
  phase3?: {
    enabled_default?: boolean;
    model_default?: string;
  };
  model_options?: string[];
  pricing_defaults?: {
    input_per_1m?: number;
    output_per_1m?: number;
    cached_input_per_1m?: number;
  };
  model_pricing?: Array<{
    model: string;
    provider?: string;
    input_per_1m?: number;
    output_per_1m?: number;
    cached_input_per_1m?: number;
  }>;
}

interface IndexingLlmMetricsRunRow {
  session_id: string;
  run_id?: string | null;
  is_session_fallback?: boolean;
  started_at?: string | null;
  last_call_at?: string | null;
  category?: string | null;
  product_id?: string | null;
  calls?: number;
  cost_usd?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  providers?: string[];
  models?: string[];
  reasons?: string[];
}

interface IndexingLlmMetricsResponse {
  generated_at?: string;
  period_days?: number;
  period?: string;
  total_calls?: number;
  total_cost_usd?: number;
  total_prompt_tokens?: number;
  total_completion_tokens?: number;
  avg_cost_per_product?: number;
  by_model?: Array<{
    provider?: string;
    model?: string;
    calls?: number;
    cost_usd?: number;
    avg_cost_per_call?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    products?: number;
  }>;
  by_run?: IndexingLlmMetricsRunRow[];
  budget?: {
    monthly_usd?: number;
    period_budget_usd?: number;
    exceeded?: boolean;
  };
}

type PanelKey = 'overview' | 'runtime' | 'picker' | 'searchProfile' | 'serpExplorer' | 'llmOutput' | 'llmMetrics' | 'eventStream' | 'needset';

const PANEL_KEYS: PanelKey[] = ['overview', 'runtime', 'picker', 'searchProfile', 'serpExplorer', 'llmOutput', 'llmMetrics', 'eventStream', 'needset'];

const DEFAULT_PANEL_COLLAPSED: Record<PanelKey, boolean> = {
  overview: false,
  runtime: false,
  picker: false,
  searchProfile: true,
  serpExplorer: false,
  llmOutput: false,
  llmMetrics: false,
  eventStream: false,
  needset: false
};

function normalizeToken(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function cleanVariant(value: string) {
  const text = String(value || '').trim();
  return text || '';
}

function displayVariant(value: string) {
  const cleaned = cleanVariant(value);
  return cleaned || '(base / no variant)';
}

function formatNumber(value: number, digits = 0) {
  if (!Number.isFinite(value)) return '0';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  const ms = Date.parse(String(value));
  if (!Number.isFinite(ms)) return String(value);
  return new Date(ms).toLocaleString();
}

function formatDuration(ms: number) {
  const safeMs = Math.max(0, Number.isFinite(ms) ? ms : 0);
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function needsetRequiredLevelWeight(level: string) {
  const token = normalizeToken(level);
  if (token === 'identity') return 5;
  if (token === 'critical') return 4;
  if (token === 'required') return 3;
  if (token === 'expected') return 2;
  return 1;
}

function needsetRequiredLevelBadge(level: string) {
  const token = normalizeToken(level);
  if (token === 'identity') return { short: 'I', cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' };
  if (token === 'critical') return { short: 'C', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' };
  if (token === 'required') return { short: 'R', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' };
  return { short: 'O', cls: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200' };
}

function needsetReasonBadge(reason: string) {
  const token = normalizeToken(reason);
  if (token === 'missing') return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300';
  if (token === 'tier_deficit') return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300';
  if (token === 'min_refs_fail') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
  if (token === 'conflict') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
  if (token === 'low_conf') return 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300';
  return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
}

function NeedsetSparkline({ values }: { values: number[] }) {
  const points = values.filter((v) => Number.isFinite(v));
  if (points.length === 0) {
    return <div className="text-xs text-gray-500 dark:text-gray-400">no snapshots yet</div>;
  }
  if (points.length === 1) {
    return <div className="text-xs text-gray-500 dark:text-gray-400">size {formatNumber(points[0] || 0)}</div>;
  }
  const width = 180;
  const height = 36;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = Math.max(1, max - min);
  const coords = points
    .map((value, idx) => {
      const x = (idx / Math.max(1, points.length - 1)) * width;
      const y = height - (((value - min) / range) * height);
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-9 w-44">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="text-blue-600 dark:text-blue-300"
        points={coords}
      />
    </svg>
  );
}

interface TimedIndexLabEvent {
  row: IndexLabEvent;
  tsMs: number;
  stage: string;
  event: string;
  productId: string;
}

function computeActivityStats(
  events: TimedIndexLabEvent[],
  nowMs: number,
  predicate: (event: TimedIndexLabEvent) => boolean
) {
  const oneMinuteMs = 60_000;
  const currentWindowMinutes = 2;
  const horizonMinutes = 10;
  let currentEvents = 0;
  const bucketCounts = new Array(horizonMinutes).fill(0);
  for (const event of events) {
    if (!predicate(event)) continue;
    const ageMs = nowMs - event.tsMs;
    if (ageMs < 0 || ageMs > horizonMinutes * oneMinuteMs) continue;
    if (ageMs <= currentWindowMinutes * oneMinuteMs) currentEvents += 1;
    const bucketIdx = Math.floor(ageMs / oneMinuteMs);
    if (bucketIdx >= 0 && bucketIdx < horizonMinutes) {
      bucketCounts[bucketIdx] += 1;
    }
  }
  const peak = Math.max(1, ...bucketCounts);
  return {
    currentPerMin: currentEvents / currentWindowMinutes,
    peakPerMin: peak
  };
}

function ActivityGauge({
  label,
  currentPerMin,
  peakPerMin,
  active,
  tooltip
}: {
  label: string;
  currentPerMin: number;
  peakPerMin: number;
  active: boolean;
  tooltip?: string;
}) {
  const pct = Math.max(0, Math.min(100, (currentPerMin / Math.max(1, peakPerMin)) * 100));
  const displayPct = active && pct <= 0 ? 2 : pct;
  return (
    <div className="min-w-[12rem] rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
      <div className="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400">
        <span className="inline-flex items-center">
          {label}
          {tooltip ? <Tip text={tooltip} /> : null}
        </span>
        <span className={active ? 'text-emerald-600 dark:text-emerald-300' : ''}>
          {formatNumber(currentPerMin, 1)}/min
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden">
        <div
          className={`h-full rounded ${active ? 'bg-emerald-500' : 'bg-gray-400'}`}
          style={{ width: `${displayPct}%` }}
        />
      </div>
    </div>
  );
}

export function IndexingPage() {
  const category = useUiStore((s) => s.category);
  const isAll = category === 'all';
  const clearProcessOutput = useRuntimeStore((s) => s.clearProcessOutput);
  const liveIndexLabByRun = useIndexLabStore((s) => s.byRun);
  const queryClient = useQueryClient();

  const [profile, setProfile] = useState<'fast' | 'standard' | 'thorough'>('fast');
  const [resumeMode, setResumeMode] = useState<'auto' | 'force_resume' | 'start_over'>('auto');
  const [resumeWindowHours, setResumeWindowHours] = useState('48');
  const [reextractAfterHours, setReextractAfterHours] = useState('24');
  const [reextractIndexed, setReextractIndexed] = useState(true);
  const [discoveryEnabled, setDiscoveryEnabled] = useState(true);
  const [searchProvider, setSearchProvider] = useState<'none' | 'google' | 'bing' | 'searxng' | 'duckduckgo' | 'dual'>('duckduckgo');
  const [phase2LlmEnabled, setPhase2LlmEnabled] = useState(true);
  const [phase2LlmModel, setPhase2LlmModel] = useState('gemini-2.5-flash-lite');
  const [phase3LlmTriageEnabled, setPhase3LlmTriageEnabled] = useState(true);
  const [phase3LlmModel, setPhase3LlmModel] = useState('gemini-2.5-flash-lite');
  const [llmKnobsInitialized, setLlmKnobsInitialized] = useState(false);
  const [singleBrand, setSingleBrand] = useState('');
  const [singleModel, setSingleModel] = useState('');
  const [singleProductId, setSingleProductId] = useState('');
  const [selectedIndexLabRunId, setSelectedIndexLabRunId] = useState('');
  const [needsetSortKey, setNeedsetSortKey] = useState<'need_score' | 'field_key' | 'required_level' | 'confidence' | 'best_tier_seen' | 'refs'>('need_score');
  const [needsetSortDir, setNeedsetSortDir] = useState<'asc' | 'desc'>('desc');
  const [activityNowMs, setActivityNowMs] = useState(() => Date.now());
  const [panelCollapsed, setPanelCollapsed] = useState<Record<PanelKey, boolean>>({ ...DEFAULT_PANEL_COLLAPSED });

  const { data: processStatus } = useQuery({
    queryKey: ['processStatus', 'indexing'],
    queryFn: () => api.get<ProcessStatus>('/process/status'),
    refetchInterval: 1500
  });

  const { data: searxngStatus, error: searxngStatusError } = useQuery({
    queryKey: ['searxng', 'status'],
    queryFn: () => api.get<SearxngStatusResponse>('/searxng/status'),
    refetchInterval: 2000,
    retry: 1
  });

  const searxngStatusErrorMessage = useMemo(() => {
    const message = String((searxngStatusError as Error)?.message || '').trim();
    if (!message) return '';
    if (message.toLowerCase().includes('failed to fetch')) return '';
    return message;
  }, [searxngStatusError]);

  const { data: indexingLlmConfig } = useQuery({
    queryKey: ['indexing', 'llm-config'],
    queryFn: () => api.get<IndexingLlmConfigResponse>('/indexing/llm-config'),
    refetchInterval: 15_000
  });

  const { data: indexingLlmMetrics } = useQuery({
    queryKey: ['indexing', 'llm-metrics', category],
    queryFn: () => {
      const qp = new URLSearchParams();
      qp.set('period', '1d');
      qp.set('runLimit', '240');
      if (!isAll && category) qp.set('category', category);
      return api.get<IndexingLlmMetricsResponse>(`/indexing/llm-metrics?${qp.toString()}`);
    },
    refetchInterval: 2_000
  });

  const { data: catalog = [] } = useQuery({
    queryKey: ['catalog', category, 'indexing'],
    queryFn: () => api.get<CatalogRow[]>(`/catalog/${category}`),
    enabled: !isAll,
    refetchInterval: 5000
  });

  const { data: indexlabRunsResp } = useQuery({
    queryKey: ['indexlab', 'runs'],
    queryFn: () => api.get<IndexLabRunsResponse>('/indexlab/runs?limit=80'),
    refetchInterval: 2000
  });

  const indexlabRuns = useMemo(() => {
    const rows = indexlabRunsResp?.runs || [];
    if (isAll) return rows;
    const categoryToken = normalizeToken(category);
    return rows.filter((row) => normalizeToken(row.category) === categoryToken);
  }, [indexlabRunsResp, isAll, category]);

  useEffect(() => {
    const newestRunId = indexlabRuns[0]?.run_id || '';
    const isProcessRunning = Boolean(processStatus?.running);
    if (!newestRunId) {
      if (selectedIndexLabRunId) setSelectedIndexLabRunId('');
      return;
    }
    if (isProcessRunning) {
      if (selectedIndexLabRunId !== newestRunId) {
        setSelectedIndexLabRunId(newestRunId);
      }
      return;
    }
    if (selectedIndexLabRunId && indexlabRuns.some((row) => row.run_id === selectedIndexLabRunId)) {
      return;
    }
    setSelectedIndexLabRunId(newestRunId);
  }, [indexlabRuns, selectedIndexLabRunId, processStatus?.running]);

  const { data: indexlabEventsResp } = useQuery({
    queryKey: ['indexlab', 'run', selectedIndexLabRunId, 'events'],
    queryFn: () =>
      api.get<IndexLabRunEventsResponse>(
        `/indexlab/run/${encodeURIComponent(selectedIndexLabRunId)}/events?limit=3000`
      ),
    enabled: Boolean(selectedIndexLabRunId),
    refetchInterval: 2000
  });

  const { data: indexlabNeedsetResp } = useQuery({
    queryKey: ['indexlab', 'run', selectedIndexLabRunId, 'needset'],
    queryFn: () =>
      api.get<IndexLabNeedSetResponse>(
        `/indexlab/run/${encodeURIComponent(selectedIndexLabRunId)}/needset`
      ),
    enabled: Boolean(selectedIndexLabRunId),
    refetchInterval: 2000
  });
  const { data: indexlabSearchProfileResp } = useQuery({
    queryKey: ['indexlab', 'run', selectedIndexLabRunId, 'search-profile'],
    queryFn: () =>
      api.get<IndexLabSearchProfileResponse>(
        `/indexlab/run/${encodeURIComponent(selectedIndexLabRunId)}/search-profile`
      ),
    enabled: Boolean(selectedIndexLabRunId),
    refetchInterval: 2000
  });
  const { data: indexlabSerpExplorerResp } = useQuery({
    queryKey: ['indexlab', 'run', selectedIndexLabRunId, 'serp'],
    queryFn: () =>
      api.get<IndexLabSerpExplorerResponse>(
        `/indexlab/run/${encodeURIComponent(selectedIndexLabRunId)}/serp`
      ),
    enabled: Boolean(selectedIndexLabRunId),
    refetchInterval: 2000
  });

  const catalogRows = useMemo(() => {
    return [...catalog]
      .filter((row) => row.brand && row.model)
      .sort((a, b) => {
        const brandCmp = String(a.brand || '').localeCompare(String(b.brand || ''));
        if (brandCmp !== 0) return brandCmp;
        const modelCmp = String(a.model || '').localeCompare(String(b.model || ''));
        if (modelCmp !== 0) return modelCmp;
        const variantCmp = cleanVariant(a.variant || '').localeCompare(cleanVariant(b.variant || ''));
        if (variantCmp !== 0) return variantCmp;
        return String(a.productId || '').localeCompare(String(b.productId || ''));
      });
  }, [catalog]);

  const brandOptions = useMemo(() => {
    return [...new Set(catalogRows.map((row) => String(row.brand || '').trim()).filter(Boolean))];
  }, [catalogRows]);

  const modelOptions = useMemo(() => {
    if (!singleBrand) return [];
    return [
      ...new Set(
        catalogRows
          .filter((row) => normalizeToken(row.brand) === normalizeToken(singleBrand))
          .map((row) => String(row.model || '').trim())
          .filter(Boolean)
      )
    ];
  }, [catalogRows, singleBrand]);

  const variantOptions = useMemo(() => {
    if (!singleBrand || !singleModel) return [];
    return catalogRows
      .filter((row) => {
        return normalizeToken(row.brand) === normalizeToken(singleBrand)
          && normalizeToken(row.model) === normalizeToken(singleModel);
      })
      .map((row) => ({
        productId: row.productId,
        label: displayVariant(String(row.variant || ''))
      }));
  }, [catalogRows, singleBrand, singleModel]);

  const selectedCatalogProduct = useMemo(() => {
    return catalogRows.find((row) => row.productId === singleProductId) || null;
  }, [catalogRows, singleProductId]);

  const llmModelOptions = useMemo(() => {
    const rows = Array.isArray(indexingLlmConfig?.model_options)
      ? indexingLlmConfig.model_options.map((row) => String(row || '').trim()).filter(Boolean)
      : [];
    if (!rows.some((row) => normalizeToken(row) === normalizeToken('gemini-2.5-flash-lite'))) {
      rows.unshift('gemini-2.5-flash-lite');
    }
    return [...new Set(rows)];
  }, [indexingLlmConfig]);

  const selectedRunLlmMetrics = useMemo(() => {
    const runs = Array.isArray(indexingLlmMetrics?.by_run) ? indexingLlmMetrics.by_run : [];
    if (runs.length === 0) return null;
    if (selectedIndexLabRunId) {
      const direct = runs.find((row) => String(row.run_id || '').trim() === selectedIndexLabRunId);
      if (direct) return direct;
    }
    return runs[0];
  }, [indexingLlmMetrics, selectedIndexLabRunId]);

  const phase2ModelPricing = useMemo(() => {
    const rows = Array.isArray(indexingLlmConfig?.model_pricing) ? indexingLlmConfig.model_pricing : [];
    return rows.find((row) => normalizeToken(row.model) === normalizeToken(phase2LlmModel)) || null;
  }, [indexingLlmConfig, phase2LlmModel]);

  const phase3ModelPricing = useMemo(() => {
    const rows = Array.isArray(indexingLlmConfig?.model_pricing) ? indexingLlmConfig.model_pricing : [];
    return rows.find((row) => normalizeToken(row.model) === normalizeToken(phase3LlmModel)) || null;
  }, [indexingLlmConfig, phase3LlmModel]);

  useEffect(() => {
    if (!indexingLlmConfig || llmKnobsInitialized) return;
    const geminiDefault = llmModelOptions.find((row) => normalizeToken(row).startsWith('gemini'));
    const phase2Default = String(indexingLlmConfig.phase2?.model_default || '').trim();
    const phase3Default = String(indexingLlmConfig.phase3?.model_default || '').trim();
    const fallbackModel = geminiDefault || phase2Default || phase3Default || llmModelOptions[0] || 'gemini-2.5-flash-lite';

    setPhase2LlmEnabled(true);
    setPhase3LlmTriageEnabled(true);
    setPhase2LlmModel(geminiDefault || phase2Default || fallbackModel);
    setPhase3LlmModel(geminiDefault || phase3Default || fallbackModel);
    setLlmKnobsInitialized(true);
  }, [indexingLlmConfig, llmKnobsInitialized, llmModelOptions]);

  useEffect(() => {
    setSingleBrand('');
    setSingleModel('');
    setSingleProductId('');
    setSelectedIndexLabRunId('');
  }, [category]);

  useEffect(() => {
    if (singleBrand && !brandOptions.some((brand) => normalizeToken(brand) === normalizeToken(singleBrand))) {
      setSingleBrand('');
      setSingleModel('');
      setSingleProductId('');
      return;
    }
    if (singleModel && !modelOptions.some((model) => normalizeToken(model) === normalizeToken(singleModel))) {
      setSingleModel('');
      setSingleProductId('');
      return;
    }
    if (singleProductId && !variantOptions.some((option) => option.productId === singleProductId)) {
      setSingleProductId('');
    }
  }, [brandOptions, modelOptions, variantOptions, singleBrand, singleModel, singleProductId]);

  const indexlabLiveEvents = useMemo(() => {
    if (!selectedIndexLabRunId) return [];
    return liveIndexLabByRun[selectedIndexLabRunId] || [];
  }, [liveIndexLabByRun, selectedIndexLabRunId]);

  const indexlabEvents = useMemo(() => {
    const merged = [
      ...(indexlabEventsResp?.events || []),
      ...indexlabLiveEvents
    ];
    const seen = new Set<string>();
    const rows: IndexLabEvent[] = [];
    for (const row of merged) {
      const payload = row?.payload && typeof row.payload === 'object'
        ? JSON.stringify(row.payload)
        : '';
      const key = `${row.run_id}|${row.ts}|${row.stage}|${row.event}|${payload}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
    rows.sort((a, b) => Date.parse(String(a.ts || '')) - Date.parse(String(b.ts || '')));
    return rows;
  }, [indexlabEventsResp, indexlabLiveEvents]);

  useEffect(() => {
    const timer = window.setInterval(() => setActivityNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const timedIndexlabEvents = useMemo(() => {
    return indexlabEvents
      .map((row) => {
        const tsMs = Date.parse(String(row.ts || ''));
        if (!Number.isFinite(tsMs)) return null;
        const payload = row?.payload && typeof row.payload === 'object'
          ? row.payload as Record<string, unknown>
          : {};
        const topLevel = row as unknown as Record<string, unknown>;
        const payloadProductId = String(payload.product_id || payload.productId || '').trim();
        const productId = String(row.product_id || topLevel.productId || payloadProductId || '').trim();
        return {
          row,
          tsMs,
          stage: String(row.stage || '').trim().toLowerCase(),
          event: String(row.event || '').trim().toLowerCase(),
          productId
        } as TimedIndexLabEvent;
      })
      .filter((row): row is TimedIndexLabEvent => Boolean(row));
  }, [indexlabEvents]);

  const selectedIndexLabRun = useMemo(
    () => indexlabRuns.find((row) => row.run_id === selectedIndexLabRunId) || null,
    [indexlabRuns, selectedIndexLabRunId]
  );
  const selectedRunLiveDuration = useMemo(() => {
    if (!selectedIndexLabRun?.started_at) return '-';
    const startMs = Date.parse(String(selectedIndexLabRun.started_at || ''));
    if (!Number.isFinite(startMs)) return '-';
    const endMs = selectedIndexLabRun.ended_at
      ? Date.parse(String(selectedIndexLabRun.ended_at || ''))
      : activityNowMs;
    const safeEndMs = Number.isFinite(endMs) ? endMs : activityNowMs;
    return formatDuration(Math.max(0, safeEndMs - startMs));
  }, [selectedIndexLabRun, activityNowMs]);

  const activeMonitorProductId = String(
    singleProductId
    || selectedIndexLabRun?.product_id
    || ''
  ).trim();

  const runtimeActivity = useMemo(
    () => computeActivityStats(timedIndexlabEvents, activityNowMs, () => true),
    [timedIndexlabEvents, activityNowMs]
  );

  const productPickerActivity = useMemo(
    () =>
      computeActivityStats(
        timedIndexlabEvents,
        activityNowMs,
        (event) => Boolean(activeMonitorProductId) && event.productId === activeMonitorProductId
      ),
    [timedIndexlabEvents, activityNowMs, activeMonitorProductId]
  );

  const eventStreamActivity = useMemo(
    () =>
      computeActivityStats(
        timedIndexlabEvents,
        activityNowMs,
        (event) => ['search', 'fetch', 'parse', 'index'].includes(event.stage)
      ),
    [timedIndexlabEvents, activityNowMs]
  );

  const needsetActivity = useMemo(
    () =>
      computeActivityStats(
        timedIndexlabEvents,
        activityNowMs,
        (event) => event.event === 'needset_computed' || event.stage === 'index'
      ),
    [timedIndexlabEvents, activityNowMs]
  );

  const indexlabSummary = useMemo(() => {
    const stageWindows: Record<string, { started_at: string; ended_at: string }> = {
      search: { started_at: '', ended_at: '' },
      fetch: { started_at: '', ended_at: '' },
      parse: { started_at: '', ended_at: '' },
      index: { started_at: '', ended_at: '' }
    };
    const counters = {
      pages_checked: 0,
      fetched_ok: 0,
      fetched_404: 0,
      fetched_blocked: 0,
      fetched_error: 0,
      parse_completed: 0,
      indexed_docs: 0,
      fields_filled: 0
    };
    const urlJobs = new Map<string, {
      url: string;
      status: string;
      status_code: number;
      ms: number;
      started_at: string;
      finished_at: string;
      last_ts: string;
    }>();

    for (const evt of indexlabEvents) {
      const payload = evt?.payload && typeof evt.payload === 'object'
        ? evt.payload as Record<string, unknown>
        : {};
      const stage = String(evt.stage || '').trim();
      const eventName = String(evt.event || '').trim();
      const scope = String(payload.scope || '').trim();
      const ts = String(evt.ts || '').trim();

      if (scope === 'stage' && stageWindows[stage]) {
        if (eventName.endsWith('_started')) {
          stageWindows[stage].started_at = stageWindows[stage].started_at || ts;
        } else if (eventName.endsWith('_finished')) {
          stageWindows[stage].ended_at = ts;
        }
      }

      if (stage === 'fetch' && eventName === 'fetch_started' && scope === 'url') {
        const url = String(payload.url || '').trim();
        if (url) {
          counters.pages_checked += 1;
          urlJobs.set(url, {
            url,
            status: 'in_flight',
            status_code: 0,
            ms: 0,
            started_at: ts,
            finished_at: '',
            last_ts: ts
          });
        }
      }

      if (stage === 'fetch' && eventName === 'fetch_finished' && scope === 'url') {
        const url = String(payload.url || '').trim();
        const statusClass = String(payload.status_class || 'error').trim();
        const statusCode = Number.parseInt(String(payload.status || 0), 10) || 0;
        const ms = Number.parseInt(String(payload.ms || 0), 10) || 0;
        if (statusClass === 'ok') counters.fetched_ok += 1;
        else if (statusClass === '404') counters.fetched_404 += 1;
        else if (statusClass === 'blocked') counters.fetched_blocked += 1;
        else counters.fetched_error += 1;
        if (url) {
          const current = urlJobs.get(url) || {
            url,
            status: 'unknown',
            status_code: 0,
            ms: 0,
            started_at: '',
            finished_at: '',
            last_ts: ''
          };
          urlJobs.set(url, {
            ...current,
            status: statusClass || 'error',
            status_code: statusCode,
            ms,
            finished_at: ts,
            last_ts: ts
          });
        }
      }

      if (stage === 'parse' && eventName === 'parse_finished' && scope === 'url') {
        counters.parse_completed += 1;
      }
      if (stage === 'index' && eventName === 'index_finished' && scope === 'url') {
        counters.indexed_docs += 1;
        counters.fields_filled += Number.parseInt(String(payload.count || 0), 10) || 0;
      }
    }

    const jobs = [...urlJobs.values()]
      .sort((a, b) => Date.parse(b.last_ts || '') - Date.parse(a.last_ts || ''));
    const activeJobs = jobs.filter((row) => row.status === 'in_flight');

    return {
      stageWindows,
      counters,
      activeJobs,
      recentJobs: jobs.slice(0, 30)
    };
  }, [indexlabEvents]);

  const indexlabNeedsetFromEvents = useMemo(() => {
    const snapshots: IndexLabNeedSetSnapshot[] = [];
    let latest: IndexLabNeedSetResponse | null = null;
    for (const evt of indexlabEvents) {
      if (String(evt.event || '').trim() !== 'needset_computed') continue;
      const payload = evt?.payload && typeof evt.payload === 'object'
        ? evt.payload as Record<string, unknown>
        : {};
      const snapshotTs = String(evt.ts || payload.generated_at || '').trim();
      const snapshotSize = Number.parseInt(String(payload.needset_size || 0), 10) || 0;
      if (snapshotTs) {
        snapshots.push({
          ts: snapshotTs,
          needset_size: snapshotSize
        });
      }
      latest = {
        run_id: String(evt.run_id || '').trim(),
        category: String(evt.category || '').trim(),
        product_id: String(evt.product_id || '').trim(),
        generated_at: String(payload.generated_at || evt.ts || '').trim(),
        total_fields: Number.parseInt(String(payload.total_fields || 0), 10) || 0,
        needset_size: snapshotSize,
        reason_counts: (payload.reason_counts && typeof payload.reason_counts === 'object')
          ? payload.reason_counts as Record<string, number>
          : {},
        required_level_counts: (payload.required_level_counts && typeof payload.required_level_counts === 'object')
          ? payload.required_level_counts as Record<string, number>
          : {},
        needs: Array.isArray(payload.needs) ? payload.needs as IndexLabNeedSetRow[] : [],
        snapshots: Array.isArray(payload.snapshots)
          ? payload.snapshots as IndexLabNeedSetSnapshot[]
          : snapshots
      };
    }
    if (!latest) return null;
    if (!Array.isArray(latest.snapshots) || latest.snapshots.length === 0) {
      latest.snapshots = snapshots;
    }
    return latest;
  }, [indexlabEvents]);

  const indexlabNeedset = useMemo(
    () => indexlabNeedsetFromEvents || indexlabNeedsetResp || null,
    [indexlabNeedsetFromEvents, indexlabNeedsetResp]
  );

  const indexlabNeedsetRows = useMemo(() => {
    const rows = Array.isArray(indexlabNeedset?.needs) ? [...indexlabNeedset.needs] : [];
    rows.sort((a, b) => {
      let cmp = 0;
      if (needsetSortKey === 'field_key') {
        cmp = String(a.field_key || '').localeCompare(String(b.field_key || ''));
      } else if (needsetSortKey === 'required_level') {
        cmp = needsetRequiredLevelWeight(String(a.required_level || '')) - needsetRequiredLevelWeight(String(b.required_level || ''));
      } else if (needsetSortKey === 'confidence') {
        const av = Number.isFinite(Number(a.confidence)) ? Number(a.confidence) : -1;
        const bv = Number.isFinite(Number(b.confidence)) ? Number(b.confidence) : -1;
        cmp = av - bv;
      } else if (needsetSortKey === 'best_tier_seen') {
        const av = Number.isFinite(Number(a.best_tier_seen)) ? Number(a.best_tier_seen) : 99;
        const bv = Number.isFinite(Number(b.best_tier_seen)) ? Number(b.best_tier_seen) : 99;
        cmp = av - bv;
      } else if (needsetSortKey === 'refs') {
        const av = (Number(a.refs_found) || 0) - (Number(a.min_refs) || 0);
        const bv = (Number(b.refs_found) || 0) - (Number(b.min_refs) || 0);
        cmp = av - bv;
      } else {
        cmp = Number(a.need_score || 0) - Number(b.need_score || 0);
      }
      if (cmp === 0) {
        return String(a.field_key || '').localeCompare(String(b.field_key || ''));
      }
      return needsetSortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [indexlabNeedset, needsetSortDir, needsetSortKey]);

  const indexlabNeedsetSparklineValues = useMemo(() => {
    const snapshots = Array.isArray(indexlabNeedset?.snapshots) ? indexlabNeedset.snapshots : [];
    if (snapshots.length > 0) {
      return snapshots
        .map((row) => Number.parseInt(String(row.needset_size || 0), 10) || 0);
    }
    if (Number.isFinite(Number(indexlabNeedset?.needset_size))) {
      return [Number(indexlabNeedset?.needset_size || 0)];
    }
    return [];
  }, [indexlabNeedset]);
  const indexlabSearchProfile = useMemo(
    () => indexlabSearchProfileResp || null,
    [indexlabSearchProfileResp]
  );
  const indexlabSearchProfileRows = useMemo(() => {
    const rows = Array.isArray(indexlabSearchProfile?.query_rows)
      ? [...indexlabSearchProfile.query_rows]
      : [];
    rows.sort((a, b) => {
      const ac = Number(a.result_count || 0);
      const bc = Number(b.result_count || 0);
      if (ac !== bc) return bc - ac;
      return String(a.query || '').localeCompare(String(b.query || ''));
    });
    return rows;
  }, [indexlabSearchProfile]);
  const indexlabSerpExplorer = useMemo(() => {
    if (indexlabSerpExplorerResp && typeof indexlabSerpExplorerResp === 'object') {
      return indexlabSerpExplorerResp;
    }
    if (indexlabSearchProfile?.serp_explorer && typeof indexlabSearchProfile.serp_explorer === 'object') {
      return indexlabSearchProfile.serp_explorer;
    }
    return null;
  }, [indexlabSerpExplorerResp, indexlabSearchProfile]);
  const indexlabSerpRows = useMemo(() => {
    const rows = Array.isArray(indexlabSerpExplorer?.queries)
      ? [...indexlabSerpExplorer.queries]
      : [];
    rows.sort((a, b) => {
      const as = Number(a.selected_count || 0);
      const bs = Number(b.selected_count || 0);
      if (as !== bs) return bs - as;
      const ac = Number(a.candidate_count || 0);
      const bc = Number(b.candidate_count || 0);
      if (ac !== bc) return bc - ac;
      return String(a.query || '').localeCompare(String(b.query || ''));
    });
    return rows;
  }, [indexlabSerpExplorer]);
  const llmOutputDocHintRows = useMemo(() => {
    const rows = Array.isArray(indexlabSearchProfile?.doc_hint_queries)
      ? [...indexlabSearchProfile.doc_hint_queries]
      : [];
    rows.sort((a, b) => String(a.doc_hint || '').localeCompare(String(b.doc_hint || '')));
    return rows;
  }, [indexlabSearchProfile]);
  const llmOutputFieldQueryRows = useMemo(() => {
    const record = (indexlabSearchProfile?.field_target_queries && typeof indexlabSearchProfile.field_target_queries === 'object')
      ? indexlabSearchProfile.field_target_queries
      : {};
    const focus = new Set((indexlabSearchProfile?.focus_fields || []).map((field) => normalizeToken(field)));
    const rows = Object.entries(record).map(([field, queries]) => ({
      field,
      queries: Array.isArray(queries) ? queries.map((item) => String(item || '').trim()).filter(Boolean) : [],
      isFocus: focus.has(normalizeToken(field))
    }));
    rows.sort((a, b) => {
      if (a.isFocus !== b.isFocus) return a.isFocus ? -1 : 1;
      return a.field.localeCompare(b.field);
    });
    return rows;
  }, [indexlabSearchProfile]);
  const llmOutputSelectedCandidates = useMemo(() => {
    const rows: Array<{
      query: string;
      url: string;
      doc_kind: string;
      tier_name: string;
      score: number;
      reason_codes: string[];
    }> = [];
    for (const queryRow of indexlabSerpRows) {
      for (const candidate of queryRow.candidates || []) {
        if (candidate.decision !== 'selected') continue;
        rows.push({
          query: String(queryRow.query || '').trim(),
          url: String(candidate.url || '').trim(),
          doc_kind: String(candidate.doc_kind || '').trim(),
          tier_name: String(candidate.tier_name || (Number.isFinite(Number(candidate.tier)) ? `tier ${candidate.tier}` : '')).trim(),
          score: Number(candidate.triage_score || 0),
          reason_codes: Array.isArray(candidate.reason_codes) ? candidate.reason_codes : []
        });
      }
    }
    rows.sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));
    return rows;
  }, [indexlabSerpRows]);
  const llmOutputRejectedCandidates = useMemo(() => {
    const skipReasonTokens = new Set([
      'manufacturer_brand_mismatch',
      'low_relevance',
      'triage_excluded',
      'denied_host',
      'non_https',
      'url_cooldown',
      'query_cooldown',
      'frontier_skip',
      'forbidden'
    ]);
    const rows: Array<{
      query: string;
      url: string;
      doc_kind: string;
      score: number;
      reason_codes: string[];
    }> = [];
    for (const queryRow of indexlabSerpRows) {
      for (const candidate of queryRow.candidates || []) {
        if (candidate.decision !== 'rejected') continue;
        const reasons = Array.isArray(candidate.reason_codes) ? candidate.reason_codes : [];
        if (!reasons.some((reason) => skipReasonTokens.has(normalizeToken(reason)))) continue;
        rows.push({
          query: String(queryRow.query || '').trim(),
          url: String(candidate.url || '').trim(),
          doc_kind: String(candidate.doc_kind || '').trim(),
          score: Number(candidate.triage_score || 0),
          reason_codes: reasons
        });
      }
    }
    rows.sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));
    return rows;
  }, [indexlabSerpRows]);

  const refreshAll = async () => {
    const refreshes: Array<Promise<unknown>> = [
      queryClient.invalidateQueries({ queryKey: ['processStatus', 'indexing'], exact: true }),
      queryClient.invalidateQueries({ queryKey: ['searxng', 'status'], exact: true }),
      queryClient.invalidateQueries({ queryKey: ['indexing', 'llm-config'], exact: true }),
      queryClient.invalidateQueries({ queryKey: ['indexing', 'llm-metrics', category], exact: true }),
      queryClient.invalidateQueries({ queryKey: ['catalog', category, 'indexing'], exact: true }),
      queryClient.invalidateQueries({ queryKey: ['indexlab', 'runs'], exact: true }),
      // Refresh any active run-level containers even if run selection changed recently.
      queryClient.invalidateQueries({ queryKey: ['indexlab', 'run'] })
    ];
    if (selectedIndexLabRunId) {
      refreshes.push(
        queryClient.invalidateQueries({ queryKey: ['indexlab', 'run', selectedIndexLabRunId, 'events'], exact: true }),
        queryClient.invalidateQueries({ queryKey: ['indexlab', 'run', selectedIndexLabRunId, 'needset'], exact: true }),
        queryClient.invalidateQueries({ queryKey: ['indexlab', 'run', selectedIndexLabRunId, 'search-profile'], exact: true }),
        queryClient.invalidateQueries({ queryKey: ['indexlab', 'run', selectedIndexLabRunId, 'serp'], exact: true })
      );
    }
    await Promise.allSettled(refreshes);
    await queryClient.refetchQueries({
      queryKey: ['indexlab', 'run'],
      type: 'active'
    });
  };

  const runControlPayload = useMemo(() => {
    const parsedResumeWindowHours = Number.parseInt(resumeWindowHours, 10);
    const parsedReextractAfterHours = Number.parseInt(reextractAfterHours, 10);
    return {
      resumeMode,
      resumeWindowHours: Number.isFinite(parsedResumeWindowHours) && parsedResumeWindowHours >= 0
        ? parsedResumeWindowHours
        : 48,
      reextractAfterHours: Number.isFinite(parsedReextractAfterHours) && parsedReextractAfterHours >= 0
        ? parsedReextractAfterHours
        : 24,
      reextractIndexed
    };
  }, [resumeMode, resumeWindowHours, reextractAfterHours, reextractIndexed]);

  const startIndexLabMut = useMutation({
    mutationFn: () => api.post<ProcessStatus>('/process/start', {
      category,
      mode: 'indexlab',
      replaceRunning: true,
      extractionMode: 'balanced',
      productId: singleProductId,
      profile,
      discoveryEnabled,
      searchProvider,
      phase2LlmEnabled,
      phase2LlmModel,
      phase3LlmTriageEnabled,
      phase3LlmModel,
      ...runControlPayload
    }),
    onMutate: () => {
      clearProcessOutput();
      setSelectedIndexLabRunId('');
    },
    onSuccess: refreshAll
  });

  const stopMut = useMutation({
    mutationFn: () => api.post<ProcessStatus>('/process/stop'),
    onSuccess: refreshAll
  });

  const startSearxngMut = useMutation({
    mutationFn: () => api.post<{ ok: boolean; started: boolean; status: SearxngStatusResponse }>('/searxng/start'),
    onSuccess: refreshAll
  });

  const processRunning = Boolean(processStatus?.running);
  const processStateLabel = processRunning
    ? 'running'
    : (processStatus?.exitCode === 0 && processStatus?.endedAt ? 'completed' : (processStatus?.exitCode !== null && processStatus?.exitCode !== undefined ? 'failed' : 'idle'));
  const busy = startIndexLabMut.isPending || stopMut.isPending || startSearxngMut.isPending;
  const canRunSingle = !isAll && !!singleProductId;

  const actionError =
    (startIndexLabMut.error as Error)?.message
    || (stopMut.error as Error)?.message
    || (startSearxngMut.error as Error)?.message
    || '';

  const setNeedsetSort = (nextKey: 'need_score' | 'field_key' | 'required_level' | 'confidence' | 'best_tier_seen' | 'refs') => {
    if (needsetSortKey === nextKey) {
      setNeedsetSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'));
      return;
    }
    setNeedsetSortKey(nextKey);
    setNeedsetSortDir(nextKey === 'field_key' ? 'asc' : 'desc');
  };
  const togglePanel = (panel: PanelKey) => {
    setPanelCollapsed((prev) => ({
      ...prev,
      [panel]: !prev[panel]
    }));
  };
  const setAllPanels = (collapsed: boolean) => {
    const next: Record<PanelKey, boolean> = { ...DEFAULT_PANEL_COLLAPSED };
    for (const key of PANEL_KEYS) {
      next[key] = collapsed;
    }
    setPanelCollapsed(next);
  };

  return (
    <div className="space-y-4 flex flex-col">
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4" style={{ order: 10 }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => togglePanel('overview')}
              className="inline-flex items-center justify-center w-6 h-6 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              title={panelCollapsed.overview ? 'Open panel' : 'Close panel'}
            >
              {panelCollapsed.overview ? '+' : '-'}
            </button>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Indexing Lab (Phase 01)</h2>
              {!panelCollapsed.overview ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Focused GUI for IndexLab run evidence and NeedSet proof for <span className="font-mono">{category}</span>.
                </p>
              ) : null}
            </div>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            process {processStateLabel}
            {processStatus?.pid ? ` | pid ${processStatus.pid}` : ''}
            {processStatus?.command ? ` | ${processStatus.command}` : ''}
            {!processRunning && processStatus?.exitCode !== null && processStatus?.exitCode !== undefined ? ` | exit ${processStatus.exitCode}` : ''}
            {selectedIndexLabRun?.started_at ? ` | runtime ${selectedRunLiveDuration}` : ''}
          </div>
        </div>
        {!panelCollapsed.overview ? (
          <div className="mt-3">
            <ActivityGauge
              label="overall run activity"
              currentPerMin={runtimeActivity.currentPerMin}
              peakPerMin={runtimeActivity.peakPerMin}
              active={processRunning}
            />
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-2" style={{ order: 35 }}>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="text-gray-600 dark:text-gray-300">
            Panel Controls
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAllPanels(false)}
              className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              title="Open all containers."
            >
              Open all
            </button>
            <button
              onClick={() => setAllPanels(true)}
              className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              title="Close all containers."
            >
              Close all
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3" style={{ order: 80 }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center text-sm font-semibold text-gray-900 dark:text-gray-100">
            <button
              onClick={() => togglePanel('llmOutput')}
              className="inline-flex items-center justify-center w-5 h-5 mr-1 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              title={panelCollapsed.llmOutput ? 'Open panel' : 'Close panel'}
            >
              {panelCollapsed.llmOutput ? '+' : '-'}
            </button>
            <span>LLM Output Review (Phase 02/03)</span>
            <Tip text="Readable review of SearchProfile outputs and URL triage decisions without raw JSON." />
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            run {selectedIndexLabRunId || '-'}
          </div>
        </div>
        {!panelCollapsed.llmOutput ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400">aliases</div>
                <div className="font-semibold">{formatNumber((indexlabSearchProfile?.identity_aliases || []).length)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400">negative terms</div>
                <div className="font-semibold">{formatNumber((indexlabSearchProfile?.negative_terms || []).length)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400">top K selected</div>
                <div className="font-semibold">{formatNumber(llmOutputSelectedCandidates.length)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400">junk/wrong-model skips</div>
                <div className="font-semibold">{formatNumber(llmOutputRejectedCandidates.length)}</div>
              </div>
            </div>

            <div className="rounded border border-gray-200 dark:border-gray-700 p-2 text-xs">
              <div className="font-semibold text-gray-800 dark:text-gray-200">SearchProfile JSON (Phase 02)</div>
              <div className="mt-1 text-gray-500 dark:text-gray-400">
                Strict output review: identity aliases, negative terms, doc_hint templates, and field-target query variants.
              </div>
              <div className="mt-2">
                <div className="text-gray-500 dark:text-gray-400">identity aliases</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {(indexlabSearchProfile?.identity_aliases || []).length === 0 ? (
                    <span className="text-gray-500 dark:text-gray-400">no aliases</span>
                  ) : (
                    (indexlabSearchProfile?.identity_aliases || []).slice(0, 24).map((row) => (
                      <span key={`llm-out-alias:${row.alias}`} className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                        {row.alias}
                        {row.source ? ` (${row.source})` : ''}
                      </span>
                    ))
                  )}
                </div>
              </div>
              <div className="mt-2">
                <div className="text-gray-500 dark:text-gray-400">negative terms</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {(indexlabSearchProfile?.negative_terms || []).length === 0 ? (
                    <span className="text-gray-500 dark:text-gray-400">no negative terms</span>
                  ) : (
                    (indexlabSearchProfile?.negative_terms || []).slice(0, 24).map((token) => (
                      <span key={`llm-out-neg:${token}`} className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                        {token}
                      </span>
                    ))
                  )}
                </div>
              </div>
              <div className="mt-2 grid grid-cols-1 xl:grid-cols-2 gap-2">
                <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
                  <div className="font-semibold text-gray-800 dark:text-gray-200">doc_hint query templates</div>
                  <table className="mt-2 min-w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                        <th className="py-1 pr-3">doc hint</th>
                        <th className="py-1 pr-3">queries</th>
                      </tr>
                    </thead>
                    <tbody>
                      {llmOutputDocHintRows.length === 0 && (
                        <tr>
                          <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={2}>no doc_hint templates</td>
                        </tr>
                      )}
                      {llmOutputDocHintRows.slice(0, 20).map((row) => (
                        <tr key={`llm-out-doc:${row.doc_hint}`} className="border-b border-gray-100 dark:border-gray-800">
                          <td className="py-1 pr-3">{row.doc_hint || '-'}</td>
                          <td className="py-1 pr-3">{(row.queries || []).slice(0, 3).join(' | ') || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
                  <div className="font-semibold text-gray-800 dark:text-gray-200">field-target query variants</div>
                  <table className="mt-2 min-w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                        <th className="py-1 pr-3">field</th>
                        <th className="py-1 pr-3">queries</th>
                      </tr>
                    </thead>
                    <tbody>
                      {llmOutputFieldQueryRows.length === 0 && (
                        <tr>
                          <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={2}>no field-target query variants</td>
                        </tr>
                      )}
                      {llmOutputFieldQueryRows.slice(0, 24).map((row) => (
                        <tr key={`llm-out-field:${row.field}`} className="border-b border-gray-100 dark:border-gray-800">
                          <td className="py-1 pr-3 font-mono">
                            {row.field}
                            {row.isFocus ? (
                              <span className="ml-1 px-1 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">focus</span>
                            ) : null}
                          </td>
                          <td className="py-1 pr-3">{row.queries.slice(0, 3).join(' | ') || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="rounded border border-gray-200 dark:border-gray-700 p-2 text-xs space-y-2">
              <div className="font-semibold text-gray-800 dark:text-gray-200">Phase 03 output review</div>
              <div className="text-gray-500 dark:text-gray-400">
                Top K URLs to fetch with reasons/doc_kind, plus wrong-model or junk skips.
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
                <div className="font-semibold text-gray-800 dark:text-gray-200">Top K URLs to fetch</div>
                <table className="mt-2 min-w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                      <th className="py-1 pr-3">url</th>
                      <th className="py-1 pr-3">query</th>
                      <th className="py-1 pr-3">doc kind</th>
                      <th className="py-1 pr-3">tier</th>
                      <th className="py-1 pr-3">score</th>
                      <th className="py-1 pr-3">reasons</th>
                    </tr>
                  </thead>
                  <tbody>
                    {llmOutputSelectedCandidates.length === 0 && (
                      <tr>
                        <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={6}>no selected urls yet</td>
                      </tr>
                    )}
                    {llmOutputSelectedCandidates.slice(0, 16).map((row) => (
                      <tr key={`llm-out-sel:${row.query}:${row.url}`} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-1 pr-3 font-mono truncate max-w-[28rem]" title={row.url}>{row.url}</td>
                        <td className="py-1 pr-3 font-mono truncate max-w-[20rem]" title={row.query}>{row.query}</td>
                        <td className="py-1 pr-3">{row.doc_kind || '-'}</td>
                        <td className="py-1 pr-3">{row.tier_name || '-'}</td>
                        <td className="py-1 pr-3">{formatNumber(row.score, 3)}</td>
                        <td className="py-1 pr-3">
                          <div className="flex flex-wrap gap-1">
                            {row.reason_codes.slice(0, 4).map((reason) => (
                              <span key={`llm-out-sel-reason:${row.url}:${reason}`} className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                                {reason}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
                <div className="font-semibold text-gray-800 dark:text-gray-200">Wrong model / junk skips</div>
                <table className="mt-2 min-w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                      <th className="py-1 pr-3">url</th>
                      <th className="py-1 pr-3">query</th>
                      <th className="py-1 pr-3">doc kind</th>
                      <th className="py-1 pr-3">score</th>
                      <th className="py-1 pr-3">skip reasons</th>
                    </tr>
                  </thead>
                  <tbody>
                    {llmOutputRejectedCandidates.length === 0 && (
                      <tr>
                        <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={5}>no junk/wrong-model skips yet</td>
                      </tr>
                    )}
                    {llmOutputRejectedCandidates.slice(0, 20).map((row) => (
                      <tr key={`llm-out-rej:${row.query}:${row.url}`} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-1 pr-3 font-mono truncate max-w-[28rem]" title={row.url}>{row.url}</td>
                        <td className="py-1 pr-3 font-mono truncate max-w-[20rem]" title={row.query}>{row.query}</td>
                        <td className="py-1 pr-3">{row.doc_kind || '-'}</td>
                        <td className="py-1 pr-3">{formatNumber(row.score, 3)}</td>
                        <td className="py-1 pr-3">
                          <div className="flex flex-wrap gap-1">
                            {row.reason_codes.slice(0, 4).map((reason) => (
                              <span key={`llm-out-rej-reason:${row.url}:${reason}`} className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                                {reason}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3" style={{ order: 90 }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center text-sm font-semibold text-gray-900 dark:text-gray-100">
            <button
              onClick={() => togglePanel('llmMetrics')}
              className="inline-flex items-center justify-center w-5 h-5 mr-1 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              title={panelCollapsed.llmMetrics ? 'Open panel' : 'Close panel'}
            >
              {panelCollapsed.llmMetrics ? '+' : '-'}
            </button>
            <span>LLM Runtime Metrics</span>
            <Tip text="Live call/cost/token counters from ledger + active pricing for selected Phase 02/03 models." />
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            updated {formatDateTime(indexingLlmMetrics?.generated_at || null)}
          </div>
        </div>
        {!panelCollapsed.llmMetrics ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400">selected run calls</div>
                <div className="font-semibold">{formatNumber(Number(selectedRunLlmMetrics?.calls || 0))}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400">selected run cost</div>
                <div className="font-semibold">${formatNumber(Number(selectedRunLlmMetrics?.cost_usd || 0), 6)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400">selected run prompt</div>
                <div className="font-semibold">{formatNumber(Number(selectedRunLlmMetrics?.prompt_tokens || 0))}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400">selected run completion</div>
                <div className="font-semibold">{formatNumber(Number(selectedRunLlmMetrics?.completion_tokens || 0))}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400">period calls</div>
                <div className="font-semibold">{formatNumber(Number(indexingLlmMetrics?.total_calls || 0))}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400">period cost</div>
                <div className="font-semibold">${formatNumber(Number(indexingLlmMetrics?.total_cost_usd || 0), 6)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400">period prompt</div>
                <div className="font-semibold">{formatNumber(Number(indexingLlmMetrics?.total_prompt_tokens || 0))}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400">period completion</div>
                <div className="font-semibold">{formatNumber(Number(indexingLlmMetrics?.total_completion_tokens || 0))}</div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              <div className="rounded border border-gray-200 dark:border-gray-700 p-2">
                <div className="font-semibold text-gray-800 dark:text-gray-200">phase 02 pricing</div>
                <div className="mt-1 text-gray-600 dark:text-gray-300">
                  {phase2LlmModel} | in ${formatNumber(Number(phase2ModelPricing?.input_per_1m ?? indexingLlmConfig?.pricing_defaults?.input_per_1m ?? 0), 4)} / out ${formatNumber(Number(phase2ModelPricing?.output_per_1m ?? indexingLlmConfig?.pricing_defaults?.output_per_1m ?? 0), 4)} / cache ${formatNumber(Number(phase2ModelPricing?.cached_input_per_1m ?? indexingLlmConfig?.pricing_defaults?.cached_input_per_1m ?? 0), 4)}
                </div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 p-2">
                <div className="font-semibold text-gray-800 dark:text-gray-200">phase 03 pricing</div>
                <div className="mt-1 text-gray-600 dark:text-gray-300">
                  {phase3LlmModel} | in ${formatNumber(Number(phase3ModelPricing?.input_per_1m ?? indexingLlmConfig?.pricing_defaults?.input_per_1m ?? 0), 4)} / out ${formatNumber(Number(phase3ModelPricing?.output_per_1m ?? indexingLlmConfig?.pricing_defaults?.output_per_1m ?? 0), 4)} / cache ${formatNumber(Number(phase3ModelPricing?.cached_input_per_1m ?? indexingLlmConfig?.pricing_defaults?.cached_input_per_1m ?? 0), 4)}
                </div>
              </div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
              <div className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                By Model ({formatNumber((indexingLlmMetrics?.by_model || []).length)} rows)
              </div>
              <table className="mt-2 min-w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <th className="py-1 pr-3">provider</th>
                    <th className="py-1 pr-3">model</th>
                    <th className="py-1 pr-3">calls</th>
                    <th className="py-1 pr-3">cost usd</th>
                    <th className="py-1 pr-3">prompt</th>
                    <th className="py-1 pr-3">completion</th>
                  </tr>
                </thead>
                <tbody>
                  {(indexingLlmMetrics?.by_model || []).length === 0 && (
                    <tr>
                      <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={6}>no llm usage rows yet</td>
                    </tr>
                  )}
                  {(indexingLlmMetrics?.by_model || []).slice(0, 12).map((row, idx) => (
                    <tr key={`${row.provider || 'unknown'}:${row.model || 'model'}:${idx}`} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-1 pr-3">{row.provider || '-'}</td>
                      <td className="py-1 pr-3 font-mono">{row.model || '-'}</td>
                      <td className="py-1 pr-3">{formatNumber(Number(row.calls || 0))}</td>
                      <td className="py-1 pr-3">${formatNumber(Number(row.cost_usd || 0), 6)}</td>
                      <td className="py-1 pr-3">{formatNumber(Number(row.prompt_tokens || 0))}</td>
                      <td className="py-1 pr-3">{formatNumber(Number(row.completion_tokens || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3" style={{ order: 70 }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center text-sm font-semibold text-gray-900 dark:text-gray-100">
            <button
              onClick={() => togglePanel('serpExplorer')}
              className="inline-flex items-center justify-center w-5 h-5 mr-1 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              title={panelCollapsed.serpExplorer ? 'Open panel' : 'Close panel'}
            >
              {panelCollapsed.serpExplorer ? '+' : '-'}
            </button>
            <span>SERP Explorer (Phase 03)</span>
            <Tip text="Per-query candidate URLs with tier/doc_kind tags and triage decision proof." />
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {indexlabSerpExplorer?.provider || 'not generated'}
          </div>
        </div>
        {!panelCollapsed.serpExplorer && indexlabSerpExplorer ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400">candidates checked</div>
                <div className="font-semibold">{formatNumber(Number(indexlabSerpExplorer.candidates_checked || 0))}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400">urls triaged</div>
                <div className="font-semibold">{formatNumber(Number(indexlabSerpExplorer.urls_triaged || 0))}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400">urls selected</div>
                <div className="font-semibold">{formatNumber(Number(indexlabSerpExplorer.urls_selected || 0))}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400">duplicates removed</div>
                <div className="font-semibold">{formatNumber(Number(indexlabSerpExplorer.duplicates_removed || 0))}</div>
              </div>
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              generated {formatDateTime(indexlabSerpExplorer.generated_at || null)}
              {' '}| queries {formatNumber(indexlabSerpRows.length)}
              {' '}| llm triage {indexlabSerpExplorer.llm_triage_enabled ? 'enabled' : 'off'}
              {indexlabSerpExplorer.llm_triage_model ? ` (${indexlabSerpExplorer.llm_triage_model})` : ''}
            </div>
            <div className="space-y-2">
              {indexlabSerpRows.length === 0 ? (
                <div className="text-xs text-gray-500 dark:text-gray-400">no SERP rows yet</div>
              ) : (
                indexlabSerpRows.slice(0, 16).map((row) => (
                  <div key={row.query} className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
                    <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 font-mono truncate" title={row.query}>
                      {row.query}
                    </div>
                    <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                      hint {row.hint_source || '-'} | doc {row.doc_hint || '-'} | targets {(row.target_fields || []).join(', ') || '-'} | selected {formatNumber(Number(row.selected_count || 0))}/{formatNumber(Number(row.candidate_count || 0))}
                    </div>
                    <table className="mt-2 min-w-full text-xs">
                      <thead>
                        <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                          <th className="py-1 pr-3">url</th>
                          <th className="py-1 pr-3">tier</th>
                          <th className="py-1 pr-3">doc kind</th>
                          <th className="py-1 pr-3">score</th>
                          <th className="py-1 pr-3">decision</th>
                          <th className="py-1 pr-3">reasons</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(row.candidates || []).length === 0 ? (
                          <tr>
                            <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={6}>no candidates</td>
                          </tr>
                        ) : (
                          (row.candidates || []).slice(0, 12).map((candidate) => (
                            <tr key={`${row.query}:${candidate.url}`} className="border-b border-gray-100 dark:border-gray-800">
                              <td className="py-1 pr-3 font-mono truncate max-w-[32rem]" title={candidate.url}>
                                {candidate.url}
                              </td>
                              <td className="py-1 pr-3">
                                {candidate.tier_name || (Number.isFinite(Number(candidate.tier)) ? `tier ${candidate.tier}` : '-')}
                              </td>
                              <td className="py-1 pr-3">{candidate.doc_kind || '-'}</td>
                              <td className="py-1 pr-3">{formatNumber(Number(candidate.triage_score || 0), 3)}</td>
                              <td className="py-1 pr-3">
                                <span className={`px-1.5 py-0.5 rounded ${
                                  candidate.decision === 'selected'
                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                    : candidate.decision === 'rejected'
                                      ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
                                      : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                                }`}>
                                  {candidate.decision || 'pending'}
                                </span>
                              </td>
                              <td className="py-1 pr-3">
                                <div className="flex flex-wrap gap-1">
                                  {(candidate.reason_codes || []).slice(0, 4).map((reason) => (
                                    <span key={`${candidate.url}:${reason}`} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                                      {reason}
                                    </span>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                ))
              )}
            </div>
          </>
        ) : !panelCollapsed.serpExplorer ? (
          <div className="text-xs text-gray-500 dark:text-gray-400">no SERP payload yet for this run</div>
        ) : null}
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3" style={{ order: 30 }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center text-sm font-semibold text-gray-900 dark:text-gray-100">
            <button
              onClick={() => togglePanel('runtime')}
              className="inline-flex items-center justify-center w-5 h-5 mr-1 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              title={panelCollapsed.runtime ? 'Open panel' : 'Close panel'}
            >
              {panelCollapsed.runtime ? '+' : '-'}
            </button>
            <span>Runtime Settings</span>
            <Tip text="Profile controls run depth/cost. Resume mode controls whether prior state is reused or ignored." />
          </div>
          <ActivityGauge
            label="runtime activity"
            currentPerMin={runtimeActivity.currentPerMin}
            peakPerMin={runtimeActivity.peakPerMin}
            active={processRunning}
          />
        </div>
        {!panelCollapsed.runtime ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <select
            value={profile}
            onChange={(e) => setProfile(e.target.value as 'fast' | 'standard' | 'thorough')}
            disabled={isAll || busy}
            className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Run intensity profile."
          >
            <option value="fast">profile: fast</option>
            <option value="standard">profile: standard</option>
            <option value="thorough">profile: thorough</option>
          </select>
          <select
            value={resumeMode}
            onChange={(e) => setResumeMode(e.target.value as 'auto' | 'force_resume' | 'start_over')}
            disabled={isAll || busy}
            className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Resume policy."
          >
            <option value="auto">resume mode: auto</option>
            <option value="force_resume">resume mode: force resume</option>
            <option value="start_over">resume mode: start over</option>
          </select>
          <label className="flex items-center gap-2 rounded border border-gray-300 dark:border-gray-600 px-2 py-2 text-xs text-gray-700 dark:text-gray-200">
            <input
              type="checkbox"
              checked={discoveryEnabled}
              onChange={(e) => {
                const enabled = e.target.checked;
                setDiscoveryEnabled(enabled);
                if (!enabled) {
                  setSearchProvider('none');
                } else if (searchProvider === 'none') {
                  setSearchProvider('duckduckgo');
                }
              }}
              disabled={isAll || busy}
            />
            provider discovery
          </label>
          <select
            value={searchProvider}
            onChange={(e) => setSearchProvider(e.target.value as 'none' | 'google' | 'bing' | 'searxng' | 'duckduckgo' | 'dual')}
            disabled={isAll || busy || !discoveryEnabled}
            className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Search provider used when discovery is enabled."
          >
            <option value="none">search provider: none</option>
            <option value="duckduckgo">search provider: duckduckgo</option>
            <option value="searxng">search provider: searxng</option>
            <option value="bing">search provider: bing</option>
            <option value="google">search provider: google</option>
            <option value="dual">search provider: dual</option>
          </select>
          <label className="flex items-center gap-2 rounded border border-gray-300 dark:border-gray-600 px-2 py-2 text-xs text-gray-700 dark:text-gray-200">
            <input
              type="checkbox"
              checked={phase2LlmEnabled}
              onChange={(e) => setPhase2LlmEnabled(e.target.checked)}
              disabled={isAll || busy || !discoveryEnabled}
            />
            phase 02 llm searchprofile
            <Tip text="Force LLM query planning for SearchProfile generation." />
          </label>
          <select
            value={phase2LlmModel}
            onChange={(e) => setPhase2LlmModel(e.target.value)}
            disabled={isAll || busy || !discoveryEnabled || !phase2LlmEnabled}
            className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Model used for Phase 02 SearchProfile planning."
          >
            {llmModelOptions.map((model) => (
              <option key={`phase2:${model}`} value={model}>
                phase 02 model: {model}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 rounded border border-gray-300 dark:border-gray-600 px-2 py-2 text-xs text-gray-700 dark:text-gray-200">
            <input
              type="checkbox"
              checked={phase3LlmTriageEnabled}
              onChange={(e) => setPhase3LlmTriageEnabled(e.target.checked)}
              disabled={isAll || busy || !discoveryEnabled}
            />
            phase 03 llm triage
            <Tip text="Force LLM SERP reranking before URL selection." />
          </label>
          <select
            value={phase3LlmModel}
            onChange={(e) => setPhase3LlmModel(e.target.value)}
            disabled={isAll || busy || !discoveryEnabled || !phase3LlmTriageEnabled}
            className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Model used for Phase 03 SERP triage."
          >
            {llmModelOptions.map((model) => (
              <option key={`phase3:${model}`} value={model}>
                phase 03 model: {model}
              </option>
            ))}
          </select>
          <div className="md:col-span-2 text-[11px] text-gray-500 dark:text-gray-400">
            run-state knobs below are separate from phase 03 triage.
          </div>
          <div className="rounded border border-gray-300 dark:border-gray-600 px-2 py-2">
            <div className="flex items-center gap-1 text-[11px] font-semibold text-gray-700 dark:text-gray-200">
              resume window (hours)
              <Tip text="Maximum age of prior run state that can be resumed. Higher = reuse older progress." />
            </div>
            <input
              type="number"
              min={0}
              value={resumeWindowHours}
              onChange={(e) => setResumeWindowHours(e.target.value)}
              disabled={isAll || busy}
              className="mt-1 w-full px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
              title="Resume validity window in hours."
              placeholder="48"
            />
            <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
              example: 48 means resume only if saved state is newer than 48h.
            </div>
          </div>
          <div className="rounded border border-gray-300 dark:border-gray-600 px-2 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 text-[11px] font-semibold text-gray-700 dark:text-gray-200">
                re-extract age (hours)
                <Tip text="If enabled, successful indexed URLs older than this age are re-extracted for freshness." />
              </div>
              <label className="flex items-center gap-1 text-[11px] text-gray-600 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={reextractIndexed}
                  onChange={(e) => setReextractIndexed(e.target.checked)}
                  disabled={isAll || busy}
                />
                enable
              </label>
            </div>
            <input
              type="number"
              min={0}
              value={reextractAfterHours}
              onChange={(e) => setReextractAfterHours(e.target.value)}
              disabled={isAll || busy || !reextractIndexed}
              className="mt-1 w-full px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
              title="Re-extract successful URLs after this many hours."
              placeholder="24"
            />
            <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
              this refreshes stale indexed sources; it does not control phase 03 triage.
            </div>
          </div>
        </div>
        <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-gray-700 dark:text-gray-200">
              searxng:
              <span className={`ml-1 font-semibold ${
                searxngStatus?.http_ready
                  ? 'text-emerald-600 dark:text-emerald-300'
                  : searxngStatus?.running
                    ? 'text-amber-600 dark:text-amber-300'
                    : 'text-gray-500 dark:text-gray-400'
              }`}>
                {searxngStatus?.http_ready
                  ? 'ready'
                  : (searxngStatus?.running ? 'running (api not ready)' : 'stopped')}
              </span>
              {searxngStatus?.http_status ? (
                <span className="ml-1 text-gray-500 dark:text-gray-400">http {searxngStatus.http_status}</span>
              ) : null}
            </div>
            {!searxngStatus?.running && searxngStatus?.can_start ? (
              <button
                onClick={() => startSearxngMut.mutate()}
                disabled={busy}
                className="px-2 py-1 text-xs rounded bg-cyan-700 hover:bg-cyan-800 text-white disabled:opacity-40"
                title="Start local SearXNG Docker stack."
              >
                Start SearXNG
              </button>
            ) : null}
          </div>
          <div className="mt-1 text-gray-500 dark:text-gray-400">
            {searxngStatus?.base_url || 'http://127.0.0.1:8080'}
            {searxngStatus?.ports ? ` | ${searxngStatus.ports}` : ''}
          </div>
          {searxngStatusErrorMessage && !searxngStatus ? (
            <div className="mt-1 text-rose-600 dark:text-rose-300">
              searxng status error: {searxngStatusErrorMessage}
            </div>
          ) : null}
          {!searxngStatus?.docker_available ? (
            <div className="mt-1 text-rose-600 dark:text-rose-300">docker not available</div>
          ) : null}
          {searxngStatus?.docker_available && !searxngStatus?.compose_file_exists ? (
            <div className="mt-1 text-rose-600 dark:text-rose-300">compose file missing: {searxngStatus.compose_path}</div>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => stopMut.mutate()}
            disabled={busy || !processRunning}
            className="px-3 py-2 text-sm rounded bg-red-600 hover:bg-red-700 text-white disabled:opacity-40"
            title="Stop the currently running process."
          >
            Stop Process
          </button>
          <button
            onClick={refreshAll}
            disabled={isAll || busy}
            className="px-3 py-2 text-sm rounded bg-gray-700 hover:bg-gray-800 text-white disabled:opacity-40"
            title="Refetch latest run data and metrics (does not clear containers)."
          >
            Refetch Data
          </button>
            </div>
          </>
        ) : null}
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3" style={{ order: 20 }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center text-sm font-semibold text-gray-900 dark:text-gray-100">
            <button
              onClick={() => togglePanel('picker')}
              className="inline-flex items-center justify-center w-5 h-5 mr-1 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              title={panelCollapsed.picker ? 'Open panel' : 'Close panel'}
            >
              {panelCollapsed.picker ? '+' : '-'}
            </button>
            <span>Product Picker</span>
            <Tip text="Pick one exact product, then run IndexLab." />
          </div>
          <ActivityGauge
            label="selected product activity"
            currentPerMin={productPickerActivity.currentPerMin}
            peakPerMin={productPickerActivity.peakPerMin}
            active={processRunning}
          />
        </div>
        {!panelCollapsed.picker ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <select
            value={singleBrand}
            onChange={(e) => {
              setSingleBrand(e.target.value);
              setSingleModel('');
              setSingleProductId('');
            }}
            disabled={isAll || busy}
            className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Step 1: Choose brand."
          >
            <option value="">1) select brand</option>
            {brandOptions.map((brand) => (
              <option key={brand} value={brand}>
                {brand}
              </option>
            ))}
          </select>
          <select
            value={singleModel}
            onChange={(e) => {
              setSingleModel(e.target.value);
              setSingleProductId('');
            }}
            disabled={isAll || busy || !singleBrand}
            className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Step 2: Choose model."
          >
            <option value="">2) select model</option>
            {modelOptions.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
          <select
            value={singleProductId}
            onChange={(e) => setSingleProductId(e.target.value)}
            disabled={isAll || busy || !singleModel}
            className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Step 3: Choose variant."
          >
            <option value="">3) select variant</option>
            {variantOptions.map((option) => (
              <option key={option.productId} value={option.productId}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="rounded border border-gray-200 dark:border-gray-700 p-2 text-xs text-gray-600 dark:text-gray-300">
          selected product id: <span className="font-mono">{singleProductId || '(none)'}</span>
          {selectedCatalogProduct ? (
            <span>
              {' '}| {selectedCatalogProduct.brand} {selectedCatalogProduct.model} {displayVariant(selectedCatalogProduct.variant || '')}
            </span>
          ) : null}
        </div>
            <button
              onClick={() => startIndexLabMut.mutate()}
              disabled={!canRunSingle || busy || processRunning}
              className="w-full px-3 py-2 text-sm rounded bg-cyan-600 hover:bg-cyan-700 text-white disabled:opacity-40"
              title="Run IndexLab for selected product and stream events."
            >
              Run IndexLab
            </button>
          </>
        ) : null}
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3" style={{ order: 60 }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center text-sm font-semibold text-gray-900 dark:text-gray-100">
            <button
              onClick={() => togglePanel('searchProfile')}
              className="inline-flex items-center justify-center w-5 h-5 mr-1 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              title={panelCollapsed.searchProfile ? 'Open panel' : 'Close panel'}
            >
              {panelCollapsed.searchProfile ? '+' : '-'}
            </button>
            <span>Search Profile (Phase 02)</span>
            <Tip text="Deterministic aliases and field-targeted query templates with hint provenance." />
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {indexlabSearchProfile?.status || 'not generated'}
          </div>
        </div>
        {!panelCollapsed.searchProfile && indexlabSearchProfile ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400">aliases</div>
                <div className="font-semibold">{formatNumber((indexlabSearchProfile.identity_aliases || []).length)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400">focus fields</div>
                <div className="font-semibold">{formatNumber((indexlabSearchProfile.focus_fields || []).length)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400">queries</div>
                <div className="font-semibold">
                  {formatNumber(indexlabSearchProfile.selected_query_count || indexlabSearchProfileRows.length)}
                </div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400">generated</div>
                <div className="font-semibold">{formatDateTime(indexlabSearchProfile.generated_at || null)}</div>
              </div>
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              llm query planner {indexlabSearchProfile.llm_query_planning ? 'enabled' : 'off'}
              {indexlabSearchProfile.llm_query_model ? ` (${indexlabSearchProfile.llm_query_model})` : ''}
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 p-2 text-xs">
              <div className="text-gray-500 dark:text-gray-400">identity aliases</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {(indexlabSearchProfile.identity_aliases || []).length === 0 ? (
                  <span className="text-gray-500 dark:text-gray-400">no aliases</span>
                ) : (
                  (indexlabSearchProfile.identity_aliases || []).slice(0, 16).map((row) => (
                    <span key={row.alias} className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                      {row.alias}
                    </span>
                  ))
                )}
              </div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
              <div className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                Query Plan ({formatNumber(indexlabSearchProfileRows.length)} rows)
              </div>
              <table className="mt-2 min-w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <th className="py-1 pr-3">query</th>
                    <th className="py-1 pr-3">hint source</th>
                    <th className="py-1 pr-3">target fields</th>
                    <th className="py-1 pr-3">doc hint</th>
                    <th className="py-1 pr-3">hits</th>
                  </tr>
                </thead>
                <tbody>
                  {indexlabSearchProfileRows.length === 0 && (
                    <tr>
                      <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={5}>no query rows yet</td>
                    </tr>
                  )}
                  {indexlabSearchProfileRows.slice(0, 40).map((row) => (
                    <tr key={row.query} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-1 pr-3 font-mono truncate max-w-[42rem]" title={row.query}>{row.query}</td>
                      <td className="py-1 pr-3">{row.hint_source || '-'}</td>
                      <td className="py-1 pr-3">
                        {(row.target_fields || []).length > 0 ? (row.target_fields || []).slice(0, 4).join(', ') : '-'}
                      </td>
                      <td className="py-1 pr-3">{row.doc_hint || '-'}</td>
                      <td className="py-1 pr-3">{formatNumber(Number(row.result_count || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : !panelCollapsed.searchProfile ? (
          <div className="text-xs text-gray-500 dark:text-gray-400">no Search Profile payload yet for this run</div>
        ) : null}
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3" style={{ order: 40 }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center text-sm font-semibold text-gray-900 dark:text-gray-100">
            <button
              onClick={() => togglePanel('eventStream')}
              className="inline-flex items-center justify-center w-5 h-5 mr-1 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              title={panelCollapsed.eventStream ? 'Open panel' : 'Close panel'}
            >
              {panelCollapsed.eventStream ? '+' : '-'}
            </button>
            <span>IndexLab Event Stream</span>
            <Tip text="Phase proof: stage timeline and URL fetch outcomes from run events." />
          </div>
          <ActivityGauge
            label="stream activity"
            currentPerMin={eventStreamActivity.currentPerMin}
            peakPerMin={eventStreamActivity.peakPerMin}
            active={processRunning}
          />
          <div className="flex items-center gap-2">
            <select
              value={selectedIndexLabRunId}
              onChange={(e) => setSelectedIndexLabRunId(e.target.value)}
              className="px-2 py-1 text-xs border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            >
              <option value="">select run</option>
              {indexlabRuns.map((row) => (
                <option key={row.run_id} value={row.run_id}>
                  {row.run_id} {row.product_id ? `| ${row.product_id}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
        {!panelCollapsed.eventStream ? (
          <>

        {selectedIndexLabRun ? (
          <div className="text-xs text-gray-600 dark:text-gray-300 rounded border border-gray-200 dark:border-gray-700 p-2">
            run: <span className="font-mono">{selectedIndexLabRun.run_id}</span>
            {selectedIndexLabRun.product_id ? <span className="font-mono"> | product {selectedIndexLabRun.product_id}</span> : null}
            {selectedIndexLabRun.started_at ? <span> | started {formatDateTime(selectedIndexLabRun.started_at)}</span> : null}
            {selectedIndexLabRun.ended_at ? <span> | ended {formatDateTime(selectedIndexLabRun.ended_at)}</span> : null}
            {selectedIndexLabRun.started_at ? <span> | runtime {selectedRunLiveDuration}</span> : null}
            <span> | status {selectedIndexLabRun.status || 'unknown'}</span>
          </div>
        ) : (
          <div className="text-xs text-gray-500 dark:text-gray-400">no indexlab run selected</div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
          <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs">
            <div className="text-gray-500 dark:text-gray-400">checked</div>
            <div className="font-semibold">{formatNumber(indexlabSummary.counters.pages_checked)}</div>
          </div>
          <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs">
            <div className="text-gray-500 dark:text-gray-400">fetched ok</div>
            <div className="font-semibold">{formatNumber(indexlabSummary.counters.fetched_ok)}</div>
          </div>
          <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs">
            <div className="text-gray-500 dark:text-gray-400">404</div>
            <div className="font-semibold">{formatNumber(indexlabSummary.counters.fetched_404)}</div>
          </div>
          <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs">
            <div className="text-gray-500 dark:text-gray-400">blocked</div>
            <div className="font-semibold">{formatNumber(indexlabSummary.counters.fetched_blocked)}</div>
          </div>
          <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs">
            <div className="text-gray-500 dark:text-gray-400">fetch errors</div>
            <div className="font-semibold">{formatNumber(indexlabSummary.counters.fetched_error)}</div>
          </div>
          <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs">
            <div className="text-gray-500 dark:text-gray-400">parsed</div>
            <div className="font-semibold">{formatNumber(indexlabSummary.counters.parse_completed)}</div>
          </div>
          <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs">
            <div className="text-gray-500 dark:text-gray-400">indexed</div>
            <div className="font-semibold">{formatNumber(indexlabSummary.counters.indexed_docs)}</div>
          </div>
          <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs">
            <div className="text-gray-500 dark:text-gray-400">fields filled</div>
            <div className="font-semibold">{formatNumber(indexlabSummary.counters.fields_filled)}</div>
          </div>
        </div>

        <div className="rounded border border-gray-200 dark:border-gray-700 p-2">
          <div className="text-xs font-semibold text-gray-800 dark:text-gray-200">Stage Timeline</div>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2 text-xs">
            {(['search', 'fetch', 'parse', 'index'] as const).map((stage) => {
              const row = indexlabSummary.stageWindows[stage];
              const hasStart = Boolean(row.started_at);
              const hasEnd = Boolean(row.ended_at);
              return (
                <div key={stage} className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                  <div className="font-semibold">{stage}</div>
                  <div className="text-gray-500 dark:text-gray-400">
                    {hasStart ? `start ${formatDateTime(row.started_at)}` : 'start -'}
                  </div>
                  <div className="text-gray-500 dark:text-gray-400">
                    {hasEnd ? `end ${formatDateTime(row.ended_at)}` : (hasStart ? 'running' : 'not started')}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
          <div className="text-xs font-semibold text-gray-800 dark:text-gray-200">
            Recent URL Jobs ({formatNumber(indexlabSummary.recentJobs.length)} shown)
          </div>
          <table className="mt-2 min-w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="py-1 pr-3">url</th>
                <th className="py-1 pr-3">status</th>
                <th className="py-1 pr-3">http</th>
                <th className="py-1 pr-3">ms</th>
                <th className="py-1 pr-3">started</th>
                <th className="py-1 pr-3">finished</th>
              </tr>
            </thead>
            <tbody>
              {indexlabSummary.recentJobs.length === 0 && (
                <tr>
                  <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={6}>no url jobs yet</td>
                </tr>
              )}
              {indexlabSummary.recentJobs.map((row) => (
                <tr key={row.url} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="py-1 pr-3 font-mono truncate max-w-[32rem]" title={row.url}>{row.url}</td>
                  <td className="py-1 pr-3">{row.status}</td>
                  <td className="py-1 pr-3">{row.status_code || '-'}</td>
                  <td className="py-1 pr-3">{row.ms || '-'}</td>
                  <td className="py-1 pr-3">{formatDateTime(row.started_at)}</td>
                  <td className="py-1 pr-3">{formatDateTime(row.finished_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
          </>
        ) : null}
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3" style={{ order: 50 }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center text-sm font-semibold text-gray-900 dark:text-gray-100">
            <button
              onClick={() => togglePanel('needset')}
              className="inline-flex items-center justify-center w-5 h-5 mr-1 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              title={panelCollapsed.needset ? 'Open panel' : 'Close panel'}
            >
              {panelCollapsed.needset ? '+' : '-'}
            </button>
            <span>NeedSet (Phase 01)</span>
            <Tip text="Field-level deficits with tier/confidence/evidence reasons and priority score." />
          </div>
          <ActivityGauge
            label="needset activity"
            currentPerMin={needsetActivity.currentPerMin}
            peakPerMin={needsetActivity.peakPerMin}
            active={processRunning}
            tooltip="Rate of NeedSet recompute/index-related activity events."
          />
        </div>
        {!panelCollapsed.needset ? (
          <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
            <div className="text-gray-500 dark:text-gray-400 flex items-center">needset size<Tip text="Count of fields currently in deficit and needing more work." /></div>
            <div className="font-semibold">{formatNumber(Number(indexlabNeedset?.needset_size || 0))}</div>
          </div>
          <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
            <div className="text-gray-500 dark:text-gray-400 flex items-center">total fields<Tip text="Total tracked fields in the contract snapshot for this run." /></div>
            <div className="font-semibold">{formatNumber(Number(indexlabNeedset?.total_fields || 0))}</div>
          </div>
          <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
            <div className="text-gray-500 dark:text-gray-400 flex items-center">rows<Tip text="Visible NeedSet rows after sorting and runtime merge." /></div>
            <div className="font-semibold">{formatNumber(indexlabNeedsetRows.length)}</div>
          </div>
          <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
            <div className="text-gray-500 dark:text-gray-400 flex items-center">generated<Tip text="Timestamp when the latest NeedSet payload was generated." /></div>
            <div className="font-semibold">{formatDateTime(indexlabNeedset?.generated_at || null)}</div>
          </div>
        </div>

        <div className="rounded border border-gray-200 dark:border-gray-700 p-2">
          <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center">needset size over time<Tip text="Sparkline of NeedSet size snapshots through the run." /></div>
          <NeedsetSparkline values={indexlabNeedsetSparklineValues} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
          <div className="rounded border border-gray-200 dark:border-gray-700 p-2">
            <div className="font-semibold text-gray-800 dark:text-gray-200 flex items-center">reason counts<Tip text="Why fields are still in NeedSet (missing, low_conf, tier_deficit, etc.)." /></div>
            <div className="mt-1 flex flex-wrap gap-1">
              {Object.entries(indexlabNeedset?.reason_counts || {}).length === 0 && (
                <span className="text-gray-500 dark:text-gray-400">no reason counts</span>
              )}
              {Object.entries(indexlabNeedset?.reason_counts || {}).map(([reason, count]) => (
                <span
                  key={reason}
                  className={`px-2 py-0.5 rounded ${needsetReasonBadge(reason)}`}
                >
                  {reason} {formatNumber(Number(count || 0))}
                </span>
              ))}
            </div>
          </div>
          <div className="rounded border border-gray-200 dark:border-gray-700 p-2">
            <div className="font-semibold text-gray-800 dark:text-gray-200 flex items-center">required level counts<Tip text="NeedSet rows grouped by required level: identity, critical, required, optional." /></div>
            <div className="mt-1 flex flex-wrap gap-1">
              {Object.entries(indexlabNeedset?.required_level_counts || {}).length === 0 && (
                <span className="text-gray-500 dark:text-gray-400">no required-level counts</span>
              )}
              {Object.entries(indexlabNeedset?.required_level_counts || {}).map(([level, count]) => {
                const badge = needsetRequiredLevelBadge(level);
                return (
                  <span key={level} className={`px-2 py-0.5 rounded ${badge.cls}`}>
                    {level} {formatNumber(Number(count || 0))}
                  </span>
                );
              })}
            </div>
          </div>
        </div>

        <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="py-1 pr-3">
                  <div className="inline-flex items-center">
                    <button onClick={() => setNeedsetSort('field_key')} className="hover:underline">field</button>
                    <Tip text="Canonical field key from the contract." />
                  </div>
                </th>
                <th className="py-1 pr-3">
                  <div className="inline-flex items-center">
                    <button onClick={() => setNeedsetSort('required_level')} className="hover:underline">required</button>
                    <Tip text="Contract priority level for this field." />
                  </div>
                </th>
                <th className="py-1 pr-3">
                  <div className="inline-flex items-center">
                    <button onClick={() => setNeedsetSort('need_score')} className="hover:underline">need score</button>
                    <Tip text="Priority score used to decide what to search/fetch next." />
                  </div>
                </th>
                <th className="py-1 pr-3">
                  <div className="inline-flex items-center">
                    <button onClick={() => setNeedsetSort('confidence')} className="hover:underline">confidence</button>
                    <Tip text="Current best confidence for the field value." />
                  </div>
                </th>
                <th className="py-1 pr-3">
                  <div className="inline-flex items-center">
                    <button onClick={() => setNeedsetSort('best_tier_seen')} className="hover:underline">best tier</button>
                    <Tip text="Highest source quality tier seen for this field so far." />
                  </div>
                </th>
                <th className="py-1 pr-3">
                  <div className="inline-flex items-center">
                    <button onClick={() => setNeedsetSort('refs')} className="hover:underline">refs</button>
                    <Tip text="Evidence refs found vs required minimum refs." />
                  </div>
                </th>
                <th className="py-1 pr-3">
                  <div className="inline-flex items-center">
                    <span>reasons</span>
                    <Tip text="Reason tags explaining why the field is still in NeedSet." />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {indexlabNeedsetRows.length === 0 && (
                <tr>
                  <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={7}>no NeedSet rows yet</td>
                </tr>
              )}
              {indexlabNeedsetRows.map((row) => {
                const reqBadge = needsetRequiredLevelBadge(row.required_level);
                const refsGap = (Number(row.refs_found) || 0) - (Number(row.min_refs) || 0);
                return (
                  <tr key={row.field_key} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-1 pr-3 font-mono">{row.field_key}</td>
                    <td className="py-1 pr-3">
                      <span className={`px-1.5 py-0.5 rounded ${reqBadge.cls}`}>
                        {reqBadge.short} {row.required_level || 'optional'}
                      </span>
                    </td>
                    <td className="py-1 pr-3">{formatNumber(Number(row.need_score || 0), 3)}</td>
                    <td className="py-1 pr-3">{row.confidence === null ? '-' : formatNumber(Number(row.confidence || 0), 3)}</td>
                    <td className="py-1 pr-3">{row.best_tier_seen === null ? '-' : formatNumber(Number(row.best_tier_seen || 0))}</td>
                    <td className="py-1 pr-3">
                      {formatNumber(Number(row.refs_found || 0))}/{formatNumber(Number(row.min_refs || 0))}
                      <span className={`ml-1 ${refsGap >= 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}>
                        ({refsGap >= 0 ? '+' : ''}{formatNumber(refsGap)})
                      </span>
                    </td>
                    <td className="py-1 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {(row.reasons || []).map((reason) => (
                          <span key={`${row.field_key}:${reason}`} className={`px-1.5 py-0.5 rounded ${needsetReasonBadge(reason)}`}>
                            {reason}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
          </>
        ) : null}
      </div>

      {actionError && (
        <div className="rounded border border-red-300 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300 px-3 py-2 text-xs" style={{ order: 100 }}>
          action failed: {actionError}
        </div>
      )}
    </div>
  );
}
