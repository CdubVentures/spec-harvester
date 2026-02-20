# Phase 15.1 Review Hierarchy Audit (2026-02-18)

## Requirement Summary

1. Candidate is global (`candidate_id` is one evidence-backed value across surfaces).
2. Decisions happen in contexts, not drawers:
   - item key context (`grid_key`)
   - component key context (`component_key`)
   - list key context (stored as `enum_key`)
3. Two independent lanes:
   - Item lane: Accept Item + Confirm Item AI
   - Shared lane: Accept Shared + Confirm Shared AI
4. Drawer is projection-only UI over persisted state.
5. Propagation rules:
   - candidate metadata propagates globally
   - item actions stay item-scoped unless shared action is explicit
   - shared actions fan out via link tables

## Technical Approach Implemented

- Centralized candidate ID generation in shared helpers:
  - `src/utils/candidateIdentifier.js`
  - `tools/gui-react/src/utils/candidateIdentifier.ts`
- Replaced ad-hoc candidate ID templates in grid/component/enum flows.
- Enforced lane semantics at API level:
  - primary lane limited to `grid_key`
  - shared confirm endpoints for component and enum contexts.
- Kept drawers projection-only (no drawer-owned state authority).

## Acceptance Criteria

- Synthetic/manual/workbook candidate IDs are canonical and collision-safe.
- Grid, component, and enum surfaces generate matching synthetic IDs between UI and API.
- `confirm` only clears pending AI for lane/context.
- `accept` only selects candidate/value for lane/context.
- Primary lane is rejected for non-grid contexts.
- Shared confirm for component and enum writes to `key_review_state` in shared contexts.

## Dependencies

- SQLite schema and DAL (`src/db/specDb.js`)
- Review APIs (`src/api/guiServer.js`)
- Grid and component/enum payload builders (`src/review/reviewGridData.js`, `src/review/componentReviewData.js`)
- Override workflow (`src/review/overrideWorkflow.js`)
- Catalog workbook seeding (`src/catalog/productCatalog.js`)
- Frontend review surfaces (`tools/gui-react/src/pages/review`, `tools/gui-react/src/pages/component-review`)

## Edge Cases Covered

- Candidate IDs with long/noisy values (normalized tokens + stable hash).
- Duplicate slug collisions across contexts (hash suffix prevents clashes).
- Manual override IDs now deterministic from category/product/field/value/evidence.
- Fallback candidate IDs are deterministic even when upstream candidates are missing.
- Legacy candidate IDs remain readable (no destructive migration).

## Refactor Notes

- Removed repeated inline ID templates and consolidated to helper calls.
- Updated tests impacted by manual candidate ID format change.
- Left `enum_key` table naming unchanged for compatibility; mapped as list context in docs.

## Residual Gaps (Out of Scope)

- Physical schema rename `enum_key` -> `list_key`.
- Backfill migration to rewrite historical legacy IDs in previously generated artifacts.

## 2026-02-18 Bug-Fix Update (Confirm vs Accept)

### Issues Fixed

- Component drawer `Confirm` was coupled to `component-review-action` (approve/merge) and acted like accept.
- Enum drawer `Confirm` was coupled to approve/merge path and also mutated selected/accepted value state.
- `Accept` for component identity keys (`__name`, `__maker`) was not persisting shared-lane accepted candidate state in `key_review_state`.
- Grid shared `Confirm` propagation marked related review items as accepted aliases instead of confirmed-only.

### Implementation Changes

- Removed confirm-as-accept mutation calls from:
  - `tools/gui-react/src/pages/component-review/ComponentReviewDrawer.tsx`
  - `tools/gui-react/src/pages/component-review/EnumSubTab.tsx`
- Backend confirm paths now clear pending AI without implicit accept:
  - `src/api/guiServer.js`
  - shared grid propagation now writes `confirmed_ai` (not `accepted_alias`) for confirm lane.
  - component-key confirm now marks only matching component-context review items as `confirmed_ai`.
  - enum confirm now clears `needs_review` and marks matching review items as `confirmed_ai`.
