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
  identity_fingerprint?: string;
  identity_lock_status?: string;
  dedupe_mode?: string;
  phase_cursor?: string;
  startup_ms?: {
    first_event?: number | null;
    search_started?: number | null;
    fetch_started?: number | null;
    parse_started?: number | null;
    index_started?: number | null;
  };
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
  effective_confidence?: number | null;
  confidence_capped?: boolean;
  best_tier_seen: number | null;
  best_identity_match?: number | null;
  identity_state?: string;
  blocked_by?: string[];
  quarantined?: boolean;
  unknown_reason?: string | null;
  reason_payload?: {
    why_missing?: string | null;
    why_low_conf?: string | null;
    why_blocked?: string | null;
  };
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
  identity_lock_state?: {
    status?: string;
    confidence?: number;
    identity_gate_validated?: boolean;
    extraction_gate_open?: boolean;
    family_model_count?: number;
    ambiguity_level?: string;
    publishable?: boolean;
    publish_blockers?: string[];
    reason_codes?: string[];
    page_count?: number;
    max_match_score?: number;
    updated_at?: string;
  };
  identity_audit_rows?: Array<{
    source_id?: string;
    url?: string;
    decision?: string;
    confidence?: number;
    reason_codes?: string[];
    ts?: string;
  }>;
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
  variant_guard_terms?: string[];
  alias_reject_log?: Array<{
    alias?: string;
    source?: string;
    reason?: string;
    stage?: string;
    detail?: string;
  }>;
  query_reject_log?: Array<{
    query?: string;
    source?: string | string[];
    reason?: string;
    stage?: string;
    detail?: string;
  }>;
  query_guard?: {
    brand_tokens?: string[];
    model_tokens?: string[];
    required_digit_groups?: string[];
    accepted_query_count?: number;
    rejected_query_count?: number;
  };
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

interface IndexLabSerpSelectedUrlRow {
  url: string;
  query?: string;
  doc_kind?: string;
  tier_name?: string;
  score?: number;
  reason_codes?: string[];
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
  summary_only?: boolean;
  selected_urls?: IndexLabSerpSelectedUrlRow[];
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
  model_defaults?: {
    plan?: string;
    fast?: string;
    triage?: string;
    reasoning?: string;
    extract?: string;
    validate?: string;
    write?: string;
  };
  token_defaults?: {
    plan?: number;
    fast?: number;
    triage?: number;
    reasoning?: number;
    extract?: number;
    validate?: number;
    write?: number;
  };
  fallback_defaults?: {
    enabled?: boolean;
    plan?: string;
    extract?: string;
    validate?: string;
    write?: string;
    plan_tokens?: number;
    extract_tokens?: number;
    validate_tokens?: number;
    write_tokens?: number;
  };
  routing_snapshot?: Record<string, {
    primary?: {
      provider?: string | null;
      base_url?: string | null;
      model?: string | null;
      api_key_present?: boolean;
    } | null;
    fallback?: {
      provider?: string | null;
      base_url?: string | null;
      model?: string | null;
      api_key_present?: boolean;
    } | null;
  }>;
  model_options?: string[];
  token_presets?: number[];
  model_token_profiles?: Array<{
    model: string;
    default_output_tokens?: number;
    max_output_tokens?: number;
  }>;
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
  knob_defaults?: Partial<Record<string, {
    model?: string;
    token_cap?: number;
  }>>;
  pricing_meta?: {
    as_of?: string | null;
    sources?: Record<string, string>;
  };
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

interface IndexLabLlmTraceRow {
  id: string;
  ts?: string | null;
  phase?: string | null;
  role?: string | null;
  purpose?: string | null;
  status?: string | null;
  provider?: string | null;
  model?: string | null;
  retry_without_schema?: boolean;
  json_schema_requested?: boolean;
  max_tokens_applied?: number;
  target_fields?: string[];
  target_fields_count?: number;
  prompt_preview?: string;
  response_preview?: string;
  error?: string | null;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cached_prompt_tokens?: number;
    total_tokens?: number;
  };
  trace_file?: string;
}

interface IndexLabLlmTracesResponse {
  generated_at?: string;
  run_id?: string;
  category?: string;
  product_id?: string;
  count?: number;
  traces?: IndexLabLlmTraceRow[];
}

interface IndexingDomainChecklistUrlRow {
  url: string;
  checked_count?: number;
  selected_count?: number;
  fetch_started_count?: number;
  processed_count?: number;
  fetched_ok?: boolean;
  indexed?: boolean;
  err_404_count?: number;
  blocked_count?: number;
  parse_fail_count?: number;
  last_outcome?: string | null;
  last_status?: number | null;
  last_event?: string | null;
  last_ts?: string | null;
}

interface IndexingDomainChecklistRow {
  domain: string;
  site_kind: string;
  candidates_checked?: number;
  urls_selected?: number;
  pages_fetched_ok?: number;
  pages_indexed?: number;
  dedupe_hits?: number;
  err_404?: number;
  repeat_404_urls?: number;
  blocked_count?: number;
  repeat_blocked_urls?: number;
  parse_fail_count?: number;
  avg_fetch_ms?: number;
  p95_fetch_ms?: number;
  evidence_hits?: number;
  evidence_used?: number;
  fields_covered?: number;
  status?: string;
  host_budget_score?: number;
  host_budget_state?: string;
  cooldown_seconds_remaining?: number;
  outcome_counts?: Partial<Record<string, number>>;
  last_success_at?: string | null;
  next_retry_at?: string | null;
  url_count?: number;
  urls?: IndexingDomainChecklistUrlRow[];
}

interface IndexingDomainChecklistRepairRow {
  ts?: string | null;
  domain: string;
  query: string;
  status?: number;
  reason?: string | null;
  source_url?: string | null;
  cooldown_until?: string | null;
  doc_hint?: string | null;
  field_targets?: string[];
}

interface IndexingDomainChecklistBadPatternRow {
  domain: string;
  path: string;
  reason?: string;
  count?: number;
  last_ts?: string;
}

interface IndexingDomainChecklistResponse {
  command?: string;
  action?: string;
  category?: string | null;
  productId?: string | null;
  runId?: string | null;
  generated_at?: string;
  rows?: IndexingDomainChecklistRow[];
  domain_field_yield?: Array<{
    domain: string;
    field: string;
    evidence_used_count: number;
  }>;
  repair_queries?: IndexingDomainChecklistRepairRow[];
  bad_url_patterns?: IndexingDomainChecklistBadPatternRow[];
  notes?: string[];
}

interface IndexLabAutomationJobRow {
  job_id: string;
  job_type: string;
  priority?: number;
  status?: string;
  category?: string;
  product_id?: string;
  run_id?: string;
  field_targets?: string[];
  url?: string | null;
  domain?: string | null;
  query?: string | null;
  provider?: string | null;
  doc_hint?: string | null;
  dedupe_key?: string;
  source_signal?: string;
  scheduled_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  next_run_at?: string | null;
  attempt_count?: number;
  reason_tags?: string[];
  last_error?: string | null;
  notes?: string[];
}

interface IndexLabAutomationActionRow {
  ts?: string | null;
  event?: string | null;
  job_id?: string;
  job_type?: string;
  status?: string;
  source_signal?: string;
  priority?: number;
  detail?: string | null;
  domain?: string | null;
  url?: string | null;
  query?: string | null;
  field_targets?: string[];
  reason_tags?: string[];
}

interface IndexLabAutomationQueueResponse {
  generated_at?: string;
  run_id?: string;
  category?: string;
  product_id?: string;
  summary?: {
    total_jobs?: number;
    queue_depth?: number;
    active_jobs?: number;
    queued?: number;
    running?: number;
    done?: number;
    failed?: number;
    cooldown?: number;
    repair_search?: number;
    staleness_refresh?: number;
    deficit_rediscovery?: number;
    domain_backoff?: number;
  };
  policies?: {
    owner?: string;
    loops?: Record<string, boolean>;
  };
  jobs?: IndexLabAutomationJobRow[];
  actions?: IndexLabAutomationActionRow[];
}

interface IndexLabEvidenceIndexDocumentRow {
  source_id: string;
  source_url: string;
  source_host?: string;
  source_tier?: number | null;
  crawl_status?: string;
  http_status?: number | null;
  fetched_at?: string | null;
  run_id?: string | null;
  artifact_count?: number;
  hash_count?: number;
  unique_hashes?: number;
  assertion_count?: number;
  evidence_ref_count?: number;
}

interface IndexLabEvidenceIndexFieldRow {
  field_key: string;
  assertions?: number;
  evidence_refs?: number;
  distinct_sources?: number;
}

interface IndexLabEvidenceIndexSearchRow {
  source_id: string;
  source_url?: string;
  source_host?: string;
  source_tier?: number | null;
  run_id?: string | null;
  field_key?: string;
  context_kind?: string;
  assertion_id?: string;
  snippet_id?: string | null;
  evidence_url?: string | null;
  quote_preview?: string;
  snippet_preview?: string;
  value_preview?: string;
}

interface IndexLabEvidenceIndexResponse {
  generated_at?: string;
  run_id?: string;
  category?: string;
  product_id?: string;
  db_ready?: boolean;
  scope?: {
    mode?: string;
    run_match?: boolean;
    run_id?: string;
  };
  summary?: {
    documents?: number;
    artifacts?: number;
    artifacts_with_hash?: number;
    unique_hashes?: number;
    assertions?: number;
    evidence_refs?: number;
    fields_covered?: number;
  };
  documents?: IndexLabEvidenceIndexDocumentRow[];
  top_fields?: IndexLabEvidenceIndexFieldRow[];
  search?: {
    query?: string;
    limit?: number;
    count?: number;
    rows?: IndexLabEvidenceIndexSearchRow[];
    note?: string;
  };
}

interface IndexLabPhase07HitRow {
  rank?: number;
  score?: number;
  url?: string;
  host?: string;
  source_key?: string;
  tier?: number | null;
  tier_name?: string | null;
  doc_kind?: string;
  method?: string;
  key_path?: string | null;
  snippet_id?: string;
  snippet_hash?: string | null;
  source_id?: string | null;
  quote_preview?: string;
  retrieved_at?: string | null;
  evidence_refs?: string[];
  reason_badges?: string[];
  ranking_features?: {
    tier_weight?: number;
    doc_kind_weight?: number;
    method_weight?: number;
    anchor_matches?: string[];
    identity_matches?: string[];
    unit_match?: boolean;
    direct_field_match?: boolean;
    total_score?: number;
  };
}

interface IndexLabPhase07FieldRow {
  field_key: string;
  required_level?: string;
  need_score?: number;
  min_refs_required?: number;
  distinct_sources_required?: boolean;
  refs_selected?: number;
  distinct_sources_selected?: number;
  min_refs_satisfied?: boolean;
  hits_count?: number;
  tier_preference?: number[];
  anchors?: string[];
  unit_hint?: string | null;
  parse_template_hint?: string | null;
  component_hint?: string | null;
  doc_hints?: string[];
  retrieval_query?: string;
  hits?: IndexLabPhase07HitRow[];
  prime_sources?: IndexLabPhase07HitRow[];
}

interface IndexLabPhase07Response {
  run_id?: string;
  category?: string;
  product_id?: string;
  generated_at?: string;
  summary_only?: boolean;
  summary?: {
    fields_attempted?: number;
    fields_with_hits?: number;
    fields_satisfied_min_refs?: number;
    fields_unsatisfied_min_refs?: number;
    refs_selected_total?: number;
    distinct_sources_selected?: number;
    avg_hits_per_field?: number;
    evidence_pool_size?: number;
  };
  fields?: IndexLabPhase07FieldRow[];
}

interface IndexLabPhase08BatchRow {
  batch_id?: string;
  status?: string;
  route_reason?: string;
  model?: string;
  source_host?: string | null;
  source_url?: string | null;
  target_field_count?: number;
  snippet_count?: number;
  reference_count?: number;
  raw_candidate_count?: number;
  accepted_candidate_count?: number;
  dropped_missing_refs?: number;
  dropped_invalid_refs?: number;
  dropped_evidence_verifier?: number;
  min_refs_satisfied_count?: number;
  min_refs_total?: number;
  elapsed_ms?: number;
  error?: string;
}

interface IndexLabPhase08FieldContextRow {
  field_key?: string;
  required_level?: string;
  difficulty?: string;
  ai_mode?: string;
  parse_template_intent?: {
    template_id?: string | null;
  };
  evidence_policy?: {
    required?: boolean;
    min_evidence_refs?: number;
    distinct_sources_required?: boolean;
    tier_preference?: number[];
  };
}

interface IndexLabPhase08PrimeRow {
  field_key?: string;
  snippet_id?: string;
  source_id?: string | null;
  url?: string;
  quote_preview?: string;
}

interface IndexLabPhase08Response {
  run_id?: string;
  category?: string;
  product_id?: string;
  generated_at?: string;
  summary_only?: boolean;
  summary?: {
    batch_count?: number;
    batch_error_count?: number;
    schema_fail_rate?: number;
    raw_candidate_count?: number;
    accepted_candidate_count?: number;
    dangling_snippet_ref_count?: number;
    dangling_snippet_ref_rate?: number;
    evidence_policy_violation_count?: number;
    evidence_policy_violation_rate?: number;
    min_refs_satisfied_count?: number;
    min_refs_total?: number;
    min_refs_satisfied_rate?: number;
    validator_context_field_count?: number;
    validator_prime_source_rows?: number;
  };
  batches?: IndexLabPhase08BatchRow[];
  field_contexts?: Record<string, IndexLabPhase08FieldContextRow>;
  prime_sources?: {
    rows?: IndexLabPhase08PrimeRow[];
  };
}

type PanelKey = 'overview' | 'runtime' | 'picker' | 'searchProfile' | 'serpExplorer' | 'phase5' | 'phase6b' | 'phase6' | 'phase7' | 'phase8' | 'urlHealth' | 'llmOutput' | 'llmMetrics' | 'eventStream' | 'needset';
type PanelStateToken = 'live' | 'ready' | 'waiting';

const PANEL_KEYS: PanelKey[] = ['overview', 'runtime', 'picker', 'searchProfile', 'serpExplorer', 'phase5', 'phase6b', 'phase6', 'phase7', 'phase8', 'urlHealth', 'llmOutput', 'llmMetrics', 'eventStream', 'needset'];

const DEFAULT_PANEL_COLLAPSED: Record<PanelKey, boolean> = {
  overview: false,
  runtime: false,
  picker: false,
  searchProfile: true,
  serpExplorer: true,
  phase5: true,
  phase6b: true,
  phase6: true,
  phase7: true,
  phase8: true,
  urlHealth: true,
  llmOutput: true,
  llmMetrics: true,
  eventStream: true,
  needset: true
};

function normalizeToken(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function truthyFlag(value: unknown) {
  if (typeof value === 'boolean') return value;
  const token = normalizeToken(value);
  return token === '1' || token === 'true' || token === 'yes' || token === 'on';
}

function cleanVariant(value: string) {
  const text = String(value || '').trim();
  return text || '';
}

function displayVariant(value: string) {
  const cleaned = cleanVariant(value);
  return cleaned || '(base / no variant)';
}

function ambiguityLevelFromFamilyCount(count: number) {
  const safe = Math.max(0, Number.parseInt(String(count || 0), 10) || 0);
  if (safe >= 9) return 'extra_hard';
  if (safe >= 6) return 'very_hard';
  if (safe >= 4) return 'hard';
  if (safe >= 2) return 'medium';
  if (safe === 1) return 'easy';
  return 'unknown';
}

function formatNumber(value: number, digits = 0) {
  if (!Number.isFinite(value)) return '0';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  const digits = size >= 100 || idx === 0 ? 0 : 1;
  return `${formatNumber(size, digits)} ${units[idx]}`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  const ms = Date.parse(String(value));
  if (!Number.isFinite(ms)) return String(value);
  return new Date(ms).toLocaleString();
}

function providerFromModelToken(value: string) {
  const token = normalizeToken(value);
  if (!token) return 'openai';
  if (token.startsWith('gemini')) return 'gemini';
  if (token.startsWith('deepseek')) return 'deepseek';
  return 'openai';
}

function stripThinkTags(raw: string) {
  return String(raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function extractJsonCandidate(raw: string) {
  const text = String(raw || '').trim();
  if (!text) return '';
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }
  const firstBracket = text.indexOf('[');
  const lastBracket = text.lastIndexOf(']');
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    return text.slice(firstBracket, lastBracket + 1).trim();
  }
  return '';
}

function extractBalancedJsonSegments(raw: string) {
  const text = String(raw || '').trim();
  if (!text) return [];
  const segments: string[] = [];
  for (let start = 0; start < text.length; start += 1) {
    const open = text[start];
    if (open !== '{' && open !== '[') continue;
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaping = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaping) {
          escaping = false;
        } else if (ch === '\\') {
          escaping = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === open) {
        depth += 1;
        continue;
      }
      if (ch === close) {
        depth -= 1;
        if (depth === 0) {
          segments.push(text.slice(start, i + 1).trim());
          break;
        }
      }
    }
  }
  return segments;
}

function tryJsonParseCandidate(candidate: string): unknown | null {
  const token = String(candidate || '').trim();
  if (!token) return null;
  const variants = [token];
  const withoutTrailingCommas = token.replace(/,\s*([}\]])/g, '$1').trim();
  if (withoutTrailingCommas && withoutTrailingCommas !== token) {
    variants.push(withoutTrailingCommas);
  }
  for (const variant of variants) {
    try {
      return JSON.parse(variant);
    } catch {
      // continue
    }
  }
  return null;
}

function parseJsonLikeText(value: string): unknown | null {
  const text = String(value || '').trim();
  if (!text) return null;

  const candidates: string[] = [];
  const push = (candidate: string) => {
    const token = String(candidate || '').trim();
    if (!token) return;
    if (!candidates.includes(token)) candidates.push(token);
  };

  const stripped = stripThinkTags(text);
  push(text);
  push(stripped);
  push(extractJsonCandidate(text));
  push(extractJsonCandidate(stripped));

  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fenceMatch: RegExpExecArray | null = null;
  while ((fenceMatch = fenceRegex.exec(stripped)) !== null) {
    push(String(fenceMatch[1] || '').trim());
  }

  for (const segment of extractBalancedJsonSegments(stripped)) {
    push(segment);
  }
  for (const segment of extractBalancedJsonSegments(text)) {
    push(segment);
  }

  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const parsed = tryJsonParseCandidate(candidates[i]);
    if (parsed === null) continue;
    if (typeof parsed === 'string') {
      const nested = tryJsonParseCandidate(parsed);
      if (nested !== null) return nested;
    }
    return parsed;
  }

  return null;
}

function prettyJsonText(value: string) {
  const text = String(value || '').trim();
  if (!text) return '';
  const parsed = parseJsonLikeText(text);
  if (parsed !== null) {
    try {
      return JSON.stringify(parsed, null, 2);
    } catch {
      // fall through
    }
  }
  return stripThinkTags(text) || text;
}

function isJsonText(value: string) {
  return parseJsonLikeText(String(value || '')) !== null;
}

function hostFromUrl(value: string) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    return new URL(text).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function looksLikeGraphqlUrl(value: string) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return false;
  return text.includes('/graphql') || text.includes('graphql?') || text.includes('operationname=');
}

