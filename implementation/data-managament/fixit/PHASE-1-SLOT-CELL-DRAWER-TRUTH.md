# Phase 1: Slot Cell + Drawer Truth Alignment

## Objective
Make every cell and drawer deterministic from the same slot-bound candidate set.

## Issues addressed
- Pending badge with no actionable drawer candidates.
- Drawer candidates with no matching pending badge.
- Current value shown without a candidate-backed source row.
- `unk` shown while meaningful slot candidates exist.
- Pipeline pending enum/component rows shown with no linked products.
- Read-only GET routes mutating candidate/source state.

## Implemented rules
1. Pending AI indicators only use actionable candidates:
   - candidate id exists
   - value is meaningful
   - candidate is not `is_synthetic_selected`
2. Synthetic selected candidates are display-only and cannot drive accept/confirm actions.
3. Component and enum pending target ids are derived only from actionable candidate sets.
4. GET routes for review candidates/components/enums/component-review are read-only.
5. Component rows require linkage, actionable pending, or stable non-pipeline authored data.
6. Pipeline enum rows with `needs_review=true` require linkage to stay visible.

## Artifacts
- `implementation/data-managament/fixit/phase-1-slot-projection-contract.md`
- `implementation/data-managament/fixit/phase-1-unk-and-badge-rules.md`

## Validation
- `npm.cmd test -- test/componentReviewDataLaneState.test.js`
- `npm.cmd test -- test/reviewLaneContractApi.test.js`
- `npm.cmd test -- test/reviewLaneContractGui.test.js`
- `npm.cmd test -- test/reviewGridData.test.js`
- `npm.cmd --prefix "tools/gui-react" run build`

## Exit criteria
- No badge/drawer contradiction on item/component/enum slots.
- No synthetic-only candidate row exposes accept/confirm.
- No read-path candidate/source mutations from GET endpoints.
- Pending rows/values without real linkage are suppressed for pipeline pending states.
