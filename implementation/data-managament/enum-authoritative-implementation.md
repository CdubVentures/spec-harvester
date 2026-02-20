# Enum Implementation Notes (Authoritative Master Model)

Last verified: 2026-02-19

## Goal
Keep enum/list data master-controlled while allowing item-level extraction variance.

## Canonical Model
- `list_values`: canonical enum rows (master catalog).
- `item_list_links`: item-to-enum association via `list_value_id`.
- `item_field_state.value`: denormalized item display/runtime value.
- `candidates`: item-level extracted options with item-specific evidence/source metadata.

Canonical identity is `list_values.id`, not raw item text.

## Authority Contract
- Enum changes are master-first and propagate downward to linked items.
- Item/grid accepts never upsert or rewrite enum master rows.
- Item edits can only link to an existing enum row or remain unlinked.

## How Different Item Sources Map To One Enum
Multiple items can have different candidate IDs, websites, and quotes, while all map to one enum value:

1. Each item keeps its own evidence in `candidates`.
2. Shared enum review state is keyed by `(category, field_key, enum_value_norm)`.
3. Accepted shared enum value points to one canonical value in `list_values`.
4. Each item links to that canonical enum row through `item_list_links.list_value_id`.

Result: many candidate sources -> one enum master value.

## Runtime Link Sync
On any item field write, `SpecDb.syncItemListLinkForFieldValue({ productId, fieldKey, value })` runs:

1. Remove existing links for that item+field.
2. Resolve `value` to `list_values` (exact, then normalized case-insensitive match).
3. Insert `item_list_links` row if matched.
4. Leave no enum link if unmatched.

This keeps links deterministic and ID-driven.

Source identity note:
- `source_host` and `source_root_domain` are provenance metadata only.
- Enum authority and mutation routing are never host-driven; they are `list_values.id` and key-review context driven.

## Rename And Remove Semantics
- `renameListValue(fieldKey, oldValue, newValue, timestamp)`:
  - rewrites `item_field_state.value`
  - remaps `item_list_links.list_value_id`
  - returns affected product IDs for cascade/reflag
- `deleteListValue(fieldKey, value)`:
  - deletes dependent `item_list_links` first
  - removes master enum row
  - cascade marks affected products stale

## Paths Covered
Enum link sync is applied in:
- review override writes
- manual override writes
- finalize override writes
- exporter pipeline writes

## Shared-Lane Behavior
- `enum_key` shared state is unique per normalized enum value.
- Item candidate IDs may differ, but selected shared enum value is unified.
- Primary item lane remains item-specific; shared lane represents canonical enum decision.

## Test Mode Defaults (Current)
- `Sources/Scenario = 0`
- `Shared % = 70`
- `Duplicate % = 15`
- Host reuse toggle removed; generated hosts are item-unique by default.

## Current Limitation
`list_values.accepted_candidate_id` is a single representative pointer. It is not a full evidence aggregation across all linked items.

## Recommended Next Step (Optional)
Add an enum evidence bridge table (for example: `list_value_evidence`) to store multiple candidate/evidence references per canonical enum value.

## Operational Invariant
If a field is enum-managed, correctness is defined by:
- valid `item_list_links.list_value_id` reference when matched
- and `item_field_state.value` aligned to the selected canonical enum text after rename/remove cascades.
