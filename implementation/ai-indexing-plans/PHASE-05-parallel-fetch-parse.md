# Phase 05 - Parallel Fetch and Parse

## Canonical Status
- This is the single canonical file for this phase.
- Consolidated on 2026-02-20 from split planning plus improvement docs.
- Includes implemented status and remaining work from merged sources.
- Keep all unfinished items active until code plus GUI proof confirms completion.

## Merged Source Files
- PHASE-05-parallel-fetch-parse.md
- PHASE-05-IMPROVMENT.md

## Full Merged Spec

### Source: PHASE-05-parallel-fetch-parse.md

> Original header: Deep Spec Harvester - Phase 05 Parallel Fetch and Parse


## Goal
Improve throughput without losing accuracy by introducing Phase 05 controls and visibility for:
- parallel fetch behavior
- per-host pacing
- fetch-mode split (HTTP vs browser/escalated paths)

## Scope
Phase 05 is started in this change set with runtime controls and GUI proof surfaces.
Full worker-pool execution policy remains in progress.

## Implemented Starter Status (2026-02-19)

### 1) Runtime knobs wired from GUI -> process start env
Controls added in Runtime Settings:
- `fetch concurrency`
- `per-host delay ms`

Start API mapping:
- `fetchConcurrency` -> `CONCURRENCY`
- `perHostMinDelayMs` -> `PER_HOST_MIN_DELAY_MS`

Files:
- `tools/gui-react/src/pages/indexing/IndexingPage.tsx`
- `src/api/guiServer.js`

### 2) Fetch lifecycle events now carry fetcher kind
Added event payload field:
- `fetcher_kind`

Event touchpoints:
- `source_fetch_started`
- `source_fetch_failed`
- `source_processed`

File:
- `src/pipeline/runProduct.js`

### 3) New Phase 05 GUI panel
Added:
- `Parallel Fetch & Parse (Phase 05)` panel in IndexLab view

Panel shows:
- in-flight now
- peak in-flight
- fetch started/completed/failed
- HTTP finished count
- browser finished count
- other/unknown finished count
- p95 fetch duration
- p95 parse duration
- active hosts with current in-flight counts
- skip reason counters (`cooldown`, `blocked_budget`, `retry_later`)
- currently applied runtime knob values (concurrency, per-host delay)

File:
- `tools/gui-react/src/pages/indexing/IndexingPage.tsx`

### 4) Phase ordering update
- `URL Health & Repair (Phase 04)` now renders below `IndexLab Event Stream` as requested.

File:
- `tools/gui-react/src/pages/indexing/IndexingPage.tsx`

### 5) Phase-04 host budget consumed before fetch
- Added host budget gating in pipeline before fetch starts.
- Skip reasons now emit explicitly through `source_fetch_skipped`.
- Runtime bridge forwards timing/budget fields to IndexLab events for live GUI proof.

Files:
- `src/pipeline/runProduct.js`
- `src/indexlab/runtimeBridge.js`
- `tools/gui-react/src/pages/indexing/IndexingPage.tsx`

### 6) Parsing management integration (01-03) now reflected in Phase 05 runtime proof
- Static HTML parsing hardening (01):
  - DOM-first table parsing with Cheerio and regex fallback.
- Dynamic fetch policy + Crawlee controls (02):
  - runtime knobs for Crawlee enable/headless/retry/backoff/handler timeout.
- Main article extraction (03):
  - Readability + fallback extraction wired into evidence pack.
  - `source_processed` and `parse_finished` now carry article telemetry.
  - Phase 05 panel now shows article metrics:
    - sampled/readability/fallback/avg score/low-quality
  - Event Stream `Recent URL Jobs` now includes:
    - parse ms, article method, article quality score, low-quality flag

### 7) Artifact proof lane added for downstream multimodal review
- Fetchers now capture one screenshot artifact per fetched page (selector-first crop, then page fallback).
- Pipeline emits a DOM snippet artifact per page (table/spec-section window).
- Export now writes both artifacts per host:
  - `raw/screenshots/<host>/screenshot.jpg` + `screenshot.meta.json`
  - `raw/dom/<host>/dom_snippet.html` + `dom_snippet.meta.json`
- These artifacts are now available for later multimodal routing and review traces.

Code touchpoints:
- `src/fetcher/playwrightFetcher.js`
- `src/pipeline/runProduct.js`
- `src/exporter/exporter.js`
- `src/config.js`

