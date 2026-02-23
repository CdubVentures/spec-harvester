# AGENTS.md — Spec Factory / Spec Harvester

This file is read at session start and after every context compaction.
Keep it up to date as the project evolves.

---

## Project Overview

**Spec Harvester** is a backend-first product specification harvesting pipeline.
It discovers, fetches, parses, indexes, and extracts technical product specifications from the web using LLM-assisted extraction, consensus scoring, and a structured review GUI.

The primary use case is populating a product-spec database (e.g. monitors, mice) with high-accuracy field values sourced from manufacturer pages, lab reviews, teardowns, and PDFs.

---

## Tech Stack

- **Runtime**: Node.js ≥ 20, ESM (`"type": "module"`)
- **Main entry**: `src/cli/spec.js`
- **Database**: `better-sqlite3` (SQLite) via `src/db/specDb.js`
- **HTTP fetching**: `crawlee` + `playwright` + plain HTTP
- **HTML parsing**: `cheerio`, `jsdom`, `@mozilla/readability`
- **PDF parsing**: `pdf-parse` + optional backends (`pdfplumber`, `pdfminer`, `PaddleOCR`)
- **Schema validation**: `ajv` + `ajv-formats`, `zod`
- **LLM clients**: `src/llm/openaiClient.js` (OpenAI-compatible; supports multiple providers including Gemini)
- **GUI API server**: `src/api/guiServer.js` (WebSocket + REST)
- **GUI frontend**: `tools/gui-react/` (React + TypeScript, Vite)
- **Test runner**: Node built-in `node --test` (no Jest/Vitest — use `node --test`)
- **Packaging**: `@yao-pkg/pkg` (builds `SpecFactory.exe`)

---

## Directory Structure

```
src/
  cli/             - CLI entry points (spec.js is main; indexlab.js for IndexLab)
  api/             - guiServer.js (WS + REST dispatch shell, 2612 LOC), reviewRoutes, mutationRoutes
  api/helpers/      - requestHelpers.js (60+ shared utilities extracted from guiServer)
  api/routes/       - infraRoutes, configRoutes, indexlabRoutes, catalogRoutes, brandRoutes,
                     studioRoutes, reviewRoutes, testModeRoutes, queueBillingLearningRoutes,
                     sourceStrategyRoutes, indexlabDataBuilders (all extracted from guiServer)
  pipeline/        - runProduct.js (main orchestrator), consensusPhase.js, learningExportPhase.js,
                     runOrchestrator.js, automationQueue.js
  pipeline/helpers/ - cryptoHelpers, urlHelpers, provenanceHelpers, candidateHelpers,
                     evidenceHelpers, reasoningHelpers, identityHelpers, runtimeHelpers,
                     scoringHelpers, typeHelpers (Groups 1-10 extracted from runProduct.js)
  learning/        - learningUpdater.js, learningStores.js, learningSuggestionEmitter.js
  indexlab/        - needsetEngine.js, runtimeBridge.js, indexingSchemaPackets.js
  discovery/       - searchDiscovery.js
  search/          - searchProviders.js, queryBuilder.js, serpDedupe.js
  extract/         - articleExtractor.js, pdfBackendRouter.js, deterministicParser.js
  extractors/      - staticDomExtractor.js, fieldExtractor.js
  fetcher/         - playwrightFetcher.js, dynamicCrawlerService.js
  llm/             - extractCandidatesLLM.js, validateCandidatesLLM.js, fieldBatching.js,
                     discoveryPlanner.js, extractionContext.js, openaiClient.js
  scoring/         - consensusEngine.js, fieldAggregator.js, candidateMerger.js
  retrieve/        - tierAwareRetriever.js, primeSourcesBuilder.js
  research/        - frontierDb.js, frontierSqlite.js, uberAggressiveOrchestrator.js
  db/              - specDb.js, seed.js
  evidence/        - evidencePackV2.js
  exporter/        - exporter.js
  categories/      - loader.js
  field-rules/     - loader.js
  review/          - componentReviewData.js, keyReviewState.js
  scoring/         - consensusEngine.js, candidateMerger.js, fieldAggregator.js
  adapters/        - manufacturerAdapter.js, techPowerUpAdapter.js, eloShapesAdapter.js,
                     tableParsing.js, index.js
  config.js        - all env var defaults and config constants

tools/
  gui-react/       - React+TypeScript GUI (Vite, builds to dist/)
    src/
      pages/
        indexing/  - IndexingPage.tsx (layout shell, 4209 LOC), types.ts, helpers.tsx
        indexing/panels/ - 19 extracted panel components (Overview, Runtime, Picker,
                     SearchProfile, SerpExplorer, Phase05-09, Phase06/06b,
                     LlmOutput, LlmMetrics, EventStream, NeedSet, etc.)
        component-review/ - ComponentReviewDrawer.tsx, EnumSubTab.tsx
      components/common/ - CellDrawer.tsx, Tip.tsx

implementation/
  SECTION-03-ai-indexing-lab-execution.md  - canonical scope doc for this section
  ai-indexing-plans/                        - canonical phase plans (Phases 00-12)
    PHASE-00 through PHASE-12 .md           - one file per phase, merged spec + improvement
    parsing-managament/                     - parsing sub-phases (01-14)
    Implentation Plan.csv                   - status tracker for all files

test/              - test files, one per module (node --test runner)
fixtures/          - test input fixtures (S3-style input JSONs)
categories/        - category definitions (monitor, mouse, etc.)
artifacts/         - runtime output (indexlab run events, NeedSet, SearchProfile, etc.)
out/               - pipeline output specs
```

