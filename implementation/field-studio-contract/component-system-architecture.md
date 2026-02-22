# Component System Architecture

Comprehensive developer guide for the Spec Factory component configuration, matching, and review system.

---

## 1. What Is a Component?

A **component** is a discrete, identifiable sub-part of a product that has its own identity, maker, and measurable properties. Examples:

- **Sensor** (mouse): PixArt PAW3950, Razer Focus Pro 4K — with properties like DPI, IPS, acceleration
- **Switch** (mouse/keyboard): Omron D2F-01F, Razer Gen-3 Optical — with properties like actuation force, lifespan, travel distance
- **Encoder** (mouse): TTC Gold, Alps Alpine — with properties like steps per rotation, detent type
- **Material** (any): PTFE, glass, ceramic — with properties like friction coefficient, durability

Components differ from regular fields because:
- They have a **canonical identity** (type + name + maker) in a shared database
- Multiple products can reference the **same** component
- Component properties create **variance relationships** with product-level field values (e.g., a sensor's max DPI is an upper bound for the product's DPI)
- Changes to a component cascade to all products that reference it

---

## 2. Configuration Flow

```
Mapping Studio (GUI)
    ↓  component sources, property mappings, variance policies
Field Rules Compiler (src/field-rules/compiler.js)
    ↓  compileRules() → field_rules.json, component_db/*.json
Generated Artifacts (helper_files/<category>/_generated/)
    ↓  field_rules.json, component_db/<type>.json, known_values.json
Field Rules Loader (src/field-rules/loader.js)
    ↓  loadFieldRules() → in-memory rules + indexed component DB
SpecDb Seeder (src/db/seed.js)
    ↓  seedComponents() → component_identity, component_aliases, component_values
Review Grid (src/review/componentReviewData.js)
    ↓  buildComponentReviewPayloads() → lane payloads for GUI
```

### Mapping Studio
The Mapping Studio tab in Field Studio defines component sources. Each component source specifies:
- **Component type** (sensor, switch, encoder, material)
- **Property mappings** — which field keys map to which component properties, with variance policies
- **AI Assist + Priority** — component-level AI configuration for future Component Review tab LLM reviews (kept for future wiring)

### Compiler
`compileRules()` in `src/field-rules/compiler.js` reads the workbook map and component source definitions, generates `component_db/<type>.json` files containing all known entities with their names, makers, aliases, and property values. It also embeds component match settings into `field_rules.json` for each component reference field.

### Loader
`loadFieldRules()` in `src/field-rules/loader.js` reads the generated artifacts and builds fast lookup indexes:
- `__index` — primary O(1) lookup by normalized token (name or alias)
- `__indexAll` — returns all matches for a token (handles ambiguous names)
- Component DB is cached per category and invalidated on edits via `invalidateFieldRulesCache()`

### SpecDb Seed
`seedComponents()` in `src/db/seed.js` populates three tables:
- `component_identity` — canonical (type, name, maker) rows
- `component_aliases` — alternative names for fuzzy matching
- `component_values` — property values per component (field_key, value, unit)

---

## 3. Property Link System

Component properties create **variance relationships** between the component DB value and the product-level extracted value. This is configured per property mapping in the Mapping Studio.

### Variance Policies

| Policy | Meaning | Example |
|--------|---------|---------|
| `authoritative` | Component value IS the product value (default) | Sensor name → product sensor field |
| `upper_bound` | Component gives the maximum possible value | Sensor max DPI → product DPI cannot exceed this |
| `lower_bound` | Component gives the minimum value | Switch minimum actuation force |
| `range` | Component provides a reference range (±tolerance) | Weight within ±5g of component spec |
| `override_allowed` | Component is the default, but product can override | Default polling rate, product may differ |

### Type-Policy Guard

The compiler enforces that `upper_bound`, `lower_bound`, and `range` policies are only valid for `type: 'number'` properties. String/enum properties are automatically coerced to `authoritative` with a compile warning. This prevents silent scoring failures where numeric comparison is attempted on non-numeric values (e.g., `parseFloat("tactile")` → `NaN` → skipped).

### Tolerance

Numeric tolerance for `upper_bound`, `lower_bound`, and `range` policies. E.g., `tolerance: 5` means ±5 from the component value is acceptable.

### Storage

Property links are stored in `field_rules.json` under each component reference field's `component.match.property_keys` array. The variance policy and tolerance are stored per property mapping in the component source definition.

### Constraint Evaluation

