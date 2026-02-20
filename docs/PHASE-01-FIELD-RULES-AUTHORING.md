# Phase 01 — Field Rules Authoring

## Overview

The Field Rules system is the contract layer that drives everything in SpecFactory: extraction, validation, review grid display, component linking, enum vocabulary control, and AI review. Each category (e.g., `mouse`) has a master `field_rules.json` compiled from an Excel workbook, with downstream artifacts derived automatically.

---

## Compilation Pipeline

### Entry Point

```bash
node src/cli/spec.js compile-rules --category mouse
node src/cli/spec.js compile-rules --category mouse --dry-run  # preview without writing
```

### Pipeline Steps

1. **`compileRules()`** (`src/field-rules/compiler.js`) resolves the category, sets up paths, calls `compileIntoRoot()`
2. **`compileIntoRoot()`** locates the Excel workbook (`helper_files/{cat}/{cat}Data.xlsm` or `_source/field_catalog.xlsx`), loads `workbook_map.json`, calls `compileCategoryWorkbook()`
3. **`compileCategoryWorkbook()`** (`src/ingest/categoryCompile.js`) does the heavy lifting:
   - Parses the Excel workbook (custom ZIP/XML parser)
   - Reads `workbook_map.json` for column mappings, enum lists, component sheet references
   - Scans the field key column to extract all field names
   - For each field: reads sample values, detects enum/component connections
   - Calls `buildFieldRuleDraft()` to infer type/shape/availability from patterns
   - Calls `buildStudioFieldRule()` to merge with existing rules (preserves hand-authored overrides)
   - Assembles `fields{}`, `enum_buckets{}`, `component_db_sources{}`
   - Writes `field_rules.json` and `field_rules.runtime.json`
4. **`ensurePhase1Artifacts()`** derives downstream artifacts:
   - `parse_templates.json` — extraction patterns
   - `cross_validation_rules.json` — plausibility ranges, conditional rules
   - `field_groups.json` — fields grouped by UI group
   - `key_migrations.json` — field key rename tracking
   - `manifest.json` — content hashes of all artifacts
5. **`validateRules()`** runs AJV schema validation + `auditFieldMetadata()` requiring all 8 metadata fields

### Validation

```bash
node src/cli/spec.js validate-rules --category mouse
```

Validates against shared JSON schemas in `categories/_shared/` and audits every field for required metadata sections.

---

## Field Rules Structure

### Master File: `field_rules.json`

Top-level keys:

```json
{
  "category": "mouse",
  "publish_gate": "required_complete",
  "component_db_sources": { ... },
  "enum_buckets": { ... },
  "fields": { ... }
}
```

### Per-Field Contract (14 Sections)

Each field in `fields` has up to 14 sections:

#### `contract` — Data Type Specification

```json
"contract": {
  "type": "integer",
  "shape": "scalar",
  "unit": "g",
  "rounding": { "decimals": 0, "mode": "nearest" },
  "range": { "min": 10, "max": 300 },
  "unknown_token": "unk",
  "unknown_reason_required": true,
  "list_rules": { "dedupe": true, "sort": "none", "min_items": 0, "max_items": 100 }
}
```

**Types:** `string`, `number`, `integer`, `boolean`, `date`, `url`, `list`, `object`
**Shapes:** `scalar`, `list`, `object`

#### `enum` — Vocabulary Control

```json
"enum": {
  "policy": "closed",
  "source": "data_lists.connection",
  "match": { "strategy": "alias", "fuzzy_threshold": 0.75 },
  "new_value_policy": {
    "accept_if_evidence": true,
    "mark_needs_curation": true,
    "suggestion_target": "_suggestions/enums.json"
  }
}
```

**Policies:**
| Policy | Behavior |
|---|---|
| `open` | Any value allowed |
| `open_prefer_known` | Any value, but known values preferred |
| `closed` | Only listed values accepted |
| `closed_with_curation` | Listed values only, but pipeline can suggest new ones |

