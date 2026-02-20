# Deep Spec Harvester â€” Phased Implementation Plan (Accuracyâ€‘Max)

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

