/**
 * SpecDb — SQLite-backed spec candidate/review data store.
 *
 * Follows the pattern from src/research/frontierSqlite.js:
 * - better-sqlite3 synchronous API
 * - WAL journal mode + NORMAL sync
 * - Schema auto-created on construction
 * - All methods synchronous
 */

import Database from 'better-sqlite3';

function normalizeListLinkToken(value) {
  return String(value ?? '').trim();
}

function expandListLinkValues(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map(normalizeListLinkToken).filter(Boolean))];
  }
  const raw = normalizeListLinkToken(value);
  if (!raw) return [];
  const split = raw
    .split(/[,;|/]+/)
    .map((part) => normalizeListLinkToken(part))
    .filter(Boolean);
  const ordered = split.length > 1 ? split : [raw];
  const seen = new Set();
  const out = [];
  for (const token of ordered) {
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}

function toPositiveInteger(value) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS candidates (
  candidate_id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  product_id TEXT NOT NULL,
  field_key TEXT NOT NULL,
  value TEXT,
  normalized_value TEXT,
  score REAL DEFAULT 0,
  rank INTEGER,
  source_url TEXT,
  source_host TEXT,
  source_root_domain TEXT,
  source_tier INTEGER,
  source_method TEXT,
  approved_domain INTEGER DEFAULT 0,
  snippet_id TEXT,
  snippet_hash TEXT,
  snippet_text TEXT,
  quote TEXT,
  quote_span_start INTEGER,
  quote_span_end INTEGER,
  evidence_url TEXT,
  evidence_retrieved_at TEXT,
  is_component_field INTEGER DEFAULT 0,
  component_type TEXT,
  is_list_field INTEGER DEFAULT 0,
  llm_extract_model TEXT,
  extracted_at TEXT NOT NULL DEFAULT (datetime('now')),
  run_id TEXT
);

CREATE TABLE IF NOT EXISTS candidate_reviews (
  review_id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id TEXT NOT NULL REFERENCES candidates(candidate_id),
  context_type TEXT NOT NULL CHECK(context_type IN ('item', 'component', 'list')),
  context_id TEXT NOT NULL,
  human_accepted INTEGER DEFAULT 0,
  human_accepted_at TEXT,
  ai_review_status TEXT DEFAULT 'not_run'
    CHECK(ai_review_status IN ('not_run', 'pending', 'accepted', 'rejected', 'unknown')),
  ai_confidence REAL,
  ai_reason TEXT,
  ai_reviewed_at TEXT,
  ai_review_model TEXT,
  human_override_ai INTEGER DEFAULT 0,
  human_override_ai_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(candidate_id, context_type, context_id)
);

CREATE TABLE IF NOT EXISTS component_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  component_type TEXT NOT NULL,
  component_name TEXT NOT NULL,
  component_maker TEXT DEFAULT '',
  component_identity_id INTEGER REFERENCES component_identity(id),
  property_key TEXT NOT NULL,
  value TEXT,
  confidence REAL DEFAULT 1.0,
  variance_policy TEXT,
  source TEXT DEFAULT 'component_db',
  accepted_candidate_id TEXT,
  needs_review INTEGER DEFAULT 0,
  overridden INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(category, component_type, component_name, component_maker, property_key)
);

CREATE TABLE IF NOT EXISTS component_identity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  component_type TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  maker TEXT DEFAULT '',
  links TEXT,
  source TEXT DEFAULT 'component_db',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(category, component_type, canonical_name, maker)
);

CREATE TABLE IF NOT EXISTS component_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component_id INTEGER NOT NULL REFERENCES component_identity(id),
  alias TEXT NOT NULL,
  source TEXT DEFAULT 'component_db',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(component_id, alias)
);

CREATE TABLE IF NOT EXISTS enum_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  field_key TEXT NOT NULL,
  source TEXT DEFAULT 'field_rules',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(category, field_key)
);

CREATE TABLE IF NOT EXISTS list_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  list_id INTEGER NOT NULL REFERENCES enum_lists(id),
  field_key TEXT NOT NULL,
  value TEXT NOT NULL,
  normalized_value TEXT,
  source TEXT DEFAULT 'known_values',
  accepted_candidate_id TEXT,
  enum_policy TEXT,
  needs_review INTEGER DEFAULT 0,
  overridden INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(category, field_key, value)
);

CREATE TABLE IF NOT EXISTS item_field_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  product_id TEXT NOT NULL,
  field_key TEXT NOT NULL,
  value TEXT,
  confidence REAL DEFAULT 0,
  source TEXT DEFAULT 'pipeline',
  accepted_candidate_id TEXT,
  overridden INTEGER DEFAULT 0,
  needs_ai_review INTEGER DEFAULT 0,
  ai_review_complete INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(category, product_id, field_key)
);

CREATE TABLE IF NOT EXISTS item_component_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  product_id TEXT NOT NULL,
  field_key TEXT NOT NULL,
  component_type TEXT NOT NULL,
  component_name TEXT NOT NULL,
  component_maker TEXT DEFAULT '',
  match_type TEXT,
  match_score REAL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(category, product_id, field_key)
);

CREATE TABLE IF NOT EXISTS item_list_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  product_id TEXT NOT NULL,
  field_key TEXT NOT NULL,
  list_value_id INTEGER REFERENCES list_values(id),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(category, product_id, field_key, list_value_id)
);

CREATE INDEX IF NOT EXISTS idx_cand_product_field ON candidates(product_id, field_key);
CREATE INDEX IF NOT EXISTS idx_cand_field_value ON candidates(field_key, normalized_value);
CREATE INDEX IF NOT EXISTS idx_cand_component ON candidates(component_type) WHERE component_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rev_context ON candidate_reviews(context_type, context_id);
CREATE INDEX IF NOT EXISTS idx_rev_candidate ON candidate_reviews(candidate_id);
CREATE INDEX IF NOT EXISTS idx_cv_type_name ON component_values(component_type, component_name);
CREATE INDEX IF NOT EXISTS idx_ca_alias ON component_aliases(alias);
CREATE INDEX IF NOT EXISTS idx_el_field ON enum_lists(category, field_key);
CREATE INDEX IF NOT EXISTS idx_lv_field ON list_values(field_key);
CREATE INDEX IF NOT EXISTS idx_ifs_product ON item_field_state(product_id);
CREATE INDEX IF NOT EXISTS idx_icl_product ON item_component_links(product_id);
CREATE INDEX IF NOT EXISTS idx_ill_product ON item_list_links(product_id);
CREATE INDEX IF NOT EXISTS idx_icl_component ON item_component_links(category, component_type, component_name, component_maker);
CREATE INDEX IF NOT EXISTS idx_ill_list_value ON item_list_links(list_value_id);

-- Phase 2 tables

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL, product_id TEXT NOT NULL,
  brand TEXT DEFAULT '', model TEXT DEFAULT '', variant TEXT DEFAULT '',
  status TEXT DEFAULT 'active', seed_urls TEXT, identifier TEXT,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(category, product_id)
);

CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_key TEXT NOT NULL, canonical_name TEXT NOT NULL,
  aliases TEXT, categories TEXT, website TEXT, identifier TEXT,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(brand_key)
);

CREATE TABLE IF NOT EXISTS product_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL, product_id TEXT NOT NULL,
  s3key TEXT DEFAULT '', status TEXT DEFAULT 'pending',
  priority INTEGER DEFAULT 3, attempts_total INTEGER DEFAULT 0,
  retry_count INTEGER DEFAULT 0, max_attempts INTEGER DEFAULT 3,
  next_retry_at TEXT, last_run_id TEXT,
  cost_usd_total REAL DEFAULT 0, rounds_completed INTEGER DEFAULT 0,
  next_action_hint TEXT, last_urls_attempted TEXT,
  last_error TEXT, last_started_at TEXT, last_completed_at TEXT,
  dirty_flags TEXT, last_summary TEXT,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(category, product_id)
);

CREATE TABLE IF NOT EXISTS curation_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  suggestion_id TEXT NOT NULL,
  category TEXT NOT NULL, suggestion_type TEXT NOT NULL,
  field_key TEXT, component_type TEXT,
  value TEXT NOT NULL, normalized_value TEXT,
  status TEXT DEFAULT 'pending',
  source TEXT, product_id TEXT, run_id TEXT,
  first_seen_at TEXT DEFAULT (datetime('now')), last_seen_at TEXT,
  reviewed_by TEXT, reviewed_at TEXT, review_note TEXT,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(category, suggestion_type, field_key, value)
);

CREATE TABLE IF NOT EXISTS component_review_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id TEXT NOT NULL,
  category TEXT NOT NULL, component_type TEXT NOT NULL,
  field_key TEXT, raw_query TEXT, matched_component TEXT,
  match_type TEXT, name_score REAL, property_score REAL, combined_score REAL,
  alternatives TEXT, product_id TEXT, run_id TEXT,
  status TEXT DEFAULT 'pending_ai',
  ai_decision TEXT, ai_suggested_name TEXT, ai_suggested_maker TEXT, ai_reviewed_at TEXT,
  product_attributes TEXT, reasoning_note TEXT,
  human_reviewed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(review_id)
);

CREATE TABLE IF NOT EXISTS product_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL, product_id TEXT NOT NULL, run_id TEXT NOT NULL,
  is_latest INTEGER DEFAULT 1,
  summary_json TEXT, validated INTEGER DEFAULT 0, confidence REAL DEFAULT 0,
  cost_usd_run REAL DEFAULT 0, sources_attempted INTEGER DEFAULT 0,
  run_at TEXT DEFAULT (datetime('now')),
  UNIQUE(category, product_id, run_id)
);

CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL, product_id TEXT, run_id TEXT,
  artifact_type TEXT NOT NULL, url TEXT,
  local_path TEXT, content_hash TEXT, mime_type TEXT, size_bytes INTEGER,
  fetched_at TEXT, created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_at TEXT DEFAULT (datetime('now')),
  category TEXT, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  field_changed TEXT, old_value TEXT, new_value TEXT,
  change_type TEXT DEFAULT 'update',
  actor_type TEXT DEFAULT 'system', actor_id TEXT, run_id TEXT, note TEXT,
  product_id TEXT, component_type TEXT, component_name TEXT, field_key TEXT
);

CREATE TABLE IF NOT EXISTS llm_route_matrix (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('field', 'component', 'list')),
  route_key TEXT NOT NULL,
  required_level TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  availability TEXT NOT NULL,
  effort INTEGER NOT NULL DEFAULT 3,
  effort_band TEXT NOT NULL DEFAULT '1-3',
  single_source_data INTEGER NOT NULL DEFAULT 1,
  all_source_data INTEGER NOT NULL DEFAULT 0,
  enable_websearch INTEGER NOT NULL DEFAULT 1,
  model_ladder_today TEXT NOT NULL,
  all_sources_confidence_repatch INTEGER NOT NULL DEFAULT 1,
  max_tokens INTEGER NOT NULL DEFAULT 4096,
  studio_key_navigation_sent_in_extract_review INTEGER NOT NULL DEFAULT 1,
  studio_contract_rules_sent_in_extract_review INTEGER NOT NULL DEFAULT 1,
  studio_extraction_guidance_sent_in_extract_review INTEGER NOT NULL DEFAULT 1,
  studio_tooltip_or_description_sent_when_present INTEGER NOT NULL DEFAULT 1,
  studio_enum_options_sent_when_present INTEGER NOT NULL DEFAULT 1,
  studio_component_variance_constraints_sent_in_component_review INTEGER NOT NULL DEFAULT 1,
  studio_parse_template_sent_direct_in_extract_review INTEGER NOT NULL DEFAULT 1,
  studio_ai_mode_difficulty_effort_sent_direct_in_extract_review INTEGER NOT NULL DEFAULT 1,
  studio_required_level_sent_in_extract_review INTEGER NOT NULL DEFAULT 1,
  studio_component_entity_set_sent_when_component_field INTEGER NOT NULL DEFAULT 1,
  studio_evidence_policy_sent_direct_in_extract_review INTEGER NOT NULL DEFAULT 1,
  studio_variance_policy_sent_in_component_review INTEGER NOT NULL DEFAULT 1,
  studio_constraints_sent_in_component_review INTEGER NOT NULL DEFAULT 1,
  studio_send_booleans_prompted_to_model INTEGER NOT NULL DEFAULT 0,
  scalar_linked_send TEXT NOT NULL DEFAULT 'scalar value + prime sources',
  component_values_send TEXT NOT NULL DEFAULT 'component values + prime sources',
  list_values_send TEXT NOT NULL DEFAULT 'list values prime sources',
  llm_output_min_evidence_refs_required INTEGER NOT NULL DEFAULT 1,
  insufficient_evidence_action TEXT NOT NULL DEFAULT 'threshold_unmet',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(category, route_key)
);

