# Phase 11 - Workers and Runtime Control

## Canonical Status
- This is the single canonical file for this phase.
- Consolidated on 2026-02-20 from split planning plus improvement docs.
- Includes implemented status and remaining work from merged sources.
- Keep all unfinished items active until code plus GUI proof confirms completion.

## Merged Source Files
- PHASE-11-workers-control.md
- PHASE-11-IMPROVMENT.md

## Full Merged Spec

### Source: PHASE-11-workers-control.md

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

# Phase 11 â€” LAST: worker pool sizing controls + GUI knobs


## Goal
After correctness is proven, add operator controls for scaling:
- configure worker counts per pool
- show live pool metrics
- ensure per-host backoff still protects against blocks

This is intentionally last to avoid masking correctness problems with brute force.

## Deliverables
- Configurable worker counts:
  - search/fetch/parse/llm
- GUI controls:
  - sliders/input + presets
  - display effective per-host limits
- Persisted run config snapshot

## Implementation

### 11.1 Config
In `src/config.js` add:
- `WORKERS_SEARCH`
- `WORKERS_FETCH`
- `WORKERS_PARSE`
- `WORKERS_LLM`

Wire these into the pool constructors in Phase 5 scheduler.

### 11.2 GUI
Add â€œWorkersâ€ panel:
- current settings
- active/queued per pool
- requests/min
- 429/blocked rate (ensure it doesnâ€™t spike)

Allow changing settings:
- for next run (safe)
- optionally live-update pools (advanced; can be deferred)

### 11.3 Proof
- Increase fetch workers: requests/min rises
- blocked/429 stays controlled (backoff is working)
- time-to-coverage decreases

## Exit criteria
- Worker controls change throughput predictably without breaking reliability.

### Source: PHASE-11-IMPROVMENT.md

> Original header: PHASE-11 IMPROVMENT


## What I'd Add
1. Add worker control plane with per-lane concurrency and token budgets.
2. Add dynamic load shedding when quality or block rate degrades.
3. Add hard safety controls: lane pause, global pause, forced drain.
4. Add per-worker health and restart telemetry.

## What We Should Implement Now
1. Expose per-lane worker knobs in GUI with sane defaults.
2. Add per-lane queue depth and throughput charts.
3. Add one-click safe drain and forced stop with clear state feedback.
4. Add cross-phase knob governance checks and runtime usage telemetry.

## Definition Of Done
1. Operators can control throughput without code changes.
2. System stays stable under load spikes and provider failures.
3. GUI clearly shows what each worker lane is doing in real time.
4. Control-plane knobs are auditable, and dead knobs are visible.

### 11.4 Cross-Phase Knob Governance (overlooked)
- Keep `src/field-rules/capabilities.json` as the single source of knob truth.
- Add CI checks:
  - every `status=live` knob must have at least one runtime consumer test
  - every `status=deferred` knob must reference a planned phase or rationale
- Emit per-run knob-usage telemetry so dead knobs are visible in run diagnostics.

### 11.5 GUI Proof
- Runtime panels show a knob usage summary for the run:
  - live knobs used
  - live knobs unused
  - deferred knobs present
- Release checks fail when a live knob has no runtime consumer coverage.

