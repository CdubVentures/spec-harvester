# Field Key Contract Propagation Trace

Generated on: 2026-02-21

Scope:
- Change starts in `Studio > Key Navigator` or `Studio > Field Contract`.
- Focus is contract metadata edits (type/shape/unit, evidence, enum policy/source, parse template, priority, constraints/variance effects).
- Includes immediate UI invalidation paths, compile promotion paths, review-grid flag recalculation, component/enum table behavior, and SQL/JSON impact.

## 1) Contract Edit Entry + Save Path

### A) Frontend edit/write entry points
- Key Navigator and Field Contract tabs are active in Studio:
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:694`
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:720`
- Key Navigator contract update path writes nested rule fields (contract/priority/evidence/enum/parse couplings):
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:3645`
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:3763`
- Field Contract Workbench uses same coupling update model and saves `fieldRulesDraft.fields`:
  - `tools/gui-react/src/pages/studio/workbench/FieldRulesWorkbench.tsx:97`
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:732`

### B) Backend save-draft endpoint
- `POST /studio/{category}/save-drafts` route:
  - `src/api/guiServer.js:6280`
- Saves/merges:
  - `_control_plane/field_rules_draft.json` (`body.fieldRulesDraft`)
    - `src/api/guiServer.js:6287`
  - `_control_plane/pending_renames.json` (rename-only side path)
    - `src/api/guiServer.js:6295`
- Broadcast:
  - `broadcastWs('data-change', { type: 'studio-drafts-saved', category })`
  - `src/api/guiServer.js:6303`

## 2) Immediate Frontend Propagation After Save-Drafts

### A) Query invalidation fanout
- Studio-local invalidate on save success:
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:550`
- Global websocket invalidate fanout:
  - `tools/gui-react/src/components/layout/AppShell.tsx:64`
  - `tools/gui-react/src/components/layout/AppShell.tsx:68`
  - `tools/gui-react/src/components/layout/AppShell.tsx:76`
  - `tools/gui-react/src/components/layout/AppShell.tsx:78`

### B) Important immediate-behavior caveat
- `/studio/{category}/payload` serves compiled `fieldRules` and only draft `fieldOrder` override:
  - `src/api/guiServer.js:6024`
  - `src/api/guiServer.js:6034`
- Studio page derives `rules` from compiled payload:
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:563`
- Key Navigator editable state initializes from `rules` (not from drafts endpoint payload):
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:3536`
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:3560`
- `/studio/{category}/drafts` exists and returns full draft fields, but Studio UI does not hydrate rule state from it today:
  - `src/api/guiServer.js:6308`
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:481`

Net: save-drafts invalidates widely, but most global contract consumers still reflect compiled artifacts until compile.

## 3) Compile Promotion Path (Draft Contract -> Global JSON)

