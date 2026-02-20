# Phase 02 - SearchProfile and Alias Planning

## Canonical Status
- This is the single canonical file for this phase.
- Consolidated on 2026-02-20 from split planning plus improvement docs.
- Includes implemented status and remaining work from merged sources.
- Keep all unfinished items active until code plus GUI proof confirms completion.

## Merged Source Files
- PHASE-02-searchprofile-aliases.md
- PHASE-02-IMPROVMENT.md

## Full Merged Spec

### Source: PHASE-02-searchprofile-aliases.md

> Original header: Deep Spec Harvester â€” Phased Implementation Plan (Accuracyâ€‘Max)


This phase file is written as an **implementation prompt for senior software engineers**.
It includes: exact deliverables, file touchpoints, schemas/events, test strategy, and **GUI proof**.

**Guiding principles**
- Accuracy is the primary objective (95%+ on technical specs).
- Evidence tiers and confidence gates control *what happens next*.
- Discovery is needâ€‘driven (missing/low-confidence/conflict fields) â€” no endless key/alias loops.
- Indexing is deterministic (content_hash dedupe + stable snippet IDs), so results are replayable and auditable.
- The GUI must prove each phase works before moving to the next.

Repo context (from your `src.zip`):
- Pipeline orchestrator: `src/pipeline/runProduct.js`
- Discovery orchestrator: `src/discovery/searchDiscovery.js`
- Search providers: `src/search/searchProviders.js` (includes SearXNG support)
- Frontier / URL health: `src/research/frontierDb.js` + `src/research/frontierSqlite.js`
- LLM extraction + batching: `src/llm/extractCandidatesLLM.js`, `src/llm/fieldBatching.js`
- Validation: `src/llm/validateCandidatesLLM.js`, `src/validator/qualityGate.js`, `src/engine/runtimeGate.js`
- Consensus: `src/scoring/consensusEngine.js`
- GUI server: `src/api/guiServer.js` (WS support + review grid)

---

# Phase 02 â€” Deterministic aliases + optional Flashâ€‘Lite SearchProfile JSON


## Goal
Create a stable **SearchProfile** (aliases + query templates) per run, so discovery is reproducible and doesnâ€™t devolve into random alias loops.

## Deliverables
- Deterministic alias generator (always on)
- Optional LLM-assisted SearchProfile generator (Flashâ€‘Lite)
- Validation + caps (prevent hallucinated model/SKU)
- Persisted `search_profile.json`
- GUI â€œSearch Profileâ€ view

## Implementation

### 2.1 Deterministic aliases (always)
Implement `buildDeterministicAliases(identity)`:
- normalize whitespace, punctuation
- generate spacing/hyphen variants:
  - `AW610M`, `AW 610M`, `AW-610M`
- preserve digit groups (NEVER mutate â€œ610â€ â†’ â€œ61â€)
- include brand-only and brand+model combos
- cap to 8â€“12 aliases

Store:
```json
{
  "identity_aliases": [{ "alias":"aw610m", "source":"deterministic", "weight":1.0 }]
}
```

### 2.2 LLM SearchProfile (only when needed)
Call a cheap fast model when any of:
- SKU missing and model uncertain
- prior search attempts low yield
- repeated 404/blocked on guessed patterns
- NeedSet contains deep technical fields (teardown protocol)

LLM input (strict):
- brand/model/title/category
- top 5 NeedSet fields (keys only)
- existing deterministic aliases
- constraints: max counts

LLM output schema (validate strictly):
```json
{
  "identity_aliases": ["..."],
  "negative_terms": ["case","skins","bundle"],
  "doc_hint_queries": [
    { "doc_hint":"manual_pdf", "queries":["..."] },
    { "doc_hint":"teardown_review", "queries":["..."] }
  ],
  "field_target_queries": {
    "sensor_model": ["..."],
    "polling_rate": ["..."]
  }
}
```

### 2.3 Validation gates (must)
Reject/strip any alias/query that:
- removes/changes a required digit group from model/SKU
- omits brand token entirely
- exceeds caps:
  - aliases <= 12
  - doc_hint queries <= 3 per hint
  - field_target queries <= 3 per field
- duplicates after normalization

### 2.4 Integration points
- `src/search/queryBuilder.js` and/or `src/research/queryPlanner.js` should accept SearchProfile rather than ad-hoc strings.
- `src/discovery/searchDiscovery.js` should:
  1) build deterministic aliases
  2) optionally request LLM profile
  3) persist the final profile
  4) hand to provider search

### 2.5 Field Studio hint wiring (overlooked)
- In query building, consume field-level search_hints.query_terms before fallback synonym expansion.
- Use search_hints.domain_hints for host-targeted query emission and triage boosts.
- Use search_hints.preferred_content_types to bias doc_hint planning (manual_pdf, spec_pdf, support, etc.).
- Persist query provenance (deterministic|field_rules|learned|llm) so GUI can prove which hint source worked.

