# Field Key Creation Propagation Trace

Generated on: 2026-02-21

Scope:
- Creation starts in `Studio > Key Navigator`.
- Trace covers frontend propagation, backend JSON artifacts, and SQL/SpecDb impact.
- Includes creation vs rename branch differences, because rename uses one additional path (`pending_renames.json`).

## 1) Creation Entry Point and Save Path

### A) Frontend create + save trigger
- Add key local edit action:
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:3766`
  - Adds key into local `editedRules` + `editedFieldOrder` with `_edited: true`: `tools/gui-react/src/pages/studio/StudioPage.tsx:3779`
- Save button that persists key drafts:
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:3940`
  - Calls `handleSaveAll`: `tools/gui-react/src/pages/studio/StudioPage.tsx:3762`
- Parent save wiring posts `fieldRulesDraft.fields` + `fieldRulesDraft.fieldOrder`:
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:702`
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:706`

### B) Backend draft save endpoint
- Route: `POST /studio/{category}/save-drafts`
  - `src/api/guiServer.js:6280`
- Merges draft payload into:
  - `helper_files/{category}/_control_plane/field_rules_draft.json`
  - code: `src/api/guiServer.js:6286`
  - merge write: `src/api/guiServer.js:6290`
- Rename-only side path (not required for create):
  - `helper_files/{category}/_control_plane/pending_renames.json`
  - code: `src/api/guiServer.js:6295`
- Broadcast after save:
  - `broadcastWs('data-change', { type: 'studio-drafts-saved', category })`
  - `src/api/guiServer.js:6303`

### C) Query invalidation after save
- Direct save mutation invalidation:
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:553`
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:559`
- Global data-change invalidation in app shell:
  - `tools/gui-react/src/components/layout/AppShell.tsx:68`
  - `tools/gui-react/src/components/layout/AppShell.tsx:79`
  - Includes `['fieldLabels', cat]` and `['reviewLayout', cat]`: `tools/gui-react/src/components/layout/AppShell.tsx:75`, `tools/gui-react/src/components/layout/AppShell.tsx:76`

## 2) Compile Promotion Path (Draft -> Global)

### A) Compile start
- Frontend compile action:
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:647`
- Backend route:
  - `POST /studio/{category}/compile`
  - `src/api/guiServer.js:6144`
  - starts `category-compile`: `src/api/guiServer.js:6147`

### B) Compile completion broadcast and invalidation
- On process exit code `0`, websocket data-change fires:
  - `src/api/guiServer.js:5006`
  - `src/api/guiServer.js:5009`
- Studio page also invalidates downstream queries when process completes:
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:510`
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:527`

### C) Compiler key inclusion branch (critical)
- Compiler loads draft and rename payloads:
  - `src/ingest/categoryCompile.js:4862`
  - `src/ingest/categoryCompile.js:4863`
- Extracted key list comes from workbook map/key sheet:
  - `src/ingest/categoryCompile.js:4945`
- Effective keys are intersection of extracted keys and `map.selected_keys`:
  - `src/ingest/categoryCompile.js:4946`
  - `src/ingest/categoryCompile.js:4948`
- Fields are built only from those `keyRows`:
  - `src/ingest/categoryCompile.js:5011`

Creation branch outcomes:
- If created key is in extracted key rows:
  - It is compiled into runtime/studio artifacts (`fieldsRuntime`/`fieldsStudio` path): `src/ingest/categoryCompile.js:5320`
- If not in extracted key rows:
  - It is not emitted to generated runtime artifacts (stays draft-only metadata/order).

### D) Generated artifacts written on successful compile
- Canonical runtime field rules:
  - `helper_files/{category}/_generated/field_rules.json`
  - `helper_files/{category}/_generated/field_rules.runtime.json`
  - write path starts: `src/ingest/categoryCompile.js:5746`
- Additional generated artifacts:
  - `ui_field_catalog.json`: `src/ingest/categoryCompile.js:5772`
  - `known_values.json`: `src/ingest/categoryCompile.js:5773`
  - `_compile_report.json`: `src/ingest/categoryCompile.js:5869`

### E) Control-plane artifacts always updated during compile
- Writes:
  - `helper_files/{category}/_control_plane/workbook_map.json`: `src/ingest/categoryCompile.js:5710`
  - `helper_files/{category}/_control_plane/draft.json`: `src/ingest/categoryCompile.js:5711`
  - `helper_files/{category}/_control_plane/field_rules_draft.json`: `src/ingest/categoryCompile.js:5712`
  - `helper_files/{category}/_control_plane/field_rules.full.json`: `src/ingest/categoryCompile.js:5713`
  - `helper_files/{category}/_control_plane/ui_field_catalog_draft.json`: `src/ingest/categoryCompile.js:5714`
  - versioned snapshot under `_control_plane/_versions/{versionId}`: `src/ingest/categoryCompile.js:4513`
- Rename-only cleanup:
  - remove `pending_renames.json` after successful compile: `src/ingest/categoryCompile.js:5871`

## 3) Frontend Surfaces Impacted by Field Key Creation

## A) Studio-local surfaces (draft-aware)
- Studio payload fetch:
  - query `['studio', category]`: `tools/gui-react/src/pages/studio/StudioPage.tsx:459`
  - backend payload route: `src/api/guiServer.js:6024`
- Studio drafts fetch:
  - query `['studio-drafts', category]`: `tools/gui-react/src/pages/studio/StudioPage.tsx:481`
  - backend route: `src/api/guiServer.js:6308`
- Key Navigator list/editor:
  - component: `tools/gui-react/src/pages/studio/StudioPage.tsx:3508`
  - add key UI: `tools/gui-react/src/pages/studio/StudioPage.tsx:3853`
- Field Contract Workbench:
  - rows built from `fieldOrder`: `tools/gui-react/src/pages/studio/workbench/FieldRulesWorkbench.tsx:72`
  - helper uses `fieldOrder.map`: `tools/gui-react/src/pages/studio/workbench/workbenchHelpers.ts:99`
- Mapping and context tabs consume field order/count:
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:621`
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:689`
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:744`
- Component source property key pickers use field keys from Key Navigator:
  - group/picker build from `fieldOrder`: `tools/gui-react/src/pages/studio/StudioPage.tsx:2506`
  - add-from-key selector: `tools/gui-react/src/pages/studio/StudioPage.tsx:3190`

