# Phase 0 Schema Map

## Identity hierarchy (target model)
- Item:
  - item identity: `products.product_id` (category-scoped)
  - item key: `field_key`
  - item field slot: `item_field_state.id`
- Component:
  - component identity: `component_identity.id`
  - component key: `component_type + canonical_name + maker`
  - component property slot: `component_values.id`
- Enum:
  - enum list: `enum_lists.id`
  - enum key: `enum_lists.field_key`
  - enum value slot: `list_values.id`

## Current SQL identity map (implemented)
| Domain | Table | Primary Key | Unique Keys | FK Links | Notes |
|---|---|---|---|---|---|
| Candidate | `candidates` | `candidate_id` | none | none | No direct FK to `source_registry` or slot tables. |
| Source | `source_registry` | `source_id` | none | none | Source identity exists but currently under-populated. |
| Source assertion | `source_assertions` | `assertion_id` | none | `source_id -> source_registry.source_id`; slot FKs optional | Slot columns exist (`item_field_state_id`, `component_value_id`, `list_value_id`, `enum_list_id`). |
| Item slot | `item_field_state` | `id` | `(category, product_id, field_key)` | none | Correct slot ID exists. |
| Component slot | `component_values` | `id` | `(category, component_type, component_name, component_maker, property_key)` | none | No FK to `component_identity.id`. |
| Component identity | `component_identity` | `id` | `(category, component_type, canonical_name, maker)` | none | Canonical master exists. |
| Enum list | `enum_lists` | `id` | `(category, field_key)` | none | Correct master ID exists. |
| Enum value slot | `list_values` | `id` | `(category, field_key, value)` | `list_id -> enum_lists.id` | `list_id` is nullable; not hard-enforced. |
| Item->component link | `item_component_links` | `id` | `(category, product_id, field_key)` | none | Link table exists, but can be empty while component slots exist. |
| Item->list link | `item_list_links` | `id` | `(category, product_id, field_key, list_value_id)` | `list_value_id -> list_values.id` | Correct many-to-many item/list binding. |
| Shared lane state | `key_review_state` | `id` | `ux_krs_grid`, `ux_krs_enum`, `ux_krs_component`, slot uniques | `item_field_state_id -> item_field_state.id`; `component_value_id -> component_values.id`; `list_value_id -> list_values.id`; `enum_list_id -> enum_lists.id` | State now supports both composite keys and slot-FK identity; constructor backfills legacy rows. |

## Existing slot-level FK support
- Present in `source_assertions`:
  - `item_field_state_id`
  - `component_value_id`
  - `list_value_id`
  - `enum_list_id`
- Present in lane state:
  - `key_review_state.item_field_state_id`
  - `key_review_state.component_value_id`
  - `key_review_state.list_value_id`
  - `key_review_state.enum_list_id`

## Structural gaps vs required ID-driven behavior
1. `component_values` should include `component_identity_id` FK and be resolved by that ID for authoritative updates.
2. `candidates` should carry explicit source + slot binding (or every candidate must have a mandatory `source_assertions` row).
3. `list_values.list_id` should be NOT NULL for strict enum value ownership.

## Required identity contract for UI interactions
- Grid cell action must resolve by:
  - `item_field_state.id` (slot)
  - `candidate_id` (candidate row)
- Component property drawer action must resolve by:
  - `component_values.id` (slot)
  - `component_identity.id` (master identity)
  - `candidate_id`
- Enum value drawer action must resolve by:
  - `list_values.id` (slot)
  - `enum_lists.id` (parent list)
  - `candidate_id`
