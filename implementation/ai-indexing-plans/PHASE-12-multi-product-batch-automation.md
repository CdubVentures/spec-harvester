# Phase 12 - Multi-Product Batch Automation

## Canonical Status
- This is the single canonical file for this phase.
- Consolidated on 2026-02-20 from split planning plus improvement docs.
- Includes implemented status and remaining work from merged sources.
- Keep all unfinished items active until code plus GUI proof confirms completion.

## Merged Source Files
- PHASE-12-multi-product-batch-automation.md
- PHASE-12-IMPROVMENT.md

## Full Merged Spec

### Source: PHASE-12-multi-product-batch-automation.md

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
- Scheduler/automation: `src/api/guiServer.js`, `src/runner/runUntilComplete.js`, `src/queue/queueState.js`
- GUI page: `tools/gui-react/src/pages/indexing/IndexingPage.tsx`
- Catalog sources: `src/catalog/productCatalog.js`, `fixtures/s3/specs/inputs/*/products/*.json`

---

# Phase 12 - Multi-Product Batch Runs (Long Tasks + Scans)

## Goal
Enable an easy GUI workflow to run many products at once:
- checkbox-select products by brand/model in a large scrollable grid
- select all, select by brand, and bulk include/exclude controls
- reorder brand execution priority
- preview exactly what will run before start
- execute long-running scans safely with pause/resume/stop and progress proof

This phase is the operator UX + control plane for real multi-product runs.

## Deliverables
- Batch selector UI for product matrix selection.
- Batch run plan builder (what will run, in what order, and why).
- Batch execution queue with state tracking and resumable progress.
- Run summary panel for long tasks and scans.
- API + persistence for saving/reloading batch plans.

## Implementation

### 12.1 Batch Selection Grid (GUI)
Add a new container/tab in IndexLab for `Batch Run Builder`:
- Vertical scroll for products, horizontal scroll for many columns.
- Columns:
  - select checkbox
  - brand
  - model
  - variant
  - product_id
  - optional status columns (last run status, last run at, quality summary)
- Toolbar controls:
  - `Select All`
  - `Clear All`
  - `Select Brand`
  - `Invert Selection`
  - search/filter text
  - brand filter chips
- Row and header-level checkboxes must be keyboard-accessible and fast for large lists.

### 12.2 Brand-Order Controls
Add brand run-order controls:
- Selected brands shown as movable chips/cards.
- Drag-and-drop or up/down controls to define execution order.
- Optional pinned priority brands at top.
- Derived product order is:
  1. brand priority order
  2. model/variant deterministic sort within brand

### 12.3 Batch Plan Preview
Before start, show a high-level summary:
- total selected products
- selected brands and counts per brand
- estimated job count
- estimated runtime band (fast/standard/thorough)
- profile + LLM settings snapshot that will be applied
- expected worker/concurrency settings

Add validation guards:
- prevent empty batch start
- confirm if batch is very large (e.g., >200 items)
- warn if API keys/providers required by current profile are missing

### 12.4 Batch Queue + State Machine
Introduce batch queue artifacts:
- `batch_run_id`
- `batch_plan` (selected products + ordering + settings snapshot)
- `batch_items` with states:
  - `queued`
  - `running`
  - `completed`
  - `failed`
  - `skipped`
  - `stopped`
- per-item attempt counters and last error.

Required controls:
- `Start Batch`
- `Pause Batch`
- `Resume Batch`
- `Stop Batch` (graceful)
- `Force Stop` (hard stop)

### 12.5 APIs
Add endpoints for batch lifecycle:
- `POST /api/v1/indexlab/batch/plan` (create/save plan)
- `POST /api/v1/indexlab/batch/start`
- `POST /api/v1/indexlab/batch/pause`
- `POST /api/v1/indexlab/batch/resume`
- `POST /api/v1/indexlab/batch/stop`
- `GET /api/v1/indexlab/batch/:batchRunId/status`
- `GET /api/v1/indexlab/batch/:batchRunId/items`

All endpoints should return stable IDs + timestamps for replayability.

### 12.6 Long-Task Summary + Live Monitoring
Add `Batch Run Summary` panel:
- live counts by state (queued/running/completed/failed/skipped/stopped)
- throughput (`products/hour`)
- ETA estimate
- current product and current phase cursor
- top recent failures with short reason
- action feed for batch transitions

### 12.7 Persistence and Resume
Persist batch plan + item states so restart/reload can continue:
- open GUI after restart -> recover latest active or paused batch
- resume from last durable item boundary
- never re-run already completed items unless explicitly requested

### 12.8 Safety and Backpressure
Batch execution must respect existing runtime constraints:
- per-product `maxRunSeconds`
- provider/rate-limit backoff
- domain cooldown and scheduler rules
- configurable parallel product workers (default conservative)

Do not allow batch fan-out to bypass Phase 04/05/06B protections.

## GUI Proof
1. Select 40 products across multiple brands from the grid.
2. Reorder brand priority and confirm preview order changes.
3. Start batch and verify:
   - first running products match preview order
   - status counters move in real time
4. Pause and resume:
   - queue halts and resumes without losing state
5. Stop and force stop:
   - process halts
   - item states remain recoverable
6. Reload GUI:
   - latest batch state restores with correct counters and current index.

## Exit Criteria
- Multi-product selection is fast and easy in GUI.
- Batch order is explicit and operator-controlled.
- Long tasks/scans are resumable, observable, and safe.
- Batch runs produce deterministic, auditable per-item outcomes.


### Source: PHASE-12-IMPROVMENT.md

> Original header: PHASE-12 IMPROVMENT


## What I'd Add
1. Add a high-performance product selection grid with checkbox bulk actions by brand/model/variant.
2. Add explicit brand-order orchestration controls (drag/drop or move up/down) to define batch execution priority.
3. Add a preflight summary and validation gate so long scans are clear before launch.
4. Add resumable batch state with durable checkpoints and clean recovery after app restart.

## What We Should Implement Now
1. Add `Batch Run Builder` GUI:
   - vertical + horizontal scrolling table
   - `Select All`, `Clear`, `Select Brand`, search/filter
2. Add brand priority controls and show resolved run order preview.
3. Add batch lifecycle controls:
   - `Start`, `Pause`, `Resume`, `Stop`, `Force Stop`
4. Add live long-task summary:
   - queued/running/completed/failed counters
   - ETA/throughput
   - current product + recent failures

## Definition Of Done
1. Operators can build large multi-product runs quickly without manual per-product starts.
2. Batch execution order is explicit, visible, and controllable.
3. Long scans are safe to pause/resume/stop and recover after restart.
4. GUI clearly proves batch state transitions and progress in real time.


