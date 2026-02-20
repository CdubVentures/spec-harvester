# Phase 4: Realistic Test Mode + Regression Lock

## Objective
Make Test Mode generate realistic candidate distributions and enforce full end-to-end regression checks for item/component/enum with all four button paths.

## Why this phase is required
If test data generation does not reflect real candidate identity and lane diversity, UI/logic bugs can be hidden or misdiagnosed as “test-only.” This phase makes failures trustworthy.

## Test mode principles
1. Every generated candidate has stable unique candidate id.
2. Source identity is per-source record, never reused by host identity shortcuts.
3. Shared vs duplicate behavior is explicit and independent:
   - shared controls overlap of sources across slots/items.
   - duplicate controls repeated value overlap within candidate pools.
4. Defaults should be realistic and explainable (with tooltips).
5. Category selection and knobs must always be interactive and reliable.

## Coverage matrix to enforce
- Domain coverage:
  - item field slots
  - component property slots
  - enum value slots
- Button coverage per slot type:
  - Accept Item
  - Confirm Item
  - Accept Shared
  - Confirm Shared
- Edge coverage:
  - no candidates
  - all pending
  - mixed accepted/pending/rejected
  - high-confidence disagreement
  - unknown fallback
  - scalar/list stress

## Validation outputs required after each run
1. Mutation audit log by `slot_id` + `candidate_id`.
2. Badge-state diff report (pre/post click).
3. Cell/drawer consistency report.
4. SQL integrity assertions (no orphan/invalid lane state after actions).

## Implementation tasks
1. Harden scenario generator knobs and defaults.
2. Add deterministic seed + reproducible run id.
3. Add post-run validator that fails on any off-target mutation.
4. Add UI automation script for sequence testing across all slot types.
5. Add summary dashboard in Test Mode for failed invariants.

## Output artifacts
- `data/fixit/phase-4-test-mode-spec.md`
- `data/fixit/phase-4-regression-checklist.md`
- machine-readable run report for CI/local replay.

## Exit criteria
- Repeated runs produce deterministic pass/fail on same seed.
- All four buttons behave independently per slot/candidate in all three domains.
- No badge/drawer/state contradictions across item, component, enum views.
- Regression suite blocks merges on identity, shape, or lane-state violations.
