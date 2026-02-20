# Phase 0 Query/Mutation Path Findings

## Resolved in current source patch set

1. Field-meta shape mismatch during seed
- File: `src/db/seed.js`
- Previous issue: seed expected `fieldRules.rules.fields` only, while test-mode runtime often supplied top-level `field_rules.json` shape.
- Fix: `buildFieldMeta` now supports both shapes and derives component refs from `enum.source=component_db.*`.
- Impact: component/list metadata now resolves during seed.

2. Test-mode `/run` resync used raw field-rules JSON
- File: `src/api/guiServer.js`
- Previous issue: `seedSpecDb` was called with raw `field_rules.json`, dropping compiled component DB/known values metadata.
- Fix: route now loads compiled contract via `loadFieldRules(...)` before `seedSpecDb(...)`.
- Impact: post-run reseed has full metadata and correctly rebuilds links/lane tables.

3. Item slot selected candidate linkage during seed
- File: `src/db/seed.js`
- Previous issue: `item_field_state.accepted_candidate_id` stayed null for many known pipeline values.
- Fix: seed now binds selected slot value to best matching seeded candidate (exact normalized-value match preferred).
- Impact: major reduction of lane rows detached from candidate identity.

4. `key_review_state` slot-FK identity hardening
- File: `src/db/specDb.js`, `src/db/seed.js`, `src/review/keyReviewState.js`, `src/api/guiServer.js`
- Previous issue: key-review state was resolved mainly by composite text keys, allowing stale/ambiguous mapping and making slot isolation harder.
- Fix:
  - added slot FK columns on `key_review_state` (`item_field_state_id`, `component_value_id`, `list_value_id`, `enum_list_id`)
  - added slot-unique indexes
  - backfilled existing DB rows via constructor migration (`backfillKeyReviewSlotIds`)
  - switched key-review lookup/apply paths to slot-first when IDs are available
- Impact: grid/component/enum lane mutations are now slot-anchored and decoupled by identifier.

5. Enum rename/delete FK integrity
- File: `src/db/specDb.js`
- Previous issue: after adding slot FK columns, enum rename/delete could violate FKs due stale `key_review_state.list_value_id` / `source_assertions.list_value_id`.
- Fix: rename/delete now remap or clear dependent rows and delete dependent key-review run/audit rows before removing old list slots.
- Impact: enum rename flow no longer trips FK errors.

6. Legacy component payload identity hydration
- File: `src/review/componentReviewData.js`
- Previous issue: legacy payload emitted `component_identity_id: null`.
- Fix: legacy path now resolves identity id from SpecDb by `(componentType, resolvedName, resolvedMaker)`.
- Impact: drawer payload identity is consistent across specdb-first and legacy fallback paths.

## Improved metrics (source runtime verification)
- `item_component_links`: `0 -> 79`
- `candidates_missing_source_host`: `7470 -> 0`
- `source_registry`: `22 -> 102`
- `key_review_state selected_value without candidate`: `1945 -> 824`
- `key_review_state slot-FK coverage`:
  - `grid_key` bound slots: `1760`
  - `component_key` bound slots: `98`
  - `enum_key` bound slots: `124`
- `key_review_state selected-candidate orphans`: `0`
- Regression suite status:
  - `test/reviewLaneContractApi.test.js`: pass
  - `test/reviewLaneContractGui.test.js`: pass
  - `test/componentReviewDataLaneState.test.js`: pass
  - `test/testDataProviderSourceIdentity.test.js`: pass

## Still open / partial

1. Resolver helper fallback logic still exists (read/non-required branches)
- File: `src/api/guiServer.js`
- `resolveComponentMutationContext` / `resolveEnumMutationContext` retain fallback branches when route does not require explicit IDs.
- Current write endpoints require IDs per action type and are slot-driven.

2. Packaged runtime parity
- Source runtime is patched and tests are green.
- Packaged app must be rebuilt/restarted to guarantee the same behavior in live GUI.

## Decision
- Keep strict ID-required behavior in component/enum/grid mutation endpoints.
- Keep slot-FK backfill in constructor for existing DB compatibility.
- Remove residual resolver fallback in write code once all read callers are explicitly audited.
- Validate packaged runtime parity after rebuild/restart.
