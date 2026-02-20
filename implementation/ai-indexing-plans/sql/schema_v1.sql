-- Deep Spec Harvester: EvidenceIndexDb schema (SQLite)
-- Designed for: deterministic indexing + tier-aware retrieval + replayable evidence packs.
-- Works with Option A (single DB) by scoping rows with item_id/run_id.
--
-- Notes:
-- - Enable WAL mode in app init for parallel reads with a single writer.
-- - Keep write transactions batched (per-doc) to avoid lock thrash.
-- - FTS5 required.

PRAGMA foreign_keys = ON;

-- --------------------------------------------
-- Core entities
-- --------------------------------------------

CREATE TABLE IF NOT EXISTS items (
  item_id           TEXT PRIMARY KEY,
  category          TEXT NOT NULL,
  brand             TEXT,
  model             TEXT,
  variant           TEXT,
  sku               TEXT,
  title             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runs (
  run_id            TEXT PRIMARY KEY,
  item_id           TEXT NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'running', -- running|succeeded|failed|aborted
  started_at        TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at          TEXT,
  config_json       TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_item_started ON runs(item_id, started_at);

-- Optional: for GUI/event timelines (high-cardinality belongs in logs, but this is useful for replay)
CREATE TABLE IF NOT EXISTS run_events (
  event_id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id            TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  ts                TEXT NOT NULL DEFAULT (datetime('now')),
  stage             TEXT NOT NULL,  -- search|triage|fetch|parse|index|retrieve|extract|consensus|validate|gate|review
  event_type        TEXT NOT NULL,  -- started|finished|info|warn|error
  payload_json      TEXT
);
CREATE INDEX IF NOT EXISTS idx_run_events_run_ts ON run_events(run_id, ts);

-- --------------------------------------------
-- Field state + NeedSet (tier/confidence control loop)
-- --------------------------------------------

CREATE TABLE IF NOT EXISTS field_state (
  item_id           TEXT NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
  field_key         TEXT NOT NULL,
  required_level    TEXT NOT NULL, -- identity|critical|required|optional
  shape             TEXT,          -- scalar|list|table_linked
  evidence_min_refs INTEGER NOT NULL DEFAULT 1,
  tier_preference   TEXT,          -- e.g. "tier1,tier2"
  status            TEXT NOT NULL DEFAULT 'unknown', -- unknown|candidate|accepted|conflict|invalid
  value_json        TEXT,
  confidence        REAL,
  best_tier_seen    INTEGER,
  refs_found        INTEGER,
  distinct_sources  INTEGER,
  conflict          INTEGER NOT NULL DEFAULT 0,
  last_run_id       TEXT REFERENCES runs(run_id) ON DELETE SET NULL,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (item_id, field_key)
);
CREATE INDEX IF NOT EXISTS idx_field_state_status ON field_state(item_id, status);

CREATE TABLE IF NOT EXISTS needset (
  run_id            TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  computed_at       TEXT NOT NULL DEFAULT (datetime('now')),
  field_key         TEXT NOT NULL,
  need_score        REAL NOT NULL,
  reasons_json      TEXT,
  PRIMARY KEY (run_id, field_key)
);
CREATE INDEX IF NOT EXISTS idx_needset_run_score ON needset(run_id, need_score DESC);

-- --------------------------------------------
-- Search profiles / queries / SERP candidates (discovery audit + learning)
-- --------------------------------------------

CREATE TABLE IF NOT EXISTS search_profiles (
  profile_id        TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  identity_json     TEXT,  -- brand/model/sku/title/category
  aliases_json      TEXT,  -- identity aliases (deterministic + LLM-assisted)
  negative_terms_json TEXT,
  doc_hint_queries_json TEXT,
  field_target_queries_json TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_search_profiles_run ON search_profiles(run_id);

CREATE TABLE IF NOT EXISTS search_queries (
  query_id          TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  provider          TEXT NOT NULL, -- google|searxng|bing|duckduckgo|...
  doc_hint          TEXT,          -- manual_pdf|spec_pdf|support|teardown_review|...
  query_text        TEXT NOT NULL,
  field_targets_json TEXT,
  alias_set_id      TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  dedupe_hash       TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'created', -- created|succeeded|failed
  duration_ms       INTEGER,
  result_count      INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_search_queries_dedupe ON search_queries(run_id, dedupe_hash);

CREATE TABLE IF NOT EXISTS url_candidates (
  candidate_id      TEXT PRIMARY KEY,
  query_id          TEXT NOT NULL REFERENCES search_queries(query_id) ON DELETE CASCADE,
  run_id            TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  url               TEXT NOT NULL,
  domain            TEXT NOT NULL,
  title             TEXT,
  snippet           TEXT,
  rank              INTEGER,
  tier_guess        INTEGER,
  doc_kind_guess    TEXT,
  triage_decision   TEXT,   -- fetch|skip
  triage_score      REAL,
  triage_reason_json TEXT,
  fetch_id          TEXT,   -- backref after fetch
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_url_candidates_run_domain ON url_candidates(run_id, domain);
CREATE INDEX IF NOT EXISTS idx_url_candidates_query_rank ON url_candidates(query_id, rank);

-- --------------------------------------------
-- URL health / memory (self-healing + compounding)
-- --------------------------------------------

CREATE TABLE IF NOT EXISTS url_health (
  url               TEXT PRIMARY KEY,
  domain            TEXT NOT NULL,
  last_status       INTEGER,
  fail_count        INTEGER NOT NULL DEFAULT 0,
  blocked_count     INTEGER NOT NULL DEFAULT 0,
  final_url         TEXT,
  redirect_to       TEXT,
  cooldown_until    TEXT,
  last_checked_at   TEXT,
  last_ok_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_url_health_domain ON url_health(domain);

CREATE TABLE IF NOT EXISTS bad_url_patterns (
  domain            TEXT NOT NULL,
  pattern           TEXT NOT NULL,
  reason            TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (domain, pattern)
);

-- Canonical URLs learned for item fingerprints (brand+model+variant)
CREATE TABLE IF NOT EXISTS url_memory (
  item_fingerprint  TEXT NOT NULL,
  doc_kind          TEXT NOT NULL, -- manual_pdf|spec_sheet|support|official_product_page|...
  url               TEXT NOT NULL,
  domain            TEXT NOT NULL,
  tier              INTEGER,
  confidence        REAL,
  last_seen_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (item_fingerprint, doc_kind)
);

CREATE TABLE IF NOT EXISTS domain_field_yield (
  domain            TEXT NOT NULL,
  field_key         TEXT NOT NULL,
  tier              INTEGER,
  seen_count        INTEGER NOT NULL DEFAULT 0,
  used_count        INTEGER NOT NULL DEFAULT 0,
  last_used_at      TEXT,
  PRIMARY KEY (domain, field_key)
);

-- --------------------------------------------
-- Fetches + documents + deterministic indexing
-- --------------------------------------------

CREATE TABLE IF NOT EXISTS fetches (
  fetch_id          TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  url               TEXT NOT NULL,
  final_url         TEXT,
  domain            TEXT NOT NULL,
  status_code       INTEGER,
  status_class      TEXT,   -- ok|redirect|404|blocked|error
  fetched_at        TEXT NOT NULL DEFAULT (datetime('now')),
  duration_ms       INTEGER,
  fetcher_kind      TEXT,   -- http|browser
  content_type      TEXT,
  content_bytes     INTEGER,
  content_hash      TEXT,
  storage_key       TEXT,
  error             TEXT,
  blocked_reason    TEXT
);
CREATE INDEX IF NOT EXISTS idx_fetches_run_domain ON fetches(run_id, domain);
CREATE INDEX IF NOT EXISTS idx_fetches_hash ON fetches(content_hash);

CREATE TABLE IF NOT EXISTS documents (
  doc_id            TEXT PRIMARY KEY,
  fetch_id          TEXT NOT NULL REFERENCES fetches(fetch_id) ON DELETE CASCADE,
  run_id            TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  item_id           TEXT REFERENCES items(item_id) ON DELETE SET NULL,
  url               TEXT NOT NULL,
  final_url         TEXT,
  domain            TEXT NOT NULL,
  tier              INTEGER,
  doc_kind          TEXT,
  content_hash      TEXT,
  title             TEXT,
  language          TEXT,
  parsed_ok         INTEGER NOT NULL DEFAULT 0,
  parse_errors_json TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_docs_run_domain ON documents(run_id, domain);
CREATE INDEX IF NOT EXISTS idx_docs_hash ON documents(content_hash);

-- Deterministic text chunks (snippets) for evidence
CREATE TABLE IF NOT EXISTS chunks (
  chunk_id          TEXT PRIMARY KEY,
  doc_id            TEXT NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
  run_id            TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  item_id           TEXT REFERENCES items(item_id) ON DELETE SET NULL,
  snippet_id        TEXT NOT NULL,    -- stable snippet identifier (hash of url+span)
  field_hint        TEXT,
  start_offset      INTEGER,
  end_offset        INTEGER,
  text              TEXT NOT NULL,
  text_hash         TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id);
CREATE INDEX IF NOT EXISTS idx_chunks_snippet ON chunks(snippet_id);

-- FTS over chunks.text (external content)
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text,
  content='chunks',
  content_rowid='rowid',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;
CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
END;

-- Normalized facts from tables/KV (key/value/unit) for spec-heavy domains
CREATE TABLE IF NOT EXISTS facts (
  fact_id           TEXT PRIMARY KEY,
  doc_id            TEXT NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
  run_id            TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  item_id           TEXT REFERENCES items(item_id) ON DELETE SET NULL,
  snippet_id        TEXT,          -- link to chunk snippet when possible
  field_key_hint    TEXT,
  k                TEXT NOT NULL,
  v                TEXT NOT NULL,
  unit              TEXT,
  raw               TEXT,
  confidence_hint   REAL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_facts_doc ON facts(doc_id);
CREATE INDEX IF NOT EXISTS idx_facts_field ON facts(item_id, field_key_hint);

CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(
  k,
  v,
  raw,
  content='facts',
  content_rowid='rowid',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS facts_ai AFTER INSERT ON facts BEGIN
  INSERT INTO facts_fts(rowid, k, v, raw) VALUES (new.rowid, new.k, new.v, new.raw);
END;
CREATE TRIGGER IF NOT EXISTS facts_ad AFTER DELETE ON facts BEGIN
  INSERT INTO facts_fts(facts_fts, rowid, k, v, raw) VALUES ('delete', old.rowid, old.k, old.v, old.raw);
END;
CREATE TRIGGER IF NOT EXISTS facts_au AFTER UPDATE ON facts BEGIN
  INSERT INTO facts_fts(facts_fts, rowid, k, v, raw) VALUES ('delete', old.rowid, old.k, old.v, old.raw);
  INSERT INTO facts_fts(rowid, k, v, raw) VALUES (new.rowid, new.k, new.v, new.raw);
END;

-- --------------------------------------------
-- Prime sources & evidence references (for extraction/validation payloads)
-- --------------------------------------------

CREATE TABLE IF NOT EXISTS evidence_refs (
  ref_id            TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  item_id           TEXT REFERENCES items(item_id) ON DELETE SET NULL,
  field_key         TEXT NOT NULL,
  value_hash        TEXT,          -- hash of normalized value used for selection
  snippet_id        TEXT NOT NULL,
  doc_id            TEXT REFERENCES documents(doc_id) ON DELETE SET NULL,
  url               TEXT,
  tier              INTEGER,
  method            TEXT,          -- extracted|validated|selected|...
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_evidence_refs_field ON evidence_refs(run_id, field_key);

CREATE TABLE IF NOT EXISTS prime_sources (
  prime_id          TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  item_id           TEXT REFERENCES items(item_id) ON DELETE SET NULL,
  field_key         TEXT NOT NULL,
  value_hash        TEXT,
  snippet_id        TEXT NOT NULL,
  url               TEXT,
  tier              INTEGER,
  score             REAL,
  reason_json       TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_prime_sources_field ON prime_sources(run_id, field_key);

-- --------------------------------------------
-- Learning stores (ONLY update after acceptance)
-- --------------------------------------------

CREATE TABLE IF NOT EXISTS component_lexicon (
  component_category TEXT NOT NULL,   -- sensor|switch|encoder|panel|...
  value              TEXT NOT NULL,
  normalized_value   TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active', -- active|rejected
  first_seen_run_id  TEXT REFERENCES runs(run_id) ON DELETE SET NULL,
  evidence_snippet_id TEXT,
  source_url         TEXT,
  confidence         REAL,
  accepted_at        TEXT,
  PRIMARY KEY (component_category, normalized_value)
);

CREATE TABLE IF NOT EXISTS field_anchors (
  field_key          TEXT NOT NULL,
  anchor             TEXT NOT NULL,
  anchor_type        TEXT NOT NULL DEFAULT 'phrase', -- phrase|regex|unit|value_hint
  weight             REAL NOT NULL DEFAULT 1.0,
  status             TEXT NOT NULL DEFAULT 'active', -- active|rejected
  first_seen_run_id  TEXT REFERENCES runs(run_id) ON DELETE SET NULL,
  accepted_at        TEXT,
  PRIMARY KEY (field_key, anchor)
);

-- --------------------------------------------
-- Job graph actions (audit + replay)
-- --------------------------------------------

CREATE TABLE IF NOT EXISTS job_actions (
  action_id         TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  type              TEXT NOT NULL, -- search_query|fetch_url|triage|parse|index|retrieve|extract|validate|...
  payload_json      TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'queued', -- queued|running|succeeded|failed|canceled
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  started_at        TEXT,
  finished_at       TEXT,
  error             TEXT
);
CREATE INDEX IF NOT EXISTS idx_job_actions_run_status ON job_actions(run_id, status);

