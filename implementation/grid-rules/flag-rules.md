# Flag Rules

## Scope
This document defines the complete flag universe for the review grid across all three domains: Item Grid, Component Grid, and Enum Grid. A flag means the user needs to see it and potentially take action. This is the authoritative reference — no other reason codes should generate flag counts.

---

## Real Flags (actionable — user must see these)

| # | Flag | Domain | When it fires | User action |
|---|------|--------|---------------|-------------|
| 1 | `variance_violation` | Component property slots | Extracted value violates the component's variance policy (e.g. upper_bound exceeded, range tolerance breached) | Review the property value against the known component spec |
| 2 | `constraint_conflict` | Item grid + Component grid | Cross-validation rule or constraint violated (e.g. sensor DPI exceeds known max, date constraint broken, out-of-range value) | Verify the conflicting values and resolve |
| 3 | `new_component` | Component name/maker slots | Newly discovered component identity not in the component DB — needs review to confirm or reject | Accept the new component or map to existing identity |
| 4 | `new_enum_value` | Enum grid | New enum value discovered that is not in known values list — needs curation | Accept into known values or reject/map to existing |
| 5 | `below_min_evidence` | Item grid | Field has fewer distinct evidence refs than its `min_evidence_refs` requirement | Needs more sources before the value can be trusted |
| 6 | `conflict_policy_hold` | Item grid | Field uses `preserve_all_candidates` conflict policy — the auto-accepted value still needs a user to manually click accept | User must explicitly accept one of the preserved candidates |
| 7 | `dependency_missing` | Item grid + Component grid | A `requires` constraint declared on a field fails — the required dependent field is missing/unk while the declaring field has a value (e.g. `sensor_brand requires sensor`) | Find and populate the missing dependent field |

---

## NOT Flags (have their own visual treatment — do not generate flag counts)

| Code | Visual treatment | Why not a flag |
|------|-----------------|----------------|
| `manual_override` | Source badge shows "user" | User already took action, nothing more to review |
| `missing_value` | Cell shows "unk" | Nothing to review — value is simply unknown |
| `missing_required_field` | Cell shows "unk" | Same as missing_value — required fields show unk like any other |
| `critical_field_below_pass_target` | Cell color is red | Confidence colors already communicate this |
| `below_pass_target` | Cell color is red | Confidence colors already communicate this |
| `low_confidence` | Cell color is red (< 0.6) | Color handles it |
| `needs_review_confidence` | Cell color is yellow (0.6–0.84) | Color handles it |
| `pending_ai` | Has its own dedicated badge | Separate visual lane, not a flag |

---

## Engine-Level Codes (pipeline execution only — do not surface in review grid)

| Engine code | Why it stays in pipeline only |
|-------------|-------------------------------|
| `out_of_range` | Already covered by `constraint_conflict` — range checks are a constraint type |
| `enum_value_not_allowed` | Closed enum rejection — value gets set to unk. Not a flag, just unk. |
| `shape_mismatch` | Pipeline parse error, not a review concern |
| `number_required` | Pipeline parse error, not a review concern |

---

## Parameters Audited — No Flag Needed

| Parameter | Why no flag |
|-----------|------------|
| `tier_preference_override` | Tier preference is a scoring weight — the right tier wins automatically, no user action |
| `object_schema` | Schema validation happens at parse time, not review time |
| `list_fields_dedup` | Dedup is automatic, nothing for user to review |
| `multi_source_consensus` | Consensus scoring is automatic — confidence color shows the result |
| `rounding` | Automatic rounding, no user action |
| `closed_enum_reject` | Value set to unk — not a flag, just missing |

---

## Confidence Color Bands (visual treatment, not flags)

| Confidence | Color | Meaning |
|-----------|-------|---------|
| `<= 0` | gray | No data |
| `< 0.6` | red | Low confidence |
| `0.6 – 0.84` | yellow | Moderate confidence |
| `>= 0.85` | green | High confidence |

Colors are overridden to red when `constraint_conflict`, `variance_violation`, or `dependency_missing` flags are present, regardless of confidence score.

Range bound constraints (e.g. `dpi >= 100`, `weight <= 200`) fire as `constraint_conflict` when violated.

---

## Flag-to-Domain Matrix

| Flag | Item Grid | Component Grid | Enum Grid |
|------|-----------|---------------|-----------|
| `variance_violation` | | X (property slots) | |
| `constraint_conflict` | X | X | |
| `new_component` | | X (name/maker slots) | |
| `new_enum_value` | | | X |
| `below_min_evidence` | X | | |
| `conflict_policy_hold` | X | | |
| `dependency_missing` | X | X | |

---

## Contract Rule

Every flag that CAN exist for a key MUST be generated in the test data. The coverage matrix proves this with two columns:
- **Use Cases Covered**: Confirms all flaggable scenarios for this key were exercised
- **Flags Generated**: Count of distinct flags the test data produced for this key

Keys where no flags are applicable should produce zero flags — proving the contract works both ways. There are no edge cases — if a flag fires, it is a documented use case. If a flag doesn't fire, the key is clean.
