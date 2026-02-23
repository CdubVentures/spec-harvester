import type { IndexLabEvent } from '../../stores/indexlabStore';
import type { LearningFeedResponse } from '../../types/learning';

export interface IndexLabRunSummary {
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

export interface IndexLabRunsResponse {
  root: string;
  runs: IndexLabRunSummary[];
}

export interface IndexLabRunEventsResponse {
  run_id: string;
  count: number;
  events: IndexLabEvent[];
}

export interface IndexLabNeedSetRow {
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

export interface IndexLabNeedSetSnapshot {
  ts: string;
  needset_size: number;
}

export interface IndexLabNeedSetResponse {
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

export interface IndexLabSearchProfileAlias {
  alias: string;
  source?: string;
  weight?: number;
}

export interface IndexLabSearchProfileQueryRow {
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

export interface IndexLabSearchProfileResponse {
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

export interface IndexLabSerpCandidateRow {
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

export interface IndexLabSerpSelectedUrlRow {
  url: string;
  query?: string;
  doc_kind?: string;
  tier_name?: string;
  score?: number;
  reason_codes?: string[];
}

export interface IndexLabSerpQueryRow {
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

export interface IndexLabSerpExplorerResponse {
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

export interface SearxngStatusResponse {
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

export interface IndexingLlmConfigResponse {
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

export interface IndexingLlmMetricsRunRow {
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

export interface IndexingLlmMetricsResponse {
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

export interface IndexLabLlmTraceRow {
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

export interface IndexLabLlmTracesResponse {
  generated_at?: string;
  run_id?: string;
  category?: string;
  product_id?: string;
  count?: number;
  traces?: IndexLabLlmTraceRow[];
}

export interface IndexingDomainChecklistUrlRow {
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

export interface IndexingDomainChecklistRow {
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

export interface IndexingDomainChecklistRepairRow {
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

export interface IndexingDomainChecklistBadPatternRow {
  domain: string;
  path: string;
  reason?: string;
  count?: number;
  last_ts?: string;
}

export interface IndexingDomainChecklistResponse {
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

export interface IndexLabAutomationJobRow {
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

export interface IndexLabAutomationActionRow {
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

export interface IndexLabAutomationQueueResponse {
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

export interface IndexLabEvidenceIndexDocumentRow {
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

export interface IndexLabEvidenceIndexFieldRow {
  field_key: string;
  assertions?: number;
  evidence_refs?: number;
  distinct_sources?: number;
}

export interface IndexLabEvidenceIndexSearchRow {
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

export interface IndexLabEvidenceIndexResponse {
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
  dedupe_stream?: {
    total?: number;
    new_count?: number;
    reused_count?: number;
    updated_count?: number;
    total_chunks_indexed?: number;
  };
}

export interface IndexLabPhase07HitRow {
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

export interface IndexLabPhase07FieldRow {
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

export interface IndexLabPhase07Response {
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

export interface IndexLabPhase08BatchRow {
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

export interface IndexLabPhase08FieldContextRow {
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

export interface IndexLabPhase08PrimeRow {
  field_key?: string;
  snippet_id?: string;
  source_id?: string | null;
  url?: string;
  quote_preview?: string;
}

export interface IndexLabPhase08Response {
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

export interface IndexLabDynamicFetchDashboardHostRow {
  host?: string;
  request_count?: number;
  success_count?: number;
  failure_count?: number;
  status_2xx_count?: number;
  status_4xx_count?: number;
  status_5xx_count?: number;
  parse_error_count?: number;
  screenshot_count?: number;
  network_payload_rows_total?: number;
  graphql_replay_rows_total?: number;
  fetcher_kind_counts?: Record<string, number>;
  attempts_total?: number;
  retry_count_total?: number;
  avg_attempts_per_request?: number;
  avg_retry_per_request?: number;
  avg_fetch_ms?: number;
  avg_parse_ms?: number;
  avg_host_wait_ms?: number;
  avg_navigation_ms?: number;
  avg_network_idle_wait_ms?: number;
  avg_interactive_wait_ms?: number;
  avg_graphql_replay_ms?: number;
  avg_content_capture_ms?: number;
  avg_screenshot_capture_ms?: number;
}

export interface IndexLabDynamicFetchDashboardResponse {
  run_id?: string;
  category?: string;
  product_id?: string;
  generated_at?: string | null;
  host_count?: number;
  hosts?: IndexLabDynamicFetchDashboardHostRow[];
  summary_only?: boolean;
  key?: string | null;
  latest_key?: string | null;
}

export interface RoundSummaryRow {
  round: number;
  needset_size: number;
  missing_required_count: number;
  critical_count: number;
  confidence: number;
  validated: boolean;
  improved: boolean;
  improvement_reasons: string[];
}

export interface RoundSummaryResponse {
  run_id?: string;
  rounds: RoundSummaryRow[];
  stop_reason: string | null;
  round_count: number;
}

export type PanelKey = 'overview' | 'runtime' | 'picker' | 'searchProfile' | 'serpExplorer' | 'phase5' | 'phase6b' | 'phase6' | 'phase7' | 'phase8' | 'phase9' | 'learning' | 'urlHealth' | 'llmOutput' | 'llmMetrics' | 'eventStream' | 'needset';
export type PanelStateToken = 'live' | 'ready' | 'waiting';

export const PANEL_KEYS: PanelKey[] = ['overview', 'runtime', 'picker', 'searchProfile', 'serpExplorer', 'phase5', 'phase6b', 'phase6', 'phase7', 'phase8', 'phase9', 'learning', 'urlHealth', 'llmOutput', 'llmMetrics', 'eventStream', 'needset'];

export const DEFAULT_PANEL_COLLAPSED: Record<PanelKey, boolean> = {
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
  phase9: true,
  learning: true,
  urlHealth: true,
  llmOutput: true,
  llmMetrics: true,
  eventStream: true,
  needset: true
};

export interface TimedIndexLabEvent {
  row: IndexLabEvent;
  tsMs: number;
  stage: string;
  event: string;
  productId: string;
}
