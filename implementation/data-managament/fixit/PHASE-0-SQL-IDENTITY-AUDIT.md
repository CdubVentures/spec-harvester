# Phase 0: SQL + Identity Audit (Gate Before Any UI Fix)

## Gate status
- Result: CLEARED (source runtime); packaged-runtime parity still required
- Baseline snapshot source: `implementation/data-managament/fixit/phase-0-sql-snapshot-_test_mouse.json`
- Working DB: `.specfactory_tmp/_test_mouse/spec.sqlite`

The ID model is now slot-FK wired in `key_review_state` and lane writes are slot-ID anchored in source runtime paths. Remaining work is packaged-runtime rebuild/restart validation.

## Scope covered
- Item lane:
  - `item`
  - `item key`
  - `item field slot` (`item_field_state.id`)
- Component lane:
  - `component`
  - `component key`
  - `component property slot` (`component_values.id`)
- Enum lane:
  - `enum list`
  - `enum value slot` (`list_values.id`)
- Shared lane:
  - candidates, source registry/assertions, key review state

## Phase 0 artifacts
- `implementation/data-managament/fixit/phase-0-schema-map.md`
- `implementation/data-managament/fixit/phase-0-integrity-report.md`
- `implementation/data-managament/fixit/phase-0-query-path-findings.md`
- `implementation/data-managament/fixit/phase-0-remediation-checklist.md`

## Current high-risk findings
1. Packaged runtime may still reflect pre-patch behavior until rebuilt/restarted.
2. Resolver helper fallbacks still exist for non-mutation/read-style contexts (write routes are ID-required).

## Progress update
- Completed in code:
  - `src/db/seed.js`
    - source metadata mapping for merged candidates fixed
    - `buildFieldMeta` now supports both `rules.fields` and top-level `fields`
    - component field detection now derives from `enum.source=component_db.*`
    - known pipeline slot values now bind to best matching candidate IDs
    - key-review seed now writes slot IDs (`item_field_state_id`, `component_value_id`, `list_value_id`, `enum_list_id`)
    - candidate-review backfill lookup now resolves key-review rows by slot IDs first
  - `src/db/specDb.js`
    - `key_review_state` schema now includes slot FK columns:
      - `item_field_state_id`
      - `component_value_id`
      - `list_value_id`
      - `enum_list_id`
    - slot-unique indexes added for grid/component/enum rows
    - constructor migration now backfills slot IDs for existing DBs (`backfillKeyReviewSlotIds`)
    - enum rename/delete now clears/remaps dependent key-review and source-assertion rows to keep FK integrity
  - `src/api/guiServer.js`
    - synthetic component-review candidates now source-linked
    - test-mode `/run` SpecDb resync now uses compiled `loadFieldRules(...)` payload
    - lane context/state lookups now pass slot IDs where available (grid/component/enum)
    - mutation helper fallback reduced for required-ID write paths
  - `src/review/componentReviewData.js`
    - legacy component payload now hydrates `component_identity_id` from SpecDb identity row
    - enum payload key-review lookup now uses `list_value_id` when available
  - `src/review/keyReviewState.js`
    - shared-lane state apply now accepts and persists slot IDs
- Verified outcome (source runtime):
  - `item_component_links`: `0 -> 79`
  - `candidates_missing_source_host`: `7470 -> 0`
  - `source_registry`: `22 -> 102`
  - `key_review_state selected_value without candidate`: `1945 -> 824`
  - `key_review_state slot FK binding`:
    - `grid_key` with `item_field_state_id`: `1760`
    - `component_key` with `component_value_id`: `98`
    - `enum_key` with `list_value_id`: `124`
  - `key_review_state selected_candidate orphan rows`: `0`
  - Regression suite:
    - `npm.cmd test -- test/reviewLaneContractApi.test.js test/reviewLaneContractGui.test.js test/componentReviewDataLaneState.test.js test/testDataProviderSourceIdentity.test.js` -> pass (25/25)

## Exit criteria for Phase 0 completion
- All 4 button mutations resolve by slot ID and candidate ID only.
- `source_registry` is per real source (not collapsed to product-level `unknown`).
- Every actionable candidate has `source_assertions` bound to a slot FK.
- `key_review_state` has slot FK identity (item/component/list), not only composite strings.
- No write path depends on display name when slot/identity IDs are available.
- Packaged runtime behavior matches source runtime after rebuild/restart.