`src/engine/constraintEvaluator.js` evaluates cross-field constraints including component-derived constraints (e.g., `component_release_date <= product_release_date`). Violations are flagged during extraction and review.

---

## 4. Match Settings Reference

Match settings control how extracted component names are matched to the canonical component DB. All settings live under `component.match` in the field rule.

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `fuzzy_threshold` | 0.75 | Minimum string similarity (0-1) for fuzzy match candidacy |
| `name_weight` | 0.4 | Weight of name similarity in the combined score |
| `property_weight` | 0.6 | Weight of property comparison in the combined score |
| `auto_accept_score` | 0.95 | Combined score above this = auto-accept without review |
| `flag_review_score` | 0.65 | Combined score above this = flagged for review |
| `property_keys` | (auto-derived) | Field keys to compare against component DB properties. Auto-derived from Mapping Studio `component_sources[].roles.properties[].field_key`. Authored keys in `field_rules_draft.json` take precedence as an explicit override. |

### UI Grouping

Match settings are grouped in the Key Navigator and WorkbenchDrawer:

- **Name Matching**: Fuzzy Threshold, Name Weight, Auto-Accept Score, Flag Review Score
- **Property Matching**: Property Weight, Property Keys (read-only derived chips with variance policy badges)

Property Keys are displayed as read-only chips derived from the Mapping Studio's `component_sources` configuration. Each chip shows the field key and its variance policy (e.g., `dpi [upper_bound]`).

### Scoring Formula

```
combined_score = (name_similarity × name_weight) + (property_match × property_weight)
```

Where:
- `name_similarity` = fuzzy string similarity (0-1) between extracted name and canonical name/aliases
- `property_match` = variance-aware numeric comparison across all `property_keys`

### Decision Tree

```
extracted_name → fuzzy match against component DB
    ↓
similarity < fuzzy_threshold → REJECT (no match candidate)
    ↓
combined_score ≥ auto_accept_score → AUTO-ACCEPT (confirmed match)
    ↓
combined_score ≥ flag_review_score → FLAG FOR REVIEW (provisional match)
    ↓
combined_score < flag_review_score AND allow_new_components → SUGGEST NEW COMPONENT
    ↓
combined_score < flag_review_score AND !allow_new_components → REJECT
```

### Boolean Flags

| Flag | Default | Description |
|------|---------|-------------|
| `allow_new_components` | true | Allow suggesting new components not in the DB |
| `require_identity_evidence` | true | Require evidence from at least one source for identity matching |

---

## 5. Review Grid Integration

`src/review/componentReviewData.js` builds review lane payloads for the Component Review tab in the GUI.

### How Lanes Are Built

`buildComponentReviewPayloads()` generates one review lane per unique component row (type + name + maker). Each lane contains:
- **Identity slots** (`__name`, `__maker`) — candidates for the component's name and maker
- **Property slots** — candidates for each mapped property key
- **Link slots** (`__links`) — which products reference this component
- **Alias slots** (`__aliases`) — alternative names

### Candidate Aggregation Rule

All slot types use the **same** aggregation logic. For a component row K = (type, name, maker) with N linked products:

```
C(K, F) = sum over all linked products of (candidate rows where product_id = P and field_key = F)
```

No slot type gets special treatment. Every slot aggregates candidates from all linked products uniformly.

### Lane State

Lane state (pending/accepted/confirmed) is tracked in `key_review_state` via `src/review/keyReviewState.js`. The lane key is the canonical component identifier: `type::name::maker`.

---

## 6. Component Change Cascade

When a component's properties change, `src/review/componentImpact.js` handles the cascade.

### cascadeComponentChange()

1. `findProductsReferencingComponent()` finds all products that reference the changed component (SpecDb query, filesystem fallback)
2. For each affected product, evaluates the variance policy:
   - `authoritative` — pushes the new value directly to the product
   - `upper_bound` / `lower_bound` / `range` — evaluates whether the product's current value violates the new bound
3. Marks affected products as **stale** with appropriate priority
4. Dirty flags trigger re-extraction on the next pipeline run

### cascadeEnumChange()

When an enum value is renamed or removed:
1. Updates all product `normalized.json` files
2. Marks products stale with highest priority (1)

---

## 7. AI Configuration

The component system has three distinct AI configuration surfaces:

### Field-Level AI Assist (Active)
Lives under `ai_assist` in each field rule. Drives the extraction pipeline:
- `mode` — off / advisory / planner / judge
- `model_strategy` — auto / force_fast / force_deep
- `max_calls`, `max_tokens` — budget controls
- `reasoning_note` — extraction guidance injected into LLM prompts

