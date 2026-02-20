# PHASE-06B IMPROVMENT

## Execution Slot
- Run this before `PHASE-06-IMPROVMENT.md`.
- Reason: scheduler/automation control plane should be in place before deeper EvidenceIndex inventory/search expansion.

## What I'd Add
1. Choose one queue architecture now: stateful `jobs` plus append-only `job_actions`.
2. Define `dedupe_key` contract (`identity_fingerprint + job_type + scope`).
3. Add explicit TTL policy table for staleness refresh by domain/doc kind.
4. Add scheduler audit feed for all transitions and retries.

## What We Should Implement Now
1. Implement queue state machine (`queued`, `running`, `done`, `failed`, `cooldown`).
2. Wire three loops: repair search, staleness refresh, deficit rediscovery.
3. Add Automation Queue panel with per-job reason and next-run timestamp.

## Implemented Slice (2026-02-19)
1. Added run-scoped automation queue API: `/api/v1/indexlab/run/:runId/automation-queue`.
2. Implemented queue-state reconstruction with statuses:
   - `queued`, `running`, `done`, `failed`, `cooldown`
3. Wired loops from current runtime signals:
   - repair search (`repair_query_enqueued` + search lifecycle)
   - staleness refresh (`content_hash` repeat detection)
   - NeedSet deficit rediscovery (`needset` + search profile field targeting)
4. Added `Automation Queue (Phase 06B)` GUI panel:
   - status/type counters
   - queue jobs table
   - transition feed
5. Added API test coverage: `test/indexlabAutomationQueueApi.test.js`.

## Definition Of Done
1. Repair/refresh/rediscovery are automated and bounded by dedupe.
2. Duplicate automation work is prevented across runs.
3. GUI proves every job transition and reason.
