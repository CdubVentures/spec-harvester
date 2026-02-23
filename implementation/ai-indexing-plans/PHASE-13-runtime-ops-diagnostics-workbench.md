# Phase 13 - Runtime Ops Diagnostics Workbench

## Canonical Status
- This is the canonical implementation plan for the post-Sprint-7 diagnostics workbench.
- This phase starts only after the currently open non-deferred items are complete.
- This phase is operator UX first: real-time visibility, clear state, safe controls.

## Goal
Build an intuitive diagnostics workbench that lets an operator watch indexing live, per worker and per document, with:
- tabbed runtime views
- left-side metrics rail in every tab
- live website and document preview panes
- extracted data preview panes
- extraction method lineage (how each field value was produced)
- safe runtime controls and replayable audit trails

## Why This Phase Exists
Current observability is strong but distributed across phase panels and event streams. Operators need one focused control plane for diagnostics:
- one place to see what workers are doing right now
- one place to see what documents are being fetched, parsed, and extracted
- one place to compare raw extraction vs validated consensus
- one place to act safely when a run degrades

## Start Gate (must be true before implementation)
1. Phase 07 FTS wiring complete (`tierAwareRetriever` no longer defaulting to brute-force fallback for primary retrieval path).
2. Phase 06B worker loop and TTL policy complete (automation queue is active, not just foundational).
3. Phase 10 two-product learning proof complete (learning behavior verified across products).
4. Phase 11 worker controls complete (worker counts and pool controls are real runtime knobs).
5. Phase 12 batch APIs and batch state machine complete (status stream and control endpoints available).

## Existing Signals and Tools This Phase Reuses
1. Runtime event stream and bridge (`runtimeBridge`, NDJSON, WS).
2. Fetch scheduler and fallback telemetry (`hostPacer`, `fallbackPolicy`, `fetchScheduler`).
3. Evidence index and dedupe outcomes (`evidenceIndexDb`, dedupe events).
4. Round summary and convergence stop telemetry.
5. Worker pool foundation (`WorkerPool`) and queue artifacts.
6. Existing Indexing GUI page and panel composition model.
7. Source strategy, frontier health, and URL repair signals.

## UX Principles (non-negotiable)
1. Every screen answers: "what is happening now, why, and what can I do?"
2. No hidden state transitions. Every transition is visible in feed or inspector.
3. No context switching to debug one URL. URL-level fetch, parse, extract, validate lifecycle is in one place.
4. Controls are safe by default and audit-logged.
5. Visual hierarchy is stable across tabs (same left, center, right structure).

## Information Architecture

### Global Layout
1. Header bar (always visible):
- run status
- active round
- active workers
- queued work
- docs/min
- fields accepted/min
- error rate

2. Left metrics rail (always visible):
- pool metrics (search/fetch/parse/llm)
- quality metrics (confidence, acceptance rate, identity lock state)
- failure metrics (fallback rate, retries, blocked hosts, no-progress streak)

3. Center pane (tab-specific primary preview):
- website preview, document preview, queue timeline, or worker map depending on tab

4. Right inspector pane (tab-specific details):
- selected worker/document/field details
- extracted data preview
- method lineage
- provenance references

### Tabs
1. `Overview`
2. `Workers`
3. `Documents`
4. `Extraction`
5. `Fallbacks`
6. `Queue`
7. `Batch` (visible when batch mode active)
8. `Controls`

## Tab Specifications

### 1) Overview Tab
Purpose: fast triage in under 10 seconds.

Center pane:
- live run timeline (round markers, stop-condition risk markers, throughput trend)
- host health heatmap (error-heavy domains highlighted)

Right pane:
- top current blockers list (identity stuck, tier deficits, repeated low quality, fetch exhaustion)
- "next likely failure" hints from deterministic heuristics

### 2) Workers Tab
Purpose: per-worker runtime clarity.

Center pane:
- worker table by pool with one row per worker:
  - worker_id
  - pool
  - state (idle/running/backoff/blocked)
  - current task id
  - current URL or query
  - elapsed_ms
  - retries
  - fetch mode
  - last_error

Right pane:
- selected worker detail:
  - current and previous task
  - recent event stream
  - host backoff state
  - throughput window
  - action buttons (safe drain worker, retry last task, clear local queue slot)

### 3) Documents Tab
Purpose: watch what documents are collected and what happened to each.

Center pane:
- live document feed (newest first):
  - doc_id
  - URL
  - host
  - status
  - fetch_mode
  - status_code
  - content_type
  - bytes
  - content_hash
  - dedupe_outcome
  - parse_method
  - worker_id

