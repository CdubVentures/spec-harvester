# Mapping Studio Change Propagation Trace

Generated on: 2026-02-21

Scope:
- Change starts in `Studio > Mapping`.
- Covers frontend save/refresh behavior, backend JSON writes, compile-time derivation, and downstream flag/table recalculation.
- Explicitly calls out component-table and enum-list behavior (frontend + SpecDb SQL).

## 1) Mapping Change Entry and Save Path

### A) Frontend entry and payload assembly
- Mapping tab keeps editable local state, then assembles a `WorkbookMap` payload:
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:943`
- Payload includes mapping-critical sections:
  - `component_sources`: `tools/gui-react/src/pages/studio/StudioPage.tsx:973`
  - `data_lists`: `tools/gui-react/src/pages/studio/StudioPage.tsx:979`
  - `manual_enum_values`: `tools/gui-react/src/pages/studio/StudioPage.tsx:998`
- Save button triggers:
  - `onSaveMap(assembleMap())`: `tools/gui-react/src/pages/studio/StudioPage.tsx:1007`

### B) Frontend API write
- Mapping save mutation:
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:542`
- Calls:
  - `PUT /studio/{category}/workbook-map`: `tools/gui-react/src/pages/studio/StudioPage.tsx:543`

### C) Backend persistence
- Route:
  - `src/api/guiServer.js:6229`
- Save implementation:
  - `saveWorkbookMap(...)`: `src/ingest/categoryCompile.js:4593`
  - normalize map: `src/ingest/categoryCompile.js:4604`
  - write `_control_plane/workbook_map.json`: `src/ingest/categoryCompile.js:4605`
  - write version snapshot (`_control_plane/_versions/...`): `src/ingest/categoryCompile.js:4610`

## 2) Immediate Post-Save Frontend Propagation

### A) What currently refreshes right away
- Save success invalidates only:
  - `studio-workbook-map`: `tools/gui-react/src/pages/studio/StudioPage.tsx:545`
  - `studio-introspect`: `tools/gui-react/src/pages/studio/StudioPage.tsx:546`
- This updates Mapping tab map/introspection views.

### B) What does not refresh on map save
- No `data-change` broadcast in workbook-map PUT route (`src/api/guiServer.js:6229`), unlike draft saves (`src/api/guiServer.js:6303`).
- No direct invalidation for:
  - `workbook-context` (`tools/gui-react/src/pages/studio/StudioPage.tsx:493`)
  - downstream review/component/enum queries.

## 3) Compile Promotion Path (Map -> Generated Artifacts)