---

## Active Work: Section 03 — AI Indexing Lab Execution

We are working on `SECTION-03-ai-indexing-lab-execution.md` and its canonical phase files in `implementation/ai-indexing-plans/`.

### Phase Status Summary (Audited 2026-02-22, 2443 tests pass)

**Sprints 1-6 + Order 29: COMPLETE. Sprint 7 Track B (Items 53+54+61): COMPLETE. Monolith Decomposition: COMPLETE. 2443 tests pass.**

| Phase | File | Status |
|-------|------|--------|
| Parsing 01-06 | static HTML, dynamic, article, table, structured metadata, PDF | **Full** (100%) |
| Parsing 07 | Scanned PDF / OCR | **Partial** (30%) — baseline OCR works; preprocess + PaddleOCR + fixture suite pending |
| Parsing 08 | Image OCR worker pipeline | **Not implemented** (0%) — depends on Phase 08B |
| Parsing 09 | Chart/graph extraction | **Partial** (10%) — network payload intercept only |
| Parsing 10 | Mixed-office doc ingestion | **Not implemented** (0%) — zero code exists |
| Parsing 11 | Visual asset capture | **Partial** (20%) — screenshots work; full control-plane pending |
| Phase 00 | IndexLab harness + event stream | **Near-complete** (97%) — all event handlers verified, identity thresholds aligned (Order 29) |
| Phase 01 | NeedSet engine + field state | **Full** (100%) — formula (8 multipliers) + identity caps + freshness decay |
| Phase 02 | SearchProfile + alias planning | **Full** (100%) — structured SearchProfile with target_fields + LLM planner |
| Phase 03 | Provider search + SERP triage | **Full** (100%) — 3 applicability functions + two-reranker pipeline + dedupe |
| Phase 04 | URL health + self-healing | **Partial** (65%) — cooldowns + repair queries working; repair→06B handoff deferred |
| Phase 05 | Parallel fetch + parse | **Partial** (80%) — lifecycle events + host budget + **bounded concurrent scheduler** (HostPacer + FallbackPolicy + FetchScheduler) + **dual-source resilience** (403/timeout/5xx/network→fallback) all working. Feature-flagged (`FETCH_SCHEDULER_ENABLED`). GUI Scheduler & Fallback panel. 84 tests. **Phase 11 unblocked.** Remaining: per-lane queues (search/parse/llm) require Phase 11 |
| Phase 06A | Evidence index database | **Full** (100%) — FTS5 + stable snippet_ids + dedupe events + GUI |
| Phase 06B | Refetch scheduler + continuous repair | **Partial** (60%) — durable queue + state machine; worker loop + TTL pending |
| Phase 07 | Tier retrieval + prime sources | **Full** (100%) — tier preference + identity gating + traces + miss diagnostics; FTS wiring pending (Sprint 7) |
| Phase 08 | Extraction context wiring | **Full** (100%) — context matrix + identity gate + structured output parser + lane tracing |
| Phase 08B | Visual asset capture proof | **Partial** (25%) — ScreenshotQueue + config knobs + Playwright capture + 8 tests; full orchestration + quality gates pending |
| Phase 09 | Convergence loop + stop conditions | **Full + Production** (100%) — 7 stop conditions, `--convergence` flag, identity fast-fail (Order 29), 26 tests |
| Phase 10 | Learning + compounding | **Partial** (70%) — 5 gates + 4 stores + suggestions + GUI skeleton; two-product proof pending |
| Phase 11 | Worker lanes + runtime control | **Partial** (15%) — WorkerPool + BudgetEnforcer + AsyncDeepJobQueue exist in `src/concurrency/`; per-lane config + GUI panel + integration pending. Depends on Phase 05 |
| Phase 12 | Multi-product batch automation | **Not implemented** (0%) — depends on Phase 11 |

