# Phase 2 Button State Machine

## Scope
- Grid item field slot (`item_field_state.id`)
- Component property slot (`component_values.id`)
- Enum value slot (`list_values.id`)

## Buttons
1. `Accept Item` (primary lane)
2. `Confirm Item` (primary lane)
3. `Accept Shared` (shared lane)
4. `Confirm Shared` (shared lane)

## Required Inputs Per Mutation
- `slot_id` (context slot id)
- `candidate_id` (optional only when zero-candidate fallback flow is valid)
- `scope` (`primary`/`shared`)
- context identifiers required by endpoint contract

## Transition Rules
### 1) Accept Item
- Context: grid slot only.
- Writes:
  - `key_review_state.user_accept_primary_status = accepted`
  - optional `selected_candidate_id`/`selected_value`
  - sync `item_field_state.accepted_candidate_id` + selected value
- Does not:
  - confirm AI primary lane
  - mutate other grid slots
  - mutate component/enum lanes

### 2) Confirm Item
- Context: grid slot only.
- Writes:
  - `key_review_state.ai_confirm_primary_status = confirmed`
  - optional selection update if candidate is provided
- Does not:
  - set user-accept primary
  - mutate other grid slots
  - mutate component/enum lanes

### 3) Accept Shared
- Context:
  - grid shared lane via grid endpoint (grid_key only)
  - component shared lane via component endpoint
  - enum shared lane via enum endpoint
- Writes:
  - `key_review_state.user_accept_shared_status = accepted`
  - slot authoritative value + candidate binding
- Propagation:
  - only through explicit authoritative map for the same slot context
- Does not:
  - confirm AI shared lane
  - mutate unrelated shared keys/values

### 4) Confirm Shared
- Context:
  - grid shared lane via grid endpoint (grid_key only)
  - component shared lane via component endpoint
  - enum shared lane via enum endpoint
- Writes:
  - `key_review_state.ai_confirm_shared_status = confirmed`
- Does not:
  - set user-accept shared
  - mutate unrelated shared keys/values

## Isolation Guardrails Implemented
1. Grid lane endpoints now reject non-`grid_key` state rows (no cross-surface mutation by id).
2. Candidate context mismatch rejects candidate-scoped updates.
3. Unknown/empty values cannot be accepted or confirmed.
4. Accept and confirm remain separate transitions.

## Regression Coverage
- `test/reviewLaneContractApi.test.js`
- `test/reviewLaneContractGui.test.js`
- `test/componentReviewDataLaneState.test.js`
