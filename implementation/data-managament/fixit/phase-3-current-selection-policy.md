# Phase 3 Current Selection Policy

## Selection Order (All Slots)
1. Manual override (`user`)  
2. Explicit accepted candidate id (same slot)  
3. Highest-confidence actionable candidate (same slot)  
4. `unk` fallback

Slot scope is strict:
- `item field slot` selection cannot be driven by other item slots.
- `component property slot` selection cannot be driven by other properties.
- `enum value slot` selection cannot be driven by other enum rows.

## Source Contract
- If value comes from a candidate, `source/method/evidence` must resolve from that candidate row.
- If manual override is active, source is `user` and candidate pointer is null.
- If no real candidate exists but a known selected value exists, a synthetic selected candidate is added only for provenance continuity.

## Type/Shape Interaction
- Candidate matching is done on normalized comparable tokens per slot shape.
- If selected value token matches top candidate token, preserve selected value representation.
- If selected token does not match, selected value is replaced by top candidate value.

## Review Flags
- `needs_review` uses reason codes from resolved selected value + confidence + constraints.
- `needs_ai_review` lane state remains authoritative from slot state tables.

## Resulting UI Behavior
- Drawer candidates and cell current value come from the same slot-bound candidate set.
- Candidate count remains stable even when candidate payload is omitted from lightweight responses.
- Scalar slots no longer show list/object artifacts as selected values.
