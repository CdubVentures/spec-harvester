# Component and Enum Authority Hierarchy + Audit Notes

## Scope
This note captures the current authority hierarchy, propagation rules, and audit outcomes for component and enum update behavior.

## Authority Hierarchy
1. Master Catalog Layer
- Component master: `component_identity` + `component_values`
- Enum master: `list_values`

2. Link Layer
- Component links: `item_component_links`
- Enum links: `item_list_links`

3. Item State Layer
- Item values: `item_field_state`
- Item evidence/candidates remain item-scoped in `candidates`

4. Review State Layer
- Shared contexts: `key_review_state` (`component_key`, `enum_key`)
- Item contexts: `key_review_state` (`grid_key`)

5. Queue/Recompute Layer
- Product stale/recompute: `product_queue` + dirty flags

## Core Rules (Enforced)
- Component and enum tables are authoritative masters.
- Item/grid acceptance does not write into component/enum master catalogs.
- Master changes propagate downward to linked items.
- Candidate sources can differ per item; canonical master value can still be shared.

## Component Propagation Rules
### Authoritative policy
- On component property update with `variance_policy = authoritative`:
  - push new value to linked items only
  - update linked item normalized output values
  - mark linked items stale with component dirty flags

### Variance policy (`upper_bound` / `lower_bound` / `range`)
- Re-evaluate linked items only.
- Set/clear `needs_ai_review` based on policy checks.
- Unknown/skip values are treated as compliant and now clear stale flag for that key.

### Constraints
- Re-evaluate linked items only.
- Violations set `needs_ai_review = 1`; compliant clears it.
- Constraints-only updates target linked products returned by constraint evaluation.

### Identity updates
- `__name` update cascades authoritative value to linked item field `componentType`.
- `__maker` update cascades authoritative value to linked item field ``${componentType}_brand``.

## Candidate Source Handling (Important)
- Item candidate/source/evidence remains per-item and is not globally overwritten by component master edits.
- Component shared state may store a selected candidate as representative context, but authoritative propagation is by value/policy, not by forcing one item candidate onto all items.

## Enum Handling (for parity)
- Enum values are authoritative in `list_values`.
- Item writes sync `item_list_links` via `list_value_id` lookup.
- Enum rename/remove updates links + item values and triggers stale rechecks.

## Audit Findings and Fixes Applied
1. Authoritative component cascades now target linked products only (not unlinked value matches).
2. Variance rechecks now clear `needs_ai_review` for unknown/skip cases.
3. Constraints-only cascades now target linked products from constraint evaluation.
4. Shared lane no longer performs item/grid -> component/enum master back-propagation.

## Validation
### Targeted tests (new/updated cascade coverage)
- Command: `npx -y node@22 --test test/componentImpactCascade.test.js`
- Result: `6 passed, 0 failed`

### Full suite
- Command: `npx -y node@22 --test`
- Result: `1263 passed, 52 failed` (1315 total)
- Failure clusters are mostly pre-existing contract/review suites (component/enum review payload and lane contract expectations).

## Environment Note
- Rebuilding `better-sqlite3` under Node 20 failed due a Windows file lock on:
  - `node_modules/better-sqlite3/build/Release/better_sqlite3.node`
- Because ABI `127` binary was already present, full suite was executed with Node 22 for deterministic validation.

## Recommended Follow-ups
1. Resolve Windows lock, rebuild `better-sqlite3` on Node 20, rerun full suite under project default runtime.
2. Review the 52 failing contract tests and align expected behavior to authoritative-only propagation rules.
3. If needed, add enum/component evidence bridge tables for multi-source master-level evidence rollups.
