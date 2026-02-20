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


## Files in this bundle
- `PHASE-XX-*.md`: one prompt/spec per phase (0â€“12) plus Phase 06B scheduler.
- `PHASE-08B-visual-asset-capture-proof.md`: visual screenshot/image capture + validation proof for extraction/review.
- `ADDENDUM-field-studio-overlooked-items.md`: phase-mapped Field Studio wiring that is high value for accuracy and optimization.
- `sql/schema_v1.sql`: SQLite DDL for EvidenceIndexDb (Phase 6) + supporting tables.
- `docker/docker-compose.observability.yml`: Prometheus + Grafana + Loki + Tempo + (optional) SearXNG.
- `searxng/settings.yml`: baseline SearXNG config tuned for spec discovery.
- `prometheus/prometheus.yml`: scrape config (example).
- `prometheus/alerts.indexlab.yml`: alert rules focused on accuracy + reliability.
- `grafana/dashboards/*.json`: starter dashboards (IndexLab + Extraction + Sources).

## Phase order (current)
1. `PHASE-00-indexlab-harness.md`
2. `PHASE-01-needset-engine.md`
3. `PHASE-02-searchprofile-aliases.md`
4. `PHASE-03-provider-search-triage.md`
5. `PHASE-04-url-health-self-healing.md`
6. `PHASE-05-parallel-fetch-parse.md`
7. `PHASE-06B-refetch-scheduler.md`
8. `PHASE-06-evidence-index-db.md`
9. `PHASE-07-tier-retrieval-prime-sources.md`
10. `PHASE-08-extraction-context-wiring.md`
11. `PHASE-08B-visual-asset-capture-proof.md`
12. `PHASE-09-convergence-loop-stop.md`
13. `PHASE-10-learning-compounding.md`
14. `PHASE-11-workers-control.md`
15. `PHASE-12-multi-product-batch-automation.md`

## Improvement execution order (current)
1. `PHASE-00-IMPROVMENT.md`
2. `PHASE-01-IMPROVMENT.md`
3. `PHASE-02-IMPROVMENT.md`
4. `PHASE-03-IMPROVMENT.md`
5. `PHASE-04-IMPROVMENT.md`
6. `PHASE-05-IMPROVMENT.md`
7. `PHASE-06B-IMPROVMENT.md`
8. `PHASE-06-IMPROVMENT.md`
9. `PHASE-07-IMPROVMENT.md`
10. `PHASE-08-IMPROVMENT.md`
11. `PHASE-08B-IMPROVMENT.md`
12. `PHASE-09-IMPROVMENT.md`
13. `PHASE-10-IMPROVMENT.md`
14. `PHASE-11-IMPROVMENT.md`
15. `PHASE-12-IMPROVMENT.md`

## Automation ownership notes
- Phase 03 is triage + intent emission only. It now includes automation-ready schema/logging hooks.
- Phase 04 owns URL health and repair-trigger signals.
- Phase 06 owns content hash dedupe/change signals.
- Phase 08B owns visual asset capture, hash lineage, and image proof feeds.
- Phase 09 owns NeedSet deficit signals and convergence decisions.
- Phase 06B is the single owner of scheduler policy and queue execution.

## Implemented status updates (2026-02-19)
- LLM routing controls in GUI now expose model + token cap for every active call lane:
  - plan, triage, fast, reasoning, extract, validate, write
  - fallback plan/extract/validate/write
- Runtime start API accepts per-lane token overrides and fallback token overrides.
- Token caps are model-aware:
  - GUI token presets are clamped/disabled by per-model max output tokens.
  - DeepSeek chat/reasoner now use separate defaults and hard maximums.
- Structured output parsing was hardened to reduce false JSON failures:
  - strips `<think>...</think>` wrappers
  - retries JSON candidate extraction before failing.
- IndexLab overview now includes live LLM progress proof:
  - `llm call activity` gauge
  - `pending llm calls` grouped by purpose + model.
- LLM trace payloads now expose `max_tokens_applied` for direct cap verification in GUI review.
- Phase 04 URL health and repair control loop is now implemented in runtime:
  - pre-fetch cooldown skip via `frontierDb.shouldSkipUrl(...)`
  - post-fetch persistence via `frontierDb.recordFetch(...)`
  - repair emission event `repair_query_enqueued` for `404/410` (deduped per domain per run)
  - blocked-domain suppression event `blocked_domain_cooldown_applied` after threshold hits
  - path dead-pattern skip reason `path_dead_pattern` in both JSON and SQLite frontier backends
- New Phase 04 knobs are active in config:
  - `FRONTIER_COOLDOWN_403_BASE`
  - `FRONTIER_BLOCKED_DOMAIN_THRESHOLD`
  - `FRONTIER_REPAIR_SEARCH_ENABLED`
- Domain checklist API and GUI were extended for Phase 04 proof:
  - API now returns `repair_queries` and `bad_url_patterns`
  - IndexLab includes `URL Health & Repair (Phase 04)` panel with domain health, repair query rows, and bad-pattern rows
  - Session metrics now include real `URL Cooldowns Active` from phase-04 payload
