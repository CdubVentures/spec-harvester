# Source And Key-Review Schema Split (SQLite)

Last updated: 2026-02-19

## Status Snapshot (2026-02-19)

Implemented behavior now in code:

- SQLite is the operational source of truth for key-review state and candidate lineage.
- Two-lane semantics are enforced:
  - `confirm` clears AI-pending only.
  - `accept` selects value/candidate only.
  - primary lane is valid only for `grid_key`.
- Shared contexts are persisted:
  - component drawer confirm -> `component_key`
  - enum drawer confirm -> `enum_key`
- Review/component/enum payload builders are SQL-first when SQL context is available (legacy JSON fallback removed from active path).
- Candidate ID generation for synthetic/manual/workbook paths is centralized:
  - backend helper: `src/utils/candidateIdentifier.js`
  - frontend helper: `tools/gui-react/src/utils/candidateIdentifier.ts`
- Test Mode source generation defaults now target realistic disagreement without cross-item identity coupling:
  - `Sources/Scenario = 0`
  - `Shared % = 70`
  - `Duplicate % = 15`
  - host reuse toggle removed (always item-unique source hosts)

Context mapping note:

- Product requirement name `list_key_context` is represented in schema as `enum_key`.
- No table rename migration has been executed yet.

## Why This Split

Store **source capture** separately from **key review orchestration**.

- Source tables should hold evidence and lineage only.
- Key-review tables should hold contract rules, model routing, AI decisions, and user overrides.
- Model details should **not** be persisted on source rows.

This matches your requirement:

- Grid keys, enum keys, and component-table keys carry AI/review state.
- Source rows stay clean and reusable across many keys.

## Hard Rule

Do **not** store these in source tables:

- model name/provider
- prompt hashes
- route/escalation decision
- token usage/cost
- AI accept/reject state

Keep those in key-review tables only.

Additional hard rule:
- `source_host` and `source_root_domain` are provenance metadata only and must never be used as identity keys for mutation routing, lane writes, or cascade targeting.

## Ownership Boundaries

| Layer | Owns | Does Not Own |
|---|---|---|
| Source Capture | URL/domain/tier/method, artifacts, extracted assertions, evidence refs | model routing, contract policy, AI decision workflow |
| Key Review | field contract snapshot, model used, call attempts, accept/reject, confidence decisions | raw crawl artifacts and raw per-source content payloads |

## Table Set A: Source Capture (Evidence Only)

### `source_registry`

One row per crawled source for an item in a run.

Required columns:

- `source_id` TEXT PRIMARY KEY (stable identifier)
- `category` TEXT NOT NULL
- `item_identifier` TEXT NOT NULL
- `product_id` TEXT
- `run_id` TEXT
- `source_url` TEXT NOT NULL
- `source_host` TEXT
- `source_root_domain` TEXT
- `source_tier` INTEGER
- `source_method` TEXT
- `crawl_status` TEXT DEFAULT 'fetched'
- `http_status` INTEGER
- `fetched_at` TEXT
- `created_at` TEXT DEFAULT (datetime('now'))
- `updated_at` TEXT DEFAULT (datetime('now'))

### `source_artifacts`

Pointers to captured files from each source.

Required columns:

- `artifact_id` INTEGER PRIMARY KEY AUTOINCREMENT
- `source_id` TEXT NOT NULL REFERENCES `source_registry(source_id)`
- `artifact_type` TEXT NOT NULL  
  Allowed: `html`, `dom`, `jsonld`, `graph_json`, `table_json`, `image`, `screenshot`, `metadata`
- `local_path` TEXT NOT NULL
- `content_hash` TEXT
- `mime_type` TEXT
- `size_bytes` INTEGER
- `captured_at` TEXT DEFAULT (datetime('now'))

### `source_assertions`

Per-source extracted assertion for a key target.

Required columns:

- `assertion_id` TEXT PRIMARY KEY
- `source_id` TEXT NOT NULL REFERENCES `source_registry(source_id)`
- `field_key` TEXT NOT NULL
- `context_kind` TEXT NOT NULL  
  Allowed: `scalar`, `component`, `list`
- `context_ref` TEXT  
  Example: component identifier or list row identifier
- `value_raw` TEXT
- `value_normalized` TEXT
- `unit` TEXT
- `candidate_id` TEXT
- `extraction_method` TEXT
- `created_at` TEXT DEFAULT (datetime('now'))
- `updated_at` TEXT DEFAULT (datetime('now'))

