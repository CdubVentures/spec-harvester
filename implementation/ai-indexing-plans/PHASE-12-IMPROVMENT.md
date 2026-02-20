# PHASE-12 IMPROVMENT

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

