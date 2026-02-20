# Phase 2: Button Mutation Isolation (All 4 Buttons)

## Objective
Guarantee every button mutates only the targeted slot + candidate scope and never spills into other slots, keys, components, or enum values.

## Buttons covered
1. `Accept Item`
2. `Confirm Item`
3. `Accept Shared`
4. `Confirm Shared`

## Target model
- Mutation key must always include:
  - `slot_id`
  - `candidate_id`
  - `scope` (`item` or `shared`)
  - actor metadata + timestamp
- Never mutate by value text or display name.

## State machine rules
1. Accept Item:
   - marks candidate accepted for this item slot.
   - does not auto-confirm AI lane.
   - does not update other item slots.
2. Confirm Item:
   - confirms AI state for this item slot only.
   - does not change selected value unless explicit rule allows.
3. Accept Shared:
   - accepts candidate for shared lane bound to this shared slot.
   - propagates only to slots linked to that authoritative shared slot.
4. Confirm Shared:
   - confirms AI state for shared lane of this shared slot only.
   - no cross-key or cross-list side effects.

## Non-negotiable isolation checks
- One click cannot update another `slot_id` unless explicit authoritative propagation map exists.
- Authoritative propagation map must itself be id-driven and auditable.
- Accept and confirm are distinct transitions and cannot silently alias.

## Implementation tasks
1. Centralize mutation handler around `(slot_id, candidate_id, scope)`.
2. Remove any legacy “find by field/key/list name” update paths.
3. Add transaction logging table for button actions (optional but recommended).
4. Add API contract tests for each button across item/component/enum contexts.
5. Add UI tests that click sequence permutations and assert no off-target mutation.

## Output artifacts
- `data/fixit/phase-2-button-state-machine.md`
- `data/fixit/phase-2-propagation-map.md`
- regression suite for button independence.

## Exit criteria
- Every button action is reproducibly isolated by slot id.
- No random regression to prior state after unrelated interaction.
- Accept/Confirm behavior is consistent in grid, component table, and enum list drawers.
