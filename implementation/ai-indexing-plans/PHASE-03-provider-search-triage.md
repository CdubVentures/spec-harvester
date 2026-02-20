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

# Phase 03 â€” Provider search + SERP logging + tier/doc_kind tagging + triage (Google/SearXNG)


## Goal
Make discovery **auditable and controllable**:
- log every query
- log every SERP result (candidate URL)
- tag candidates with tier and doc_kind hints
- triage to pick top K URLs to fetch
- provide GUI proof (why we chose these URLs)

This phase also includes a production-friendly **SearXNG settings.yml** and optional Docker compose for dev.

## Deliverables
- Search provider calls wired through `src/search/searchProviders.js`
- SERP logging tables (or artifacts) + dedupe
- Tier/doc_kind tagging
- Triage strategy (rules-first; optional fast model rerank)
- GUI: â€œSERP Explorerâ€ table per query
- Config files:
  - `searxng/settings.yml`
  - `docker/docker-compose.observability.yml` (optional local SearXNG)

## Implementation

### 3.1 Provider execution
Use existing provider runner:
- `src/search/searchProviders.js` already supports `searxng` requests (`/search?q=...&format=json`).

Add configuration to `src/config.js`:
- `SEARXNG_BASE_URL=http://localhost:8080`
- Google CSE keys if used:
  - `GOOGLE_CSE_KEY=...`
  - `GOOGLE_CSE_CX=...`

### 3.2 Query emission
From SearchProfile (Phase 2), emit queries grouped by doc_hint:
- Tierâ€‘1 hunting:
  - `manual_pdf`, `spec_pdf`, `official_support`
- Tierâ€‘2 hunting:
  - `lab_review`, `teardown_review`
Only emit doc_hints relevant to the current NeedSet.

Persist each query (DB or artifact):
- provider, query_text, doc_hint, field_targets, dedupe_hash

### 3.3 SERP normalization + tagging
For each SERP item:
- normalize URL (strip trackers, normalize scheme)
- compute domain/rootDomain
- tier_guess = `resolveTierForHost(...)` (see `src/categories/loader.js`)
- doc_kind_guess:
  - pdf if url endswith .pdf or content-type hints
  - support if path includes /support/ /downloads/
  - review/teardown if title/snippet contains â€œreviewâ€, â€œteardownâ€, â€œdisassemblyâ€

Persist candidate with:
- rank, title, snippet, tier_guess, doc_kind_guess

### 3.4 Triage (fetch selection)
Goal: pick K URLs per run (K=8â€“15) weighted by NeedSet.
Rules-first scoring:
- + tier weight (tier1>tier2>tier3)
- + doc_kind match for doc_hint
- + brand/model token match in title/snippet
- + pdf bonus for manual/spec hints
- - denied/low-quality hosts (use `isDeniedHost(...)`)
- - duplicates / near-duplicates (use `src/search/serpDedupe.js`)

Optional: fast-model triage for top 30 candidates to pick top K (strictly bounded).

### 3.5 GUI proof
Add a SERP view:
- group by query_text
- show each candidate: url, tier, doc_kind, score, triage decision, reason badges

Add counters:
- candidates_checked
- urls_selected

### 3.6 SearXNG config (drop-in)
Use the bundled `searxng/settings.yml` in this package.
If running local:
- start via `docker/docker-compose.observability.yml`
- set `SEARXNG_BASE_URL=http://localhost:8080`

### 3.7 Field Studio hint-aware provider triage (overlooked)
- Carry forward search_hints.domain_hints and search_hints.preferred_content_types from Phase 02 query planning.
- Add triage score boosts when candidate host/doc_kind matches field-level hints.
- Persist candidate rationale with hint_source so URL selection is auditable.

### 3.8 Runtime knob (implemented)
- Add explicit run-control knob: `phase 03 llm triage` (boolean) to force LLM SERP reranking.
- Add explicit model dropdown for Phase 03 triage model (default selection prefers Gemini if available in model catalog).
- Wire through GUI -> `POST /process/start` -> env overrides:
  - `LLM_SERP_RERANK_ENABLED=true|false`
  - `LLM_MODEL_TRIAGE=<selected_model>`
  - `CORTEX_MODEL_RERANK_FAST=<selected_model>` (compat path)
- Add SERP Explorer proof fields:
  - `llm_triage_enabled`
  - `llm_triage_applied`
  - `llm_triage_model`

## Exit criteria
- Every search query and candidate is visible in the GUI.
- Selected URLs are dominated by Tierâ€‘1 and Tierâ€‘2 when high-stakes fields require them.

