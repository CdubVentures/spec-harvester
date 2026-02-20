# SpecFactory Ecosystem Data Management

## Overview

SpecFactory manages product specifications through a layered data architecture with three interconnected subsystems: **field-level extraction** (per-product spec values), **component databases** (shared hardware components like sensors and switches), and **data lists** (enumerated value vocabularies like connection types). All three are backed by a **source registry** that tracks provenance from extraction through to AI review.

---

## Data Architecture

### Core Tables (SQLite — SpecDb)

| Table | Purpose |
|---|---|
| `candidates` | Raw extracted spec values from pipeline crawls |
| `item_field_state` | Current best value per (product, field) — the live spec |
| `item_component_links` | Links products to named components (sensor, switch, encoder, material) |
| `item_list_links` | Links products to enumerated list values |
| `list_values` | Canonical enum/list values with source tracking |
| `component_identity` | Component canonical name, maker, aliases, review status |
| `component_aliases` | Alternative name strings per component |
| `component_values` | Per-property values for components with variance policies |
| `source_registry` | Registered sources (URLs crawled per product per run) |
| `source_assertions` | Normalized claims — one per candidate, linking field+value+source |
| `source_evidence_refs` | Specific quotes/snippets backing each assertion |
| `key_review_state` | Two-lane AI review status per field per item |
| `key_review_runs` | LLM review execution records |
| `key_review_run_sources` | Which assertions were sent to the LLM as evidence |
| `key_review_audit` | Audit trail for all review actions |

### Evidence Lineage Chain

```
Pipeline crawl
  -> candidates (raw extraction store, denormalized source metadata)
       -> source_registry (one row per unique product+host+run)
            -> source_assertions (normalized claims; assertion_id = candidate_id)
                 -> source_evidence_refs (specific quotes + snippet IDs)

AI Review:
  key_review_state (acceptance status per field)
       -> key_review_runs (LLM execution records)
            -> key_review_run_sources (assertion_id links back to evidence)
```

The system uses `candidate_id = assertion_id` as a deliberate identity key so any layer can navigate the full lineage without additional lookups.

---

## Source Registry

### How Sources Are Registered

Every pipeline crawl registers sources in `source_registry`. Each row represents all candidates extracted from the same `(product_id, source_host, run_id)` combination.

**Source ID composition:** `{category}::{product_id}::{host}::{run_id}`

**Registration method:** `specDb.upsertSourceRegistry()` — uses `ON CONFLICT DO UPDATE` with `COALESCE` guards to never overwrite immutable fields with null.

**Fields tracked:**
- `source_url`, `source_host`, `source_root_domain` — the crawled URL
- `source_tier` — quality ranking (1=manufacturer, 2=lab/db, 3=review, 4=retailer)
- `source_method` — how it was fetched (`crawl`, `websearch`, `adapter`)
- `crawl_status`, `http_status`, `fetched_at`
- `run_id` — which pipeline run produced this source

### Source Assertions

Each candidate extracted during a crawl produces a `source_assertion` — a normalized claim from a source about a field value.

**Context kinds:**
- `scalar` — plain product spec field (e.g., `dpi_max`)
- `component` — component-typed field (e.g., sensor name); `context_ref` = component type
- `list` — list/enum field (e.g., connection type)

### Source Evidence Refs

Each assertion may have one or more evidence references — the specific quotes/snippets from web pages that back up the claim. Only candidates with a `quote` or `evidence_url` generate evidence refs.

---

## Data Lists (Enum Values)

### Definition

Data lists define the allowed vocabulary for enumerated fields. They originate from three places:

1. **Excel workbook** — `helper_files/{category}/{category}Data.xlsm`, sheet `data_lists`. Each column holds valid values for one enum field.
2. **Manual additions** — `workbook_map.json` → `manual_enum_values` array. These survive recompile.
3. **Pipeline suggestions** — `_suggestions/enums.json`. Values discovered by the extraction pipeline, awaiting user review.

### Compiled Outputs

- `helper_files/{category}/_generated/known_values.json` — snapshot of all list values, keyed by field name
- `field_rules.json` → `enum_buckets` section — per-field list values embedded alongside field contracts