Important draft behavior:
- `/studio/{category}/payload` returns compiled `fieldRules` but allows draft `fieldOrder` override:
  - `src/api/guiServer.js:6033`
  - `src/api/guiServer.js:6034`
- `/studio/{category}/drafts` returns full draft rule content:
  - `src/api/guiServer.js:6311`
  - `src/api/guiServer.js:6315`

This means draft creation is visible immediately in Studio edit flows, but global runtime surfaces still depend on compile outputs.

## B) Global field label surfaces (from `/field-labels/{category}`)
- Hook source:
  - `tools/gui-react/src/hooks/useFieldLabels.ts:5`
  - endpoint call: `tools/gui-react/src/hooks/useFieldLabels.ts:8`
- Backend field-label map builder:
  - route: `src/api/guiServer.js:6016`
  - map build from category field rules: `src/review/reviewGridData.js:324`

Consumers:
- Product page field table labels:
  - `tools/gui-react/src/pages/product/ProductPage.tsx:48`
  - `tools/gui-react/src/pages/product/ProductPage.tsx:72`
- Review drawer title label:
  - `tools/gui-react/src/pages/review/ReviewPage.tsx:59`
  - `tools/gui-react/src/pages/review/ReviewPage.tsx:780`
- Component review property headers and drawer labels:
  - `tools/gui-react/src/pages/component-review/ComponentSubTab.tsx:151`
  - `tools/gui-react/src/pages/component-review/ComponentSubTab.tsx:512`
  - `tools/gui-react/src/pages/component-review/ComponentReviewDrawer.tsx:647`
  - `tools/gui-react/src/pages/component-review/ComponentReviewDrawer.tsx:1003`
- Enum review field labels:
  - `tools/gui-react/src/pages/component-review/EnumSubTab.tsx:228`
  - `tools/gui-react/src/pages/component-review/EnumSubTab.tsx:558`
  - `tools/gui-react/src/pages/component-review/EnumSubTab.tsx:705`

## C) Global layout-driven surfaces (from `/review/{category}/layout`)
- Review layout endpoint:
  - route: `src/api/guiServer.js:6332`
  - builder: `src/review/reviewGridData.js:340`
- Review matrix rows display layout label/key:
  - `tools/gui-react/src/pages/review/ReviewPage.tsx:73`
  - `tools/gui-react/src/pages/review/ReviewMatrix.tsx:41`
  - `tools/gui-react/src/pages/review/ReviewMatrix.tsx:167`

## D) Product/review payload surfaces tied to new key existence
- Product endpoint returns draft field order:
  - `src/api/guiServer.js:5512`
  - `src/api/guiServer.js:5528`