Right pane:
- selected document inspector:
  - lifecycle timeline: discovered -> fetched -> parsed -> indexed -> extracted -> validated
  - parse outputs summary (article/text/table/json/pdf/ocr flags)
  - extraction readiness score
  - evidence chunks indexed
  - prime-source eligibility and reasons

Preview requirement:
- website preview pane (rendered snapshot or screenshot)
- raw text preview pane
- parsed structure preview pane (tables/json blocks)

### 4) Extraction Tab
Purpose: field-level extraction understanding and trust.

Center pane:
- field extraction matrix for selected product/round:
  - field key
  - extracted value
  - status (candidate/accepted/conflict/unknown)
  - confidence
  - method
  - source tier
  - refs count
  - worker or batch id

Right pane:
- selected field detail:
  - raw candidates list
  - consensus-scored candidates list
  - final validated output
  - reason codes for accept/reject/unknown
  - suggested next queries if unresolved

Preview requirement:
- side-by-side view:
  - left: raw extracted candidates
  - right: final validated field state

Extraction method list (must be visible and filterable):
- html_spec_table
- embedded_json
- main_article
- pdf_text
- scanned_pdf_ocr
- image_ocr
- chart_payload
- llm_extract
- llm_validate
- deterministic_normalizer
- consensus_policy_reducer

### 5) Fallbacks Tab
Purpose: diagnose degraded fetch behavior quickly.

Center pane:
- fallback event ladder:
  - URL
  - host
  - from_mode
  - to_mode
  - reason_class
  - attempt_index
  - result
  - elapsed_ms

Right pane:
- host-level fallback profile:
  - fallback success rate
  - exhaustion count
  - no_result trend
  - blocked/rate-limited trend
  - recommended host policy adjustments

### 6) Queue Tab
Purpose: inspect workload and starvation.

Center pane:
- unified queue view by lane:
  - queued
  - running
  - done
  - failed
  - cooldown
  - priority
  - wait time

Right pane:
- selected job detail:
  - origin signal
  - dedupe key
  - attempts
  - next_run_at
  - linked URLs/fields
  - transition history

### 7) Batch Tab
Purpose: long-run fleet operation.

Center pane:
- batch run status board:
  - queued/running/completed/failed/skipped/stopped
  - throughput
  - ETA
  - active product and phase cursor

Right pane:
- selected batch item detail:
  - product id
  - current step
  - current blockers
  - last failure reason
  - last successful artifact links

### 8) Controls Tab
Purpose: safe runtime actions with auditability.

Allowed actions:
1. pause/resume run
2. safe drain pool
3. retry selected URL/job
4. apply host cooldown
5. temporarily block host
6. force fetch mode for selected host/url (bounded duration)
7. set next-run worker counts (not mid-flight unsafe mutation unless explicitly supported)

Every action must write:
- actor
- timestamp
- target
- action
- pre-state
- post-state
- result

## Backend Contracts

### REST Endpoints (new)
1. `GET /api/v1/indexlab/run/:runId/runtime/summary`
2. `GET /api/v1/indexlab/run/:runId/runtime/workers`
3. `GET /api/v1/indexlab/run/:runId/runtime/documents`
4. `GET /api/v1/indexlab/run/:runId/runtime/documents/:docId`
5. `GET /api/v1/indexlab/run/:runId/runtime/extraction/fields`
6. `GET /api/v1/indexlab/run/:runId/runtime/fallbacks`
7. `GET /api/v1/indexlab/run/:runId/runtime/queue`
8. `GET /api/v1/indexlab/run/:runId/runtime/batch`
9. `POST /api/v1/indexlab/run/:runId/runtime/actions`

### WebSocket Events (new normalized layer)
1. `runtime_worker_heartbeat`
2. `runtime_task_started`
3. `runtime_task_completed`
4. `runtime_document_discovered`
5. `runtime_document_fetched`
6. `runtime_document_parsed`
7. `runtime_document_indexed`
8. `runtime_field_extracted`
9. `runtime_field_validated`
10. `runtime_fallback_decision`
11. `runtime_queue_transition`
12. `runtime_control_action_result`

### Event Envelope (required)
```json
{
  "event": "runtime_document_parsed",
  "ts": "2026-02-23T12:34:56.000Z",
  "run_id": "run_abc",
  "round": 2,
  "pool": "parse",
  "worker_id": "parse-03",
  "task_id": "task_xyz",
  "payload": {}
}
```