- Component identity accepts now write shared-lane accept state and preserve identifier hierarchy:
  - `src/api/guiServer.js`
  - `__name`/`__maker` accepts now call `applySharedLaneState(... laneAction: 'accept')`.
  - key-review component identifiers are remapped on name/maker rename.
- Component payload hydration now reads identity lane state from SQL key-review rows:
  - `src/review/componentReviewData.js`
  - `name_tracked.accepted_candidate_id` / `maker_tracked.accepted_candidate_id` now come from `key_review_state`.

### Tests Added

- `test/keyReviewState.test.js`
  - confirm does not mutate selection or clear accept.
  - accept mutates selection without auto-confirm.
  - confirm on new row does not auto-accept.

## 2026-02-18 Cross-Tab Hardening Update

### Additional Gaps Closed

- Component shared confirm could fail with `confirm_value_required` when no preselected DB value existed.
- Accepting `__name` could make pending review rows disappear in the UI because review row identity stayed on the old component name.
- Candidate-to-review-item matching treated comma-delimited/array attribute values as one token, causing confirm actions to appear broken.

### Additional Implementation Changes

- Backend shared confirm fallback now accepts candidate-scoped value context when selected value is missing:
  - `src/api/guiServer.js`
  - `component-key-review-confirm` uses `candidateValue` as confirm scope fallback and writes confirm lane without implicit accept.
- Backend pending review row rebinding on component rename:
  - `src/api/guiServer.js`
  - new helper remaps pending `component_review` / `component_review_queue` items from old `matched_component` context to new name after `__name` accept.
- Robust value token matching across backend and UI:
  - `src/api/guiServer.js`
  - `src/review/componentReviewData.js`
  - `tools/gui-react/src/pages/component-review/ComponentReviewDrawer.tsx`
  - `tools/gui-react/src/pages/review/ReviewPage.tsx`
  - arrays and comma-delimited values are split into candidate tokens consistently for matching and synthetic candidate generation.
- Drawer pending AI binding survives optimistic rename:
  - `tools/gui-react/src/pages/component-review/ComponentSubTab.tsx`
  - drawer now falls back to prior selected entity name when resolving pending review items.

### Additional Test Coverage

- `test/componentReviewDataLaneState.test.js`
  - verifies comma-delimited pipeline property values are split into distinct candidates in component review payloads.
- `test/reviewLaneContractApi.test.js`
  - API-level matrix for all three contexts (`grid_key`, `component_key`, `enum_key`) and both lanes.
  - verifies:
    - `Confirm` does not auto-accept.
    - `Accept` does not auto-confirm.
    - shared-lane propagation updates matching grid contexts immediately.
    - component confirm is candidate-scoped (does not clear unrelated pending items).
    - enum confirm is value-scoped (does not clear unrelated pending items).
  - assertions use real HTTP routes used by UI buttons and immediate follow-up GET payload checks.

## 2026-02-18 Grid UX Separation + Drawer Background Update

### UX Decision

- Grid drawer now exposes only item-lane actions:
  - `Accept Item`
  - `Confirm Item`
- Shared-lane actions stay in component/enum review surfaces for clearer validation paths.

### Drawer Background Rules Implemented

- Green when candidate matches effective accepted/selected value for the lane.
- Green also applies to duplicate candidates with the same accepted value token.
- If no accepted-value match:
  - Grid: pending item tint (orange) first, else pending shared tint (purple), else neutral.
  - Component/Enum: pending shared tint (purple), else neutral.

### Validation Updates

- `test/reviewLaneContractGui.test.js`
  - asserts grid candidate rows do not render `Accept Shared` / `Confirm Shared`.
  - asserts duplicate accepted-value candidates render green highlight.
  - asserts enum `Accept` leaves shared AI status `pending` (no implicit confirm).