function looksLikeJsonUrl(value: string) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return false;
  return /\.json($|[?#])/i.test(text) || /[?&]format=json/i.test(text) || text.includes('/json');
}

function looksLikePdfUrl(value: string) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return false;
  return /\.pdf($|[?#])/i.test(text);
}

function llmPhaseLabel(phase: string) {
  const token = normalizeToken(phase);
  if (token === 'phase_02') return 'Phase 02';
  if (token === 'phase_03') return 'Phase 03';
  if (token === 'extract') return 'Extract';
  if (token === 'validate') return 'Validate';
  if (token === 'write') return 'Write';
  if (token === 'plan') return 'Plan';
  return 'Other';
}

function classifyLlmPhase(purpose: string, routeRole: string) {
  const reason = normalizeToken(purpose);
  const role = normalizeToken(routeRole);
  if (role === 'extract') return 'extract';
  if (role === 'validate') return 'validate';
  if (role === 'write') return 'write';
  if (role === 'plan') return 'plan';
  if (reason.includes('discovery_planner') || reason.includes('search_profile') || reason.includes('searchprofile')) {
    return 'phase_02';
  }
  if (reason.includes('serp') || reason.includes('triage') || reason.includes('rerank') || reason.includes('discovery_query_plan')) {
    return 'phase_03';
  }
  if (reason.includes('extract')) return 'extract';
  if (reason.includes('validate') || reason.includes('verify')) return 'validate';
  if (reason.includes('write') || reason.includes('summary')) return 'write';
  if (reason.includes('planner') || reason.includes('plan')) return 'plan';
  return 'other';
}

function llmPhaseBadgeClasses(phase: string) {
  const token = normalizeToken(phase);
  if (token === 'phase_02') return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
  if (token === 'phase_03') return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300';
  if (token === 'extract') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
  if (token === 'validate') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
  if (token === 'write') return 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300';
  if (token === 'plan') return 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300';
  return 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200';
}

function panelStateChipClasses(state: PanelStateToken) {
  if (state === 'live') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
  if (state === 'ready') return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
  return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
}

function hostBudgetStateBadgeClasses(state: string) {
  const token = normalizeToken(state);
  if (token === 'blocked') return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300';
  if (token === 'backoff') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
  if (token === 'degraded') return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300';
  if (token === 'active') return 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300';
  if (token === 'open') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
  return 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200';
}

function roleHelpText(role: string) {
  const token = normalizeToken(role);
  if (token === 'plan') return 'Builds search/discovery strategy and query plans before heavy fetch work.';
  if (token === 'extract') return 'Extracts candidate values from evidence snippets and structured artifacts.';
  if (token === 'validate') return 'Verifies extracted candidates against evidence and consistency gates.';
  if (token === 'write') return 'Builds summary/write outputs after extraction and validation.';
  return '';
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

function percentileMs(values: number[], percentile = 95) {
  const clean = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  if (clean.length === 0) return 0;
  const rank = Math.max(0, Math.min(clean.length - 1, Math.ceil((percentile / 100) * clean.length) - 1));
  return clean[rank] || 0;
}

function formatLatencyMs(value: number) {
  const safe = Math.max(0, Number(value) || 0);
  if (safe >= 1000) {
    return `${formatNumber(safe / 1000, 2)} s`;
  }
  return `${formatNumber(safe, 0)} ms`;
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
  if (token === 'tier_deficit' || token === 'tier_pref_unmet') return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300';
  if (token === 'min_refs_fail') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
  if (token === 'conflict') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
  if (token === 'low_conf') return 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300';
  if (token === 'identity_unlocked') return 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300';
  if (token === 'blocked_by_identity') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
  if (token === 'publish_gate_block') return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300';
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
  const clearIndexLabRun = useIndexLabStore((s) => s.clearRun);
  const queryClient = useQueryClient();

  const [profile, setProfile] = useState<'fast' | 'standard' | 'thorough'>('fast');
  const [fetchConcurrency, setFetchConcurrency] = useState('2');
  const [perHostMinDelayMs, setPerHostMinDelayMs] = useState('900');
  const [dynamicCrawleeEnabled, setDynamicCrawleeEnabled] = useState(true);
  const [crawleeHeadless, setCrawleeHeadless] = useState(true);
  const [crawleeRequestHandlerTimeoutSecs, setCrawleeRequestHandlerTimeoutSecs] = useState('45');
  const [dynamicFetchRetryBudget, setDynamicFetchRetryBudget] = useState('1');
  const [dynamicFetchRetryBackoffMs, setDynamicFetchRetryBackoffMs] = useState('500');
  const [dynamicFetchPolicyMapJson, setDynamicFetchPolicyMapJson] = useState('');
  const [resumeMode, setResumeMode] = useState<'auto' | 'force_resume' | 'start_over'>('auto');
  const [resumeWindowHours, setResumeWindowHours] = useState('48');
  const [reextractAfterHours, setReextractAfterHours] = useState('24');
  const [reextractIndexed, setReextractIndexed] = useState(true);
  const [discoveryEnabled, setDiscoveryEnabled] = useState(true);
  const [searchProvider, setSearchProvider] = useState<'none' | 'google' | 'bing' | 'searxng' | 'duckduckgo' | 'dual'>('duckduckgo');
  const [phase2LlmEnabled, setPhase2LlmEnabled] = useState(true);
  const [phase2LlmModel, setPhase2LlmModel] = useState('gpt-5.1-low');
  const [llmTokensPlan, setLlmTokensPlan] = useState(2048);
  const [phase3LlmTriageEnabled, setPhase3LlmTriageEnabled] = useState(true);
  const [phase3LlmModel, setPhase3LlmModel] = useState('gemini-2.5-flash');
  const [llmTokensTriage, setLlmTokensTriage] = useState(2048);
  const [llmModelFast, setLlmModelFast] = useState('gpt-5-low');
  const [llmTokensFast, setLlmTokensFast] = useState(2048);
  const [llmModelReasoning, setLlmModelReasoning] = useState('gpt-5.2-high');
  const [llmTokensReasoning, setLlmTokensReasoning] = useState(4096);
  const [llmModelExtract, setLlmModelExtract] = useState('gpt-5.1-high');
  const [llmTokensExtract, setLlmTokensExtract] = useState(2048);
  const [llmModelValidate, setLlmModelValidate] = useState('gpt-5.1-high');
  const [llmTokensValidate, setLlmTokensValidate] = useState(2048);
  const [llmModelWrite, setLlmModelWrite] = useState('gemini-2.5-flash-lite');
  const [llmTokensWrite, setLlmTokensWrite] = useState(2048);
  const [llmFallbackEnabled, setLlmFallbackEnabled] = useState(true);
  const [llmFallbackPlanModel, setLlmFallbackPlanModel] = useState('');
  const [llmTokensPlanFallback, setLlmTokensPlanFallback] = useState(2048);
  const [llmFallbackExtractModel, setLlmFallbackExtractModel] = useState('');
  const [llmTokensExtractFallback, setLlmTokensExtractFallback] = useState(2048);
  const [llmFallbackValidateModel, setLlmFallbackValidateModel] = useState('');
  const [llmTokensValidateFallback, setLlmTokensValidateFallback] = useState(2048);
  const [llmFallbackWriteModel, setLlmFallbackWriteModel] = useState('');
  const [llmTokensWriteFallback, setLlmTokensWriteFallback] = useState(2048);
  const [llmKnobsInitialized, setLlmKnobsInitialized] = useState(false);
  const [singleBrand, setSingleBrand] = useState('');
  const [singleModel, setSingleModel] = useState('');
  const [singleProductId, setSingleProductId] = useState('');
  const [selectedIndexLabRunId, setSelectedIndexLabRunId] = useState('');
  const [clearedRunViewId, setClearedRunViewId] = useState('');
  const [needsetSortKey, setNeedsetSortKey] = useState<'need_score' | 'field_key' | 'required_level' | 'confidence' | 'best_tier_seen' | 'refs'>('need_score');
  const [needsetSortDir, setNeedsetSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedLlmTraceId, setSelectedLlmTraceId] = useState('');
  const [activityNowMs, setActivityNowMs] = useState(() => Date.now());
  const [panelCollapsed, setPanelCollapsed] = useState<Record<PanelKey, boolean>>({ ...DEFAULT_PANEL_COLLAPSED });
  const [pendingPromptCollapsed, setPendingPromptCollapsed] = useState(true);
  const [lastResponseCollapsed, setLastResponseCollapsed] = useState(true);
  const [activeModelPricingCollapsed, setActiveModelPricingCollapsed] = useState(true);
  const [stopForceKill, setStopForceKill] = useState(true);
  const [replayPending, setReplayPending] = useState(false);
  const [phase6SearchQuery, setPhase6SearchQuery] = useState('');

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
  const selectedRunForChecklist = useMemo(
    () => indexlabRuns.find((row) => row.run_id === selectedIndexLabRunId) || null,
    [indexlabRuns, selectedIndexLabRunId]
  );
  const domainChecklistCategory = useMemo(() => {
    if (!isAll) return String(category || '').trim();
    return String(selectedRunForChecklist?.category || '').trim();
  }, [isAll, category, selectedRunForChecklist]);
  const runViewCleared = Boolean(
    selectedIndexLabRunId
    && selectedIndexLabRunId === clearedRunViewId
  );

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
    const newestCompletedRunId =
      indexlabRuns.find((row) => normalizeToken(row.status) === 'completed')?.run_id
      || newestRunId;
    setSelectedIndexLabRunId(newestCompletedRunId);
  }, [indexlabRuns, selectedIndexLabRunId, processStatus?.running]);

  useEffect(() => {
    if (!selectedIndexLabRunId) {
      if (clearedRunViewId) setClearedRunViewId('');
      return;
    }
    if (clearedRunViewId && clearedRunViewId !== selectedIndexLabRunId) {
      setClearedRunViewId('');
    }
  }, [selectedIndexLabRunId, clearedRunViewId]);

  const { data: indexlabEventsResp } = useQuery({
    queryKey: ['indexlab', 'run', selectedIndexLabRunId, 'events'],
    queryFn: () =>
      api.get<IndexLabRunEventsResponse>(
        `/indexlab/run/${encodeURIComponent(selectedIndexLabRunId)}/events?limit=3000`
      ),
    enabled: Boolean(selectedIndexLabRunId) && !runViewCleared,
    refetchInterval: 2000
  });

  const { data: indexlabNeedsetResp } = useQuery({
    queryKey: ['indexlab', 'run', selectedIndexLabRunId, 'needset'],
    queryFn: () =>
      api.get<IndexLabNeedSetResponse>(
        `/indexlab/run/${encodeURIComponent(selectedIndexLabRunId)}/needset`
      ),
    enabled: Boolean(selectedIndexLabRunId) && !runViewCleared,
    refetchInterval: 2000
  });
  const { data: indexlabSearchProfileResp } = useQuery({
    queryKey: ['indexlab', 'run', selectedIndexLabRunId, 'search-profile'],
    queryFn: () =>
      api.get<IndexLabSearchProfileResponse>(
        `/indexlab/run/${encodeURIComponent(selectedIndexLabRunId)}/search-profile`
      ),
    enabled: Boolean(selectedIndexLabRunId) && !runViewCleared,
    refetchInterval: 2000
  });
  const { data: indexlabSerpExplorerResp } = useQuery({
    queryKey: ['indexlab', 'run', selectedIndexLabRunId, 'serp'],
    queryFn: () =>
      api.get<IndexLabSerpExplorerResponse>(
        `/indexlab/run/${encodeURIComponent(selectedIndexLabRunId)}/serp`
      ),
    enabled: Boolean(selectedIndexLabRunId) && !runViewCleared,
    refetchInterval: 2000
  });
  const { data: indexlabLlmTracesResp } = useQuery({
    queryKey: ['indexlab', 'run', selectedIndexLabRunId, 'llm-traces'],
    queryFn: () =>
      api.get<IndexLabLlmTracesResponse>(
        `/indexlab/run/${encodeURIComponent(selectedIndexLabRunId)}/llm-traces?limit=120`
      ),
    enabled: Boolean(selectedIndexLabRunId) && !runViewCleared,
    refetchInterval: 2000
  });
  const { data: indexlabAutomationQueueResp } = useQuery({
    queryKey: ['indexlab', 'run', selectedIndexLabRunId, 'automation-queue'],
    queryFn: () =>
      api.get<IndexLabAutomationQueueResponse>(
        `/indexlab/run/${encodeURIComponent(selectedIndexLabRunId)}/automation-queue`
      ),
    enabled: Boolean(selectedIndexLabRunId) && !runViewCleared,
    refetchInterval: 2000
  });
  const normalizedPhase6SearchQuery = String(phase6SearchQuery || '').trim();
  const { data: indexlabEvidenceIndexResp } = useQuery({
    queryKey: ['indexlab', 'run', selectedIndexLabRunId, 'evidence-index', normalizedPhase6SearchQuery],
    queryFn: () => {
      const qp = new URLSearchParams();
      qp.set('limit', '60');
      if (normalizedPhase6SearchQuery) qp.set('q', normalizedPhase6SearchQuery);
      return api.get<IndexLabEvidenceIndexResponse>(
        `/indexlab/run/${encodeURIComponent(selectedIndexLabRunId)}/evidence-index?${qp.toString()}`
      );
    },
    enabled: Boolean(selectedIndexLabRunId) && !runViewCleared,
    refetchInterval: 2000
  });
  const { data: indexlabPhase07Resp } = useQuery({
    queryKey: ['indexlab', 'run', selectedIndexLabRunId, 'phase07-retrieval'],
    queryFn: () =>
      api.get<IndexLabPhase07Response>(
        `/indexlab/run/${encodeURIComponent(selectedIndexLabRunId)}/phase07-retrieval`
      ),
    enabled: Boolean(selectedIndexLabRunId) && !runViewCleared,
    refetchInterval: 2000
  });
  const { data: indexlabPhase08Resp } = useQuery({
    queryKey: ['indexlab', 'run', selectedIndexLabRunId, 'phase08-extraction'],
    queryFn: () =>
      api.get<IndexLabPhase08Response>(
        `/indexlab/run/${encodeURIComponent(selectedIndexLabRunId)}/phase08-extraction`
      ),
    enabled: Boolean(selectedIndexLabRunId) && !runViewCleared,
    refetchInterval: 2000
  });
  const { data: indexingDomainChecklistResp } = useQuery({
    queryKey: [
      'indexing',
      'domain-checklist',
      domainChecklistCategory,
      selectedIndexLabRunId,
      selectedRunForChecklist?.product_id || ''
    ],
    queryFn: () => {
      const qp = new URLSearchParams();
      if (selectedIndexLabRunId) qp.set('runId', selectedIndexLabRunId);
      if (selectedRunForChecklist?.product_id) qp.set('productId', selectedRunForChecklist.product_id);
      qp.set('windowMinutes', '180');
      qp.set('includeUrls', 'true');
      return api.get<IndexingDomainChecklistResponse>(
        `/indexing/domain-checklist/${encodeURIComponent(domainChecklistCategory)}?${qp.toString()}`
      );
    },
    enabled: Boolean(
      domainChecklistCategory
      && !runViewCleared
      && (selectedIndexLabRunId || selectedRunForChecklist?.product_id)
    ),
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
  const catalogFamilyCountLookup = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of catalogRows) {
      const brand = normalizeToken(row.brand);
      const model = normalizeToken(row.model);
      if (!brand || !model) continue;
      const key = `${brand}||${model}`;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [catalogRows]);
  const selectedAmbiguityMeter = useMemo(() => {
    const activeBrand = String(selectedCatalogProduct?.brand || singleBrand || '').trim();
    const activeModel = String(selectedCatalogProduct?.model || singleModel || '').trim();
    if (!activeBrand || !activeModel) {
      return {
        count: 0,
        level: 'unknown',
        label: 'unknown',
        badgeCls: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
        barCls: 'bg-gray-300 dark:bg-gray-600',
        widthPct: 0
      };
    }
    const key = `${normalizeToken(activeBrand)}||${normalizeToken(activeModel)}`;
    const count = Number(catalogFamilyCountLookup.get(key) || 1);
    const level = ambiguityLevelFromFamilyCount(count);
    if (level === 'easy') {
      return {
        count,
        level,
        label: 'easy',
        badgeCls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
        barCls: 'bg-emerald-500',
        widthPct: 34
      };
    }
    if (level === 'medium') {
      return {
        count,
        level,
        label: 'medium',
        badgeCls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
        barCls: 'bg-amber-500',
        widthPct: 67
      };
    }
    if (level === 'hard') {
      return {
        count,
        level,
        label: 'hard',
        badgeCls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
        barCls: 'bg-red-500',
        widthPct: 60
      };
    }
    if (level === 'very_hard') {
      return {
        count,
        level,
        label: 'very hard',
        badgeCls: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-300',
        barCls: 'bg-fuchsia-500',
        widthPct: 80
      };
    }
    if (level === 'extra_hard') {
      return {
        count,
        level,
        label: 'extra hard',
        badgeCls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
        barCls: 'bg-purple-500',
        widthPct: 100
      };
    }
    return {
      count,
      level: 'unknown',
      label: 'unknown',
      badgeCls: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
      barCls: 'bg-gray-300 dark:bg-gray-600',
      widthPct: 0
    };
  }, [catalogFamilyCountLookup, selectedCatalogProduct, singleBrand, singleModel]);

  const llmModelOptions = useMemo(() => {
    const rows = Array.isArray(indexingLlmConfig?.model_options)
      ? indexingLlmConfig.model_options.map((row) => String(row || '').trim()).filter(Boolean)
      : [];
    if (!rows.some((row) => normalizeToken(row) === normalizeToken('gemini-2.5-flash-lite'))) {
      rows.unshift('gemini-2.5-flash-lite');
    }
    return [...new Set(rows)];
  }, [indexingLlmConfig]);

  const llmTokenPresetOptions = useMemo(() => {
    const raw = Array.isArray(indexingLlmConfig?.token_presets)
      ? indexingLlmConfig.token_presets
      : [256, 384, 512, 768, 1024, 1536, 2048, 3072, 4096, 8192];
    const cleaned = raw
      .map((value) => Number.parseInt(String(value || ''), 10))
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b);
    return [...new Set(cleaned)];
  }, [indexingLlmConfig]);

  const llmTokenProfileLookup = useMemo(() => {
    const map = new Map<string, { default_output_tokens: number; max_output_tokens: number }>();
    for (const row of indexingLlmConfig?.model_token_profiles || []) {
      const token = normalizeToken(row.model);
      if (!token) continue;
      map.set(token, {
        default_output_tokens: Math.max(0, Number(row.default_output_tokens || 0)),
        max_output_tokens: Math.max(0, Number(row.max_output_tokens || 0))
      });
    }
    return map;
  }, [indexingLlmConfig]);

  const resolveModelTokenDefaults = (model: string) => {
    const profile = llmTokenProfileLookup.get(normalizeToken(model));
    const globalDefault = Number(indexingLlmConfig?.token_defaults?.plan || 2048);
    const default_output_tokens = Math.max(128, Number(profile?.default_output_tokens || globalDefault));
    const max_output_tokens = Math.max(default_output_tokens, Number(profile?.max_output_tokens || 8192));
    return {
      default_output_tokens,
      max_output_tokens
    };
  };

  const clampTokenForModel = (model: string, value: number) => {
    const defaults = resolveModelTokenDefaults(model);
    const safeValue = Math.max(128, Number.parseInt(String(value || 0), 10) || defaults.default_output_tokens);
    return Math.min(safeValue, defaults.max_output_tokens);
  };

  const selectedRunLlmMetrics = useMemo(() => {
    const runs = Array.isArray(indexingLlmMetrics?.by_run) ? indexingLlmMetrics.by_run : [];
    if (runs.length === 0) return null;
    if (selectedIndexLabRunId) {
      const direct = runs.find((row) => String(row.run_id || '').trim() === selectedIndexLabRunId);
      if (direct) return direct;
    }
    return runs[0];
  }, [indexingLlmMetrics, selectedIndexLabRunId]);

  const modelPricingLookup = useMemo(() => {
    const map = new Map<string, { provider?: string; input_per_1m?: number; output_per_1m?: number; cached_input_per_1m?: number }>();
    for (const row of indexingLlmConfig?.model_pricing || []) {
      const token = normalizeToken(row.model);
      if (!token) continue;
      map.set(token, row);
    }
    return map;
  }, [indexingLlmConfig]);

  const selectedLlmPricingRows = useMemo(() => {
    const entries = [
      { knob: 'phase 02 planner', knob_key: 'phase_02_planner', model: phase2LlmModel, token_cap: llmTokensPlan },
      { knob: 'phase 03 triage', knob_key: 'phase_03_triage', model: phase3LlmModel, token_cap: llmTokensTriage },
      { knob: 'fast pass', knob_key: 'fast_pass', model: llmModelFast, token_cap: llmTokensFast },
      { knob: 'reasoning pass', knob_key: 'reasoning_pass', model: llmModelReasoning, token_cap: llmTokensReasoning },
      { knob: 'extract role', knob_key: 'extract_role', model: llmModelExtract, token_cap: llmTokensExtract },
      { knob: 'validate role', knob_key: 'validate_role', model: llmModelValidate, token_cap: llmTokensValidate },
      { knob: 'write role', knob_key: 'write_role', model: llmModelWrite, token_cap: llmTokensWrite },
      ...(llmFallbackEnabled ? [
        { knob: 'fallback plan', knob_key: 'fallback_plan', model: llmFallbackPlanModel, token_cap: llmTokensPlanFallback },
        { knob: 'fallback extract', knob_key: 'fallback_extract', model: llmFallbackExtractModel, token_cap: llmTokensExtractFallback },
        { knob: 'fallback validate', knob_key: 'fallback_validate', model: llmFallbackValidateModel, token_cap: llmTokensValidateFallback },
        { knob: 'fallback write', knob_key: 'fallback_write', model: llmFallbackWriteModel, token_cap: llmTokensWriteFallback }
      ] : [])
    ];
    const knobDefaults = indexingLlmConfig?.knob_defaults || {};
    return entries
      .map((row) => {
        const model = String(row.model || '').trim();
        if (!model) return null;
        const pricing = modelPricingLookup.get(normalizeToken(model));
        const defaults = indexingLlmConfig?.pricing_defaults || {};
        const knobDefault = knobDefaults[row.knob_key] || {};
        const defaultModel = String(knobDefault.model || '').trim();
        const defaultTokenCap = Math.max(0, Number(knobDefault.token_cap || 0));
        const usesDefaultModel = defaultModel
          ? normalizeToken(defaultModel) === normalizeToken(model)
          : false;
        const usesDefaultTokenCap = defaultTokenCap > 0
          ? defaultTokenCap === Math.max(0, Number(row.token_cap || 0))
          : false;
        return {
          knob: row.knob,
          knob_key: row.knob_key,
          model,
          default_model: defaultModel || null,
          uses_default_model: usesDefaultModel,
          default_token_cap: defaultTokenCap || null,
          uses_default_token_cap: usesDefaultTokenCap,
          provider: pricing?.provider || providerFromModelToken(model),
          token_cap: Math.max(0, Number(row.token_cap || 0)),
          input_per_1m: Number(pricing?.input_per_1m ?? defaults.input_per_1m ?? 0),
          output_per_1m: Number(pricing?.output_per_1m ?? defaults.output_per_1m ?? 0),
          cached_input_per_1m: Number(pricing?.cached_input_per_1m ?? defaults.cached_input_per_1m ?? 0)
        };
      })
      .filter((row): row is {
        knob: string;
        knob_key: string;
        model: string;
        default_model: string | null;
        uses_default_model: boolean;
        default_token_cap: number | null;
        uses_default_token_cap: boolean;
        provider: string;
        token_cap: number;
        input_per_1m: number;
        output_per_1m: number;
        cached_input_per_1m: number;
      } => Boolean(row));
  }, [
    phase2LlmModel,
    phase3LlmModel,
    llmModelFast,
    llmModelReasoning,
    llmModelExtract,
    llmModelValidate,
    llmModelWrite,
    llmFallbackEnabled,
    llmFallbackPlanModel,
    llmFallbackExtractModel,
    llmFallbackValidateModel,
    llmFallbackWriteModel,
    llmTokensPlan,
    llmTokensTriage,
    llmTokensFast,
    llmTokensReasoning,
    llmTokensExtract,
    llmTokensValidate,
    llmTokensWrite,
    llmTokensPlanFallback,
    llmTokensExtractFallback,
    llmTokensValidateFallback,
    llmTokensWriteFallback,
    modelPricingLookup,
    indexingLlmConfig
  ]);

  const llmRouteSnapshotRows = useMemo(() => {
    const snapshot = indexingLlmConfig?.routing_snapshot || {};
    const roles = ['plan', 'extract', 'validate', 'write'];
    return roles.map((role) => {
      const row = snapshot[role] || {};
      const primary = row.primary || {};
      const fallback = row.fallback || {};
      return {
        role,
        primaryProvider: String(primary.provider || ''),
        primaryModel: String(primary.model || ''),
        fallbackProvider: String(fallback.provider || ''),
        fallbackModel: String(fallback.model || '')
      };
    });
  }, [indexingLlmConfig]);

  const llmTraceRows = useMemo(() => {
    return Array.isArray(indexlabLlmTracesResp?.traces) ? indexlabLlmTracesResp.traces : [];
  }, [indexlabLlmTracesResp]);

  const selectedLlmTrace = useMemo(() => {
    if (!llmTraceRows.length) return null;
    if (selectedLlmTraceId) {
      const found = llmTraceRows.find((row) => row.id === selectedLlmTraceId);
      if (found) return found;
    }
    return llmTraceRows[0];
  }, [llmTraceRows, selectedLlmTraceId]);

  useEffect(() => {
    if (!indexingLlmConfig || llmKnobsInitialized) return;
    const defaults = indexingLlmConfig.model_defaults || {};
    const tokenDefaults = indexingLlmConfig.token_defaults || {};
    const phase2Default = String(indexingLlmConfig.phase2?.model_default || defaults.plan || '').trim();
    const phase3Default = String(indexingLlmConfig.phase3?.model_default || defaults.triage || '').trim();
    const fallbackModel = phase2Default || phase3Default || llmModelOptions[0] || 'gpt-5.1-low';
    const fallbackDefaults = indexingLlmConfig.fallback_defaults || {};
    const planModel = phase2Default || fallbackModel;
    const triageModel = phase3Default || fallbackModel;
    const fastModel = String(defaults.fast || fallbackModel).trim() || fallbackModel;
    const reasoningModel = String(defaults.reasoning || fallbackModel).trim() || fallbackModel;
    const extractModel = String(defaults.extract || fallbackModel).trim() || fallbackModel;
    const validateModel = String(defaults.validate || fallbackModel).trim() || fallbackModel;
    const writeModel = String(defaults.write || fallbackModel).trim() || fallbackModel;

    setPhase2LlmEnabled(true);
    setPhase3LlmTriageEnabled(true);
    setPhase2LlmModel(planModel);
    setPhase3LlmModel(triageModel);
    setLlmModelFast(fastModel);
    setLlmModelReasoning(reasoningModel);
    setLlmModelExtract(extractModel);
    setLlmModelValidate(validateModel);
    setLlmModelWrite(writeModel);
    setLlmTokensPlan(clampTokenForModel(planModel, Number(tokenDefaults.plan || resolveModelTokenDefaults(planModel).default_output_tokens)));
    setLlmTokensTriage(clampTokenForModel(triageModel, Number(tokenDefaults.triage || resolveModelTokenDefaults(triageModel).default_output_tokens)));
    setLlmTokensFast(clampTokenForModel(fastModel, Number(tokenDefaults.fast || resolveModelTokenDefaults(fastModel).default_output_tokens)));
    setLlmTokensReasoning(clampTokenForModel(reasoningModel, Number(tokenDefaults.reasoning || resolveModelTokenDefaults(reasoningModel).default_output_tokens)));
    setLlmTokensExtract(clampTokenForModel(extractModel, Number(tokenDefaults.extract || resolveModelTokenDefaults(extractModel).default_output_tokens)));
    setLlmTokensValidate(clampTokenForModel(validateModel, Number(tokenDefaults.validate || resolveModelTokenDefaults(validateModel).default_output_tokens)));
    setLlmTokensWrite(clampTokenForModel(writeModel, Number(tokenDefaults.write || resolveModelTokenDefaults(writeModel).default_output_tokens)));
    setLlmFallbackEnabled(Boolean(fallbackDefaults.enabled));
    setLlmFallbackPlanModel(String(fallbackDefaults.plan || '').trim());
    setLlmFallbackExtractModel(String(fallbackDefaults.extract || '').trim());
    setLlmFallbackValidateModel(String(fallbackDefaults.validate || '').trim());
    setLlmFallbackWriteModel(String(fallbackDefaults.write || '').trim());
    setLlmTokensPlanFallback(
      clampTokenForModel(
        String(fallbackDefaults.plan || planModel).trim(),
        Number(fallbackDefaults.plan_tokens || resolveModelTokenDefaults(String(fallbackDefaults.plan || planModel).trim()).default_output_tokens)
      )
    );
    setLlmTokensExtractFallback(
      clampTokenForModel(
        String(fallbackDefaults.extract || extractModel).trim(),
        Number(fallbackDefaults.extract_tokens || resolveModelTokenDefaults(String(fallbackDefaults.extract || extractModel).trim()).default_output_tokens)
      )
    );
    setLlmTokensValidateFallback(
      clampTokenForModel(
        String(fallbackDefaults.validate || validateModel).trim(),
        Number(fallbackDefaults.validate_tokens || resolveModelTokenDefaults(String(fallbackDefaults.validate || validateModel).trim()).default_output_tokens)
      )
    );
    setLlmTokensWriteFallback(
      clampTokenForModel(
        String(fallbackDefaults.write || writeModel).trim(),
        Number(fallbackDefaults.write_tokens || resolveModelTokenDefaults(String(fallbackDefaults.write || writeModel).trim()).default_output_tokens)
      )
    );
    setLlmKnobsInitialized(true);
  }, [indexingLlmConfig, llmKnobsInitialized, llmModelOptions]);

  useEffect(() => {
    setSingleBrand('');
    setSingleModel('');
    setSingleProductId('');
    setSelectedIndexLabRunId('');
    setSelectedLlmTraceId('');
  }, [category]);

  useEffect(() => {
    if (!llmTraceRows.length) {
      if (selectedLlmTraceId) setSelectedLlmTraceId('');
      return;
    }
    if (!selectedLlmTraceId || !llmTraceRows.some((row) => row.id === selectedLlmTraceId)) {
      setSelectedLlmTraceId(llmTraceRows[0].id);
    }
  }, [llmTraceRows, selectedLlmTraceId]);

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
    if (runViewCleared) return [];
    return liveIndexLabByRun[selectedIndexLabRunId] || [];
  }, [liveIndexLabByRun, selectedIndexLabRunId, runViewCleared]);

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
  const selectedRunIdentityFingerprintShort = useMemo(() => {
    const token = String(selectedIndexLabRun?.identity_fingerprint || '').trim();
    if (!token) return '';
    if (token.length <= 28) return token;
    return `${token.slice(0, 24)}...`;
  }, [selectedIndexLabRun]);
  const selectedRunStartupMs = useMemo(() => {
    const parseMetric = (value: unknown) => {
      const num = Number.parseInt(String(value ?? ''), 10);
      return Number.isFinite(num) && num >= 0 ? num : null;
    };
    const startupRaw = selectedIndexLabRun?.startup_ms && typeof selectedIndexLabRun.startup_ms === 'object'
      ? selectedIndexLabRun.startup_ms
      : {};
    const fromMeta = {
      first_event: parseMetric(startupRaw.first_event),
      search_started: parseMetric(startupRaw.search_started),
      fetch_started: parseMetric(startupRaw.fetch_started),
      parse_started: parseMetric(startupRaw.parse_started),
      index_started: parseMetric(startupRaw.index_started)
    };
    if (Object.values(fromMeta).some((value) => value !== null)) {
      return fromMeta;
    }

    const startedMs = Date.parse(String(selectedIndexLabRun?.started_at || ''));
    if (!Number.isFinite(startedMs)) {
      return fromMeta;
    }
    const firstEventTs = timedIndexlabEvents.length > 0
      ? Math.min(...timedIndexlabEvents.map((evt) => evt.tsMs))
      : NaN;
    const stageStartedAt: Record<string, string> = {
      search: '',
      fetch: '',
      parse: '',
      index: ''
    };
    for (const evt of timedIndexlabEvents) {
      if (!(evt.stage in stageStartedAt)) continue;
      if (!evt.event.endsWith('_started')) continue;
      if (!stageStartedAt[evt.stage]) {
        stageStartedAt[evt.stage] = String(evt.row.ts || '').trim();
      }
    }
    const stageDelta = (value: string) => {
      const stageMs = Date.parse(String(value || ''));
      return Number.isFinite(stageMs) ? Math.max(0, stageMs - startedMs) : null;
    };
    return {
      first_event: Number.isFinite(firstEventTs) ? Math.max(0, firstEventTs - startedMs) : null,
      search_started: stageDelta(stageStartedAt.search),
      fetch_started: stageDelta(stageStartedAt.fetch),
      parse_started: stageDelta(stageStartedAt.parse),
      index_started: stageDelta(stageStartedAt.index)
    };
  }, [selectedIndexLabRun, timedIndexlabEvents]);
  const selectedRunStartupSummary = useMemo(() => {
    const msLabel = (value: number | null) => (value === null ? '-' : `${formatNumber(value)}ms`);
    return `startup(ms) first ${msLabel(selectedRunStartupMs.first_event)} | search ${msLabel(selectedRunStartupMs.search_started)} | fetch ${msLabel(selectedRunStartupMs.fetch_started)} | parse ${msLabel(selectedRunStartupMs.parse_started)} | index ${msLabel(selectedRunStartupMs.index_started)}`;
  }, [selectedRunStartupMs]);

  const activeMonitorProductId = String(
    singleProductId
    || selectedIndexLabRun?.product_id
    || ''
  ).trim();
  const processRunning = Boolean(processStatus?.running);

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
  const llmActivity = useMemo(
    () =>
      computeActivityStats(
        timedIndexlabEvents,
        activityNowMs,
        (event) => event.stage === 'llm'
      ),
    [timedIndexlabEvents, activityNowMs]
  );

  const pendingLlmRows = useMemo(() => {
    const rowsByKey = new Map<string, {
      key: string;
      reason: string;
      routeRole: string;
      model: string;
      provider: string;
      pending: number;
      firstStartedAtMs: number;
      lastEventAtMs: number;
      promptPreview: string;
    }>();
    for (const evt of indexlabEvents) {
      if (normalizeToken(evt.stage) !== 'llm') continue;
      const payload = evt?.payload && typeof evt.payload === 'object'
        ? evt.payload as Record<string, unknown>
        : {};
      const tsMs = Date.parse(String(evt.ts || ''));
      const eventMs = Number.isFinite(tsMs) ? tsMs : 0;
      const reason = String(payload.reason || payload.purpose || '').trim() || 'unknown';
      const explicitRouteRole = String(payload.route_role || '').trim();
      const inferredPhase = classifyLlmPhase(reason, explicitRouteRole);
      const routeRole = explicitRouteRole
        || (['extract', 'validate', 'write', 'plan'].includes(inferredPhase) ? inferredPhase : '');
      const model = String(payload.model || '').trim() || 'unknown';
      const provider = String(payload.provider || '').trim() || providerFromModelToken(model);
      const promptPreview = String(payload.prompt_preview || '').trim();
      const key = `${reason}||${routeRole || '-'}||${model}||${provider}`;
      const row = rowsByKey.get(key) || {
        key,
        reason,
        routeRole,
        model,
        provider,
        pending: 0,
        firstStartedAtMs: 0,
        lastEventAtMs: 0,
        promptPreview: ''
      };
      const eventName = normalizeToken(evt.event);
      if (eventName === 'llm_started') {
        row.pending += 1;
        if (promptPreview) {
          row.promptPreview = promptPreview;
        }
        if (eventMs > 0 && (!row.firstStartedAtMs || eventMs < row.firstStartedAtMs)) {
          row.firstStartedAtMs = eventMs;
        }
      } else if (eventName === 'llm_finished' || eventName === 'llm_failed') {
        row.pending = Math.max(0, row.pending - 1);
      }
      if (eventMs > 0) {
        row.lastEventAtMs = Math.max(row.lastEventAtMs || 0, eventMs);
      }
      rowsByKey.set(key, row);
    }
    const stalePendingGraceMs = 30_000;
    return [...rowsByKey.values()]
      .map((row) => {
        if (processRunning) return row;
        const ageMs = row.lastEventAtMs > 0 ? Math.max(0, activityNowMs - row.lastEventAtMs) : Number.POSITIVE_INFINITY;
        if (row.pending > 0 && ageMs > stalePendingGraceMs) {
          return {
            ...row,
            pending: 0
          };
        }
        return row;
      })
      .filter((row) => row.pending > 0)
      .sort((a, b) => (
        b.pending - a.pending
        || b.lastEventAtMs - a.lastEventAtMs
        || a.model.localeCompare(b.model)
      ));
  }, [indexlabEvents, processRunning, activityNowMs]);
  const pendingLlmTotal = useMemo(
    () => pendingLlmRows.reduce((sum, row) => sum + Math.max(0, Number(row.pending || 0)), 0),
    [pendingLlmRows]
  );
  const pendingLlmPeak = useMemo(
    () => Math.max(1, ...pendingLlmRows.map((row) => Math.max(1, Number(row.pending || 0)))),
    [pendingLlmRows]
  );
  const activePendingLlm = useMemo(
    () => pendingLlmRows[0] || null,
    [pendingLlmRows]
  );
  const pendingPromptTrace = useMemo(() => {
    if (!activePendingLlm) return null;
    const reasonToken = normalizeToken(activePendingLlm.reason);
    const roleToken = normalizeToken(activePendingLlm.routeRole);
    const modelToken = normalizeToken(activePendingLlm.model);
    const providerToken = normalizeToken(activePendingLlm.provider);
    const matched = llmTraceRows.find((row) => {
      const promptPreview = String(row.prompt_preview || '').trim();
      if (!promptPreview) return false;
      const rowPurpose = normalizeToken(row.purpose || '');
      const rowRole = normalizeToken(row.role || '');
      const rowModel = normalizeToken(row.model || '');
      const rowProvider = normalizeToken(row.provider || providerFromModelToken(row.model || ''));
      return rowPurpose === reasonToken
        && rowRole === roleToken
        && rowModel === modelToken
        && rowProvider === providerToken;
    });
    if (matched) return matched;
    return llmTraceRows.find((row) => String(row.prompt_preview || '').trim()) || null;
  }, [activePendingLlm, llmTraceRows]);
  const pendingPromptRaw = useMemo(() => {
    if (!activePendingLlm) return '';
    return String(
      activePendingLlm.promptPreview
      || pendingPromptTrace?.prompt_preview
      || ''
    );
  }, [activePendingLlm, pendingPromptTrace]);
  const pendingPromptPretty = useMemo(() => prettyJsonText(pendingPromptRaw), [pendingPromptRaw]);
  const pendingPromptIsJson = useMemo(() => isJsonText(pendingPromptRaw), [pendingPromptRaw]);
  const pendingPromptPhase = useMemo(
    () => classifyLlmPhase(String(activePendingLlm?.reason || ''), String(activePendingLlm?.routeRole || '')),
    [activePendingLlm]
  );
  const lastReceivedResponseEvent = useMemo(() => {
    for (let i = indexlabEvents.length - 1; i >= 0; i -= 1) {
      const evt = indexlabEvents[i];
      if (normalizeToken(evt.stage) !== 'llm') continue;
      const eventName = normalizeToken(evt.event);
      if (eventName !== 'llm_finished' && eventName !== 'llm_failed') continue;
      const payload = evt?.payload && typeof evt.payload === 'object'
        ? evt.payload as Record<string, unknown>
        : {};
      return {
        ts: String(evt.ts || '').trim(),
        purpose: String(payload.reason || payload.purpose || '').trim(),
        routeRole: String(payload.route_role || '').trim(),
        model: String(payload.model || '').trim(),
        responsePreview: String(payload.response_preview || '').trim(),
        message: String(payload.message || '').trim()
      };
    }
    return null;
  }, [indexlabEvents]);
  const lastReceivedResponseTrace = useMemo(
    () => llmTraceRows.find((row) => String(row.response_preview || '').trim()) || null,
    [llmTraceRows]
  );
  const lastReceivedResponseRaw = useMemo(() => {
    return String(
      lastReceivedResponseTrace?.response_preview
      || lastReceivedResponseEvent?.responsePreview
      || lastReceivedResponseEvent?.message
      || ''
    );
  }, [lastReceivedResponseTrace, lastReceivedResponseEvent]);
  const lastReceivedResponsePretty = useMemo(() => prettyJsonText(lastReceivedResponseRaw), [lastReceivedResponseRaw]);
  const lastReceivedResponseIsJson = useMemo(() => isJsonText(lastReceivedResponseRaw), [lastReceivedResponseRaw]);
  const lastReceivedPhase = useMemo(() => {
    if (lastReceivedResponseTrace?.phase) return String(lastReceivedResponseTrace.phase);
    return classifyLlmPhase(
      String(lastReceivedResponseEvent?.purpose || ''),
      String(lastReceivedResponseEvent?.routeRole || '')
    );
  }, [lastReceivedResponseTrace, lastReceivedResponseEvent]);

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
      parse_ms: number;
      article_title: string;
      article_excerpt: string;
      article_preview: string;
      article_method: string;
      article_quality_score: number;
      article_char_count: number;
      article_low_quality: boolean;
      article_fallback_reason: string;
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
            parse_ms: 0,
            article_title: '',
            article_excerpt: '',
            article_preview: '',
            article_method: '',
            article_quality_score: 0,
            article_char_count: 0,
            article_low_quality: false,
            article_fallback_reason: '',
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
            parse_ms: 0,
            article_title: '',
            article_excerpt: '',
            article_preview: '',
            article_method: '',
            article_quality_score: 0,
            article_char_count: 0,
            article_low_quality: false,
            article_fallback_reason: '',
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
        const url = String(payload.url || '').trim();
        const parseMs = Number.parseInt(String(payload.parse_ms || payload.ms || 0), 10) || 0;
        const articleTitle = String(payload.article_title || '').trim();
        const articleExcerpt = String(payload.article_excerpt || '').trim();
        const articlePreview = String(payload.article_preview || '').trim();
        const articleMethod = String(payload.article_extraction_method || '').trim();
        const articleScore = Number.parseFloat(String(payload.article_quality_score ?? 0));
        const articleCharCount = Number.parseInt(String(payload.article_char_count ?? 0), 10) || 0;
        const articleLowQuality = truthyFlag(payload.article_low_quality);
        const articleFallbackReason = String(payload.article_fallback_reason || '').trim();
        if (url) {
          const current = urlJobs.get(url) || {
            url,
            status: 'unknown',
            status_code: 0,
            ms: 0,
            parse_ms: 0,
            article_title: '',
            article_excerpt: '',
            article_preview: '',
            article_method: '',
            article_quality_score: 0,
            article_char_count: 0,
            article_low_quality: false,
            article_fallback_reason: '',
            started_at: '',
            finished_at: '',
            last_ts: ''
          };
          urlJobs.set(url, {
            ...current,
            parse_ms: parseMs > 0 ? parseMs : current.parse_ms,
            article_title: articleTitle || current.article_title,
            article_excerpt: articleExcerpt || current.article_excerpt,
            article_preview: articlePreview || current.article_preview,
            article_method: articleMethod || current.article_method,
            article_quality_score: Number.isFinite(articleScore)
              ? articleScore
              : current.article_quality_score,
            article_char_count: articleCharCount > 0 ? articleCharCount : current.article_char_count,
            article_low_quality: articleLowQuality,
            article_fallback_reason: articleFallbackReason || current.article_fallback_reason,
            last_ts: ts || current.last_ts
          });
        }
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
      allJobs: jobs,
      activeJobs,
      recentJobs: jobs.slice(0, 30)
    };
  }, [indexlabEvents]);
  const phase5LatestParsedJob = useMemo(
    () =>
      indexlabSummary.allJobs.find((row) =>
        row.parse_ms > 0
        || Boolean(row.article_method)
        || row.article_char_count > 0
      ) || null,
    [indexlabSummary.allJobs]
  );
  const phase5ArticlePreviewJob = useMemo(
    () =>
      indexlabSummary.allJobs.find((row) =>
        Boolean(row.article_preview || row.article_excerpt || row.article_title)
      ) || phase5LatestParsedJob,
    [indexlabSummary.allJobs, phase5LatestParsedJob]
  );

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
        identity_lock_state: (payload.identity_lock_state && typeof payload.identity_lock_state === 'object')
          ? payload.identity_lock_state as IndexLabNeedSetResponse['identity_lock_state']
          : {},
        identity_audit_rows: Array.isArray(payload.identity_audit_rows)
          ? payload.identity_audit_rows as IndexLabNeedSetResponse['identity_audit_rows']
          : [],
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
  const indexlabNeedsetIdentityState = useMemo(() => {
    const row = (indexlabNeedset?.identity_lock_state && typeof indexlabNeedset.identity_lock_state === 'object')
      ? indexlabNeedset.identity_lock_state
      : {};
    const status = String(row?.status || '').trim().toLowerCase() || 'unknown';
    const confidence = Number.isFinite(Number(row?.confidence)) ? Number(row?.confidence) : null;
    const maxMatch = Number.isFinite(Number(row?.max_match_score)) ? Number(row?.max_match_score) : null;
    const extractionGateOpen = Boolean(row?.extraction_gate_open);
    const familyModelCount = Number.parseInt(String(row?.family_model_count || 0), 10) || 0;
    const ambiguityLevel = String(row?.ambiguity_level || '').trim().toLowerCase() || (
      familyModelCount >= 9
        ? 'extra_hard'
        : familyModelCount >= 6
          ? 'very_hard'
          : familyModelCount >= 4
            ? 'hard'
            : familyModelCount >= 2
              ? 'medium'
              : familyModelCount === 1
                ? 'easy'
                : 'unknown'
    );
    const ambiguityLabel = ambiguityLevel.replace(/_/g, ' ');
    const publishable = Boolean(row?.publishable);
    const gateValidated = Boolean(row?.identity_gate_validated);
    const blockers = Array.isArray(row?.publish_blockers) ? row.publish_blockers : [];
    const reasonCodes = Array.isArray(row?.reason_codes) ? row.reason_codes : [];
    const pageCount = Number.parseInt(String(row?.page_count || 0), 10) || 0;
    return {
      status,
      confidence,
      maxMatch,
      extractionGateOpen,
      familyModelCount,
      ambiguityLevel,
      ambiguityLabel,
      publishable,
      gateValidated,
      blockers,
      reasonCodes,
      pageCount
    };
  }, [indexlabNeedset]);
  const indexlabNeedsetIdentityAuditRows = useMemo(() => {
    const rows = Array.isArray(indexlabNeedset?.identity_audit_rows)
      ? indexlabNeedset.identity_audit_rows
      : [];
    return rows
      .map((row) => ({
        source_id: String(row?.source_id || '').trim(),
        url: String(row?.url || '').trim(),
        decision: String(row?.decision || '').trim().toUpperCase(),
        confidence: Number.isFinite(Number(row?.confidence)) ? Number(row?.confidence) : null,
        reason_codes: Array.isArray(row?.reason_codes) ? row.reason_codes.map((item) => String(item || '').trim()).filter(Boolean) : [],
        ts: String(row?.ts || '').trim()
      }))
      .filter((row) => row.source_id || row.url)
      .slice(0, 16);
  }, [indexlabNeedset]);

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
  const indexlabSearchProfileVariantGuardTerms = useMemo(
    () => (Array.isArray(indexlabSearchProfile?.variant_guard_terms)
      ? indexlabSearchProfile.variant_guard_terms.map((value) => String(value || '').trim()).filter(Boolean).slice(0, 32)
      : []),
    [indexlabSearchProfile]
  );
  const indexlabSearchProfileAliasRejectRows = useMemo(() => {
    const rows = Array.isArray(indexlabSearchProfile?.alias_reject_log)
      ? indexlabSearchProfile.alias_reject_log
      : [];
    return rows
      .map((row) => ({
        alias: String(row?.alias || '').trim(),
        source: String(row?.source || '').trim(),
        reason: String(row?.reason || '').trim(),
        stage: String(row?.stage || '').trim(),
        detail: String(row?.detail || '').trim()
      }))
      .filter((row) => row.alias || row.reason)
      .slice(0, 80);
  }, [indexlabSearchProfile]);
  const indexlabSearchProfileQueryRejectRows = useMemo(() => {
    const rows = Array.isArray(indexlabSearchProfile?.query_reject_log)
      ? indexlabSearchProfile.query_reject_log
      : [];
    return rows
      .map((row) => ({
        query: String(row?.query || '').trim(),
        source: Array.isArray(row?.source)
          ? row.source.map((value) => String(value || '').trim()).filter(Boolean).join(', ')
          : String(row?.source || '').trim(),
        reason: String(row?.reason || '').trim(),
        stage: String(row?.stage || '').trim(),
        detail: String(row?.detail || '').trim()
      }))
      .filter((row) => row.query || row.reason)
      .slice(0, 160);
  }, [indexlabSearchProfile]);
  const indexlabSearchProfileQueryRejectBreakdown = useMemo(() => {
    const isSafetyReject = (row: { reason: string; stage: string }) => {
      const reason = normalizeToken(row.reason);
      const stage = normalizeToken(row.stage);
      if (stage === 'pre_execution_guard') return true;
      return (
        reason.startsWith('missing_brand_token')
        || reason.startsWith('missing_required_digit_group')
        || reason.startsWith('foreign_model_token')
      );
    };
    const safety: typeof indexlabSearchProfileQueryRejectRows = [];
    const pruned: typeof indexlabSearchProfileQueryRejectRows = [];
    for (const row of indexlabSearchProfileQueryRejectRows) {
      if (isSafetyReject(row)) {
        safety.push(row);
      } else {
        pruned.push(row);
      }
    }
    return {
      safety,
      pruned,
      ordered: [...safety, ...pruned]
    };
  }, [indexlabSearchProfileQueryRejectRows]);
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
  useEffect(() => {
    const stopUrl = '/api/v1/process/stop';
    const stopPayload = JSON.stringify({ force: true });
    const sendStop = () => {
      if (!processRunning) return;
      try {
        const payload = new Blob([stopPayload], { type: 'application/json' });
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
          navigator.sendBeacon(stopUrl, payload);
          return;
        }
      } catch {
        // Fall through to fetch keepalive.
      }
      try {
        void fetch(stopUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: stopPayload,
          keepalive: true
        });
      } catch {
        // Best-effort only.
      }
    };
    const onBeforeUnload = () => sendStop();
    const onPageHide = () => sendStop();
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [processRunning]);
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
        if (normalizeToken(candidate.decision) !== 'selected') continue;
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
    if (rows.length === 0) {
      const fallbackRows = Array.isArray(indexlabSerpExplorer?.selected_urls)
        ? indexlabSerpExplorer.selected_urls
        : [];
      for (const row of fallbackRows) {
        const url = String(row?.url || '').trim();
        if (!url) continue;
        rows.push({
          query: String(row?.query || '').trim(),
          url,
          doc_kind: String(row?.doc_kind || '').trim(),
          tier_name: String(row?.tier_name || '').trim(),
          score: Number(row?.score || 0),
          reason_codes: Array.isArray(row?.reason_codes) ? row.reason_codes : ['summary_fallback']
        });
      }
    }
    rows.sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));
    return rows;
  }, [indexlabSerpRows, indexlabSerpExplorer]);
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
        if (normalizeToken(candidate.decision) !== 'rejected') continue;
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
  const phase3Status = useMemo(() => {
    const hasRunSelection = Boolean(selectedIndexLabRunId);
    const searchStatus = normalizeToken(indexlabSearchProfile?.status || '');
    const hasSerpData = Boolean(
      indexlabSerpRows.length > 0
      || llmOutputSelectedCandidates.length > 0
      || llmOutputRejectedCandidates.length > 0
      || Number(indexlabSerpExplorer?.urls_selected || 0) > 0
      || Number(indexlabSerpExplorer?.urls_rejected || 0) > 0
    );
    if (!hasRunSelection) {
      return {
        state: 'waiting' as const,
        label: 'no run selected',
        message: 'Select a run to view automatic Phase 03 triage results.'
      };
    }
    if (hasSerpData) {
      return {
        state: 'ready' as const,
        label: 'generated',
        message: 'Phase 03 triage output is available for this run.'
      };
    }
    if (searchStatus === 'planned') {
      return {
        state: 'waiting' as const,
        label: 'waiting on triage',
        message: 'SearchProfile is still planned. Keep the run active to execute Phase 03 automatically.'
      };
    }
    if (selectedIndexLabRun?.status === 'running' || processRunning) {
      return {
        state: 'live' as const,
        label: 'running',
        message: 'Run is active. Phase 03 rows will appear once search and triage complete.'
      };
    }
    return {
      state: 'waiting' as const,
      label: 'no phase 03 payload',
      message: 'This run has no triage payload. It likely stopped before Phase 03 completed.'
    };
  }, [
    indexlabSearchProfile,
    indexlabSerpRows,
    indexlabSerpExplorer,
    llmOutputSelectedCandidates,
    llmOutputRejectedCandidates,
    selectedIndexLabRunId,
    selectedIndexLabRun,
    processRunning
  ]);
  const indexingDomainChecklist = useMemo(
    () => indexingDomainChecklistResp || null,
    [indexingDomainChecklistResp]
  );
  const phase4Rows = useMemo(
    () => Array.isArray(indexingDomainChecklist?.rows) ? indexingDomainChecklist.rows : [],
    [indexingDomainChecklist]
  );
  const phase4RepairRows = useMemo(
    () => Array.isArray(indexingDomainChecklist?.repair_queries) ? indexingDomainChecklist.repair_queries : [],
    [indexingDomainChecklist]
  );
  const phase4BadPatternRows = useMemo(
    () => Array.isArray(indexingDomainChecklist?.bad_url_patterns) ? indexingDomainChecklist.bad_url_patterns : [],
    [indexingDomainChecklist]
  );
  const phase4Activity = useMemo(
    () =>
      computeActivityStats(
        timedIndexlabEvents,
        activityNowMs,
        (event) => (
          event.event === 'source_processed'
          || event.event === 'source_fetch_failed'
          || event.event === 'fetch_finished'
          || event.event === 'fetch_started'
        )
      ),
    [timedIndexlabEvents, activityNowMs]
  );
  const phase4Summary = useMemo(() => {
    const rows = phase4Rows;
    const sum = (getter: (row: IndexingDomainChecklistRow) => number) =>
      rows.reduce((total, row) => total + getter(row), 0);
    const cooldownsActive = rows.filter((row) => (
      Number(row.cooldown_seconds_remaining || 0) > 0 || String(row.next_retry_at || '').trim()
    )).length;
    const repeat404Domains = rows.filter((row) => Number(row.repeat_404_urls || 0) > 0).length;
    const repeatBlockedDomains = rows.filter((row) => Number(row.repeat_blocked_urls || 0) > 0).length;
    const blockedHosts = rows.filter((row) => normalizeToken(row.host_budget_state || '') === 'blocked').length;
    const backoffHosts = rows.filter((row) => normalizeToken(row.host_budget_state || '') === 'backoff').length;
    const avgHostBudget = rows.length > 0
      ? sum((row) => Number(row.host_budget_score || 0)) / rows.length
      : 0;
    return {
      domains: rows.length,
      err404: sum((row) => Number(row.err_404 || 0)),
      blocked: sum((row) => Number(row.blocked_count || 0)),
      dedupeHits: sum((row) => Number(row.dedupe_hits || 0)),
      cooldownsActive,
      repeat404Domains,
      repeatBlockedDomains,
      blockedHosts,
      backoffHosts,
      avgHostBudget: Number(avgHostBudget.toFixed(1)),
      repairQueries: phase4RepairRows.length,
      badPatterns: phase4BadPatternRows.length
    };
  }, [phase4Rows, phase4RepairRows, phase4BadPatternRows]);
  const phase4Status = useMemo(() => {
    const hasRows = phase4Rows.length > 0;
    const hasSignals = (
      phase4RepairRows.length > 0
      || phase4BadPatternRows.length > 0
      || phase4Summary.err404 > 0
      || phase4Summary.blocked > 0
      || phase4Summary.dedupeHits > 0
    );
    if (!selectedIndexLabRunId) {
      return {
        state: 'waiting' as const,
        label: 'no run selected'
      };
    }
    if (processRunning) {
      return {
        state: 'live' as const,
        label: hasSignals ? 'active' : (hasRows ? 'collecting' : 'waiting')
      };
    }
    if (hasSignals || hasRows) {
      return {
        state: 'ready' as const,
        label: hasSignals ? 'ready' : 'collected'
      };
    }
    return {
      state: 'waiting' as const,
      label: 'no phase 04 payload'
    };
  }, [
    selectedIndexLabRunId,
    processRunning,
    phase4Rows,
    phase4RepairRows,
    phase4BadPatternRows,
    phase4Summary
  ]);
  const phase5Runtime = useMemo(() => {
    const activeByUrl = new Map<string, string>();
    const activeByHost = new Map<string, number>();
    let peakInflight = 0;
    let started = 0;
    let completed = 0;
    let failed = 0;
    let skippedCooldown = 0;
    let skippedBlockedBudget = 0;
    let skippedRetryLater = 0;
    let httpCount = 0;
    let browserCount = 0;
    let otherCount = 0;
    let articleSamples = 0;
    let articleReadability = 0;
    let articleFallback = 0;
    let articleLowQuality = 0;
    const articleScores: number[] = [];
    const articleChars: number[] = [];
    const fetchDurationsMs: number[] = [];
    const parseDurationsMs: number[] = [];

    for (const evt of indexlabEvents) {
      const payload = evt?.payload && typeof evt.payload === 'object'
        ? evt.payload as Record<string, unknown>
        : {};
      const eventName = normalizeToken(evt.event);
      const stageName = normalizeToken(evt.stage);
      const url = String(payload.url || payload.source_url || payload.final_url || '').trim();
      const hostToken = String(payload.host || hostFromUrl(url) || '').trim().toLowerCase();
      const fetcherKind = normalizeToken(String(payload.fetcher_kind || payload.fetcher_mode || payload.fetcher || ''));
      const fetchMs = Number.parseFloat(String(payload.ms ?? payload.fetch_ms ?? ''));
      const parseMs = Number.parseFloat(String(payload.parse_ms ?? payload.ms ?? ''));
      const articleMethod = normalizeToken(String(payload.article_extraction_method || payload.article_method || ''));
      const articleScore = Number.parseFloat(String(payload.article_quality_score ?? payload.article_score ?? ''));
      const articleCharCount = Number.parseInt(String(payload.article_char_count ?? payload.article_chars ?? 0), 10) || 0;
      const articleLow = truthyFlag(payload.article_low_quality);
      const skipReason = normalizeToken(String(payload.skip_reason || payload.reason || ''));
      const statusClass = normalizeToken(String(payload.status_class || ''));
      const isFetchStarted = (
        eventName === 'source_fetch_started'
        || (stageName === 'fetch' && eventName === 'fetch_started')
      );
      const isFetchFinished = (
        eventName === 'source_processed'
        || eventName === 'source_fetch_failed'
        || (stageName === 'fetch' && eventName === 'fetch_finished')
      );
      const isFetchSkipped = (
        eventName === 'source_fetch_skipped'
        || (stageName === 'fetch' && eventName === 'fetch_skipped')
      );

      if (isFetchStarted) {
        started += 1;
        if (url && !activeByUrl.has(url)) {
          activeByUrl.set(url, hostToken);
          if (hostToken) {
            activeByHost.set(hostToken, (activeByHost.get(hostToken) || 0) + 1);
          }
        }
        peakInflight = Math.max(peakInflight, activeByUrl.size);
        continue;
      }

      if (isFetchSkipped) {
        if (skipReason === 'cooldown') skippedCooldown += 1;
        else if (skipReason === 'blocked_budget') skippedBlockedBudget += 1;
        else if (skipReason === 'retry_later') skippedRetryLater += 1;
        continue;
      }

      if (isFetchFinished) {
        const isSuccess = eventName === 'source_processed' || (stageName === 'fetch' && eventName === 'fetch_finished' && statusClass === 'ok');
        if (eventName === 'source_processed' || isSuccess) completed += 1;
        else failed += 1;
        if (fetcherKind.includes('http')) httpCount += 1;
        else if (fetcherKind.includes('playwright') || fetcherKind.includes('browser')) browserCount += 1;
        else otherCount += 1;
        if (Number.isFinite(fetchMs) && fetchMs > 0) {
          fetchDurationsMs.push(fetchMs);
        }

        if (url) {
          const activeHost = activeByUrl.get(url) || hostToken;
          activeByUrl.delete(url);
          if (activeHost) {
            const next = Math.max(0, (activeByHost.get(activeHost) || 0) - 1);
            if (next <= 0) activeByHost.delete(activeHost);
            else activeByHost.set(activeHost, next);
          }
        }
        continue;
      }

      const isParseFinished = (
        eventName === 'source_processed'
        || (stageName === 'parse' && eventName === 'parse_finished')
      );
      if (isParseFinished && Number.isFinite(parseMs) && parseMs > 0) {
        parseDurationsMs.push(parseMs);
      }
      if (isParseFinished) {
        const hasArticleSignal = (
          Boolean(articleMethod)
          || Number.isFinite(articleScore)
          || articleCharCount > 0
          || articleLow
        );
        if (hasArticleSignal) {
          articleSamples += 1;
          if (articleMethod.includes('readability')) articleReadability += 1;
          else if (articleMethod.includes('fallback') || articleMethod.includes('heuristic') || articleMethod.includes('parse_template')) articleFallback += 1;
          if (articleLow) articleLowQuality += 1;
          if (Number.isFinite(articleScore)) articleScores.push(articleScore);
          if (articleCharCount > 0) articleChars.push(articleCharCount);
        }
      }
    }

    const hostsActive = [...activeByHost.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([host, inflight]) => ({ host, inflight }));

    return {
      activeInflight: activeByUrl.size,
      peakInflight,
      started,
      completed,
      failed,
      skippedCooldown,
      skippedBlockedBudget,
      skippedRetryLater,
      httpCount,
      browserCount,
      otherCount,
      articleSamples,
      articleReadability,
      articleFallback,
      articleLowQuality,
      articleAvgScore: articleScores.length > 0
        ? (articleScores.reduce((sum, value) => sum + value, 0) / articleScores.length)
        : 0,
      articleAvgChars: articleChars.length > 0
        ? (articleChars.reduce((sum, value) => sum + value, 0) / articleChars.length)
        : 0,
      fetchP95Ms: percentileMs(fetchDurationsMs, 95),
      parseP95Ms: percentileMs(parseDurationsMs, 95),
      hostsActive
    };
  }, [indexlabEvents]);
  const phase5Activity = useMemo(
    () =>
      computeActivityStats(
        timedIndexlabEvents,
        activityNowMs,
        (event) => (
          event.event === 'source_fetch_started'
          || event.event === 'source_processed'
          || event.event === 'source_fetch_failed'
          || event.event === 'source_fetch_skipped'
          || (event.stage === 'fetch' && event.event === 'fetch_started')
          || (event.stage === 'fetch' && event.event === 'fetch_finished')
          || (event.stage === 'fetch' && event.event === 'fetch_skipped')
        )
      ),
    [timedIndexlabEvents, activityNowMs]
  );
  const phase5Status = useMemo(() => {
    const hasSignals =
      phase5Runtime.started > 0
      || phase5Runtime.completed > 0
      || phase5Runtime.failed > 0
      || phase5Runtime.peakInflight > 0
      || phase5Runtime.skippedCooldown > 0
      || phase5Runtime.skippedBlockedBudget > 0
      || phase5Runtime.skippedRetryLater > 0;
    if (!selectedIndexLabRunId) {
      return {
        state: 'waiting' as const,
        label: 'no run selected'
      };
    }
    if (processRunning) {
      return {
        state: 'live' as const,
        label: hasSignals ? 'active' : 'collecting'
      };
    }
    if (hasSignals) {
      return {
        state: 'ready' as const,
        label: 'ready'
      };
    }
    return {
      state: 'waiting' as const,
      label: 'no phase 05 payload'
    };
  }, [selectedIndexLabRunId, processRunning, phase5Runtime]);
  const phase6bJobs = useMemo(
    () => Array.isArray(indexlabAutomationQueueResp?.jobs) ? indexlabAutomationQueueResp.jobs : [],
    [indexlabAutomationQueueResp]
  );
  const phase6bActions = useMemo(
    () => Array.isArray(indexlabAutomationQueueResp?.actions) ? indexlabAutomationQueueResp.actions : [],
    [indexlabAutomationQueueResp]
  );
  const phase6bSummary = useMemo(() => {
    const summary = indexlabAutomationQueueResp?.summary || {};
    const fallback = {
      queued: 0,
      running: 0,
      done: 0,
      failed: 0,
      cooldown: 0,
      repair_search: 0,
      staleness_refresh: 0,
      deficit_rediscovery: 0,
      domain_backoff: 0
    };
    for (const row of phase6bJobs) {
      const status = normalizeToken(row.status || '');
      if (status === 'queued') fallback.queued += 1;
      else if (status === 'running') fallback.running += 1;
      else if (status === 'done') fallback.done += 1;
      else if (status === 'failed') fallback.failed += 1;
      else if (status === 'cooldown') fallback.cooldown += 1;

      const jobType = normalizeToken(row.job_type || '');
      if (jobType === 'repair_search') fallback.repair_search += 1;
      else if (jobType === 'staleness_refresh') fallback.staleness_refresh += 1;
      else if (jobType === 'deficit_rediscovery') fallback.deficit_rediscovery += 1;
      else if (jobType === 'domain_backoff') fallback.domain_backoff += 1;
    }
    const queued = Number(summary.queued ?? fallback.queued);
    const running = Number(summary.running ?? fallback.running);
    const done = Number(summary.done ?? fallback.done);
    const failed = Number(summary.failed ?? fallback.failed);
    const cooldown = Number(summary.cooldown ?? fallback.cooldown);
    const totalJobs = Number(summary.total_jobs ?? phase6bJobs.length);
    const queueDepth = Number(summary.queue_depth ?? (queued + running + failed));
    const activeJobs = Number(summary.active_jobs ?? (queued + running));
    return {
      totalJobs,
      queueDepth,
      activeJobs,
      queued,
      running,
      done,
      failed,
      cooldown,
      repairSearch: Number(summary.repair_search ?? fallback.repair_search),
      stalenessRefresh: Number(summary.staleness_refresh ?? fallback.staleness_refresh),
      deficitRediscovery: Number(summary.deficit_rediscovery ?? fallback.deficit_rediscovery),
      domainBackoff: Number(summary.domain_backoff ?? fallback.domain_backoff)
    };
  }, [indexlabAutomationQueueResp, phase6bJobs]);
  const phase6bActivity = useMemo(
    () =>
      computeActivityStats(
        timedIndexlabEvents,
        activityNowMs,
        (event) => (
          event.event === 'repair_query_enqueued'
          || event.event === 'url_cooldown_applied'
          || event.event === 'blocked_domain_cooldown_applied'
          || event.event === 'source_fetch_skipped'
          || event.event === 'discovery_query_started'
          || event.event === 'discovery_query_completed'
          || event.event === 'needset_computed'
        )
      ),
    [timedIndexlabEvents, activityNowMs]
  );
  const phase6bStatus = useMemo(() => {
    const hasSignals =
      phase6bSummary.totalJobs > 0
      || phase6bActions.length > 0
      || phase6bSummary.queueDepth > 0;
    if (!selectedIndexLabRunId) {
      return {
        state: 'waiting' as const,
        label: 'no run selected'
      };
    }
    if (processRunning) {
      return {
        state: 'live' as const,
        label: hasSignals ? 'active' : 'collecting'
      };
    }
    if (hasSignals) {
      return {
        state: 'ready' as const,
        label: phase6bSummary.queueDepth > 0 ? 'ready (queued)' : 'ready'
      };
    }
    return {
      state: 'waiting' as const,
      label: 'no phase 06b payload'
    };
  }, [selectedIndexLabRunId, processRunning, phase6bSummary, phase6bActions]);
  const phase6Runtime = useMemo(() => {
    const hashRows = new Map<string, {
      contentHash: string;
      hits: number;
      bytes: number;
      lastUrl: string;
      host: string;
      contentType: string;
      lastTs: string;
    }>();
    let processed = 0;
    let missingHash = 0;
    let dedupeHits = 0;
    let totalBytes = 0;
    let parseFinished = 0;
    let indexFinished = 0;

    for (const evt of indexlabEvents) {
      const payload = evt?.payload && typeof evt.payload === 'object'
        ? evt.payload as Record<string, unknown>
        : {};
      const eventName = normalizeToken(evt.event);
      const stageName = normalizeToken(evt.stage);
      const scope = normalizeToken(payload.scope || '');
      const isProcessedPayload = (
        eventName === 'source_processed'
        || (stageName === 'fetch' && eventName === 'fetch_finished' && scope === 'url')
      );
      if (isProcessedPayload) {
        processed += 1;
        const url = String(
          payload.final_url
          || payload.finalUrl
          || payload.url
          || payload.source_url
          || ''
        ).trim();
        const contentHash = String(payload.content_hash || payload.contentHash || '').trim();
        const bytes = Number.parseInt(String(payload.bytes || payload.content_length || 0), 10) || 0;
        const host = String(payload.host || hostFromUrl(url) || '').trim().toLowerCase();
        const contentType = String(payload.content_type || payload.contentType || '').trim().toLowerCase();
        if (bytes > 0) totalBytes += bytes;
        if (!contentHash) {
          missingHash += 1;
          continue;
        }
        const current = hashRows.get(contentHash);
        if (current) {
          dedupeHits += 1;
          current.hits += 1;
          current.bytes += bytes;
          current.lastUrl = url || current.lastUrl;
          current.host = host || current.host;
          current.contentType = contentType || current.contentType;
          current.lastTs = String(evt.ts || current.lastTs);
          continue;
        }
        hashRows.set(contentHash, {
          contentHash,
          hits: 1,
          bytes: Math.max(0, bytes),
          lastUrl: url,
          host,
          contentType,
          lastTs: String(evt.ts || '')
        });
        continue;
      }

      if (stageName === 'parse' && eventName === 'parse_finished' && scope === 'url') {
        parseFinished += 1;
      }
      if (stageName === 'index' && eventName === 'index_finished' && scope === 'url') {
        indexFinished += 1;
      }
    }

    const repeatedHashes = [...hashRows.values()]
      .filter((row) => row.hits > 1)
      .sort((a, b) => b.hits - a.hits || b.bytes - a.bytes || a.contentHash.localeCompare(b.contentHash))
      .slice(0, 12);

    return {
      processed,
      uniqueHashes: hashRows.size,
      dedupeHits,
      missingHash,
      hashCoveragePct: processed > 0 ? ((processed - missingHash) / processed) * 100 : 0,
      totalBytes,
      parseFinished,
      indexFinished,
      repeatedHashes
    };
  }, [indexlabEvents]);
  const phase6EvidenceSummary = useMemo(() => {
    const summary = indexlabEvidenceIndexResp?.summary || {};
    return {
      dbReady: Boolean(indexlabEvidenceIndexResp?.db_ready),
      scopeMode: String(indexlabEvidenceIndexResp?.scope?.mode || '').trim() || 'none',
      documents: Number(summary.documents || 0),
      artifacts: Number(summary.artifacts || 0),
      artifactsWithHash: Number(summary.artifacts_with_hash || 0),
      uniqueHashes: Number(summary.unique_hashes || 0),
      assertions: Number(summary.assertions || 0),
      evidenceRefs: Number(summary.evidence_refs || 0),
      fieldsCovered: Number(summary.fields_covered || 0)
    };
  }, [indexlabEvidenceIndexResp]);
  const phase6EvidenceDocuments = useMemo<IndexLabEvidenceIndexDocumentRow[]>(
    () => (Array.isArray(indexlabEvidenceIndexResp?.documents) ? indexlabEvidenceIndexResp.documents : []),
    [indexlabEvidenceIndexResp]
  );
  const phase6EvidenceTopFields = useMemo<IndexLabEvidenceIndexFieldRow[]>(
    () => (Array.isArray(indexlabEvidenceIndexResp?.top_fields) ? indexlabEvidenceIndexResp.top_fields : []),
    [indexlabEvidenceIndexResp]
  );
  const phase6EvidenceSearchRows = useMemo<IndexLabEvidenceIndexSearchRow[]>(
    () => (Array.isArray(indexlabEvidenceIndexResp?.search?.rows) ? indexlabEvidenceIndexResp.search.rows : []),
    [indexlabEvidenceIndexResp]
  );
  const phase6Activity = useMemo(
    () =>
      computeActivityStats(
        timedIndexlabEvents,
        activityNowMs,
        (event) => (
          event.event === 'source_processed'
          || (event.stage === 'fetch' && event.event === 'fetch_finished')
          || (event.stage === 'parse' && event.event === 'parse_finished')
          || (event.stage === 'index' && event.event === 'index_finished')
        )
      ),
    [timedIndexlabEvents, activityNowMs]
  );
  const phase6Status = useMemo(() => {
    const hasSignals =
      phase6Runtime.processed > 0
      || phase6Runtime.uniqueHashes > 0
      || phase6Runtime.dedupeHits > 0
      || phase6Runtime.parseFinished > 0
      || phase6Runtime.indexFinished > 0
      || phase6EvidenceSummary.documents > 0
      || phase6EvidenceSummary.assertions > 0;
    if (!selectedIndexLabRunId) {
      return {
        state: 'waiting' as const,
        label: 'no run selected'
      };
    }
    if (processRunning) {
      return {
        state: 'live' as const,
        label: hasSignals ? 'active' : 'collecting'
      };
    }
    if (hasSignals) {
      return {
        state: 'ready' as const,
        label: 'ready'
      };
    }
    return {
      state: 'waiting' as const,
      label: 'no phase 06a payload'
    };
  }, [selectedIndexLabRunId, processRunning, phase6Runtime, phase6EvidenceSummary]);
  const phase7Fields = useMemo<IndexLabPhase07FieldRow[]>(
    () => (Array.isArray(indexlabPhase07Resp?.fields) ? indexlabPhase07Resp.fields : []),
    [indexlabPhase07Resp]
  );
  const phase7Summary = useMemo(() => {
    const summary = indexlabPhase07Resp?.summary || {};
    const attempted = Number(summary.fields_attempted ?? phase7Fields.length);
    const withHits = Number(summary.fields_with_hits ?? phase7Fields.filter((row) => Number(row.hits_count || 0) > 0).length);
    const satisfied = Number(summary.fields_satisfied_min_refs ?? phase7Fields.filter((row) => Boolean(row.min_refs_satisfied)).length);
    const unsatisfied = Number(summary.fields_unsatisfied_min_refs ?? Math.max(0, attempted - satisfied));
    const refsSelected = Number(summary.refs_selected_total ?? phase7Fields.reduce((sum, row) => sum + Number(row.refs_selected || 0), 0));
    const distinctSources = Number(summary.distinct_sources_selected ?? phase7Fields.reduce((sum, row) => sum + Number(row.distinct_sources_selected || 0), 0));
    const avgHitsPerField = Number(summary.avg_hits_per_field ?? (attempted > 0
      ? phase7Fields.reduce((sum, row) => sum + Number(row.hits_count || 0), 0) / attempted
      : 0));
    const evidencePoolSize = Number(summary.evidence_pool_size || 0);
    return {
      attempted,
      withHits,
      satisfied,
      unsatisfied,
      refsSelected,
      distinctSources,
      avgHitsPerField: Number(avgHitsPerField.toFixed(3)),
      evidencePoolSize
    };
  }, [indexlabPhase07Resp, phase7Fields]);
  const phase7Activity = useMemo(
    () =>
      computeActivityStats(
        timedIndexlabEvents,
        activityNowMs,
        (event) => (
          event.event === 'phase07_prime_sources_built'
          || event.event === 'needset_computed'
          || (event.stage === 'index' && event.event === 'phase07_prime_sources_built')
        )
      ),
    [timedIndexlabEvents, activityNowMs]
  );
  const phase7Status = useMemo(() => {
    const hasSignals =
      phase7Summary.attempted > 0
      || phase7Summary.refsSelected > 0
      || phase7Fields.length > 0;
    if (!selectedIndexLabRunId) {
      return {
        state: 'waiting' as const,
        label: 'no run selected'
      };
    }
    if (processRunning) {
      return {
        state: 'live' as const,
        label: hasSignals ? 'active' : 'collecting'
      };
    }
    if (hasSignals) {
      return {
        state: 'ready' as const,
        label: 'ready'
      };
    }
    return {
      state: 'waiting' as const,
      label: 'no phase 07 payload'
    };
  }, [selectedIndexLabRunId, processRunning, phase7Summary, phase7Fields]);
  const phase7FieldRows = useMemo(() => {
    const rows = [...phase7Fields];
    rows.sort((a, b) => Number(b.need_score || 0) - Number(a.need_score || 0) || String(a.field_key || '').localeCompare(String(b.field_key || '')));
    return rows;
  }, [phase7Fields]);
  const phase7PrimeRows = useMemo(() => {
    const rows: Array<{
      field_key: string;
      score: number;
      url: string;
      host: string;
      tier: string;
      doc_kind: string;
      snippet_id: string;
      quote_preview: string;
      reason_badges: string[];
    }> = [];
    for (const fieldRow of phase7FieldRows) {
      for (const row of fieldRow.prime_sources || []) {
        rows.push({
          field_key: String(fieldRow.field_key || '').trim(),
          score: Number(row.score || 0),
          url: String(row.url || '').trim(),
          host: String(row.host || '').trim(),
          tier: String(row.tier_name || (Number.isFinite(Number(row.tier)) ? `tier ${row.tier}` : '-')).trim(),
          doc_kind: String(row.doc_kind || '').trim(),
          snippet_id: String(row.snippet_id || '').trim(),
          quote_preview: String(row.quote_preview || '').trim(),
          reason_badges: Array.isArray(row.reason_badges) ? row.reason_badges : []
        });
      }
    }
    rows.sort((a, b) => b.score - a.score || a.field_key.localeCompare(b.field_key));
    return rows;
  }, [phase7FieldRows]);
  const phase7HitRows = useMemo(() => {
    const rows: Array<{
      field_key: string;
      score: number;
      url: string;
      host: string;
      tier: string;
      doc_kind: string;
      selected: boolean;
      quote_preview: string;
    }> = [];
    for (const fieldRow of phase7FieldRows) {
      const selectedSnippets = new Set(
        (fieldRow.prime_sources || [])
          .map((item) => String(item.snippet_id || '').trim())
          .filter(Boolean)
      );
      for (const row of (fieldRow.hits || []).slice(0, 5)) {
        const snippetId = String(row.snippet_id || '').trim();
        rows.push({
          field_key: String(fieldRow.field_key || '').trim(),
          score: Number(row.score || 0),
          url: String(row.url || '').trim(),
          host: String(row.host || '').trim(),
          tier: String(row.tier_name || (Number.isFinite(Number(row.tier)) ? `tier ${row.tier}` : '-')).trim(),
          doc_kind: String(row.doc_kind || '').trim(),
          selected: snippetId ? selectedSnippets.has(snippetId) : false,
          quote_preview: String(row.quote_preview || '').trim()
        });
      }
    }
    rows.sort((a, b) => b.score - a.score || a.field_key.localeCompare(b.field_key));
    return rows;
  }, [phase7FieldRows]);
  const phase8Batches = useMemo<IndexLabPhase08BatchRow[]>(
    () => (Array.isArray(indexlabPhase08Resp?.batches) ? indexlabPhase08Resp.batches : []),
    [indexlabPhase08Resp]
  );
  const phase8FieldContextRows = useMemo<IndexLabPhase08FieldContextRow[]>(() => {
    const map = indexlabPhase08Resp?.field_contexts || {};
    const rows = Object.entries(map).map(([fieldKey, row]) => ({
      field_key: fieldKey,
      ...(row || {})
    }));
    rows.sort((a, b) => String(a.field_key || '').localeCompare(String(b.field_key || '')));
    return rows;
  }, [indexlabPhase08Resp]);
  const phase8PrimeRows = useMemo<IndexLabPhase08PrimeRow[]>(
    () => (Array.isArray(indexlabPhase08Resp?.prime_sources?.rows) ? indexlabPhase08Resp?.prime_sources?.rows || [] : []),
    [indexlabPhase08Resp]
  );
  const phase8Summary = useMemo(() => {
    const summary = indexlabPhase08Resp?.summary || {};
    const batchCount = Number(summary.batch_count ?? phase8Batches.length);
    const batchErrorCount = Number(summary.batch_error_count || 0);
    const schemaFailRate = Number(summary.schema_fail_rate || 0);
    const rawCandidateCount = Number(summary.raw_candidate_count || 0);
    const acceptedCandidateCount = Number(summary.accepted_candidate_count || 0);
    const danglingRefCount = Number(summary.dangling_snippet_ref_count || 0);
    const danglingRefRate = Number(summary.dangling_snippet_ref_rate || 0);
    const policyViolationCount = Number(summary.evidence_policy_violation_count || 0);
    const policyViolationRate = Number(summary.evidence_policy_violation_rate || 0);
    const minRefsSatisfied = Number(summary.min_refs_satisfied_count || 0);
    const minRefsTotal = Number(summary.min_refs_total || 0);
    const minRefsSatisfiedRate = Number(summary.min_refs_satisfied_rate || 0);
    const validatorContextFields = Number(summary.validator_context_field_count || 0);
    const validatorPrimeRows = Number(summary.validator_prime_source_rows || 0);
    return {
      batchCount,
      batchErrorCount,
      schemaFailRate,
      rawCandidateCount,
      acceptedCandidateCount,
      danglingRefCount,
      danglingRefRate,
      policyViolationCount,
      policyViolationRate,
      minRefsSatisfied,
      minRefsTotal,
      minRefsSatisfiedRate,
      validatorContextFields,
      validatorPrimeRows
    };
  }, [indexlabPhase08Resp, phase8Batches]);
  const phase8Activity = useMemo(
    () =>
      computeActivityStats(
        timedIndexlabEvents,
        activityNowMs,
        (event) => (
          event.event === 'llm_extract_batch_prompt_profile'
          || event.event === 'llm_extract_batch_outcome'
          || event.event === 'phase08_extraction_context_built'
          || (event.stage === 'index' && event.event === 'phase08_extraction_context_built')
        )
      ),
    [timedIndexlabEvents, activityNowMs]
  );
  const phase8Status = useMemo(() => {
    const hasSignals =
      phase8Summary.batchCount > 0
      || phase8Summary.rawCandidateCount > 0
      || phase8FieldContextRows.length > 0
      || phase8PrimeRows.length > 0;
    if (!selectedIndexLabRunId) {
      return {
        state: 'waiting' as const,
        label: 'no run selected'
      };
    }
    if (processRunning) {
      return {
        state: 'live' as const,
        label: hasSignals ? 'active' : 'collecting'
      };
    }
    if (hasSignals) {
      return {
        state: 'ready' as const,
        label: 'ready'
      };
    }
    return {
      state: 'waiting' as const,
      label: 'no phase 08 payload'
    };
  }, [selectedIndexLabRunId, processRunning, phase8Summary, phase8FieldContextRows, phase8PrimeRows]);
  const containerStatuses = useMemo<Array<{ label: string; state: PanelStateToken; detail: string }>>(() => {
    const searchState: PanelStateToken =
      indexlabSearchProfile
        ? (normalizeToken(indexlabSearchProfile.status) === 'planned' ? 'live' : 'ready')
        : 'waiting';
    const phase3State: PanelStateToken =
      phase3Status.state === 'live'
        ? 'live'
        : (phase3Status.state === 'ready' ? 'ready' : 'waiting');
    const needsetRows = Number(indexlabNeedsetRows.length || 0);
    return [
      {
        label: 'Run Controls',
        state: processRunning ? 'live' as const : 'ready' as const,
        detail: processRunning ? 'run active' : 'ready'
      },
      {
        label: 'Event Stream',
        state: indexlabEvents.length > 0 ? (processRunning ? 'live' : 'ready') : 'waiting',
        detail: `${formatNumber(indexlabEvents.length)} events`
      },
      {
        label: 'NeedSet',
        state: needsetRows > 0 ? (processRunning ? 'live' : 'ready') : 'waiting',
        detail: `${formatNumber(needsetRows)} rows`
      },
      {
        label: 'Search Profile',
        state: searchState,
        detail: indexlabSearchProfile?.status || 'not generated'
      },
      {
        label: 'SERP Explorer',
        state: phase3State,
        detail: phase3Status.label
      },
      {
        label: 'URL Health',
        state: phase4Status.state,
        detail: phase4Status.label
      },
      {
        label: 'Parallel Fetch/Parse',
        state: phase5Status.state,
        detail: phase5Status.label
      },
      {
        label: 'Evidence Index',
        state: phase6Status.state,
        detail: phase6Status.label
      },
      {
        label: 'Tier Retrieval',
        state: phase7Status.state,
        detail: phase7Status.label
      },
      {
        label: 'Extraction Context',
        state: phase8Status.state,
        detail: phase8Status.label
      },
      {
        label: 'Automation Queue',
        state: phase6bStatus.state,
        detail: phase6bStatus.label
      },
      {
        label: 'LLM Metrics',
        state: Number(selectedRunLlmMetrics?.calls || 0) > 0 ? 'ready' : 'waiting',
        detail: `${formatNumber(Number(selectedRunLlmMetrics?.calls || 0))} calls`
      }
    ];
  }, [
    processRunning,
    indexlabEvents,
    indexlabNeedsetRows,
    indexlabSearchProfile,
    phase3Status,
    phase4Status,
    phase5Status,
    phase6bStatus,
    phase6Status,
    phase7Status,
    phase8Status,
    selectedRunLlmMetrics
  ]);
  const sessionCrawledCells = useMemo<Array<{ key: string; label: string; value: string; tooltip: string; placeholder?: boolean }>>(() => {
    const jobs = Array.isArray(indexlabSummary.allJobs) ? indexlabSummary.allJobs : [];
    const crawledUrls = jobs
      .map((row) => String(row.url || '').trim())
      .filter(Boolean);
    const fetchedUrls = jobs
      .filter((row) => String(row.status || '').trim() !== 'in_flight')
      .map((row) => String(row.url || '').trim())
      .filter(Boolean);
    const domainFetchedCount = new Set(fetchedUrls.map((url) => hostFromUrl(url)).filter(Boolean)).size;
    const graphqlFetched = fetchedUrls.filter((url) => looksLikeGraphqlUrl(url)).length;
    const jsonFetched = fetchedUrls.filter((url) => looksLikeJsonUrl(url)).length;
    const pdfFetched = fetchedUrls.filter((url) => looksLikePdfUrl(url)).length;
    const urlsSelected = Number(
      indexlabSerpExplorer?.urls_selected
      || (Array.isArray(indexlabSerpExplorer?.selected_urls) ? indexlabSerpExplorer?.selected_urls.length : 0)
      || 0
    );
    const duplicatesRemoved = Number(indexlabSerpExplorer?.duplicates_removed || 0);
    const fetchedOk = Number(indexlabSummary.counters.fetched_ok || 0);
    const fetched404 = Number(indexlabSummary.counters.fetched_404 || 0);
    const fetchedBlocked = Number(indexlabSummary.counters.fetched_blocked || 0);
    const fetchedErrors = Number(indexlabSummary.counters.fetched_error || 0);
    const parseCompleted = Number(indexlabSummary.counters.parse_completed || 0);
    const indexedDocs = Number(indexlabSummary.counters.indexed_docs || 0);
    const fieldsFilled = Number(indexlabSummary.counters.fields_filled || 0);
    const llmCalls = Number(indexlabLlmTracesResp?.count || llmTraceRows.length || selectedRunLlmMetrics?.calls || 0);
    const sessionRunningLlmCost = Number(selectedRunLlmMetrics?.cost_usd || 0);
    const needsetRemaining = Number(indexlabNeedset?.needset_size || 0);
    const contentHashDedupeHits = Number(phase6Runtime.dedupeHits || 0);
    const phase07FieldsSatisfied = Number(phase7Summary.satisfied || 0);
    const phase07RefsSelected = Number(phase7Summary.refsSelected || 0);

    return [
      {
        key: 'unique-url-crawled',
        label: 'Unique URL Crawled',
        value: formatNumber(crawledUrls.length),
        tooltip: 'Unique URLs discovered and entered into fetch flow for the selected run.'
      },
      {
        key: 'domains-fetched',
        label: 'Domains Fetched',
        value: formatNumber(domainFetchedCount),
        tooltip: 'Unique hostnames with at least one completed fetch event.'
      },
      {
        key: 'graphql-fetched',
        label: 'GraphQL Fetched',
        value: formatNumber(graphqlFetched),
        tooltip: 'Completed fetch URLs that look like GraphQL endpoints (path/query heuristic).'
      },
      {
        key: 'json-fetched',
        label: 'JSON Fetched',
        value: formatNumber(jsonFetched),
        tooltip: 'Completed fetch URLs that look like JSON resources (extension/query/path heuristic).'
      },
      {
        key: 'pdf-fetched',
        label: 'PDF Fetched',
        value: formatNumber(pdfFetched),
        tooltip: 'Completed fetch URLs ending in .pdf (document/manual style sources).'
      },
      {
        key: 'phase03-urls-selected',
        label: 'URLs Selected',
        value: formatNumber(urlsSelected),
        tooltip: 'Phase 03 triage-selected top-K URLs queued for fetch.'
      },
      {
        key: 'phase03-dedupe-removed',
        label: 'Duplicates Removed',
        value: formatNumber(duplicatesRemoved),
        tooltip: 'SERP candidate duplicates removed by dedupe during triage.'
      },
      {
        key: 'fetched-ok',
        label: 'Fetched OK',
        value: formatNumber(fetchedOk),
        tooltip: 'Fetch-complete URLs with HTTP success class in this run.'
      },
      {
        key: 'fetched-404',
        label: 'Fetched 404',
        value: formatNumber(fetched404),
        tooltip: 'Fetch-complete URLs returning 404/410 style not-found status.'
      },
      {
        key: 'fetched-blocked',
        label: 'Fetched Blocked',
        value: formatNumber(fetchedBlocked),
        tooltip: 'Fetch-complete URLs blocked by anti-bot/forbidden protections.'
      },
      {
        key: 'fetched-errors',
        label: 'Fetch Errors',
        value: formatNumber(fetchedErrors),
        tooltip: 'Fetch attempts that ended in non-success, non-404, non-blocked errors.'
      },
      {
        key: 'parse-completed',
        label: 'Parse Completed',
        value: formatNumber(parseCompleted),
        tooltip: 'URLs that reached parse completion after fetch.'
      },
      {
        key: 'indexed-docs',
        label: 'Indexed Docs',
        value: formatNumber(indexedDocs),
        tooltip: 'Documents successfully indexed for retrieval/evidence reuse.'
      },
      {
        key: 'fields-filled',
        label: 'Fields Filled',
        value: formatNumber(fieldsFilled),
        tooltip: 'Total field fills emitted from indexed sources this run.'
      },
      {
        key: 'needset-remaining',
        label: 'NeedSet Remaining',
        value: formatNumber(needsetRemaining),
        tooltip: 'Open field deficits still unresolved for the selected run.'
      },
      {
        key: 'llm-calls-traced',
        label: 'LLM Calls Traced',
        value: formatNumber(llmCalls),
        tooltip: 'Total traced LLM calls for this run across plan/triage/extract/validate/write lanes.'
      },
      {
        key: 'session-running-llm-cost',
        label: 'Session Running LLM Cost',
        value: `$${formatNumber(sessionRunningLlmCost, 6)}`,
        tooltip: 'Accumulated LLM cost for the selected run/session (updates while run is active).'
      },
      {
        key: 'content-hash-dedupe-hits',
        label: 'Content Hash Dedupe Hits',
        value: formatNumber(contentHashDedupeHits),
        tooltip: 'Phase 06A: repeated content_hash matches detected from source-processed payloads in this run.'
      },
      {
        key: 'url-cooldowns-active',
        label: 'URL Cooldowns Active',
        value: formatNumber(phase4Summary.cooldownsActive),
        tooltip: 'Phase 04: domains currently showing next_retry cooldown/backoff windows.'
      },
      {
        key: 'scheduler-queue-depth',
        label: 'Scheduler Queue Depth',
        value: formatNumber(phase6bSummary.queueDepth),
        tooltip: 'Phase 06B queue depth across queued/running/failed automation jobs (repair, staleness refresh, deficit rediscovery).'
      },
      {
        key: 'phase07-fields-satisfied',
        label: 'Phase 07 Fields OK',
        value: formatNumber(phase07FieldsSatisfied),
        tooltip: 'Phase 07 fields currently satisfying min reference requirements via prime-source selection.'
      },
      {
        key: 'phase07-refs-selected',
        label: 'Prime Refs Selected',
        value: formatNumber(phase07RefsSelected),
        tooltip: 'Phase 07 prime source references selected across all NeedSet fields.'
      }
    ];
  }, [indexlabSummary, indexlabSerpExplorer, indexlabNeedset, indexlabLlmTracesResp, llmTraceRows, selectedRunLlmMetrics, phase4Summary, phase6Runtime, phase6bSummary, phase7Summary]);
  const pipelineSteps = useMemo<Array<{ label: string; state: PanelStateToken }>>(() => {
    const stageToken = (stage: 'search' | 'fetch' | 'parse' | 'index') => {
      const row = indexlabSummary.stageWindows[stage];
      if (row?.ended_at) return 'ready' as const;
      if (row?.started_at && processRunning) return 'live' as const;
      return 'waiting' as const;
    };
    const phase2Token = indexlabSearchProfile
      ? (normalizeToken(indexlabSearchProfile.status) === 'planned' ? 'live' : 'ready')
      : 'waiting';
    const phase3Token = phase3Status.state === 'live'
      ? 'live'
      : (phase3Status.state === 'ready' ? 'ready' : 'waiting');
    const phase4Token = phase4Status.state === 'live'
      ? 'live'
      : (phase4Status.state === 'ready' ? 'ready' : 'waiting');
    const phase5Token = phase5Status.state === 'live'
      ? 'live'
      : (phase5Status.state === 'ready' ? 'ready' : 'waiting');
    const phase6Token = phase6Status.state === 'live'
      ? 'live'
      : (phase6Status.state === 'ready' ? 'ready' : 'waiting');
    const phase7Token = phase7Status.state === 'live'
      ? 'live'
      : (phase7Status.state === 'ready' ? 'ready' : 'waiting');
    const phase8Token = phase8Status.state === 'live'
      ? 'live'
      : (phase8Status.state === 'ready' ? 'ready' : 'waiting');
    const phase6bToken = phase6bStatus.state === 'live'
      ? 'live'
      : (phase6bStatus.state === 'ready' ? 'ready' : 'waiting');
    return [
      { label: 'search', state: stageToken('search') },
      { label: 'fetch', state: stageToken('fetch') },
      { label: 'parse', state: stageToken('parse') },
      { label: 'index', state: stageToken('index') },
      { label: 'phase 02', state: phase2Token },
      { label: 'phase 03', state: phase3Token },
      { label: 'phase 04', state: phase4Token },
      { label: 'phase 05', state: phase5Token },
      { label: 'phase 06a', state: phase6Token },
      { label: 'phase 07', state: phase7Token },
      { label: 'phase 08', state: phase8Token },
      { label: 'phase 06b', state: phase6bToken }
    ];
  }, [indexlabSummary, processRunning, indexlabSearchProfile, phase3Status, phase4Status, phase5Status, phase6bStatus, phase6Status, phase7Status, phase8Status]);

  const refreshAll = async () => {
    const refreshes: Array<Promise<unknown>> = [
      queryClient.invalidateQueries({ queryKey: ['processStatus', 'indexing'], exact: true }),
      queryClient.invalidateQueries({ queryKey: ['searxng', 'status'], exact: true }),
      queryClient.invalidateQueries({ queryKey: ['indexing', 'llm-config'], exact: true }),
      queryClient.invalidateQueries({ queryKey: ['indexing', 'llm-metrics', category], exact: true }),
      queryClient.invalidateQueries({ queryKey: ['indexing', 'domain-checklist'] }),
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
        queryClient.invalidateQueries({ queryKey: ['indexlab', 'run', selectedIndexLabRunId, 'serp'], exact: true }),
        queryClient.invalidateQueries({ queryKey: ['indexlab', 'run', selectedIndexLabRunId, 'llm-traces'], exact: true }),
        queryClient.invalidateQueries({ queryKey: ['indexlab', 'run', selectedIndexLabRunId, 'phase07-retrieval'], exact: true }),
        queryClient.invalidateQueries({ queryKey: ['indexlab', 'run', selectedIndexLabRunId, 'phase08-extraction'], exact: true }),
        queryClient.invalidateQueries({ queryKey: ['indexlab', 'run', selectedIndexLabRunId, 'evidence-index'] })
      );
    }
    await Promise.allSettled(refreshes);
    await queryClient.refetchQueries({
      queryKey: ['indexlab', 'run'],
      type: 'active'
    });
  };

  const clearSelectedRunView = () => {
    const runId = String(selectedIndexLabRunId || '').trim();
    clearProcessOutput();
    if (!runId) {
      setClearedRunViewId('');
      setSelectedLlmTraceId('');
      return;
    }
    clearIndexLabRun(runId);
    queryClient.removeQueries({ queryKey: ['indexlab', 'run', runId, 'events'], exact: true });
    queryClient.removeQueries({ queryKey: ['indexlab', 'run', runId, 'needset'], exact: true });
    queryClient.removeQueries({ queryKey: ['indexlab', 'run', runId, 'search-profile'], exact: true });
    queryClient.removeQueries({ queryKey: ['indexlab', 'run', runId, 'serp'], exact: true });
    queryClient.removeQueries({ queryKey: ['indexlab', 'run', runId, 'llm-traces'], exact: true });
    queryClient.removeQueries({ queryKey: ['indexlab', 'run', runId, 'phase07-retrieval'], exact: true });
    queryClient.removeQueries({ queryKey: ['indexlab', 'run', runId, 'phase08-extraction'], exact: true });
    queryClient.removeQueries({ queryKey: ['indexing', 'domain-checklist'] });
    setClearedRunViewId(runId);
    setSelectedLlmTraceId('');
  };

  const replaySelectedRunView = async () => {
    const runId = String(selectedIndexLabRunId || '').trim();
    if (!runId || replayPending) return;
    setReplayPending(true);
    try {
      setClearedRunViewId('');
      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: ['indexlab', 'run', runId, 'events'], exact: true }),
        queryClient.invalidateQueries({ queryKey: ['indexlab', 'run', runId, 'needset'], exact: true }),
        queryClient.invalidateQueries({ queryKey: ['indexlab', 'run', runId, 'search-profile'], exact: true }),
        queryClient.invalidateQueries({ queryKey: ['indexlab', 'run', runId, 'serp'], exact: true }),
        queryClient.invalidateQueries({ queryKey: ['indexlab', 'run', runId, 'llm-traces'], exact: true }),
        queryClient.invalidateQueries({ queryKey: ['indexlab', 'run', runId, 'phase07-retrieval'], exact: true }),
        queryClient.invalidateQueries({ queryKey: ['indexlab', 'run', runId, 'phase08-extraction'], exact: true }),
        queryClient.invalidateQueries({ queryKey: ['indexing', 'domain-checklist'] })
      ]);
      await queryClient.refetchQueries({
        queryKey: ['indexlab', 'run', runId],
        type: 'active'
      });
    } finally {
      setReplayPending(false);
    }
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
    mutationFn: () => {
      const parsedCrawleeTimeout = Number.parseInt(crawleeRequestHandlerTimeoutSecs, 10);
      const parsedRetryBudget = Number.parseInt(dynamicFetchRetryBudget, 10);
      const parsedRetryBackoff = Number.parseInt(dynamicFetchRetryBackoffMs, 10);
      return api.post<ProcessStatus>('/process/start', {
        category,
        mode: 'indexlab',
        replaceRunning: true,
        extractionMode: 'balanced',
        productId: singleProductId,
        profile,
        fetchConcurrency: Number.parseInt(fetchConcurrency, 10) || 2,
        perHostMinDelayMs: Number.parseInt(perHostMinDelayMs, 10) || 900,
        dynamicCrawleeEnabled,
        crawleeHeadless,
        crawleeRequestHandlerTimeoutSecs: Number.isFinite(parsedCrawleeTimeout) ? Math.max(0, parsedCrawleeTimeout) : 45,
        dynamicFetchRetryBudget: Number.isFinite(parsedRetryBudget) ? Math.max(0, parsedRetryBudget) : 1,
        dynamicFetchRetryBackoffMs: Number.isFinite(parsedRetryBackoff) ? Math.max(0, parsedRetryBackoff) : 500,
        ...(String(dynamicFetchPolicyMapJson || '').trim()
          ? { dynamicFetchPolicyMapJson: String(dynamicFetchPolicyMapJson || '').trim() }
          : {}),
        discoveryEnabled,
        searchProvider,
        phase2LlmEnabled,
        phase2LlmModel,
        phase3LlmTriageEnabled,
        phase3LlmModel,
        llmModelPlan: phase2LlmModel,
        llmTokensPlan,
        llmModelFast,
        llmTokensFast,
        llmModelTriage: phase3LlmModel,
        llmTokensTriage,
        llmModelReasoning,
        llmTokensReasoning,
        llmModelExtract,
        llmTokensExtract,
        llmModelValidate,
        llmTokensValidate,
        llmModelWrite,
        llmTokensWrite,
        llmFallbackEnabled,
        ...(llmKnobsInitialized ? {
          llmPlanFallbackModel: llmFallbackPlanModel,
          llmExtractFallbackModel: llmFallbackExtractModel,
          llmValidateFallbackModel: llmFallbackValidateModel,
          llmWriteFallbackModel: llmFallbackWriteModel,
          llmTokensPlanFallback,
          llmTokensExtractFallback,
          llmTokensValidateFallback,
          llmTokensWriteFallback
        } : {}),
        ...runControlPayload
      });
    },
    onMutate: () => {
      clearProcessOutput();
      setSelectedIndexLabRunId('');
      setClearedRunViewId('');
    },
    onSuccess: refreshAll
  });

  const stopMut = useMutation({
    mutationFn: async ({ force }: { force: boolean }) => {
      const first = await api.post<ProcessStatus>('/process/stop', { force });
      if (first?.running) {
        return api.post<ProcessStatus>('/process/stop', { force });
      }
      return first;
    },
    onSuccess: refreshAll
  });

  const startSearxngMut = useMutation({
    mutationFn: () => api.post<{ ok: boolean; started: boolean; status: SearxngStatusResponse }>('/searxng/start'),
    onSuccess: refreshAll
  });

  const processStateLabel = processRunning
    ? 'running'
    : (processStatus?.exitCode === 0 && processStatus?.endedAt ? 'completed' : (processStatus?.exitCode !== null && processStatus?.exitCode !== undefined ? 'failed' : 'idle'));
  const busy = startIndexLabMut.isPending || stopMut.isPending || startSearxngMut.isPending || replayPending;
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
                  One click run path. Run IndexLab executes search -&gt; fetch -&gt; parse -&gt; index -&gt; NeedSet/Phase 02/Phase 03 automatically for <span className="font-mono">{category}</span>.
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
          <div className="mt-3 space-y-2">
            <ActivityGauge
              label="overall run activity"
              currentPerMin={runtimeActivity.currentPerMin}
              peakPerMin={runtimeActivity.peakPerMin}
              active={processRunning}
            />
            <ActivityGauge
              label="llm call activity"
              currentPerMin={llmActivity.currentPerMin}
              peakPerMin={llmActivity.peakPerMin}
              active={processRunning || pendingLlmTotal > 0}
              tooltip="Live LLM call lifecycle events (started/completed/failed) per minute."
            />
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center text-gray-600 dark:text-gray-300">
                  pending llm calls
                  <Tip text="Current in-flight LLM calls grouped by purpose + model. Bars shrink to zero when calls complete." />
                </div>
                <div className={`font-semibold ${pendingLlmTotal > 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-gray-500 dark:text-gray-400'}`}>
                  {formatNumber(pendingLlmTotal)}
                </div>
              </div>
              {pendingLlmRows.length === 0 ? (
                <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                  no llm calls pending
                </div>
              ) : (
                <div className="mt-2 space-y-1.5">
                  {pendingLlmRows.slice(0, 8).map((row) => {
                    const widthPct = Math.max(8, Math.min(100, (Number(row.pending || 0) / Math.max(1, pendingLlmPeak)) * 100));
                    const sinceMs = row.firstStartedAtMs > 0 ? Math.max(0, activityNowMs - row.firstStartedAtMs) : 0;
                    return (
                      <div key={`pending-llm:${row.key}`} className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <div className="truncate text-gray-700 dark:text-gray-200" title={`${row.reason} | ${row.model}`}>
                            {row.reason} | {row.model}
                          </div>
                          <div className="font-semibold text-emerald-600 dark:text-emerald-300">
                            {formatNumber(Number(row.pending || 0))}
                          </div>
                        </div>
                        <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-gray-500 dark:text-gray-400">
                          <span className="truncate" title={`${row.provider} | ${row.routeRole || 'n/a'}`}>
                            {row.provider} | role {row.routeRole || 'n/a'}
                          </span>
                          <span>{sinceMs > 0 ? `pending ${formatDuration(sinceMs)}` : 'pending'}</span>
                        </div>
                        <div className="mt-1 h-1.5 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden">
                          <div
                            className="h-full rounded bg-emerald-500"
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              <div className={`rounded border px-2 py-2 ${activePendingLlm ? 'border-emerald-400 dark:border-emerald-500' : 'border-gray-200 dark:border-gray-700'}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <div className={`font-semibold ${activePendingLlm ? 'text-emerald-700 dark:text-emerald-300' : 'text-gray-800 dark:text-gray-200'}`}>
                      Pending LLM Prompt
                    </div>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${llmPhaseBadgeClasses(pendingPromptPhase)}`}>
                      {llmPhaseLabel(pendingPromptPhase)}
                    </span>
                    {pendingPromptIsJson ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                        JSON
                      </span>
                    ) : null}
                  </div>
                  <button
                    onClick={() => setPendingPromptCollapsed((prev) => !prev)}
                    className={`inline-flex items-center justify-center w-5 h-5 text-[10px] rounded border ${activePendingLlm ? 'border-emerald-400 dark:border-emerald-500 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/20' : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                    title={pendingPromptCollapsed ? 'Open panel' : 'Close panel'}
                  >
                    {pendingPromptCollapsed ? '+' : '-'}
                  </button>
                </div>
                <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                  {activePendingLlm
                    ? `${activePendingLlm.reason} | ${activePendingLlm.model} | role ${activePendingLlm.routeRole || 'n/a'} | pending ${formatNumber(Number(activePendingLlm.pending || 0))}`
                    : 'no pending prompt'}
                </div>
                {!pendingPromptCollapsed ? (
                  <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] max-h-56 overflow-y-auto text-gray-700 dark:text-gray-200">
                    {activePendingLlm
                      ? (pendingPromptPretty || '(prompt preview not available yet for the active call)')
                      : '(no pending llm prompt)'}
                  </pre>
                ) : null}
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <div className="font-semibold text-gray-800 dark:text-gray-200">
                      Last Received Response
                    </div>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${llmPhaseBadgeClasses(lastReceivedPhase)}`}>
                      {llmPhaseLabel(lastReceivedPhase)}
                    </span>
                    {lastReceivedResponseIsJson ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                        JSON
                      </span>
                    ) : null}
                  </div>
                  <button
                    onClick={() => setLastResponseCollapsed((prev) => !prev)}
                    className="inline-flex items-center justify-center w-5 h-5 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                    title={lastResponseCollapsed ? 'Open panel' : 'Close panel'}
                  >
                    {lastResponseCollapsed ? '+' : '-'}
                  </button>
                </div>
                <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                  {lastReceivedResponseTrace
                    ? `${String(lastReceivedResponseTrace.purpose || 'unknown')} | ${String(lastReceivedResponseTrace.model || 'unknown')} | ${formatDateTime(lastReceivedResponseTrace.ts || null)}`
                    : lastReceivedResponseEvent
                      ? `${String(lastReceivedResponseEvent.purpose || 'unknown')} | ${String(lastReceivedResponseEvent.model || 'unknown')} | ${formatDateTime(lastReceivedResponseEvent.ts || null)}`
                    : 'no response received yet'}
                </div>
                {!lastResponseCollapsed ? (
                  <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] max-h-56 overflow-y-auto text-gray-700 dark:text-gray-200">
                    {lastReceivedResponsePretty || '(no response trace yet)'}
                  </pre>
                ) : null}
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2 text-xs">
              {pipelineSteps.map((step) => (
                <div key={`pipeline-step:${step.label}`} className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1 flex items-center justify-between gap-2">
                  <span className="text-gray-600 dark:text-gray-300">{step.label}</span>
                  <span className={`px-1.5 py-0.5 rounded ${panelStateChipClasses(step.state)}`}>
                    {step.state}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-2 space-y-2" style={{ order: 15 }}>
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
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 text-xs">
          {containerStatuses.map((row) => (
            <div key={`container-status:${row.label}`} className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1 flex items-center justify-between gap-2">
              <div className="text-gray-600 dark:text-gray-300">{row.label}</div>
              <div className="flex items-center gap-2">
                <span className={`px-1.5 py-0.5 rounded ${panelStateChipClasses(row.state)}`}>
                  {row.state}
                </span>
                <span className="text-gray-500 dark:text-gray-400">{row.detail}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-2" style={{ order: 16 }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center text-sm font-semibold text-gray-900 dark:text-gray-100">
            <span>Session Data</span>
            <Tip text="High-level run summary for crawl/fetch coverage and phase progression signals." />
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            run {selectedIndexLabRunId || '-'}
          </div>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-1 gap-2 text-xs">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {sessionCrawledCells.slice(0, 5).map((cell) => (
              <div key={`session-craweds:top:${cell.key}`} className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">
                  {cell.label}
                  <Tip text={cell.tooltip} />
                </div>
                <div className={`font-semibold ${cell.placeholder ? 'text-amber-700 dark:text-amber-300' : 'text-gray-900 dark:text-gray-100'}`}>
                  {cell.value}
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {sessionCrawledCells.slice(5).map((cell) => (
              <div key={`session-craweds:extra:${cell.key}`} className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">
                  {cell.label}
                  <Tip text={cell.tooltip} />
                </div>
                <div className={`font-semibold ${cell.placeholder ? 'text-amber-700 dark:text-amber-300' : 'text-gray-900 dark:text-gray-100'}`}>
                  {cell.value}
                </div>
              </div>
            ))}
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
            <span>LLM Output Review (All Phases)</span>
            <Tip text="Readable review of SearchProfile + SERP triage + raw traced LLM calls across all phases." />
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
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold text-gray-800 dark:text-gray-200">Phase 03 output review</div>
                <span className={`px-1.5 py-0.5 rounded text-xs ${panelStateChipClasses(
                  phase3Status.state === 'live'
                    ? 'live'
                    : (phase3Status.state === 'ready' ? 'ready' : 'waiting')
                )}`}>
                  {phase3Status.label}
                </span>
              </div>
              <div className="text-gray-500 dark:text-gray-400">
                {phase3Status.message}
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
                        <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={6}>
                          no selected urls yet ({phase3Status.label})
                        </td>
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
                        <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={5}>
                          no junk/wrong-model skips yet ({phase3Status.label})
                        </td>
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

              <div className="rounded border border-gray-200 dark:border-gray-700 p-2 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-gray-800 dark:text-gray-200">LLM call trace (all phases)</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {formatNumber(Number(indexlabLlmTracesResp?.count || llmTraceRows.length))} calls traced
                  </div>
                </div>
                <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                        <th className="py-1 pr-3">time</th>
                        <th className="py-1 pr-3">phase</th>
                        <th className="py-1 pr-3">role</th>
                        <th className="py-1 pr-3">purpose</th>
                        <th className="py-1 pr-3">provider</th>
                        <th className="py-1 pr-3">model</th>
                        <th className="py-1 pr-3">status</th>
                        <th className="py-1 pr-3">tokens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {llmTraceRows.length === 0 && (
                        <tr>
                          <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={8}>
                            no llm traces yet for this run
                          </td>
                        </tr>
                      )}
                      {llmTraceRows.slice(0, 40).map((row) => {
                        const isSelected = selectedLlmTrace?.id === row.id;
                        const tokenCount = Number(row.usage?.total_tokens || 0);
                        return (
                          <tr
                            key={row.id}
                            className={`border-b border-gray-100 dark:border-gray-800 cursor-pointer ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                            onClick={() => setSelectedLlmTraceId(row.id)}
                            title="Click to inspect prompt/response"
                          >
                            <td className="py-1 pr-3">{formatDateTime(row.ts || null)}</td>
                            <td className="py-1 pr-3">{llmPhaseLabel(String(row.phase || ''))}</td>
                            <td className="py-1 pr-3">{row.role || '-'}</td>
                            <td className="py-1 pr-3 font-mono truncate max-w-[18rem]" title={String(row.purpose || '')}>{row.purpose || '-'}</td>
                            <td className="py-1 pr-3">{row.provider || '-'}</td>
                            <td className="py-1 pr-3 font-mono truncate max-w-[16rem]" title={String(row.model || '')}>{row.model || '-'}</td>
                            <td className="py-1 pr-3">{row.status || '-'}</td>
                            <td className="py-1 pr-3">{formatNumber(tokenCount)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="rounded border border-gray-200 dark:border-gray-700 p-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="font-semibold text-gray-800 dark:text-gray-200">
                      Selected call details
                    </div>
                    {selectedLlmTrace ? (
                      <div className="text-gray-500 dark:text-gray-400">
                        {llmPhaseLabel(String(selectedLlmTrace.phase || ''))}
                        {selectedLlmTrace.purpose ? ` | ${selectedLlmTrace.purpose}` : ''}
                      </div>
                    ) : null}
                  </div>
                  {!selectedLlmTrace ? (
                    <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">select a traced call to inspect its output</div>
                  ) : (
                    <div className="mt-2 grid grid-cols-1 xl:grid-cols-2 gap-2 text-xs">
                      <div className="rounded border border-gray-200 dark:border-gray-700 p-2">
                        <div className="font-semibold text-gray-800 dark:text-gray-200">prompt</div>
                        <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] max-h-64 overflow-y-auto text-gray-700 dark:text-gray-200">
                          {prettyJsonText(String(selectedLlmTrace.prompt_preview || '')) || '(no prompt trace)'}
                        </pre>
                      </div>
                      <div className="rounded border border-gray-200 dark:border-gray-700 p-2">
                        <div className="font-semibold text-gray-800 dark:text-gray-200">response</div>
                        <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] max-h-64 overflow-y-auto text-gray-700 dark:text-gray-200">
                          {prettyJsonText(String(selectedLlmTrace.response_preview || '')) || '(no response trace)'}
                        </pre>
                        {selectedLlmTrace.error ? (
                          <div className="mt-2 rounded border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/20 p-2 text-rose-700 dark:text-rose-300">
                            {selectedLlmTrace.error}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
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
            <Tip text="Live call/cost/token counters from ledger + pricing rows for all currently selected route/fallback models." />
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
            <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-gray-800 dark:text-gray-200">
                <div className="flex items-center gap-1.5">
                  <span>Active Model Pricing ({formatNumber(selectedLlmPricingRows.length)} rows)</span>
                  <Tip text="Per-knob model pricing used for live cost estimation. Rows also show whether the current model matches the default role model." />
                  {indexingLlmConfig?.pricing_meta?.as_of ? (
                    <span className="text-[10px] text-gray-500 dark:text-gray-400">
                      as of {indexingLlmConfig.pricing_meta.as_of}
                    </span>
                  ) : null}
                </div>
                <button
                  onClick={() => setActiveModelPricingCollapsed((prev) => !prev)}
                  className="inline-flex items-center justify-center w-5 h-5 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                  title={activeModelPricingCollapsed ? 'Open pricing table' : 'Close pricing table'}
                >
                  {activeModelPricingCollapsed ? '+' : '-'}
                </button>
              </div>
              {!activeModelPricingCollapsed ? (
                <>
                  <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                    sources:
                    {Object.entries(indexingLlmConfig?.pricing_meta?.sources || {}).map(([provider, link]) => (
                      <span key={`pricing-source:${provider}`} className="ml-2">
                        <a
                          href={link}
                          target="_blank"
                          rel="noreferrer"
                          className="underline hover:text-gray-700 dark:hover:text-gray-200"
                        >
                          {provider}
                        </a>
                      </span>
                    ))}
                  </div>
                  <table className="mt-2 min-w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                        <th className="py-1 pr-3">
                          <span className="inline-flex items-center">knob<Tip text="The lane/control that owns this model selection." /></span>
                        </th>
                        <th className="py-1 pr-3">
                          <span className="inline-flex items-center">provider<Tip text="Resolved provider by selected model name (openai/gemini/deepseek)." /></span>
                        </th>
                        <th className="py-1 pr-3">
                          <span className="inline-flex items-center">model<Tip text="Current selected model with default-model linkage badge." /></span>
                        </th>
                        <th className="py-1 pr-3">
                          <span className="inline-flex items-center">token cap<Tip text="Current max output tokens for this knob (compared to default cap)." /></span>
                        </th>
                        <th className="py-1 pr-3">
                          <span className="inline-flex items-center">input / 1M<Tip text="USD per 1M input tokens." /></span>
                        </th>
                        <th className="py-1 pr-3">
                          <span className="inline-flex items-center">output / 1M<Tip text="USD per 1M output tokens." /></span>
                        </th>
                        <th className="py-1 pr-3">
                          <span className="inline-flex items-center">cached / 1M<Tip text="USD per 1M cached-input tokens (cache-hit pricing)." /></span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedLlmPricingRows.length === 0 && (
                        <tr>
                          <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={7}>no selected model pricing rows</td>
                        </tr>
                      )}
                      {selectedLlmPricingRows.map((row) => (
                        <tr key={`selected-pricing:${row.knob}:${row.model}`} className="border-b border-gray-100 dark:border-gray-800">
                          <td className="py-1 pr-3">{row.knob}</td>
                          <td className="py-1 pr-3">{row.provider}</td>
                          <td className="py-1 pr-3 font-mono">
                            <span>{row.model}</span>
                            {row.default_model ? (
                              <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] ${row.uses_default_model ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                                {row.uses_default_model ? 'default' : `default ${row.default_model}`}
                              </span>
                            ) : null}
                          </td>
                          <td className="py-1 pr-3">
                            <span>{formatNumber(Number(row.token_cap || 0))}</span>
                            {row.default_token_cap ? (
                              <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] ${row.uses_default_token_cap ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                                {row.uses_default_token_cap ? 'default' : `default ${formatNumber(Number(row.default_token_cap || 0))}`}
                              </span>
                            ) : null}
                          </td>
                          <td className="py-1 pr-3">${formatNumber(row.input_per_1m, 4)}</td>
                          <td className="py-1 pr-3">${formatNumber(row.output_per_1m, 4)}</td>
                          <td className="py-1 pr-3">${formatNumber(row.cached_input_per_1m, 4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : null}
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

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3" style={{ order: 47 }}>
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
            {indexlabSerpExplorer
              ? `${indexlabSerpExplorer.provider || 'unknown'}${indexlabSerpExplorer.summary_only ? ' | summary fallback' : ''}`
              : 'not generated'}
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
          <div className="text-xs text-gray-500 dark:text-gray-400">
            no SERP payload yet for this run ({phase3Status.label}).
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3" style={{ order: 49 }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center text-sm font-semibold text-gray-900 dark:text-gray-100">
            <button
              onClick={() => togglePanel('phase5')}
              className="inline-flex items-center justify-center w-5 h-5 mr-1 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              title={panelCollapsed.phase5 ? 'Open panel' : 'Close panel'}
            >
              {panelCollapsed.phase5 ? '+' : '-'}
            </button>
            <span>Parallel Fetch & Parse (Phase 05)</span>
            <Tip text="Starter Phase 05 visibility: in-flight fetch parallelism, fetch completion mix (HTTP/browser), and active host load." />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              run {selectedIndexLabRunId || '-'} | {phase5Status.label}
            </div>
            <ActivityGauge
              label="phase 05 activity"
              currentPerMin={phase5Activity.currentPerMin}
              peakPerMin={phase5Activity.peakPerMin}
              active={processRunning}
            />
          </div>
        </div>
        {!panelCollapsed.phase5 ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 xl:grid-cols-10 gap-2 text-xs">
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">in-flight now<Tip text="Current number of fetch jobs that are running right now." /></div>
                <div className="font-semibold">{formatNumber(phase5Runtime.activeInflight)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">peak in-flight<Tip text="Highest concurrent in-flight fetch count seen during this run view." /></div>
                <div className="font-semibold">{formatNumber(phase5Runtime.peakInflight)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">fetch started<Tip text="Total fetch-start events emitted so far." /></div>
                <div className="font-semibold">{formatNumber(phase5Runtime.started)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">fetch completed<Tip text="Fetch jobs that completed successfully regardless of downstream parse/index state." /></div>
                <div className="font-semibold">{formatNumber(phase5Runtime.completed)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">fetch failed<Tip text="Fetch jobs that ended in an explicit failure event." /></div>
                <div className="font-semibold">{formatNumber(phase5Runtime.failed)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">http finished<Tip text="Completed fetches using HTTP transport." /></div>
                <div className="font-semibold">{formatNumber(phase5Runtime.httpCount)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">browser finished<Tip text="Completed fetches using browser automation/rendering path." /></div>
                <div className="font-semibold">{formatNumber(phase5Runtime.browserCount)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">other/unknown<Tip text="Completed fetches where transport mode is missing or non-standard." /></div>
                <div className="font-semibold">{formatNumber(phase5Runtime.otherCount)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">p95 fetch<Tip text="95th percentile fetch duration (network + transfer), from fetch completion events." /></div>
                <div className="font-semibold">{formatLatencyMs(phase5Runtime.fetchP95Ms)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">p95 parse<Tip text="95th percentile parse/extraction duration captured on processed sources." /></div>
                <div className="font-semibold">{formatLatencyMs(phase5Runtime.parseP95Ms)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">article sampled<Tip text="Parse events that carried article extraction telemetry (method/quality/chars)." /></div>
                <div className="font-semibold">{formatNumber(phase5Runtime.articleSamples)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">readability hits<Tip text="Count of parse events where article extractor method was Readability." /></div>
                <div className="font-semibold">{formatNumber(phase5Runtime.articleReadability)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">fallback hits<Tip text="Count of parse events where fallback/heuristic article extraction was used." /></div>
                <div className="font-semibold">{formatNumber(phase5Runtime.articleFallback)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">avg article score<Tip text="Average article quality score from extraction telemetry (0-100)." /></div>
                <div className="font-semibold">{formatNumber(phase5Runtime.articleAvgScore, 1)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">low-quality article<Tip text="Article extraction rows flagged as low quality by score/length guard." /></div>
                <div className="font-semibold">{formatNumber(phase5Runtime.articleLowQuality)}</div>
              </div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
              <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
                Active Hosts ({formatNumber(phase5Runtime.hostsActive.length)} shown)
                <Tip text="Per-host in-flight concurrency snapshot from current runtime events." />
              </div>
              <table className="mt-2 min-w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <th className="py-1 pr-3">host</th>
                    <th className="py-1 pr-3">in-flight</th>
                  </tr>
                </thead>
                <tbody>
                  {phase5Runtime.hostsActive.length === 0 ? (
                    <tr>
                      <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={2}>no active hosts</td>
                    </tr>
                  ) : (
                    phase5Runtime.hostsActive.map((row) => (
                      <tr key={`phase5-host:${row.host}`} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-1 pr-3 font-mono">{row.host}</td>
                        <td className="py-1 pr-3">{formatNumber(row.inflight)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 p-2 space-y-2">
              <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
                Article Preview (latest parsed URL)
                <Tip text="Shows the most recent article extraction preview captured from parse telemetry for quick quality checks." />
              </div>
              {phase5ArticlePreviewJob ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
                    <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                      <div className="text-gray-500 dark:text-gray-400">method</div>
                      <div className="font-semibold">{phase5ArticlePreviewJob.article_method || '-'}</div>
                    </div>
                    <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                      <div className="text-gray-500 dark:text-gray-400">score</div>
                      <div className="font-semibold">{formatNumber(Number(phase5ArticlePreviewJob.article_quality_score || 0), 1)}</div>
                    </div>
                    <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                      <div className="text-gray-500 dark:text-gray-400">chars</div>
                      <div className="font-semibold">{formatNumber(Number(phase5ArticlePreviewJob.article_char_count || 0))}</div>
                    </div>
                    <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                      <div className="text-gray-500 dark:text-gray-400">low-quality</div>
                      <div className="font-semibold">{phase5ArticlePreviewJob.article_low_quality ? 'yes' : 'no'}</div>
                    </div>
                    <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1 md:col-span-2">
                      <div className="text-gray-500 dark:text-gray-400">url</div>
                      <div className="font-mono truncate" title={phase5ArticlePreviewJob.url || ''}>
                        {phase5ArticlePreviewJob.url || '-'}
                      </div>
                    </div>
                  </div>
                  <div className="rounded border border-gray-200 dark:border-gray-700 p-2 text-xs bg-gray-50 dark:bg-gray-900/30">
                    <div className="text-gray-500 dark:text-gray-400 mb-1">title</div>
                    <div className="font-medium text-gray-800 dark:text-gray-100">
                      {phase5ArticlePreviewJob.article_title || '-'}
                    </div>
                    {phase5ArticlePreviewJob.article_fallback_reason ? (
                      <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                        fallback: {phase5ArticlePreviewJob.article_fallback_reason}
                      </div>
                    ) : null}
                  </div>
                  <pre className="rounded border border-gray-200 dark:border-gray-700 p-2 text-xs whitespace-pre-wrap break-words max-h-56 overflow-auto bg-white dark:bg-gray-900/30">
                    {phase5ArticlePreviewJob.article_preview || phase5ArticlePreviewJob.article_excerpt || '(no extracted article preview text for this URL yet)'}
                  </pre>
                </>
              ) : (
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  no parsed article telemetry yet
                </div>
              )}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              phase 05 runtime knobs: concurrency {fetchConcurrency || '2'} | per-host delay {perHostMinDelayMs || '900'} ms | crawlee {dynamicCrawleeEnabled ? 'on' : 'off'} | retry {dynamicFetchRetryBudget || '1'} | backoff {dynamicFetchRetryBackoffMs || '500'} ms
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              phase 05 skip reasons: cooldown {formatNumber(phase5Runtime.skippedCooldown)} | blocked budget {formatNumber(phase5Runtime.skippedBlockedBudget)} | retry later {formatNumber(phase5Runtime.skippedRetryLater)}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              article extraction: sampled {formatNumber(phase5Runtime.articleSamples)} | avg score {formatNumber(phase5Runtime.articleAvgScore, 1)} | avg chars {formatNumber(phase5Runtime.articleAvgChars, 0)} | low-quality {formatNumber(phase5Runtime.articleLowQuality)}
            </div>
          </>
        ) : null}
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3" style={{ order: 51 }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center text-sm font-semibold text-gray-900 dark:text-gray-100">
            <button
              onClick={() => togglePanel('phase6b')}
              className="inline-flex items-center justify-center w-5 h-5 mr-1 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              title={panelCollapsed.phase6b ? 'Open panel' : 'Close panel'}
            >
              {panelCollapsed.phase6b ? '+' : '-'}
            </button>
            <span>Automation Queue (Phase 06B)</span>
            <Tip text="Scheduler control-plane proof: repair search, staleness refresh, and NeedSet deficit rediscovery job transitions." />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              run {selectedIndexLabRunId || '-'} | {phase6bStatus.label}
            </div>
            <ActivityGauge
              label="phase 06b activity"
              currentPerMin={phase6bActivity.currentPerMin}
              peakPerMin={phase6bActivity.peakPerMin}
              active={processRunning}
            />
          </div>
        </div>
        {!panelCollapsed.phase6b ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-12 gap-2 text-xs">
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">total jobs<Tip text="Total Phase 06B automation jobs derived for this run." /></div>
                <div className="font-semibold">{formatNumber(phase6bSummary.totalJobs)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">queue depth<Tip text="Queued + running + failed jobs waiting on scheduler follow-through." /></div>
                <div className="font-semibold">{formatNumber(phase6bSummary.queueDepth)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">active<Tip text="Queued + running jobs currently active in automation flow." /></div>
                <div className="font-semibold">{formatNumber(phase6bSummary.activeJobs)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">cooldown<Tip text="Jobs currently in cooldown/backoff state waiting for next retry window." /></div>
                <div className="font-semibold">{formatNumber(phase6bSummary.cooldown)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">queued<Tip text="Queued jobs pending execution." /></div>
                <div className="font-semibold">{formatNumber(phase6bSummary.queued)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">running<Tip text="Jobs currently in running state." /></div>
                <div className="font-semibold">{formatNumber(phase6bSummary.running)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">done<Tip text="Jobs completed successfully in this run timeline." /></div>
                <div className="font-semibold">{formatNumber(phase6bSummary.done)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">failed<Tip text="Jobs that ended without usable results and need follow-up." /></div>
                <div className="font-semibold">{formatNumber(phase6bSummary.failed)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">repair jobs<Tip text="Repair-search jobs created from URL-health failure signals." /></div>
                <div className="font-semibold">{formatNumber(phase6bSummary.repairSearch)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">refresh jobs<Tip text="Staleness/content-hash refresh jobs derived from repeated hash signals." /></div>
                <div className="font-semibold">{formatNumber(phase6bSummary.stalenessRefresh)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">deficit jobs<Tip text="NeedSet-driven rediscovery jobs for fields still below quality gates." /></div>
                <div className="font-semibold">{formatNumber(phase6bSummary.deficitRediscovery)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">domain backoff<Tip text="Host/domain backoff jobs from blocked/cooldown conditions." /></div>
                <div className="font-semibold">{formatNumber(phase6bSummary.domainBackoff)}</div>
              </div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
              <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
                Queue Jobs ({formatNumber(phase6bJobs.length)} shown)
                <Tip text="Current scheduler-style job ledger with dedupe key, source signal, next retry, and reason tags." />
              </div>
              <table className="mt-2 min-w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <th className="py-1 pr-3">type</th>
                    <th className="py-1 pr-3">status</th>
                    <th className="py-1 pr-3">signal</th>
                    <th className="py-1 pr-3">priority</th>
                    <th className="py-1 pr-3">field targets</th>
                    <th className="py-1 pr-3">query / url</th>
                    <th className="py-1 pr-3">domain</th>
                    <th className="py-1 pr-3">attempts</th>
                    <th className="py-1 pr-3">next run</th>
                    <th className="py-1 pr-3">reasons</th>
                  </tr>
                </thead>
                <tbody>
                  {phase6bJobs.length === 0 ? (
                    <tr>
                      <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={10}>no phase 06b jobs yet</td>
                    </tr>
                  ) : (
                    phase6bJobs.slice(0, 40).map((row) => (
                      <tr key={`phase6b-job:${row.job_id}`} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-1 pr-3 font-mono">{row.job_type || '-'}</td>
                        <td className="py-1 pr-3">
                          <span className={`px-1.5 py-0.5 rounded ${
                            normalizeToken(row.status || '') === 'done'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                              : normalizeToken(row.status || '') === 'running'
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                                : normalizeToken(row.status || '') === 'failed'
                                  ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
                                  : normalizeToken(row.status || '') === 'cooldown'
                                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                                    : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                          }`}>
                            {row.status || '-'}
                          </span>
                        </td>
                        <td className="py-1 pr-3">{row.source_signal || '-'}</td>
                        <td className="py-1 pr-3">{formatNumber(Number(row.priority || 0))}</td>
                        <td className="py-1 pr-3 font-mono">{(row.field_targets || []).slice(0, 3).join(', ') || '-'}</td>
                        <td className="py-1 pr-3 font-mono truncate max-w-[24rem]" title={row.query || row.url || ''}>{row.query || row.url || '-'}</td>
                        <td className="py-1 pr-3 font-mono">{row.domain || '-'}</td>
                        <td className="py-1 pr-3">{formatNumber(Number(row.attempt_count || 0))}</td>
                        <td className="py-1 pr-3">{formatDateTime(row.next_run_at || null)}</td>
                        <td className="py-1 pr-3">
                          <div className="flex flex-wrap gap-1">
                            {(row.reason_tags || []).slice(0, 4).map((reason) => (
                              <span key={`phase6b-job-reason:${row.job_id}:${reason}`} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
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
            <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
              <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
                Transition Feed ({formatNumber(phase6bActions.length)} shown)
                <Tip text="Latest queue transitions/action feed to prove scheduling behavior over time." />
              </div>
              <table className="mt-2 min-w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <th className="py-1 pr-3">time</th>
                    <th className="py-1 pr-3">event</th>
                    <th className="py-1 pr-3">job</th>
                    <th className="py-1 pr-3">status</th>
                    <th className="py-1 pr-3">detail</th>
                  </tr>
                </thead>
                <tbody>
                  {phase6bActions.length === 0 ? (
                    <tr>
                      <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={5}>no automation transitions yet</td>
                    </tr>
                  ) : (
                    phase6bActions.slice(0, 40).map((row, idx) => (
                      <tr key={`phase6b-action:${row.job_id || idx}:${row.event || idx}`} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-1 pr-3">{formatDateTime(row.ts || null)}</td>
                        <td className="py-1 pr-3 font-mono">{row.event || '-'}</td>
                        <td className="py-1 pr-3 font-mono">{row.job_type || '-'}</td>
                        <td className="py-1 pr-3">{row.status || '-'}</td>
                        <td className="py-1 pr-3">{row.detail || '-'}</td>
                      </tr>
                    ))
                  )}
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
              onClick={() => togglePanel('phase6')}
              className="inline-flex items-center justify-center w-5 h-5 mr-1 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              title={panelCollapsed.phase6 ? 'Open panel' : 'Close panel'}
            >
              {panelCollapsed.phase6 ? '+' : '-'}
            </button>
            <span>Evidence Index & Dedupe (Phase 06A)</span>
            <Tip text="Phase 06A: content-hash dedupe plus DB-backed evidence inventory and search for this run." />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              run {selectedIndexLabRunId || '-'} | {phase6Status.label}
            </div>
            <ActivityGauge
              label="phase 06a activity"
              currentPerMin={phase6Activity.currentPerMin}
              peakPerMin={phase6Activity.peakPerMin}
              active={processRunning}
            />
          </div>
        </div>
        {!panelCollapsed.phase6 ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-12 gap-2 text-xs">
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">sources processed<Tip text="Total source_processed events observed for this run." /></div>
                <div className="font-semibold">{formatNumber(phase6Runtime.processed)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">unique hashes<Tip text="Distinct content_hash values seen across processed sources." /></div>
                <div className="font-semibold">{formatNumber(phase6Runtime.uniqueHashes)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">dedupe hits<Tip text="Repeated content_hash occurrences beyond first-seen unique payloads." /></div>
                <div className="font-semibold">{formatNumber(phase6Runtime.dedupeHits)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">hash coverage<Tip text="Percent of processed rows carrying a non-empty content_hash." /></div>
                <div className="font-semibold">{formatNumber(phase6Runtime.hashCoveragePct, 1)}%</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">parse finished<Tip text="Parse completion count correlated with this run window." /></div>
                <div className="font-semibold">{formatNumber(phase6Runtime.parseFinished)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">index finished<Tip text="Index completion count correlated with this run window." /></div>
                <div className="font-semibold">{formatNumber(phase6Runtime.indexFinished)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">payload bytes<Tip text="Total source_processed payload byte volume represented in this run view." /></div>
                <div className="font-semibold">{formatBytes(phase6Runtime.totalBytes)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">missing hash rows<Tip text="Processed rows without content_hash (cannot dedupe safely)." /></div>
                <div className="font-semibold">{formatNumber(phase6Runtime.missingHash)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">inventory docs<Tip text="Phase 06A DB inventory: matched source documents for this run scope." /></div>
                <div className="font-semibold">{formatNumber(phase6EvidenceSummary.documents)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">assertions<Tip text="Phase 06A DB inventory: extracted assertions linked to sources." /></div>
                <div className="font-semibold">{formatNumber(phase6EvidenceSummary.assertions)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">evidence refs<Tip text="Phase 06A DB inventory: quote/snippet evidence rows tied to assertions." /></div>
                <div className="font-semibold">{formatNumber(phase6EvidenceSummary.evidenceRefs)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">inventory mode<Tip text="run: exact run_id rows were found; product_fallback: used product scope when run-scoped rows were unavailable." /></div>
                <div className="font-semibold font-mono">
                  {phase6EvidenceSummary.dbReady ? phase6EvidenceSummary.scopeMode : 'db offline'}
                </div>
              </div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
              <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
                Repeated Content Hashes ({formatNumber(phase6Runtime.repeatedHashes.length)} shown)
                <Tip text="Top repeated content hashes to prove dedupe behavior and repeated-source churn." />
              </div>
              <table className="mt-2 min-w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <th className="py-1 pr-3">content hash</th>
                    <th className="py-1 pr-3">hits</th>
                    <th className="py-1 pr-3">host</th>
                    <th className="py-1 pr-3">content type</th>
                    <th className="py-1 pr-3">bytes</th>
                    <th className="py-1 pr-3">last url</th>
                    <th className="py-1 pr-3">last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {phase6Runtime.repeatedHashes.length === 0 ? (
                    <tr>
                      <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={7}>no repeated content hashes yet</td>
                    </tr>
                  ) : (
                    phase6Runtime.repeatedHashes.map((row) => (
                      <tr key={`phase6-hash:${row.contentHash}`} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-1 pr-3 font-mono">{String(row.contentHash || '').slice(0, 24)}...</td>
                        <td className="py-1 pr-3">{formatNumber(row.hits)}</td>
                        <td className="py-1 pr-3 font-mono">{row.host || '-'}</td>
                        <td className="py-1 pr-3">{row.contentType || '-'}</td>
                        <td className="py-1 pr-3">{formatBytes(row.bytes)}</td>
                        <td className="py-1 pr-3 font-mono truncate max-w-[32rem]" title={row.lastUrl}>
                          {row.lastUrl || '-'}
                        </td>
                        <td className="py-1 pr-3">{formatDateTime(row.lastTs)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
              <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
                Evidence Inventory Documents ({formatNumber(phase6EvidenceDocuments.length)} shown)
                <Tip text="Phase 06A DB-backed source inventory for this run scope (source rows, artifacts, hashes, assertions)." />
              </div>
              <table className="mt-2 min-w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <th className="py-1 pr-3">source</th>
                    <th className="py-1 pr-3">tier</th>
                    <th className="py-1 pr-3">artifacts</th>
                    <th className="py-1 pr-3">hashes</th>
                    <th className="py-1 pr-3">assertions</th>
                    <th className="py-1 pr-3">refs</th>
                    <th className="py-1 pr-3">url</th>
                  </tr>
                </thead>
                <tbody>
                  {phase6EvidenceDocuments.length === 0 ? (
                    <tr>
                      <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={7}>no evidence inventory documents yet</td>
                    </tr>
                  ) : (
                    phase6EvidenceDocuments.slice(0, 40).map((row) => (
                      <tr key={`phase6-doc:${row.source_id}`} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-1 pr-3 font-mono">{row.source_id || '-'}</td>
                        <td className="py-1 pr-3">{row.source_tier === null || row.source_tier === undefined ? '-' : formatNumber(Number(row.source_tier || 0))}</td>
                        <td className="py-1 pr-3">{formatNumber(Number(row.artifact_count || 0))}</td>
                        <td className="py-1 pr-3">{formatNumber(Number(row.unique_hashes || 0))}</td>
                        <td className="py-1 pr-3">{formatNumber(Number(row.assertion_count || 0))}</td>
                        <td className="py-1 pr-3">{formatNumber(Number(row.evidence_ref_count || 0))}</td>
                        <td className="py-1 pr-3 font-mono truncate max-w-[28rem]" title={row.source_url || ''}>{row.source_url || '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
              <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
                Top Indexed Fields ({formatNumber(phase6EvidenceTopFields.length)} shown)
                <Tip text="Phase 06A field coverage from source assertions/evidence refs in DB scope." />
              </div>
              <table className="mt-2 min-w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <th className="py-1 pr-3">field</th>
                    <th className="py-1 pr-3">assertions</th>
                    <th className="py-1 pr-3">refs</th>
                    <th className="py-1 pr-3">sources</th>
                  </tr>
                </thead>
                <tbody>
                  {phase6EvidenceTopFields.length === 0 ? (
                    <tr>
                      <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={4}>no field coverage rows yet</td>
                    </tr>
                  ) : (
                    phase6EvidenceTopFields.slice(0, 24).map((row) => (
                      <tr key={`phase6-field:${row.field_key}`} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-1 pr-3 font-mono">{row.field_key || '-'}</td>
                        <td className="py-1 pr-3">{formatNumber(Number(row.assertions || 0))}</td>
                        <td className="py-1 pr-3">{formatNumber(Number(row.evidence_refs || 0))}</td>
                        <td className="py-1 pr-3">{formatNumber(Number(row.distinct_sources || 0))}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
                  Evidence Search (Phase 06A)
                  <Tip text="DB-backed search over field key/value/quote/snippet text for this run scope." />
                </div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400">
                  matches {formatNumber(phase6EvidenceSearchRows.length)}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={phase6SearchQuery}
                  onChange={(event) => setPhase6SearchQuery(event.target.value)}
                  placeholder="search evidence text, value, or field key"
                  className="w-full max-w-xl rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1 text-xs"
                />
                <button
                  onClick={() => setPhase6SearchQuery('')}
                  className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  clear
                </button>
              </div>
              <div className="mt-2 overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                      <th className="py-1 pr-3">field</th>
                      <th className="py-1 pr-3">context</th>
                      <th className="py-1 pr-3">value</th>
                      <th className="py-1 pr-3">quote/snippet</th>
                      <th className="py-1 pr-3">source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {normalizedPhase6SearchQuery && phase6EvidenceSearchRows.length === 0 ? (
                      <tr>
                        <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={5}>no search matches for this run scope</td>
                      </tr>
                    ) : null}
                    {!normalizedPhase6SearchQuery ? (
                      <tr>
                        <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={5}>enter a term to search indexed evidence</td>
                      </tr>
                    ) : null}
                    {phase6EvidenceSearchRows.slice(0, 24).map((row, idx) => (
                      <tr key={`phase6-search:${row.assertion_id || idx}:${row.source_id || idx}`} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-1 pr-3 font-mono">{row.field_key || '-'}</td>
                        <td className="py-1 pr-3">{row.context_kind || '-'}</td>
                        <td className="py-1 pr-3">{row.value_preview || '-'}</td>
                        <td className="py-1 pr-3">
                          <div className="max-w-[40rem] truncate" title={row.quote_preview || row.snippet_preview || ''}>
                            {row.quote_preview || row.snippet_preview || '-'}
                          </div>
                        </td>
                        <td className="py-1 pr-3 font-mono truncate max-w-[20rem]" title={row.source_url || ''}>
                          {row.source_host || row.source_id || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              phase 06a now includes live content-hash dedupe metrics plus DB-backed inventory and search over indexed evidence rows.
            </div>
          </>
        ) : null}
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3" style={{ order: 52 }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center text-sm font-semibold text-gray-900 dark:text-gray-100">
            <button
              onClick={() => togglePanel('phase7')}
              className="inline-flex items-center justify-center w-5 h-5 mr-1 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              title={panelCollapsed.phase7 ? 'Open panel' : 'Close panel'}
            >
              {panelCollapsed.phase7 ? '+' : '-'}
            </button>
            <span>Tier Retrieval & Prime Sources (Phase 07)</span>
            <Tip text="Per-field tier-aware internal retrieval hits plus selected prime sources proving min_refs and distinct-source policy outcomes." />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              run {selectedIndexLabRunId || '-'} | {phase7Status.label}
            </div>
            <ActivityGauge
              label="phase 07 activity"
              currentPerMin={phase7Activity.currentPerMin}
              peakPerMin={phase7Activity.peakPerMin}
              active={processRunning}
            />
          </div>
        </div>
        {!panelCollapsed.phase7 ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2 text-xs">
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">fields attempted<Tip text="NeedSet fields evaluated in Phase 07 retrieval/prime-source build." /></div>
                <div className="font-semibold">{formatNumber(phase7Summary.attempted)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">fields w/ hits<Tip text="Fields with at least one ranked retrieval hit." /></div>
                <div className="font-semibold">{formatNumber(phase7Summary.withHits)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">min refs satisfied<Tip text="Fields whose selected prime sources meet the min_refs policy." /></div>
                <div className="font-semibold">{formatNumber(phase7Summary.satisfied)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">unsatisfied<Tip text="Fields still below min_refs or distinct-source requirements." /></div>
                <div className="font-semibold">{formatNumber(phase7Summary.unsatisfied)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">refs selected<Tip text="Total prime-source references selected across fields." /></div>
                <div className="font-semibold">{formatNumber(phase7Summary.refsSelected)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">distinct sources<Tip text="Sum of distinct source keys selected in prime-source packs." /></div>
                <div className="font-semibold">{formatNumber(phase7Summary.distinctSources)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">avg hits/field<Tip text="Average retrieval hits retained per field after ranking and caps." /></div>
                <div className="font-semibold">{formatNumber(phase7Summary.avgHitsPerField, 2)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">evidence pool<Tip text="Distinct provenance evidence rows available to the retriever for this run." /></div>
                <div className="font-semibold">{formatNumber(phase7Summary.evidencePoolSize)}</div>
              </div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
              <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
                Field Retrieval Summary ({formatNumber(phase7FieldRows.length)} rows)
                <Tip text="Per-field retrieval stats, selected refs, and policy pass/fail for Phase 07." />
              </div>
              <table className="mt-2 min-w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <th className="py-1 pr-3">field</th>
                    <th className="py-1 pr-3">need</th>
                    <th className="py-1 pr-3">hits</th>
                    <th className="py-1 pr-3">refs selected</th>
                    <th className="py-1 pr-3">distinct src</th>
                    <th className="py-1 pr-3">tier pref</th>
                    <th className="py-1 pr-3">state</th>
                    <th className="py-1 pr-3">query</th>
                  </tr>
                </thead>
                <tbody>
                  {phase7FieldRows.length === 0 ? (
                    <tr>
                      <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={8}>no phase 07 rows yet</td>
                    </tr>
                  ) : (
                    phase7FieldRows.slice(0, 40).map((row) => (
                      <tr key={`phase7-field:${row.field_key}`} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-1 pr-3 font-mono">{row.field_key || '-'}</td>
                        <td className="py-1 pr-3">{formatNumber(Number(row.need_score || 0), 3)}</td>
                        <td className="py-1 pr-3">{formatNumber(Number(row.hits_count || 0))}</td>
                        <td className="py-1 pr-3">
                          {formatNumber(Number(row.refs_selected || 0))}/{formatNumber(Number(row.min_refs_required || 1))}
                        </td>
                        <td className="py-1 pr-3">
                          {formatNumber(Number(row.distinct_sources_selected || 0))}
                          {row.distinct_sources_required ? <span className="text-[10px] text-amber-600 dark:text-amber-300"> req</span> : null}
                        </td>
                        <td className="py-1 pr-3">{(row.tier_preference || []).map((value) => `t${value}`).join('>') || '-'}</td>
                        <td className="py-1 pr-3">
                          <span className={`px-1.5 py-0.5 rounded ${
                            row.min_refs_satisfied
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                          }`}>
                            {row.min_refs_satisfied ? 'satisfied' : 'deficit'}
                          </span>
                        </td>
                        <td className="py-1 pr-3 font-mono truncate max-w-[26rem]" title={row.retrieval_query || ''}>
                          {row.retrieval_query || '-'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
              <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
                <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
                  Prime Sources Selected ({formatNumber(phase7PrimeRows.length)} rows)
                  <Tip text="Selected prime-source snippets with reasons used to satisfy evidence policy per field." />
                </div>
                <table className="mt-2 min-w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                      <th className="py-1 pr-3">field</th>
                      <th className="py-1 pr-3">tier</th>
                      <th className="py-1 pr-3">doc</th>
                      <th className="py-1 pr-3">score</th>
                      <th className="py-1 pr-3">source</th>
                      <th className="py-1 pr-3">reasons</th>
                    </tr>
                  </thead>
                  <tbody>
                    {phase7PrimeRows.length === 0 ? (
                      <tr>
                        <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={6}>no prime sources selected yet</td>
                      </tr>
                    ) : (
                      phase7PrimeRows.slice(0, 36).map((row, idx) => (
                        <tr key={`phase7-prime:${row.field_key}:${row.snippet_id || idx}`} className="border-b border-gray-100 dark:border-gray-800">
                          <td className="py-1 pr-3 font-mono">{row.field_key}</td>
                          <td className="py-1 pr-3">{row.tier || '-'}</td>
                          <td className="py-1 pr-3">{row.doc_kind || '-'}</td>
                          <td className="py-1 pr-3">{formatNumber(row.score, 3)}</td>
                          <td className="py-1 pr-3 font-mono truncate max-w-[16rem]" title={row.url || row.host}>{row.host || row.url || '-'}</td>
                          <td className="py-1 pr-3">
                            <div className="flex flex-wrap gap-1">
                              {row.reason_badges.slice(0, 4).map((reason) => (
                                <span key={`phase7-prime-reason:${row.field_key}:${reason}:${idx}`} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
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
              <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
                <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
                  Top Retrieval Hits ({formatNumber(phase7HitRows.length)} rows)
                  <Tip text="Top ranked retrieval hits per field; selected rows indicate hits promoted into prime sources." />
                </div>
                <table className="mt-2 min-w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                      <th className="py-1 pr-3">field</th>
                      <th className="py-1 pr-3">selected</th>
                      <th className="py-1 pr-3">tier</th>
                      <th className="py-1 pr-3">doc</th>
                      <th className="py-1 pr-3">score</th>
                      <th className="py-1 pr-3">quote</th>
                    </tr>
                  </thead>
                  <tbody>
                    {phase7HitRows.length === 0 ? (
                      <tr>
                        <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={6}>no retrieval hits yet</td>
                      </tr>
                    ) : (
                      phase7HitRows.slice(0, 44).map((row, idx) => (
                        <tr key={`phase7-hit:${row.field_key}:${row.url}:${idx}`} className="border-b border-gray-100 dark:border-gray-800">
                          <td className="py-1 pr-3 font-mono">{row.field_key}</td>
                          <td className="py-1 pr-3">
                            <span className={`px-1.5 py-0.5 rounded ${
                              row.selected
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                            }`}>
                              {row.selected ? 'yes' : 'no'}
                            </span>
                          </td>
                          <td className="py-1 pr-3">{row.tier || '-'}</td>
                          <td className="py-1 pr-3">{row.doc_kind || '-'}</td>
                          <td className="py-1 pr-3">{formatNumber(row.score, 3)}</td>
                          <td className="py-1 pr-3">
                            <div className="truncate max-w-[26rem]" title={row.quote_preview || row.url}>
                              {row.quote_preview || row.url || '-'}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3" style={{ order: 53 }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center text-sm font-semibold text-gray-900 dark:text-gray-100">
            <button
              onClick={() => togglePanel('phase8')}
              className="inline-flex items-center justify-center w-5 h-5 mr-1 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              title={panelCollapsed.phase8 ? 'Open panel' : 'Close panel'}
            >
              {panelCollapsed.phase8 ? '+' : '-'}
            </button>
            <span>Extraction Context Matrix (Phase 08)</span>
            <Tip text="Batch-level extraction context wiring proof: policy-aware prompt assembly, snippet reference integrity, and min-refs compliance rates." />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              run {selectedIndexLabRunId || '-'} | {phase8Status.label}
            </div>
            <ActivityGauge
              label="phase 08 activity"
              currentPerMin={phase8Activity.currentPerMin}
              peakPerMin={phase8Activity.peakPerMin}
              active={processRunning}
            />
          </div>
        </div>
        {!panelCollapsed.phase8 ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2 text-xs">
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">batches<Tip text="Total extraction batches executed or skipped in this run." /></div>
                <div className="font-semibold">{formatNumber(phase8Summary.batchCount)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">batch errors<Tip text="Batches that failed before producing valid structured extraction output." /></div>
                <div className="font-semibold">{formatNumber(phase8Summary.batchErrorCount)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">schema fail rate<Tip text="Failed batch ratio across all Phase 08 extraction batches." /></div>
                <div className="font-semibold">{formatNumber(phase8Summary.schemaFailRate * 100, 2)}%</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">raw candidates<Tip text="Candidate rows returned before evidence/policy filtering." /></div>
                <div className="font-semibold">{formatNumber(phase8Summary.rawCandidateCount)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">accepted<Tip text="Candidate rows accepted after schema and evidence reference checks." /></div>
                <div className="font-semibold">{formatNumber(phase8Summary.acceptedCandidateCount)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">dangling refs<Tip text="Candidates dropped because evidence refs did not resolve to provided snippet ids." /></div>
                <div className="font-semibold">{formatNumber(phase8Summary.danglingRefCount)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">policy violations<Tip text="Rows dropped by missing refs, dangling refs, or evidence verifier failures." /></div>
                <div className="font-semibold">{formatNumber(phase8Summary.policyViolationCount)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">min refs satisfied<Tip text="Accepted candidate rows meeting field-level min_evidence_refs thresholds." /></div>
                <div className="font-semibold">
                  {formatNumber(phase8Summary.minRefsSatisfied)}/{formatNumber(phase8Summary.minRefsTotal)}
                </div>
              </div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
              <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
                Extraction Batches ({formatNumber(phase8Batches.length)} rows)
                <Tip text="Batch-by-batch extraction outcomes showing context usage, candidate filtering, and policy pass counters." />
              </div>
              <table className="mt-2 min-w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <th className="py-1 pr-3">batch</th>
                    <th className="py-1 pr-3">status</th>
                    <th className="py-1 pr-3">model</th>
                    <th className="py-1 pr-3">counts</th>
                    <th className="py-1 pr-3">drops</th>
                    <th className="py-1 pr-3">min refs</th>
                    <th className="py-1 pr-3">ms</th>
                    <th className="py-1 pr-3">source</th>
                  </tr>
                </thead>
                <tbody>
                  {phase8Batches.length === 0 ? (
                    <tr>
                      <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={8}>no phase 08 batch rows yet</td>
                    </tr>
                  ) : (
                    phase8Batches.slice(0, 80).map((row, idx) => (
                      <tr key={`phase8-batch:${row.batch_id || idx}:${idx}`} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-1 pr-3 font-mono">{row.batch_id || '-'}</td>
                        <td className="py-1 pr-3">
                          <span className={`px-1.5 py-0.5 rounded ${
                            String(row.status || '').includes('failed')
                              ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
                              : (String(row.status || '').includes('completed')
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200')
                          }`}>
                            {row.status || '-'}
                          </span>
                        </td>
                        <td className="py-1 pr-3 font-mono truncate max-w-[12rem]" title={row.model || ''}>{row.model || '-'}</td>
                        <td className="py-1 pr-3">
                          f:{formatNumber(Number(row.target_field_count || 0))}
                          {' '}s:{formatNumber(Number(row.snippet_count || 0))}
                          {' '}a:{formatNumber(Number(row.accepted_candidate_count || 0))}
                        </td>
                        <td className="py-1 pr-3">
                          miss:{formatNumber(Number(row.dropped_missing_refs || 0))}
                          {' '}dang:{formatNumber(Number(row.dropped_invalid_refs || 0))}
                        </td>
                        <td className="py-1 pr-3">
                          {formatNumber(Number(row.min_refs_satisfied_count || 0))}/{formatNumber(Number(row.min_refs_total || 0))}
                        </td>
                        <td className="py-1 pr-3">{formatNumber(Number(row.elapsed_ms || 0))}</td>
                        <td className="py-1 pr-3 font-mono truncate max-w-[14rem]" title={row.source_url || row.source_host || ''}>{row.source_host || '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
              <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
                <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
                  Field Contexts ({formatNumber(phase8FieldContextRows.length)} rows)
                  <Tip text="Prompt-time field context matrix: required level, parse template intent, and evidence policy per field." />
                </div>
                <table className="mt-2 min-w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                      <th className="py-1 pr-3">field</th>
                      <th className="py-1 pr-3">level</th>
                      <th className="py-1 pr-3">difficulty</th>
                      <th className="py-1 pr-3">ai</th>
                      <th className="py-1 pr-3">parse</th>
                      <th className="py-1 pr-3">policy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {phase8FieldContextRows.length === 0 ? (
                      <tr>
                        <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={6}>no field context rows yet</td>
                      </tr>
                    ) : (
                      phase8FieldContextRows.slice(0, 60).map((row) => (
                        <tr key={`phase8-fieldctx:${row.field_key || '-'}`} className="border-b border-gray-100 dark:border-gray-800">
                          <td className="py-1 pr-3 font-mono">{row.field_key || '-'}</td>
                          <td className="py-1 pr-3">{row.required_level || '-'}</td>
                          <td className="py-1 pr-3">{row.difficulty || '-'}</td>
                          <td className="py-1 pr-3">{row.ai_mode || '-'}</td>
                          <td className="py-1 pr-3 font-mono">{row.parse_template_intent?.template_id || '-'}</td>
                          <td className="py-1 pr-3">
                            min:{formatNumber(Number(row.evidence_policy?.min_evidence_refs || 1))}
                            {row.evidence_policy?.distinct_sources_required ? ' | distinct' : ''}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
                <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
                  Prime Snippet Pack ({formatNumber(phase8PrimeRows.length)} rows)
                  <Tip text="Prime snippet rows attached through Phase 08 context for extraction and validator review." />
                </div>
                <table className="mt-2 min-w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                      <th className="py-1 pr-3">field</th>
                      <th className="py-1 pr-3">snippet</th>
                      <th className="py-1 pr-3">source</th>
                      <th className="py-1 pr-3">quote</th>
                    </tr>
                  </thead>
                  <tbody>
                    {phase8PrimeRows.length === 0 ? (
                      <tr>
                        <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={4}>no prime snippet rows yet</td>
                      </tr>
                    ) : (
                      phase8PrimeRows.slice(0, 60).map((row, idx) => (
                        <tr key={`phase8-prime:${row.field_key || ''}:${row.snippet_id || idx}`} className="border-b border-gray-100 dark:border-gray-800">
                          <td className="py-1 pr-3 font-mono">{row.field_key || '-'}</td>
                          <td className="py-1 pr-3 font-mono">{row.snippet_id || '-'}</td>
                          <td className="py-1 pr-3 font-mono truncate max-w-[14rem]" title={row.url || row.source_id || ''}>
                            {row.source_id || row.url || '-'}
                          </td>
                          <td className="py-1 pr-3">
                            <div className="truncate max-w-[24rem]" title={row.quote_preview || ''}>
                              {row.quote_preview || '-'}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              validator context fields: {formatNumber(phase8Summary.validatorContextFields)} | validator prime rows: {formatNumber(phase8Summary.validatorPrimeRows)}
            </div>
          </>
        ) : null}
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3" style={{ order: 48 }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center text-sm font-semibold text-gray-900 dark:text-gray-100">
            <button
              onClick={() => togglePanel('urlHealth')}
              className="inline-flex items-center justify-center w-5 h-5 mr-1 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              title={panelCollapsed.urlHealth ? 'Open panel' : 'Close panel'}
            >
              {panelCollapsed.urlHealth ? '+' : '-'}
            </button>
            <span>URL Health & Repair (Phase 04)</span>
            <Tip text="404/410/403/429 outcomes, cooldowns, repeat dead patterns, and emitted repair queries." />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              run {selectedIndexLabRunId || '-'} | {phase4Status.label}
            </div>
            <ActivityGauge
              label="phase 04 activity"
              currentPerMin={phase4Activity.currentPerMin}
              peakPerMin={phase4Activity.peakPerMin}
              active={processRunning}
            />
          </div>
        </div>
        {!panelCollapsed.urlHealth ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-10 gap-2 text-xs">
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">domains<Tip text="Distinct domains represented in URL health rows for this run." /></div>
                <div className="font-semibold">{formatNumber(phase4Summary.domains)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">404 / 410<Tip text="Not-found outcomes contributing to repair/cooldown logic." /></div>
                <div className="font-semibold">{formatNumber(phase4Summary.err404)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">blocked<Tip text="Blocked/forbidden outcomes (for example 403/429/bot blocks)." /></div>
                <div className="font-semibold">{formatNumber(phase4Summary.blocked)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">cooldowns active<Tip text="Domains currently under retry cooldown window." /></div>
                <div className="font-semibold">{formatNumber(phase4Summary.cooldownsActive)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">avg host budget<Tip text="Average host_budget_score across domain rows (higher is healthier)." /></div>
                <div className="font-semibold">{phase4Summary.avgHostBudget.toFixed(1)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">hosts blocked/backoff<Tip text="Count of hosts in blocked state versus backoff state." /></div>
                <div className="font-semibold">
                  {formatNumber(phase4Summary.blockedHosts)} / {formatNumber(phase4Summary.backoffHosts)}
                </div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">repeat 404 domains<Tip text="Domains repeatedly returning 404/410 for selected URLs." /></div>
                <div className="font-semibold">{formatNumber(phase4Summary.repeat404Domains)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">repeat blocked domains<Tip text="Domains repeatedly returning blocked outcomes." /></div>
                <div className="font-semibold">{formatNumber(phase4Summary.repeatBlockedDomains)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">repair queries<Tip text="Repair-search queries emitted due to repeated failures or cooldown triggers." /></div>
                <div className="font-semibold">{formatNumber(phase4Summary.repairQueries)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">bad url patterns<Tip text="Repeated dead-path patterns captured for future URL rejection/cleanup." /></div>
                <div className="font-semibold">{formatNumber(phase4Summary.badPatterns)}</div>
              </div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
              <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
                Domain Health ({formatNumber(phase4Rows.length)} rows)
                <Tip text="Per-domain error, dedupe, budget, and cooldown proof rows for Phase 04 logic." />
              </div>
              <table className="mt-2 min-w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <th className="py-1 pr-3">domain</th>
                    <th className="py-1 pr-3">kind</th>
                    <th className="py-1 pr-3">status</th>
                    <th className="py-1 pr-3">404</th>
                    <th className="py-1 pr-3">blocked</th>
                    <th className="py-1 pr-3">dedupe</th>
                    <th className="py-1 pr-3">repeat 404</th>
                    <th className="py-1 pr-3">repeat blocked</th>
                    <th className="py-1 pr-3">budget</th>
                    <th className="py-1 pr-3">budget state</th>
                    <th className="py-1 pr-3">cooldown</th>
                    <th className="py-1 pr-3">next retry</th>
                  </tr>
                </thead>
                <tbody>
                  {phase4Rows.length === 0 && (
                    <tr>
                      <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={12}>no URL health rows yet</td>
                    </tr>
                  )}
                  {phase4Rows.slice(0, 40).map((row) => (
                    <tr key={`phase4-domain:${row.domain}`} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-1 pr-3 font-mono">{row.domain}</td>
                      <td className="py-1 pr-3">{row.site_kind || '-'}</td>
                      <td className="py-1 pr-3">{row.status || '-'}</td>
                      <td className="py-1 pr-3">{formatNumber(Number(row.err_404 || 0))}</td>
                      <td className="py-1 pr-3">{formatNumber(Number(row.blocked_count || 0))}</td>
                      <td className="py-1 pr-3">{formatNumber(Number(row.dedupe_hits || 0))}</td>
                      <td className="py-1 pr-3">{formatNumber(Number(row.repeat_404_urls || 0))}</td>
                      <td className="py-1 pr-3">{formatNumber(Number(row.repeat_blocked_urls || 0))}</td>
                      <td className="py-1 pr-3">{Number(row.host_budget_score || 0).toFixed(1)}</td>
                      <td className="py-1 pr-3">
                        <span className={`inline-flex items-center rounded px-1.5 py-0.5 ${hostBudgetStateBadgeClasses(String(row.host_budget_state || ''))}`}>
                          {String(row.host_budget_state || '-')}
                        </span>
                      </td>
                      <td className="py-1 pr-3">
                        {(() => {
                          const retryMs = Date.parse(String(row.next_retry_at || ''));
                          const liveSeconds = Number.isFinite(retryMs)
                            ? Math.max(0, Math.ceil((retryMs - activityNowMs) / 1000))
                            : Math.max(0, Number(row.cooldown_seconds_remaining || 0));
                          return liveSeconds > 0 ? formatDuration(liveSeconds * 1000) : '-';
                        })()}
                      </td>
                      <td className="py-1 pr-3">{formatDateTime(row.next_retry_at || null)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
              <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
                <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
                  Repair Queries Fired
                  <Tip text="Recent repair-search emissions triggered by repeated URL failures." />
                </div>
                <table className="mt-2 min-w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                      <th className="py-1 pr-3">time</th>
                      <th className="py-1 pr-3">domain</th>
                      <th className="py-1 pr-3">status</th>
                      <th className="py-1 pr-3">reason</th>
                      <th className="py-1 pr-3">query</th>
                    </tr>
                  </thead>
                  <tbody>
                    {phase4RepairRows.length === 0 && (
                      <tr>
                        <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={5}>no repair queries fired yet</td>
                      </tr>
                    )}
                    {phase4RepairRows.slice(0, 30).map((row, idx) => (
                      <tr key={`phase4-repair:${row.domain}:${row.query}:${idx}`} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-1 pr-3">{formatDateTime(row.ts || null)}</td>
                        <td className="py-1 pr-3 font-mono">{row.domain}</td>
                        <td className="py-1 pr-3">{row.status ? formatNumber(Number(row.status)) : '-'}</td>
                        <td className="py-1 pr-3">{row.reason || '-'}</td>
                        <td className="py-1 pr-3 font-mono">{row.query}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
                <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
                  Bad URL Patterns
                  <Tip text="Dead URL patterns detected repeatedly and tracked for future prevention." />
                </div>
                <table className="mt-2 min-w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                      <th className="py-1 pr-3">domain</th>
                      <th className="py-1 pr-3">path</th>
                      <th className="py-1 pr-3">reason</th>
                      <th className="py-1 pr-3">count</th>
                      <th className="py-1 pr-3">last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {phase4BadPatternRows.length === 0 && (
                      <tr>
                        <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={5}>no repeated dead patterns yet</td>
                      </tr>
                    )}
                    {phase4BadPatternRows.slice(0, 30).map((row) => (
                      <tr key={`phase4-bad-pattern:${row.domain}:${row.path}`} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-1 pr-3 font-mono">{row.domain}</td>
                        <td className="py-1 pr-3 font-mono">{row.path}</td>
                        <td className="py-1 pr-3">{row.reason || '-'}</td>
                        <td className="py-1 pr-3">{formatNumber(Number(row.count || 0))}</td>
                        <td className="py-1 pr-3">{formatDateTime(row.last_ts || null)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
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
          <div className="md:col-span-2 rounded border border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-700/40 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
            Run and discovery knobs
          </div>
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
          <div className="md:col-span-2 rounded border border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-700/40 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
            Phase 05 fetch parallelism knobs
          </div>
          <input
            type="number"
            min={1}
            max={64}
            value={fetchConcurrency}
            onChange={(e) => setFetchConcurrency(e.target.value)}
            disabled={isAll || busy}
            className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Global fetch concurrency target (CONCURRENCY env override for this run)."
            placeholder="fetch concurrency"
          />
          <input
            type="number"
            min={0}
            max={120000}
            step={50}
            value={perHostMinDelayMs}
            onChange={(e) => setPerHostMinDelayMs(e.target.value)}
            disabled={isAll || busy}
            className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Minimum delay per host in milliseconds (PER_HOST_MIN_DELAY_MS override for this run)."
            placeholder="per-host delay ms"
          />
          <div className="md:col-span-2 rounded border border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-700/40 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
            Phase 02 dynamic parsing knobs
          </div>
          <label className="flex items-center gap-2 rounded border border-gray-300 dark:border-gray-600 px-2 py-2 text-xs text-gray-700 dark:text-gray-200">
            <input
              type="checkbox"
              checked={dynamicCrawleeEnabled}
              onChange={(e) => setDynamicCrawleeEnabled(e.target.checked)}
              disabled={isAll || busy}
            />
            crawlee enabled
            <Tip text="Enable Crawlee-powered dynamic rendering path. When profile=fast, HTTP fetcher can still be preferred for speed." />
          </label>
          <label className="flex items-center gap-2 rounded border border-gray-300 dark:border-gray-600 px-2 py-2 text-xs text-gray-700 dark:text-gray-200">
            <input
              type="checkbox"
              checked={crawleeHeadless}
              onChange={(e) => setCrawleeHeadless(e.target.checked)}
              disabled={isAll || busy || !dynamicCrawleeEnabled}
            />
            crawlee headless
            <Tip text="Run browser without visible window for stability/perf in automated runs." />
          </label>
          <label className="flex items-center gap-2 rounded border border-gray-300 dark:border-gray-600 px-2 py-2 text-xs text-gray-700 dark:text-gray-200">
            <span>retry budget</span>
            <Tip text="Max dynamic fetch retries per URL after initial failure before giving up." />
            <input
              type="number"
              min={0}
              max={5}
              value={dynamicFetchRetryBudget}
              onChange={(e) => setDynamicFetchRetryBudget(e.target.value)}
              disabled={isAll || busy}
              className="ml-auto w-24 px-2 py-1 text-xs border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
              title="DYNAMIC_FETCH_RETRY_BUDGET for this run."
            />
          </label>
          <label className="flex items-center gap-2 rounded border border-gray-300 dark:border-gray-600 px-2 py-2 text-xs text-gray-700 dark:text-gray-200">
            <span>retry backoff ms</span>
            <Tip text="Wait time between retries for failed dynamic fetches to avoid hammering one host." />
            <input
              type="number"
              min={0}
              max={30000}
              step={50}
              value={dynamicFetchRetryBackoffMs}
              onChange={(e) => setDynamicFetchRetryBackoffMs(e.target.value)}
              disabled={isAll || busy}
              className="ml-auto w-24 px-2 py-1 text-xs border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
              title="DYNAMIC_FETCH_RETRY_BACKOFF_MS for this run."
            />
          </label>
          <label className="flex items-center gap-2 rounded border border-gray-300 dark:border-gray-600 px-2 py-2 text-xs text-gray-700 dark:text-gray-200">
            <span>handler timeout s</span>
            <Tip text="Per-request Crawlee handler timeout in seconds before aborting a stuck render." />
            <input
              type="number"
              min={0}
              max={300}
              value={crawleeRequestHandlerTimeoutSecs}
              onChange={(e) => setCrawleeRequestHandlerTimeoutSecs(e.target.value)}
              disabled={isAll || busy || !dynamicCrawleeEnabled}
              className="ml-auto w-24 px-2 py-1 text-xs border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
              title="CRAWLEE_REQUEST_HANDLER_TIMEOUT_SECS for this run."
            />
          </label>
          <label className="rounded border border-gray-300 dark:border-gray-600 px-2 py-2 text-xs text-gray-700 dark:text-gray-200 md:col-span-2">
            <div className="flex items-center gap-2 mb-1">
              <span>domain policy json (advanced)</span>
              <Tip text="Optional JSON object keyed by host. Override fetch mode/retries/throttle per domain for this run only." />
            </div>
            <textarea
              value={dynamicFetchPolicyMapJson}
              onChange={(e) => setDynamicFetchPolicyMapJson(e.target.value)}
              disabled={isAll || busy}
              className="w-full h-20 px-2 py-1 text-xs border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 font-mono"
              placeholder='{"example.com":{"prefer":"playwright","retry_budget":2,"per_host_delay_ms":600}}'
              title="DYNAMIC_FETCH_POLICY_MAP_JSON override for this run."
            />
          </label>
          <div className="md:col-span-2 rounded border border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-700/40 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
            Phase-level LLM controls
          </div>
          <label className="md:col-span-2 flex items-center gap-2 rounded border border-gray-300 dark:border-gray-600 px-2 py-1.5 text-xs text-gray-700 dark:text-gray-200">
            <input
              type="checkbox"
              checked={phase2LlmEnabled}
              onChange={(e) => setPhase2LlmEnabled(e.target.checked)}
              disabled={isAll || busy || !discoveryEnabled}
            />
            phase 02 llm searchprofile
            <Tip text={`Force LLM query planning for SearchProfile generation. ${roleHelpText('plan')}`} />
          </label>
          <select
            value={phase2LlmModel}
            onChange={(e) => {
              const nextModel = e.target.value;
              setPhase2LlmModel(nextModel);
              setLlmTokensPlan(resolveModelTokenDefaults(nextModel).default_output_tokens);
            }}
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
          <select
            value={llmTokensPlan}
            onChange={(e) => setLlmTokensPlan(clampTokenForModel(phase2LlmModel, Number.parseInt(e.target.value, 10) || llmTokensPlan))}
            disabled={isAll || busy || !discoveryEnabled || !phase2LlmEnabled}
            className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Max output tokens for Phase 02 planner calls."
          >
            {llmTokenPresetOptions.map((token) => {
              const cap = resolveModelTokenDefaults(phase2LlmModel).max_output_tokens;
              const disabled = token > cap;
              return (
                <option key={`phase2-token:${token}`} value={token} disabled={disabled}>
                  phase 02 tokens: {token}{disabled ? ' (model max)' : ''}
                </option>
              );
            })}
          </select>
          <label className="md:col-span-2 flex items-center gap-2 rounded border border-gray-300 dark:border-gray-600 px-2 py-1.5 text-xs text-gray-700 dark:text-gray-200">
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
            onChange={(e) => {
              const nextModel = e.target.value;
              setPhase3LlmModel(nextModel);
              setLlmTokensTriage(resolveModelTokenDefaults(nextModel).default_output_tokens);
            }}
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
          <select
            value={llmTokensTriage}
            onChange={(e) => setLlmTokensTriage(clampTokenForModel(phase3LlmModel, Number.parseInt(e.target.value, 10) || llmTokensTriage))}
            disabled={isAll || busy || !discoveryEnabled || !phase3LlmTriageEnabled}
            className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Max output tokens for Phase 03 triage calls."
          >
            {llmTokenPresetOptions.map((token) => {
              const cap = resolveModelTokenDefaults(phase3LlmModel).max_output_tokens;
              const disabled = token > cap;
              return (
                <option key={`phase3-token:${token}`} value={token} disabled={disabled}>
                  phase 03 tokens: {token}{disabled ? ' (model max)' : ''}
                </option>
              );
            })}
          </select>
          <div className="md:col-span-2 rounded border border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-700/40 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
            Role routing controls (model + token cap)
          </div>
          <select
            value={llmModelFast}
            onChange={(e) => {
              const nextModel = e.target.value;
              setLlmModelFast(nextModel);
              setLlmTokensFast(resolveModelTokenDefaults(nextModel).default_output_tokens);
            }}
            disabled={isAll || busy}
            className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Model used by fast LLM passes when enabled."
          >
            {llmModelOptions.map((model) => (
              <option key={`fast:${model}`} value={model}>
                fast pass model: {model}
              </option>
            ))}
          </select>
          <select
            value={llmTokensFast}
            onChange={(e) => setLlmTokensFast(clampTokenForModel(llmModelFast, Number.parseInt(e.target.value, 10) || llmTokensFast))}
            disabled={isAll || busy}
            className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Max output tokens for fast LLM passes."
          >
            {llmTokenPresetOptions.map((token) => {
              const cap = resolveModelTokenDefaults(llmModelFast).max_output_tokens;
              const disabled = token > cap;
              return (
                <option key={`fast-token:${token}`} value={token} disabled={disabled}>
                  fast tokens: {token}{disabled ? ' (model max)' : ''}
                </option>
              );
            })}
          </select>
          <select
            value={llmModelReasoning}
            onChange={(e) => {
              const nextModel = e.target.value;
              setLlmModelReasoning(nextModel);
              setLlmTokensReasoning(resolveModelTokenDefaults(nextModel).default_output_tokens);
            }}
            disabled={isAll || busy}
            className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Model used by deeper reasoning passes."
          >
            {llmModelOptions.map((model) => (
              <option key={`reasoning:${model}`} value={model}>
                reasoning model: {model}
              </option>
            ))}
          </select>
          <select
            value={llmTokensReasoning}
            onChange={(e) => setLlmTokensReasoning(clampTokenForModel(llmModelReasoning, Number.parseInt(e.target.value, 10) || llmTokensReasoning))}
            disabled={isAll || busy}
            className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Max output tokens for reasoning passes."
          >
            {llmTokenPresetOptions.map((token) => {
              const cap = resolveModelTokenDefaults(llmModelReasoning).max_output_tokens;
              const disabled = token > cap;
              return (
                <option key={`reasoning-token:${token}`} value={token} disabled={disabled}>
                  reasoning tokens: {token}{disabled ? ' (model max)' : ''}
                </option>
              );
            })}
          </select>
          <div className="md:col-span-2 rounded border border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-700/40 px-2 py-1 text-[11px] text-slate-700 dark:text-slate-200">
            <span className="inline-flex items-center font-semibold">
              extract role
              <Tip text={roleHelpText('extract')} />
            </span>
          </div>
          <select
            value={llmModelExtract}
            onChange={(e) => {
              const nextModel = e.target.value;
              setLlmModelExtract(nextModel);
              setLlmTokensExtract(resolveModelTokenDefaults(nextModel).default_output_tokens);
            }}
            disabled={isAll || busy}
            className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Primary route model for extract role."
          >
            {llmModelOptions.map((model) => (
              <option key={`extract:${model}`} value={model}>
                extract role model: {model}
              </option>
            ))}
          </select>
          <select
            value={llmTokensExtract}
            onChange={(e) => setLlmTokensExtract(clampTokenForModel(llmModelExtract, Number.parseInt(e.target.value, 10) || llmTokensExtract))}
            disabled={isAll || busy}
            className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Max output tokens for extract role calls."
          >
            {llmTokenPresetOptions.map((token) => {
              const cap = resolveModelTokenDefaults(llmModelExtract).max_output_tokens;
              const disabled = token > cap;
              return (
                <option key={`extract-token:${token}`} value={token} disabled={disabled}>
                  extract tokens: {token}{disabled ? ' (model max)' : ''}
                </option>
              );
            })}
          </select>
          <div className="md:col-span-2 rounded border border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-700/40 px-2 py-1 text-[11px] text-slate-700 dark:text-slate-200">
            <span className="inline-flex items-center font-semibold">
              validate role
              <Tip text={roleHelpText('validate')} />
            </span>
          </div>
          <select
            value={llmModelValidate}
            onChange={(e) => {
              const nextModel = e.target.value;
              setLlmModelValidate(nextModel);
              setLlmTokensValidate(resolveModelTokenDefaults(nextModel).default_output_tokens);
            }}
            disabled={isAll || busy}
            className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Primary route model for validate role."
          >
            {llmModelOptions.map((model) => (
              <option key={`validate:${model}`} value={model}>
                validate role model: {model}
              </option>
            ))}
          </select>
          <select
            value={llmTokensValidate}
            onChange={(e) => setLlmTokensValidate(clampTokenForModel(llmModelValidate, Number.parseInt(e.target.value, 10) || llmTokensValidate))}
            disabled={isAll || busy}
            className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Max output tokens for validate role calls."
          >
            {llmTokenPresetOptions.map((token) => {
              const cap = resolveModelTokenDefaults(llmModelValidate).max_output_tokens;
              const disabled = token > cap;
              return (
                <option key={`validate-token:${token}`} value={token} disabled={disabled}>
                  validate tokens: {token}{disabled ? ' (model max)' : ''}
                </option>
              );
            })}
          </select>
          <div className="md:col-span-2 rounded border border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-700/40 px-2 py-1 text-[11px] text-slate-700 dark:text-slate-200">
            <span className="inline-flex items-center font-semibold">
              write role
              <Tip text={roleHelpText('write')} />
            </span>
          </div>
          <select
            value={llmModelWrite}
            onChange={(e) => {
              const nextModel = e.target.value;
              setLlmModelWrite(nextModel);
              setLlmTokensWrite(resolveModelTokenDefaults(nextModel).default_output_tokens);
            }}
            disabled={isAll || busy}
            className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Primary route model for write/summary role."
          >
            {llmModelOptions.map((model) => (
              <option key={`write:${model}`} value={model}>
                write role model: {model}
              </option>
            ))}
          </select>
          <select
            value={llmTokensWrite}
            onChange={(e) => setLlmTokensWrite(clampTokenForModel(llmModelWrite, Number.parseInt(e.target.value, 10) || llmTokensWrite))}
            disabled={isAll || busy}
            className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Max output tokens for write role calls."
          >
            {llmTokenPresetOptions.map((token) => {
              const cap = resolveModelTokenDefaults(llmModelWrite).max_output_tokens;
              const disabled = token > cap;
              return (
                <option key={`write-token:${token}`} value={token} disabled={disabled}>
                  write tokens: {token}{disabled ? ' (model max)' : ''}
                </option>
              );
            })}
          </select>
          <div className="md:col-span-2 rounded border border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-700/40 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
            Fallback role routing controls
          </div>
          <label className="flex items-center gap-2 rounded border border-gray-300 dark:border-gray-600 px-2 py-2 text-xs text-gray-700 dark:text-gray-200">
            <input
              type="checkbox"
              checked={llmFallbackEnabled}
              onChange={(e) => setLlmFallbackEnabled(e.target.checked)}
              disabled={isAll || busy}
            />
            role fallbacks enabled
            <Tip text="When off, fallback model routes are disabled for this run." />
          </label>
          <select
            value={llmFallbackPlanModel}
            onChange={(e) => {
              const nextModel = e.target.value;
              setLlmFallbackPlanModel(nextModel);
              if (nextModel) {
                setLlmTokensPlanFallback(resolveModelTokenDefaults(nextModel).default_output_tokens);
              }
            }}
            disabled={isAll || busy || !llmFallbackEnabled}
            className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Fallback model for plan role."
          >
            <option value="">fallback plan: none</option>
            {llmModelOptions.map((model) => (
              <option key={`fplan:${model}`} value={model}>
                fallback plan: {model}
              </option>
            ))}
          </select>
          <select
            value={llmTokensPlanFallback}
            onChange={(e) => setLlmTokensPlanFallback(clampTokenForModel(llmFallbackPlanModel || phase2LlmModel, Number.parseInt(e.target.value, 10) || llmTokensPlanFallback))}
            disabled={isAll || busy || !llmFallbackEnabled}
            className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Fallback max output tokens for plan role."
          >
            {llmTokenPresetOptions.map((token) => {
              const cap = resolveModelTokenDefaults(llmFallbackPlanModel || phase2LlmModel).max_output_tokens;
              const disabled = token > cap;
              return (
                <option key={`fplan-token:${token}`} value={token} disabled={disabled}>
                  fallback plan tokens: {token}{disabled ? ' (model max)' : ''}
                </option>
              );
            })}
          </select>
          <select
            value={llmFallbackExtractModel}
            onChange={(e) => {
              const nextModel = e.target.value;
              setLlmFallbackExtractModel(nextModel);
              if (nextModel) {
                setLlmTokensExtractFallback(resolveModelTokenDefaults(nextModel).default_output_tokens);
              }
            }}
            disabled={isAll || busy || !llmFallbackEnabled}
            className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Fallback model for extract role."
          >
            <option value="">fallback extract: none</option>
            {llmModelOptions.map((model) => (
              <option key={`fextract:${model}`} value={model}>
                fallback extract: {model}
              </option>
            ))}
          </select>
          <select
            value={llmTokensExtractFallback}
            onChange={(e) => setLlmTokensExtractFallback(clampTokenForModel(llmFallbackExtractModel || llmModelExtract, Number.parseInt(e.target.value, 10) || llmTokensExtractFallback))}
            disabled={isAll || busy || !llmFallbackEnabled}
            className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Fallback max output tokens for extract role."
          >
            {llmTokenPresetOptions.map((token) => {
              const cap = resolveModelTokenDefaults(llmFallbackExtractModel || llmModelExtract).max_output_tokens;
              const disabled = token > cap;
              return (
                <option key={`fextract-token:${token}`} value={token} disabled={disabled}>
                  fallback extract tokens: {token}{disabled ? ' (model max)' : ''}
                </option>
              );
            })}
          </select>
          <select
            value={llmFallbackValidateModel}
            onChange={(e) => {
              const nextModel = e.target.value;
              setLlmFallbackValidateModel(nextModel);
              if (nextModel) {
                setLlmTokensValidateFallback(resolveModelTokenDefaults(nextModel).default_output_tokens);
              }
            }}
            disabled={isAll || busy || !llmFallbackEnabled}
            className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Fallback model for validate role."
          >
            <option value="">fallback validate: none</option>
            {llmModelOptions.map((model) => (
              <option key={`fvalidate:${model}`} value={model}>
                fallback validate: {model}
              </option>
            ))}
          </select>
          <select
            value={llmTokensValidateFallback}
            onChange={(e) => setLlmTokensValidateFallback(clampTokenForModel(llmFallbackValidateModel || llmModelValidate, Number.parseInt(e.target.value, 10) || llmTokensValidateFallback))}
            disabled={isAll || busy || !llmFallbackEnabled}
            className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Fallback max output tokens for validate role."
          >
            {llmTokenPresetOptions.map((token) => {
              const cap = resolveModelTokenDefaults(llmFallbackValidateModel || llmModelValidate).max_output_tokens;
              const disabled = token > cap;
              return (
                <option key={`fvalidate-token:${token}`} value={token} disabled={disabled}>
                  fallback validate tokens: {token}{disabled ? ' (model max)' : ''}
                </option>
              );
            })}
          </select>
          <select
            value={llmFallbackWriteModel}
            onChange={(e) => {
              const nextModel = e.target.value;
              setLlmFallbackWriteModel(nextModel);
              if (nextModel) {
                setLlmTokensWriteFallback(resolveModelTokenDefaults(nextModel).default_output_tokens);
              }
            }}
            disabled={isAll || busy || !llmFallbackEnabled}
            className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Fallback model for write role."
          >
            <option value="">fallback write: none</option>
            {llmModelOptions.map((model) => (
              <option key={`fwrite:${model}`} value={model}>
                fallback write: {model}
              </option>
            ))}
          </select>
          <select
            value={llmTokensWriteFallback}
            onChange={(e) => setLlmTokensWriteFallback(clampTokenForModel(llmFallbackWriteModel || llmModelWrite, Number.parseInt(e.target.value, 10) || llmTokensWriteFallback))}
            disabled={isAll || busy || !llmFallbackEnabled}
            className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Fallback max output tokens for write role."
          >
            {llmTokenPresetOptions.map((token) => {
              const cap = resolveModelTokenDefaults(llmFallbackWriteModel || llmModelWrite).max_output_tokens;
              const disabled = token > cap;
              return (
                <option key={`fwrite-token:${token}`} value={token} disabled={disabled}>
                  fallback write tokens: {token}{disabled ? ' (model max)' : ''}
                </option>
              );
            })}
          </select>
          <div className="md:col-span-2 text-[11px] text-gray-500 dark:text-gray-400">
            One run click executes all phases in order. Every LLM call route can be tuned here (plan/fast/triage/reasoning/extract/validate/write + fallbacks).
          </div>
          <div className="md:col-span-2 rounded border border-gray-300 dark:border-gray-600 p-2 text-xs overflow-x-auto">
            <div className="font-semibold text-gray-800 dark:text-gray-200">role route snapshot</div>
            <table className="mt-2 min-w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-1 pr-3">role</th>
                  <th className="py-1 pr-3">primary</th>
                  <th className="py-1 pr-3">fallback</th>
                </tr>
              </thead>
              <tbody>
                {llmRouteSnapshotRows.map((row) => (
                  <tr key={`route-snapshot:${row.role}`} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-1 pr-3">
                      <span className="inline-flex items-center">
                        {row.role}
                        {roleHelpText(row.role) ? <Tip text={roleHelpText(row.role)} /> : null}
                      </span>
                    </td>
                    <td className="py-1 pr-3">
                      {row.primaryModel ? `${row.primaryProvider || providerFromModelToken(row.primaryModel)} | ${row.primaryModel}` : '-'}
                    </td>
                    <td className="py-1 pr-3">
                      {row.fallbackModel ? `${row.fallbackProvider || providerFromModelToken(row.fallbackModel)} | ${row.fallbackModel}` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
        <div className="grid grid-cols-3 items-start gap-2">
          <div className="space-y-1">
            <button
              onClick={() => stopMut.mutate({ force: stopForceKill })}
              disabled={stopMut.isPending}
              className="w-full h-10 inline-flex items-center justify-center px-3 text-sm rounded bg-red-600 hover:bg-red-700 text-white disabled:opacity-40"
              title={stopForceKill ? 'Force kill process tree if needed.' : 'Graceful stop request.'}
            >
              Stop Process
            </button>
            <label className="inline-flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-300">
              <input
                type="checkbox"
                checked={stopForceKill}
                onChange={(e) => setStopForceKill(e.target.checked)}
                disabled={stopMut.isPending}
              />
              force kill (hard stop)
              <Tip text="When enabled, Stop Process uses forced kill behavior if graceful stop hangs." />
            </label>
          </div>
          <button
            onClick={clearSelectedRunView}
            disabled={isAll || busy || !selectedIndexLabRunId}
            className="w-full h-10 self-start inline-flex items-center justify-center px-3 text-sm rounded bg-gray-700 hover:bg-gray-800 text-white disabled:opacity-40"
            title="Clear only selected run containers from the current view."
          >
            Clear Selected View
          </button>
          <button
            onClick={replaySelectedRunView}
            disabled={isAll || busy || !selectedIndexLabRunId}
            className="w-full h-10 self-start inline-flex items-center justify-center px-3 text-sm rounded bg-emerald-700 hover:bg-emerald-800 text-white disabled:opacity-40"
            title="Replay selected run from persisted events/artifacts."
          >
            Replay Selected Run
          </button>
            </div>
          </>
        ) : null}
      </div>

      <div className="rounded-lg border-2 border-emerald-300 dark:border-emerald-600 ring-1 ring-emerald-100 dark:ring-emerald-900/40 bg-white dark:bg-gray-800 p-3 space-y-3" style={{ order: 20 }}>
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
            <span className="ml-2 inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
              Start Here
            </span>
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
        <div className="rounded border border-gray-200 dark:border-gray-700 p-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-gray-800 dark:text-gray-200 inline-flex items-center">
              ambiguity meter
              <Tip text={`Brand + model family size in catalog:
- easy: 1 sibling (green)
- medium: 2-3 siblings (amber/yellow)
- hard: 4-5 siblings (red)
- very hard: 6-8 siblings (fuchsia)
- extra hard: 9+ siblings (purple, hardest)

Variant-empty extraction policy:
- easy/medium: less strict extraction gate
- hard/very hard/extra hard: strict extraction gate`} />
            </span>
            <span className={`px-2 py-0.5 rounded ${selectedAmbiguityMeter.badgeCls}`}>
              {selectedAmbiguityMeter.label}
            </span>
            <span className="text-gray-500 dark:text-gray-400">
              family count {formatNumber(selectedAmbiguityMeter.count)}
            </span>
          </div>
          <div className="mt-2 h-2 w-full rounded bg-gray-200 dark:bg-gray-700 overflow-hidden">
            <div
              className={`h-full ${selectedAmbiguityMeter.barCls}`}
              style={{ width: `${selectedAmbiguityMeter.widthPct}%` }}
            />
          </div>
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

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3" style={{ order: 46 }}>
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
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
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
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">
                  variant guards
                  <Tip text="Identity/model guard terms used by pre-execution query validation." />
                </div>
                <div className="font-semibold">{formatNumber(indexlabSearchProfileVariantGuardTerms.length)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">
                  query rejects
                  <Tip text="Total dropped query candidates (pruned + safety guard rejects) before execution." />
                </div>
                <div className="font-semibold">
                  {formatNumber(indexlabSearchProfileQueryRejectBreakdown.ordered.length)}
                </div>
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
            <div className="rounded border border-gray-200 dark:border-gray-700 p-2 text-xs">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">
                variant guard terms
                <Tip text="Canonical identity/model tokens used to hard-reject off-model discovery queries." />
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {indexlabSearchProfileVariantGuardTerms.length === 0 ? (
                  <span className="text-gray-500 dark:text-gray-400">no guard terms</span>
                ) : (
                  indexlabSearchProfileVariantGuardTerms.map((term) => (
                    <span key={`variant-guard:${term}`} className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                      {term}
                    </span>
                  ))
                )}
              </div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 p-2 text-xs">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">
                query guard summary
                <Tip text="Pre-execution guard enforces brand/model/digit checks before provider search dispatch." />
              </div>
              <div className="mt-1 flex flex-wrap gap-2">
                <span>
                  accepted {formatNumber(Number(indexlabSearchProfile.query_guard?.accepted_query_count || indexlabSearchProfile.selected_query_count || 0))}
                </span>
                <span>
                  rejected {formatNumber(indexlabSearchProfileQueryRejectBreakdown.ordered.length)}
                </span>
                <span>
                  required digit groups {(indexlabSearchProfile.query_guard?.required_digit_groups || []).length > 0 ? (indexlabSearchProfile.query_guard?.required_digit_groups || []).join(', ') : '-'}
                </span>
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
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
              <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
                <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
                  Query Drop Log ({formatNumber(indexlabSearchProfileQueryRejectBreakdown.ordered.length)})
                  <Tip text="Dropped query audit split into Safety Rejected (guard) vs Pruned (dedupe/cap). Safety rows are shown first." />
                </div>
                <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400 flex flex-wrap gap-2">
                  <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                    safety rejected {formatNumber(indexlabSearchProfileQueryRejectBreakdown.safety.length)}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                    pruned (expected) {formatNumber(indexlabSearchProfileQueryRejectBreakdown.pruned.length)}
                  </span>
                </div>
                <table className="mt-2 min-w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                      <th className="py-1 pr-3">query</th>
                      <th className="py-1 pr-3">source</th>
                      <th className="py-1 pr-3">reason</th>
                      <th className="py-1 pr-3">stage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {indexlabSearchProfileQueryRejectBreakdown.ordered.length === 0 && (
                      <tr>
                        <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={4}>no query rejects</td>
                      </tr>
                    )}
                    {indexlabSearchProfileQueryRejectBreakdown.ordered.slice(0, 40).map((row, idx) => {
                      const reason = normalizeToken(row.reason);
                      const stage = normalizeToken(row.stage);
                      const isSafety = (
                        stage === 'pre_execution_guard'
                        || reason.startsWith('missing_brand_token')
                        || reason.startsWith('missing_required_digit_group')
                        || reason.startsWith('foreign_model_token')
                      );
                      return (
                        <tr key={`query-reject:${row.query || row.reason || idx}`} className="border-b border-gray-100 dark:border-gray-800">
                          <td className="py-1 pr-3 font-mono truncate max-w-[34rem]" title={row.query || row.detail || '-'}>
                            {row.query || '-'}
                          </td>
                          <td className="py-1 pr-3">{row.source || '-'}</td>
                          <td className="py-1 pr-3">
                            <span className={`px-1.5 py-0.5 rounded ${
                              isSafety
                                ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                                : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                            }`}>
                              {row.reason || '-'}
                            </span>
                          </td>
                          <td className="py-1 pr-3">{row.stage || '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
                <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
                  Alias Reject Log ({formatNumber(indexlabSearchProfileAliasRejectRows.length)})
                  <Tip text="Dropped deterministic alias audit (duplicate/empty/cap) for Phase 02 explainability." />
                </div>
                <table className="mt-2 min-w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                      <th className="py-1 pr-3">alias</th>
                      <th className="py-1 pr-3">source</th>
                      <th className="py-1 pr-3">reason</th>
                      <th className="py-1 pr-3">stage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {indexlabSearchProfileAliasRejectRows.length === 0 && (
                      <tr>
                        <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={4}>no alias rejects</td>
                      </tr>
                    )}
                    {indexlabSearchProfileAliasRejectRows.slice(0, 40).map((row, idx) => (
                      <tr key={`alias-reject:${row.alias || row.reason || idx}`} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-1 pr-3 font-mono">{row.alias || '-'}</td>
                        <td className="py-1 pr-3">{row.source || '-'}</td>
                        <td className="py-1 pr-3">{row.reason || '-'}</td>
                        <td className="py-1 pr-3">{row.stage || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
          <div className="ml-auto flex items-center gap-2">
            <select
              value={selectedIndexLabRunId}
              onChange={(e) => {
                setSelectedIndexLabRunId(e.target.value);
                setClearedRunViewId('');
              }}
              className="px-2 py-1 text-xs border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            >
              <option value="">select run</option>
              {indexlabRuns.map((row) => (
                <option key={row.run_id} value={row.run_id}>
                  {row.run_id} | {row.status || 'unknown'} {row.product_id ? `| ${row.product_id}` : ''}
                </option>
              ))}
            </select>
            <ActivityGauge
              label="stream activity"
              currentPerMin={eventStreamActivity.currentPerMin}
              peakPerMin={eventStreamActivity.peakPerMin}
              active={processRunning}
            />
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
            {selectedIndexLabRun.identity_lock_status ? <span> | lock {selectedIndexLabRun.identity_lock_status}</span> : null}
            {selectedIndexLabRun.dedupe_mode ? <span> | dedupe {selectedIndexLabRun.dedupe_mode}</span> : null}
            {selectedIndexLabRun.phase_cursor ? <span> | cursor {selectedIndexLabRun.phase_cursor}</span> : null}
            {selectedRunIdentityFingerprintShort ? <span> | fp {selectedRunIdentityFingerprintShort}</span> : null}
            <span> | status {selectedIndexLabRun.status || 'unknown'}</span>
            <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{selectedRunStartupSummary}</div>
            {runViewCleared ? (
              <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-300">
                selected run view is cleared; click Replay Selected Run to repopulate from persisted artifacts.
              </div>
            ) : null}
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
                <th className="py-1 pr-3">
                  <span className="inline-flex items-center gap-1">
                    fetch ms
                    <Tip text="Network/fetch duration in milliseconds for the URL job." />
                  </span>
                </th>
                <th className="py-1 pr-3">
                  <span className="inline-flex items-center gap-1">
                    parse ms
                    <Tip text="Parse/extraction duration for the URL job when parse_finished is emitted." />
                  </span>
                </th>
                <th className="py-1 pr-3">
                  <span className="inline-flex items-center gap-1">
                    article
                    <Tip text="Main article extraction method used for this URL (readability/fallback)." />
                  </span>
                </th>
                <th className="py-1 pr-3">
                  <span className="inline-flex items-center gap-1">
                    article q
                    <Tip text="Article extraction quality score (0-100)." />
                  </span>
                </th>
                <th className="py-1 pr-3">
                  <span className="inline-flex items-center gap-1">
                    low
                    <Tip text="Whether article extraction marked this URL as low quality." />
                  </span>
                </th>
                <th className="py-1 pr-3">started</th>
                <th className="py-1 pr-3">finished</th>
              </tr>
            </thead>
            <tbody>
              {indexlabSummary.recentJobs.length === 0 && (
                <tr>
                  <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={10}>no url jobs yet</td>
                </tr>
              )}
              {indexlabSummary.recentJobs.map((row) => (
                <tr key={row.url} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="py-1 pr-3 font-mono truncate max-w-[32rem]" title={row.url}>{row.url}</td>
                  <td className="py-1 pr-3">{row.status}</td>
                  <td className="py-1 pr-3">{row.status_code || '-'}</td>
                  <td className="py-1 pr-3">{row.ms || '-'}</td>
                  <td className="py-1 pr-3">{row.parse_ms || '-'}</td>
                  <td className="py-1 pr-3">{row.article_method || '-'}</td>
                  <td className="py-1 pr-3">{Number.isFinite(Number(row.article_quality_score)) ? formatNumber(Number(row.article_quality_score || 0), 1) : '-'}</td>
                  <td className="py-1 pr-3">
                    {row.article_low_quality ? (
                      <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">yes</span>
                    ) : 'no'}
                  </td>
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

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3" style={{ order: 45 }}>
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

        <div className="rounded border border-gray-200 dark:border-gray-700 p-2 text-xs">
          <div className="font-semibold text-gray-800 dark:text-gray-200 flex items-center">
            identity lock state
            <Tip text="Phase 01: identity evidence lock for this NeedSet snapshot (locked/provisional/unlocked/conflict)." />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className={`px-2 py-0.5 rounded ${
              indexlabNeedsetIdentityState.status === 'locked'
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                : indexlabNeedsetIdentityState.status === 'provisional'
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                  : indexlabNeedsetIdentityState.status === 'conflict'
                    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                    : 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
            }`}>
              {indexlabNeedsetIdentityState.status}
            </span>
            <span className="inline-flex items-center gap-1">
              confidence {indexlabNeedsetIdentityState.confidence === null ? '-' : formatNumber(Number(indexlabNeedsetIdentityState.confidence || 0), 3)}
              <Tip text="Aggregate identity confidence from accepted identity evidence for this run snapshot." />
            </span>
            <span className="inline-flex items-center gap-1">
              best match {indexlabNeedsetIdentityState.maxMatch === null ? '-' : formatNumber(Number(indexlabNeedsetIdentityState.maxMatch || 0), 3)}
              <Tip text="Highest single-source identity-match score seen in the identity audit rows." />
            </span>
            <span className="inline-flex items-center gap-1">
              gate {indexlabNeedsetIdentityState.gateValidated ? 'validated' : 'not-validated'}
              <Tip text="Identity gate validation status required before publish can pass." />
            </span>
            <span className="inline-flex items-center gap-1">
              extraction {indexlabNeedsetIdentityState.extractionGateOpen ? 'open' : 'gated'}
              <Tip text="Extraction gate for required/critical fields. Open allows provisional extraction even before final publish lock." />
            </span>
            <span className="inline-flex items-center gap-1">
              ambiguity {indexlabNeedsetIdentityState.ambiguityLabel || indexlabNeedsetIdentityState.ambiguityLevel} ({formatNumber(indexlabNeedsetIdentityState.familyModelCount || 0)})
              <Tip text="Brand+model family size from catalog. Higher counts imply more sibling variants and stricter identity ambiguity handling." />
            </span>
            <span className="inline-flex items-center gap-1">
              publish {indexlabNeedsetIdentityState.publishable ? 'allowed' : 'blocked'}
              <Tip text="Publish gate state for this run based on identity + confidence/evidence checks." />
            </span>
            <span className="inline-flex items-center gap-1">
              pages {formatNumber(indexlabNeedsetIdentityState.pageCount || 0)}
              <Tip text="Count of fetched pages currently contributing to identity evidence scoring." />
            </span>
          </div>
          {(indexlabNeedsetIdentityState.blockers || []).length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {(indexlabNeedsetIdentityState.blockers || []).slice(0, 8).map((reason) => (
                <span key={`needset-lock-blocker:${reason}`} className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                  blocker {reason}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="rounded border border-gray-200 dark:border-gray-700 p-2">
          <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center">needset size over time<Tip text="Sparkline of NeedSet size snapshots through the run." /></div>
          <NeedsetSparkline values={indexlabNeedsetSparklineValues} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
          <div className="rounded border border-gray-200 dark:border-gray-700 p-2">
            <div className="font-semibold text-gray-800 dark:text-gray-200 flex items-center">reason counts<Tip text="Why fields are still in NeedSet (missing, low_conf, tier_pref_unmet, blocked_by_identity, publish_gate_block, etc.)." /></div>
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
          <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
            identity audit rows ({formatNumber(indexlabNeedsetIdentityAuditRows.length)} shown)
            <Tip text="Source-level identity decisions linked to NeedSet lock state for Phase 01 auditability." />
          </div>
          <table className="mt-2 min-w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="py-1 pr-3">
                  <div className="inline-flex items-center">
                    <span>source</span>
                    <Tip text="Domain/source evaluated by identity audit for product match confidence." />
                  </div>
                </th>
                <th className="py-1 pr-3">
                  <div className="inline-flex items-center">
                    <span>decision</span>
                    <Tip text="Identity decision for this source row (accepted/rejected/review)." />
                  </div>
                </th>
                <th className="py-1 pr-3">
                  <div className="inline-flex items-center">
                    <span>confidence</span>
                    <Tip text="Row-level identity confidence score used by lock/gate calculations." />
                  </div>
                </th>
                <th className="py-1 pr-3">
                  <div className="inline-flex items-center">
                    <span>reason codes</span>
                    <Tip text="Identity-rule outcomes that explain the decision for this source row." />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {indexlabNeedsetIdentityAuditRows.length === 0 && (
                <tr>
                  <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={4}>no identity audit rows yet</td>
                </tr>
              )}
              {indexlabNeedsetIdentityAuditRows.map((row, idx) => (
                <tr key={`needset-audit:${row.source_id || row.url || idx}`} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="py-1 pr-3 font-mono truncate max-w-[26rem]" title={row.url || row.source_id}>
                    {row.source_id || row.url || '-'}
                  </td>
                  <td className="py-1 pr-3">{row.decision || '-'}</td>
                  <td className="py-1 pr-3">{row.confidence === null ? '-' : formatNumber(Number(row.confidence || 0), 3)}</td>
                  <td className="py-1 pr-3">
                    {(row.reason_codes || []).length > 0 ? (row.reason_codes || []).slice(0, 6).join(', ') : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
                    <span>blocked by</span>
                    <Tip text="Identity/publish gating blocks currently applied to this field." />
                  </div>
                </th>
                <th className="py-1 pr-3">
                  <div className="inline-flex items-center">
                    <span>id match</span>
                    <Tip text="Best identity-match score available to this NeedSet snapshot." />
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
                  <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={9}>no NeedSet rows yet</td>
                </tr>
              )}
              {indexlabNeedsetRows.map((row) => {
                const reqBadge = needsetRequiredLevelBadge(row.required_level);
                const refsGap = (Number(row.refs_found) || 0) - (Number(row.min_refs) || 0);
                const effectiveConfidence = Number.isFinite(Number(row.effective_confidence))
                  ? Number(row.effective_confidence)
                  : (Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : null);
                return (
                  <tr key={row.field_key} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-1 pr-3 font-mono">{row.field_key}</td>
                    <td className="py-1 pr-3">
                      <span className={`px-1.5 py-0.5 rounded ${reqBadge.cls}`}>
                        {reqBadge.short} {row.required_level || 'optional'}
                      </span>
                    </td>
                    <td className="py-1 pr-3">{formatNumber(Number(row.need_score || 0), 3)}</td>
                    <td className="py-1 pr-3">
                      {effectiveConfidence === null ? '-' : formatNumber(effectiveConfidence, 3)}
                      {row.confidence_capped ? (
                        <span className="ml-1 inline-flex items-center gap-1">
                          <span className="px-1 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                            capped
                          </span>
                          <Tip text="Confidence was capped due to identity uncertainty or publish-gate policy." />
                        </span>
                      ) : null}
                    </td>
                    <td className="py-1 pr-3">{row.best_tier_seen === null ? '-' : formatNumber(Number(row.best_tier_seen || 0))}</td>
                    <td className="py-1 pr-3">
                      {formatNumber(Number(row.refs_found || 0))}/{formatNumber(Number(row.min_refs || 0))}
                      <span className={`ml-1 ${refsGap >= 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}>
                        ({refsGap >= 0 ? '+' : ''}{formatNumber(refsGap)})
                      </span>
                    </td>
                    <td className="py-1 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {(row.blocked_by || []).length === 0 ? <span>-</span> : null}
                        {(row.blocked_by || []).map((reason) => (
                          <span key={`${row.field_key}:blocked:${reason}`} className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                            {reason}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-1 pr-3">
                      {row.best_identity_match === null || row.best_identity_match === undefined
                        ? '-'
                        : formatNumber(Number(row.best_identity_match || 0), 3)}
                      {row.quarantined ? (
                        <span className="ml-1 inline-flex items-center gap-1">
                          <span className="px-1 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                            quarantine
                          </span>
                          <Tip text="Field value is quarantined from publish output until identity gate is validated." />
                        </span>
                      ) : null}
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
