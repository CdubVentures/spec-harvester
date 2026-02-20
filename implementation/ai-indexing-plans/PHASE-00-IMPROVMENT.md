# PHASE-00 IMPROVMENT

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
