# SQL-First Executive Code Review (Scenario Root-Cause Audit)

Date: 2026-02-18
Scope: review grid, component drawer, enum drawer, key-review lanes, and SQL-vs-legacy write paths.
Category tested by user: `_test/mouse`.

## Fixed in this pass

1. Grid lane confirm cross-clear (both lanes clearing)
- Root cause:
  - Grid drawer still had legacy shared-confirm fallback behavior through generic pending AI state.
  - Shared lane state could be inferred from non-shared pending review items.
- Fixes:
  - `tools/gui-react/src/pages/review/ReviewPage.tsx:680`
    - Shared pending now requires actual shared-lane fields only.
  - `tools/gui-react/src/pages/review/ReviewPage.tsx:779`
    - Shared pending candidate IDs now derive only from shared lane status.
  - `tools/gui-react/src/pages/review/ReviewPage.tsx:873`
    - Removed legacy pending mutation from drawer pending lock set.
  - `tools/gui-react/src/components/common/CellDrawer.tsx:246`
    - Grid context now ignores legacy `pendingAIConfirmation` fallback for shared actions.

2. Candidate accepted-state mismatch after refresh
- Root cause:
  - Accepted candidate id could exist while candidate list did not include exact id, so UI lost accepted-state marker.
- Fix:
  - `tools/gui-react/src/components/common/CellDrawer.tsx:281`
    - Added accepted-id token + fallback accepted-by-selected-value index.
  - `tools/gui-react/src/components/common/CellDrawer.tsx:363`
    - `isActiveAccepted` now supports id-first, value fallback.

3. Enum candidate id instability
- Root cause:
  - Pipeline enum candidates could switch id families after acceptance (`pl_enum_*` to `wb_enum_*`), breaking stable accepted-candidate linking.
- Fix:
  - `src/review/componentReviewData.js:1346`
    - SpecDb enum payload now keeps pipeline candidate ids as `pl_enum_*`.
  - `src/review/componentReviewData.js:1522`
    - Legacy path now keeps pipeline-origin workbook values on `pl_enum_*` id pattern.

4. Silent SQL-write failures causing flicker/revert
- Root cause:
  - JSON write succeeded, SQL write failed silently (`best-effort`), UI reloaded from SQL and appeared to undo click.
- Fixes (fail-fast):
  - `src/api/guiServer.js:2622` `component_override_specdb_write_failed`
  - `src/api/guiServer.js:2632` `component_review_status_specdb_write_failed`
  - `src/api/guiServer.js:2751` `enum_override_specdb_write_failed`
  - `src/api/guiServer.js:2836` `enum_rename_specdb_write_failed`
  - `src/api/guiServer.js:2928` `component_review_alias_specdb_write_failed`

5. Encoded category/path parsing stability
- Fix:
  - `src/api/guiServer.js:880`
    - API path segments now decode with `decodeURIComponent`.

## Remaining legacy gaps (not removed yet)

High impact:
- `src/api/guiServer.js`
  - component/enum mutation endpoints still perform filesystem JSON writes before/alongside SQL writes.
  - This is still dual-source-of-truth architecture (improved by fail-fast, but not eliminated).

- `src/review/componentReviewData.js`
  - SpecDb-first with fallback to legacy builders:
    - `buildComponentReviewLayoutLegacy`
    - `buildComponentReviewPayloadsLegacy`
    - `buildEnumReviewPayloadsLegacy`

- `src/review/reviewGridData.js`
  - Continues writing/reading legacy review artifacts (`legacyCandidatesKey`, `legacyReviewQueueKey`, `legacyProductKey`).

- `src/review/overrideWorkflow.js`
  - Still has legacy review artifact fallback reads/writes.

Medium impact:
- `src/review/componentImpact.js`
  - Filesystem fallback scan paths remain active if SQL data is absent.

## Why behavior still felt inconsistent before this pass

1. UI was SQL-read primary but mutators were partially JSON-primary + SQL best-effort.
2. Lane logic mixed modern key-review lanes with legacy pending-review fallback behavior.
3. Candidate ids were not stable in all enum accepted flows, so accepted markers could disappear.

## SQL-first hardening plan (next cleanup steps)

1. Make SQL authoritative in mutators:
- Write SQL first; only mirror to JSON as optional export/snapshot.
- If SQL write fails, abort mutation immediately.

2. Remove legacy payload builder fallbacks:
- Drop `*Legacy` builders in `componentReviewData.js` once seed guarantees are enforced.

3. Remove legacy review artifact read/write in:
- `reviewGridData.js`
- `overrideWorkflow.js`

4. Keep one source of candidate truth:
- Ensure accepted candidate id always resolves to a candidate row (persist synthetic accepted candidates when needed).

5. Add regression tests for these exact scenarios:
- Grid: confirm primary must not clear shared.
- Grid: confirm shared must not clear primary.
- Component: accept candidate persists and remains accepted after refetch.
- Enum: accept/confirm persists and remains accepted after refetch.

## Validation run in this pass

- GUI typecheck: passed.
- `node --check src/api/guiServer.js`: passed.
- `npm test -- test/reviewGridData.test.js`: passed.
- `npm test -- test/reviewEcosystem.test.js`: existing pre-existing failure remained in DB-10 (`candidate_reviews` expectation), unrelated to the lane/UI fixes above.
