# Phase 3 Shape Contract

## Scope
- `item field slot`
- `component property slot`
- `enum value slot`

## Canonical Rule
Each slot resolves value by declared `shape` only:
- `scalar`: scalar-only value (`string|number|boolean`), never array/object.
- `list`: normalized list value (deduped), serialized deterministically for persistence/display.

## Enforcement Points
1. Engine normalization:
- Scalar fields reject multi-value arrays and object payloads with `shape_mismatch`.
- Scalar singleton arrays are allowed only when exactly one meaningful element exists.

2. Seed / SQL persistence:
- Candidate rows are shape-normalized before insert.
- Unknown/malformed candidate values are skipped.
- `item_field_state.value` is shape-normalized before upsert.
- Component/list linkage reads normalized slot values, not raw payloads.

3. Review payload projection:
- `buildFieldState` shape-normalizes selected and candidate values per field contract.
- Malformed scalar candidates are filtered out from drawer/actionable set.
- List values are canonicalized to stable text for UI rendering.

## Unknown (`unk`) Contract
- `unk` is fallback state, not a candidate source value.
- Unknown/malformed values do not become actionable candidate rows.

## Verified By
- `test/fieldRulesEngine.test.js`
- `test/reviewGridData.test.js`
- `test/reviewLaneContractApi.test.js`
- `test/reviewLaneContractGui.test.js`
