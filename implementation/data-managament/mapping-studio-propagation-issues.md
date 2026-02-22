# Mapping Studio Propagation Issues

Generated on: 2026-02-21

## Issue SF-MAP-001
- Severity: Critical
- Title: Compile does not trigger SpecDb contract resync
- Symptom:
  - Mapping compile updates generated JSON, but Component Review and Enum Review can still show stale SQL-backed rows.
- Root cause:
  - Compile endpoint only starts `category-compile`; no automatic `seed-db`/SpecDb refresh.
- Evidence:
  - `src/api/guiServer.js:6144`
  - `src/api/guiServer.js:3438`
  - `src/api/guiServer.js:3474`
  - `src/db/specDb.js:4015`
  - `src/api/guiServer.js:6722`
  - `src/api/guiServer.js:6736`
- Impact:
  - Component variance flags, enum pending flags, and related table rows can lag behind current mapping contract.

## Issue SF-MAP-002
- Severity: High
- Title: Map save does not broadcast global data-change
- Symptom:
  - `Save Mapping` updates map file but does not notify non-Studio consumers.
- Root cause:
  - Workbook-map PUT route has no websocket broadcast; only save-drafts broadcasts.
- Evidence:
  - `src/api/guiServer.js:6229`
  - `src/api/guiServer.js:6303`
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:545`
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:546`
- Impact:
  - Other pages/tabs can continue using stale context until compile or manual refresh cycles.

## Issue SF-MAP-003
- Severity: High
- Title: Frontend does not call map validation endpoint before save/compile
- Symptom:
  - Invalid map states can be saved and only fail later during compile.
- Root cause:
  - `POST /studio/{category}/validate-map` exists but is not wired into Mapping Studio save path.
- Evidence:
  - Validation route: `src/api/guiServer.js:6241`
  - Save path: `tools/gui-react/src/pages/studio/StudioPage.tsx:542`
- Impact:
  - Delayed error discovery and avoidable compile failures.

## Issue SF-MAP-004
- Severity: High
- Title: Compile completion invalidation misses workbook map/context query keys
- Symptom:
  - Compiler-normalized map changes are not guaranteed to refresh `studio-workbook-map` or `workbook-context` immediately.
- Root cause:
  - Compile-finish invalidation list excludes those query keys.
- Evidence:
  - Studio compile-finish invalidation: `tools/gui-react/src/pages/studio/StudioPage.tsx:513`
  - Included keys: `tools/gui-react/src/pages/studio/StudioPage.tsx:515`
  - Map key location: `tools/gui-react/src/pages/studio/StudioPage.tsx:464`
  - Context key location: `tools/gui-react/src/pages/studio/StudioPage.tsx:493`
- Impact:
  - Mapping UI can temporarily display pre-compile map/context data despite successful compile.

## Issue SF-MAP-005
- Severity: High
- Title: Reseed path is insert/upsert oriented and does not remove stale mapping-derived SQL rows
- Symptom:
  - Removing enum values/component rows from mapping/compile outputs can leave stale `list_values`/`component_values`/related review rows in SpecDb.
- Root cause:
  - Seeding uses upsert operations and does not perform a category purge in normal flow.
- Evidence:
  - Seed entry: `src/db/seed.js:1636`
  - Component/list upsert seed steps: `src/db/seed.js:282`, `src/db/seed.js:357`
  - Upsert SQL behavior: `src/db/specDb.js:1082`, `src/db/specDb.js:1113`
- Impact:
  - Component/enum tables and shared-lane review state can accumulate stale values that no longer exist in compiled artifacts.

## Issue SF-MAP-006
- Severity: Medium
- Title: Mapping save currently has narrow immediate UX scope
- Symptom:
  - Users expect map changes to propagate broadly after save, but most downstream semantics remain compile-gated (and some are SQL-gated after that).
- Root cause:
  - Save updates map JSON only; downstream consumers rely on compiled artifacts and seeded SQL.
- Evidence:
  - Save path: `src/ingest/categoryCompile.js:4593`
  - Generated artifact load path: `src/categories/loader.js:513`
  - Review layout rebuild path: `src/review/reviewGridData.js:340`
  - Component/enum payload SQL path: `src/review/componentReviewData.js:750`, `src/review/componentReviewData.js:2187`
- Impact:
  - "Save then hard refresh" does not guarantee coherent updates in flags/component/enum sections.

## Immediate Recommendation

1. Wire `validate-map` into Mapping save flow and block save/compile on hard errors.
2. On successful compile, run category SpecDb resync automatically.
3. Add stale-row reconciliation for component/list SQL domains (delete rows absent from latest compiled artifacts).
4. Include `studio-workbook-map` and `workbook-context` in compile completion invalidation fanout.