CREATE INDEX IF NOT EXISTS idx_pq_category ON product_queue(category, status);
CREATE INDEX IF NOT EXISTS idx_pq_product ON product_queue(category, product_id);
CREATE INDEX IF NOT EXISTS idx_cs_category ON curation_suggestions(category, suggestion_type, status);
CREATE INDEX IF NOT EXISTS idx_crq_category ON component_review_queue(category, component_type, status);
CREATE INDEX IF NOT EXISTS idx_pr_product ON product_runs(category, product_id);
CREATE INDEX IF NOT EXISTS idx_pr_latest ON product_runs(category, product_id, is_latest) WHERE is_latest = 1;
CREATE INDEX IF NOT EXISTS idx_art_product ON artifacts(category, product_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_products_cat ON products(category);
CREATE INDEX IF NOT EXISTS idx_lrm_cat_scope ON llm_route_matrix(category, scope);

-- Source capture tables (evidence lineage, model-agnostic)

CREATE TABLE IF NOT EXISTS source_registry (
  source_id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  item_identifier TEXT NOT NULL,
  product_id TEXT,
  run_id TEXT,
  source_url TEXT NOT NULL,
  source_host TEXT,
  source_root_domain TEXT,
  source_tier INTEGER,
  source_method TEXT,
  crawl_status TEXT DEFAULT 'fetched',
  http_status INTEGER,
  fetched_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS source_artifacts (
  artifact_id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL REFERENCES source_registry(source_id),
  artifact_type TEXT NOT NULL,
  local_path TEXT NOT NULL,
  content_hash TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  captured_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS source_assertions (
  assertion_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES source_registry(source_id),
  field_key TEXT NOT NULL,
  context_kind TEXT NOT NULL CHECK(context_kind IN ('scalar','component','list')),
  context_ref TEXT,
  item_field_state_id INTEGER REFERENCES item_field_state(id),
  component_value_id INTEGER REFERENCES component_values(id),
  list_value_id INTEGER REFERENCES list_values(id),
  enum_list_id INTEGER REFERENCES enum_lists(id),
  value_raw TEXT,
  value_normalized TEXT,
  unit TEXT,
  candidate_id TEXT,
  extraction_method TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS source_evidence_refs (
  evidence_ref_id INTEGER PRIMARY KEY AUTOINCREMENT,
  assertion_id TEXT NOT NULL REFERENCES source_assertions(assertion_id),
  evidence_url TEXT,
  snippet_id TEXT,
  quote TEXT,
  method TEXT,
  tier INTEGER,
  retrieved_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Key review tables (AI decisions, user overrides, contract snapshots)

CREATE TABLE IF NOT EXISTS key_review_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK(target_kind IN ('grid_key','enum_key','component_key')),
  item_identifier TEXT,
  field_key TEXT NOT NULL,
  enum_value_norm TEXT,
  component_identifier TEXT,
  property_key TEXT,
  item_field_state_id INTEGER REFERENCES item_field_state(id),
  component_value_id INTEGER REFERENCES component_values(id),
  component_identity_id INTEGER REFERENCES component_identity(id),
  list_value_id INTEGER REFERENCES list_values(id),
  enum_list_id INTEGER REFERENCES enum_lists(id),

  required_level TEXT,
  availability TEXT,
  difficulty TEXT,
  effort INTEGER,
  ai_mode TEXT,
  parse_template TEXT,
  evidence_policy TEXT,
  min_evidence_refs_effective INTEGER DEFAULT 1,
  min_distinct_sources_required INTEGER DEFAULT 1,

  send_mode TEXT CHECK(send_mode IN ('single_source_data','all_source_data')),
  component_send_mode TEXT CHECK(component_send_mode IN ('component_values','component_values_prime_sources')),
  list_send_mode TEXT CHECK(list_send_mode IN ('list_values','list_values_prime_sources')),

  selected_value TEXT,
  selected_candidate_id TEXT,
  confidence_score REAL DEFAULT 0,
  confidence_level TEXT,
  flagged_at TEXT,
  resolved_at TEXT,

  ai_confirm_primary_status TEXT,
  ai_confirm_primary_confidence REAL,
  ai_confirm_primary_at TEXT,
  ai_confirm_primary_interrupted INTEGER DEFAULT 0,
  ai_confirm_primary_error TEXT,
  ai_confirm_shared_status TEXT,
  ai_confirm_shared_confidence REAL,
  ai_confirm_shared_at TEXT,
  ai_confirm_shared_interrupted INTEGER DEFAULT 0,
  ai_confirm_shared_error TEXT,

  user_accept_primary_status TEXT,
  user_accept_primary_at TEXT,
  user_accept_primary_by TEXT,
  user_accept_shared_status TEXT,
  user_accept_shared_at TEXT,
  user_accept_shared_by TEXT,

  user_override_ai_primary INTEGER DEFAULT 0,
  user_override_ai_primary_at TEXT,
  user_override_ai_primary_reason TEXT,
  user_override_ai_shared INTEGER DEFAULT 0,
  user_override_ai_shared_at TEXT,
  user_override_ai_shared_reason TEXT,

  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS key_review_runs (
  run_id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_review_state_id INTEGER NOT NULL REFERENCES key_review_state(id),
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  provider TEXT,
  model_used TEXT,
  prompt_hash TEXT,
  response_schema_version TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  latency_ms INTEGER,
  cost_usd REAL,
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS key_review_run_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_review_run_id INTEGER NOT NULL REFERENCES key_review_runs(run_id),
  assertion_id TEXT NOT NULL REFERENCES source_assertions(assertion_id),
  packet_role TEXT,
  position INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS key_review_audit (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_review_state_id INTEGER NOT NULL REFERENCES key_review_state(id),
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_krs_grid
  ON key_review_state(category, item_identifier, field_key)
  WHERE target_kind = 'grid_key';

CREATE UNIQUE INDEX IF NOT EXISTS ux_krs_enum
  ON key_review_state(category, field_key, enum_value_norm)
  WHERE target_kind = 'enum_key';

CREATE UNIQUE INDEX IF NOT EXISTS ux_krs_component
  ON key_review_state(category, component_identifier, property_key)
  WHERE target_kind = 'component_key';

CREATE INDEX IF NOT EXISTS idx_sr_item ON source_registry(category, item_identifier);
CREATE INDEX IF NOT EXISTS idx_sa_field ON source_assertions(field_key, context_kind);
CREATE INDEX IF NOT EXISTS idx_krs_kind ON key_review_state(category, target_kind, field_key);
CREATE INDEX IF NOT EXISTS idx_krs_selected_candidate ON key_review_state(category, selected_candidate_id);
CREATE INDEX IF NOT EXISTS idx_krr_state ON key_review_runs(key_review_state_id, stage, status);

-- Migration Phase 2: Billing entries
CREATE TABLE IF NOT EXISTS billing_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  month TEXT NOT NULL,
  day TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'unknown',
  model TEXT NOT NULL DEFAULT 'unknown',
  category TEXT DEFAULT '',
  product_id TEXT DEFAULT '',
  run_id TEXT DEFAULT '',
  round INTEGER DEFAULT 0,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  cached_prompt_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  reason TEXT DEFAULT 'extract',
  host TEXT DEFAULT '',
  url_count INTEGER DEFAULT 0,
  evidence_chars INTEGER DEFAULT 0,
  estimated_usage INTEGER DEFAULT 0,
  meta TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_be_month ON billing_entries(month);
CREATE INDEX IF NOT EXISTS idx_be_product ON billing_entries(product_id);
CREATE INDEX IF NOT EXISTS idx_be_day ON billing_entries(day);

-- Migration Phase 3: LLM cache
CREATE TABLE IF NOT EXISTS llm_cache (
  cache_key TEXT PRIMARY KEY,
  response TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  ttl INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_llmc_expiry ON llm_cache(timestamp);

-- Migration Phase 4: Learning profiles
CREATE TABLE IF NOT EXISTS learning_profiles (
  profile_id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  brand TEXT DEFAULT '',
  model TEXT DEFAULT '',
  variant TEXT DEFAULT '',
  runs_total INTEGER DEFAULT 0,
  validated_runs INTEGER DEFAULT 0,
  validated INTEGER DEFAULT 0,
  unknown_field_rate REAL DEFAULT 0,
  unknown_field_rate_avg REAL DEFAULT 0,
  parser_health_avg REAL DEFAULT 0,
  preferred_urls TEXT DEFAULT '[]',
  feedback_urls TEXT DEFAULT '[]',
  uncertain_fields TEXT DEFAULT '[]',
  host_stats TEXT DEFAULT '[]',
  critical_fields_below TEXT DEFAULT '[]',
  last_run TEXT DEFAULT '{}',
  parser_health TEXT DEFAULT '{}',
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lp_category ON learning_profiles(category);

-- Migration Phase 5: Category brain
CREATE TABLE IF NOT EXISTS category_brain (
  category TEXT NOT NULL,
  artifact_name TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (category, artifact_name)
);

-- Migration Phase 6: Source intelligence
CREATE TABLE IF NOT EXISTS source_intel_domains (
  root_domain TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  http_ok_count INTEGER DEFAULT 0,
  identity_match_count INTEGER DEFAULT 0,
  major_anchor_conflict_count INTEGER DEFAULT 0,
  fields_contributed_count INTEGER DEFAULT 0,
  fields_accepted_count INTEGER DEFAULT 0,
  accepted_critical_fields_count INTEGER DEFAULT 0,
  products_seen INTEGER DEFAULT 0,
  approved_attempts INTEGER DEFAULT 0,
  candidate_attempts INTEGER DEFAULT 0,
  parser_runs INTEGER DEFAULT 0,
  parser_success_count INTEGER DEFAULT 0,
  parser_health_score_total REAL DEFAULT 0,
  endpoint_signal_count INTEGER DEFAULT 0,
  endpoint_signal_score_total REAL DEFAULT 0,
  planner_score REAL DEFAULT 0,
  field_reward_strength REAL DEFAULT 0,
  recent_products TEXT DEFAULT '[]',
  per_field_helpfulness TEXT DEFAULT '{}',
  fingerprint_counts TEXT DEFAULT '{}',
  extra_stats TEXT DEFAULT '{}',
  last_seen_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sid_category ON source_intel_domains(category);

CREATE TABLE IF NOT EXISTS source_intel_field_rewards (
  root_domain TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'domain',
  scope_key TEXT NOT NULL DEFAULT '',
  field TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'unknown',
  seen_count REAL DEFAULT 0,
  success_count REAL DEFAULT 0,
  fail_count REAL DEFAULT 0,
  contradiction_count REAL DEFAULT 0,
  success_rate REAL DEFAULT 0,
  contradiction_rate REAL DEFAULT 0,
  reward_score REAL DEFAULT 0,
  last_seen_at TEXT,
  last_decay_at TEXT,
  PRIMARY KEY (root_domain, scope, scope_key, field, method)
);
CREATE INDEX IF NOT EXISTS idx_sifr_domain ON source_intel_field_rewards(root_domain);

CREATE TABLE IF NOT EXISTS source_intel_brands (
  root_domain TEXT NOT NULL,
  brand_key TEXT NOT NULL,
  brand TEXT DEFAULT '',
  attempts INTEGER DEFAULT 0,
  http_ok_count INTEGER DEFAULT 0,
  identity_match_count INTEGER DEFAULT 0,
  major_anchor_conflict_count INTEGER DEFAULT 0,
  fields_contributed_count INTEGER DEFAULT 0,
  fields_accepted_count INTEGER DEFAULT 0,
  accepted_critical_fields_count INTEGER DEFAULT 0,
  products_seen INTEGER DEFAULT 0,
  recent_products TEXT DEFAULT '[]',
  per_field_helpfulness TEXT DEFAULT '{}',
  extra_stats TEXT DEFAULT '{}',
  last_seen_at TEXT,
  PRIMARY KEY (root_domain, brand_key)
);

CREATE TABLE IF NOT EXISTS source_intel_paths (
  root_domain TEXT NOT NULL,
  path TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  http_ok_count INTEGER DEFAULT 0,
  identity_match_count INTEGER DEFAULT 0,
  major_anchor_conflict_count INTEGER DEFAULT 0,
  fields_contributed_count INTEGER DEFAULT 0,
  fields_accepted_count INTEGER DEFAULT 0,
  accepted_critical_fields_count INTEGER DEFAULT 0,
  products_seen INTEGER DEFAULT 0,
  recent_products TEXT DEFAULT '[]',
  per_field_helpfulness TEXT DEFAULT '{}',
  extra_stats TEXT DEFAULT '{}',
  last_seen_at TEXT,
  PRIMARY KEY (root_domain, path)
);

-- Migration Phase 7: Source corpus
CREATE TABLE IF NOT EXISTS source_corpus (
  url TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  host TEXT DEFAULT '',
  root_domain TEXT DEFAULT '',
  path TEXT DEFAULT '',
  title TEXT DEFAULT '',
  snippet TEXT DEFAULT '',
  tier INTEGER DEFAULT 99,
  role TEXT DEFAULT '',
  fields TEXT DEFAULT '[]',
  methods TEXT DEFAULT '[]',
  identity_match INTEGER DEFAULT 0,
  approved_domain INTEGER DEFAULT 0,
  brand TEXT DEFAULT '',
  model_name TEXT DEFAULT '',
  variant TEXT DEFAULT '',
  first_seen_at TEXT,
  last_seen_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sc_category ON source_corpus(category);
CREATE INDEX IF NOT EXISTS idx_sc_domain ON source_corpus(root_domain);

-- Migration Phase 9: Runtime events
CREATE TABLE IF NOT EXISTS runtime_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  level TEXT DEFAULT 'info',
  event TEXT NOT NULL,
  category TEXT DEFAULT '',
  product_id TEXT DEFAULT '',
  run_id TEXT DEFAULT '',
  data TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_re_ts ON runtime_events(ts);
CREATE INDEX IF NOT EXISTS idx_re_product ON runtime_events(product_id);

-- Migration Phase 10: Evidence index tables
CREATE TABLE IF NOT EXISTS evidence_documents (
  doc_id TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  url TEXT NOT NULL,
  host TEXT NOT NULL DEFAULT '',
  tier INTEGER DEFAULT 99,
  role TEXT DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  product_id TEXT NOT NULL DEFAULT '',
  dedupe_outcome TEXT NOT NULL DEFAULT 'new',
  indexed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(content_hash, parser_version)
);

CREATE TABLE IF NOT EXISTS evidence_chunks (
  chunk_id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT NOT NULL REFERENCES evidence_documents(doc_id),
  snippet_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_type TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  normalized_text TEXT NOT NULL DEFAULT '',
  snippet_hash TEXT NOT NULL DEFAULT '',
  extraction_method TEXT NOT NULL DEFAULT '',
  field_hints TEXT NOT NULL DEFAULT '[]',
  UNIQUE(doc_id, snippet_id)
);

CREATE TABLE IF NOT EXISTS evidence_facts (
  fact_id INTEGER PRIMARY KEY AUTOINCREMENT,
  chunk_id INTEGER NOT NULL REFERENCES evidence_chunks(chunk_id),
  doc_id TEXT NOT NULL REFERENCES evidence_documents(doc_id),
  field_key TEXT NOT NULL,
  value_raw TEXT NOT NULL DEFAULT '',
  value_normalized TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  extraction_method TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ed_category_product ON evidence_documents(category, product_id);
CREATE INDEX IF NOT EXISTS idx_ed_content_hash ON evidence_documents(content_hash);
CREATE INDEX IF NOT EXISTS idx_ec_doc ON evidence_chunks(doc_id);
CREATE INDEX IF NOT EXISTS idx_ec_snippet ON evidence_chunks(snippet_id);
CREATE INDEX IF NOT EXISTS idx_ef_doc ON evidence_facts(doc_id);
CREATE INDEX IF NOT EXISTS idx_ef_field ON evidence_facts(field_key);
CREATE INDEX IF NOT EXISTS idx_ef_chunk ON evidence_facts(chunk_id);

CREATE VIRTUAL TABLE IF NOT EXISTS evidence_chunks_fts USING fts5(
  text,
  normalized_text,
  field_hints,
  content='evidence_chunks',
  content_rowid='chunk_id',
  tokenize='porter unicode61'
);

-- Sprint 4: LLM-Guided Discovery tables

CREATE TABLE IF NOT EXISTS brand_domains (
  brand TEXT NOT NULL,
  category TEXT NOT NULL,
  official_domain TEXT,
  aliases TEXT,
  support_domain TEXT,
  confidence REAL DEFAULT 0.8,
  resolved_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (brand, category)
);

CREATE TABLE IF NOT EXISTS domain_classifications (
  domain TEXT PRIMARY KEY,
  classification TEXT NOT NULL,
  safe INTEGER NOT NULL DEFAULT 1,
  reason TEXT,
  classified_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS source_strategy (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  default_tier INTEGER DEFAULT 2,
  discovery_method TEXT NOT NULL DEFAULT 'search_first',
  search_pattern TEXT,
  priority INTEGER DEFAULT 50,
  enabled INTEGER DEFAULT 1,
  category_scope TEXT,
  notes TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
`;

const LLM_ROUTE_BOOLEAN_KEYS = [
  'single_source_data',
  'all_source_data',
  'enable_websearch',
  'all_sources_confidence_repatch',
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

function toBoolInt(value, fallback = 0) {
  if (value === undefined || value === null) return fallback ? 1 : 0;
  return value ? 1 : 0;
}

function toBand(effort) {
  const n = Math.max(1, Math.min(10, Number.parseInt(String(effort || 3), 10) || 3));
  if (n <= 3) return '1-3';
  if (n <= 6) return '4-6';
  if (n <= 8) return '7-8';
  return '9-10';
}

function makeRouteKey(scope, requiredLevel, difficulty, availability, effortBand, idx = 0) {
  return `${scope}:${requiredLevel}:${difficulty}:${availability}:${effortBand}:${idx}`;
}

function defaultContextFlagsForScope(scope = 'field') {
  const isComponent = scope === 'component';
  return {
    studio_key_navigation_sent_in_extract_review: 1,
    studio_contract_rules_sent_in_extract_review: 1,
    studio_extraction_guidance_sent_in_extract_review: 1,
    studio_tooltip_or_description_sent_when_present: 1,
    studio_enum_options_sent_when_present: 1,
    studio_component_variance_constraints_sent_in_component_review: isComponent ? 1 : 0,
    studio_parse_template_sent_direct_in_extract_review: 1,
    studio_ai_mode_difficulty_effort_sent_direct_in_extract_review: 1,
    studio_required_level_sent_in_extract_review: 1,
    studio_component_entity_set_sent_when_component_field: isComponent ? 1 : 0,
    studio_evidence_policy_sent_direct_in_extract_review: 1,
    studio_variance_policy_sent_in_component_review: isComponent ? 1 : 0,
    studio_constraints_sent_in_component_review: isComponent ? 1 : 0,
    studio_send_booleans_prompted_to_model: 0
  };
}

function baseLlmRoute({
  category,
  scope = 'field',
  required_level = 'expected',
  difficulty = 'medium',
  availability = 'expected',
  effort = 3,
  model_ladder_today = 'gpt-5-low -> gpt-5-medium',
  single_source_data = 1,
  all_source_data = 0,
  enable_websearch = 1,
  all_sources_confidence_repatch = 1,
  max_tokens = 4096,
  scalar_linked_send = 'scalar value + prime sources',
  component_values_send = 'component values + prime sources',
  list_values_send = 'list values prime sources',
  llm_output_min_evidence_refs_required = 1,
  insufficient_evidence_action = 'threshold_unmet',
  route_key
}) {
  const effortNorm = Math.max(1, Math.min(10, Number.parseInt(String(effort || 3), 10) || 3));
  return {
    category,
    scope,
    route_key: route_key || makeRouteKey(scope, required_level, difficulty, availability, toBand(effortNorm)),
    required_level,
    difficulty,
    availability,
    effort: effortNorm,
    effort_band: toBand(effortNorm),
    single_source_data: toBoolInt(single_source_data, 1),
    all_source_data: toBoolInt(all_source_data, 0),
    enable_websearch: toBoolInt(enable_websearch, 1),
    model_ladder_today,
    all_sources_confidence_repatch: toBoolInt(all_sources_confidence_repatch, 1),
    max_tokens: Math.max(256, Math.min(65536, Number.parseInt(String(max_tokens || 4096), 10) || 4096)),
    ...defaultContextFlagsForScope(scope),
    scalar_linked_send,
    component_values_send,
    list_values_send,
    llm_output_min_evidence_refs_required: Math.max(1, Math.min(5, Number.parseInt(String(llm_output_min_evidence_refs_required || 1), 10) || 1)),
    insufficient_evidence_action
  };
}

function buildDefaultLlmRoutes(category) {
  const rows = [];
  const push = (row) => rows.push(baseLlmRoute({ category, ...row, route_key: makeRouteKey(row.scope, row.required_level, row.difficulty, row.availability, toBand(row.effort), rows.length + 1) }));

  // Field-key extraction defaults (based on current matrix intent)
  push({ scope: 'field', required_level: 'identity', difficulty: 'hard', availability: 'always', effort: 10, model_ladder_today: 'gpt-5.2-xhigh -> gpt-5.2-high', single_source_data: 0, all_source_data: 1, enable_websearch: 1, max_tokens: 24576, llm_output_min_evidence_refs_required: 2 });
  push({ scope: 'field', required_level: 'critical', difficulty: 'hard', availability: 'rare', effort: 9, model_ladder_today: 'gpt-5.2-high -> gpt-5.1-high', single_source_data: 0, all_source_data: 1, enable_websearch: 1, max_tokens: 16384, llm_output_min_evidence_refs_required: 2 });
  push({ scope: 'field', required_level: 'required', difficulty: 'hard', availability: 'expected', effort: 8, model_ladder_today: 'gpt-5.2-high -> gpt-5.1-high', single_source_data: 0, all_source_data: 1, enable_websearch: 1, max_tokens: 12288, llm_output_min_evidence_refs_required: 2 });
  push({ scope: 'field', required_level: 'required', difficulty: 'medium', availability: 'expected', effort: 6, model_ladder_today: 'gpt-5.1-medium -> gpt-5.2-medium', single_source_data: 1, all_source_data: 1, enable_websearch: 1, max_tokens: 8192, llm_output_min_evidence_refs_required: 2 });
  push({ scope: 'field', required_level: 'expected', difficulty: 'hard', availability: 'sometimes', effort: 7, model_ladder_today: 'gpt-5.1-high -> gpt-5.2-medium', single_source_data: 1, all_source_data: 1, enable_websearch: 1, max_tokens: 8192 });
  push({ scope: 'field', required_level: 'expected', difficulty: 'medium', availability: 'expected', effort: 5, model_ladder_today: 'gpt-5-medium -> gpt-5.1-medium', single_source_data: 1, all_source_data: 0, enable_websearch: 0, max_tokens: 6144 });
  push({ scope: 'field', required_level: 'expected', difficulty: 'easy', availability: 'rare', effort: 3, model_ladder_today: 'gpt-5-low -> gpt-5-medium', single_source_data: 1, all_source_data: 1, enable_websearch: 1, max_tokens: 4096 });
  push({ scope: 'field', required_level: 'optional', difficulty: 'easy', availability: 'sometimes', effort: 2, model_ladder_today: 'gpt-5-minimal -> gpt-5-low', single_source_data: 1, all_source_data: 0, enable_websearch: 0, max_tokens: 3072 });
  push({ scope: 'field', required_level: 'editorial', difficulty: 'easy', availability: 'editorial_only', effort: 1, model_ladder_today: 'gpt-5-minimal -> gpt-5-low', single_source_data: 1, all_source_data: 0, enable_websearch: 0, max_tokens: 2048 });

  // Component full-review defaults (always send full component values at row/table level)
  push({ scope: 'component', required_level: 'critical', difficulty: 'hard', availability: 'expected', effort: 9, model_ladder_today: 'gpt-5.2-high -> gpt-5.2-medium', single_source_data: 1, all_source_data: 1, enable_websearch: 1, max_tokens: 16384, component_values_send: 'component values + prime sources', llm_output_min_evidence_refs_required: 2 });
  push({ scope: 'component', required_level: 'expected', difficulty: 'medium', availability: 'expected', effort: 6, model_ladder_today: 'gpt-5.1-medium -> gpt-5.2-medium', single_source_data: 1, all_source_data: 0, enable_websearch: 0, max_tokens: 8192, component_values_send: 'component values + prime sources' });
  push({ scope: 'component', required_level: 'optional', difficulty: 'easy', availability: 'sometimes', effort: 3, model_ladder_today: 'gpt-5-low -> gpt-5-medium', single_source_data: 1, all_source_data: 0, enable_websearch: 0, max_tokens: 4096, component_values_send: 'component values' });

  // List full-review defaults (always send full list values at list level)
  push({ scope: 'list', required_level: 'required', difficulty: 'hard', availability: 'rare', effort: 8, model_ladder_today: 'gpt-5.2-high -> gpt-5.1-high', single_source_data: 1, all_source_data: 1, enable_websearch: 1, max_tokens: 12288, list_values_send: 'list values prime sources', llm_output_min_evidence_refs_required: 2 });
  push({ scope: 'list', required_level: 'expected', difficulty: 'medium', availability: 'expected', effort: 5, model_ladder_today: 'gpt-5-medium -> gpt-5.1-medium', single_source_data: 1, all_source_data: 0, enable_websearch: 0, max_tokens: 6144, list_values_send: 'list values prime sources' });
  push({ scope: 'list', required_level: 'optional', difficulty: 'easy', availability: 'sometimes', effort: 2, model_ladder_today: 'gpt-5-minimal -> gpt-5-low', single_source_data: 1, all_source_data: 0, enable_websearch: 0, max_tokens: 3072, list_values_send: 'list values' });

  return rows;
}

export class SpecDb {
  constructor({ dbPath, category }) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(SCHEMA);
    this.category = category;

    // Idempotent ALTER TABLE migrations for Phase 1 columns
    const migrations = [
      `ALTER TABLE component_identity ADD COLUMN review_status TEXT DEFAULT 'pending'`,
      `ALTER TABLE component_identity ADD COLUMN aliases_overridden INTEGER DEFAULT 0`,
      `ALTER TABLE component_values ADD COLUMN constraints TEXT`,
      `ALTER TABLE component_values ADD COLUMN component_identity_id INTEGER REFERENCES component_identity(id)`,
      `ALTER TABLE list_values ADD COLUMN source_timestamp TEXT`,
      `ALTER TABLE list_values ADD COLUMN list_id INTEGER REFERENCES enum_lists(id)`,
      `ALTER TABLE source_assertions ADD COLUMN item_field_state_id INTEGER REFERENCES item_field_state(id)`,
      `ALTER TABLE source_assertions ADD COLUMN component_value_id INTEGER REFERENCES component_values(id)`,
      `ALTER TABLE source_assertions ADD COLUMN list_value_id INTEGER REFERENCES list_values(id)`,
      `ALTER TABLE source_assertions ADD COLUMN enum_list_id INTEGER REFERENCES enum_lists(id)`,
      `ALTER TABLE key_review_state ADD COLUMN item_field_state_id INTEGER REFERENCES item_field_state(id)`,
      `ALTER TABLE key_review_state ADD COLUMN component_value_id INTEGER REFERENCES component_values(id)`,
      `ALTER TABLE key_review_state ADD COLUMN component_identity_id INTEGER REFERENCES component_identity(id)`,
      `ALTER TABLE key_review_state ADD COLUMN list_value_id INTEGER REFERENCES list_values(id)`,
      `ALTER TABLE key_review_state ADD COLUMN enum_list_id INTEGER REFERENCES enum_lists(id)`,
      `ALTER TABLE llm_route_matrix ADD COLUMN enable_websearch INTEGER DEFAULT 1`,
    ];
    for (const sql of migrations) {
      try { this.db.exec(sql); } catch (e) {
        if (!e.message.includes('duplicate column')) throw e;
      }
    }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_cv_identity_id ON component_values(component_identity_id);
      CREATE INDEX IF NOT EXISTS idx_lv_list_id ON list_values(list_id);
      CREATE INDEX IF NOT EXISTS idx_sa_item_slot ON source_assertions(item_field_state_id);
      CREATE INDEX IF NOT EXISTS idx_sa_component_slot ON source_assertions(component_value_id);
      CREATE INDEX IF NOT EXISTS idx_sa_list_slot ON source_assertions(list_value_id, enum_list_id);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_krs_grid_slot ON key_review_state(category, item_field_state_id)
        WHERE target_kind = 'grid_key' AND item_field_state_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_krs_enum_slot ON key_review_state(category, list_value_id)
        WHERE target_kind = 'enum_key' AND list_value_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_krs_component_slot ON key_review_state(category, component_value_id)
        WHERE target_kind = 'component_key' AND component_value_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_krs_component_identity_slot ON key_review_state(category, component_identity_id, property_key)
        WHERE target_kind = 'component_key' AND component_identity_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_krs_item_slot ON key_review_state(item_field_state_id);
      CREATE INDEX IF NOT EXISTS idx_krs_component_slot ON key_review_state(component_value_id);
      CREATE INDEX IF NOT EXISTS idx_krs_component_identity_slot ON key_review_state(component_identity_id, property_key);
      CREATE INDEX IF NOT EXISTS idx_krs_list_slot ON key_review_state(list_value_id, enum_list_id);
    `);
    // Auto-prune legacy unscoped key_review_state rows from old fallback-era builds.
    this.cleanupLegacyIdentityFallbackRows();
    this.assertStrictIdentitySlotIntegrity();

    // Prepared statements
    this._insertCandidate = this.db.prepare(`
      INSERT OR REPLACE INTO candidates (
        candidate_id, category, product_id, field_key, value, normalized_value,
        score, rank, source_url, source_host, source_root_domain, source_tier,
        source_method, approved_domain, snippet_id, snippet_hash, snippet_text,
        quote, quote_span_start, quote_span_end, evidence_url, evidence_retrieved_at,
        is_component_field, component_type, is_list_field, llm_extract_model,
        extracted_at, run_id
      ) VALUES (
        @candidate_id, @category, @product_id, @field_key, @value, @normalized_value,
        @score, @rank, @source_url, @source_host, @source_root_domain, @source_tier,
        @source_method, @approved_domain, @snippet_id, @snippet_hash, @snippet_text,
        @quote, @quote_span_start, @quote_span_end, @evidence_url, @evidence_retrieved_at,
        @is_component_field, @component_type, @is_list_field, @llm_extract_model,
        @extracted_at, @run_id
      )
    `);

    this._upsertReview = this.db.prepare(`
      INSERT INTO candidate_reviews (
        candidate_id, context_type, context_id, human_accepted, human_accepted_at,
        ai_review_status, ai_confidence, ai_reason, ai_reviewed_at, ai_review_model,
        human_override_ai, human_override_ai_at
      ) VALUES (
        @candidate_id, @context_type, @context_id, @human_accepted, @human_accepted_at,
        @ai_review_status, @ai_confidence, @ai_reason, @ai_reviewed_at, @ai_review_model,
        @human_override_ai, @human_override_ai_at
      )
      ON CONFLICT(candidate_id, context_type, context_id) DO UPDATE SET
        human_accepted = excluded.human_accepted,
        human_accepted_at = COALESCE(excluded.human_accepted_at, human_accepted_at),
        ai_review_status = excluded.ai_review_status,
        ai_confidence = COALESCE(excluded.ai_confidence, ai_confidence),
        ai_reason = COALESCE(excluded.ai_reason, ai_reason),
        ai_reviewed_at = COALESCE(excluded.ai_reviewed_at, ai_reviewed_at),
        ai_review_model = COALESCE(excluded.ai_review_model, ai_review_model),
        human_override_ai = excluded.human_override_ai,
        human_override_ai_at = COALESCE(excluded.human_override_ai_at, human_override_ai_at),
        updated_at = datetime('now')
    `);

    this._upsertComponentIdentity = this.db.prepare(`
      INSERT INTO component_identity (category, component_type, canonical_name, maker, links, source)
      VALUES (@category, @component_type, @canonical_name, @maker, @links, @source)
      ON CONFLICT(category, component_type, canonical_name, maker) DO UPDATE SET
        links = COALESCE(excluded.links, links),
        source = excluded.source,
        updated_at = datetime('now')
    `);

    this._insertAlias = this.db.prepare(`
      INSERT INTO component_aliases (component_id, alias, source)
      VALUES (@component_id, @alias, @source)
      ON CONFLICT(component_id, alias) DO NOTHING
    `);

    this._upsertComponentValue = this.db.prepare(`
      INSERT INTO component_values (
        category, component_type, component_name, component_maker, component_identity_id, property_key,
        value, confidence, variance_policy, source, accepted_candidate_id,
        needs_review, overridden, constraints
      ) VALUES (
        @category, @component_type, @component_name, @component_maker, @component_identity_id, @property_key,
        @value, @confidence, @variance_policy, @source, @accepted_candidate_id,
        @needs_review, @overridden, @constraints
      )
      ON CONFLICT(category, component_type, component_name, component_maker, property_key) DO UPDATE SET
        component_identity_id = COALESCE(excluded.component_identity_id, component_identity_id),
        value = excluded.value,
        confidence = excluded.confidence,
        variance_policy = COALESCE(excluded.variance_policy, variance_policy),
        source = excluded.source,
        accepted_candidate_id = COALESCE(excluded.accepted_candidate_id, accepted_candidate_id),
        needs_review = excluded.needs_review,
        overridden = excluded.overridden,
        constraints = COALESCE(excluded.constraints, constraints),
        updated_at = datetime('now')
    `);

    this._upsertEnumList = this.db.prepare(`
      INSERT INTO enum_lists (category, field_key, source)
      VALUES (@category, @field_key, @source)
      ON CONFLICT(category, field_key) DO UPDATE SET
        source = COALESCE(excluded.source, source),
        updated_at = datetime('now')
    `);

    this._upsertListValue = this.db.prepare(`
      INSERT INTO list_values (
        category, list_id, field_key, value, normalized_value, source,
        accepted_candidate_id, enum_policy, needs_review, overridden, source_timestamp
      ) VALUES (
        @category, @list_id, @field_key, @value, @normalized_value, @source,
        @accepted_candidate_id, @enum_policy, @needs_review, @overridden, @source_timestamp
      )
      ON CONFLICT(category, field_key, value) DO UPDATE SET
        list_id = COALESCE(excluded.list_id, list_id),
        normalized_value = COALESCE(excluded.normalized_value, normalized_value),
        source = excluded.source,
        accepted_candidate_id = COALESCE(excluded.accepted_candidate_id, accepted_candidate_id),
        enum_policy = COALESCE(excluded.enum_policy, enum_policy),
        needs_review = excluded.needs_review,
        overridden = excluded.overridden,
        source_timestamp = COALESCE(excluded.source_timestamp, source_timestamp),
        updated_at = datetime('now')
    `);

    this._upsertItemFieldState = this.db.prepare(`
      INSERT INTO item_field_state (
        category, product_id, field_key, value, confidence, source,
        accepted_candidate_id, overridden, needs_ai_review, ai_review_complete
      ) VALUES (
        @category, @product_id, @field_key, @value, @confidence, @source,
        @accepted_candidate_id, @overridden, @needs_ai_review, @ai_review_complete
      )
      ON CONFLICT(category, product_id, field_key) DO UPDATE SET
        value = excluded.value,
        confidence = excluded.confidence,
        source = excluded.source,
        accepted_candidate_id = COALESCE(excluded.accepted_candidate_id, accepted_candidate_id),
        overridden = excluded.overridden,
        needs_ai_review = excluded.needs_ai_review,
        ai_review_complete = excluded.ai_review_complete,
        updated_at = datetime('now')
    `);

    this._upsertItemComponentLink = this.db.prepare(`
      INSERT INTO item_component_links (
        category, product_id, field_key, component_type, component_name,
        component_maker, match_type, match_score
      ) VALUES (
        @category, @product_id, @field_key, @component_type, @component_name,
        @component_maker, @match_type, @match_score
      )
      ON CONFLICT(category, product_id, field_key) DO UPDATE SET
        component_type = excluded.component_type,
        component_name = excluded.component_name,
        component_maker = COALESCE(excluded.component_maker, component_maker),
        match_type = excluded.match_type,
        match_score = excluded.match_score,
        updated_at = datetime('now')
    `);

    this._upsertItemListLink = this.db.prepare(`
      INSERT INTO item_list_links (category, product_id, field_key, list_value_id)
      VALUES (@category, @product_id, @field_key, @list_value_id)
      ON CONFLICT(category, product_id, field_key, list_value_id) DO NOTHING
    `);

    // Phase 2 prepared statements
    this._upsertQueueProduct = this.db.prepare(`
      INSERT INTO product_queue (
        category, product_id, s3key, status, priority,
        attempts_total, retry_count, max_attempts, next_retry_at, last_run_id,
        cost_usd_total, rounds_completed, next_action_hint, last_urls_attempted,
        last_error, last_started_at, last_completed_at, dirty_flags, last_summary
      ) VALUES (
        @category, @product_id, @s3key, @status, @priority,
        @attempts_total, @retry_count, @max_attempts, @next_retry_at, @last_run_id,
        @cost_usd_total, @rounds_completed, @next_action_hint, @last_urls_attempted,
        @last_error, @last_started_at, @last_completed_at, @dirty_flags, @last_summary
      )
      ON CONFLICT(category, product_id) DO UPDATE SET
        s3key = COALESCE(excluded.s3key, s3key),
        status = excluded.status,
        priority = excluded.priority,
        attempts_total = excluded.attempts_total,
        retry_count = excluded.retry_count,
        max_attempts = excluded.max_attempts,
        next_retry_at = excluded.next_retry_at,
        last_run_id = COALESCE(excluded.last_run_id, last_run_id),
        cost_usd_total = excluded.cost_usd_total,
        rounds_completed = excluded.rounds_completed,
        next_action_hint = excluded.next_action_hint,
        last_urls_attempted = excluded.last_urls_attempted,
        last_error = excluded.last_error,
        last_started_at = excluded.last_started_at,
        last_completed_at = excluded.last_completed_at,
        dirty_flags = excluded.dirty_flags,
        last_summary = excluded.last_summary,
        updated_at = datetime('now')
    `);

    this._upsertProductRun = this.db.prepare(`
      INSERT INTO product_runs (
        category, product_id, run_id, is_latest, summary_json,
        validated, confidence, cost_usd_run, sources_attempted, run_at
      ) VALUES (
        @category, @product_id, @run_id, @is_latest, @summary_json,
        @validated, @confidence, @cost_usd_run, @sources_attempted, @run_at
      )
      ON CONFLICT(category, product_id, run_id) DO UPDATE SET
        is_latest = excluded.is_latest,
        summary_json = COALESCE(excluded.summary_json, summary_json),
        validated = excluded.validated,
        confidence = excluded.confidence,
        cost_usd_run = excluded.cost_usd_run,
        sources_attempted = excluded.sources_attempted,
        run_at = excluded.run_at
    `);

    this._upsertProduct = this.db.prepare(`
      INSERT INTO products (
        category, product_id, brand, model, variant, status, seed_urls, identifier
      ) VALUES (
        @category, @product_id, @brand, @model, @variant, @status, @seed_urls, @identifier
      )
      ON CONFLICT(category, product_id) DO UPDATE SET
        brand = COALESCE(excluded.brand, brand),
        model = COALESCE(excluded.model, model),
        variant = COALESCE(excluded.variant, variant),
        status = excluded.status,
        seed_urls = COALESCE(excluded.seed_urls, seed_urls),
        identifier = COALESCE(excluded.identifier, identifier),
        updated_at = datetime('now')
    `);

    this._upsertLlmRoute = this.db.prepare(`
      INSERT INTO llm_route_matrix (
        category, scope, route_key, required_level, difficulty, availability, effort, effort_band,
        single_source_data, all_source_data, enable_websearch, model_ladder_today, all_sources_confidence_repatch, max_tokens,
        studio_key_navigation_sent_in_extract_review,
        studio_contract_rules_sent_in_extract_review,
        studio_extraction_guidance_sent_in_extract_review,
        studio_tooltip_or_description_sent_when_present,
        studio_enum_options_sent_when_present,
        studio_component_variance_constraints_sent_in_component_review,
        studio_parse_template_sent_direct_in_extract_review,
        studio_ai_mode_difficulty_effort_sent_direct_in_extract_review,
        studio_required_level_sent_in_extract_review,
        studio_component_entity_set_sent_when_component_field,
        studio_evidence_policy_sent_direct_in_extract_review,
        studio_variance_policy_sent_in_component_review,
        studio_constraints_sent_in_component_review,
        studio_send_booleans_prompted_to_model,
        scalar_linked_send, component_values_send, list_values_send,
        llm_output_min_evidence_refs_required, insufficient_evidence_action
      ) VALUES (
        @category, @scope, @route_key, @required_level, @difficulty, @availability, @effort, @effort_band,
        @single_source_data, @all_source_data, @enable_websearch, @model_ladder_today, @all_sources_confidence_repatch, @max_tokens,
        @studio_key_navigation_sent_in_extract_review,
        @studio_contract_rules_sent_in_extract_review,
        @studio_extraction_guidance_sent_in_extract_review,
        @studio_tooltip_or_description_sent_when_present,
        @studio_enum_options_sent_when_present,
        @studio_component_variance_constraints_sent_in_component_review,
        @studio_parse_template_sent_direct_in_extract_review,
        @studio_ai_mode_difficulty_effort_sent_direct_in_extract_review,
        @studio_required_level_sent_in_extract_review,
        @studio_component_entity_set_sent_when_component_field,
        @studio_evidence_policy_sent_direct_in_extract_review,
        @studio_variance_policy_sent_in_component_review,
        @studio_constraints_sent_in_component_review,
        @studio_send_booleans_prompted_to_model,
        @scalar_linked_send, @component_values_send, @list_values_send,
        @llm_output_min_evidence_refs_required, @insufficient_evidence_action
      )
      ON CONFLICT(category, route_key) DO UPDATE SET
        scope = excluded.scope,
        required_level = excluded.required_level,
        difficulty = excluded.difficulty,
        availability = excluded.availability,
        effort = excluded.effort,
        effort_band = excluded.effort_band,
        single_source_data = excluded.single_source_data,
        all_source_data = excluded.all_source_data,
        enable_websearch = excluded.enable_websearch,
        model_ladder_today = excluded.model_ladder_today,
        all_sources_confidence_repatch = excluded.all_sources_confidence_repatch,
        max_tokens = excluded.max_tokens,
        studio_key_navigation_sent_in_extract_review = excluded.studio_key_navigation_sent_in_extract_review,
        studio_contract_rules_sent_in_extract_review = excluded.studio_contract_rules_sent_in_extract_review,
        studio_extraction_guidance_sent_in_extract_review = excluded.studio_extraction_guidance_sent_in_extract_review,
        studio_tooltip_or_description_sent_when_present = excluded.studio_tooltip_or_description_sent_when_present,
        studio_enum_options_sent_when_present = excluded.studio_enum_options_sent_when_present,
        studio_component_variance_constraints_sent_in_component_review = excluded.studio_component_variance_constraints_sent_in_component_review,
        studio_parse_template_sent_direct_in_extract_review = excluded.studio_parse_template_sent_direct_in_extract_review,
        studio_ai_mode_difficulty_effort_sent_direct_in_extract_review = excluded.studio_ai_mode_difficulty_effort_sent_direct_in_extract_review,
        studio_required_level_sent_in_extract_review = excluded.studio_required_level_sent_in_extract_review,
        studio_component_entity_set_sent_when_component_field = excluded.studio_component_entity_set_sent_when_component_field,
        studio_evidence_policy_sent_direct_in_extract_review = excluded.studio_evidence_policy_sent_direct_in_extract_review,
        studio_variance_policy_sent_in_component_review = excluded.studio_variance_policy_sent_in_component_review,
        studio_constraints_sent_in_component_review = excluded.studio_constraints_sent_in_component_review,
        studio_send_booleans_prompted_to_model = excluded.studio_send_booleans_prompted_to_model,
        scalar_linked_send = excluded.scalar_linked_send,
        component_values_send = excluded.component_values_send,
        list_values_send = excluded.list_values_send,
        llm_output_min_evidence_refs_required = excluded.llm_output_min_evidence_refs_required,
        insufficient_evidence_action = excluded.insufficient_evidence_action,
        updated_at = datetime('now')
    `);

    // Source capture prepared statements
    this._upsertSourceRegistry = this.db.prepare(`
      INSERT INTO source_registry (
        source_id, category, item_identifier, product_id, run_id, source_url,
        source_host, source_root_domain, source_tier, source_method,
        crawl_status, http_status, fetched_at
      ) VALUES (
        @source_id, @category, @item_identifier, @product_id, @run_id, @source_url,
        @source_host, @source_root_domain, @source_tier, @source_method,
        @crawl_status, @http_status, @fetched_at
      )
      ON CONFLICT(source_id) DO UPDATE SET
        source_url = excluded.source_url,
        source_host = COALESCE(excluded.source_host, source_host),
        source_root_domain = COALESCE(excluded.source_root_domain, source_root_domain),
        source_tier = COALESCE(excluded.source_tier, source_tier),
        source_method = COALESCE(excluded.source_method, source_method),
        crawl_status = COALESCE(excluded.crawl_status, crawl_status),
        http_status = COALESCE(excluded.http_status, http_status),
        fetched_at = COALESCE(excluded.fetched_at, fetched_at),
        updated_at = datetime('now')
    `);

    this._insertSourceArtifact = this.db.prepare(`
      INSERT INTO source_artifacts (
        source_id, artifact_type, local_path, content_hash, mime_type, size_bytes
      ) VALUES (
        @source_id, @artifact_type, @local_path, @content_hash, @mime_type, @size_bytes
      )
    `);

    this._upsertSourceAssertion = this.db.prepare(`
      INSERT INTO source_assertions (
        assertion_id, source_id, field_key, context_kind, context_ref,
        item_field_state_id, component_value_id, list_value_id, enum_list_id,
        value_raw, value_normalized, unit, candidate_id, extraction_method
      ) VALUES (
        @assertion_id, @source_id, @field_key, @context_kind, @context_ref,
        @item_field_state_id, @component_value_id, @list_value_id, @enum_list_id,
        @value_raw, @value_normalized, @unit, @candidate_id, @extraction_method
      )
      ON CONFLICT(assertion_id) DO UPDATE SET
        item_field_state_id = COALESCE(excluded.item_field_state_id, item_field_state_id),
        component_value_id = COALESCE(excluded.component_value_id, component_value_id),
        list_value_id = COALESCE(excluded.list_value_id, list_value_id),
        enum_list_id = COALESCE(excluded.enum_list_id, enum_list_id),
        value_raw = COALESCE(excluded.value_raw, value_raw),
        value_normalized = COALESCE(excluded.value_normalized, value_normalized),
        unit = COALESCE(excluded.unit, unit),
        extraction_method = COALESCE(excluded.extraction_method, extraction_method),
        updated_at = datetime('now')
    `);

    this._insertSourceEvidenceRef = this.db.prepare(`
      INSERT INTO source_evidence_refs (
        assertion_id, evidence_url, snippet_id, quote, method, tier, retrieved_at
      ) VALUES (
        @assertion_id, @evidence_url, @snippet_id, @quote, @method, @tier, @retrieved_at
      )
    `);

    // Key review prepared statements
    this._insertKeyReviewState = this.db.prepare(`
      INSERT INTO key_review_state (
        category, target_kind, item_identifier, field_key, enum_value_norm,
        component_identifier, property_key,
        item_field_state_id, component_value_id, component_identity_id, list_value_id, enum_list_id,
        required_level, availability, difficulty, effort, ai_mode, parse_template,
        evidence_policy, min_evidence_refs_effective, min_distinct_sources_required,
        send_mode, component_send_mode, list_send_mode,
        selected_value, selected_candidate_id, confidence_score, confidence_level,
        flagged_at, resolved_at,
        ai_confirm_primary_status, ai_confirm_primary_confidence, ai_confirm_primary_at,
        ai_confirm_primary_interrupted, ai_confirm_primary_error,
        ai_confirm_shared_status, ai_confirm_shared_confidence, ai_confirm_shared_at,
        ai_confirm_shared_interrupted, ai_confirm_shared_error,
        user_accept_primary_status, user_accept_primary_at, user_accept_primary_by,
        user_accept_shared_status, user_accept_shared_at, user_accept_shared_by,
        user_override_ai_primary, user_override_ai_primary_at, user_override_ai_primary_reason,
        user_override_ai_shared, user_override_ai_shared_at, user_override_ai_shared_reason
      ) VALUES (
        @category, @target_kind, @item_identifier, @field_key, @enum_value_norm,
        @component_identifier, @property_key,
        @item_field_state_id, @component_value_id, @component_identity_id, @list_value_id, @enum_list_id,
        @required_level, @availability, @difficulty, @effort, @ai_mode, @parse_template,
        @evidence_policy, @min_evidence_refs_effective, @min_distinct_sources_required,
        @send_mode, @component_send_mode, @list_send_mode,
        @selected_value, @selected_candidate_id, @confidence_score, @confidence_level,
        @flagged_at, @resolved_at,
        @ai_confirm_primary_status, @ai_confirm_primary_confidence, @ai_confirm_primary_at,
        @ai_confirm_primary_interrupted, @ai_confirm_primary_error,
        @ai_confirm_shared_status, @ai_confirm_shared_confidence, @ai_confirm_shared_at,
        @ai_confirm_shared_interrupted, @ai_confirm_shared_error,
        @user_accept_primary_status, @user_accept_primary_at, @user_accept_primary_by,
        @user_accept_shared_status, @user_accept_shared_at, @user_accept_shared_by,
        @user_override_ai_primary, @user_override_ai_primary_at, @user_override_ai_primary_reason,
        @user_override_ai_shared, @user_override_ai_shared_at, @user_override_ai_shared_reason
      )
    `);

    this._insertKeyReviewRun = this.db.prepare(`
      INSERT INTO key_review_runs (
        key_review_state_id, stage, status, provider, model_used, prompt_hash,
        response_schema_version, input_tokens, output_tokens, latency_ms,
        cost_usd, error, started_at, finished_at
      ) VALUES (
        @key_review_state_id, @stage, @status, @provider, @model_used, @prompt_hash,
        @response_schema_version, @input_tokens, @output_tokens, @latency_ms,
        @cost_usd, @error, @started_at, @finished_at
      )
    `);

    this._insertKeyReviewRunSource = this.db.prepare(`
      INSERT INTO key_review_run_sources (
        key_review_run_id, assertion_id, packet_role, position
      ) VALUES (
        @key_review_run_id, @assertion_id, @packet_role, @position
      )
    `);

    this._insertKeyReviewAudit = this.db.prepare(`
      INSERT INTO key_review_audit (
        key_review_state_id, event_type, actor_type, actor_id,
        old_value, new_value, reason
      ) VALUES (
        @key_review_state_id, @event_type, @actor_type, @actor_id,
        @old_value, @new_value, @reason
      )
    `);

    // Migration prepared statements

    this._insertBillingEntry = this.db.prepare(`
      INSERT INTO billing_entries (
        ts, month, day, provider, model, category, product_id, run_id, round,
        prompt_tokens, completion_tokens, cached_prompt_tokens, total_tokens,
        cost_usd, reason, host, url_count, evidence_chars, estimated_usage, meta
      ) VALUES (
        @ts, @month, @day, @provider, @model, @category, @product_id, @run_id, @round,
        @prompt_tokens, @completion_tokens, @cached_prompt_tokens, @total_tokens,
        @cost_usd, @reason, @host, @url_count, @evidence_chars, @estimated_usage, @meta
      )
    `);

    this._upsertLlmCache = this.db.prepare(`
      INSERT OR REPLACE INTO llm_cache (cache_key, response, timestamp, ttl)
      VALUES (@cache_key, @response, @timestamp, @ttl)
    `);

    this._getLlmCache = this.db.prepare(
      'SELECT response, timestamp, ttl FROM llm_cache WHERE cache_key = ?'
    );

    this._evictExpiredCache = this.db.prepare(
      'DELETE FROM llm_cache WHERE (timestamp + ttl) < ?'
    );

    this._upsertLearningProfile = this.db.prepare(`
      INSERT OR REPLACE INTO learning_profiles (
        profile_id, category, brand, model, variant,
        runs_total, validated_runs, validated,
        unknown_field_rate, unknown_field_rate_avg, parser_health_avg,
        preferred_urls, feedback_urls, uncertain_fields,
        host_stats, critical_fields_below, last_run, parser_health, updated_at
      ) VALUES (
        @profile_id, @category, @brand, @model, @variant,
        @runs_total, @validated_runs, @validated,
        @unknown_field_rate, @unknown_field_rate_avg, @parser_health_avg,
        @preferred_urls, @feedback_urls, @uncertain_fields,
        @host_stats, @critical_fields_below, @last_run, @parser_health, @updated_at
      )
    `);

    this._upsertCategoryBrain = this.db.prepare(`
      INSERT OR REPLACE INTO category_brain (category, artifact_name, payload, updated_at)
      VALUES (@category, @artifact_name, @payload, @updated_at)
    `);

    this._upsertSourceCorpus = this.db.prepare(`
      INSERT OR REPLACE INTO source_corpus (
        url, category, host, root_domain, path, title, snippet, tier, role,
        fields, methods, identity_match, approved_domain, brand, model_name, variant,
        first_seen_at, last_seen_at
      ) VALUES (
        @url, @category, @host, @root_domain, @path, @title, @snippet, @tier, @role,
        @fields, @methods, @identity_match, @approved_domain, @brand, @model_name, @variant,
        @first_seen_at, @last_seen_at
      )
    `);

    this._insertRuntimeEvent = this.db.prepare(`
      INSERT INTO runtime_events (ts, level, event, category, product_id, run_id, data)
      VALUES (@ts, @level, @event, @category, @product_id, @run_id, @data)
    `);
  }

  cleanupLegacyIdentityFallbackRows() {
    const rows = this.db.prepare(`
      SELECT id
      FROM key_review_state
      WHERE
        (target_kind = 'grid_key' AND item_field_state_id IS NULL)
        OR (
          target_kind = 'component_key'
          AND component_value_id IS NULL
          AND (
            component_identity_id IS NULL
            OR TRIM(COALESCE(property_key, '')) = ''
          )
        )
        OR (target_kind = 'enum_key' AND list_value_id IS NULL)
    `).all();
    const ids = rows
      .map((row) => Number.parseInt(String(row?.id ?? ''), 10))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (ids.length === 0) return 0;

    const placeholders = ids.map(() => '?').join(',');
    const tx = this.db.transaction((targetIds) => {
      this.db.prepare(`
        DELETE FROM key_review_run_sources
        WHERE key_review_run_id IN (
          SELECT run_id
          FROM key_review_runs
          WHERE key_review_state_id IN (${placeholders})
        )
      `).run(...targetIds);
      this.db.prepare(
        `DELETE FROM key_review_runs WHERE key_review_state_id IN (${placeholders})`
      ).run(...targetIds);
      this.db.prepare(
        `DELETE FROM key_review_audit WHERE key_review_state_id IN (${placeholders})`
      ).run(...targetIds);
      this.db.prepare(
        `DELETE FROM key_review_state WHERE id IN (${placeholders})`
      ).run(...targetIds);
    });
    tx(ids);
    return ids.length;
  }

  assertStrictIdentitySlotIntegrity() {
    const issues = [];
    const unresolvedComponentIdentities = Number(this.db.prepare(`
      SELECT COUNT(*) AS c
      FROM component_values
      WHERE component_identity_id IS NULL
    `).get()?.c || 0);
    if (unresolvedComponentIdentities > 0) {
      issues.push(`component_values missing component_identity_id: ${unresolvedComponentIdentities}`);
    }

    const unresolvedListOwnership = Number(this.db.prepare(`
      SELECT COUNT(*) AS c
      FROM list_values
      WHERE list_id IS NULL
    `).get()?.c || 0);
    if (unresolvedListOwnership > 0) {
      issues.push(`list_values missing list_id: ${unresolvedListOwnership}`);
    }

    const unresolvedGridSlots = Number(this.db.prepare(`
      SELECT COUNT(*) AS c
      FROM key_review_state
      WHERE target_kind = 'grid_key'
        AND item_field_state_id IS NULL
    `).get()?.c || 0);
    if (unresolvedGridSlots > 0) {
      issues.push(`grid key_review_state rows missing item_field_state_id: ${unresolvedGridSlots}`);
    }

    const unresolvedComponentSlots = Number(this.db.prepare(`
      SELECT COUNT(*) AS c
      FROM key_review_state
      WHERE target_kind = 'component_key'
        AND component_value_id IS NULL
        AND (
          component_identity_id IS NULL
          OR TRIM(COALESCE(property_key, '')) = ''
        )
    `).get()?.c || 0);
    if (unresolvedComponentSlots > 0) {
      issues.push(`component key_review_state rows missing slot identity: ${unresolvedComponentSlots}`);
    }

    const unresolvedEnumSlots = Number(this.db.prepare(`
      SELECT COUNT(*) AS c
      FROM key_review_state
      WHERE target_kind = 'enum_key'
        AND list_value_id IS NULL
    `).get()?.c || 0);
    if (unresolvedEnumSlots > 0) {
      issues.push(`enum key_review_state rows missing list_value_id: ${unresolvedEnumSlots}`);
    }

    if (issues.length > 0) {
      throw new Error(
        `Legacy review identity fallback data detected. Use an explicit migration/wipe before startup. ${issues.join('; ')}`
      );
    }
  }

  close() {
    this.db.close();
  }

  // --- Brand Domains ---

  getBrandDomain(brand, category) {
    return this.db.prepare(
      'SELECT * FROM brand_domains WHERE brand = ? AND category = ?'
    ).get(brand, category) || null;
  }

  upsertBrandDomain(row) {
    this.db.prepare(`
      INSERT OR REPLACE INTO brand_domains (brand, category, official_domain, aliases, support_domain, confidence)
      VALUES (@brand, @category, @official_domain, @aliases, @support_domain, @confidence)
    `).run({
      brand: row.brand,
      category: row.category,
      official_domain: row.official_domain || null,
      aliases: row.aliases || '[]',
      support_domain: row.support_domain || null,
      confidence: row.confidence ?? 0.8
    });
  }

  // --- Domain Classifications ---

  getDomainClassification(domain) {
    return this.db.prepare(
      'SELECT * FROM domain_classifications WHERE domain = ?'
    ).get(domain) || null;
  }

  upsertDomainClassification(row) {
    this.db.prepare(`
      INSERT OR REPLACE INTO domain_classifications (domain, classification, safe, reason)
      VALUES (@domain, @classification, @safe, @reason)
    `).run({
      domain: row.domain,
      classification: row.classification,
      safe: row.safe ?? 1,
      reason: row.reason || null
    });
  }

  // --- Source Strategy ---

  listSourceStrategies() {
    return this.db.prepare('SELECT * FROM source_strategy ORDER BY priority DESC').all();
  }

  listEnabledSourceStrategies(categoryScope) {
    if (categoryScope) {
      return this.db.prepare(
        "SELECT * FROM source_strategy WHERE enabled = 1 AND (category_scope IS NULL OR category_scope = '' OR category_scope = ?) ORDER BY priority DESC"
      ).all(categoryScope);
    }
    return this.db.prepare('SELECT * FROM source_strategy WHERE enabled = 1 ORDER BY priority DESC').all();
  }

  getSourceStrategy(id) {
    return this.db.prepare('SELECT * FROM source_strategy WHERE id = ?').get(id) || null;
  }

  insertSourceStrategy(row) {
    const result = this.db.prepare(`
      INSERT INTO source_strategy (host, display_name, source_type, default_tier, discovery_method, search_pattern, priority, enabled, category_scope, notes)
      VALUES (@host, @display_name, @source_type, @default_tier, @discovery_method, @search_pattern, @priority, @enabled, @category_scope, @notes)
    `).run({
      host: row.host,
      display_name: row.display_name || row.host,
      source_type: row.source_type || 'lab_review',
      default_tier: row.default_tier ?? 2,
      discovery_method: row.discovery_method || 'search_first',
      search_pattern: row.search_pattern || null,
      priority: row.priority ?? 50,
      enabled: row.enabled ?? 1,
      category_scope: row.category_scope || null,
      notes: row.notes || null
    });
    return { id: result.lastInsertRowid };
  }

  updateSourceStrategy(id, updates) {
    const existing = this.getSourceStrategy(id);
    if (!existing) return null;
    this.db.prepare(`
      UPDATE source_strategy SET
        host = @host, display_name = @display_name, source_type = @source_type,
        default_tier = @default_tier, discovery_method = @discovery_method,
        search_pattern = @search_pattern, priority = @priority, enabled = @enabled,
        category_scope = @category_scope, notes = @notes, updated_at = datetime('now')
      WHERE id = @id
    `).run({
      id,
      host: updates.host ?? existing.host,
      display_name: updates.display_name ?? existing.display_name,
      source_type: updates.source_type ?? existing.source_type,
      default_tier: updates.default_tier ?? existing.default_tier,
      discovery_method: updates.discovery_method ?? existing.discovery_method,
      search_pattern: updates.search_pattern ?? existing.search_pattern,
      priority: updates.priority ?? existing.priority,
      enabled: updates.enabled ?? existing.enabled,
      category_scope: updates.category_scope ?? existing.category_scope,
      notes: updates.notes ?? existing.notes
    });
    return this.getSourceStrategy(id);
  }

  deleteSourceStrategy(id) {
    return this.db.prepare('DELETE FROM source_strategy WHERE id = ?').run(id);
  }

  // --- Candidates ---

  insertCandidate(row) {
    const params = {
      candidate_id: row.candidate_id || '',
      category: row.category || this.category,
      product_id: row.product_id || '',
      field_key: row.field_key || '',
      value: row.value ?? null,
      normalized_value: row.normalized_value ?? null,
      score: row.score ?? 0,
      rank: row.rank ?? null,
      source_url: row.source_url ?? null,
      source_host: row.source_host ?? null,
      source_root_domain: row.source_root_domain ?? null,
      source_tier: row.source_tier ?? null,
      source_method: row.source_method ?? null,
      approved_domain: row.approved_domain ? 1 : 0,
      snippet_id: row.snippet_id ?? null,
      snippet_hash: row.snippet_hash ?? null,
      snippet_text: row.snippet_text ?? null,
      quote: row.quote ?? null,
      quote_span_start: row.quote_span_start ?? null,
      quote_span_end: row.quote_span_end ?? null,
      evidence_url: row.evidence_url ?? null,
      evidence_retrieved_at: row.evidence_retrieved_at ?? null,
      is_component_field: row.is_component_field ? 1 : 0,
      component_type: row.component_type ?? null,
      is_list_field: row.is_list_field ? 1 : 0,
      llm_extract_model: row.llm_extract_model ?? null,
      extracted_at: row.extracted_at || new Date().toISOString(),
      run_id: row.run_id ?? null
    };
    this._insertCandidate.run(params);
    return params;
  }

  insertCandidatesBatch(rows) {
    const tx = this.db.transaction((items) => {
      for (const row of items) {
        this.insertCandidate(row);
      }
    });
    tx(rows);
  }

  getCandidatesForField(productId, fieldKey) {
    return this.db
      .prepare('SELECT * FROM candidates WHERE product_id = ? AND field_key = ? ORDER BY score DESC, rank ASC')
      .all(productId, fieldKey);
  }

  getCandidatesForProduct(productId) {
    const rows = this.db
      .prepare('SELECT * FROM candidates WHERE product_id = ? ORDER BY field_key, score DESC, rank ASC')
      .all(productId);
    const grouped = {};
    for (const row of rows) {
      if (!grouped[row.field_key]) grouped[row.field_key] = [];
      grouped[row.field_key].push(row);
    }
    return grouped;
  }

  getCandidateById(candidateId) {
    const key = String(candidateId || '').trim();
    if (!key) return null;
    return this.db
      .prepare('SELECT * FROM candidates WHERE candidate_id = ?')
      .get(key) || null;
  }

  // --- Reviews ---

  upsertReview({ candidateId, contextType, contextId, humanAccepted, humanAcceptedAt, aiReviewStatus, aiConfidence, aiReason, aiReviewedAt, aiReviewModel, humanOverrideAi, humanOverrideAiAt }) {
    this._upsertReview.run({
      candidate_id: candidateId,
      context_type: contextType,
      context_id: contextId,
      human_accepted: humanAccepted ? 1 : 0,
      human_accepted_at: humanAcceptedAt ?? null,
      ai_review_status: aiReviewStatus || 'not_run',
      ai_confidence: aiConfidence ?? null,
      ai_reason: aiReason ?? null,
      ai_reviewed_at: aiReviewedAt ?? null,
      ai_review_model: aiReviewModel ?? null,
      human_override_ai: humanOverrideAi ? 1 : 0,
      human_override_ai_at: humanOverrideAiAt ?? null
    });
  }

  getReviewsForCandidate(candidateId) {
    const key = String(candidateId || '').trim();
    if (!key) return [];
    return this.db
      .prepare('SELECT * FROM candidate_reviews WHERE candidate_id = ?')
      .all(key);
  }

  getReviewsForContext(contextType, contextId) {
    return this.db
      .prepare('SELECT * FROM candidate_reviews WHERE context_type = ? AND context_id = ?')
      .all(contextType, contextId);
  }

  // --- Components ---

  upsertComponentIdentity({ componentType, canonicalName, maker, links, source }) {
    this._upsertComponentIdentity.run({
      category: this.category,
      component_type: componentType,
      canonical_name: canonicalName,
      maker: maker || '',
      links: Array.isArray(links) ? JSON.stringify(links) : (links ?? null),
      source: source || 'component_db'
    });
    return this.db
      .prepare('SELECT id FROM component_identity WHERE category = ? AND component_type = ? AND canonical_name = ? AND maker = ?')
      .get(this.category, componentType, canonicalName, maker || '') || null;
  }

  insertAlias(componentId, alias, source) {
    this._insertAlias.run({
      component_id: componentId,
      alias,
      source: source || 'component_db'
    });
  }

  upsertComponentValue({
    componentType,
    componentName,
    componentMaker,
    componentIdentityId,
    propertyKey,
    value,
    confidence,
    variancePolicy,
    source,
    acceptedCandidateId,
    needsReview,
    overridden,
    constraints,
  }) {
    const normalizedMaker = componentMaker || '';
    const resolvedIdentityId = Number(componentIdentityId) > 0
      ? Number(componentIdentityId)
      : (this.upsertComponentIdentity({
        componentType,
        canonicalName: componentName,
        maker: normalizedMaker,
        links: null,
        source: source || 'component_db',
      })?.id ?? null);
    this._upsertComponentValue.run({
      category: this.category,
      component_type: componentType,
      component_name: componentName,
      component_maker: normalizedMaker,
      component_identity_id: resolvedIdentityId,
      property_key: propertyKey,
      value: value != null ? String(value) : null,
      confidence: confidence ?? 1.0,
      variance_policy: variancePolicy ?? null,
      source: source || 'component_db',
      accepted_candidate_id: acceptedCandidateId ?? null,
      needs_review: needsReview ? 1 : 0,
      overridden: overridden ? 1 : 0,
      constraints: Array.isArray(constraints) ? JSON.stringify(constraints) : (constraints ?? null)
    });
  }

  getComponentValues(componentType, componentName) {
    return this.db
      .prepare('SELECT * FROM component_values WHERE category = ? AND component_type = ? AND component_name = ?')
      .all(this.category, componentType, componentName);
  }

  getAllComponentIdentities(componentType) {
    return this.db
      .prepare('SELECT * FROM component_identity WHERE category = ? AND component_type = ?')
      .all(this.category, componentType);
  }

  getComponentIdentity(componentType, canonicalName, maker = '') {
    return this.db
      .prepare('SELECT * FROM component_identity WHERE category = ? AND component_type = ? AND canonical_name = ? AND maker = ?')
      .get(this.category, componentType, canonicalName, maker || '') || null;
  }

  getComponentIdentityById(identityId) {
    const id = Number(identityId);
    if (!Number.isFinite(id) || id <= 0) return null;
    return this.db
      .prepare('SELECT * FROM component_identity WHERE category = ? AND id = ?')
      .get(this.category, id) || null;
  }

  findComponentByAlias(componentType, alias) {
    return this.db.prepare(`
      SELECT ci.* FROM component_identity ci
      JOIN component_aliases ca ON ca.component_id = ci.id
      WHERE ci.category = ? AND ci.component_type = ? AND ca.alias = ?
    `).get(this.category, componentType, alias) || null;
  }

  // --- Lists ---

  backfillComponentIdentityIds() {
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO component_identity (category, component_type, canonical_name, maker, source)
        SELECT DISTINCT
          cv.category,
          cv.component_type,
          cv.component_name,
          COALESCE(cv.component_maker, ''),
          COALESCE(NULLIF(cv.source, ''), 'backfill')
        FROM component_values cv
        LEFT JOIN component_identity ci
          ON ci.category = cv.category
         AND ci.component_type = cv.component_type
         AND ci.canonical_name = cv.component_name
         AND ci.maker = COALESCE(cv.component_maker, '')
        WHERE ci.id IS NULL
        ON CONFLICT(category, component_type, canonical_name, maker) DO NOTHING
      `).run();

      this.db.prepare(`
        UPDATE component_values
        SET component_identity_id = (
          SELECT ci.id
          FROM component_identity ci
          WHERE ci.category = component_values.category
            AND ci.component_type = component_values.component_type
            AND ci.canonical_name = component_values.component_name
            AND ci.maker = COALESCE(component_values.component_maker, '')
          LIMIT 1
        ),
        updated_at = datetime('now')
        WHERE component_identity_id IS NULL
      `).run();
    });
    tx();
  }

  backfillEnumListIds() {
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO enum_lists (category, field_key, source)
        SELECT DISTINCT category, field_key, 'backfill'
        FROM list_values
        WHERE field_key IS NOT NULL AND TRIM(field_key) <> ''
        ON CONFLICT(category, field_key) DO NOTHING
      `).run();

      this.db.prepare(`
        UPDATE list_values
        SET list_id = (
          SELECT el.id
          FROM enum_lists el
          WHERE el.category = list_values.category
            AND el.field_key = list_values.field_key
        )
        WHERE list_id IS NULL
      `).run();
    });
    tx();
  }

  hardenListValueOwnership() {
    const listIdColumn = this.db
      .prepare('PRAGMA table_info(list_values)')
      .all()
      .find((row) => String(row?.name || '') === 'list_id');
    const listIdStrict = Number(listIdColumn?.notnull || 0) === 1;
    if (listIdStrict) return;

    this.backfillEnumListIds();

    const unresolved = Number(this.db.prepare(`
      SELECT COUNT(*) AS c
      FROM list_values
      WHERE list_id IS NULL
    `).get()?.c || 0);
    if (unresolved > 0) {
      throw new Error(`Cannot harden list_values.list_id: ${unresolved} rows remain without enum_lists linkage.`);
    }

    const fkState = Number(this.db.pragma('foreign_keys', { simple: true }) || 0);
    if (fkState) this.db.pragma('foreign_keys = OFF');
    try {
      const tx = this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS list_values__strict (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT NOT NULL,
            list_id INTEGER NOT NULL REFERENCES enum_lists(id),
            field_key TEXT NOT NULL,
            value TEXT NOT NULL,
            normalized_value TEXT,
            source TEXT DEFAULT 'known_values',
            accepted_candidate_id TEXT,
            enum_policy TEXT,
            needs_review INTEGER DEFAULT 0,
            overridden INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            source_timestamp TEXT,
            UNIQUE(category, field_key, value)
          );
        `);

        this.db.exec(`
          INSERT INTO list_values__strict (
            id,
            category,
            list_id,
            field_key,
            value,
            normalized_value,
            source,
            accepted_candidate_id,
            enum_policy,
            needs_review,
            overridden,
            created_at,
            updated_at,
            source_timestamp
          )
          SELECT
            id,
            category,
            list_id,
            field_key,
            value,
            normalized_value,
            source,
            accepted_candidate_id,
            enum_policy,
            needs_review,
            overridden,
            created_at,
            updated_at,
            source_timestamp
          FROM list_values;
        `);

        this.db.exec('DROP TABLE list_values;');
        this.db.exec('ALTER TABLE list_values__strict RENAME TO list_values;');
        this.db.exec(`
          CREATE INDEX IF NOT EXISTS idx_lv_field ON list_values(field_key);
          CREATE INDEX IF NOT EXISTS idx_lv_list_id ON list_values(list_id);
        `);
      });
      tx();
    } finally {
      if (fkState) this.db.pragma('foreign_keys = ON');
    }
  }

  backfillKeyReviewSlotIds() {
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE key_review_state
        SET item_field_state_id = (
          SELECT ifs.id
          FROM item_field_state ifs
          WHERE ifs.category = key_review_state.category
            AND ifs.product_id = key_review_state.item_identifier
            AND ifs.field_key = key_review_state.field_key
          LIMIT 1
        ),
        updated_at = datetime('now')
        WHERE target_kind = 'grid_key'
          AND item_field_state_id IS NULL
      `).run();

      this.db.prepare(`
        UPDATE key_review_state
        SET component_value_id = (
          SELECT cv.id
          FROM component_values cv
          WHERE cv.category = key_review_state.category
            AND cv.property_key = key_review_state.property_key
            AND (
              cv.component_type || '::' || cv.component_name || '::' || COALESCE(cv.component_maker, '')
            ) = key_review_state.component_identifier
          LIMIT 1
        ),
        updated_at = datetime('now')
        WHERE target_kind = 'component_key'
          AND component_value_id IS NULL
          AND COALESCE(property_key, '') NOT IN ('__name', '__maker', '__links', '__aliases')
      `).run();

      this.db.prepare(`
        UPDATE key_review_state
        SET component_identity_id = (
          SELECT cv.component_identity_id
          FROM component_values cv
          WHERE cv.id = key_review_state.component_value_id
          LIMIT 1
        ),
        updated_at = datetime('now')
        WHERE target_kind = 'component_key'
          AND component_identity_id IS NULL
          AND component_value_id IS NOT NULL
      `).run();

      this.db.prepare(`
        UPDATE key_review_state
        SET component_identity_id = (
          SELECT ci.id
          FROM component_identity ci
          WHERE ci.category = key_review_state.category
            AND (
              ci.component_type || '::' || ci.canonical_name || '::' || COALESCE(ci.maker, '')
            ) = key_review_state.component_identifier
          LIMIT 1
        ),
        updated_at = datetime('now')
        WHERE target_kind = 'component_key'
          AND component_identity_id IS NULL
      `).run();

      this.db.prepare(`
        UPDATE key_review_state
        SET list_value_id = (
          SELECT lv.id
          FROM list_values lv
          WHERE lv.category = key_review_state.category
            AND lv.field_key = key_review_state.field_key
            AND (
              (key_review_state.enum_value_norm IS NOT NULL AND lv.normalized_value = key_review_state.enum_value_norm)
              OR (key_review_state.enum_value_norm IS NULL AND lv.normalized_value = LOWER(TRIM(COALESCE(key_review_state.selected_value, ''))))
            )
          LIMIT 1
        ),
        updated_at = datetime('now')
        WHERE target_kind = 'enum_key'
          AND list_value_id IS NULL
      `).run();

      this.db.prepare(`
        UPDATE key_review_state
        SET enum_list_id = (
          SELECT lv.list_id
          FROM list_values lv
          WHERE lv.id = key_review_state.list_value_id
          LIMIT 1
        ),
        updated_at = datetime('now')
        WHERE target_kind = 'enum_key'
          AND list_value_id IS NOT NULL
          AND enum_list_id IS NULL
      `).run();

      this.db.prepare(`
        UPDATE key_review_state
        SET enum_list_id = (
          SELECT el.id
          FROM enum_lists el
          WHERE el.category = key_review_state.category
            AND el.field_key = key_review_state.field_key
          LIMIT 1
        ),
        updated_at = datetime('now')
        WHERE target_kind = 'enum_key'
          AND enum_list_id IS NULL
      `).run();
    });
    tx();
  }

  ensureEnumList(fieldKey, source = 'known_values') {
    const key = String(fieldKey || '').trim();
    if (!key) return null;
    this._upsertEnumList.run({
      category: this.category,
      field_key: key,
      source: source || 'known_values',
    });
    const row = this.db
      .prepare('SELECT id FROM enum_lists WHERE category = ? AND field_key = ?')
      .get(this.category, key);
    return row?.id ?? null;
  }

  getEnumList(fieldKey) {
    const key = String(fieldKey || '').trim();
    if (!key) return null;
    return this.db
      .prepare('SELECT * FROM enum_lists WHERE category = ? AND field_key = ?')
      .get(this.category, key) || null;
  }

  getEnumListById(listId) {
    const id = Number(listId);
    if (!Number.isFinite(id) || id <= 0) return null;
    return this.db
      .prepare('SELECT * FROM enum_lists WHERE category = ? AND id = ?')
      .get(this.category, id) || null;
  }

  getAllEnumLists() {
    return this.db
      .prepare('SELECT * FROM enum_lists WHERE category = ? ORDER BY field_key')
      .all(this.category);
  }

  upsertListValue({ fieldKey, value, normalizedValue, source, enumPolicy, acceptedCandidateId, needsReview, overridden, sourceTimestamp }) {
    const listId = this.ensureEnumList(fieldKey, source || 'known_values');
    this._upsertListValue.run({
      category: this.category,
      list_id: listId,
      field_key: fieldKey,
      value,
      normalized_value: normalizedValue ?? null,
      source: source || 'known_values',
      accepted_candidate_id: acceptedCandidateId ?? null,
      enum_policy: enumPolicy ?? null,
      needs_review: needsReview ? 1 : 0,
      overridden: overridden ? 1 : 0,
      source_timestamp: sourceTimestamp ?? null
    });
  }

  getListValues(fieldKey) {
    return this.db
      .prepare('SELECT * FROM list_values WHERE category = ? AND field_key = ?')
      .all(this.category, fieldKey);
  }

  getListValueByFieldAndValue(fieldKey, value) {
    const exact = this.db
      .prepare('SELECT * FROM list_values WHERE category = ? AND field_key = ? AND value = ?')
      .get(this.category, fieldKey, value);
    if (exact) return exact;
    if (value == null) return null;
    return this.db
      .prepare(`
        SELECT *
        FROM list_values
        WHERE category = ? AND field_key = ? AND LOWER(TRIM(value)) = LOWER(TRIM(?))
        ORDER BY id
        LIMIT 1
      `)
      .get(this.category, fieldKey, value) || null;
  }

  getListValueById(listValueId) {
    const id = Number(listValueId);
    if (!Number.isFinite(id) || id <= 0) return null;
    return this.db
      .prepare('SELECT * FROM list_values WHERE category = ? AND id = ?')
      .get(this.category, id) || null;
  }

  // --- Item state ---

  upsertItemFieldState({ productId, fieldKey, value, confidence, source, acceptedCandidateId, overridden, needsAiReview, aiReviewComplete }) {
    this._upsertItemFieldState.run({
      category: this.category,
      product_id: productId,
      field_key: fieldKey,
      value: value ?? null,
      confidence: confidence ?? 0,
      source: source || 'pipeline',
      accepted_candidate_id: acceptedCandidateId ?? null,
      overridden: overridden ? 1 : 0,
      needs_ai_review: needsAiReview ? 1 : 0,
      ai_review_complete: aiReviewComplete ? 1 : 0
    });
  }

  getItemFieldState(productId) {
    return this.db
      .prepare('SELECT * FROM item_field_state WHERE category = ? AND product_id = ?')
      .all(this.category, productId);
  }

  getItemFieldStateById(itemFieldStateId) {
    const id = Number(itemFieldStateId);
    if (!Number.isFinite(id) || id <= 0) return null;
    return this.db
      .prepare('SELECT * FROM item_field_state WHERE category = ? AND id = ?')
      .get(this.category, id) || null;
  }

  // --- Links ---

  upsertItemComponentLink({ productId, fieldKey, componentType, componentName, componentMaker, matchType, matchScore }) {
    this._upsertItemComponentLink.run({
      category: this.category,
      product_id: productId,
      field_key: fieldKey,
      component_type: componentType,
      component_name: componentName,
      component_maker: componentMaker || '',
      match_type: matchType ?? null,
      match_score: matchScore ?? null
    });
  }

  upsertItemListLink({ productId, fieldKey, listValueId }) {
    this._upsertItemListLink.run({
      category: this.category,
      product_id: productId,
      field_key: fieldKey,
      list_value_id: listValueId
    });
  }

  removeItemListLinksForField(productId, fieldKey) {
    this.db
      .prepare('DELETE FROM item_list_links WHERE category = ? AND product_id = ? AND field_key = ?')
      .run(this.category, productId, fieldKey);
  }

  /** Keep item_list_links aligned with item_field_state for enum/list fields. */
  syncItemListLinkForFieldValue({ productId, fieldKey, value }) {
    const pid = String(productId || '').trim();
    const key = String(fieldKey || '').trim();
    if (!pid || !key) return null;

    let linkedRow = null;
    const tx = this.db.transaction(() => {
      this.removeItemListLinksForField(pid, key);

      const valueTokens = expandListLinkValues(value);
      if (!valueTokens.length) return;

      const linkedIds = new Set();
      for (const token of valueTokens) {
        const listRow = this.getListValueByFieldAndValue(key, token);
        if (!listRow?.id) continue;
        if (linkedIds.has(listRow.id)) continue;
        linkedIds.add(listRow.id);
        this.upsertItemListLink({
          productId: pid,
          fieldKey: key,
          listValueId: listRow.id,
        });
        if (!linkedRow) linkedRow = listRow;
      }
    });
    tx();
    return linkedRow;
  }

  getItemComponentLinks(productId) {
    return this.db
      .prepare('SELECT * FROM item_component_links WHERE category = ? AND product_id = ?')
      .all(this.category, productId);
  }

  getItemListLinks(productId) {
    return this.db
      .prepare('SELECT * FROM item_list_links WHERE category = ? AND product_id = ?')
      .all(this.category, productId);
  }

  // --- Reverse-Lookup Queries (component/enum review) ---

  getProductsForComponent(componentType, componentName, componentMaker) {
    return this.db
      .prepare(`
        SELECT DISTINCT product_id, field_key, match_type, match_score
        FROM item_component_links
        WHERE category = ? AND component_type = ? AND component_name = ? AND component_maker = ?
        ORDER BY product_id
      `)
      .all(this.category, componentType, componentName, componentMaker || '');
  }

  getCandidatesForComponentProperty(componentType, componentName, componentMaker, fieldKey) {
    return this.db
      .prepare(`
        SELECT c.*
        FROM candidates c
        INNER JOIN item_component_links icl
          ON icl.product_id = c.product_id AND icl.category = c.category
        WHERE icl.category = ?
          AND icl.component_type = ?
          AND icl.component_name = ?
          AND icl.component_maker = ?
          AND c.field_key = ?
        ORDER BY c.score DESC, c.rank ASC, c.product_id
      `)
      .all(this.category, componentType, componentName, componentMaker || '', fieldKey);
  }

  getProductsByListValueId(listValueId) {
    const id = Number(listValueId);
    if (!Number.isFinite(id) || id <= 0) return [];
    return this.db
      .prepare(`
        SELECT DISTINCT product_id, field_key
        FROM item_list_links
        WHERE category = ? AND list_value_id = ?
        ORDER BY product_id
      `)
      .all(this.category, id);
  }

  getProductsForListValue(fieldKey, value) {
    return this.db
      .prepare(`
        SELECT DISTINCT ill.product_id, ill.field_key
        FROM item_list_links ill
        INNER JOIN list_values lv ON lv.id = ill.list_value_id
        WHERE lv.category = ? AND lv.field_key = ? AND lv.value = ?
        ORDER BY ill.product_id
      `)
      .all(this.category, fieldKey, value);
  }

  getProductsForFieldValue(fieldKey, value) {
    return this.db
      .prepare(`
        SELECT DISTINCT product_id, field_key
        FROM item_field_state
        WHERE category = ?
          AND field_key = ?
          AND value IS NOT NULL
          AND LOWER(TRIM(value)) = LOWER(TRIM(?))
        ORDER BY product_id
      `)
      .all(this.category, fieldKey, value);
  }

  getCandidatesByListValue(fieldKey, listValueId) {
    return this.db
      .prepare(`
        SELECT c.*
        FROM candidates c
        INNER JOIN item_list_links ill
          ON ill.product_id = c.product_id AND ill.field_key = c.field_key
        WHERE ill.list_value_id = ? AND c.field_key = ? AND c.category = ?
        ORDER BY c.score DESC, c.rank ASC, c.product_id
      `)
      .all(listValueId, fieldKey, this.category);
  }

  getCandidatesForFieldValue(fieldKey, value) {
    return this.db
      .prepare(`
        SELECT *
        FROM candidates
        WHERE category = ?
          AND field_key = ?
          AND value IS NOT NULL
          AND LOWER(TRIM(value)) = LOWER(TRIM(?))
        ORDER BY score DESC, rank ASC, product_id
      `)
      .all(this.category, fieldKey, value);
  }

  getItemFieldStateForProducts(productIds, fieldKeys) {
    if (!productIds.length || !fieldKeys.length) return [];
    const pidPlaceholders = productIds.map(() => '?').join(',');
    const fkPlaceholders = fieldKeys.map(() => '?').join(',');
    return this.db
      .prepare(`
        SELECT * FROM item_field_state
        WHERE category = ? AND product_id IN (${pidPlaceholders}) AND field_key IN (${fkPlaceholders})
      `)
      .all(this.category, ...productIds, ...fieldKeys);
  }

  getDistinctItemFieldValues(fieldKey) {
    return this.db
      .prepare(`
        SELECT value, COUNT(DISTINCT product_id) as product_count
        FROM item_field_state
        WHERE category = ?
          AND field_key = ?
          AND value IS NOT NULL
          AND LOWER(TRIM(value)) NOT IN ('', 'unk', 'n/a', 'na')
        GROUP BY value
        ORDER BY product_count DESC, value ASC
      `)
      .all(this.category, fieldKey);
  }

  // --- Phase 1 Query Methods ---

  getComponentTypeList() {
    return this.db
      .prepare('SELECT component_type, COUNT(*) as item_count FROM component_identity WHERE category = ? GROUP BY component_type')
      .all(this.category);
  }

  getPropertyColumnsForType(componentType) {
    return this.db
      .prepare('SELECT DISTINCT property_key FROM component_values WHERE category = ? AND component_type = ? ORDER BY property_key')
      .all(this.category, componentType)
      .map(r => r.property_key);
  }

  getAllComponentsForType(componentType) {
    const identities = this.db
      .prepare('SELECT * FROM component_identity WHERE category = ? AND component_type = ?')
      .all(this.category, componentType);

    const result = [];
    for (const identity of identities) {
      const aliases = this.db
        .prepare('SELECT alias, source FROM component_aliases WHERE component_id = ?')
        .all(identity.id);
      const properties = this.db
        .prepare('SELECT * FROM component_values WHERE category = ? AND component_type = ? AND component_name = ? AND component_maker = ?')
        .all(this.category, componentType, identity.canonical_name, identity.maker || '');
      result.push({ identity, aliases, properties });
    }
    return result;
  }

  getComponentValuesWithMaker(componentType, componentName, componentMaker) {
    return this.db
      .prepare('SELECT * FROM component_values WHERE category = ? AND component_type = ? AND component_name = ? AND component_maker = ?')
      .all(this.category, componentType, componentName, componentMaker || '');
  }

  getComponentValueById(componentValueId) {
    const id = Number(componentValueId);
    if (!Number.isFinite(id) || id <= 0) return null;
    return this.db
      .prepare('SELECT * FROM component_values WHERE category = ? AND id = ?')
      .get(this.category, id) || null;
  }

  getAllEnumFields() {
    return this.db
      .prepare(`
        SELECT field_key
        FROM enum_lists
        WHERE category = ?
        UNION
        SELECT DISTINCT field_key
        FROM list_values
        WHERE category = ?
        ORDER BY field_key
      `)
      .all(this.category, this.category)
      .map(r => r.field_key);
  }

  updateComponentReviewStatus(componentType, componentName, componentMaker, status) {
    this.db
      .prepare(`UPDATE component_identity SET review_status = ?, updated_at = datetime('now')
                WHERE category = ? AND component_type = ? AND canonical_name = ? AND maker = ?`)
      .run(status, this.category, componentType, componentName, componentMaker || '');
  }

  updateAliasesOverridden(componentType, componentName, componentMaker, overridden) {
    this.db
      .prepare(`UPDATE component_identity SET aliases_overridden = ?, updated_at = datetime('now')
                WHERE category = ? AND component_type = ? AND canonical_name = ? AND maker = ?`)
      .run(overridden ? 1 : 0, this.category, componentType, componentName, componentMaker || '');
  }

  mergeComponentIdentities({ sourceId, targetId }) {
    const category = this.category;
    const source = this.db.prepare('SELECT * FROM component_identity WHERE id = ? AND category = ?').get(sourceId, category);
    const target = this.db.prepare('SELECT * FROM component_identity WHERE id = ? AND category = ?').get(targetId, category);
    if (!source || !target) return;

    const tx = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE item_component_links
        SET component_name = ?, component_maker = ?, updated_at = datetime('now')
        WHERE category = ? AND component_type = ? AND component_name = ? AND component_maker = ?
          AND NOT EXISTS (
            SELECT 1 FROM item_component_links t
            WHERE t.category = item_component_links.category
              AND t.product_id = item_component_links.product_id
              AND t.field_key = item_component_links.field_key
              AND t.component_type = ?
              AND t.component_name = ?
              AND t.component_maker = ?
          )
      `).run(
        target.canonical_name, target.maker,
        category, source.component_type, source.canonical_name, source.maker,
        target.component_type, target.canonical_name, target.maker
      );
      this.db.prepare(`
        DELETE FROM item_component_links
        WHERE category = ? AND component_type = ? AND component_name = ? AND component_maker = ?
      `).run(category, source.component_type, source.canonical_name, source.maker);

      const sourceValues = this.db.prepare(
        'SELECT * FROM component_values WHERE category = ? AND component_type = ? AND component_name = ? AND component_maker = ?'
      ).all(category, source.component_type, source.canonical_name, source.maker);
      for (const sv of sourceValues) {
        const targetHas = this.db.prepare(
          'SELECT id FROM component_values WHERE category = ? AND component_type = ? AND component_name = ? AND component_maker = ? AND property_key = ?'
        ).get(category, target.component_type, target.canonical_name, target.maker, sv.property_key);
        if (targetHas) {
          this.db.prepare('DELETE FROM component_values WHERE id = ?').run(sv.id);
        } else {
          this.db.prepare(`
            UPDATE component_values
            SET component_name = ?, component_maker = ?, component_identity_id = ?, updated_at = datetime('now')
            WHERE id = ?
          `).run(target.canonical_name, target.maker, targetId, sv.id);
        }
      }

      const sourceAliases = this.db.prepare(
        'SELECT * FROM component_aliases WHERE component_id = ?'
      ).all(sourceId);
      for (const sa of sourceAliases) {
        const targetHas = this.db.prepare(
          'SELECT id FROM component_aliases WHERE component_id = ? AND alias = ?'
        ).get(targetId, sa.alias);
        if (targetHas) {
          this.db.prepare('DELETE FROM component_aliases WHERE id = ?').run(sa.id);
        } else {
          this.db.prepare(
            'UPDATE component_aliases SET component_id = ? WHERE id = ?'
          ).run(targetId, sa.id);
        }
      }

      const sourceIdentifier = `${source.component_type}::${source.canonical_name}::${source.maker}`;
      const targetIdentifier = `${target.component_type}::${target.canonical_name}::${target.maker}`;

      const sourceKrs = this.db.prepare(
        "SELECT * FROM key_review_state WHERE category = ? AND target_kind = 'component_key' AND component_identifier = ?"
      ).all(category, sourceIdentifier);

      const STATUS_RANK = { confirmed: 3, accepted: 2, pending: 1 };
      for (const sk of sourceKrs) {
        const targetKrs = this.db.prepare(
          "SELECT * FROM key_review_state WHERE category = ? AND target_kind = 'component_key' AND component_identifier = ? AND property_key = ?"
        ).get(category, targetIdentifier, sk.property_key);

        if (targetKrs) {
          const sourceRank = STATUS_RANK[sk.ai_confirm_shared_status] || 0;
          const targetRank = STATUS_RANK[targetKrs.ai_confirm_shared_status] || 0;
          if (sourceRank > targetRank) {
            this.db.prepare(`
              UPDATE key_review_state
              SET ai_confirm_shared_status = ?, ai_confirm_shared_confidence = ?,
                  selected_value = COALESCE(?, selected_value),
                  selected_candidate_id = COALESCE(?, selected_candidate_id),
                  updated_at = datetime('now')
              WHERE id = ?
            `).run(
              sk.ai_confirm_shared_status, sk.ai_confirm_shared_confidence,
              sk.selected_value, sk.selected_candidate_id,
              targetKrs.id
            );
          }
          this.db.prepare('DELETE FROM key_review_state WHERE id = ?').run(sk.id);
        } else {
          this.db.prepare(`
            UPDATE key_review_state
            SET component_identifier = ?, component_identity_id = ?, updated_at = datetime('now')
            WHERE id = ?
          `).run(targetIdentifier, targetId, sk.id);
        }
      }

      this.db.prepare('DELETE FROM component_identity WHERE id = ? AND category = ?').run(sourceId, category);
    });
    tx();
  }

  deleteKeyReviewStateRowsByIds(stateIds = []) {
    const ids = Array.isArray(stateIds)
      ? stateIds
        .map((value) => Number.parseInt(String(value), 10))
        .filter((value) => Number.isFinite(value) && value > 0)
      : [];
    if (ids.length === 0) return 0;
    const tx = this.db.transaction((rows) => {
      for (const id of rows) {
        this.db.prepare(`
          DELETE FROM key_review_run_sources
          WHERE key_review_run_id IN (
            SELECT run_id
            FROM key_review_runs
            WHERE key_review_state_id = ?
          )
        `).run(id);
        this.db.prepare('DELETE FROM key_review_runs WHERE key_review_state_id = ?').run(id);
        this.db.prepare('DELETE FROM key_review_audit WHERE key_review_state_id = ?').run(id);
        this.db.prepare('DELETE FROM key_review_state WHERE id = ?').run(id);
      }
    });
    tx(ids);
    return ids.length;
  }

  deleteListValue(fieldKey, value) {
    const tx = this.db.transaction(() => {
      const row = this.db
        .prepare('SELECT id FROM list_values WHERE category = ? AND field_key = ? AND value = ?')
        .get(this.category, fieldKey, value);
      if (row?.id != null) {
        const stateIds = this.db.prepare(`
          SELECT id
          FROM key_review_state
          WHERE category = ?
            AND target_kind = 'enum_key'
            AND list_value_id = ?
        `).all(this.category, row.id).map((entry) => entry.id);
        this.deleteKeyReviewStateRowsByIds(stateIds);

        this.db
          .prepare('UPDATE source_assertions SET list_value_id = NULL WHERE list_value_id = ?')
          .run(row.id);
        this.db
          .prepare('DELETE FROM item_list_links WHERE category = ? AND field_key = ? AND list_value_id = ?')
          .run(this.category, fieldKey, row.id);
      }
      this.db
        .prepare('DELETE FROM list_values WHERE category = ? AND field_key = ? AND value = ?')
        .run(this.category, fieldKey, value);
    });
    tx();
  }

  deleteListValueById(listValueId) {
    const row = this.getListValueById(listValueId);
    if (!row) return null;
    this.deleteListValue(row.field_key, row.value);
    return row;
  }

  renameListValue(fieldKey, oldValue, newValue, timestamp) {
    const affected = new Set();
    const tx = this.db.transaction(() => {
      const fieldStateRows = this.db
        .prepare('SELECT DISTINCT product_id FROM item_field_state WHERE category = ? AND field_key = ? AND LOWER(TRIM(value)) = LOWER(TRIM(?))')
        .all(this.category, fieldKey, oldValue);
      for (const row of fieldStateRows) {
        if (row?.product_id) affected.add(row.product_id);
      }

      // Resolve old/new list_values ids before any row deletion to preserve FK integrity.
      const oldRow = this.db
        .prepare('SELECT id FROM list_values WHERE category = ? AND field_key = ? AND value = ?')
        .get(this.category, fieldKey, oldValue);
      if (oldRow?.id != null) {
        const linkRows = this.db
          .prepare('SELECT DISTINCT product_id FROM item_list_links WHERE category = ? AND field_key = ? AND list_value_id = ?')
          .all(this.category, fieldKey, oldRow.id);
        for (const row of linkRows) {
          if (row?.product_id) affected.add(row.product_id);
        }
      }

      const normalizedNew = String(newValue).trim().toLowerCase();
      const enumListId = this.ensureEnumList(fieldKey, 'manual');
      this._upsertListValue.run({
        category: this.category,
        list_id: enumListId,
        field_key: fieldKey,
        value: newValue,
        normalized_value: normalizedNew,
        source: 'manual',
        accepted_candidate_id: null,
        enum_policy: null,
        needs_review: 0,
        overridden: 1,
        source_timestamp: timestamp || new Date().toISOString()
      });
      const newRow = this.db
        .prepare('SELECT id FROM list_values WHERE category = ? AND field_key = ? AND value = ?')
        .get(this.category, fieldKey, newValue);

      // Update item_field_state: rewrite the value string for all affected products
      this.db
        .prepare('UPDATE item_field_state SET value = ?, updated_at = datetime(\'now\') WHERE category = ? AND field_key = ? AND LOWER(TRIM(value)) = LOWER(TRIM(?))')
        .run(newValue, this.category, fieldKey, oldValue);

      // Update item_list_links first, then delete old list value row.
      if (oldRow && newRow && Number(oldRow.id) !== Number(newRow.id)) {
        const oldStateIds = this.db.prepare(`
          SELECT id
          FROM key_review_state
          WHERE category = ?
            AND target_kind = 'enum_key'
            AND list_value_id = ?
        `).all(this.category, oldRow.id).map((entry) => entry.id);
        this.deleteKeyReviewStateRowsByIds(oldStateIds);

        this.db
          .prepare('UPDATE source_assertions SET list_value_id = ? WHERE list_value_id = ?')
          .run(newRow.id, oldRow.id);
        this.db
          .prepare('UPDATE item_list_links SET list_value_id = ? WHERE category = ? AND field_key = ? AND list_value_id = ?')
          .run(newRow.id, this.category, fieldKey, oldRow.id);
      }
      if (oldRow && (!newRow || Number(oldRow.id) !== Number(newRow.id))) {
        if (!newRow) {
          const oldStateIds = this.db.prepare(`
            SELECT id
            FROM key_review_state
            WHERE category = ?
              AND target_kind = 'enum_key'
              AND list_value_id = ?
          `).all(this.category, oldRow.id).map((entry) => entry.id);
          this.deleteKeyReviewStateRowsByIds(oldStateIds);
          this.db
            .prepare('UPDATE source_assertions SET list_value_id = NULL WHERE list_value_id = ?')
            .run(oldRow.id);
        }
        this.db
          .prepare('DELETE FROM list_values WHERE category = ? AND field_key = ? AND value = ?')
          .run(this.category, fieldKey, oldValue);
      }
    });
    tx();
    return [...affected];
  }

  renameListValueById(listValueId, newValue, timestamp) {
    const row = this.getListValueById(listValueId);
    if (!row) return [];
    return this.renameListValue(row.field_key, row.value, newValue, timestamp);
  }

  /** Update item_field_state.value from oldValue to newValue for all matching products.
   *  Returns the list of affected product_ids. */
  renameFieldValueInItems(fieldKey, oldValue, newValue) {
    const affected = this.db
      .prepare('SELECT DISTINCT product_id FROM item_field_state WHERE category = ? AND field_key = ? AND LOWER(TRIM(value)) = LOWER(TRIM(?))')
      .all(this.category, fieldKey, oldValue)
      .map(r => r.product_id);
    if (affected.length > 0) {
      this.db
        .prepare('UPDATE item_field_state SET value = ?, updated_at = datetime(\'now\') WHERE category = ? AND field_key = ? AND LOWER(TRIM(value)) = LOWER(TRIM(?))')
        .run(newValue, this.category, fieldKey, oldValue);
    }
    return affected;
  }

  /** Clear item_field_state.value for all products that had the given value.
   *  Sets value to null and marks needs_ai_review=1.
   *  Returns the list of affected product_ids. */
  removeFieldValueFromItems(fieldKey, value) {
    const affected = this.db
      .prepare('SELECT DISTINCT product_id FROM item_field_state WHERE category = ? AND field_key = ? AND LOWER(TRIM(value)) = LOWER(TRIM(?))')
      .all(this.category, fieldKey, value)
      .map(r => r.product_id);
    if (affected.length > 0) {
      this.db
        .prepare('UPDATE item_field_state SET value = NULL, needs_ai_review = 1, updated_at = datetime(\'now\') WHERE category = ? AND field_key = ? AND LOWER(TRIM(value)) = LOWER(TRIM(?))')
        .run(this.category, fieldKey, value);
    }
    return affected;
  }

  /** Delete item_list_links referencing a specific list_values row. */
  removeListLinks(fieldKey, value) {
    const row = this.db
      .prepare('SELECT id FROM list_values WHERE category = ? AND field_key = ? AND value = ?')
      .get(this.category, fieldKey, value);
    if (row) {
      this.db
        .prepare('DELETE FROM item_list_links WHERE category = ? AND field_key = ? AND list_value_id = ?')
        .run(this.category, fieldKey, row.id);
    }
  }

  // --- Component cascade helpers ---

  /**
   * For an authoritative component property, push the new value into every
   * linked product's item_field_state row for that property key.
   * Returns the list of affected product_ids.
   */
  pushAuthoritativeValueToLinkedProducts(componentType, componentName, componentMaker, propertyKey, newValue) {
    const linkRows = this.getProductsForComponent(componentType, componentName, componentMaker || '');
    if (linkRows.length === 0) return [];
    const productIds = linkRows.map(r => r.product_id);
    const tx = this.db.transaction(() => {
      for (const pid of productIds) {
        this.db.prepare(`
          INSERT INTO item_field_state (
            category, product_id, field_key, value, confidence, source,
            accepted_candidate_id, overridden, needs_ai_review, ai_review_complete
          ) VALUES (?, ?, ?, ?, ?, 'component_db', NULL, 0, 0, 0)
          ON CONFLICT(category, product_id, field_key) DO UPDATE SET
            value = excluded.value,
            confidence = excluded.confidence,
            source = 'component_db',
            accepted_candidate_id = NULL,
            overridden = 0,
            needs_ai_review = 0,
            ai_review_complete = 0,
            updated_at = datetime('now')
        `).run(
          this.category,
          pid,
          propertyKey,
          newValue ?? null,
          1.0
        );
      }
    });
    tx();
    return productIds;
  }

  /**
   * For bound/range variance policies, evaluate each linked product's current
   * value and set or clear needs_ai_review accordingly.
   * Returns { violations: string[], compliant: string[] } (product_ids).
   */
  evaluateAndFlagLinkedProducts(componentType, componentName, componentMaker, propertyKey, newComponentValue, variancePolicy) {
    const linkRows = this.getProductsForComponent(componentType, componentName, componentMaker || '');
    if (linkRows.length === 0) return { violations: [], compliant: [] };
    const productIds = linkRows.map(r => r.product_id);
    const fieldStates = this.getItemFieldStateForProducts(productIds, [propertyKey]);
    // Build a lookup: product_id → current value
    const valueMap = new Map();
    for (const fs of fieldStates) {
      valueMap.set(fs.product_id, fs.value);
    }
    const violations = [];
    const compliant = [];
    // Inline quick variance check (mirrors varianceEvaluator logic, avoids circular import)
    const skipVals = new Set(['', 'unk', 'n/a', 'n-a', 'null', 'undefined', 'unknown', '-']);
    const parseNum = (v) => {
      if (v == null) return NaN;
      const s = String(v).trim().replace(/,/g, '').replace(/\s+/g, '');
      const c = s.replace(/[a-zA-Z%°]+$/, '');
      return c ? Number(c) : NaN;
    };
    const isSkip = (v) => v == null || skipVals.has(String(v).trim().toLowerCase());
    const dbStr = String(newComponentValue ?? '').trim();
    const dbNum = parseNum(dbStr);
    const tx = this.db.transaction(() => {
      for (const pid of productIds) {
        const prodVal = valueMap.get(pid);
        // Skip if either side is unknown/missing
        if (isSkip(newComponentValue) || isSkip(prodVal)) {
          compliant.push(pid);
          this.db.prepare(
            'UPDATE item_field_state SET needs_ai_review = 0, updated_at = datetime(\'now\') WHERE category = ? AND product_id = ? AND field_key = ?'
          ).run(this.category, pid, propertyKey);
          continue;
        }
        const prodStr = String(prodVal).trim();
        const prodNum = parseNum(prodStr);
        let isViolation = false;
        if (variancePolicy === 'upper_bound') {
          if (!Number.isNaN(dbNum) && !Number.isNaN(prodNum)) {
            isViolation = prodNum > dbNum;
          }
        } else if (variancePolicy === 'lower_bound') {
          if (!Number.isNaN(dbNum) && !Number.isNaN(prodNum)) {
            isViolation = prodNum < dbNum;
          }
        } else if (variancePolicy === 'range') {
          if (!Number.isNaN(dbNum) && !Number.isNaN(prodNum)) {
            const margin = Math.abs(dbNum) * 0.10;
            isViolation = prodNum < (dbNum - margin) || prodNum > (dbNum + margin);
          }
        }
        if (isViolation) {
          violations.push(pid);
          this.db.prepare(
            'UPDATE item_field_state SET needs_ai_review = 1, updated_at = datetime(\'now\') WHERE category = ? AND product_id = ? AND field_key = ?'
          ).run(this.category, pid, propertyKey);
        } else {
          compliant.push(pid);
          this.db.prepare(
            'UPDATE item_field_state SET needs_ai_review = 0, updated_at = datetime(\'now\') WHERE category = ? AND product_id = ? AND field_key = ?'
          ).run(this.category, pid, propertyKey);
        }
      }
    });
    tx();
    return { violations, compliant };
  }

  /**
   * Re-evaluate constraint expressions for linked products after a component
   * property changes. Flags products that violate any constraint with needs_ai_review=1.
   * Returns { violations: string[], compliant: string[] } (product_ids).
   */
  evaluateConstraintsForLinkedProducts(componentType, componentName, componentMaker, propertyKey, constraints) {
    if (!Array.isArray(constraints) || constraints.length === 0) return { violations: [], compliant: [] };
    const linkRows = this.getProductsForComponent(componentType, componentName, componentMaker || '');
    if (linkRows.length === 0) return { violations: [], compliant: [] };
    const productIds = linkRows.map(r => r.product_id);

    // Get current component properties as a map
    const compRows = this.getComponentValuesWithMaker(componentType, componentName, componentMaker || '');
    const componentProps = {};
    for (const row of compRows) {
      componentProps[row.property_key] = row.value;
    }

    // For each product, get all field state values and evaluate constraints
    const violations = [];
    const compliant = [];
    const tx = this.db.transaction(() => {
      for (const pid of productIds) {
        const fieldRows = this.db
          .prepare('SELECT field_key, value FROM item_field_state WHERE category = ? AND product_id = ?')
          .all(this.category, pid);
        const productValues = {};
        for (const fr of fieldRows) {
          productValues[fr.field_key] = fr.value;
        }

        // Evaluate each constraint expression
        let hasViolation = false;
        for (const expr of constraints) {
          if (!expr || typeof expr !== 'string') continue;
          const result = this._evaluateConstraintExpr(expr, componentProps, productValues);
          if (result !== null && !result) {
            hasViolation = true;
            break;
          }
        }

        if (hasViolation) {
          violations.push(pid);
          this.db.prepare(
            'UPDATE item_field_state SET needs_ai_review = 1, updated_at = datetime(\'now\') WHERE category = ? AND product_id = ? AND field_key = ?'
          ).run(this.category, pid, propertyKey);
        } else {
          compliant.push(pid);
          this.db.prepare(
            'UPDATE item_field_state SET needs_ai_review = 0, updated_at = datetime(\'now\') WHERE category = ? AND product_id = ? AND field_key = ?'
          ).run(this.category, pid, propertyKey);
        }
      }
    });
    tx();
    return { violations, compliant };
  }

  /**
   * Minimal inline constraint expression evaluator (avoids importing from engine/).
   * Returns true=pass, false=fail, null=skip (unresolvable or unknown values).
   */
  _evaluateConstraintExpr(expr, componentProps, productValues) {
    const ops = ['<=', '>=', '!=', '==', '<', '>'];
    const trimmed = (expr || '').trim();
    let parsed = null;
    for (const op of ops) {
      const idx = trimmed.indexOf(op);
      if (idx > 0) {
        const left = trimmed.slice(0, idx).trim();
        const right = trimmed.slice(idx + op.length).trim();
        if (left && right) { parsed = { left, op, right }; break; }
      }
    }
    if (!parsed) return null;

    const resolve = (name) => {
      if (/^-?\d+(\.\d+)?$/.test(name)) return Number(name);
      if (componentProps[name] !== undefined) return componentProps[name];
      const norm = name.toLowerCase().replace(/[^a-z0-9_]+/g, '_');
      if (componentProps[norm] !== undefined) return componentProps[norm];
      if (productValues[name] !== undefined) return productValues[name];
      if (productValues[norm] !== undefined) return productValues[norm];
      return undefined;
    };

    const leftVal = resolve(parsed.left);
    const rightVal = resolve(parsed.right);
    if (leftVal === undefined || rightVal === undefined) return null;
    const skipSet = new Set(['unk', 'unknown', 'n/a', '']);
    if (skipSet.has(String(leftVal).toLowerCase().trim()) || skipSet.has(String(rightVal).toLowerCase().trim())) return null;

    const toNum = (v) => { const n = Number(String(v).trim().replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
    const ln = toNum(leftVal);
    const rn = toNum(rightVal);
    if (ln !== null && rn !== null) {
      switch (parsed.op) {
        case '<=': return ln <= rn; case '>=': return ln >= rn;
        case '<': return ln < rn; case '>': return ln > rn;
        case '==': return ln === rn; case '!=': return ln !== rn;
      }
    }
    const ls = String(leftVal).toLowerCase().trim();
    const rs = String(rightVal).toLowerCase().trim();
    switch (parsed.op) {
      case '<=': return ls <= rs; case '>=': return ls >= rs;
      case '<': return ls < rs; case '>': return ls > rs;
      case '==': return ls === rs; case '!=': return ls !== rs;
    }
    return null;
  }

  // --- Phase 2: Queue Methods ---

  upsertQueueProduct(row) {
    this._upsertQueueProduct.run({
      category: row.category || this.category,
      product_id: row.product_id || '',
      s3key: row.s3key ?? '',
      status: row.status || 'pending',
      priority: row.priority ?? 3,
      attempts_total: row.attempts_total ?? 0,
      retry_count: row.retry_count ?? 0,
      max_attempts: row.max_attempts ?? 3,
      next_retry_at: row.next_retry_at ?? null,
      last_run_id: row.last_run_id ?? null,
      cost_usd_total: row.cost_usd_total ?? 0,
      rounds_completed: row.rounds_completed ?? 0,
      next_action_hint: row.next_action_hint ?? null,
      last_urls_attempted: row.last_urls_attempted ? JSON.stringify(row.last_urls_attempted) : null,
      last_error: row.last_error ?? null,
      last_started_at: row.last_started_at ?? null,
      last_completed_at: row.last_completed_at ?? null,
      dirty_flags: row.dirty_flags ? JSON.stringify(row.dirty_flags) : null,
      last_summary: row.last_summary ? JSON.stringify(row.last_summary) : null
    });
  }

  getQueueProduct(productId) {
    const row = this.db
      .prepare('SELECT * FROM product_queue WHERE category = ? AND product_id = ?')
      .get(this.category, productId);
    if (!row) return null;
    if (row.last_urls_attempted) try { row.last_urls_attempted = JSON.parse(row.last_urls_attempted); } catch { /* leave as string */ }
    if (row.dirty_flags) try { row.dirty_flags = JSON.parse(row.dirty_flags); } catch { /* leave as string */ }
    if (row.last_summary) try { row.last_summary = JSON.parse(row.last_summary); } catch { /* leave as string */ }
    return row;
  }

  getAllQueueProducts(statusFilter) {
    const sql = statusFilter
      ? 'SELECT * FROM product_queue WHERE category = ? AND status = ? ORDER BY priority ASC, updated_at ASC'
      : 'SELECT * FROM product_queue WHERE category = ? ORDER BY priority ASC, updated_at ASC';
    const rows = statusFilter
      ? this.db.prepare(sql).all(this.category, statusFilter)
      : this.db.prepare(sql).all(this.category);
    for (const row of rows) {
      if (row.last_urls_attempted) try { row.last_urls_attempted = JSON.parse(row.last_urls_attempted); } catch { /* */ }
      if (row.dirty_flags) try { row.dirty_flags = JSON.parse(row.dirty_flags); } catch { /* */ }
      if (row.last_summary) try { row.last_summary = JSON.parse(row.last_summary); } catch { /* */ }
    }
    return rows;
  }

  updateQueueStatus(productId, status, extra = {}) {
    const sets = ['status = ?', "updated_at = datetime('now')"];
    const params = [status];
    for (const [key, val] of Object.entries(extra)) {
      sets.push(`${key} = ?`);
      params.push(typeof val === 'object' ? JSON.stringify(val) : val);
    }
    params.push(this.category, productId);
    this.db.prepare(`UPDATE product_queue SET ${sets.join(', ')} WHERE category = ? AND product_id = ?`).run(...params);
  }

  clearQueueByStatus(status) {
    return this.db
      .prepare('DELETE FROM product_queue WHERE category = ? AND status = ?')
      .run(this.category, status);
  }

  getQueueStats() {
    return this.db.prepare(`
      SELECT status, COUNT(*) as count, SUM(cost_usd_total) as total_cost
      FROM product_queue WHERE category = ?
      GROUP BY status
    `).all(this.category);
  }

  // --- Phase 2: Product Run Methods ---

  upsertProductRun(row) {
    // Mark previous latest as non-latest
    if (row.is_latest) {
      this.db.prepare(`UPDATE product_runs SET is_latest = 0 WHERE category = ? AND product_id = ? AND is_latest = 1`)
        .run(this.category, row.product_id);
    }
    this._upsertProductRun.run({
      category: this.category,
      product_id: row.product_id || '',
      run_id: row.run_id || '',
      is_latest: row.is_latest ? 1 : 0,
      summary_json: typeof row.summary === 'object' ? JSON.stringify(row.summary) : (row.summary_json ?? null),
      validated: row.validated ? 1 : 0,
      confidence: row.confidence ?? 0,
      cost_usd_run: row.cost_usd_run ?? 0,
      sources_attempted: row.sources_attempted ?? 0,
      run_at: row.run_at || new Date().toISOString()
    });
  }

  getLatestProductRun(productId) {
    const row = this.db
      .prepare('SELECT * FROM product_runs WHERE category = ? AND product_id = ? AND is_latest = 1')
      .get(this.category, productId);
    if (row?.summary_json) try { row.summary = JSON.parse(row.summary_json); } catch { /* */ }
    return row || null;
  }

  getProductRuns(productId) {
    return this.db
      .prepare('SELECT * FROM product_runs WHERE category = ? AND product_id = ? ORDER BY run_at DESC')
      .all(this.category, productId);
  }

  // --- Phase 2: Product Catalog Methods ---

  upsertProduct(row) {
    this._upsertProduct.run({
      category: row.category || this.category,
      product_id: row.product_id || '',
      brand: row.brand ?? '',
      model: row.model ?? '',
      variant: row.variant ?? '',
      status: row.status || 'active',
      seed_urls: Array.isArray(row.seed_urls) ? JSON.stringify(row.seed_urls) : (row.seed_urls ?? null),
      identifier: row.identifier ?? null
    });
  }

  getProduct(productId) {
    return this.db
      .prepare('SELECT * FROM products WHERE category = ? AND product_id = ?')
      .get(this.category, productId) || null;
  }

  getAllProducts(statusFilter) {
    const sql = statusFilter
      ? 'SELECT * FROM products WHERE category = ? AND status = ? ORDER BY product_id'
      : 'SELECT * FROM products WHERE category = ? ORDER BY product_id';
    return statusFilter
      ? this.db.prepare(sql).all(this.category, statusFilter)
      : this.db.prepare(sql).all(this.category);
  }

  // --- Phase 2: Audit Log ---

  insertAuditLog(entry) {
    this.db.prepare(`
      INSERT INTO audit_log (
        category, entity_type, entity_id, field_changed, old_value, new_value,
        change_type, actor_type, actor_id, run_id, note,
        product_id, component_type, component_name, field_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.category || this.category,
      entry.entity_type, entry.entity_id,
      entry.field_changed ?? null, entry.old_value ?? null, entry.new_value ?? null,
      entry.change_type || 'update',
      entry.actor_type || 'system', entry.actor_id ?? null,
      entry.run_id ?? null, entry.note ?? null,
      entry.product_id ?? null, entry.component_type ?? null,
      entry.component_name ?? null, entry.field_key ?? null
    );
  }

  // --- Phase 2: Staleness marking for cascade ---

  markProductsStale(productIds, dirtyFlag) {
    if (!productIds.length) return;
    const tx = this.db.transaction(() => {
      for (const pid of productIds) {
        const existing = this.db.prepare(
          'SELECT dirty_flags FROM product_queue WHERE category = ? AND product_id = ?'
        ).get(this.category, pid);
        let flags = [];
        if (existing?.dirty_flags) {
          try { flags = JSON.parse(existing.dirty_flags); } catch { flags = []; }
        }
        if (!flags.includes(dirtyFlag)) flags.push(dirtyFlag);
        if (existing) {
          this.db.prepare(
            `UPDATE product_queue SET dirty_flags = ?, status = CASE WHEN status IN ('complete','exhausted') THEN 'queued' ELSE status END, updated_at = datetime('now') WHERE category = ? AND product_id = ?`
          ).run(JSON.stringify(flags), this.category, pid);
        }
      }
    });
    tx();
  }

  // --- Phase 2: Curation Suggestions ---

  upsertCurationSuggestion(row) {
    this.db.prepare(`
      INSERT INTO curation_suggestions (
        suggestion_id, category, suggestion_type, field_key, component_type,
        value, normalized_value, status, source, product_id, run_id,
        first_seen_at, last_seen_at
      ) VALUES (
        @suggestion_id, @category, @suggestion_type, @field_key, @component_type,
        @value, @normalized_value, @status, @source, @product_id, @run_id,
        @first_seen_at, @last_seen_at
      )
      ON CONFLICT(category, suggestion_type, field_key, value) DO UPDATE SET
        normalized_value = COALESCE(excluded.normalized_value, normalized_value),
        last_seen_at = excluded.last_seen_at,
        product_id = COALESCE(excluded.product_id, product_id),
        run_id = COALESCE(excluded.run_id, run_id),
        updated_at = datetime('now')
    `).run({
      suggestion_id: row.suggestion_id || '',
      category: row.category || this.category,
      suggestion_type: row.suggestion_type || 'enum_value',
      field_key: row.field_key ?? null,
      component_type: row.component_type ?? null,
      value: row.value || '',
      normalized_value: row.normalized_value ?? null,
      status: row.status || 'pending',
      source: row.source ?? null,
      product_id: row.product_id ?? null,
      run_id: row.run_id ?? null,
      first_seen_at: row.first_seen_at || new Date().toISOString(),
      last_seen_at: row.last_seen_at || new Date().toISOString()
    });
  }

  getCurationSuggestions(suggestionType, statusFilter) {
    const sql = statusFilter
      ? 'SELECT * FROM curation_suggestions WHERE category = ? AND suggestion_type = ? AND status = ? ORDER BY field_key, value'
      : 'SELECT * FROM curation_suggestions WHERE category = ? AND suggestion_type = ? ORDER BY field_key, value';
    return statusFilter
      ? this.db.prepare(sql).all(this.category, suggestionType, statusFilter)
      : this.db.prepare(sql).all(this.category, suggestionType);
  }

  updateCurationSuggestionStatus(suggestionType, fieldKey, value, status, extra = {}) {
    const sets = ['status = ?', "updated_at = datetime('now')"];
    const params = [status];
    if (extra.reviewed_by) { sets.push('reviewed_by = ?'); params.push(extra.reviewed_by); }
    if (extra.reviewed_at) { sets.push('reviewed_at = ?'); params.push(extra.reviewed_at); }
    if (extra.review_note) { sets.push('review_note = ?'); params.push(extra.review_note); }
    params.push(this.category, suggestionType, fieldKey || '', value || '');
    this.db.prepare(`UPDATE curation_suggestions SET ${sets.join(', ')} WHERE category = ? AND suggestion_type = ? AND field_key = ? AND value = ?`).run(...params);
  }

  // --- Phase 2: Component Review Queue ---

  upsertComponentReviewItem(row) {
    this.db.prepare(`
      INSERT INTO component_review_queue (
        review_id, category, component_type, field_key, raw_query, matched_component,
        match_type, name_score, property_score, combined_score,
        alternatives, product_id, run_id, status,
        product_attributes, reasoning_note
      ) VALUES (
        @review_id, @category, @component_type, @field_key, @raw_query, @matched_component,
        @match_type, @name_score, @property_score, @combined_score,
        @alternatives, @product_id, @run_id, @status,
        @product_attributes, @reasoning_note
      )
      ON CONFLICT(review_id) DO UPDATE SET
        name_score = COALESCE(excluded.name_score, name_score),
        property_score = COALESCE(excluded.property_score, property_score),
        combined_score = COALESCE(excluded.combined_score, combined_score),
        updated_at = datetime('now')
    `).run({
      review_id: row.review_id || '',
      category: row.category || this.category,
      component_type: row.component_type || '',
      field_key: row.field_key ?? null,
      raw_query: row.raw_query || '',
      matched_component: row.matched_component ?? null,
      match_type: row.match_type || 'fuzzy_flagged',
      name_score: row.name_score ?? 0,
      property_score: row.property_score ?? 0,
      combined_score: row.combined_score ?? 0,
      alternatives: Array.isArray(row.alternatives) ? JSON.stringify(row.alternatives) : (row.alternatives ?? null),
      product_id: row.product_id ?? null,
      run_id: row.run_id ?? null,
      status: row.status || 'pending_ai',
      product_attributes: row.product_attributes && typeof row.product_attributes === 'object' ? JSON.stringify(row.product_attributes) : (row.product_attributes ?? null),
      reasoning_note: row.reasoning_note ?? null
    });
  }

  getComponentReviewItems(componentType, statusFilter) {
    const sql = statusFilter
      ? 'SELECT * FROM component_review_queue WHERE category = ? AND component_type = ? AND status = ? ORDER BY combined_score DESC'
      : 'SELECT * FROM component_review_queue WHERE category = ? AND component_type = ? ORDER BY combined_score DESC';
    const rows = statusFilter
      ? this.db.prepare(sql).all(this.category, componentType, statusFilter)
      : this.db.prepare(sql).all(this.category, componentType);
    for (const row of rows) {
      if (row.alternatives) try { row.alternatives = JSON.parse(row.alternatives); } catch { /* */ }
      if (row.product_attributes) try { row.product_attributes = JSON.parse(row.product_attributes); } catch { /* */ }
    }
    return rows;
  }

  // --- Phase 2: Cascade helpers ---

  /** Find products that have a given field value in item_field_state */
  getProductsByFieldValue(fieldKey, value) {
    return this.db
      .prepare(`
        SELECT DISTINCT product_id
        FROM item_field_state
        WHERE category = ?
          AND field_key = ?
          AND value IS NOT NULL
          AND LOWER(TRIM(value)) = LOWER(TRIM(?))
      `)
      .all(this.category, fieldKey, value)
      .map(r => r.product_id);
  }

  /** Mark specific products stale with a detailed dirty flag object */
  markProductsStaleDetailed(productIds, dirtyFlagObj) {
    if (!productIds.length) return;
    const tx = this.db.transaction(() => {
      for (const pid of productIds) {
        const existing = this.db.prepare(
          'SELECT dirty_flags, status, priority FROM product_queue WHERE category = ? AND product_id = ?'
        ).get(this.category, pid);
        if (!existing) continue;
        let flags = [];
        if (existing.dirty_flags) {
          try { flags = JSON.parse(existing.dirty_flags); } catch { flags = []; }
        }
        flags.push(dirtyFlagObj);
        const newPriority = Math.min(existing.priority || 99, dirtyFlagObj.priority || 3);
        this.db.prepare(
          `UPDATE product_queue SET dirty_flags = ?, status = 'stale', priority = ?, updated_at = datetime('now') WHERE category = ? AND product_id = ? AND status IN ('complete','stale','pending','exhausted')`
        ).run(JSON.stringify(flags), newPriority, this.category, pid);
      }
    });
    tx();
  }

  // --- LLM Route Matrix ---

  _normalizeLlmRouteRow(row, idx = 0) {
    const scope = ['field', 'component', 'list'].includes(String(row?.scope || '').toLowerCase())
      ? String(row.scope).toLowerCase()
      : 'field';
    const effort = Math.max(1, Math.min(10, Number.parseInt(String(row?.effort ?? 3), 10) || 3));
    const defaults = baseLlmRoute({
      category: this.category,
      scope,
      required_level: String(row?.required_level || 'expected').toLowerCase(),
      difficulty: String(row?.difficulty || 'medium').toLowerCase(),
      availability: String(row?.availability || 'expected').toLowerCase(),
      effort,
      model_ladder_today: String(row?.model_ladder_today || 'gpt-5-low -> gpt-5-medium'),
      single_source_data: row?.single_source_data,
      all_source_data: row?.all_source_data,
      enable_websearch: row?.enable_websearch,
      all_sources_confidence_repatch: row?.all_sources_confidence_repatch,
      max_tokens: row?.max_tokens ?? 4096,
      scalar_linked_send: String(row?.scalar_linked_send || 'scalar value + prime sources'),
      component_values_send: String(row?.component_values_send || 'component values + prime sources'),
      list_values_send: String(row?.list_values_send || 'list values prime sources'),
      llm_output_min_evidence_refs_required: row?.llm_output_min_evidence_refs_required ?? 1,
      insufficient_evidence_action: String(row?.insufficient_evidence_action || 'threshold_unmet'),
      route_key: String(row?.route_key || makeRouteKey(
        scope,
        String(row?.required_level || 'expected').toLowerCase(),
        String(row?.difficulty || 'medium').toLowerCase(),
        String(row?.availability || 'expected').toLowerCase(),
        String(row?.effort_band || toBand(effort)),
        idx + 1
      ))
    });
    const normalized = {
      ...defaults,
      route_key: String(defaults.route_key).trim() || makeRouteKey(scope, defaults.required_level, defaults.difficulty, defaults.availability, defaults.effort_band, idx + 1),
      effort_band: String(row?.effort_band || toBand(effort)),
      max_tokens: Math.max(256, Math.min(65536, Number.parseInt(String(row?.max_tokens ?? defaults.max_tokens), 10) || defaults.max_tokens)),
      llm_output_min_evidence_refs_required: Math.max(1, Math.min(5, Number.parseInt(String(row?.llm_output_min_evidence_refs_required ?? defaults.llm_output_min_evidence_refs_required), 10) || defaults.llm_output_min_evidence_refs_required))
    };

    for (const key of LLM_ROUTE_BOOLEAN_KEYS) {
      normalized[key] = toBoolInt(row?.[key], defaults[key]);
    }
    return normalized;
  }

  _hydrateLlmRouteRow(row) {
    const out = { ...row };
    for (const key of LLM_ROUTE_BOOLEAN_KEYS) {
      out[key] = Number(row[key]) === 1;
    }
    return out;
  }

  ensureDefaultLlmRouteMatrix() {
    const countRow = this.db
      .prepare('SELECT COUNT(*) as c FROM llm_route_matrix WHERE category = ?')
      .get(this.category);
    if ((countRow?.c || 0) > 0) return;
    const defaults = buildDefaultLlmRoutes(this.category);
    const tx = this.db.transaction((rows) => {
      for (const [idx, row] of rows.entries()) {
        this._upsertLlmRoute.run(this._normalizeLlmRouteRow(row, idx));
      }
    });
    tx(defaults);
  }

  getLlmRouteMatrix(scope) {
    this.ensureDefaultLlmRouteMatrix();
    const scopeToken = String(scope || '').trim().toLowerCase();
    const rows = scopeToken
      ? this.db
          .prepare('SELECT * FROM llm_route_matrix WHERE category = ? AND scope = ? ORDER BY id ASC')
          .all(this.category, scopeToken)
      : this.db
          .prepare('SELECT * FROM llm_route_matrix WHERE category = ? ORDER BY id ASC')
          .all(this.category);
    return rows.map((row) => this._hydrateLlmRouteRow(row));
  }

  saveLlmRouteMatrix(rows = []) {
    const list = Array.isArray(rows) ? rows : [];
    const tx = this.db.transaction((items) => {
      this.db.prepare('DELETE FROM llm_route_matrix WHERE category = ?').run(this.category);
      for (const [idx, row] of items.entries()) {
        this._upsertLlmRoute.run(this._normalizeLlmRouteRow(row, idx));
      }
    });
    tx(list);
    return this.getLlmRouteMatrix();
  }

  resetLlmRouteMatrixToDefaults() {
    this.db.prepare('DELETE FROM llm_route_matrix WHERE category = ?').run(this.category);
    this.ensureDefaultLlmRouteMatrix();
    return this.getLlmRouteMatrix();
  }

  // --- Utility ---

  // --- Source Capture Methods ---

  upsertSourceRegistry({ sourceId, category, itemIdentifier, productId, runId, sourceUrl, sourceHost, sourceRootDomain, sourceTier, sourceMethod, crawlStatus, httpStatus, fetchedAt }) {
    this._upsertSourceRegistry.run({
      source_id: sourceId,
      category: category || this.category,
      item_identifier: itemIdentifier || '',
      product_id: productId ?? null,
      run_id: runId ?? null,
      source_url: sourceUrl || '',
      source_host: sourceHost ?? null,
      source_root_domain: sourceRootDomain ?? null,
      source_tier: sourceTier ?? null,
      source_method: sourceMethod ?? null,
      crawl_status: crawlStatus || 'fetched',
      http_status: httpStatus ?? null,
      fetched_at: fetchedAt ?? null
    });
  }

  insertSourceArtifact({ sourceId, artifactType, localPath, contentHash, mimeType, sizeBytes }) {
    this._insertSourceArtifact.run({
      source_id: sourceId,
      artifact_type: artifactType,
      local_path: localPath,
      content_hash: contentHash ?? null,
      mime_type: mimeType ?? null,
      size_bytes: sizeBytes ?? null
    });
  }

  upsertSourceAssertion({
    assertionId,
    sourceId,
    fieldKey,
    contextKind,
    contextRef,
    itemFieldStateId,
    componentValueId,
    listValueId,
    enumListId,
    valueRaw,
    valueNormalized,
    unit,
    candidateId,
    extractionMethod
  }) {
    this._upsertSourceAssertion.run({
      assertion_id: assertionId,
      source_id: sourceId,
      field_key: fieldKey,
      context_kind: contextKind || 'scalar',
      context_ref: contextRef ?? null,
      item_field_state_id: itemFieldStateId ?? null,
      component_value_id: componentValueId ?? null,
      list_value_id: listValueId ?? null,
      enum_list_id: enumListId ?? null,
      value_raw: valueRaw ?? null,
      value_normalized: valueNormalized ?? null,
      unit: unit ?? null,
      candidate_id: candidateId ?? null,
      extraction_method: extractionMethod ?? null
    });
  }

  insertSourceEvidenceRef({ assertionId, evidenceUrl, snippetId, quote, method, tier, retrievedAt }) {
    this._insertSourceEvidenceRef.run({
      assertion_id: assertionId,
      evidence_url: evidenceUrl ?? null,
      snippet_id: snippetId ?? null,
      quote: quote ?? null,
      method: method ?? null,
      tier: tier ?? null,
      retrieved_at: retrievedAt ?? null
    });
  }

  getSourcesForItem(itemIdentifier) {
    return this.db
      .prepare('SELECT * FROM source_registry WHERE category = ? AND item_identifier = ? ORDER BY source_tier ASC, source_host')
      .all(this.category, itemIdentifier);
  }

  getAssertionsForSource(sourceId) {
    return this.db
      .prepare('SELECT * FROM source_assertions WHERE source_id = ? ORDER BY field_key')
      .all(sourceId);
  }

  // --- Key Review Methods ---

  upsertKeyReviewState(row) {
    const targetKind = row.targetKind || row.target_kind;
    const category = row.category || this.category;
    const itemFieldStateId = toPositiveInteger(row.itemFieldStateId ?? row.item_field_state_id);
    const componentValueId = toPositiveInteger(row.componentValueId ?? row.component_value_id);
    const componentIdentityId = toPositiveInteger(row.componentIdentityId ?? row.component_identity_id);
    const listValueId = toPositiveInteger(row.listValueId ?? row.list_value_id);
    const enumListId = toPositiveInteger(row.enumListId ?? row.enum_list_id);
    const propertyKey = String(row.propertyKey ?? row.property_key ?? '').trim() || null;

    let existing = null;
    if (targetKind === 'grid_key') {
      if (!itemFieldStateId) {
        throw new Error('itemFieldStateId is required for grid key review state upsert.');
      }
      existing = this.db.prepare(
        "SELECT id FROM key_review_state WHERE category = ? AND target_kind = 'grid_key' AND item_field_state_id = ?"
      ).get(category, itemFieldStateId);
    } else if (targetKind === 'enum_key') {
      if (!listValueId) {
        throw new Error('listValueId is required for enum key review state upsert.');
      }
      existing = this.db.prepare(
        "SELECT id FROM key_review_state WHERE category = ? AND target_kind = 'enum_key' AND list_value_id = ?"
      ).get(category, listValueId);
    } else if (targetKind === 'component_key') {
      if (componentValueId) {
        existing = this.db.prepare(
          "SELECT id FROM key_review_state WHERE category = ? AND target_kind = 'component_key' AND component_value_id = ?"
        ).get(category, componentValueId);
      } else if (componentIdentityId && propertyKey) {
        existing = this.db.prepare(
          "SELECT id FROM key_review_state WHERE category = ? AND target_kind = 'component_key' AND component_identity_id = ? AND property_key = ?"
        ).get(category, componentIdentityId, propertyKey);
      } else {
        throw new Error('componentValueId or (componentIdentityId + propertyKey) is required for component key review state upsert.');
      }
    } else {
      throw new Error(`Unsupported key review targetKind '${targetKind}'.`);
    }

    const params = {
      category,
      target_kind: targetKind,
      item_identifier: row.itemIdentifier ?? row.item_identifier ?? null,
      field_key: row.fieldKey || row.field_key || '',
      enum_value_norm: row.enumValueNorm ?? row.enum_value_norm ?? null,
      component_identifier: row.componentIdentifier ?? row.component_identifier ?? null,
      property_key: propertyKey,
      item_field_state_id: itemFieldStateId,
      component_value_id: componentValueId,
      component_identity_id: componentIdentityId,
      list_value_id: listValueId,
      enum_list_id: enumListId,
      required_level: row.requiredLevel ?? row.required_level ?? null,
      availability: row.availability ?? null,
      difficulty: row.difficulty ?? null,
      effort: row.effort ?? null,
      ai_mode: row.aiMode ?? row.ai_mode ?? null,
      parse_template: row.parseTemplate ?? row.parse_template ?? null,
      evidence_policy: row.evidencePolicy ?? row.evidence_policy ?? null,
      min_evidence_refs_effective: row.minEvidenceRefsEffective ?? row.min_evidence_refs_effective ?? 1,
      min_distinct_sources_required: row.minDistinctSourcesRequired ?? row.min_distinct_sources_required ?? 1,
      send_mode: row.sendMode ?? row.send_mode ?? null,
      component_send_mode: row.componentSendMode ?? row.component_send_mode ?? null,
      list_send_mode: row.listSendMode ?? row.list_send_mode ?? null,
      selected_value: row.selectedValue ?? row.selected_value ?? null,
      selected_candidate_id: row.selectedCandidateId ?? row.selected_candidate_id ?? null,
      confidence_score: row.confidenceScore ?? row.confidence_score ?? 0,
      confidence_level: row.confidenceLevel ?? row.confidence_level ?? null,
      flagged_at: row.flaggedAt ?? row.flagged_at ?? null,
      resolved_at: row.resolvedAt ?? row.resolved_at ?? null,
      ai_confirm_primary_status: row.aiConfirmPrimaryStatus ?? row.ai_confirm_primary_status ?? null,
      ai_confirm_primary_confidence: row.aiConfirmPrimaryConfidence ?? row.ai_confirm_primary_confidence ?? null,
      ai_confirm_primary_at: row.aiConfirmPrimaryAt ?? row.ai_confirm_primary_at ?? null,
      ai_confirm_primary_interrupted: row.aiConfirmPrimaryInterrupted ?? row.ai_confirm_primary_interrupted ?? 0,
      ai_confirm_primary_error: row.aiConfirmPrimaryError ?? row.ai_confirm_primary_error ?? null,
      ai_confirm_shared_status: row.aiConfirmSharedStatus ?? row.ai_confirm_shared_status ?? null,
      ai_confirm_shared_confidence: row.aiConfirmSharedConfidence ?? row.ai_confirm_shared_confidence ?? null,
      ai_confirm_shared_at: row.aiConfirmSharedAt ?? row.ai_confirm_shared_at ?? null,
      ai_confirm_shared_interrupted: row.aiConfirmSharedInterrupted ?? row.ai_confirm_shared_interrupted ?? 0,
      ai_confirm_shared_error: row.aiConfirmSharedError ?? row.ai_confirm_shared_error ?? null,
      user_accept_primary_status: row.userAcceptPrimaryStatus ?? row.user_accept_primary_status ?? null,
      user_accept_primary_at: row.userAcceptPrimaryAt ?? row.user_accept_primary_at ?? null,
      user_accept_primary_by: row.userAcceptPrimaryBy ?? row.user_accept_primary_by ?? null,
      user_accept_shared_status: row.userAcceptSharedStatus ?? row.user_accept_shared_status ?? null,
      user_accept_shared_at: row.userAcceptSharedAt ?? row.user_accept_shared_at ?? null,
      user_accept_shared_by: row.userAcceptSharedBy ?? row.user_accept_shared_by ?? null,
      user_override_ai_primary: row.userOverrideAiPrimary ?? row.user_override_ai_primary ?? 0,
      user_override_ai_primary_at: row.userOverrideAiPrimaryAt ?? row.user_override_ai_primary_at ?? null,
      user_override_ai_primary_reason: row.userOverrideAiPrimaryReason ?? row.user_override_ai_primary_reason ?? null,
      user_override_ai_shared: row.userOverrideAiShared ?? row.user_override_ai_shared ?? 0,
      user_override_ai_shared_at: row.userOverrideAiSharedAt ?? row.user_override_ai_shared_at ?? null,
      user_override_ai_shared_reason: row.userOverrideAiSharedReason ?? row.user_override_ai_shared_reason ?? null,
    };

    if (existing) {
      // Update existing row
      this.db.prepare(`
        UPDATE key_review_state SET
          item_field_state_id = COALESCE(@item_field_state_id, item_field_state_id),
          component_value_id = COALESCE(@component_value_id, component_value_id),
          component_identity_id = COALESCE(@component_identity_id, component_identity_id),
          list_value_id = COALESCE(@list_value_id, list_value_id),
          enum_list_id = COALESCE(@enum_list_id, enum_list_id),
          required_level = @required_level, availability = @availability, difficulty = @difficulty,
          effort = @effort, ai_mode = @ai_mode, parse_template = @parse_template,
          evidence_policy = @evidence_policy, min_evidence_refs_effective = @min_evidence_refs_effective,
          min_distinct_sources_required = @min_distinct_sources_required,
          send_mode = @send_mode, component_send_mode = @component_send_mode, list_send_mode = @list_send_mode,
          selected_value = @selected_value, selected_candidate_id = @selected_candidate_id,
          confidence_score = @confidence_score, confidence_level = @confidence_level,
          flagged_at = @flagged_at, resolved_at = @resolved_at,
          ai_confirm_primary_status = @ai_confirm_primary_status,
          ai_confirm_primary_confidence = @ai_confirm_primary_confidence,
          ai_confirm_primary_at = @ai_confirm_primary_at,
          ai_confirm_primary_interrupted = @ai_confirm_primary_interrupted,
          ai_confirm_primary_error = @ai_confirm_primary_error,
          ai_confirm_shared_status = @ai_confirm_shared_status,
          ai_confirm_shared_confidence = @ai_confirm_shared_confidence,
          ai_confirm_shared_at = @ai_confirm_shared_at,
          ai_confirm_shared_interrupted = @ai_confirm_shared_interrupted,
          ai_confirm_shared_error = @ai_confirm_shared_error,
          user_accept_primary_status = @user_accept_primary_status,
          user_accept_primary_at = @user_accept_primary_at,
          user_accept_primary_by = @user_accept_primary_by,
          user_accept_shared_status = @user_accept_shared_status,
          user_accept_shared_at = @user_accept_shared_at,
          user_accept_shared_by = @user_accept_shared_by,
          user_override_ai_primary = @user_override_ai_primary,
          user_override_ai_primary_at = @user_override_ai_primary_at,
          user_override_ai_primary_reason = @user_override_ai_primary_reason,
          user_override_ai_shared = @user_override_ai_shared,
          user_override_ai_shared_at = @user_override_ai_shared_at,
          user_override_ai_shared_reason = @user_override_ai_shared_reason,
          updated_at = datetime('now')
        WHERE id = @id
      `).run({ ...params, id: existing.id });
      return existing.id;
    } else {
      const info = this._insertKeyReviewState.run(params);
      return info.lastInsertRowid;
    }
  }

  getKeyReviewState({
    category,
    targetKind,
    propertyKey,
    itemFieldStateId,
    componentValueId,
    componentIdentityId,
    listValueId,
  }) {
    const cat = category || this.category;
    if (targetKind === 'grid_key') {
      const slotId = toPositiveInteger(itemFieldStateId);
      if (!slotId) return null;
      return this.db.prepare(
        "SELECT * FROM key_review_state WHERE category = ? AND target_kind = 'grid_key' AND item_field_state_id = ?"
      ).get(cat, slotId) || null;
    } else if (targetKind === 'enum_key') {
      const slotId = toPositiveInteger(listValueId);
      if (!slotId) return null;
      return this.db.prepare(
        "SELECT * FROM key_review_state WHERE category = ? AND target_kind = 'enum_key' AND list_value_id = ?"
      ).get(cat, slotId) || null;
    } else if (targetKind === 'component_key') {
      const valueSlotId = toPositiveInteger(componentValueId);
      if (valueSlotId) {
        return this.db.prepare(
          "SELECT * FROM key_review_state WHERE category = ? AND target_kind = 'component_key' AND component_value_id = ?"
        ).get(cat, valueSlotId) || null;
      }
      const identitySlotId = toPositiveInteger(componentIdentityId);
      const normalizedPropertyKey = String(propertyKey || '').trim();
      if (!identitySlotId || !normalizedPropertyKey) return null;
      return this.db.prepare(
        "SELECT * FROM key_review_state WHERE category = ? AND target_kind = 'component_key' AND component_identity_id = ? AND property_key = ?"
      ).get(cat, identitySlotId, normalizedPropertyKey) || null;
    }
    return null;
  }

  getKeyReviewStatesForItem(itemIdentifier) {
    return this.db.prepare(
      "SELECT * FROM key_review_state WHERE category = ? AND target_kind = 'grid_key' AND item_identifier = ? ORDER BY field_key"
    ).all(this.category, itemIdentifier);
  }

  getKeyReviewStatesForField(fieldKey, targetKind) {
    if (targetKind) {
      return this.db.prepare(
        'SELECT * FROM key_review_state WHERE category = ? AND target_kind = ? AND field_key = ? ORDER BY item_identifier, enum_value_norm'
      ).all(this.category, targetKind, fieldKey);
    }
    return this.db.prepare(
      'SELECT * FROM key_review_state WHERE category = ? AND field_key = ? ORDER BY target_kind, item_identifier, enum_value_norm'
    ).all(this.category, fieldKey);
  }

  getKeyReviewStatesForComponent(componentIdentifier) {
    return this.db.prepare(
      "SELECT * FROM key_review_state WHERE category = ? AND target_kind = 'component_key' AND component_identifier = ? ORDER BY property_key"
    ).all(this.category, componentIdentifier);
  }

  getKeyReviewStatesForEnum(fieldKey) {
    return this.db.prepare(
      "SELECT * FROM key_review_state WHERE category = ? AND target_kind = 'enum_key' AND field_key = ? ORDER BY enum_value_norm"
    ).all(this.category, fieldKey);
  }

  updateKeyReviewAiConfirm({ id, lane, status, confidence, at, error }) {
    const col = lane === 'shared' ? 'shared' : 'primary';
    this.db.prepare(`
      UPDATE key_review_state SET
        ai_confirm_${col}_status = ?,
        ai_confirm_${col}_confidence = ?,
        ai_confirm_${col}_at = ?,
        ai_confirm_${col}_error = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(status, confidence ?? null, at ?? new Date().toISOString(), error ?? null, id);
  }

  updateKeyReviewUserAccept({ id, lane, status, at, by }) {
    const col = lane === 'shared' ? 'shared' : 'primary';
    this.db.prepare(`
      UPDATE key_review_state SET
        user_accept_${col}_status = ?,
        user_accept_${col}_at = ?,
        user_accept_${col}_by = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(status, at ?? new Date().toISOString(), by ?? null, id);
  }

  updateKeyReviewOverrideAi({ id, lane, reason }) {
    const col = lane === 'shared' ? 'shared' : 'primary';
    this.db.prepare(`
      UPDATE key_review_state SET
        user_override_ai_${col} = 1,
        user_override_ai_${col}_at = datetime('now'),
        user_override_ai_${col}_reason = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(reason ?? null, id);
  }

  insertKeyReviewRun({ keyReviewStateId, stage, status, provider, modelUsed, promptHash, responseSchemaVersion, inputTokens, outputTokens, latencyMs, costUsd, error, startedAt, finishedAt }) {
    const info = this._insertKeyReviewRun.run({
      key_review_state_id: keyReviewStateId,
      stage: stage || 'extract',
      status: status || 'pending',
      provider: provider ?? null,
      model_used: modelUsed ?? null,
      prompt_hash: promptHash ?? null,
      response_schema_version: responseSchemaVersion ?? null,
      input_tokens: inputTokens ?? null,
      output_tokens: outputTokens ?? null,
      latency_ms: latencyMs ?? null,
      cost_usd: costUsd ?? null,
      error: error ?? null,
      started_at: startedAt ?? null,
      finished_at: finishedAt ?? null
    });
    return info.lastInsertRowid;
  }

  insertKeyReviewRunSource({ keyReviewRunId, assertionId, packetRole, position }) {
    this._insertKeyReviewRunSource.run({
      key_review_run_id: keyReviewRunId,
      assertion_id: assertionId,
      packet_role: packetRole ?? null,
      position: position ?? null
    });
  }

  insertKeyReviewAudit({ keyReviewStateId, eventType, actorType, actorId, oldValue, newValue, reason }) {
    this._insertKeyReviewAudit.run({
      key_review_state_id: keyReviewStateId,
      event_type: eventType,
      actor_type: actorType || 'system',
      actor_id: actorId ?? null,
      old_value: oldValue ?? null,
      new_value: newValue ?? null,
      reason: reason ?? null
    });
  }

  /**
   * Clear slot/state candidate pointers that no longer map to a valid candidate row.
   * This protects UI lane actions from stale IDs after reseed/reset cycles.
   */
  pruneOrphanCandidateReferences() {
    const category = this.category;
    const result = {
      itemFieldStateCleared: 0,
      componentValueCleared: 0,
      listValueCleared: 0,
      keyReviewStateCleared: 0,
    };

    const tx = this.db.transaction(() => {
      result.itemFieldStateCleared = this.db.prepare(`
        UPDATE item_field_state
        SET accepted_candidate_id = NULL,
            updated_at = datetime('now')
        WHERE category = ?
          AND accepted_candidate_id IS NOT NULL
          AND TRIM(accepted_candidate_id) <> ''
          AND NOT EXISTS (
            SELECT 1
            FROM candidates c
            WHERE c.category = item_field_state.category
              AND c.candidate_id = item_field_state.accepted_candidate_id
              AND c.product_id = item_field_state.product_id
              AND c.field_key = item_field_state.field_key
          )
      `).run(category).changes;

      result.componentValueCleared = this.db.prepare(`
        UPDATE component_values
        SET accepted_candidate_id = NULL,
            updated_at = datetime('now')
        WHERE category = ?
          AND accepted_candidate_id IS NOT NULL
          AND TRIM(accepted_candidate_id) <> ''
          AND NOT EXISTS (
            SELECT 1
            FROM candidates c
            WHERE c.category = component_values.category
              AND c.candidate_id = component_values.accepted_candidate_id
              AND c.field_key = component_values.property_key
          )
      `).run(category).changes;

      result.listValueCleared = this.db.prepare(`
        UPDATE list_values
        SET accepted_candidate_id = NULL,
            updated_at = datetime('now')
        WHERE category = ?
          AND accepted_candidate_id IS NOT NULL
          AND TRIM(accepted_candidate_id) <> ''
          AND NOT EXISTS (
            SELECT 1
            FROM candidates c
            WHERE c.category = list_values.category
              AND c.candidate_id = list_values.accepted_candidate_id
              AND c.field_key = list_values.field_key
          )
      `).run(category).changes;

      result.keyReviewStateCleared = this.db.prepare(`
        UPDATE key_review_state
        SET selected_candidate_id = NULL,
            updated_at = datetime('now')
        WHERE category = ?
          AND selected_candidate_id IS NOT NULL
          AND TRIM(selected_candidate_id) <> ''
          AND (
            NOT EXISTS (
              SELECT 1
              FROM candidates c
              WHERE c.category = key_review_state.category
                AND c.candidate_id = key_review_state.selected_candidate_id
            )
            OR (
              target_kind = 'grid_key'
              AND (
                key_review_state.item_field_state_id IS NULL
                OR NOT EXISTS (
                SELECT 1
                FROM candidates c
                WHERE c.category = key_review_state.category
                  AND c.candidate_id = key_review_state.selected_candidate_id
                  AND EXISTS (
                    SELECT 1
                    FROM item_field_state ifs
                    WHERE ifs.id = key_review_state.item_field_state_id
                      AND ifs.category = key_review_state.category
                      AND c.product_id = ifs.product_id
                      AND c.field_key = ifs.field_key
                  )
              )
              )
            )
            OR (
              target_kind = 'enum_key'
              AND (
                key_review_state.list_value_id IS NULL
                OR NOT EXISTS (
                SELECT 1
                FROM candidates c
                WHERE c.category = key_review_state.category
                  AND c.candidate_id = key_review_state.selected_candidate_id
                  AND EXISTS (
                    SELECT 1
                    FROM list_values lv
                    WHERE lv.id = key_review_state.list_value_id
                      AND lv.category = key_review_state.category
                      AND c.field_key = lv.field_key
                  )
              )
              )
            )
            OR (
              target_kind = 'component_key'
              AND property_key NOT IN ('__name', '__maker', '__links', '__aliases')
              AND (
                key_review_state.component_value_id IS NULL
                OR NOT EXISTS (
                SELECT 1
                FROM candidates c
                WHERE c.category = key_review_state.category
                  AND c.candidate_id = key_review_state.selected_candidate_id
                  AND EXISTS (
                    SELECT 1
                    FROM component_values cv
                    WHERE cv.id = key_review_state.component_value_id
                      AND cv.category = key_review_state.category
                      AND c.field_key = cv.property_key
                  )
              )
              )
            )
            OR (
              target_kind = 'component_key'
              AND property_key IN ('__name', '__maker', '__links', '__aliases')
              AND key_review_state.component_identity_id IS NULL
            )
          )
      `).run(category).changes;
    });
    tx();
    return result;
  }

  counts() {
    const tables = [
      'candidates', 'candidate_reviews', 'component_values', 'component_identity',
      'component_aliases', 'enum_lists', 'list_values', 'item_field_state', 'item_component_links',
      'item_list_links', 'product_queue', 'product_runs', 'products', 'audit_log',
      'curation_suggestions', 'component_review_queue', 'artifacts', 'llm_route_matrix',
      'source_registry', 'source_artifacts', 'source_assertions', 'source_evidence_refs',
      'key_review_state', 'key_review_runs', 'key_review_run_sources', 'key_review_audit',
      'billing_entries', 'llm_cache', 'learning_profiles', 'category_brain',
      'source_intel_domains', 'source_intel_field_rewards', 'source_intel_brands',
      'source_intel_paths', 'source_corpus', 'runtime_events'
    ];
    const result = {};
    for (const table of tables) {
      try {
        const row = this.db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get();
        result[table] = row.c;
      } catch { result[table] = 0; }
    }
    return result;
  }

  /** Check if the DB has been seeded with any meaningful data */
  isSeeded() {
    const ci = this.db.prepare('SELECT COUNT(*) as c FROM component_identity WHERE category = ?').get(this.category);
    if (ci.c > 0) return true;
    const lv = this.db.prepare('SELECT COUNT(*) as c FROM list_values WHERE category = ?').get(this.category);
    if (lv.c > 0) return true;
    const ifs = this.db.prepare('SELECT COUNT(*) as c FROM item_field_state WHERE category = ?').get(this.category);
    if (ifs.c > 0) return true;
    try {
      const prod = this.db.prepare('SELECT COUNT(*) as c FROM products WHERE category = ?').get(this.category);
      if (prod.c > 0) return true;
    } catch { /* Phase 2 table may not exist yet */ }
    return false;
  }

  // --- Migration: Billing ---

  insertBillingEntry(entry) {
    this._insertBillingEntry.run({
      ts: entry.ts || new Date().toISOString(),
      month: entry.month || String(entry.ts || '').slice(0, 7),
      day: entry.day || String(entry.ts || '').slice(0, 10),
      provider: entry.provider || 'unknown',
      model: entry.model || 'unknown',
      category: entry.category || '',
      product_id: entry.product_id || entry.productId || '',
      run_id: entry.run_id || entry.runId || '',
      round: entry.round ?? 0,
      prompt_tokens: entry.prompt_tokens ?? 0,
      completion_tokens: entry.completion_tokens ?? 0,
      cached_prompt_tokens: entry.cached_prompt_tokens ?? 0,
      total_tokens: entry.total_tokens ?? 0,
      cost_usd: entry.cost_usd ?? 0,
      reason: entry.reason || 'extract',
      host: entry.host || '',
      url_count: entry.url_count ?? 0,
      evidence_chars: entry.evidence_chars ?? 0,
      estimated_usage: entry.estimated_usage ? 1 : 0,
      meta: typeof entry.meta === 'object' ? JSON.stringify(entry.meta) : (entry.meta || '{}')
    });
  }

  insertBillingEntriesBatch(entries) {
    const tx = this.db.transaction((items) => {
      for (const entry of items) { this.insertBillingEntry(entry); }
    });
    tx(entries);
  }

  getBillingRollup(month) {
    const totals = this.db.prepare(`
      SELECT COUNT(*) as calls, COALESCE(SUM(cost_usd), 0) as cost_usd,
             COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
             COALESCE(SUM(completion_tokens), 0) as completion_tokens
      FROM billing_entries WHERE month = ?
    `).get(month) || { calls: 0, cost_usd: 0, prompt_tokens: 0, completion_tokens: 0 };

    const by_day = {};
    for (const row of this.db.prepare(`
      SELECT day, COUNT(*) as calls, COALESCE(SUM(cost_usd), 0) as cost_usd,
             COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
             COALESCE(SUM(completion_tokens), 0) as completion_tokens
      FROM billing_entries WHERE month = ? GROUP BY day
    `).all(month)) {
      by_day[row.day] = { cost_usd: row.cost_usd, prompt_tokens: row.prompt_tokens, completion_tokens: row.completion_tokens, calls: row.calls };
    }

    const by_category = {};
    for (const row of this.db.prepare(`
      SELECT category, COUNT(*) as calls, COALESCE(SUM(cost_usd), 0) as cost_usd,
             COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
             COALESCE(SUM(completion_tokens), 0) as completion_tokens
      FROM billing_entries WHERE month = ? GROUP BY category
    `).all(month)) {
      by_category[row.category || ''] = { cost_usd: row.cost_usd, prompt_tokens: row.prompt_tokens, completion_tokens: row.completion_tokens, calls: row.calls };
    }

    const by_product = {};
    for (const row of this.db.prepare(`
      SELECT product_id, COUNT(*) as calls, COALESCE(SUM(cost_usd), 0) as cost_usd,
             COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
             COALESCE(SUM(completion_tokens), 0) as completion_tokens
      FROM billing_entries WHERE month = ? GROUP BY product_id
    `).all(month)) {
      by_product[row.product_id || ''] = { cost_usd: row.cost_usd, prompt_tokens: row.prompt_tokens, completion_tokens: row.completion_tokens, calls: row.calls };
    }

    const by_model = {};
    for (const row of this.db.prepare(`
      SELECT provider || ':' || model as model_key, COUNT(*) as calls, COALESCE(SUM(cost_usd), 0) as cost_usd,
             COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
             COALESCE(SUM(completion_tokens), 0) as completion_tokens
      FROM billing_entries WHERE month = ? GROUP BY model_key
    `).all(month)) {
      by_model[row.model_key] = { cost_usd: row.cost_usd, prompt_tokens: row.prompt_tokens, completion_tokens: row.completion_tokens, calls: row.calls };
    }

    const by_reason = {};
    for (const row of this.db.prepare(`
      SELECT reason, COUNT(*) as calls, COALESCE(SUM(cost_usd), 0) as cost_usd,
             COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
             COALESCE(SUM(completion_tokens), 0) as completion_tokens
      FROM billing_entries WHERE month = ? GROUP BY reason
    `).all(month)) {
      by_reason[row.reason || 'extract'] = { cost_usd: row.cost_usd, prompt_tokens: row.prompt_tokens, completion_tokens: row.completion_tokens, calls: row.calls };
    }

    return {
      month,
      generated_at: new Date().toISOString(),
      totals,
      by_day,
      by_category,
      by_product,
      by_model,
      by_reason
    };
  }

  getBillingEntriesForMonth(month) {
    return this.db.prepare('SELECT * FROM billing_entries WHERE month = ? ORDER BY ts').all(month);
  }

  getBillingSnapshot(month, productId) {
    const monthly = this.getBillingRollup(month);
    const product = monthly.by_product[productId] || { cost_usd: 0, calls: 0, prompt_tokens: 0, completion_tokens: 0 };
    return {
      month,
      monthly_cost_usd: monthly.totals.cost_usd,
      monthly_calls: monthly.totals.calls,
      product_cost_usd: product.cost_usd,
      product_calls: product.calls,
      monthly
    };
  }

  // --- Migration: LLM Cache ---

  getLlmCacheEntry(key) {
    return this._getLlmCache.get(key) || null;
  }

  setLlmCacheEntry(key, response, timestamp, ttl) {
    this._upsertLlmCache.run({
      cache_key: key,
      response: typeof response === 'string' ? response : JSON.stringify(response),
      timestamp,
      ttl
    });
  }

  evictExpiredCache(nowMs) {
    return this._evictExpiredCache.run(nowMs || Date.now());
  }

  // --- Migration: Learning Profiles ---

  upsertLearningProfile(profile) {
    this._upsertLearningProfile.run({
      profile_id: profile.profile_id || '',
      category: profile.category || this.category,
      brand: profile.identity_lock?.brand || profile.brand || '',
      model: profile.identity_lock?.model || profile.model || '',
      variant: profile.identity_lock?.variant || profile.variant || '',
      runs_total: profile.runs_total ?? 0,
      validated_runs: profile.validated_runs ?? 0,
      validated: profile.validated ? 1 : 0,
      unknown_field_rate: profile.unknown_field_rate ?? 0,
      unknown_field_rate_avg: profile.unknown_field_rate_avg ?? 0,
      parser_health_avg: profile.parser_health_avg ?? 0,
      preferred_urls: JSON.stringify(profile.preferred_urls || []),
      feedback_urls: JSON.stringify(profile.feedback_urls || []),
      uncertain_fields: JSON.stringify(profile.uncertain_fields || []),
      host_stats: JSON.stringify(profile.host_stats || []),
      critical_fields_below: JSON.stringify(profile.critical_fields_below_pass_target || profile.critical_fields_below || []),
      last_run: JSON.stringify(profile.last_run || {}),
      parser_health: JSON.stringify(profile.parser_health || {}),
      updated_at: profile.updated_at || new Date().toISOString()
    });
  }

  getLearningProfile(profileId) {
    const row = this.db.prepare('SELECT * FROM learning_profiles WHERE profile_id = ?').get(profileId);
    if (!row) return null;
    try { row.preferred_urls = JSON.parse(row.preferred_urls); } catch { row.preferred_urls = []; }
    try { row.feedback_urls = JSON.parse(row.feedback_urls); } catch { row.feedback_urls = []; }
    try { row.uncertain_fields = JSON.parse(row.uncertain_fields); } catch { row.uncertain_fields = []; }
    try { row.host_stats = JSON.parse(row.host_stats); } catch { row.host_stats = []; }
    try { row.critical_fields_below_pass_target = JSON.parse(row.critical_fields_below); } catch { row.critical_fields_below_pass_target = []; }
    try { row.last_run = JSON.parse(row.last_run); } catch { row.last_run = {}; }
    try { row.parser_health = JSON.parse(row.parser_health); } catch { row.parser_health = {}; }
    row.identity_lock = { brand: row.brand || '', model: row.model || '', variant: row.variant || '' };
    return row;
  }

  // --- Migration: Category Brain ---

  upsertCategoryBrainArtifact(category, artifactName, payload) {
    this._upsertCategoryBrain.run({
      category,
      artifact_name: artifactName,
      payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
      updated_at: new Date().toISOString()
    });
  }

  getCategoryBrainArtifacts(category) {
    const rows = this.db.prepare('SELECT * FROM category_brain WHERE category = ?').all(category);
    const result = {};
    for (const row of rows) {
      try { result[row.artifact_name] = JSON.parse(row.payload); } catch { result[row.artifact_name] = row.payload; }
    }
    return result;
  }

  getCategoryBrainArtifact(category, artifactName) {
    const row = this.db.prepare('SELECT payload FROM category_brain WHERE category = ? AND artifact_name = ?').get(category, artifactName);
    if (!row) return null;
    try { return JSON.parse(row.payload); } catch { return row.payload; }
  }

  // --- Migration: Source Corpus ---

  upsertSourceCorpusDoc(doc) {
    this._upsertSourceCorpus.run({
      url: doc.url || '',
      category: doc.category || '',
      host: doc.host || '',
      root_domain: doc.rootDomain || doc.root_domain || '',
      path: doc.path || '',
      title: doc.title || '',
      snippet: doc.snippet || '',
      tier: doc.tier ?? 99,
      role: doc.role || '',
      fields: JSON.stringify(doc.fields || []),
      methods: JSON.stringify(doc.methods || []),
      identity_match: doc.identity_match ? 1 : 0,
      approved_domain: doc.approved_domain ? 1 : 0,
      brand: doc.brand || '',
      model_name: doc.model || doc.model_name || '',
      variant: doc.variant || '',
      first_seen_at: doc.first_seen_at || doc.updated_at || new Date().toISOString(),
      last_seen_at: doc.last_seen_at || doc.updated_at || new Date().toISOString()
    });
  }

  upsertSourceCorpusBatch(docs) {
    const tx = this.db.transaction((items) => {
      for (const doc of items) { this.upsertSourceCorpusDoc(doc); }
    });
    tx(docs);
  }

  getSourceCorpusByCategory(category) {
    const rows = this.db.prepare('SELECT * FROM source_corpus WHERE category = ? ORDER BY last_seen_at DESC').all(category);
    for (const row of rows) {
      try { row.fields = JSON.parse(row.fields); } catch { row.fields = []; }
      try { row.methods = JSON.parse(row.methods); } catch { row.methods = []; }
      row.rootDomain = row.root_domain;
      row.identity_match = Boolean(row.identity_match);
      row.approved_domain = Boolean(row.approved_domain);
    }
    return rows;
  }

  getSourceCorpusCount(category) {
    const row = this.db.prepare('SELECT COUNT(*) as c FROM source_corpus WHERE category = ?').get(category);
    return row?.c || 0;
  }

  // --- Migration: Runtime Events ---

  insertRuntimeEvent(event) {
    this._insertRuntimeEvent.run({
      ts: event.ts || new Date().toISOString(),
      level: event.level || 'info',
      event: event.event || '',
      category: event.category || '',
      product_id: event.product_id || event.productId || '',
      run_id: event.run_id || event.runId || '',
      data: JSON.stringify(event.data || {})
    });
  }

  insertRuntimeEventsBatch(events) {
    const tx = this.db.transaction((items) => {
      for (const event of items) { this.insertRuntimeEvent(event); }
    });
    tx(events);
  }

  // --- Migration: Source Intelligence ---

  upsertSourceIntelDomain(entry) {
    this.db.prepare(`
      INSERT OR REPLACE INTO source_intel_domains (
        root_domain, category, attempts, http_ok_count, identity_match_count,
        major_anchor_conflict_count, fields_contributed_count, fields_accepted_count,
        accepted_critical_fields_count, products_seen, approved_attempts, candidate_attempts,
        parser_runs, parser_success_count, parser_health_score_total,
        endpoint_signal_count, endpoint_signal_score_total, planner_score, field_reward_strength,
        recent_products, per_field_helpfulness, fingerprint_counts, extra_stats,
        last_seen_at, updated_at
      ) VALUES (
        @root_domain, @category, @attempts, @http_ok_count, @identity_match_count,
        @major_anchor_conflict_count, @fields_contributed_count, @fields_accepted_count,
        @accepted_critical_fields_count, @products_seen, @approved_attempts, @candidate_attempts,
        @parser_runs, @parser_success_count, @parser_health_score_total,
        @endpoint_signal_count, @endpoint_signal_score_total, @planner_score, @field_reward_strength,
        @recent_products, @per_field_helpfulness, @fingerprint_counts, @extra_stats,
        @last_seen_at, @updated_at
      )
    `).run({
      root_domain: entry.root_domain || entry.rootDomain || '',
      category: entry.category || this.category || '',
      attempts: entry.attempts || 0,
      http_ok_count: entry.http_ok_count || 0,
      identity_match_count: entry.identity_match_count || 0,
      major_anchor_conflict_count: entry.major_anchor_conflict_count || 0,
      fields_contributed_count: entry.fields_contributed_count || 0,
      fields_accepted_count: entry.fields_accepted_count || 0,
      accepted_critical_fields_count: entry.accepted_critical_fields_count || 0,
      products_seen: entry.products_seen || 0,
      approved_attempts: entry.approved_attempts || 0,
      candidate_attempts: entry.candidate_attempts || 0,
      parser_runs: entry.parser_runs || 0,
      parser_success_count: entry.parser_success_count || 0,
      parser_health_score_total: entry.parser_health_score_total || 0,
      endpoint_signal_count: entry.endpoint_signal_count || 0,
      endpoint_signal_score_total: entry.endpoint_signal_score_total || 0,
      planner_score: entry.planner_score || 0,
      field_reward_strength: entry.field_reward_strength || 0,
      recent_products: JSON.stringify(entry.recent_products || []),
      per_field_helpfulness: JSON.stringify(entry.per_field_helpfulness || {}),
      fingerprint_counts: JSON.stringify(entry.fingerprint_counts || {}),
      extra_stats: JSON.stringify(entry.extra_stats || {}),
      last_seen_at: entry.last_seen_at || null,
      updated_at: entry.updated_at || new Date().toISOString()
    });
  }

  upsertSourceIntelFieldReward(entry) {
    this.db.prepare(`
      INSERT OR REPLACE INTO source_intel_field_rewards (
        root_domain, scope, scope_key, field, method,
        seen_count, success_count, fail_count, contradiction_count,
        success_rate, contradiction_rate, reward_score,
        last_seen_at, last_decay_at
      ) VALUES (
        @root_domain, @scope, @scope_key, @field, @method,
        @seen_count, @success_count, @fail_count, @contradiction_count,
        @success_rate, @contradiction_rate, @reward_score,
        @last_seen_at, @last_decay_at
      )
    `).run({
      root_domain: entry.root_domain || '',
      scope: entry.scope || 'domain',
      scope_key: entry.scope_key || '',
      field: entry.field || '',
      method: entry.method || 'unknown',
      seen_count: entry.seen_count || 0,
      success_count: entry.success_count || 0,
      fail_count: entry.fail_count || 0,
      contradiction_count: entry.contradiction_count || 0,
      success_rate: entry.success_rate || 0,
      contradiction_rate: entry.contradiction_rate || 0,
      reward_score: entry.reward_score || 0,
      last_seen_at: entry.last_seen_at || null,
      last_decay_at: entry.last_decay_at || null
    });
  }

  upsertSourceIntelBrand(entry) {
    this.db.prepare(`
      INSERT OR REPLACE INTO source_intel_brands (
        root_domain, brand_key, brand, attempts, http_ok_count,
        identity_match_count, major_anchor_conflict_count,
        fields_contributed_count, fields_accepted_count, accepted_critical_fields_count,
        products_seen, recent_products, per_field_helpfulness, extra_stats, last_seen_at
      ) VALUES (
        @root_domain, @brand_key, @brand, @attempts, @http_ok_count,
        @identity_match_count, @major_anchor_conflict_count,
        @fields_contributed_count, @fields_accepted_count, @accepted_critical_fields_count,
        @products_seen, @recent_products, @per_field_helpfulness, @extra_stats, @last_seen_at
      )
    `).run({
      root_domain: entry.root_domain || '',
      brand_key: entry.brand_key || '',
      brand: entry.brand || '',
      attempts: entry.attempts || 0,
      http_ok_count: entry.http_ok_count || 0,
      identity_match_count: entry.identity_match_count || 0,
      major_anchor_conflict_count: entry.major_anchor_conflict_count || 0,
      fields_contributed_count: entry.fields_contributed_count || 0,
      fields_accepted_count: entry.fields_accepted_count || 0,
      accepted_critical_fields_count: entry.accepted_critical_fields_count || 0,
      products_seen: entry.products_seen || 0,
      recent_products: JSON.stringify(entry.recent_products || []),
      per_field_helpfulness: JSON.stringify(entry.per_field_helpfulness || {}),
      extra_stats: JSON.stringify(entry.extra_stats || {}),
      last_seen_at: entry.last_seen_at || null
    });
  }

  upsertSourceIntelPath(entry) {
    this.db.prepare(`
      INSERT OR REPLACE INTO source_intel_paths (
        root_domain, path, attempts, http_ok_count,
        identity_match_count, major_anchor_conflict_count,
        fields_contributed_count, fields_accepted_count, accepted_critical_fields_count,
        products_seen, recent_products, per_field_helpfulness, extra_stats, last_seen_at
      ) VALUES (
        @root_domain, @path, @attempts, @http_ok_count,
        @identity_match_count, @major_anchor_conflict_count,
        @fields_contributed_count, @fields_accepted_count, @accepted_critical_fields_count,
        @products_seen, @recent_products, @per_field_helpfulness, @extra_stats, @last_seen_at
      )
    `).run({
      root_domain: entry.root_domain || '',
      path: entry.path || '/',
      attempts: entry.attempts || 0,
      http_ok_count: entry.http_ok_count || 0,
      identity_match_count: entry.identity_match_count || 0,
      major_anchor_conflict_count: entry.major_anchor_conflict_count || 0,
      fields_contributed_count: entry.fields_contributed_count || 0,
      fields_accepted_count: entry.fields_accepted_count || 0,
      accepted_critical_fields_count: entry.accepted_critical_fields_count || 0,
      products_seen: entry.products_seen || 0,
      recent_products: JSON.stringify(entry.recent_products || []),
      per_field_helpfulness: JSON.stringify(entry.per_field_helpfulness || {}),
      extra_stats: JSON.stringify(entry.extra_stats || {}),
      last_seen_at: entry.last_seen_at || null
    });
  }

  persistSourceIntelFull(category, domains) {
    const tx = this.db.transaction(() => {
      for (const [rootDomain, entry] of Object.entries(domains || {})) {
        this.upsertSourceIntelDomain({
          ...entry,
          root_domain: rootDomain,
          category
        });

        // Persist field rewards for domain scope
        for (const [key, reward] of Object.entries(entry.field_method_reward || {})) {
          this.upsertSourceIntelFieldReward({
            root_domain: rootDomain,
            scope: 'domain',
            scope_key: '',
            ...reward
          });
        }

        // Persist per-brand stats and their field rewards
        for (const [brandKey, brandStats] of Object.entries(entry.per_brand || {})) {
          this.upsertSourceIntelBrand({
            ...brandStats,
            root_domain: rootDomain,
            brand_key: brandKey
          });
          for (const [key, reward] of Object.entries(brandStats.field_method_reward || {})) {
            this.upsertSourceIntelFieldReward({
              root_domain: rootDomain,
              scope: 'brand',
              scope_key: brandKey,
              ...reward
            });
          }
        }

        // Persist per-path stats and their field rewards
        for (const [pathKey, pathStats] of Object.entries(entry.per_path || {})) {
          this.upsertSourceIntelPath({
            ...pathStats,
            root_domain: rootDomain,
            path: pathKey
          });
          for (const [key, reward] of Object.entries(pathStats.field_method_reward || {})) {
            this.upsertSourceIntelFieldReward({
              root_domain: rootDomain,
              scope: 'path',
              scope_key: pathKey,
              ...reward
            });
          }
        }
      }
    });
    tx();
  }

  loadSourceIntelDomains(category) {
    const domainRows = this.db.prepare('SELECT * FROM source_intel_domains WHERE category = ?').all(category);
    if (!domainRows.length) return null;

    const domains = {};
    for (const row of domainRows) {
      const rootDomain = row.root_domain;
      try { row.recent_products = JSON.parse(row.recent_products); } catch { row.recent_products = []; }
      try { row.per_field_helpfulness = JSON.parse(row.per_field_helpfulness); } catch { row.per_field_helpfulness = {}; }
      try { row.fingerprint_counts = JSON.parse(row.fingerprint_counts); } catch { row.fingerprint_counts = {}; }
      try { row.extra_stats = JSON.parse(row.extra_stats); } catch { row.extra_stats = {}; }

      domains[rootDomain] = {
        ...row,
        rootDomain,
        per_brand: {},
        per_path: {},
        field_method_reward: {},
        per_field_reward: {}
      };
    }

    // Load field rewards
    for (const rootDomain of Object.keys(domains)) {
      const rewards = this.db.prepare(
        'SELECT * FROM source_intel_field_rewards WHERE root_domain = ?'
      ).all(rootDomain);

      for (const reward of rewards) {
        const scope = reward.scope || 'domain';
        const scopeKey = reward.scope_key || '';
        const rKey = `${reward.field}::${reward.method}`;

        if (scope === 'domain') {
          domains[rootDomain].field_method_reward[rKey] = reward;
        } else if (scope === 'brand' && domains[rootDomain].per_brand[scopeKey]) {
          if (!domains[rootDomain].per_brand[scopeKey].field_method_reward) {
            domains[rootDomain].per_brand[scopeKey].field_method_reward = {};
          }
          domains[rootDomain].per_brand[scopeKey].field_method_reward[rKey] = reward;
        } else if (scope === 'path' && domains[rootDomain].per_path[scopeKey]) {
          if (!domains[rootDomain].per_path[scopeKey].field_method_reward) {
            domains[rootDomain].per_path[scopeKey].field_method_reward = {};
          }
          domains[rootDomain].per_path[scopeKey].field_method_reward[rKey] = reward;
        }
      }
    }

    // Load brands
    const brandRows = this.db.prepare(
      'SELECT * FROM source_intel_brands WHERE root_domain IN (' +
      Object.keys(domains).map(() => '?').join(',') + ')'
    ).all(...Object.keys(domains));

    for (const row of brandRows) {
      const rootDomain = row.root_domain;
      if (!domains[rootDomain]) continue;
      try { row.recent_products = JSON.parse(row.recent_products); } catch { row.recent_products = []; }
      try { row.per_field_helpfulness = JSON.parse(row.per_field_helpfulness); } catch { row.per_field_helpfulness = {}; }
      try { row.extra_stats = JSON.parse(row.extra_stats); } catch { row.extra_stats = {}; }
      domains[rootDomain].per_brand[row.brand_key] = {
        ...row,
        field_method_reward: domains[rootDomain].per_brand[row.brand_key]?.field_method_reward || {},
        per_field_reward: {}
      };
    }

    // Load paths
    const pathRows = this.db.prepare(
      'SELECT * FROM source_intel_paths WHERE root_domain IN (' +
      Object.keys(domains).map(() => '?').join(',') + ')'
    ).all(...Object.keys(domains));

    for (const row of pathRows) {
      const rootDomain = row.root_domain;
      if (!domains[rootDomain]) continue;
      try { row.recent_products = JSON.parse(row.recent_products); } catch { row.recent_products = []; }
      try { row.per_field_helpfulness = JSON.parse(row.per_field_helpfulness); } catch { row.per_field_helpfulness = {}; }
      try { row.extra_stats = JSON.parse(row.extra_stats); } catch { row.extra_stats = {}; }
      domains[rootDomain].per_path[row.path] = {
        ...row,
        field_method_reward: domains[rootDomain].per_path[row.path]?.field_method_reward || {},
        per_field_reward: {}
      };
    }

    return { category, domains };
  }

  // --- Migration: Queue helpers ---

  updateQueueProductPatch(productId, patch) {
    const existing = this.getQueueProduct(productId);
    if (!existing) return null;
    const merged = { ...existing, ...patch };
    this.upsertQueueProduct({
      ...merged,
      category: this.category,
      last_urls_attempted: Array.isArray(merged.last_urls_attempted) ? merged.last_urls_attempted : [],
      last_summary: merged.last_summary || null,
      dirty_flags: merged.dirty_flags || null
    });
    return merged;
  }

  selectNextQueueProductSql() {
    // Get all eligible rows (not in terminal/running states and not waiting for retry)
    const rows = this.db.prepare(`
      SELECT * FROM product_queue
      WHERE category = ?
        AND status NOT IN ('complete', 'blocked', 'paused', 'skipped', 'in_progress', 'needs_manual', 'exhausted', 'failed')
        AND (next_retry_at IS NULL OR next_retry_at = '' OR next_retry_at <= datetime('now'))
      ORDER BY priority ASC, attempts_total ASC, updated_at ASC
      LIMIT 50
    `).all(this.category);

    for (const row of rows) {
      if (row.last_urls_attempted) try { row.last_urls_attempted = JSON.parse(row.last_urls_attempted); } catch { row.last_urls_attempted = []; }
      if (row.dirty_flags) try { row.dirty_flags = JSON.parse(row.dirty_flags); } catch { row.dirty_flags = null; }
      if (row.last_summary) try { row.last_summary = JSON.parse(row.last_summary); } catch { row.last_summary = null; }
    }
    return rows.length > 0 ? rows[0] : null;
  }
}
