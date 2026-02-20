# Deep Spec Harvester — Phased Implementation Plan (Accuracy‑Max)

This phase file is written as an **implementation prompt for senior software engineers**.
It includes: exact deliverables, file touchpoints, schemas/events, test strategy, and **GUI proof**.

**Guiding principles**
- Accuracy is the primary objective (95%+ on technical specs).
- Evidence tiers and confidence gates control *what happens next*.
- Discovery is need‑driven (missing/low-confidence/conflict fields) — no endless key/alias loops.
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

# Phase 11 — LAST: worker pool sizing controls + GUI knobs


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
Add “Workers” panel:
- current settings
- active/queued per pool
- requests/min
- 429/blocked rate (ensure it doesn’t spike)

Allow changing settings:
- for next run (safe)
- optionally live-update pools (advanced; can be deferred)

### 11.3 Proof
- Increase fetch workers: requests/min rises
- blocked/429 stays controlled (backoff is working)
- time-to-coverage decreases

## Exit criteria
- Worker controls change throughput predictably without breaking reliability.
