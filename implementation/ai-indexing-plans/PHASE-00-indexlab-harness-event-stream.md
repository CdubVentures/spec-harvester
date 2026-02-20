# Phase 00 - IndexLab Harness and Event Stream

## Canonical Status
- This is the single canonical file for this phase.
- Consolidated on 2026-02-20 from split planning plus improvement docs.
- Includes implemented status and remaining work from merged sources.
- Keep all unfinished items active until code plus GUI proof confirms completion.

## Merged Source Files
- PHASE-00-indexlab-harness.md
- PHASE-00-IMPROVMENT.md

## Full Merged Spec

### Source: PHASE-00-indexlab-harness.md

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

# Phase 00 â€” IndexLab harness + live event stream (GUI baseline)


## Goal
Create a **single-product harness** that runs discoveryâ†’fetchâ†’parseâ†’index in isolation and streams live events to the GUI.
This is the foundation for proving every later phase.

## What ships in this phase
### Deliverables
- **CLI**: `src/cli/indexlab.js` (or extend `src/cli/run-one.js` with `--indexlab` mode)
- **Event stream**: NDJSON file + WebSocket push
- **GUI tab/page**: â€œIndexLabâ€ (live job table + stage timeline + counters)

### Non-goals
- No changes to extraction, consensus, validation logic yet (those remain as-is).
- No new SQL schema yet (use minimal run artifacts + optional in-memory stores).

## Implementation details

### 0.1 CLI: one-product runner
Add a CLI entry that accepts:
- `--category mouse`
- `--seed retailer_url|title|brand|model|sku`
- `--fields` optional (override for targeted missing-field testing)
- `--providers google,searxng` (optional)
- `--out ./artifacts/indexlab/<run_id>/`

**Recommended approach**
- Reuse your existing single-run path:
  - `src/cli/run-one.js` â†’ calls `src/pipeline/runProduct.js`
- Add a â€œdry modeâ€ that stops after indexing (Phase 6 will formalize the DB).

### 0.2 Event model (for GUI + replay)
Emit structured events at boundaries:
- `search_started/search_finished`
- `fetch_started/fetch_finished`
- `parse_started/parse_finished`
- `index_started/index_finished`
- `llm_started/llm_finished/llm_failed` (purpose/model/provider/tokens)
- `needset_computed` (Phase 1 will add the payload)
- `error`

Event envelope:
```json
{
  "run_id": "r_...",
  "ts": "2026-02-18T12:34:56.789Z",
  "stage": "llm",
  "event": "llm_started",
  "payload": {
    "reason": "discovery_planner",
    "route_role": "plan",
    "provider": "gemini",
    "model": "gemini-2.5-flash-lite",
    "max_tokens_applied": 2048
  }
}
```

Write to:
- `artifacts/<run_id>/run_events.ndjson`
- Push over WS (see below)

### 0.3 GUI wiring
`src/api/guiServer.js` already hosts WS and serves review pages. Add:
- WS message type: `indexlab_event`
- REST endpoint: `GET /api/indexlab/runs` (list recent runs from artifacts dir)
- REST endpoint: `GET /api/indexlab/run/:run_id/events` (tail NDJSON)

### 0.4 Metrics surface (stub)
Even if you donâ€™t deploy Prometheus yet, define counters in code (Phase 5 will make them real):
- `harvester_stage_duration_ms{stage}`
- `harvester_fetch_total{status_class}`
- `harvester_active_jobs{stage}`

## How we prove it works in the GUI (required)
### GUI proof checklist
1. Start IndexLab run from CLI:
   - `node src/cli/indexlab.js --category mouse --seed "<retailer_url>" --out artifacts/indexlab`
2. Open GUI â†’ IndexLab tab
3. Verify live updates WITHOUT refresh:
   - Stage timeline updates (search/fetch/parse/index)
   - Active jobs table shows URLs
   - Counts move (pages checked, fetched OK, 404s)
   - LLM overview gauge and pending-call bars move while calls are in flight

### Expected screenshots (what "done" looks like)
- A timeline waterfall with at least `fetch` and `parse` segments.
- A live table with URLs and statuses (200/404 etc).
- Overview section showing pending LLM rows with purpose/model and non-zero counts during active calls.

## Engineering notes
- Keep the event stream append-only and resilient to crashes (flush per event or per batch).
- For WS, throttle broadcast to ~5â€“10 Hz to avoid UI overload.

## Exit criteria
- One product run can be executed and watched live in the GUI.
- Events are persisted to disk and replayable.

### Source: PHASE-00-IMPROVMENT.md

> Original header: PHASE-00 IMPROVMENT


## Implemented Scope
1. Added run-level metadata plumbing from runtime to GUI:
`identity_fingerprint`, `identity_lock_status`, `dedupe_mode`, `phase_cursor`.
2. Added startup latency instrumentation:
`startup_ms.first_event`, `startup_ms.search_started`, `startup_ms.fetch_started`, `startup_ms.parse_started`, `startup_ms.index_started`.
3. Updated selected-run clear behavior so `Clear Selected View` clears only the selected run containers and keeps run selection.
4. Added `Replay Selected Run` so selected-run containers repopulate from persisted run artifacts/events without starting a new run.

## Delivered Behavior
1. Runtime emits `run_context` at run start and metadata fields again on `run_completed`.
2. `artifacts/indexlab/<run_id>/run.json` now persists metadata and startup timers.
3. `/indexlab/runs` now returns metadata and startup timers per run.
4. IndexLab Event Stream selected-run header now displays:
run id, product, status, lock status, dedupe mode, phase cursor, fingerprint (short), and startup timing summary.
5. Clearing selected run view now puts that run into a local cleared state and disables run-specific query loading until replay.
6. Replaying selected run re-enables and refetches run-specific data for:
Event Stream, NeedSet, SearchProfile, SERP, LLM traces, and domain checklist.

## Verification Completed
1. `node --check src/pipeline/runProduct.js`
2. `node --check src/indexlab/runtimeBridge.js`
3. `node --check src/api/guiServer.js`
4. `npm --prefix tools/gui-react run -s build`

## GUI Proof Steps
1. Run one product from `Run IndexLab`.
2. Open `IndexLab Event Stream` and select the run.
3. Verify header shows `lock`, `dedupe`, `cursor`, `fp`, and `startup(ms)` line.
4. Click `Clear Selected View` and confirm selected-run containers clear while run selection remains.
5. Click `Replay Selected Run` and confirm selected-run containers repopulate for that same run.

