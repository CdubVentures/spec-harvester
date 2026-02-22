# Test Mode Data Coverage — Implementation Tracker

## Scope
Tracks the implementation of expanded component table test data coverage.
Goal: 6-11 rows per component table, 1-3 non-discovered rows, >=2 linked products per discovered row (1 OK for newly discovered).

---

## Test Mode Slot-Fill Contract

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

### Why LP and SC counts diverge (LP 5, SC 1 is normal)

The LP badge shows linked products — distinct products whose component field resolved to this row identity. The SC badge shows `candidate_count` for a specific slot — the total candidate rows in SpecDb for that (row, field_key) pair across all linked products.

These counts diverge because **not every linked product produces candidates for every property slot**. Candidates only exist if the product's pipeline run actually extracted a value for that field_key. The seed path (`seed.js` lines 544-608) skips insertion when `baseValues[fieldKey]` is empty, and `buildDeterministicSourceResults` (`testDataProvider.js` line 2344) skips fields where the scenario didn't generate a value.

Real-world example: 5 mice use the same sensor (LP 5), but only 1 review page lists the sensor's max tracking speed. That property slot gets SC 1. Meanwhile the `__name` slot might show SC 12 because all 5 products had the sensor name extracted from multiple sources each.

The formula is always:
```
SC(K, F) = count(candidate rows WHERE product_id IN linked_products(K) AND field_key = F)
```

This is expected and correct — SC tells you how much evidence exists for a specific property, not how many products use the component.

**LP 0 with SC > 0 on name/maker is also valid.** Non-discovered rows (seeded from the component DB or created via manual override) have no linked products. Their `name_tracked` and `maker_tracked` are initialized with a workbook candidate from the DB identity itself (`componentReviewData.js` lines 968-991, 997-1024) before the linked-product lookup runs. So a non-discovered row shows LP 0, SC 1 on `__name`, SC 1 on `__maker` (if maker is non-empty), and SC 0 on all property slots. A manual override changes the selected value but does not insert new candidate rows — SC stays the same.

### Flag rules
Flag definitions, the 6 real flags, non-flag visual treatments, and the flag-to-domain matrix are defined in `implementation/grid-rules/flag-rules.md`. Only real flags count toward `metrics.flags`.

---

## Implementation Changes (completed)

### 1. `src/testing/testDataProvider.js` — `buildSeedComponentDB`

**Before:** Fixed 7 items (Alpha/Beta/Gamma + Delta/Epsilon/Zeta/Eta) + 1-8 extras from pool. No discovery flags. All items treated as discovered.

**After:**
- `totalItemTarget = 6 + (stableTextHash(typeName) % 6)` → deterministic [6, 11] per type
- `nonDiscoveredCount = 1 + (stableTextHash(typeName + '_nd') % 3)` → [1, 3] per type
- `discoveredCount` capped at 7 via `maxDiscovered` to ensure reliable product linkage
- Items 0-2 (A/B/makerless triple) unchanged, now flagged `__nonDiscovered: false, __discovery_source: 'pipeline'`
- Items 3+ generated in a single loop from pool names with cycling strategies ('mid', 'upper', 'lower')
- Last `nonDiscoveredCount` extras flagged `__nonDiscovered: true, __discovery_source: 'component_db'`
- Removed hardcoded extraNameA-D and makerC-F constants
- Pool name validation now computed dynamically from `requiredPoolNames = extraNameStart + (actualTotal - 3)`

### 2. `src/testing/testDataProvider.js` — `buildBaseValues`

**Before:** `scenarioLane = scenarioIdx % 3` routed ALL products to items 0-2 only. Items 3+ got 0 linked products.

**After:**
- Removed `scenarioLane` variable
- Filters seed DB items to `discoveredItems = allItems.filter(item => !item.__nonDiscovered)`
- For maker types (>3 discovered items): weighted pool `[0,1,2,0,1,2,3,4,...,3,4,...]` gives items 0-2 double representation AND doubles items 3+ to survive override scenarios
- For non-maker types (>3 discovered items): doubled pool `[0,1,...,N,0,1,...,N]` ensures all items get multiple scenario assignments
- For <=3 discovered items: simple `safeIdx % discoveredCount`
- Maker is taken directly from `targetItem.maker` instead of separate lane logic

### 3. `src/db/seed.js` — `seedComponents`

**Before:** All component identities seeded with hardcoded `source: 'component_db'`.

**After:** Reads `entry.__discovery_source || 'component_db'` into `entrySource` and propagates it to:
- `db.upsertComponentIdentity({ source: entrySource })`
- `db.insertAlias(idRow.id, alias, entrySource)`
- `db.upsertComponentValue({ source: entrySource })`

Items with `__discovery_source: 'pipeline'` are now recognized as discovered by `componentReviewData.js`.

### 4. `src/review/componentReviewData.js` — `enforceNonDiscoveredRows`

**Before:** `enforceSingleNonDiscoveredRow` forced exactly 1 non-discovered row in test mode by overwriting all discovery flags.

**After:** Renamed to `enforceNonDiscoveredRows`:
- In test mode: trusts actual `discovered` flags from `normalizeDiscoveryRows` (derived from `discovery_source`)
- Caps non-discovered rows at 3 maximum (safety guard)
- If all rows are discovered: marks first unlinked row as non-discovered (existing fallback behavior)
- Updated all 4 call sites

### 5. `test/contractDriven.test.js` — Test assertions

- **SEED-02**: threshold `>=7` → `>=6`
- **SEED-02c** (new): asserts 1-3 non-discovered items per type via `__nonDiscovered` flag
- **SEED-02d** (new): asserts each discovered identity row has >=1 linked products
- **SECTION 4**: threshold `>=7` → `>=6`
- **MATRIX-12**: threshold `>7` → `>6`

### 6. `implementation/grid-rules/component-slot-fill-rules.md`

Updated "Test mode slot-fill contract" section with new row counts, non-discovered counts, and linked product requirements.

---

## Observed Test Data Distribution

```
encoder: total=7  discovered=4  non-discovered=3
material: total=10 discovered=7  non-discovered=3
sensor:  total=7  discovered=5  non-discovered=2
switch:  total=9  discovered=7  non-discovered=2
```

Distinct row counts: 7, 9, 10 — confirms variation across types.

---

## Test Results

| Test File | Tests | Pass | Fail |
|-----------|-------|------|------|
| `contractDriven.test.js` | 155 | 155 | 0 |
| `componentReviewDataLaneState.test.js` | 19 | 19 | 0 |
| `reviewLaneContractApi.test.js` | (included below) | | |
| `reviewLaneContractGui.test.js` | (included below) | | |
| `reviewGridData.test.js` | (included below) | | |
| Related review tests (combined) | 26 | 26 | 0 |
| **Total** | **200** | **200** | **0** |