**Source formats:**
- `"data_lists.connection"` — enum from Excel `data_lists` sheet, column mapped in `workbook_map.json`
- `"component_db.sensor"` — values from compiled component database
- `"yes_no"` — built-in boolean-style list

#### `component` — Component DB Reference

Only present on component-owner fields (e.g., `sensor`, `switch`, `encoder`):

```json
"component": {
  "type": "sensor",
  "source": "component_db.sensor",
  "require_identity_evidence": true,
  "allow_new_components": true,
  "match": {
    "fuzzy_threshold": 0.75,
    "name_weight": 0.4,
    "property_weight": 0.6,
    "auto_accept_score": 0.95,
    "flag_review_score": 0.65
  },
  "ai": { "mode": "off", "context_level": "properties", "model_strategy": "auto" },
  "priority": { "difficulty": "medium", "effort": 5 }
}
```

When `component.type` is set, the field's `enum.source` also points to the component DB, and the `parse.template` is `component_reference`.

#### `parse` — Extraction Guidance

```json
"parse": {
  "template": "number_with_unit",
  "unit": "g",
  "unit_accepts": ["g"],
  "strict_unit_required": false,
  "allow_unitless": true,
  "component_type": "sensor"
}
```

**Templates:** `number_with_unit`, `boolean_yes_no_unk`, `component_reference`, `text_field`, `dimensions_lxwxh`, `date_iso`

#### `priority` — Harvesting Importance

```json
"priority": {
  "required_level": "required",
  "availability": "expected",
  "difficulty": "medium",
  "effort": 8,
  "publish_gate": true,
  "block_publish_when_unk": true
}
```

**Required levels (in order of strictness):**
| Level | `normalizeFieldContract().required` | Publish blocking |
|---|---|---|
| `identity` | `true` | Always blocks |
| `critical` | `true` | Always blocks |
| `required` | `true` | Blocks by default |
| `expected` | `false` | Optional |
| `optional` | `false` | Never blocks |
| `editorial` | `false` | Never blocks |
| `commerce` | `false` | Never blocks |

#### `evidence` — Sourcing Requirements

```json
"evidence": {
  "required": true,
  "min_evidence_refs": 2,
  "tier_preference": ["tier1", "tier2", "tier3"],
  "conflict_policy": "resolve_by_tier_else_unknown"
}
```

#### `ai_assist` — LLM Extraction Config

```json
"ai_assist": {
  "mode": "always",
  "model_strategy": "auto",
  "max_calls": 3,
  "max_tokens": 1000,
  "reasoning_note": "Extract numeric value, ignore marketing claims"
}
```

#### `search_hints` — Source Discovery

```json
"search_hints": {
  "query_templates": ["{brand} {model} {field_name} specs"],
  "query_terms": ["acceleration", "g-force"],
  "preferred_content_types": ["spec_sheet", "review"],
  "preferred_tiers": [1, 2],
  "domain_hints": ["rtings.com", "techpowerup.com"]
}
```

#### `ui` — Display Metadata

```json
"ui": {
  "label": "Sensor",
  "group": "Sensor & Performance",
  "order": 45,
  "input_control": "component_picker",
  "tooltip_md": "Sensor model (component DB-backed)...",
  "suffix": "g",
  "display_decimals": 0,
  "display_mode": "all"
}
```

**Input controls:** `text`, `number`, `list_editor`, `component_picker`, `boolean_toggle`, `date_picker`

#### `excel_hints` — Workbook Position

```json
"excel_hints": {
  "dataEntry": { "key_cell": "B45", "row": 45, "sheet": "dataEntry" },
  "enum_column": { "sheet": "data_lists", "header": "connection" },
  "component_db": "sensor",
  "component_sheet": "sensors"
}
```

#### Other Sections

- `aliases` — alternative field names for extraction matching
- `availability` — `always` | `expected` | `sometimes` | `rare`
- `difficulty` — `easy` | `medium` | `hard` | `instrumented`
- `data_type` — legacy type hint
- `output_shape` — `scalar` | `list`
- `unknown_reason_default` — default unknown reason code