### Where to Begin (Sprint 7 Remaining Priority Order)

1. **Phase 10 two-product proof** — Can start now. Acceptance gate for Phase 10 completion.
2. **Phase 07 FTS wiring** — Replace fallback pool with FTS queries.
3. ~~**Phase 05 multi-pool scheduler**~~ — **DONE** (Sprint 7 Track B). Phase 11 unblocked.
4. ~~**Helper Groups 7-10**~~ — **DONE** (Sprint 7 Track B). runProduct.js 4280→3955 LOC. 88 characterization tests.
5. **Phase 06B worker loop + TTL** — Consume automation queue.
6. **Phase 11 worker controls** → **Phase 12 batch automation** (sequential dependency — now unblocked).

### Monolith Decomposition Status (COMPLETE — 2026-02-22)

| File | Before | After | Reduction |
|------|--------|-------|-----------|
| guiServer.js | 8,248 | 2,612 | 68% |
| runProduct.js | 4,418 | 3,955 | 10.5% |
| IndexingPage.tsx | 10,291 | 4,209 | 59% |
| **Total** | **22,957** | **10,776** | **53%** |

New modules: 12 route/helper files (guiServer), 10 pipeline helper files (runProduct), 21 panel/type/helper files (IndexingPage), 7 barrel exports. 2,443 tests pass.

### Key Source Files for Section 03

```
src/cli/indexlab.js                     - IndexLab CLI entry
src/indexlab/runtimeBridge.js           - event stream bridge
src/indexlab/needsetEngine.js           - NeedSet computation
src/indexlab/indexingSchemaPackets.js   - packet schema definitions
src/pipeline/runProduct.js              - main run orchestrator
src/discovery/searchDiscovery.js        - discovery orchestrator
src/search/searchProviders.js           - Google/SearXNG provider calls
src/search/queryBuilder.js              - query assembly + SearchProfile
src/research/frontierDb.js              - URL health (JSON backend)
src/research/frontierSqlite.js          - URL health (SQLite backend)
src/retrieve/tierAwareRetriever.js      - evidence retrieval ranking
src/retrieve/primeSourcesBuilder.js     - prime source selection per field
src/llm/extractCandidatesLLM.js         - LLM extraction batches
src/llm/extractionContext.js            - Phase 08 context matrix assembler
src/llm/fieldBatching.js               - batch grouping strategy
src/llm/discoveryPlanner.js            - Phase 02 LLM search planner
src/api/guiServer.js                   - REST + WS dispatch shell (2,612 LOC)
src/api/helpers/requestHelpers.js      - shared request utilities (extracted)
src/api/routes/                        - 10+ route handler modules (extracted)
tools/gui-react/src/pages/indexing/IndexingPage.tsx  - IndexLab layout shell (4,209 LOC)
tools/gui-react/src/pages/indexing/panels/           - 19 panel components (extracted)
```

### Event Model (NDJSON — Phase 00)
Events are written to `artifacts/indexlab/<run_id>/run_events.ndjson` and pushed via WebSocket.

Key events: `search_started/finished`, `fetch_started/finished`, `parse_started/finished`,
`index_started/finished`, `llm_started/finished/failed`, `needset_computed`,
`source_processed`, `source_fetch_skipped`, `repair_query_enqueued`,
`phase07_prime_sources_built`, `visual_asset_captured`, `run_context`, `run_completed`.

### Evidence Tiers
- **Tier 1**: Manufacturer official pages, spec PDFs, support docs
- **Tier 2**: Lab reviews, teardown reviews
- **Tier 3**: Retail listings, user forums
- **Tier 4**: Unverified/low-quality sources

