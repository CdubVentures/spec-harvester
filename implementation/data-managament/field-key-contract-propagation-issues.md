# Field Key Contract Propagation Issues

Generated on: 2026-02-21

## Issue SF-CONTRACT-001
- Severity: Critical
- Title: Contract draft edits are not rehydrated in Studio after hard refresh
- Symptom: After save-drafts + refresh, Studio key/contract rules can appear reverted until compile.
- Root cause: Studio payload returns compiled `fieldRules` and only draft `fieldOrder`.
- Evidence:
  - `src/api/guiServer.js:6024`
  - `src/api/guiServer.js:6034`
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:563`
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:481`
- Impact:
  - Creates false impression that draft contract changes were lost.
  - Increases accidental rework and risky duplicate edits.

## Issue SF-CONTRACT-002
- Severity: Critical
- Title: Compile does not auto-resync seeded SpecDb contract rows
- Symptom: Review Components / Enum tabs can stay stale after compile for contract edits.
- Root cause: Compile route launches process only; auto-seed runs only when DB is missing/unseeded.
- Evidence:
  - `src/api/guiServer.js:6144`
  - `src/api/guiServer.js:3438`
  - `src/api/guiServer.js:3450`
  - `src/api/guiServer.js:3474`
  - `src/api/guiServer.js:6722`
  - `src/api/guiServer.js:6736`
- Impact:
  - Contract changes (variance/constraints/enum policy) may not reflect where operators review them.
  - Frontend appears inconsistent across tabs.

## Issue SF-CONTRACT-003
- Severity: High
- Title: Save-drafts local invalidation keys do not match active component/enum query keys
- Symptom: Local invalidation in Studio does not directly target component/enum review queries.
- Root cause: Invalidates `componentReview` / `enumReview`, while consumers use `componentReviewData` / `enumReviewData`.
- Evidence:
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:559`
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:560`
  - `tools/gui-react/src/pages/component-review/ComponentReviewPage.tsx:40`
  - `tools/gui-react/src/pages/component-review/ComponentReviewPage.tsx:47`
- Impact:
  - Depends on websocket invalidation to recover.
  - Higher stale risk if websocket delivery drops.

## Issue SF-CONTRACT-004
- Severity: High
- Title: Contract promotion can silently drop keys via selected_keys filtering
- Symptom: Compile succeeds but edited key contract does not propagate globally.
- Root cause: Compiler intersects extracted keys with `map.selected_keys`.
- Evidence:
  - `src/ingest/categoryCompile.js:4945`
  - `src/ingest/categoryCompile.js:4946`
  - `src/ingest/categoryCompile.js:4958`
- Impact:
  - Hidden partial rollout of contract changes.
  - Hard to diagnose from UI alone.

## Issue SF-CONTRACT-005
- Severity: Medium
- Title: Grid and component flag semantics are sourced from different stores
- Symptom: Grid flags and component/enum flags can disagree after contract edits.
- Root cause:
  - Grid recompute path depends on layout contract + `item_field_state`.
  - Component/enum paths depend on `component_values` / `list_values`.
- Evidence:
  - `src/review/reviewGridData.js:340`
  - `src/review/reviewGridData.js:682`
  - `src/review/reviewGridData.js:787`
  - `src/review/componentReviewData.js:750`
  - `src/review/componentReviewData.js:2187`
- Impact:
  - Cross-tab inconsistency in variance/needs-review interpretation.
  - Operator trust issues in review workflow.

## Issue SF-CONTRACT-006
- Severity: Medium
- Title: Save-drafts gives immediate invalidation but most contract semantics remain compile-gated
- Symptom: User expects instant full propagation after save; only ordering and cache refresh happen immediately.
- Root cause: Global consumers read generated artifacts from compile path, not raw draft contract fields.
- Evidence:
  - `src/api/guiServer.js:6280`
  - `src/api/guiServer.js:6303`
  - `src/categories/loader.js:379`
  - `src/categories/loader.js:518`
- Impact:
  - Confusing user experience around "save" vs "compiled truth".
  - Repeated manual checks and unnecessary refresh cycles.

## Immediate Recommendation
- Treat compile completion as a synchronization boundary:
  - On successful compile, trigger category SpecDb resync from fresh generated artifacts.
  - Return draft field rules in Studio payload (or merge draft over compiled for Studio-only views).