## Data Models (read-model layer)
1. Worker snapshot model:
- key: `run_id + pool + worker_id`
- fields: state, current_task, started_at, elapsed_ms, host, mode, retries, last_error

2. Document lifecycle model:
- key: `run_id + doc_id`
- fields: URL, host, hash, dedupe_outcome, parse outputs, extraction outputs, worker lineage, timestamps

3. Field extraction lineage model:
- key: `run_id + field_key + round`
- fields: candidates, methods, scores, validator result, provenance refs

4. Queue state model:
- key: `run_id + queue_job_id`
- fields: status, attempts, priority, next_run_at, linked targets, transition log

## 3-Phase Implementation Plan (Recommended)

### Size and Sequencing
1. `Phase 13.1` (MVP Read-Only): Large, ~2-3 weeks.
2. `Phase 13.2` (Deep Diagnostics + Lineage): Large, ~2-3 weeks.
3. `Phase 13.3` (Control Plane + Batch + Hardening): Large, ~2-3 weeks.

Total expected effort: `6-9 weeks` for one senior engineer, shorter with parallel frontend/backend ownership.

### Phase 13.1 - Read-Only Live Ops MVP
Objective:
- deliver the intuitive runtime workspace quickly without control-plane risk
- make live worker and document diagnostics usable day 1

Scope:
1. normalized WS and REST contracts for runtime read models
2. `Runtime Ops` page shell with persistent three-pane layout
3. left metrics rail in every tab
4. tabs: `Overview`, `Workers`, `Documents`
5. website/doc preview panes and basic extracted-data preview
6. run-level and worker-level filtering/search
7. read-only mode only (no mutation actions)

Backend checklist:
1. implement normalized event mapper for runtime events
2. add read models: summary, workers, documents
3. add endpoints:
   - `GET /api/v1/indexlab/run/:runId/runtime/summary`
   - `GET /api/v1/indexlab/run/:runId/runtime/workers`
   - `GET /api/v1/indexlab/run/:runId/runtime/documents`
   - `GET /api/v1/indexlab/run/:runId/runtime/documents/:docId`
4. ensure deterministic hydration (REST snapshot + WS tail)

Frontend checklist:
1. add `Runtime Ops` route/tab entry from Indexing page
2. build fixed shell:
   - left metrics rail
   - center primary pane
   - right inspector pane
3. implement `Overview` tab (health cards + timeline + top blockers)
4. implement `Workers` tab (per-worker table + inspector)
5. implement `Documents` tab (live feed + lifecycle + preview panes)
6. cross-link selected worker to related documents

Acceptance criteria:
1. operator identifies stuck worker in < 15 seconds
2. operator traces one document lifecycle in < 30 seconds
3. no hard dependency on raw event shape in UI components
4. no visual instability under normal event burst

Exit artifacts:
1. screenshots and short run recording for all 3 tabs
2. endpoint contract examples checked into docs/tests
3. read-only feature flag enabled in staging

### Phase 13.2 - Deep Diagnostics and Extraction Lineage
Objective:
- answer "what was extracted, by which method, and why this final value"

Scope:
1. tabs: `Extraction`, `Fallbacks`, `Queue`
2. raw-vs-validated field preview pane
3. extraction method lineage list and filtering
4. fallback ladder and host degradation profile
5. queue transition and retry history inspector
6. deep-linking between worker, document, and field lineage

Backend checklist:
1. add read models: extraction lineage, fallbacks, queue transitions
2. add endpoints:
   - `GET /api/v1/indexlab/run/:runId/runtime/extraction/fields`
   - `GET /api/v1/indexlab/run/:runId/runtime/fallbacks`
   - `GET /api/v1/indexlab/run/:runId/runtime/queue`
3. include reason codes and provenance refs in field lineage payload
4. add method taxonomy normalization for extraction methods

Frontend checklist:
1. implement `Extraction` tab:
   - field matrix
   - raw candidates pane
   - validated output pane
   - method filters
2. implement `Fallbacks` tab:
   - mode transition ladder
   - host-level fallback summary
3. implement `Queue` tab:
   - lane/state board
   - job transition history inspector
4. add shared deep-link behavior:
   - click field -> source document
   - click document -> worker activity
   - click fallback event -> affected host/doc list

Acceptance criteria:
1. operator answers "why this field value?" from one screen
2. unresolved fields expose explicit reason + next hint
3. fallback hot hosts are visible without log inspection
4. queue starvation/cooldown loops are diagnosable from UI