### NeedSet Score Formula (Phase 01)
```
need = missing_multiplier × conf_term × required_weight
       × tier_deficit_multiplier × min_refs_deficit_multiplier × conflict_multiplier
```

### GUI Panels (IndexingPage.tsx — 17 tabs)
Live IndexLab panels:
1. Overview — Run metadata + status
2. Runtime — Runtime counters/config
3. Category/Product Picker
4. Search Profile (Phase 02)
5. SERP Explorer (Phase 03)
6. Parallel Fetch & Parse (Phase 05)
7. Automation Queue (Phase 06B)
8. Evidence Index & Dedupe (Phase 06A)
9. Tier Retrieval & Prime Sources (Phase 07)
10. Extraction Context Matrix (Phase 08)
11. Round/Convergence Summary (Phase 09) — implemented (Sprint 5)
12. Learning Feed (Phase 10) — skeleton (Sprint 6)
13. URL Health & Repair (Phase 04)
14. LLM Output — Raw LLM response trace
15. LLM Metrics — Token/cost metrics
16. IndexLab Event Stream (Phase 00)
17. NeedSet (Phase 01)


## Running the Project

```bash
# Run a single product through the full pipeline
npm run run:one -- --category mouse --s3key specs/inputs/mouse/products/mouse-razer-viper-v3-pro.json

# Run IndexLab mode
npm run run:indexlab -- --category mouse --seed "<retailer_url>"

# Start GUI API server
npm run gui:api

# Build GUI frontend
npm run gui:build

# Run all tests
npm test

# Run a specific test file
node --test test/needsetEngine.test.js
```

---

## Key Config Knobs (`src/config.js`)

- `CONCURRENCY` — fetch concurrency
- `PER_HOST_MIN_DELAY_MS` — per-host pacing
- `FRONTIER_COOLDOWN_403_BASE` — 403 cooldown seconds (default 1800)
- `FRONTIER_BLOCKED_DOMAIN_THRESHOLD` — blocked domain repeat threshold (default 2)
- `FRONTIER_REPAIR_SEARCH_ENABLED` — enable repair queries for 404/410 (default true)
- `LLM_PLAN_DISCOVERY_QUERIES` — Phase 02 LLM planner on/off
- `LLM_MODEL_PLAN`, `LLM_MODEL_TRIAGE`, `LLM_MODEL_EXTRACT`, etc. — per-role model selection
- `LLM_MAX_OUTPUT_TOKENS_*` — per-role token caps
- `VISUAL_ASSET_CAPTURE_ENABLED` — Phase 08B visual capture on/off
- `SEARXNG_BASE_URL` — SearXNG instance URL (default `http://localhost:8080`)

---

## Implementation Plan Canonical Files

The `implementation/ai-indexing-plans/` directory is the **canonical source of truth** for Section 03 execution.
Each `PHASE-XX-*.md` file is a merged spec (original plan + improvement notes).
`Implentation Plan.csv` tracks status and implementation order for all files.

Do NOT modify phase files unless updating their status or adding new implementation notes.
Phase files are considered "done" only when code AND GUI proof checklist both confirm completion.

---



## Core Development Philosophy

### TEST-DRIVEN DEVELOPMENT IS NON-NEGOTIABLE

Every single line of production code must be written in response to a failing test.
No exceptions. This is the fundamental practice that enables all other principles.

**RED → GREEN → REFACTOR**
- **RED**: Write the failing test first. Zero production code without a failing test.
- **GREEN**: Write the minimum code to make the test pass.
- **REFACTOR**: Improve only if it adds real value. Keep increments small and always working.

Wait for explicit commit approval before every commit.

### Decomposition Safety Rule — NON-NEGOTIABLE

When decomposing, extracting, or refactoring existing code, **existing functionality must never break**.

The protocol is:
1. **Tests must be green before touching anything.** Run the full test suite and confirm it passes. If tests are already failing, stop and fix them before refactoring.
2. **Write characterization tests first** for any code that lacks coverage before moving it. These tests capture the current behavior — they are the safety net for the extraction.
3. **Move in the smallest possible increments.** Extract one function or one responsibility at a time. Run tests after every single move. Never batch multiple extractions into one step.
4. **The extracted module must produce identical outputs** to the inline code it replaced, on the same inputs. If behavior changes during extraction, that is a bug, not a feature.
5. **No behavior changes during a refactor step.** Refactor means structure changes, behavior stays identical. If you want to change behavior, do it in a separate commit with its own failing test.
6. **If tests go red at any point during extraction, revert the extraction, not the tests.** The tests are the source of truth. A red test during refactor means the extraction broke something.
7. **The pipeline must run end-to-end successfully** on at least one product before a decomposition step is considered complete.