- Product page sorting by `fieldOrder`:
  - `tools/gui-react/src/pages/product/ProductPage.tsx:60`
  - `tools/gui-react/src/pages/product/ProductPage.tsx:93`
- Review products payload iterates every layout row and generates field state:
  - `src/review/reviewGridData.js:752`
- In SpecDb mode, missing layout keys are upserted as `item_field_state` slots (`unk`):
  - `src/review/reviewGridData.js:716`
  - `src/review/reviewGridData.js:733`

## E) Component/enum tabs (data-dependent key visibility)
- Component review page queries:
  - layout: `tools/gui-react/src/pages/component-review/ComponentReviewPage.tsx:27`
  - component data: `tools/gui-react/src/pages/component-review/ComponentReviewPage.tsx:41`
  - enum data: `tools/gui-react/src/pages/component-review/ComponentReviewPage.tsx:48`
- Backend reorders by draft field order but does not invent missing keys:
  - component property order override: `src/review/componentReviewData.js:737`
  - enum field order override: `src/review/componentReviewData.js:2174`

So a created key appears in these tabs only when underlying `component_values` or `list_values` rows exist for that key, not from key creation alone.

## 4) Backend SQL / SpecDb Impact

### A) Direct SQL writes from create/save/compile
- No direct SQL write in:
  - `POST /studio/{category}/save-drafts` path (`src/api/guiServer.js:6280`)
  - `POST /studio/{category}/compile` route (`src/api/guiServer.js:6144`)

### B) How SQL is refreshed/affected
- Auto-seed runs when SpecDb is created/unseeded:
  - trigger: `src/api/guiServer.js:3473`
  - load rules + seed call: `src/api/guiServer.js:3480`
  - `src/api/guiServer.js:3483`
- CLI/manual seed path:
  - `seed-db` command: `src/cli/spec.js:2453`
  - calls `seedSpecDb`: `src/cli/spec.js:2468`

### C) SQL structures impacted when seeded or when review payload initializes slots
- Seeding metadata from field rules:
  - build field metadata: `src/db/seed.js:182`
- Seeding key-relevant tables:
  - enum/list lanes: `src/db/seed.js:357`
  - item/product field lanes: `src/db/seed.js:481`
  - key review state seeding phase: `src/db/seed.js:1280`
- Table schemas include key columns in:
  - `enum_lists` / `list_values`: `src/db/specDb.js:137`, `src/db/specDb.js:147`
  - `item_field_state`: `src/db/specDb.js:177`
  - `item_component_links` / `item_list_links`: `src/db/specDb.js:190`, `src/db/specDb.js:197`
  - `source_assertions`: `src/db/specDb.js:393`
  - `key_review_state`: `src/db/specDb.js:426`

## 5) Creation vs Rename: Shared and Different Paths

Shared path:
- Studio UI edit -> `save-drafts` -> websocket invalidation -> optional compile -> generated artifacts -> global refresh.

Different path:
- Create key:
  - usually sends `fieldRulesDraft` + `fieldOrder`; does not require `pending_renames.json`.
- Rename key:
  - also sends `renames`, writes `pending_renames.json`, and compile rewrites workbook-map references before emitting artifacts:
    - rewrite logic: `src/ingest/categoryCompile.js:4865`
    - cleanup on success: `src/ingest/categoryCompile.js:5871`

Creation-specific caveat:
- Compile only promotes keys that survive extracted key filtering (`pullKeyRowsFromMap` + `selected_keys` intersection):
  - `src/ingest/categoryCompile.js:1936`
  - `src/ingest/categoryCompile.js:4947`

## 6) Diagram Outputs

- Frontend propagation (creation + visibility stages):
  - Mermaid source:
    - `implementation/data-managament/diagrams/field-key-propagation/frontend-field-key-creation-propagation.mmd`
  - 4K PNG:
    - `implementation/data-managament/diagrams/field-key-propagation/frontend-field-key-creation-propagation.4k.png`
  - SVG:
    - `implementation/data-managament/diagrams/field-key-propagation/frontend-field-key-creation-propagation.svg`

- Backend JSON + SQL propagation (creation/rename branches):
  - Mermaid source:
    - `implementation/data-managament/diagrams/field-key-propagation/backend-field-key-creation-propagation.mmd`
  - 4K PNG:
    - `implementation/data-managament/diagrams/field-key-propagation/backend-field-key-creation-propagation.4k.png`
  - SVG:
    - `implementation/data-managament/diagrams/field-key-propagation/backend-field-key-creation-propagation.svg`
