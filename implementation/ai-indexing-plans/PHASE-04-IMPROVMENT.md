# PHASE-04 IMPROVMENT

## Implemented Status (2026-02-19)
This improvement slice is now wired in runtime + API + GUI.

1. Fetch outcome taxonomy is normalized and emitted in runtime events.
2. Domain checklist API computes host budget score/state and cooldown countdown seconds.
3. URL Health panel now shows host budget, budget state, and live cooldown clocks.
4. Repair remains signal-only in Phase 04; scheduling policy remains deferred to Phase 06B.

## Code Touchpoints
1. `src/pipeline/runProduct.js`
- Added `classifyFetchOutcome(...)`.
- `source_fetch_failed` now emits `status` + `outcome`.
- `source_processed` now emits normalized `outcome`.

2. `src/api/guiServer.js`
- Added outcome normalization fallback `classifyFetchOutcomeFromEvent(...)` for older events.
- Added per-domain `outcome_counts` aggregation.
- Added `host_budget_score`, `host_budget_state`, `cooldown_seconds_remaining` to checklist rows.

3. `tools/gui-react/src/pages/indexing/IndexingPage.tsx`
- Extended Phase 04 cards with average host budget and blocked/backoff host counts.
- Extended Domain Health table with `budget`, `budget state`, and `cooldown` columns.
- Cooldown column now renders live countdown based on `next_retry_at`.

4. `test/indexingDomainChecklistApi.test.js`
- Added shape checks for new Phase 04 row fields.
- Added coverage for outcome counters + cooldown countdown output.

## GUI Proof Checklist
1. Run IndexLab with discovery enabled.
2. Open `URL Health & Repair (Phase 04)`.
3. Confirm Domain Health rows show:
- `budget`
- `budget state`
- `cooldown`
4. Confirm summary cards show:
- `avg host budget`
- `hosts blocked/backoff`
5. Trigger/observe failed fetches and verify `blocked`, `404/410`, and cooldown counters move.

## Not In Scope (Deferred)
1. Full refetch automation scheduler policy (Phase 06B).
2. Cross-run canonical memory replay policy.
3. Aggressive host-level queue throttling policy loops.
