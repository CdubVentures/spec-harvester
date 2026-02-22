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

### Aggregation by slot type
- **`__name` slot**: Collect ALL candidates from ALL N linked products where `field_key` = the component-type field (e.g., `sensor`). If 9 products have 3 sources each and 1 product has 1 source, the drawer shows **28 candidate containers**.
- **`__maker` slot**: Collect ALL candidates from ALL N linked products where `field_key` = the maker field (e.g., `sensor_brand`, `sensor_maker`). Same aggregation — every source from every linked product.
- **Property slots** (e.g., `dpi_max`, `ips`, `actuation_force`): Collect ALL candidates from ALL N linked products where `field_key` = that property key. Same aggregation.
- **`__links` slot**: Aggregated from component identity link data.
- **`__aliases` slot**: Aggregated from component alias data.

### Key invariant
The candidate count for ANY slot is always:
```
C(K, F) = sum over all linked products of (candidate rows where product_id = P and field_key = F)
```
This is **identical** across `__name`, `__maker`, and all property slots. No slot type gets special treatment. No slot type skips linked products. No slot type uses a different aggregation path.


## Fallback behavior
- Primary path is DB link-driven (`item_component_links`).
- Pipeline review suggestions are only used as candidate fallback when a component row has no DB-linked products.

## Debug checks
Use these checks when counts look wrong:
- Verify row link key exists in `item_component_links` for expected products.
- Verify `component_maker` is correct for duplicate-name identities.
- Verify per-slot `field_key` mapping matches expected source field.
- Verify candidate row volume in `candidates` for linked products and slot field key.












## Test mode slot-fill contract (bottom section)
This section is the deterministic test contract for `_test_*` categories.

### Required test data behavior
1. Seed pools come from `implementation/grid-rules/component-identity-pools-10-tabs.xlsx`.
2. For maker-capable component types, each component type test data must include all three identity lanes for the same component name:
- `name + maker A`
- `name + maker B`
- `name + maker=''` (makerless lane)
3. Each of those three lanes must have at least 2 linked products in stress fixtures.
4. Same exact `name + maker` can never appear as two separate rows.
5. Each component type has 6-11 total rows. Row counts are deterministic per type using `stableTextHash(typeName)`.
6. Each component type has 1-3 non-discovered rows (seeded with `__discovery_source: 'component_db'`).
7. Each discovered row must have at least 1 linked product. The A/B/makerless triple rows must have at least 2 linked products each.
8. Non-discovered rows are always visible in the component table regardless of link count.

### Row origin behavior in test mode
1. Rows seeded with `__discovery_source: 'pipeline'` are `Discovered`.
2. Rows seeded with `__discovery_source: 'component_db'` are non-discovered/manual/import placeholders.
3. At payload time, keep up to 3 non-discovered rows per component tab; hide discovered rows with no linked products and no evidence.

### Slot count formula (authoritative)
For any row key `K = (component_type, component_name, component_maker)`:
1. `LP(K) = count(distinct product_id) in item_component_links where row key == K`.
2. For each slot field key `F`, candidate count is:
- `C(K,F) = count(candidates rows where product_id in linked_products(K) and field_key == F)`.
3. Do not derive counts from constants (for example `*3`); always compute from actual `candidates` rows.

### Fallback guardrails in test mode
1. If `LP(K) > 0`, slot candidates must come only from linked products.
2. Queue/pipeline fallback is allowed only when `LP(K) == 0`.
3. Fallback candidates must be lane-scoped to exact row key (`type + name + maker`) so actions stay isolated.

### Test assertions checklist
- Name slot count equals linked-product candidate count for the component reference field.
- Maker slot count equals linked-product candidate count for the configured maker field.
- Property slot counts equal linked-product candidate counts for each property field key.
- Pending AI count equals actionable pending candidates for that exact slot (no cross-slot bleed).
- Clicking accept/confirm in one candidate does not mutate sibling candidates in the same drawer.

### Flag rules
Flag definitions, the 6 real flags, non-flag visual treatments, and the flag-to-domain matrix are defined in `implementation/grid-rules/flag-rules.md`. Only real flags count toward `metrics.flags`.
