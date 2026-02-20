# Phase 1 Slot Projection Contract

## Purpose
Define one read contract for how each slot is projected from SQL into grid/component/enum UI so cell state and drawer state never drift.

## Scope
- Item field slot: `item_field_state.id`
- Component property slot: `component_values.id`
- Enum value slot: `list_values.id`

## Identity Binding Rules
1. Every rendered slot must carry its slot id in payload (`slot_id`, `componentValueId`, `list_value_id`).
2. Drawer requests and mutations must include the same slot id from the selected cell.
3. Lane state (`key_review_state`) is joined by slot id + context keys, never by label text only.
4. Candidate actions are candidate-id scoped plus slot-context validated server-side.

## Read Path Rules
1. GET endpoints are read-only and must not insert synthetic candidates/sources/assertions.
2. Payload synthesis is in-memory only for display parity (selected value visibility), marked as synthetic.
3. Synthetic selected candidates are non-actionable UI artifacts.

## Cell/Drawer Consistency Rules
1. Cell and drawer candidate lists must come from the same slot payload.
2. Current value source must map to a candidate row when meaningful; if missing, inject synthetic selected candidate in-memory.
3. Pending AI banner/badge only when lane pending **and** slot has actionable candidate targets.
4. Pending target ids are derived only from actionable candidates in that slot.

## Visibility Rules
1. Component rows render when:
   - linked products exist, or
   - actionable pending candidates exist for name/maker/property.
2. Enum values with `source='pipeline'` and zero linked products are hidden.
3. Enum flag counts are based on actionable pending candidates only.

## Mutation Safety Rules
1. Accept/confirm cannot execute on unknown values.
2. Candidate context mismatch rejects mutation.
3. Accept/confirm on one slot never mutates sibling slots.

## Expected Outcome
- No AI badge with empty actionable drawer.
- No “ghost pending” rows without linkage.
- No read-time state pollution from GET endpoints.