- Phase 04 improvement slice added normalized fetch outcomes and host budget visibility:
  - runtime emits normalized `outcome` on `source_fetch_failed` and `source_processed`
  - checklist rows now include `outcome_counts`, `host_budget_score`, `host_budget_state`, and `cooldown_seconds_remaining`
  - Phase 04 panel now shows budget state + live cooldown countdown per domain
- Phase 05 starter wiring is now live:
  - runtime knobs for `CONCURRENCY` and `PER_HOST_MIN_DELAY_MS` are exposed in GUI run settings
  - fetch lifecycle events now include `fetcher_kind`
  - IndexLab includes `Parallel Fetch & Parse (Phase 05)` live panel for in-flight/peak/mix/host activity
  - `URL Health & Repair (Phase 04)` was moved below `IndexLab Event Stream` per run-review flow
- Parsing management 01-03 wiring updates are now reflected in runtime:
  - 01 static DOM-first table parsing is active (Cheerio + fallback)
  - 02 dynamic parsing controls are wired (Crawlee enable/headless/retry/backoff/timeout + domain policy JSON)
  - 03 main article extraction is active (Readability + fallback scoring) and now surfaces live in GUI:
    - Phase 05 article metrics (sampled/readability/fallback/avg score/low-quality)
    - Event Stream Recent URL Jobs article columns (method/quality/low-quality/parse ms)
- Phase 06 starter wiring is now live:
  - `source_processed` events now emit `content_hash`, `bytes`, `content_type`, and `final_url`
  - IndexLab includes `Evidence Index & Dedupe (Phase 06A)` panel with live hash coverage and repeated-hash inventory
  - Session Crawled now shows real `Content Hash Dedupe Hits` (no placeholder)
  - pipeline/container status rows now include `phase 06a` / `Evidence Index` state
- Phase 06 improvement (first slice) is now started:
  - new API: `GET /api/v1/indexlab/run/:runId/evidence-index`
  - `Evidence Index & Dedupe` panel is now `Phase 06A` and is rendered above `Phase 06B`
  - Phase 06A now includes DB-backed inventory counters, document inventory table, top indexed fields table, and evidence text search
- Phase 06B scheduler starter is now live:
  - GUI API exposes `GET /api/v1/indexlab/run/:runId/automation-queue` for queue-state reconstruction
  - queue payload includes per-job type/state (`queued`, `running`, `done`, `failed`, `cooldown`) and transition feed
  - initial loops are wired from existing signals:
    - repair search (`repair_query_enqueued`, `search_started`, `search_finished`)
    - staleness refresh from repeated `content_hash`
    - NeedSet deficit rediscovery jobs from `needset` + search profile targeting
  - IndexLab includes `Automation Queue (Phase 06B)` panel with live queue metrics, job table, and transition feed
  - Session Data now shows real `Scheduler Queue Depth` instead of placeholder
  - runtime bridge now forwards scheduler events (`repair_query_enqueued`, `url_cooldown_applied`, `blocked_domain_cooldown_applied`) and includes `content_hash`/`bytes` on `fetch_finished`
- Phase 07 starter is now live:
  - new retrieval modules: `src/retrieve/tierAwareRetriever.js` and `src/retrieve/primeSourcesBuilder.js`
  - run pipeline now builds and persists `analysis/phase07_retrieval.json` (run + latest)
  - runtime emits `phase07_prime_sources_built` for event-stream proof
  - GUI API exposes `GET /api/v1/indexlab/run/:runId/phase07-retrieval`
  - IndexLab includes `Tier Retrieval & Prime Sources (Phase 07)` panel with:
    - field-level retrieval/prime-source policy status
    - selected prime source rows
    - ranked retrieval hit rows with selected-state proof
- Phase 08B planning is now added for visual evidence proof:
  - dedicated visual asset capture phase (screenshots + product images + hashes)
  - extraction context wiring consumes image references for ambiguous identity/model validation
  - GUI proof requirement includes live image preview + per-asset download while run is active
  - derivative-only LLM image payload policy (no originals) with byte-savings telemetry
  - multi-product target-match gating so non-target product evidence is filtered before extraction/review
- Phase 01 identity ambiguity controls are now live:
  - run pipeline computes `family_model_count` and `ambiguity_level` from catalog siblings per `brand+model`
  - ambiguity levels are now 5-tier: `easy`, `medium`, `hard`, `very_hard`, `extra_hard`
  - NeedSet identity payload includes `extraction_gate_open` (separate from strict publish gate)
  - variant-empty products now use ambiguity level to relax extraction only for `easy/medium`
  - Product Picker includes color-coded ambiguity meter + tooltip legend

## Diagram and Mermaid note
- No Mermaid source files are in this `ai-indexing-plans` bundle, so no Mermaid diagram source update was required for this change set.

Generated: 2026-02-19
