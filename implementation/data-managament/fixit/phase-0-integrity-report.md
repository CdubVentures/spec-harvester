# Phase 0 Integrity Report

## Snapshot context
- Category: `_test_mouse`
- DB: `.specfactory_tmp/_test_mouse/spec.sqlite`
- Baseline evidence file: `implementation/data-managament/fixit/phase-0-sql-snapshot-_test_mouse.json`

## Baseline snapshot (before current patch set)
- `candidates`: 9738
- `source_assertions`: 7470
- `source_registry`: 22
- `item_field_state`: 1760
- `component_values`: 98
- `list_values`: 124
- `key_review_state`: 1950
- `item_component_links`: 0
- `candidates_missing_source_host`: 7470
- `key_review_selected_value_without_candidate`: 1625

## Post-patch verification (2026-02-19, source runtime path)
- Patch actions applied:
  - `src/db/seed.js`
    - field metadata now supports both `rules.fields` and top-level `fields`
    - component field detection now supports `enum.source=component_db.*`
    - seeded `item_field_state.accepted_candidate_id` now binds to best matching candidate for known pipeline values
    - key-review seed now writes slot IDs (`item_field_state_id`, `component_value_id`, `list_value_id`, `enum_list_id`)
  - `src/api/guiServer.js`
    - test-mode `/run` SpecDb resync now uses `loadFieldRules(...)` compiled contract payload (instead of raw `field_rules.json`)
    - lane mutations now use slot IDs when resolving key-review contexts
  - `src/db/specDb.js`
    - key-review schema now includes slot FK columns + slot-unique indexes
    - constructor backfills existing key-review rows to slot IDs (`backfillKeyReviewSlotIds`)
    - enum rename/delete now maintain FK integrity for key-review/source-assertion refs
  - `src/review/componentReviewData.js`
    - legacy component payload now resolves `component_identity_id`
- Reseed verification (same category DB):
  - `item_component_links`: `0 -> 79`
  - `source_registry`: `22 -> 102`
  - `candidates_missing_source_host`: `7470 -> 0`
  - `key_review_selected_value_without_candidate`: `1945 -> 824`
  - `key_review_state slot binding`:
    - `grid_key` rows with `item_field_state_id`: `1760`
    - `component_key` rows with `component_value_id`: `98`
    - `enum_key` rows with `list_value_id`: `124`
  - `key_review_state selected_candidate_id orphan rows`: `0`
  - Regression tests:
    - `reviewLaneContractApi`: pass
    - `reviewLaneContractGui`: pass
    - `componentReviewDataLaneState`: pass
    - `testDataProviderSourceIdentity`: pass

## Current remaining gap (after patch)
- `key_review_state.selected_candidate_id` is still null for rows where that is expected/acceptable:
  - `enum_key` rows sourced from `known_values`
  - `component_key` rows sourced from authoritative `component_db`
  - grid unknown/system identity fields (`unk`, category/model/id/meta slots)
- Distribution of remaining null `selected_candidate_id`:
  - `grid_key`: 639
  - `enum_key`: 122
  - `component_key`: 63

## Production caveat
- The running packaged GUI/API process can still serve pre-patch behavior until rebuilt/restarted.
- Source code + source-path tests are green; packaged parity requires build/deploy cycle.

## Phase 0 verdict
- Status: CLEARED (source runtime)
- Cleared:
  - source lineage collapse
  - component-link starvation caused by field-meta shape mismatch
  - missing source host population in seeded candidates
  - key-review slot-FK hardening + backfill migration
  - enum rename/delete FK stability after slot-FK introduction
- Still open:
  - packaged-runtime parity validation after rebuild/restart