### How Fields Reference Lists

In `field_rules.json`, each enum-backed field has:

```json
"enum": {
  "policy": "closed",
  "source": "data_lists.connection",
  "match": { "strategy": "alias" }
}
```

**Policies:** `open` (any value), `closed` (only listed values), `open_prefer_known`, `closed_with_curation`

The `source` string like `"data_lists.connection"` maps to `known_values.json → fields["connection"]`.

### List Value Propagation

When a list value is **added/accepted:**
1. `workbook_map.json` → `manual_enum_values[field]` gets the new value appended
2. `known_values.json` is patched in-place (no recompile needed)
3. Field rules cache is invalidated
4. SpecDb `list_values` table is updated via `upsertListValue()`
5. WebSocket broadcast notifies connected clients

When a list value is **removed:**
1. Value is filtered out of `workbook_map.json` and `known_values.json`
2. `cascadeEnumChange({ action: 'remove' })` runs:
   - Finds all affected products via `getProductsByFieldValue()` or filesystem scan
   - Clears stored values: `item_field_state.value = NULL`, `needs_ai_review = 1`
   - Removes list links from `item_list_links`
   - Rewrites each product's `normalized.json` on disk
   - Marks all affected products stale with `priority = 1` and `dirty_flags` entry `{ reason: 'enum_removed' }`

When a list value is **renamed:**
1. Both old and new values updated atomically in `workbook_map.json` and `known_values.json`
2. SpecDb transaction: deletes old `list_values` row, inserts new, updates `item_field_state.value` for all matching products, re-points `item_list_links` foreign keys
3. Rewrites affected `normalized.json` files
4. Marks products stale with `reason: 'enum_renamed'`

### List Candidates and Sources

List values carry source provenance identical to field candidates:

| Source | Meaning | Confidence | Color |
|---|---|---|---|
| `workbook` | From Excel `data_lists` sheet | 1.0 | green |
| `pipeline` (accepted) | Discovered by AI pipeline, user accepted | 1.0 | green |
| `manual` | User typed directly | 1.0 | green |
| `pipeline` (pending) | Pipeline found it, awaiting review | 0.6 | yellow |

Candidate objects for enum values carry evidence structured identically to field candidates:
```json
{
  "candidate_id": "wb_enum_connection_wired",
  "value": "wired",
  "score": 1.0,
  "source_id": "workbook",
  "source": "Excel Import",
  "method": "workbook_import",
  "evidence": { "url": "", "quote": "Imported from mouseData.xlsm" }
}
```

SpecDb enrichment provides per-value context:
- `getProductsForListValue(field, value)` — products linked via `item_list_links`
- `getCandidatesByListValue(field, listValueId)` — extraction candidates joined via list links

---

## Component Databases

### Definition

Components represent shared hardware entities referenced by multiple products. For the mouse category:

| Component Type | Examples | Variance-Controlled Properties |
|---|---|---|
| `sensor` | PAW3395, Focus Pro 45K | dpi (upper_bound), ips (upper_bound), acceleration (upper_bound) |
| `switch` | Omron D2FC-F-7N, Razer Gen-3 | click_force (override_allowed) |
| `encoder` | TTC Gold, Alps EC11 | encoder_steps |
| `material` | PTFE, Ceramic | — |

### Storage — Two Parallel Systems

**1. JSON-based compiled component DB** (`helper_files/{category}/_generated/component_db/`)
- `sensors.json`, `switches.json`, `encoders.json`, `materials.json`
- Each file contains `items[]` with: `name`, `maker`, `aliases[]`, `links[]`, `properties{}`, `__variance_policies{}`, `__constraints{}`

**2. SQLite SpecDb** (dual-write runtime store)
- `component_identity` — canonical name, maker, links, review status
- `component_aliases` — alternative name strings
- `component_values` — property key/value pairs with `variance_policy` and `constraints`

### How Fields Reference Components

In `field_rules.json`, component-backed fields have:

```json
"component": {
  "type": "sensor",
  "source": "component_db.sensor",
  "require_identity_evidence": true,
  "match": { "fuzzy_threshold": 0.75, "auto_accept_score": 0.95 }
}
```