### App Section / Feature Organization (Vertical Slicing)

**Organize by Domain, Not by Technical Layer**
App sections and features must be entirely self-contained within their own domain directories. This approach, known as Vertical Slicing, ensures modularity and prevents tangled dependencies.

* **The Rule of Proximity:** Everything required for a specific app feature (validation, pure logic, state transformations, and UI components) must live together in that feature's directory. 
* **No Generic "Junk Drawers":** Directories like `src/utils/`, `src/helpers/`, or `src/services/` are strictly prohibited. If a function belongs to a specific feature, it lives in that feature's folder. If it is genuinely shared across multiple boundaries, it must be extracted into a clearly defined `shared-core/` or `infrastructure/` module.
* **Strict Boundary Enforcement:** One feature cannot directly import internal implementations from another. If "Feature A" needs data from "Feature B", it must communicate through explicitly defined public contracts (`index.js` exports) or a central orchestrator.

**Standardized Feature Directory Structure:**

src/
├── feature-a/               # Self-contained domain boundary
│   ├── index.js             # Explicit public API for this feature
│   ├── transformations.js   # Pure functions and mapping logic
│   ├── validation.js        # Domain-specific schemas
│   └── components/          # UI components (if applicable to the stack)
│
├── feature-b/               # Completely isolated from feature-a
│   ├── index.js
│   ├── core-logic.js
│   └── rules.js
│
└── shared-infrastructure/   # Cross-cutting side effects and external adapters
    ├── network-client.js
    └── logger.js

### Approved Refactoring Techniques

These are the only refactoring patterns used during decomposition. No other approaches.

- **Preparatory Refactoring**: Do not add new features to the core orchestrator module. Refactor and extract logic in preparation for upcoming phases to avoid accumulating technical debt. New capabilities should go into distinct new modules, not into the existing monolith.

- **Extract Method / Composing Method**: Aggressively break down the monolith. Extract isolated logic and domain-specific operations into smaller, pure functions within new, dedicated modules. Replace the original inline code with a single delegating call. The core orchestrator must read like a high-level sequence of named steps, abstracting away all implementation details.

- **Moving Features Between Modules**: Shift non-orchestration responsibilities out of the main loop and into dedicated domain modules. Billing belongs in the billing module. Telemetry formatting belongs in the runtime bridge. Extraction state belongs in the extraction phase module. The orchestrator owns sequencing only.

- **Red-Green-Refactor Pipeline for Extraction**: When extracting a module, write a failing test for the new standalone component first. Make it pass using the extracted logic. Then wire the new module back into the orchestrator as a replacement for the inline code. Run the full suite. Green = done.

### Testing Principles
- Test behavior, not implementation. 100% coverage through business behavior.
- Test through the public API exclusively.
- Use factory functions for test data (no `let`/`beforeEach` mutation).
- Tests must document expected business behavior.
- No 1:1 mapping between test files and implementation files required.
- Test runner: `node --test` (NOT Jest/Vitest — this project uses the built-in runner).
- Tests live in `test/` directory.

### Code Style (Functional)
- No data mutation — immutable data structures only.
- Pure functions wherever possible.
- No nested if/else — use early returns or composition.
- No comments — code should be self-documenting.
- Prefer options objects over positional parameters.
- Use array methods (`map`, `filter`, `reduce`) over loops.
- Small, focused functions. Avoid premature abstractions.

### JavaScript Conventions (this is a JS project, not TypeScript)
- All source files are `.js` ESM (`import`/`export`).
- GUI frontend (`tools/gui-react/`) is TypeScript + React.
- Use `zod` or `ajv` for schema validation at trust boundaries.
- Avoid `any` equivalents — validate at boundaries, trust internals.

### Guiding Principles (IndexLab Specific)
- **Accuracy first**: 95%+ on technical specs is the objective.
- **Evidence tiers + confidence gates** control what happens next.
- **Need-driven discovery**: NeedSet drives search — no endless alias loops.
- **Deterministic indexing**: `content_hash` dedupe + stable `snippet_id`s = replayable, auditable.
- **GUI must prove each phase**: no phase is "done" until GUI proof checklist is complete.

---