### A) Trigger and process lifecycle
- Frontend compile mutation:
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:532`
- Backend route:
  - `POST /studio/{category}/compile`: `src/api/guiServer.js:6144`
- Process completion event:
  - `broadcastWs('data-change', { type: 'process-completed', ... })`: `src/api/guiServer.js:5009`

### B) Compiler map usage and derivation
- Entry point:
  - `compileCategoryWorkbook(...)`: `src/ingest/categoryCompile.js:4767`
- Validates and normalizes map:
  - `validateWorkbookMap(...)`: `src/ingest/categoryCompile.js:1760`
  - compile validation calls: `src/ingest/categoryCompile.js:4803`, `src/ingest/categoryCompile.js:4820`
- Pulls mapping-driven structures:
  - key rows: `src/ingest/categoryCompile.js:1936`, `src/ingest/categoryCompile.js:4945`
  - product sampling: `src/ingest/categoryCompile.js:2020`, `src/ingest/categoryCompile.js:2073`
  - enum lists: `src/ingest/categoryCompile.js:2199`, `src/ingest/categoryCompile.js:4974`
  - component db entities: `src/ingest/categoryCompile.js:2302`, `src/ingest/categoryCompile.js:4984`

### C) Compile outputs written
- Control plane writes:
  - `workbook_map.json`, `draft.json`, `field_rules_draft.json`, `field_rules.full.json`, `ui_field_catalog_draft.json`:
    - write block starts at `src/ingest/categoryCompile.js:5709`
- Generated runtime artifacts:
  - `field_rules.json` + `field_rules.runtime.json`: `src/ingest/categoryCompile.js:5746`
  - `ui_field_catalog.json`: `src/ingest/categoryCompile.js:5772`
  - `known_values.json`: `src/ingest/categoryCompile.js:5773`
  - `component_db/*.json`: write path starts at `src/ingest/categoryCompile.js:5795`
  - compile report: `src/ingest/categoryCompile.js:5869`
- Component property constraints are re-applied from key-level rules:
  - `applyKeyLevelConstraintsToEntities(...)`: `src/ingest/categoryCompile.js:5805`

## 4) Frontend Propagation After Compile Completes

### A) App-wide websocket fanout invalidation
- AppShell invalidates global review/product/studio queries on `data-change`:
  - `tools/gui-react/src/components/layout/AppShell.tsx:68`
  - `tools/gui-react/src/components/layout/AppShell.tsx:77`

### B) Studio compile-finish invalidation
- Studio also invalidates on process finished:
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:513`
  - includes `studio`, `studio-known-values`, `studio-component-db`, review/product queries:
    - `tools/gui-react/src/pages/studio/StudioPage.tsx:515`
    - `tools/gui-react/src/pages/studio/StudioPage.tsx:527`

### C) Downstream frontend displays that should update
- Field labels endpoint (compiled field rules):
  - route `src/api/guiServer.js:6016`
  - hook `tools/gui-react/src/hooks/useFieldLabels.ts:8`
- Review Grid layout + rows:
  - `/review/{category}/layout` route path: `src/api/guiServer.js:6332`
  - `/review/{category}/products-index` route path: `src/api/guiServer.js:6409`
  - frontend queries: `tools/gui-react/src/pages/review/ReviewPage.tsx:73`, `tools/gui-react/src/pages/review/ReviewPage.tsx:79`
- Component Review page:
  - layout query: `tools/gui-react/src/pages/component-review/ComponentReviewPage.tsx:27`
  - component data query: `tools/gui-react/src/pages/component-review/ComponentReviewPage.tsx:41`
  - enum data query: `tools/gui-react/src/pages/component-review/ComponentReviewPage.tsx:48`

## 5) Recalculation Contracts for Flags, Component Tables, and Enum Lists

### A) Review grid flag recalculation
- Contract metadata for each field is rebuilt from compiled rules:
  - `normalizeFieldContract(...)`: `src/review/reviewGridData.js:177`
  - layout builder: `src/review/reviewGridData.js:340`
- Per-product flags are recomputed in payload build:
  - `buildProductReviewPayload(...)`: `src/review/reviewGridData.js:682`
  - `inferFlags(...)`: `src/review/reviewGridData.js:206`
  - flag merge into row reason codes: `src/review/reviewGridData.js:893`

### B) Component table recalculation
- Component payload builder:
  - `buildComponentReviewPayloads(...)`: `src/review/componentReviewData.js:730`
  - SpecDb path: `buildComponentReviewPayloadsSpecDb(...)`: `src/review/componentReviewData.js:750`
- Component property review state derives from:
  - `component_values.needs_review`, key review lane status, candidate evidence.
- Variance recalculation:
  - `evaluateVarianceBatch(...)`: `src/review/componentReviewData.js:1212`
  - adds `variance_violation` and flips `needs_review`: `src/review/componentReviewData.js:1214`

### C) Enum list recalculation
- Enum payload builder:
  - `buildEnumReviewPayloads(...)`: `src/review/componentReviewData.js:2167`
  - SpecDb path: `buildEnumReviewPayloadsSpecDb(...)`: `src/review/componentReviewData.js:2187`
- Enum row review state derives from:
  - `list_values.needs_review` + shared-lane status: `src/review/componentReviewData.js:2207`
  - inclusion/filter contract: `shouldIncludeEnumValueEntry(...)`: `src/review/componentReviewData.js:549`

## 6) Backend SQL/JSON Impact Reality

### A) JSON is updated directly by Mapping save + compile
- Direct map save affects `_control_plane/workbook_map.json` + version snapshots.
- Compile regenerates `_generated/field_rules*.json`, `known_values.json`, `ui_field_catalog.json`, `component_db/*.json`, `_compile_report.json`.

### B) SQL does not update from mapping compile automatically
- Compile route only launches category compile process:
  - `src/api/guiServer.js:6144`
- SpecDb auto-seed only triggers when DB is missing/unseeded:
  - `src/api/guiServer.js:3438`
  - `src/api/guiServer.js:3474`
  - seeded check: `src/db/specDb.js:4015`
- Component/enum review endpoints are SpecDb-backed and require seeded DB:
  - `src/api/guiServer.js:6722`
  - `src/api/guiServer.js:6736`

### C) SQL tables that must reflect mapping-driven compile changes
- Component domain:
  - `component_identity`, `component_aliases`, `component_values`
- Enum domain:
  - `enum_lists`, `list_values`
- Grid/flag domain:
  - `item_field_state`, `item_component_links`, `item_list_links`, `key_review_state`
- Seeding path that populates these:
  - `seedSpecDb(...)`: `src/db/seed.js:1636`
  - CLI command for manual resync: `seed-db`: `src/cli/spec.js:2455`

## 7) Operational "Should Recalc/Run" Sequence After Mapping Changes

1. Save mapping (`PUT /studio/{category}/workbook-map`):
   - should refresh map + introspection/context previews.
2. Validate map before compile (`POST /studio/{category}/validate-map`):
   - endpoint exists at `src/api/guiServer.js:6241`.
3. Run compile (`POST /studio/{category}/compile`):
   - regenerate field rules, known values, component DB, compile report.
4. Resync SpecDb from new generated artifacts:
   - run `node src/cli/spec.js seed-db --category <category> --local`.
5. Hard refresh UI:
   - review flags, component tables, enum lists should now align with the new mapping contract.

## 8) Diagram Files

- Frontend propagation tree:
  - `implementation/data-managament/diagrams/mapping-studio-propagation/frontend-mapping-studio-propagation.mmd`
- Backend JSON/SQL propagation tree:
  - `implementation/data-managament/diagrams/mapping-studio-propagation/backend-mapping-studio-propagation.mmd`

