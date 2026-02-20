# Phase 0 Remediation Checklist

## Objective
Make all lane interactions ID-driven and source-lineage-complete before Phase 1 UI behavior tuning.

## P0 (blocking)
1. [Done] Fix candidate seeding source metadata mapping
- File: `src/db/seed.js`
- Result: candidate/source lineage no longer collapses to `unknown` host buckets.

2. [Done] Source-link synthetic component-review candidates
- File: `src/api/guiServer.js` (`syncSyntheticCandidatesFromComponentReview`)
- Result: synthetic pipeline candidates now write `source_registry` + `source_assertions`.

3. [Done] Ensure test-mode SpecDb resync uses compiled rules
- File: `src/api/guiServer.js`
- Change: `/test-mode/run` now loads compiled rules via `loadFieldRules(...)` before `seedSpecDb(...)`.
- Result: component DB + enum metadata are available during reseed.

4. [Done] Fix field-meta detection for both contract shapes
- File: `src/db/seed.js`
- Change: `buildFieldMeta` now supports both `rules.fields` and top-level `fields`, and detects component refs from `enum.source=component_db.*`.
- Result: component/list slot metadata is correctly recognized during seed.

5. [Done] Bind item slot selected candidate IDs during seed
- File: `src/db/seed.js`
- Change: for known pipeline slot values, seed binds `item_field_state.accepted_candidate_id` from best matching seeded candidate.
- Result: fewer detached lane states (`selected_value` with null candidate).

6. [Done] Enforce ID-only write context across mutation endpoints
- File: `src/api/guiServer.js`
- Status:
  - Component/enum/grid mutation endpoints require slot/identity IDs by action type.
  - Slot IDs are now passed into key-review lookups (`item_field_state_id`, `component_value_id`, `list_value_id`) for lane writes.
  - Resolver fallback remains only in non-required/read branches.

7. [Done] Component identity IDs in payloads
- File: `src/review/componentReviewData.js`
- Status:
  - SpecDb-first payload path returns `component_identity_id`.
  - Legacy fallback now resolves and returns `component_identity_id` from SpecDb.

## P1 (schema hardening)
1. [Done] Add slot FK identity columns to `key_review_state`
- Add nullable FK columns:
  - `item_field_state_id`
  - `component_value_id`
  - `list_value_id`
  - `enum_list_id`
- Add unique indexes by slot FK.
- Add constructor backfill to populate slot columns for existing DBs.

2. [Pending] Add `component_identity_id` FK to `component_values`
- Enforce authoritative component property slots bound to master identity rows.

3. [Partial] Harden enum ownership
- Make `list_values.list_id` required where applicable.
- Backfill existing null list ownership by `(category, field_key)`.
- Rename/delete paths now preserve FK integrity for `key_review_state` and `source_assertions`.

## P2 (legacy cleanup)
1. Remove residual resolver fallback branches for write paths
- Keep fallback only in read diagnostics if needed.

2. Normalize candidate ID contract for source-level actions
- Ensure component/enum source-lane actions always use source-scoped candidate IDs.

3. Keep unknown values non-actionable
- Already enforced on accept/confirm endpoints; maintain in all new UI/API flows.

## Regression checks
1. `npm.cmd test -- test/reviewLaneContractApi.test.js`
2. `npm.cmd test -- test/reviewLaneContractGui.test.js`
3. `npm.cmd test -- test/componentReviewDataLaneState.test.js`
4. `npm.cmd test -- test/testDataProviderSourceIdentity.test.js`

## Definition of done (Phase 0)
- Source lineage complete and queryable per source identity.
- Component/list slot linkage populated from seed + run flows.
- No write mutation depends on display names where slot IDs exist.
- Packaged runtime behavior matches source runtime after rebuild/restart.