### 2.6 Runtime knob (implemented)
- Add explicit run-control knob: `phase 02 llm searchprofile` (boolean).
- Add explicit model dropdown for Phase 02 planner model (default selection prefers Gemini if available in model catalog).
- Add explicit token-cap dropdown paired with the model selector.
- Wire through GUI -> `POST /process/start` -> env overrides:
  - `LLM_PLAN_DISCOVERY_QUERIES=true|false`
  - `LLM_MODEL_PLAN=<selected_model>`
  - `LLM_MAX_OUTPUT_TOKENS_PLAN=<selected_tokens>`
  - `LLM_MAX_OUTPUT_TOKENS_PLAN_FALLBACK=<selected_tokens>`
- GUI proof must show planner status/model on Search Profile panel.

### 2.7 LLM output contract hardening (implemented)
- Planner outputs are validated against strict JSON schema.
- Parsing hardening retries when provider response wraps JSON with extra reasoning text.
- Runtime traces include:
  - `retry_without_schema`
  - `json_schema_requested`
  - `max_tokens_applied`
  so model/cap behavior is auditable from GUI trace view.

## GUI proof
- Show aliases and query templates *before* search executes.
- After run: show which aliases/queries produced useful evidence (Phase 10 will learn from this).

Proof steps:
- Start run with only retailer title (no SKU).
- Confirm SearchProfile includes sensible manual/spec queries and teardown hints for deep fields.

## Exit criteria
- SearchProfile JSON is generated, validated, persisted, and visible in GUI.


### Source: PHASE-02-IMPROVMENT.md

> Original header: PHASE-02 IMPROVMENT


## Selected Scope Implemented
1. Added deterministic SearchProfile generation in discovery:
   - `buildDeterministicAliases()` with normalized alias variants (capped),
   - `buildSearchProfile()` with `identity_aliases`, `focus_fields`, `query_rows`, `field_target_queries`, `doc_hint_queries`, and `hint_source_counts`.
2. Wired Field Studio hints into query generation:
   - `search_hints.query_terms`,
   - `search_hints.preferred_content_types`,
   - `search_hints.domain_hints`,
   - tooltip-derived fallback terms from field rules.
3. Added optional Phase 02 LLM planner:
   - `planDiscoveryQueriesLLM()` with strict JSON schema output (`{ queries: string[] }`),
   - dedupe + cap of returned queries before merge with deterministic query set,
   - explicit runtime knob via GUI and env override.
4. Added SearchProfile artifact lifecycle:
   - write planned profile before provider execution (`status: planned`),
   - write executed profile with per-query stats after execution (`status: executed`),
   - persist to run and latest artifact paths.
5. Added explicit Phase 02 safety/guard outputs:
   - `variant_guard_terms` persisted in SearchProfile artifacts,
   - `alias_reject_log` and `query_reject_log` persisted with reason/stage metadata.
6. Added hard pre-execution identity query guard:
   - rejects off-model queries before provider calls when brand/model token checks fail,
   - rejects missing required model digit groups,
   - rejects likely foreign model tokens (while allowing common units),
   - persists `query_guard` summary (`accepted_query_count`, `rejected_query_count`, guard token sets).
7. Added GUI proof surfaces for Phase 02:
   - run controls: `phase 02 llm searchprofile` + model + token cap,
   - Search Profile panel with alias/query stats, `variant_guard_terms`, guard summary, and reject-log tables,
   - LLM Output Review panel section for SearchProfile aliases/doc_hint/field-target views.
8. Added auditable planner call telemetry:
   - traces/usage include `json_schema_requested`, `retry_without_schema`, and `max_tokens_applied`.

## Delivered Behavior
1. Discovery-enabled runs now produce a deterministic SearchProfile before search calls execute.
2. SearchProfile rows include provenance (`hint_source`, `target_fields`, `doc_hint`, `domain_hint`) and are reused in Phase 03 SERP analysis.
3. Per-query result counts/attempt stats are written back into the executed profile for yield visibility.
4. Phase 02 planner model and token cap are run-time overridable and reflected in artifacts/UI.
5. Query safety auditing is visible and replayable per run (`variant_guard_terms`, alias/query reject logs, guard summary).
6. SearchProfile can be reloaded per selected run via run artifacts/API without re-running the product.

## Verification Completed
1. `node --check src/search/queryBuilder.js`
2. `node --check src/discovery/searchDiscovery.js`
3. `node --test test/queryBuilder.test.js`
4. `node --check src/llm/discoveryPlanner.js`
5. `node --check src/api/guiServer.js`
6. `npm --prefix tools/gui-react run -s build`

## Not In This Slice
1. The planner LLM currently returns query strings only; it does not return a full structured profile object directly.

## GUI Proof Steps
1. Start one run with discovery enabled and provider set, with `phase 02 llm searchprofile` OFF.
2. Open `Search Profile (Phase 02)` and confirm deterministic aliases + query rows are present, with planner shown as off.
3. In the same panel, confirm `variant guard terms` is populated and `query guard summary` shows accepted/rejected counts.
4. Confirm `Query Reject Log` and `Alias Reject Log` tables are visible with reason/stage columns.
5. Start another run with `phase 02 llm searchprofile` ON and pick model/token cap.
5. Confirm Search Profile shows planner enabled + model, and query rows/hit counts populate.
6. Open `LLM Output Review (All Phases)` and confirm the SearchProfile subsection renders aliases, doc hints, and field-target query variants.