### A) Compile trigger and completion signal
- Frontend compile action:
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:532`
- Backend route:
  - `src/api/guiServer.js:6144`
- Success websocket signal:
  - `src/api/guiServer.js:5009`

### B) Compiler merge and key selection gate
- Draft + rename payload read:
  - `src/ingest/categoryCompile.js:4863`
- Key extraction + selected-key intersection:
  - `src/ingest/categoryCompile.js:4945`
  - `src/ingest/categoryCompile.js:4946`
- Contract override merge into generated rule:
  - `src/ingest/categoryCompile.js:5117`
  - `src/ingest/categoryCompile.js:5320`

If a key is filtered out by `selected_keys`, its draft contract edits are not promoted to runtime artifacts.

### C) Generated artifacts written on compile
- Runtime contracts:
  - `_generated/field_rules.json`
  - `_generated/field_rules.runtime.json`
  - write block begins at `src/ingest/categoryCompile.js:5712`
- UI/enum side artifacts:
  - `_generated/ui_field_catalog.json` (`src/ingest/categoryCompile.js:5772`)
  - `_generated/known_values.json` (`src/ingest/categoryCompile.js:5773`)
- Component DB contracts (constraints propagated into entities):
  - `applyKeyLevelConstraintsToEntities(...)`
  - `src/ingest/categoryCompile.js:5805`

## 4) Review Grid Recalculation Path (Flags + Contract Display)

### A) Contract metadata used by grid layout
- Review layout route:
  - `src/api/guiServer.js:6332`
- Layout builder normalizes contract per field into `field_rule`:
  - `src/review/reviewGridData.js:340`
  - `src/review/reviewGridData.js:177`
  - `src/review/reviewGridData.js:363`

### B) Flag recalculation
- Product payload builder (used by products-index and product review payload routes):
  - `src/review/reviewGridData.js:682`
- Flags inferencer uses:
  - `reason_codes` + contract evidence policy (`min_evidence_refs`, `conflict_policy`)
  - `src/review/reviewGridData.js:206`
  - `src/review/reviewGridData.js:893`
- SpecDb mode uses `item_field_state.needs_ai_review` as primary review signal:
  - `src/review/reviewGridData.js:787`
  - `src/review/reviewGridData.js:789`

### C) Frontend grid surfaces updated
- Review page queries:
  - `tools/gui-react/src/pages/review/ReviewPage.tsx:73`
  - `tools/gui-react/src/pages/review/ReviewPage.tsx:79`
- Matrix header and per-cell flags:
  - `tools/gui-react/src/pages/review/ReviewMatrix.tsx:124`
  - `tools/gui-react/src/pages/review/ReviewMatrix.tsx:254`
- Drawer/flag sections:
  - `tools/gui-react/src/pages/review/ReviewPage.tsx:779`
  - `tools/gui-react/src/pages/review/ReviewPage.tsx:969`

## 5) Component Tables + Enum Lists (Variance/Constraint/Enum Policy)

### A) Endpoints and ordering behavior
- Component tab payload endpoint:
  - `src/api/guiServer.js:6722`
- Enum tab payload endpoint:
  - `src/api/guiServer.js:6736`
- Both apply draft `fieldOrder` only as ordering override:
  - `src/api/guiServer.js:6730`
  - `src/api/guiServer.js:6742`
  - `src/review/componentReviewData.js:737`
  - `src/review/componentReviewData.js:2174`

### B) Component flags/variance behavior
- Component payload builder reads `component_values` rows (SpecDb):
  - `src/review/componentReviewData.js:750`
- Property state uses DB `variance_policy`/`constraints`:
  - `src/review/componentReviewData.js:1099`
  - `src/review/componentReviewData.js:1127`
- Variance batch adds `variance_violation` flags:
  - `src/review/componentReviewData.js:1205`
  - `src/review/componentReviewData.js:1218`
- UI display points:
  - Sub-tab variance labels and flags:
    - `tools/gui-react/src/pages/component-review/ComponentSubTab.tsx:495`
    - `tools/gui-react/src/pages/component-review/ComponentSubTab.tsx:584`
  - Drawer variance badge and flags:
    - `tools/gui-react/src/pages/component-review/ComponentReviewDrawer.tsx:64`
    - `tools/gui-react/src/pages/component-review/ComponentReviewDrawer.tsx:956`

### C) Enum list flags/policy behavior
- Enum payload builder reads `list_values` rows (SpecDb):
  - `src/review/componentReviewData.js:2187`
- Uses `row.needs_review` and `row.enum_policy`:
  - `src/review/componentReviewData.js:2207`
  - `src/review/componentReviewData.js:2264`
- Enum UI display points:
  - `tools/gui-react/src/pages/component-review/EnumSubTab.tsx:562`
  - `tools/gui-react/src/pages/component-review/EnumSubTab.tsx:792`

## 6) SQL Propagation Reality (Critical for "Immediate" Expectations)

### A) Compile is JSON-first, not SQL-first
- Compile route starts process only:
  - `src/api/guiServer.js:6144`
- No direct SpecDb reseed in compile path.

### B) SpecDb auto-seed behavior
- Auto-seed triggers only when DB is missing/unseeded:
  - `src/api/guiServer.js:3438`
  - `src/api/guiServer.js:3450`
  - `src/api/guiServer.js:3474`

### C) Tables carrying contract-sensitive review behavior
- `component_values` (`variance_policy`, `constraints`) schema:
  - `src/db/specDb.js:96`
- `list_values` (`enum_policy`, `needs_review`) schema:
  - `src/db/specDb.js:147`
- Grid review slots:
  - `item_field_state` (`needs_ai_review`)
  - `src/db/specDb.js:164`
- Shared lane records:
  - `key_review_state`
  - `src/db/specDb.js:426`

### D) Where SQL gets refreshed from compiled contracts
- Seeding components applies rule-level variance/constraints into `component_values`:
  - `src/db/seed.js:282`
  - `src/db/seed.js:341`
  - `src/db/seed.js:343`
- Seeding list values refreshes enum/list rows:
  - `src/db/seed.js:357`
  - `src/db/seed.js:362`

Net: for component/enum review tabs to fully reflect contract edits, SpecDb must be reseeded/resynced after compile.

## 7) Variance/Constraint Recalc Path That Drives Grid Flags

- Component mutations invoke cascade propagation:
  - `src/api/reviewComponentMutationRoutes.js:395`
  - `src/api/reviewComponentMutationRoutes.js:400`
- Cascade evaluates variance + constraints and updates `item_field_state.needs_ai_review`:
  - `src/review/componentImpact.js:245`
  - `src/review/componentImpact.js:263`
  - `src/db/specDb.js:2841`
  - `src/db/specDb.js:2914`
- Grid payload then reflects new flag state:
  - `src/review/reviewGridData.js:787`

## 8) Immediate vs Delayed Propagation Matrix

- Immediate (on save-drafts): query invalidations + Studio tab refresh signals.
- Immediate but ordering-only: review/component/enum ordering via draft `fieldOrder` overrides.
- Compile-required: field labels, review layout contract metadata, review-grid contract-driven flag logic.
- Compile + SpecDb reseed required: component-table variance/constraint behavior and enum-table policy/value behavior.

## 9) Diagram Outputs

- Frontend propagation tree:
  - `implementation/data-managament/diagrams/field-key-contract-propagation/frontend-field-key-contract-propagation.mmd`
  - `implementation/data-managament/diagrams/field-key-contract-propagation/frontend-field-key-contract-propagation.svg`
  - `implementation/data-managament/diagrams/field-key-contract-propagation/frontend-field-key-contract-propagation.4k.png`

- Backend JSON/SQL propagation tree:
  - `implementation/data-managament/diagrams/field-key-contract-propagation/backend-field-key-contract-propagation.mmd`
  - `implementation/data-managament/diagrams/field-key-contract-propagation/backend-field-key-contract-propagation.svg`
  - `implementation/data-managament/diagrams/field-key-contract-propagation/backend-field-key-contract-propagation.4k.png`
