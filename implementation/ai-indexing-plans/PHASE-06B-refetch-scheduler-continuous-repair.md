# Phase 06B - Refetch Scheduler and Continuous Repair

## Canonical Status
- This is the single canonical file for this phase.
- Consolidated on 2026-02-20 from split planning plus improvement docs.
- Includes implemented status and remaining work from merged sources.
- Keep all unfinished items active until code plus GUI proof confirms completion.

## Merged Source Files
- PHASE-06B-refetch-scheduler.md
- PHASE-06B-IMPROVMENT.md

## Full Merged Spec

### Source: PHASE-06B-refetch-scheduler.md

> Original header: Deep Spec Harvester - Phased Implementation Plan (Accuracy-Max)


This phase file is written as an implementation prompt for senior software engineers.
It includes: exact deliverables, file touchpoints, schemas/events, test strategy, and GUI proof.

Guiding principles:
- Accuracy is the primary objective (95%+ on technical specs).
- Evidence tiers and confidence gates control what happens next.
- Discovery is need-driven (missing/low-confidence/conflict fields) and avoids endless key/alias loops.
- Indexing is deterministic (content_hash dedupe + stable snippet IDs), so results are replayable and auditable.
- The GUI must prove each phase works before moving to the next.

Repo context (from your src.zip):
- Pipeline orchestrator: `src/pipeline/runProduct.js`
- Discovery orchestrator: `src/discovery/searchDiscovery.js`
- Search providers: `src/search/searchProviders.js` (includes SearXNG support)
- Frontier / URL health: `src/research/frontierDb.js` + `src/research/frontierSqlite.js`
- LLM extraction + batching: `src/llm/extractCandidatesLLM.js`, `src/llm/fieldBatching.js`
- Validation: `src/llm/validateCandidatesLLM.js`, `src/validator/qualityGate.js`, `src/engine/runtimeGate.js`
- Consensus: `src/scoring/consensusEngine.js`
- GUI server: `src/api/guiServer.js` (WS support + review grid)

---

# Phase 06B - Refetch Scheduler + Continuous Repair

## Execution note (current)
- In the current improvement sequence, Phase 06B is executed before Phase 06 improvement expansion.
- Phase 06B establishes queueing/scheduler control now; Phase 06 then deepens EvidenceIndex inventory/search on top of those scheduler artifacts.

## Goal
Centralize automation policy into one explicit scheduler phase after indexing signals are available.
This phase executes automated repair/refresh/rediscovery loops using:
- `url_health` signals from Phase 04
- `content_hash` and indexing state from Phase 06
- NeedSet/evidence deficits from Phase 09

Phase 06B is the automation owner. Earlier phases only emit signals/intents.

## Why this phase exists here
After Phase 06, the system has:
- fetched URL outcomes (`ok`, `404`, `blocked`, etc.)
- indexed docs with `content_hash`
- enough evidence state to decide staleness and deficit-driven rediscovery

Without this dedicated phase, automation is fragmented and hard to test end-to-end.

## Deliverables
- Scheduler-backed `jobs` queue (or equivalent) + worker loop
- Unified policy engine for 3 automation loops:
  - 404/410 repair search
  - staleness refresh (TTL/content freshness)
  - NeedSet/evidence-deficit rediscovery
- Per-domain backoff policy for 403/429/captcha
- GUI automation panels:
  - queue depth/state by job type
  - repair/refresh feed
  - recent dedupe/skip reasons

## Implementation

### 06B.1 Queue + worker contract
Persist jobs with minimal required fields:
- `job_id`, `job_type`, `priority`, `status`
- `category`, `product_id`, `field_targets`
- `url` (optional), `query` (optional), `provider` (optional)
- `dedupe_key`, `scheduled_at`, `attempt_count`, `last_error`
- `source_signal` (`url_health`, `staleness`, `needset_deficit`, `manual`)

Worker loop behavior:
- dequeue by priority and due time
- enforce dedupe before execution
- update status transitions (`queued`, `running`, `done`, `failed`, `cooldown`)

### 06B.2 404/410 repair loop
Input signals:
- repeated 404/410 from Phase 04 URL health table.

Policy:
- cooldown dead URL patterns
- emit repair search jobs using domain-aware templates
- dedupe repeated repair jobs per `(domain, brand/model, field_targets)`

Output:
- new search jobs that feed Phase 03 triage path.

### 06B.3 Staleness refresh loop (TTL + hash-aware)
Input signals:
- indexed docs with age > TTL window
- optional domain/doc_kind-specific TTL policy.

Policy:
- enqueue refresh fetch jobs
- if `content_hash` unchanged after fetch, skip reparse/reindex
- if hash changed, run parse/index path

Output:
- measurable refresh without unnecessary parse churn.

### 06B.4 Evidence-deficit rediscovery loop
Input signals:
- NeedSet tier/min_refs/confidence deficits from Phase 09.

Policy:
- emit targeted discovery jobs by deficit reason:
  - tier deficit -> Tier 1 doc hints first
  - min refs fail -> diversify domains/doc kinds
  - confidence low -> precision-biased source templates
- strict per-round caps to prevent runaway queues

Output:
- controlled rediscovery tied to concrete field deficits.

### 06B.5 Per-domain backoff
Input signals:
- 403/429/blocked/captcha outcomes.

Policy:
- exponential host cooldown
- host concurrency reduction
- temporary provider/host suppression windows

Output:
- lower blocked churn and fewer wasted retries.

### 06B.6 GUI proof
Add `Automation Queue` view:
- queued/running/failed counts by `job_type`
- per-job `source_signal`, `dedupe_key`, next run time
- recent actions feed (`repair`, `refresh`, `rediscovery`)

Required proof scenarios:
1. Force a known 404 URL:
   - URL cooldown appears
   - repair search job enqueued once
2. Force stale TTL on indexed doc:
   - refresh job enqueued
   - unchanged hash path skips reparse
3. Force publish-gated field deficit:
   - targeted rediscovery jobs appear with matching `field_targets`

## Current readiness from implemented phases (2026-02-19)
Signals already available for 06B consumption:
- Phase 03:
  - triage intent and selection outputs are persisted and visible in GUI.
- Phase 04:
  - `repair_query_enqueued` events with domain/query/reason/doc_hint/field_targets.
  - `url_cooldown_applied` events including `path_dead_pattern` reason.
  - blocked-domain suppression events via `blocked_domain_cooldown_applied`.
  - domain checklist payloads include `repair_queries` and `bad_url_patterns`.
- Phase 06 precondition in progress:
  - content hash is recorded at fetch persistence points, ready to be used by scheduler refresh policy once Phase 06 indexing contracts are finalized.

## Exit criteria
- Refetch/repair/rediscovery automation is controlled by one scheduler phase.
- Each loop is visible and testable in GUI with deterministic job/state evidence.
- Duplicate work is bounded by dedupe keys + per-domain backoff.

### Source: PHASE-06B-IMPROVMENT.md

> Original header: PHASE-06B IMPROVMENT


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