When a field has `component.type` set, the auto-generated extraction guidance automatically includes component context (e.g., "Component ref (sensor). Match to known names/aliases.").

### Mapping Studio Component AI (Kept for Future Use)
Lives in `EditableComponentSource` in the Mapping Studio tab. Contains:
- AI Assist mode/model/calls/tokens
- AI Review Priority difficulty/effort/reasoning_note

These settings will be wired to component-level LLM reviews in the Component Review tab in a future task. They are **kept as-is** and are not dead code.

### Key Navigator component.ai (Removed — Dead Code)
Previously lived under `component.ai` in the Key Navigator's component section:
- `mode`, `model_strategy`, `context_level`, `reasoning_note`

These were compiled into artifacts but **never consumed at runtime**. The `reasoning_note` field was read by `fieldRulesEngine.js` (lines 1070, 1096) but was always empty (`""`) in all existing data. The auto-generated guidance from field-level AI Assist already provides component context. These settings were removed from the Key Navigator UI as dead code.

### Key Navigator component.priority (Removed — Dead Code)
Previously lived under `component.priority` in the Key Navigator:
- `difficulty`, `effort`

The field already has top-level `priority.difficulty` and `priority.effort` which ARE consumed by the pipeline. The component-level duplicates were compiled but never read. Removed as dead code.

---

## 8. Mapping Studio Role

The Mapping Studio tab serves two purposes:

### Structural Setup
- Define component **type** (sensor, switch, encoder, material)
- Define **roles** (which fields are component references)
- Configure **property mappings** (field key → component property, with variance policy and tolerance)
- Set **match settings** (fuzzy threshold, weights, accept/review scores)

### Component-Level AI Configuration
- AI Assist settings (mode, model, budget) per component source
- AI Review Priority (difficulty, effort) per component source
- Reasoning note for component-level extraction guidance

These AI settings are distinct from field-level `ai_assist` and will drive component-level LLM reviews in the Component Review tab. They allow per-component-type AI behavior (e.g., sensor matching might use `judge` mode while material matching uses `advisory`).

---

## 9. IndexLab Connection

Component reference fields participate in the IndexLab extraction pipeline like any other field:

### NeedSet
Component reference fields generate NeedSet scores based on the same formula as all fields. Their `required_level`, `difficulty`, and `effort` drive the need score. Identity fields (component refs marked as `identity`) get the highest priority.

### Search & Discovery
Query terms from `search_hints` drive discovery. Component names and aliases are used as search terms when the field has high need.

### Extraction
During LLM extraction, the extraction context includes component DB context when `component.type` is set. The AI receives the list of known components and is instructed to match against them. The `ai_assist.reasoning_note` (or auto-generated guidance) provides component-specific instructions.

### Evidence & Retrieval
Component reference fields use the same tier-aware retrieval system. Tier preferences from `evidence.tier_preference` control which sources are preferred for component identification.

No changes were made to any IndexLab, pipeline, or runtime code as part of this cleanup.

---

## 10. Key Source Files

| File | Purpose |
|------|---------|
| `src/field-rules/compiler.js` | Compiles workbook → field_rules.json, component_db/*.json |
| `src/field-rules/loader.js` | Loads artifacts, builds component DB indexes (__index, __indexAll) |
| `src/db/seed.js` | Seeds SpecDb: component_identity, component_aliases, component_values |
| `src/db/specDb.js` | SQLite schema, component table definitions, query helpers |
| `src/review/componentReviewData.js` | Builds component/enum review lane payloads |
| `src/review/keyReviewState.js` | Lane state upsert/update for key_review_state |
| `src/review/componentImpact.js` | Cascade logic: component changes → product staleness |
| `src/utils/componentIdentifier.js` | Canonical key: `type::name::maker` |
| `src/engine/constraintEvaluator.js` | Cross-field constraint evaluation (including component constraints) |
| `tools/gui-react/src/pages/studio/StudioPage.tsx` | Key Navigator component settings UI |
| `tools/gui-react/src/pages/studio/workbench/WorkbenchDrawer.tsx` | Workbench Deps tab component settings |
| `tools/gui-react/src/pages/studio/studioConstants.ts` | STUDIO_TIPS tooltip text for all component settings |
| `tools/gui-react/src/pages/component-review/ComponentSubTab.tsx` | Component review table rendering |
| `tools/gui-react/src/pages/component-review/ComponentReviewDrawer.tsx` | Component review candidate actions |