The `normalizeFieldContract()` function exposes `component_type` from `rule.component.type` for the review grid UI.

### Variance Policies

The variance evaluator (`src/review/varianceEvaluator.js`) implements 5 enforcement policies:

| Policy | Behavior | Action on Component Value Change |
|---|---|---|
| `null`/missing | No enforcement | Stale-marking only |
| `override_allowed` | Any product value permitted | Stale-marking only |
| `authoritative` | Exact match required (case-insensitive) | **Value pushed directly** into all linked products |
| `upper_bound` | Product value must be <= component value | Violations flagged `needs_ai_review=1` |
| `lower_bound` | Product value must be >= component value | Violations flagged `needs_ai_review=1` |
| `range` | Product value within +/-10% of component value | Violations flagged `needs_ai_review=1` |

**Skip logic:** `null`, `unk`, `n/a`, and other sentinel values skip enforcement with reason `skipped_missing_value`.

**Numeric normalization:** Strips commas (`"26,000"` -> `26000`) and trailing units (`"26000dpi"` -> `26000`).

### Component Value Change Propagation

When a component property value changes (via `POST /review-components/{cat}/component-override`), `cascadeComponentChange()` in `componentImpact.js` orchestrates propagation:

**Step 1 — Find affected products:**
- Primary: queries `item_component_links` by `(componentType, componentName, componentMaker)`
- Fallback: queries `item_field_state` for value matches, or scans `normalized.json` files

**Step 2 — Policy-specific propagation:**

For **authoritative** properties:
- `pushAuthoritativeValueToLinkedProducts()` **overwrites** `item_field_state.value` for ALL linked products
- Sets `confidence=1.0`, `source='component_db'`, `needs_ai_review=0`
- Rewrites each product's `normalized.json` on disk
- Marks products stale with `priority=1`

For **upper_bound / lower_bound / range** properties:
- `evaluateAndFlagLinkedProducts()` checks each product's current value vs. new component value
- Sets `needs_ai_review=1` for violating products, `needs_ai_review=0` for compliant ones
- Marks products stale with `priority=2`

For **override_allowed** or **null** properties:
- No propagation — any product value is acceptable

**Step 3 — Constraint evaluation (additional, always runs):**
- `evaluateConstraintsForLinkedProducts()` evaluates cross-field constraint expressions (e.g., `"sensor_date <= release_date"`)
- Constraint violations set `needs_ai_review=1` and bump queue priority by +1

**Step 4 — SpecDb dual-write:**
- Component's own `component_values` row upserted with `source='user'`, `overridden=true`
- On revert: `source='component_db'`, `overridden=false`

### Component Candidates and Sources

Component properties draw candidates from three source tiers:

1. **Workbook** (`source_id: 'workbook'`) — values from compiled Excel sheets. Score=1.0, highest trust.
2. **Pipeline** (`source_id: 'pipeline'`) — values seen on real products during extraction runs. Score=0.5-0.6.
3. **SpecDb** (`source_id: 'specdb'`) — candidates from the SQLite `candidates` table, joined through `item_component_links`.

When variance policies exist and linked products are found, `evaluateVarianceBatch()` checks actual `item_field_state` values. Violations get `reason_codes: ['variance_violation']` and a `variance_violations` object showing offending products.

---

## Two-Lane AI Review Model

### Architecture

Every field value on every product has two independent AI review lanes tracked in `key_review_state`:

| Lane | Color | Scope | Badge |
|---|---|---|---|
| **Primary** (Item) | Teal | Per-product field value correctness | Teal "AI" pill |
| **Shared** (Component/Enum) | Purple | Component DB or enum list consistency | Purple "AI" pill |

### How Lanes Are Determined

**Primary lane** applies to ALL fields on all products. When no `key_review_state` row exists (AI review never ran), the field is treated as `pending`.

**Shared lane** applies only to fields that have a component or enum connection, determined by the field contract:
- `field_rule.component_type` is set (e.g., `"sensor"`, `"switch"`)
- `field_rule.enum_source` is set (e.g., `"data_lists.connection"`)
- `field_rule.enum_name` is set

### State Machine

