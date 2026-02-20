# CLAUDE.md — Spec Factory / Spec Harvester

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
  api/             - guiServer.js (WS + REST), reviewRoutes, mutationRoutes
  pipeline/        - runProduct.js (main orchestrator)
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
        indexing/  - IndexingPage.tsx (IndexLab UI — all phase panels)
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

### Phase Status Summary (from `Implentation Plan.csv`)

| Phase | File | Status |
|-------|------|--------|
| Parsing 01-06 | static HTML, dynamic, article, table, structured metadata, PDF | **Full** |
| Parsing 07 | Scanned PDF / OCR | **Partial** — preprocess + fixture suite pending |
| Parsing 11 | Visual asset capture | **Partial** — full quality/identity gate rollout pending |
| Parsing 08 | Image OCR worker pipeline | **Not implemented** |
| Parsing 09 | Chart/graph extraction | **Partial** — network payloads only |
| Parsing 10 | Mixed-office doc ingestion | **Partial** |
| Phase 00 | IndexLab harness + event stream | **Partial** — remaining GUI proof items |
| Phase 01 | NeedSet engine + field state | **Partial** — evidence freshness decay not done |
| Phase 02 | SearchProfile + alias planning | **Partial** — planner returns strings only (no full profile object) |
| Phase 03 | Provider search + SERP triage | **Partial** — applicability fields + score decomposition pending |
| Phase 04 | URL health + self-healing | **Partial** — repair-to-scheduler handoff pending |
| Phase 05 | Parallel fetch + parse | **Partial** — bounded multi-pool scheduler + dual-source resilience pending |
| Phase 06A | Evidence index database | **Partial** — FTS-backed search + dedupe outcome events pending |
| Phase 06B | Refetch scheduler + continuous repair | **Partial** — full queue state machine not yet closed |
| Phase 07 | Tier retrieval + prime sources | **Partial** — per-field tier preference + identity gating remaining |
| Phase 08 | Extraction context wiring | **Partial** — multimodal/visual refs + policy validation remaining |
| Phase 08B | Visual asset capture proof | **Partial** — full orchestration + GUI proof controls pending |
| Phase 09 | Convergence loop + stop conditions | **Partial** — explicit round controller + GUI proof not complete |
| Phase 10 | Learning + compounding | **Partial** — guarded learning contract not closed |
| Phase 11 | Worker lanes + runtime control | **Not implemented** |
| Phase 12 | Multi-product batch automation | **Not implemented** |

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
src/api/guiServer.js                   - all REST + WS endpoints
tools/gui-react/src/pages/indexing/IndexingPage.tsx  - all IndexLab GUI panels
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

### GUI Panels (IndexingPage.tsx)
Live IndexLab panels in order:
1. IndexLab Event Stream (Phase 00)
2. NeedSet (Phase 01)
3. Search Profile (Phase 02)
4. SERP Explorer (Phase 03)
5. URL Health & Repair (Phase 04)
6. Parallel Fetch & Parse (Phase 05)
7. Evidence Index & Dedupe (Phase 06A)
8. Automation Queue (Phase 06B)
9. Tier Retrieval & Prime Sources (Phase 07)
10. Extraction Context Matrix (Phase 08)
11. Visual Assets (Phase 08B) — pending full implementation
12. Round/Convergence summary (Phase 09) — pending
13. Learning Feed (Phase 10) — pending

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

### Approved Refactoring Techniques

These are the only refactoring patterns used during decomposition. No other approaches.

- **Preparatory Refactoring**: Do not add new features to the core orchestrator module (`runProduct.js` / `RunOrchestrator`). Refactor and extract phases *in preparation* for Phase 09 to avoid accumulating technical debt. New capabilities go into the new modules, not into the monolith.

- **Extract Method / Composing Method**: Aggressively break down the monolith. Extract isolated logic (e.g., SearchProfile building, Consensus scoring, FetchParseWorker) into smaller, pure functions in new dedicated modules, then replace the original inline code with a single delegating call. The orchestrator should read like a sequence of named steps, not implementation detail.

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
