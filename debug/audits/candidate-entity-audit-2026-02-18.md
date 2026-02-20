# Candidate Entity + AI Confirm Audit (2026-02-18)

## Scope
- Review Grid candidate drawers
- Component table candidate drawers
- Enum/list candidate drawers
- Candidate identity consistency (SpecDb + synthetic pipeline candidates)
- AI Confirm behavior (item lane + shared lane)

## Findings

### 1) Candidate identity was mixed (real + synthetic), causing UI drift
- Grid mostly used `candidates` table rows, but could append synthetic `pl_*` entries from pending component-review items.
- Component/enum drawers also merged real SpecDb candidates with synthetic entries.
- Result: some candidate actions were value-inferred instead of candidate-id-driven.

### 2) Accepted state inference was value-based in parts of UI
- Drawer could treat matching value as accepted even when no explicit accepted candidate id was set.
- This made duplicate-value candidates appear ambiguously accepted.

### 3) AI Confirm semantics were lane-level in backend and drawer-wide in UI
- Confirm buttons effectively toggled lane state for the full drawer context.
- In component/grid fallback flows, confirm could approve all pending review items in the drawer.

## Fixes Applied

### A) Accepted source is now id-driven
- Added/propagated `accepted_candidate_id` across payloads and UI state:
  - Grid field state
  - Component property/name/maker states
  - Enum/list value states
- Drawer now uses explicit accepted candidate id for the active accepted badge.
- Same-value candidates get green support hue, but only one candidate is active accepted.

### B) Manual override remains manual
- Inline/manual edits no longer auto-convert to candidate acceptance.
- Manual edits clear `accepted_candidate_id`.

### C) AI Confirm is candidate-scoped in interaction
- Grid key-review confirm/accept endpoints now accept `candidateId` (+ optional candidate value/confidence).
- Key-review state stores selected candidate id/value for that lane action.
- Drawer AI badges/tints no longer apply to all candidates; lane targeting uses selected candidate id.
- Component drawer confirm now scopes to candidate-matching pending review items instead of approving all.
- Enum drawer confirm now uses the clicked candidate value/id.

### D) Synthetic candidate persistence + cross-surface fan-out
- Component-review synthetic candidates are now upserted into `specDb.candidates` (`pl_*` IDs) for non-dismissed queue items.
- Shared-lane confirm/accept now fans out from grid key-review to:
  - Enum/list shared state (`enum_key`, `list_values`, `item_list_links`)
  - Component identity shared state (`component_key` for `__name`, `item_component_links`)
  - Component property shared state (all known component property lanes + `__maker`)
  - Enum/list contexts linked to component properties when those property keys are enum/list-backed
  - Matching component review queue items (`pending_ai` -> `accepted_alias`)

### E) Immutable import candidate provenance
- SpecDb component payload builder rebuilds workbook/import candidates from compiled component DB baseline, not mutable selected values.
- User edits no longer mutate import candidate evidence.

## Remaining Gaps (After Current Patch)

### 1) Synthetic persistence is mostly solved for component-review-derived candidates
- `pl_*` candidates from `component_review.json` are now persisted.
- Remaining virtual candidates are mostly UI-aggregated presentation rows (multi-product consolidation).

### 2) Shared propagation still depends on component identity resolution
- Full property-lane fan-out is now enabled when a canonical component row is resolvable.
- If a selected shared value cannot resolve to a component identity row, propagation is limited to identity/list contexts for that action.

## Recommended Next Step
1. Add a canonical `candidate_context_links` layer for strict global candidate-context lineage across grid/component/enum.
2. Add explicit policy knobs for fan-out depth (`identity_only`, `identity_plus_properties`, `full_property_plus_enum`) per field contract.