### `source_evidence_refs`

Evidence snippets attached to each assertion.

Required columns:

- `evidence_ref_id` INTEGER PRIMARY KEY AUTOINCREMENT
- `assertion_id` TEXT NOT NULL REFERENCES `source_assertions(assertion_id)`
- `evidence_url` TEXT
- `snippet_id` TEXT
- `quote` TEXT
- `method` TEXT
- `tier` INTEGER
- `retrieved_at` TEXT
- `created_at` TEXT DEFAULT (datetime('now'))

## Table Set B: Key Review (Grid / Enum / Component)

### `key_review_state`

One row per review target key. This is where contract + AI/user state lives.

Target kinds:

- `grid_key` = `(item_identifier, field_key)`
- `enum_key` = `(field_key, enum_value_norm)`
- `component_key` = `(component_identifier, property_key)`

Required columns:

- Identity:
  - `id` INTEGER PRIMARY KEY AUTOINCREMENT
  - `category` TEXT NOT NULL
  - `target_kind` TEXT NOT NULL CHECK(target_kind IN ('grid_key','enum_key','component_key'))
  - `item_identifier` TEXT
  - `field_key` TEXT NOT NULL
  - `enum_value_norm` TEXT
  - `component_identifier` TEXT
  - `property_key` TEXT

- Contract snapshot (from Field Studio at review time):
  - `required_level` TEXT
  - `availability` TEXT
  - `difficulty` TEXT
  - `effort` INTEGER
  - `ai_mode` TEXT
  - `parse_template` TEXT
  - `evidence_policy` TEXT
  - `min_evidence_refs_effective` INTEGER DEFAULT 1
  - `min_distinct_sources_required` INTEGER DEFAULT 1

- Routing packet mode:
  - `send_mode` TEXT CHECK(send_mode IN ('single_source_data','all_source_data'))
  - `component_send_mode` TEXT CHECK(component_send_mode IN ('component_values','component_values_prime_sources'))
  - `list_send_mode` TEXT CHECK(list_send_mode IN ('list_values','list_values_prime_sources'))

- Selected output:
  - `selected_value` TEXT
  - `selected_candidate_id` TEXT
  - `confidence_score` REAL DEFAULT 0
  - `confidence_level` TEXT
  - `flagged_at` TEXT
  - `resolved_at` TEXT

- AI confirms (two knobs):
  - `ai_confirm_primary_status` TEXT
  - `ai_confirm_primary_confidence` REAL
  - `ai_confirm_primary_at` TEXT
  - `ai_confirm_primary_interrupted` INTEGER DEFAULT 0
  - `ai_confirm_primary_error` TEXT
  - `ai_confirm_shared_status` TEXT
  - `ai_confirm_shared_confidence` REAL
  - `ai_confirm_shared_at` TEXT
  - `ai_confirm_shared_interrupted` INTEGER DEFAULT 0
  - `ai_confirm_shared_error` TEXT

- User accepts (two accepts):
  - `user_accept_primary_status` TEXT
  - `user_accept_primary_at` TEXT
  - `user_accept_primary_by` TEXT
  - `user_accept_shared_status` TEXT
  - `user_accept_shared_at` TEXT
  - `user_accept_shared_by` TEXT

- Manual override of AI:
  - `user_override_ai_primary` INTEGER DEFAULT 0
  - `user_override_ai_primary_at` TEXT
  - `user_override_ai_primary_reason` TEXT
  - `user_override_ai_shared` INTEGER DEFAULT 0
  - `user_override_ai_shared_at` TEXT
  - `user_override_ai_shared_reason` TEXT

- Timestamps:
  - `created_at` TEXT DEFAULT (datetime('now'))
  - `updated_at` TEXT DEFAULT (datetime('now'))

### `key_review_runs`

One row per LLM call attempt for a key review state.

Required columns:

- `run_id` INTEGER PRIMARY KEY AUTOINCREMENT
- `key_review_state_id` INTEGER NOT NULL REFERENCES `key_review_state(id)`
- `stage` TEXT NOT NULL  
  Example: `extract`, `validate`, `component_review`, `list_review`, `post_item`
- `status` TEXT NOT NULL  
  Example: `pending`, `success`, `failed`, `interrupted`