Live proof from run `20260219221853-19af54`:
- `out/specs/outputs/mouse/mouse-corsair-sabre-rgb-pro/runs/20260219221853-19af54/raw/screenshots/rtings.com__0000/screenshot.jpg`
- `out/specs/outputs/mouse/mouse-corsair-sabre-rgb-pro/runs/20260219221853-19af54/raw/dom/rtings.com__0000/dom_snippet.html`

## Remaining Phase 05 Work
- true bounded multi-pool scheduler execution (search/fetch/parse/llm lanes)
- explicit per-host in-flight caps beyond delay-based pacing
- HTTP-first escalation heuristics stored per-URL with decision reasons
- queue backlog and p95 latency proof rows tied to pool states

## GUI Proof Checklist (starter)
1. Start IndexLab run.
2. Confirm `Parallel Fetch & Parse (Phase 05)` panel updates while run is active.
3. Confirm in-flight and peak counters move.
4. Confirm fetch completion counts increment and fetcher-kind mix appears.
5. Confirm active host rows appear during run.

## Exit Criteria For This Starter Slice
- Phase 05 controls are adjustable per run.
- Phase 05 panel has live non-placeholder metrics.
- Fetch events carry enough data (`fetcher_kind`) for next-stage scheduler tuning.

### Source: PHASE-05-IMPROVMENT.md

> Original header: PHASE-05 IMPROVMENT


## What I'd Add
1. Move from basic concurrency knobs to explicit worker pools (fetch/parse/index/llm lanes).
2. Add host-level in-flight caps and adaptive backoff based on Phase-04 signals.
3. Add startup warm path to reduce first-activity delay after run start.
4. Add queue latency metrics (p50/p95 wait and execution time).

## What We Should Implement Now
1. Consume host budget from Phase-04 before each fetch start.
2. Add explicit skip reasons (`cooldown`, `blocked_budget`, `retry_later`) to events.
3. Add p95 fetch and parse duration cards in the Phase-05 panel.

## Implemented (2026-02-19)
1. Host-budget gating is now applied before fetch start in the run loop.
2. Skip events now emit explicit reasons (`cooldown`, `blocked_budget`, `retry_later`) via `source_fetch_skipped`.
3. Phase-05 GUI now shows p95 fetch + p95 parse latency cards and skip-reason counters.
4. Runtime bridge now forwards timing/budget fields (`fetch_ms`, `parse_ms`, `host_budget_*`, `fetcher_kind`) into IndexLab events so GUI proof is live.
5. Article extraction telemetry is now included in Phase-05 runtime:
   - parse events carry `article_extraction_method`, quality score, char count, low-quality state, and fallback reason.
   - Phase-05 panel now surfaces live article metrics and Event Stream URL rows expose article method/quality columns.

## Dual-Source `no_result` Resilience (Merged Runs)
### Problem
In single-run merged scenarios (review source + manufacturer source), one source can intermittently fail with `Crawlee fetch failed: no_result`, which blocks two-source convergence for downstream indexing/LLM review.

### What We Should Implement Now
1. Add in-run fallback fetch policy for `no_result`:
   - attempt order: Crawlee -> PlaywrightFetcher direct -> HttpFetcher (where safe/applicable)
   - preserve the same source identity key and dedupe key across fallback attempts
2. Add bounded retry envelope:
   - max attempts per source URL with per-attempt reason codes
   - exponential backoff plus host-budget-aware cooldown updates
3. Add explicit merged-run telemetry:
   - `source_fetch_fallback_started`, `source_fetch_fallback_succeeded`, `source_fetch_fallback_exhausted`
   - per-source `attempt_index`, `fetcher_kind`, `failure_reason`, `elapsed_ms`
4. Add merged-run quality gate:
   - if a merged run is configured with two required prime sources, mark run as `degraded_merge_fetch` when only one source survives
   - auto-enqueue scheduler follow-up through Phase 06B with missing-source target

### Code Touchpoints
1. `src/fetcher/playwrightFetcher.js`
2. `src/pipeline/runProduct.js`
3. `src/fetcher/dynamicFetchPolicy.js`
4. `src/indexlab/runtimeBridge.js`
5. `src/api/guiServer.js` (proof payload exposure)

### GUI Proof Requirements
1. Show per-source fetch attempt ladder in Phase-05 panel.
2. Show merged-run source survival summary (`required=2`, `survived=1/2`).
3. Show fallback success rate and `no_result` exhaustion rate by host.

## Definition Of Done
1. Higher useful actions/minute without higher block rate.
2. First visible activity appears quickly and predictably.
3. Throughput bottlenecks are visible per lane.