Exit artifacts:
1. lineage walkthrough for 3 real field examples
2. fallback incident replay captured in QA notes
3. queue transition verification report

### Phase 13.3 - Control Plane, Batch Integration, and Hardening
Objective:
- add safe runtime actions and complete long-run operational workflow

Scope:
1. `Controls` tab with guarded runtime actions
2. full action audit trail and result feedback
3. `Batch` tab integration with deep links into diagnostics tabs
4. performance hardening: virtualization, WS backpressure, replay snapshots
5. permissions and safety confirmations for risky actions

Backend checklist:
1. add action endpoint:
   - `POST /api/v1/indexlab/run/:runId/runtime/actions`
2. implement action audit model and retrieval API
3. add batch runtime endpoint:
   - `GET /api/v1/indexlab/run/:runId/runtime/batch`
4. support replay snapshot persistence for postmortem
5. enforce role/permission checks and bounded actions

Frontend checklist:
1. implement `Controls` tab with:
   - pause/resume
   - safe drain
   - retry selected URL/job
   - host cooldown/block
   - temporary mode override
2. implement `Batch` tab:
   - live counters, throughput, ETA
   - selected item diagnostics
   - deep links into Workers/Documents/Extraction
3. add action confirmation flows and result toasts
4. add virtualization and heavy-feed rendering protections
5. add replay mode toggle for completed runs

Acceptance criteria:
1. every action writes pre-state/post-state audit record
2. operator can move from failed batch item to root cause in one click
3. UI remains responsive under production-scale event rates
4. replay mode reproduces the same diagnostics state progression

Exit artifacts:
1. control-plane runbook for operators
2. audit schema and example records
3. load test notes for high-throughput event sessions

## Detailed Task Breakdown by Track

### Backend track
1. event normalization layer
2. read-model reducers and stores
3. runtime REST contracts
4. WS subscription/backfill sync
5. action API and audit persistence
6. replay snapshot API

### Frontend track
1. shell layout and tab router state
2. reusable metrics rail components
3. table/inspector primitives for workers/docs/fields/queue
4. website/data preview pane components
5. controls UX with confirmation patterns
6. performance tuning and virtualization

### QA/Validation track
1. deterministic fixture runs for each tab
2. event-burst stress scenarios
3. degraded fetch/fallback scenarios
4. incorrect extraction lineage scenarios
5. control action safety and audit verification

## Detailed UX Behavior Rules
1. Empty states are explicit and instructional.
2. Every metric card includes tooltip definition and source.
3. Color encodings are consistent across tabs.
4. All timestamps can toggle absolute/relative.
5. Search and filter are available in every data-heavy tab.
6. Keyboard navigation works for table rows and tab switches.

## Accessibility and Clarity Requirements
1. WCAG-appropriate contrast for status indicators.
2. Do not rely on color alone for error states.
3. Font sizes remain readable in dense tables.
4. Tooltips and labels use concrete language, not internal jargon.

## Telemetry and Audit Requirements
1. Each diagnostics view logs panel load and filter usage (for UX tuning).
2. Control actions log full pre and post state.
3. Event-to-UI lag metric is tracked and surfaced.
4. Missing event fields are counted and exposed in diagnostics health card.

## Test Strategy

### Unit
1. event normalization mappers
2. read-model reducers
3. aggregation selectors
4. control action validators

### Integration
1. WS stream to read-model updates
2. REST + WS hydration consistency
3. tab data isolation and cross-linking

### End-to-End
1. worker stuck scenario diagnosis
2. fallback storm diagnosis
3. incorrect extraction root-cause trace
4. queue backlog and cooldown diagnosis
5. control action audit trail verification

## Rollout Strategy
1. Ship behind feature flag: `RUNTIME_OPS_WORKBENCH_ENABLED`.
2. Start with read-only mode.
3. Enable controls in staged increments.
4. Compare operator diagnosis time before and after rollout.

## Success Metrics
1. Median time to identify run blocker.
2. Median time to trace incorrect field value to source/method.
3. Reduction in manual log digging.
4. Fallback incident resolution time.
5. Queue/backoff incident resolution time.

## Out of Scope for Initial Cut
1. in-tab code editing of parser rules
2. auto-remediation actions without explicit operator trigger
3. replacing existing phase panels entirely

## Definition of Done
1. Operator can diagnose worker/document/extraction issues from one workspace.
2. Website and data preview panes are live and usable per tab.
3. Extraction method lineage is visible for every accepted/conflicted field.
4. Controls are safe, auditable, and bounded.
5. Performance remains stable under production-scale event volume.