---

## Normalized Field Contract (Review Grid)

The review grid does not consume the full 286 KB `field_rules.json`. Instead, `normalizeFieldContract()` in `src/review/reviewGridData.js` distills each field into a compact 6-property object:

```javascript
function normalizeFieldContract(rule = {}) {
  const contract = isObject(rule.contract) ? rule.contract : {};
  const level = ruleRequiredLevel(rule);
  const comp = isObject(rule.component) ? rule.component : null;
  const enu = isObject(rule.enum) ? rule.enum : null;
  return {
    type:           String(contract.type || 'string'),
    required:       level === 'required' || level === 'critical' || level === 'identity',
    units:          contract.unit || null,
    enum_name:      String(rule.enum_name || '').trim() || null,
    component_type: comp?.type || null,
    enum_source:    enu?.source || null,
  };
}
```

| Property | Source | UI Usage |
|---|---|---|
| `type` | `contract.type` | Cell rendering (number input, text, boolean toggle) |
| `required` | `priority.required_level` | Red-dot indicator in field label column |
| `units` | `contract.unit` | Suffix display in cells |
| `enum_name` | `rule.enum_name` (legacy) | Dropdown population (fallback path) |
| `component_type` | `rule.component.type` | Component picker trigger; two-lane AI review shared lane |
| `enum_source` | `rule.enum.source` | Dropdown population; two-lane AI review shared lane |

**Critical behavior:** `component_type` and `enum_source` determine whether a field gets the shared (purple) AI review lane. Fields with neither are primary-only (teal).

---

## How Lists Work with Field Rules

### Connection: Field Rule -> List

A field's `enum.source` string (e.g., `"data_lists.connection"`) links to a list defined in:
1. **Excel `data_lists` sheet** — column mapped via `workbook_map.json` → `enum_lists[]`
2. **Compiled `known_values.json`** — the runtime-readable snapshot
3. **SQLite `list_values` table** — the live mutable store

### List Value Lifecycle

```
Excel data_lists sheet
  -> compile-rules
    -> known_values.json (compiled snapshot)
    -> field_rules.json enum_buckets (embedded copy)
    -> list_values table (SQLite runtime store)

Pipeline suggestion
  -> _suggestions/enums.json (pending review)
  -> user accepts
    -> manual_enum_values in workbook_map.json (survives recompile)
    -> known_values.json patched
    -> list_values table updated
```

### List Value Change Impact on Items

When a list value changes, the field contract drives how it affects products:

**Add:** No impact on existing products. New value available for future extraction/override.

**Remove:** All products with that value get:
- `item_field_state.value = NULL`
- `needs_ai_review = 1`
- `normalized.json` field entry deleted
- Product marked stale with `priority=1`, `dirty_flags: [{ reason: 'enum_removed' }]`

**Rename:** All products with the old value get:
- `item_field_state.value = newValue` (atomic update in SQLite transaction)
- `item_list_links` foreign keys re-pointed to new list_value_id
- `normalized.json` rewritten with new value
- Product marked stale with `dirty_flags: [{ reason: 'enum_renamed' }]`

---

## How Components Work with Field Rules

### Connection: Field Rule -> Component DB

A field's `component.type` (e.g., `"sensor"`) links to a compiled component database:
1. **JSON files** — `helper_files/{cat}/_generated/component_db/sensors.json`
2. **SQLite tables** — `component_identity`, `component_aliases`, `component_values`
3. **Product links** — `item_component_links` junction table

### Component Property Variance Policies

Each component property has a `variance_policy` that defines how strictly products must match:

```json
// sensors.json item example
{
  "name": "Focus Pro 45K",
  "maker": "razer",
  "properties": { "dpi": 45000, "ips": 900, "acceleration": 85 },
  "__variance_policies": {
    "dpi": "upper_bound",
    "ips": "upper_bound",
    "acceleration": "upper_bound"
  },
  "__constraints": {
    "sensor_date": ["sensor_date <= release_date"]
  }
}
```

