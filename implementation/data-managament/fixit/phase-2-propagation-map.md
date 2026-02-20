# Phase 2 Propagation Map (ID-Driven)

## Entity Layers
- Item: `products`
- Component: `component_identity`
- Enum list: `enum_lists`
- Item slot: `item_field_state.id`
- Component slot: `component_values.id`
- Enum slot: `list_values.id`
- Lane state: `key_review_state.id`

## Primary Lane (`item` scope)
- Owner: `grid_key` lane row for one item slot.
- Link key:
  - `key_review_state.item_field_state_id` -> `item_field_state.id`
- Allowed propagation:
  - none beyond same item slot.

## Shared Lane (`shared` scope)
### Grid shared
- Owner: `grid_key` lane row for one item slot.
- Link key:
  - `key_review_state.item_field_state_id` -> `item_field_state.id`
- Allowed propagation:
  - only same row by id (grid route hard-locked to `grid_key`).

### Component shared
- Owner: `component_key` lane row for one component property slot.
- Link keys:
  - `key_review_state.component_value_id` -> `component_values.id`
  - `key_review_state.component_identifier` + `property_key`
- Allowed propagation:
  - linked item slots from `item_component_links` for that component identity/property only.

### Enum shared
- Owner: `enum_key` lane row for one enum value slot.
- Link keys:
  - `key_review_state.list_value_id` -> `list_values.id`
  - `key_review_state.enum_value_norm` + `field_key`
- Allowed propagation:
  - linked item slots from `item_list_links` / matching field value for that enum value only.

## Button -> Propagation Matrix
- `Accept Item`: same grid slot only.
- `Confirm Item`: same grid slot only.
- `Accept Shared`:
  - grid: same grid slot only.
  - component: authoritative linked products for same component slot only.
  - enum: authoritative linked products for same enum value slot only.
- `Confirm Shared`:
  - grid: same grid slot only.
  - component: same component slot lane state only.
  - enum: same enum value slot lane state only.

## Blocked Paths
- Grid lane endpoint mutating `component_key`/`enum_key` by raw `key_review_state.id`.
- Cross-field candidate apply where candidate field key mismatches slot field key.
- Accept/confirm with unknown value.