Each lane independently tracks:
- `ai_confirm_*_status`: `'pending'` | `'confirmed'` | `'rejected'` | `'not_run'`
- `ai_confirm_*_confidence`: 0.0-1.0
- `user_accept_*_status`: `'accepted'` | null
- `user_override_ai_*`: boolean

A field's AI badge disappears when either:
- The lane status is confirmed/rejected (AI has reviewed)
- The user has accepted the lane result
- The user has overridden the AI for that lane

### Review Grid Display

In the review matrix, each cell shows:
- **Teal dot + teal "AI" badge** when primary lane is pending
- **Purple dot + purple "AI" badge** when shared lane is pending
- **Both badges** when both lanes are pending (common for component/enum fields before any AI review)
- Normal traffic-light coloring when no lanes are pending

### Drawer (Cell Detail Panel)

When a cell is clicked, the drawer shows:
- **Current Value section**: Teal banner "Item AI Review: Pending" with Confirm/Accept buttons; purple banner "Shared AI Review: Pending" with Confirm/Accept buttons
- **Candidates section**: Teal "Run AI Review" button (runs review for all candidates); each candidate card has a teal "Confirm AI" button
- Actions are wired to `POST /review/{cat}/key-review-confirm` and `POST /review/{cat}/key-review-accept`

### API Endpoints

**`POST /review/{cat}/key-review-confirm`**
- Body: `{ id: number, lane: 'primary' | 'shared' }`
- Updates `ai_confirm_*_status = 'confirmed'`, `ai_confirm_*_confidence = 1.0`
- Inserts audit entry, broadcasts WebSocket update

**`POST /review/{cat}/key-review-accept`**
- Body: `{ id: number, lane: 'primary' | 'shared' }`
- Updates `user_accept_*_status = 'accepted'`
- Inserts audit entry, broadcasts WebSocket update

---

## API Endpoints Summary

### Product Review

| Method | Endpoint | Description |
|---|---|---|
| GET | `/review/{cat}/products-index` | Products with field states + keyReview enrichment |
| GET | `/review/{cat}/candidates/{pid}/{field}` | Candidates for a specific field + keyReview state |
| POST | `/review/{cat}/override` | User override of a field value |
| POST | `/review/{cat}/finalize-all` | Mark all overrides as finalized |
| POST | `/review/{cat}/key-review-confirm` | Confirm AI review for a lane |
| POST | `/review/{cat}/key-review-accept` | Accept AI review for a lane |

### Component Review

| Method | Endpoint | Description |
|---|---|---|
| GET | `/review-components/{cat}/component-review` | Component review payloads with variance evaluation |
| POST | `/review-components/{cat}/component-override` | Override a component property value (triggers cascade) |
| GET | `/review-components/{cat}/enum-review` | Enum/list review payloads |
| POST | `/review-components/{cat}/enum-override` | Add/remove a list value (triggers cascade) |
| POST | `/review-components/{cat}/enum-rename` | Rename a list value (triggers cascade) |

---

## File Layout

### Generated Artifacts

```
helper_files/{category}/_generated/
  field_rules.json           # Master field contract (100+ fields)
  field_rules.runtime.json   # Runtime copy
  known_values.json          # Compiled enum values
  component_db/
    sensors.json             # Compiled sensor database
    switches.json            # Compiled switch database
    encoders.json            # Compiled encoder database
    materials.json           # Compiled material database
  cross_validation_rules.json
  parse_templates.json
  field_groups.json
  manifest.json
```

### Runtime Data

```
{category}/spec.sqlite       # SpecDb — all tables above
helper_files/{category}/
  _suggestions/enums.json    # Pipeline-suggested enum values
  _overrides/                # User overrides per product/component
  _control_plane/
    workbook_map.json        # Excel column mappings + manual additions
```

### Per-Product Outputs

```
out/runs/{category}/{productId}/{runId}/
  raw/pages/{host}/          # Crawled HTML
  raw/network/{host}/        # Network capture
  extracted/{host}/          # Extracted candidates
  normalized/                # Winning values
  provenance/                # Source tracking
  logs/                      # Run events + summary
out/final/{category}/{brand}/{model}/
  spec.json                  # Final spec
  provenance.json            # Full provenance
  evidence/evidence_pack.json
```