- `provider` TEXT
- `model_used` TEXT
- `prompt_hash` TEXT
- `response_schema_version` TEXT
- `input_tokens` INTEGER
- `output_tokens` INTEGER
- `latency_ms` INTEGER
- `cost_usd` REAL
- `error` TEXT
- `started_at` TEXT
- `finished_at` TEXT
- `created_at` TEXT DEFAULT (datetime('now'))

### `key_review_run_sources`

Links each key-review run to the assertion packets actually sent.

Required columns:

- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `key_review_run_id` INTEGER NOT NULL REFERENCES `key_review_runs(run_id)`
- `assertion_id` TEXT NOT NULL REFERENCES `source_assertions(assertion_id)`
- `packet_role` TEXT  
  Example: `prime`, `support`, `conflict`
- `position` INTEGER
- `created_at` TEXT DEFAULT (datetime('now'))

### `key_review_audit`

Immutable audit trail for review state changes.

Required columns:

- `event_id` INTEGER PRIMARY KEY AUTOINCREMENT
- `key_review_state_id` INTEGER NOT NULL REFERENCES `key_review_state(id)`
- `event_type` TEXT NOT NULL
- `actor_type` TEXT NOT NULL  
  Example: `system`, `ai`, `user`
- `actor_id` TEXT
- `old_value` TEXT
- `new_value` TEXT
- `reason` TEXT
- `created_at` TEXT DEFAULT (datetime('now'))

## SQLite Starter DDL

Use this as the baseline migration (trim/expand as needed).

```sql
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

CREATE TABLE IF NOT EXISTS key_review_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK(target_kind IN ('grid_key','enum_key','component_key')),
  item_identifier TEXT,
  field_key TEXT NOT NULL,
  enum_value_norm TEXT,
  component_identifier TEXT,
  property_key TEXT,

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
CREATE INDEX IF NOT EXISTS idx_krr_state ON key_review_runs(key_review_state_id, stage, status);
```

## How This Maps To Your Existing DB

Current tables in `src/db/specDb.js` can continue to exist while you phase this in.

- `candidates` aligns with `source_assertions` lineage but currently mixes pipeline semantics.
- `candidate_reviews` can be gradually replaced by `key_review_state` + `key_review_runs` + `key_review_audit`.
- `component_values` and `list_values` stay as canonical shared value stores.

## Minimal Migration Sequence

1. Add new tables in parallel (no destructive migration).
2. Dual-write new runs into both old and new structures.
3. Backfill old candidate/review rows into new key-review tables.
4. Switch read paths (GUI + API) to new key-review tables.
5. Remove old review columns only after parity checks pass.

## Implementation Status (2026-02-17)

### Completed

- All 8 tables created in `src/db/specDb.js` with `CREATE TABLE IF NOT EXISTS`
- Seed flow (Step 9-10 in `src/db/seed.js`) populates `source_registry`, `source_assertions`, `source_evidence_refs`, `key_review_state`, `key_review_runs`, `key_review_run_sources`
- `products-index` API enriches each field with `keyReview` data from `key_review_state`
- `candidates` API returns `keyReview` data per field
- Two new endpoints: `POST /review/{cat}/key-review-confirm`, `POST /review/{cat}/key-review-accept`
- Frontend `ReviewMatrix.tsx` reads `keyReview` + `field_rule.component_type`/`enum_source` to show teal (primary) and purple (shared) AI badges
- Frontend `CellDrawer.tsx` shows two-lane sections with independent Confirm/Accept buttons
- Frontend `ReviewPage.tsx` wires `confirmKeyReviewMut` and `acceptKeyReviewMut` mutations
- `normalizeFieldContract()` in `reviewGridData.js` exposes `component_type` (from `rule.component.type`) and `enum_source` (from `rule.enum.source`)
- Missing `key_review_state` row treated as `pending` (badges show for all fields before AI runs)

### Remaining

- Runtime AI review execution (actually running LLM calls to confirm/reject values)
- Backfill of `key_review_state` rows from seed (currently seed creates rows, but live extraction doesn't yet)
- `source_artifacts` table not yet populated (file pointer tracking)
- Switch read paths fully from `candidate_reviews` to `key_review_state` + `key_review_runs` + `key_review_audit`
- Remove old review columns after parity checks

## Non-Negotiables

- Source rows must remain model-agnostic.
- AI interrupt state must be captured for both primary and shared reviews.
- User must be able to accept/override both primary and shared review lanes.
- Confidence and flagged timestamps must be key-level state, not source-level state.
