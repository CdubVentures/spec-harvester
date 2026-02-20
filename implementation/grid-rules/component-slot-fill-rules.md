# Component Slot Fill Rules

## Scope
This document defines how Component Review rows and slot candidate counts are built for the grid.

## Core tables
- `item_field_state`: one value per product field slot.
- `item_component_links`: maps a product field slot to a component identity lane (`component_type`, `component_name`, `component_maker`).
- `component_identity`: component name/maker identities.
- `component_aliases`: aliases for component identity resolution.
- `component_values`: component property slots (`property_key`) for each identity.
- `candidates`: source-derived candidate rows per product + field.

## How a component link is created
1. During seed, each component field in `item_field_state` is read.
2. The field value is matched against `component_identity` + `component_aliases` for that `component_type`.
3. If multiple identities share the same name, maker hints are used to disambiguate in this order of available data:
- `<component_type>_brand`
- `<component_type>_maker`
- `<field_key>_brand`
- `<field_key>_maker`
- `brand`
- `maker`
4. If one identity is resolved, `item_component_links` is written with that exact `component_name` + `component_maker`.
5. If no identity is resolved, link is written as unresolved (`component_maker=''`, `match_type='unresolved'`).

## Name+Maker lifecycle rules
1. If `name + maker` already matches an existing identity, no new component row is created.
- Correct behavior: link goes to existing identity row only.
2. If only `name` is known and maker is missing/unknown while the name maps to multiple makers, create/use a temporary unresolved row (`maker=''`).
- This row exists to let the user assign the correct maker.
3. After user sets maker and it resolves to an existing unique `name + maker`, the temporary unresolved row must disappear from visible review rows.
- Correct behavior: product links move to the resolved identity row and unresolved row is no longer shown.

## How component rows are created in review
For a given `component_type`, rows come from `component_identity`.
A row key is:
- `component_type`
- `component_name`
- `component_maker`

Same name with different maker is intentionally treated as different rows.

## How each slot gets candidates
For one component row (`type + name + maker`):
1. Linked products are fetched from `item_component_links` by exact row key match.
2. Slot candidates are fetched from `candidates` by joining through those linked products.
3. Field key mapping:
- Name slot (`__name`): candidates where `field_key` = link field key (for example `sensor`).
- Maker slot (`__maker`): candidates where `field_key` = `<component_type>_brand`.
- Property slot (`property_key`): candidates where `field_key` = that property key.
4. Slot candidate count is `candidates.length` for that slot after merge/dedupe rules in payload assembly.

## Row/slot count expectations
- Linked product count for a row is the number of products in `item_component_links` with exact same `type + name + maker`.
- Slot candidate count is the total number of candidate rows from those linked products for that slot field key.
- In `_test_mouse`, many scenarios produce 3 source rows per product, so counts are often `linked_products * 3`, but real count is always driven by actual candidate rows.

## Fallback behavior
- Primary path is DB link-driven (`item_component_links`).
- Pipeline review suggestions are only used as candidate fallback when a component row has no DB-linked products.

## Debug checks
Use these checks when counts look wrong:
- Verify row link key exists in `item_component_links` for expected products.
- Verify `component_maker` is correct for duplicate-name identities.
- Verify per-slot `field_key` mapping matches expected source field.
- Verify candidate row volume in `candidates` for linked products and slot field key.