### Component Value Change Impact on Items

When a component property value changes:

**Authoritative policy** (identity fields like name, maker):
- Value **pushed directly** to all linked products via `pushAuthoritativeValueToLinkedProducts()`
- `item_field_state.value = newValue`, `confidence = 1.0`, `source = 'component_db'`
- `normalized.json` rewritten for each product
- Queue priority = 1 (highest)

**Upper_bound / lower_bound / range policies** (spec values like dpi, ips):
- Each linked product's current value **evaluated** against the new component value
- Violating products: `needs_ai_review = 1` (flagged for human review)
- Compliant products: `needs_ai_review = 0` (cleared)
- Queue priority = 2

**Override_allowed** (values that vary by product, like click_force):
- No propagation — any product value is acceptable

**Constraints** (cross-field rules like `sensor_date <= release_date`):
- Evaluated independently of variance policy
- Violations set `needs_ai_review = 1`
- Bump queue priority by +1

### Component Sources and Candidates

Component properties draw candidates from three tiers:

1. **Workbook** (`source_id: 'workbook'`) — compiled Excel values, score=1.0
2. **Pipeline** (`source_id: 'pipeline'`) — values seen on real products during extraction, score=0.5-0.6
3. **SpecDb** (`source_id: 'specdb'`) — extraction candidates joined through `item_component_links`

When variance policies exist, `evaluateVarianceBatch()` checks linked products' values and attaches `variance_violations` showing offending products.

---

## Generated Artifacts

| File | Purpose | Generated By |
|---|---|---|
| `field_rules.json` | Master contract — all fields, components, enums | `compileCategoryWorkbook()` |
| `field_rules.runtime.json` | Runtime copy (can diverge for hot-reload) | Same |
| `known_values.json` | Compiled enum values by field | Same |
| `component_db/*.json` | Per-type component databases | Same |
| `parse_templates.json` | Extraction patterns per field | `ensurePhase1Artifacts()` |
| `cross_validation_rules.json` | Plausibility ranges, conditional rules | Same |
| `field_groups.json` | Fields grouped by UI group | Same |
| `key_migrations.json` | Field key rename tracking | Same |
| `manifest.json` | Content hashes of all artifacts | Same |

---

## CLI Commands

```bash
# Compile field rules from workbook
node src/cli/spec.js compile-rules --category mouse

# Preview compile impact without writing
node src/cli/spec.js compile-rules --category mouse --dry-run

# Validate compiled artifacts against schemas
node src/cli/spec.js validate-rules --category mouse

# List all fields with metadata
node src/cli/spec.js list-fields --category mouse [--group <group>] [--required-level <level>]

# Generate field coverage report
node src/cli/spec.js field-report --category mouse [--format md|json]

# Bootstrap a new category
node src/cli/spec.js init-category --category monitor --template electronics
```

---

## Key Source Files

| File | Role |
|---|---|
| `src/field-rules/compiler.js` | `compileRules()`, `validateRules()`, artifact builders |
| `src/ingest/categoryCompile.js` | `compileCategoryWorkbook()`, field rule drafting, component DB compilation |
| `src/engine/ruleAccessors.js` | Pure accessor functions for all rule properties |
| `src/review/reviewGridData.js` | `normalizeFieldContract()`, layout building, product payload assembly |
| `src/review/varianceEvaluator.js` | Variance policy evaluation (5 policies) |
| `src/review/componentImpact.js` | `cascadeComponentChange()`, `cascadeEnumChange()` — propagation |
| `src/review/componentReviewData.js` | Component/enum review payload building with candidates |
| `src/db/specDb.js` | All SQLite table schemas and data access methods |
| `src/api/guiServer.js` | REST endpoints for all review operations |
| `helper_files/{cat}/_control_plane/workbook_map.json` | Excel column mappings, enum list definitions, manual overrides |
