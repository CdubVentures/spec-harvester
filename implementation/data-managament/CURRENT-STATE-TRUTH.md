# Current State Truth (Authority + Identity)

Last verified: 2026-02-19

## Non-Negotiable Rules
- Item is never authoritative over component or enum masters.
- Component and enum updates propagate downward to linked items.
- `source_host` and `source_root_domain` are provenance metadata only.
- Mutation routing and cascade targeting are ID/slot driven.

## Authority Keys In Play
- Item key context: `key_review_state(target_kind='grid_key', item_identifier, field_key)`
- Component key context: `key_review_state(target_kind='component_key', component_identifier, property_key)`
- Enum key context: `key_review_state(target_kind='enum_key', field_key, enum_value_norm)`
- Item slot: `item_field_state.id`
- Component property slot: `component_values.id`
- Enum value slot: `list_values.id`
- Enum list: `enum_lists.id`

## Test Mode Defaults (Current)
- `Sources/Scenario = 0`
- `Shared % = 70`
- `Duplicate % = 15`
- Host reuse removed; source hosts are item-unique by default.

## Source Mapping Model
- Candidate identity: `candidates.candidate_id`
- Source identity: `source_registry.source_id`
- Assertion identity: `source_assertions.assertion_id` (`assertion_id = candidate_id`)
- Slot links:
  - `source_assertions.item_field_state_id`
  - `source_assertions.component_value_id`
  - `source_assertions.list_value_id`
  - `source_assertions.enum_list_id`

## Canonical References
- `specdb-source-capture-and-sharing.md`
- `source-schema-key-review-split.md`
- `enum-authoritative-implementation.md`
- `diagrams/authority-flows/*.mmd`

## Archived Notes
- `archive-not-in-use/component-enum-authority-hierarchy-and-audit-notes.md`
