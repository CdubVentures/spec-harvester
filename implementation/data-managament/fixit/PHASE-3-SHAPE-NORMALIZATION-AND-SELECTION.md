# Phase 3: Shape Normalization + Current Value Selection

## Objective
Fix scalar/list corruption paths and make current value selection deterministic across item field slots, component property slots, and enum value slots.

## Problems to eliminate
- Scalar fields receiving list/array candidates and rendering arrays in grid.
- List fields being reduced like scalar fields.
- Current value showing 100%/pipeline while no candidate is accepted or visible.
- `unk` being treated like a normal candidate source value.

## Canonical rules
1. Shape enforcement:
- scalar slot accepts only scalar normalized value.
- list slot accepts only list normalized value with canonical ordering/dedupe policy.
2. `unk` handling:
- not a source candidate.
- only a resolved fallback state with explicit reason.
3. Current value selection order:
1. manual override (user)
2. explicitly accepted candidate in active scope
3. highest-confidence eligible candidate in slot
4. `unk` fallback with reason code
4. Current source:
- must point to existing candidate when selected by candidate.
- null only for manual override.

## Implementation status
Completed in code:
- `src/utils/slotValueShape.js` added for shape normalization + deterministic list serialization.
- `src/engine/fieldRulesEngine.js` now rejects malformed scalar array/object payloads.
- `src/db/seed.js` now shape-normalizes candidate and item slot writes before SQL persistence.
- `src/review/reviewGridData.js` now shape-normalizes projection and uses explicit selection order.

## Output artifacts
- `implementation/data-managament/fixit/phase-3-shape-contract.md`
- `implementation/data-managament/fixit/phase-3-current-selection-policy.md`

## Exit criteria
- No scalar slot can persist an array/list value.
- No list slot can persist a scalar-only normalization artifact.
- Every displayed candidate-based current value maps to an actual candidate row.
- `unk` appears only as explicit fallback state with reason and flags.
