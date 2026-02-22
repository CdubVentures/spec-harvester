# Zustand Field Rules Store — Data Flow Reference

This document is the single source of truth for how field rules data flows between the Zustand store (frontend), the API server (backend), and the draft file on disk. Any developer working with field order, field labels, group headers, or field rule properties must read this first.

---

## Architecture Overview

```
                   ┌──────────────────────────────────────────────┐
                   │  DISK (source of truth for persistence)      │
                   │                                              │
                   │  helper_files/{cat}/_control_plane/           │
                   │    field_rules_draft.json                    │
                   │    { fields: {...}, fieldOrder: [...] }      │
                   └──────────────┬───────────────────────────────┘
                                  │
                     ┌────────────┼────────────────┐
                     │ READ       │ WRITE           │
                     ▼            │                 ▼
        ┌────────────────────┐   │   ┌───────────────────────────┐
        │  GET endpoints     │   │   │  POST /studio/{cat}/      │
        │  (merge compiled   │   │   │       save-drafts         │
        │   + draft)         │   │   │  (shallow merge to disk)  │
        └────────┬───────────┘   │   └───────────┬───────────────┘
                 │               │               │
                 ▼               │               │
        ┌────────────────────┐   │   ┌───────────────────────────┐
        │  React Query       │   │   │  saveDraftsMut.mutate()   │
        │  cache layer       │   │   │  in StudioPage.tsx        │
        │  (per query key)   │   │   │  reads store.getSnapshot()│
        └────────┬───────────┘   │   └───────────┬───────────────┘
                 │               │               │
                 ▼               │               ▼
        ┌─────────────────────────────────────────────────────────┐
        │  useFieldRulesStore (Zustand)                           │
        │                                                         │
        │  editedRules      — deep copy of merged rules           │
        │  editedFieldOrder — includes __grp:: markers            │
        │  pendingRenames   — { oldKey: newKey }                  │
        │  initialized      — true after hydrate()                │
        │                                                         │
        │  Hydrated from: GET /studio/{cat}/payload               │
        │  Saved via:     POST /studio/{cat}/save-drafts          │
        └─────────────────────────────────────────────────────────┘
                 │
    ┌────────────┼─────────────────────────────────┐
    │            │                                  │
    ▼            ▼                                  ▼
 Studio       Studio                     Studio read-only
 Keys Tab     Contract Tab               consumers
 (read/write) (read/write)              (MappingStudioTab,
                                         ConstraintEditor,
                                         EditableComponentSource)
```

---

## The Zustand Store

**File**: `tools/gui-react/src/pages/studio/useFieldRulesStore.ts`

### State

| Field | Type | Description |
|-------|------|-------------|
| `editedRules` | `Record<string, Record<string, unknown>>` | All field rules, keyed by field key. Deep copy of server data. |
| `editedFieldOrder` | `string[]` | Ordered list of field keys AND group markers (`__grp::GroupName`). |
| `pendingRenames` | `Record<string, string>` | Map of `{ oldKey: newKey }` for unsaved renames. |
| `initialized` | `boolean` | `true` after `hydrate()` is called. |

### Group Markers in `editedFieldOrder`

Groups are encoded as positional markers in the field order array:

```
[
  "__grp::Identity",     ← group header marker
  "brand",               ← belongs to "Identity" group
  "model",               ← belongs to "Identity" group
  "__grp::Performance",  ← group header marker
  "dpi_max",             ← belongs to "Performance" group
  "polling_rate",        ← belongs to "Performance" group
  "weight_grams"         ← belongs to "Performance" group (last marker wins)
]
```

**Rule**: A field belongs to the group of the nearest preceding `__grp::` marker. Fields before any marker are "ungrouped".

### Actions

| Action | What it does | Auto-saves? |
|--------|-------------|-------------|
| `hydrate(rules, fieldOrder)` | Seeds store from API data. Strips `_edited` flags. Sets `initialized = true`. | No |
| `rehydrate(rules, fieldOrder)` | Same as hydrate but for re-seeding after refetch. Strips `_edited` flags. | No |
| `reset()` | Clears all state, sets `initialized = false`. | No |
| `clearRenames()` | Clears `pendingRenames` only. Called after successful save. | No |
| `updateField(key, path, value)` | Sets a nested value on a rule. Runs coupling logic (see below). Marks `_edited = true`. | No — caller must call `save()` |
| `addKey(key, rule, afterKey?)` | Adds a new field key to rules and fieldOrder. Syncs positional groups. | No — caller must call `save()` |
| `removeKey(key)` | Removes a key from both rules and fieldOrder. | No — caller must call `save()` |
| `renameKey(old, new, ...)` | Renames a key in rules, fieldOrder, and all constraint references. Updates `ui.label` and `display_name`. Records in `pendingRenames`. | No — caller must call `save()` |
| `bulkAddKeys(entries)` | Batch adds multiple keys. Syncs positional groups. | No — caller must call `save()` |
| `reorder(active, over)` | Moves a field or group marker in fieldOrder. Syncs positional groups. | No — caller must call `save()` |
| `addGroup(name)` | Prepends `__grp::name` to fieldOrder. Syncs positional groups. | No — caller must call `save()` |
| `removeGroup(name)` | Removes `__grp::name` marker. Sets affected rules' group to "ungrouped". | No — caller must call `save()` |
| `renameGroup(old, new)` | Renames `__grp::` marker and all affected rules' `ui.group`. | No — caller must call `save()` |
| `getSnapshot()` | Returns `{ rules, fieldOrder, renames }` for the save mutation. | N/A |

### Field Coupling Logic (`applyFieldCoupling`)

When `updateField` is called, the `applyFieldCoupling` function automatically cascades related changes. Examples:

- Setting `parse.template = 'boolean_yes_no_unk'` also sets `enum.policy = 'closed'`, `enum.source = 'yes_no'`, `ui.input_control = 'text'`
- Setting `contract.type` also mirrors to flat `rule.type` and `rule.data_type`
- Setting `ui.group` also mirrors to flat `rule.group`
- Setting `priority.required_level` derives `ai_assist.reasoning_note`

### `_edited` Flag

- Set to `true` by `applyFieldCoupling` when any field property changes
- Displayed as a yellow/amber left border in `DraggableKeyList`
- **Stripped on hydrate/rehydrate** — the store starts clean, no false indicators
- **NOT set** by `syncGroupsFromOrder` — positional group sync does not mark rules as edited
- The save mutation sends ALL rules regardless of `_edited` — it's purely a UI indicator

### `syncGroupsFromOrder` (internal)

Called by `reorder`, `addKey`, `addGroup`, `bulkAddKeys`. Walks `editedFieldOrder` and updates each rule's `ui.group` and flat `group` to match the nearest preceding `__grp::` marker. Does NOT set `_edited`.

---

## Data Flow: Hydration (Page Load)

```
1. StudioPage mounts
2. React Query fetches GET /studio/{cat}/payload
3. Server reads:
   a. loadCategoryConfig(category) → compiled rules + field order
   b. safeReadJson(field_rules_draft.json) → draft rules + field order
   c. Deep-merges: compiled ← draft (draft wins per field, UI merged separately)
   d. Returns: { fieldRules: merged, fieldOrder: draftOrder || compiledOrder }
4. StudioPage receives data:
   const rules = studio?.fieldRules || {};
   const fieldOrder = studio?.fieldOrder || Object.keys(rules);
5. useEffect hydrates the store:
   if (Object.keys(rules).length > 0 && !store.initialized) {
     store.hydrate(rules, fieldOrder);
   }
6. All Studio tabs read from store:
   const storeRules = store.initialized ? store.editedRules : rules;
   const storeFieldOrder = store.initialized ? store.editedFieldOrder : fieldOrder;
```

---

## Data Flow: Save

```
1. User clicks Save (or action triggers saveFromStore)
2. saveFromStore() reads store.getSnapshot()
   → { rules: editedRules, fieldOrder: editedFieldOrder, renames: pendingRenames }
3. POST /studio/{cat}/save-drafts with:
   {
     fieldRulesDraft: { fields: rules, fieldOrder: fieldOrder },
     renames: { oldKey: newKey, ... }
   }
4. Server merges into existing draft file on disk
5. onSuccess:
   a. store.clearRenames() — clears pendingRenames only (does NOT reset store)
   b. Invalidates React Query keys:
      - studio-drafts, studio (re-fetches → re-hydrates store)
      - reviewLayout (Review Grid refetches layout)
      - product (Product pages refetch)
      - componentReview, enumReview (Component Review refetches)
      - fieldLabels (label display refetches)
```

---

## Who Subscribes to the Store

### Direct store imports (read + write)

| Component | File | What it reads | What it writes |
|-----------|------|---------------|----------------|
| StudioPage | `StudioPage.tsx` | `initialized`, `editedRules`, `editedFieldOrder` | `hydrate()`, `clearRenames()`, `getSnapshot()` |
| KeyNavigatorTab | `StudioPage.tsx` (inline) | `editedRules`, `editedFieldOrder`, `pendingRenames` | `updateField`, `addKey`, `removeKey`, `renameKey`, `reorder`, `addGroup`, `removeGroup`, `renameGroup`, `bulkAddKeys` |
| FieldRulesWorkbench | `workbench/FieldRulesWorkbench.tsx` | `editedRules`, `editedFieldOrder` | `updateField` |
| WorkbenchDrawer | `workbench/WorkbenchDrawer.tsx` | (none directly) | `updateField` |

### Indirect consumers (via props from StudioPage)

| Component | Props received | Source |
|-----------|---------------|--------|
| MappingStudioTab | `rules={storeRules}`, `fieldOrder={storeFieldOrder}` | Store (via StudioPage) |
| ConstraintEditor | `productOptions` filtered from `storeFieldOrder` | Store (via StudioPage) |
| KeyConstraintEditor | `compatible` filtered from `storeFieldOrder` | Store (via StudioPage) |
| EditableComponentSource | `fieldKeyGroups` from `storeFieldOrder` | Store (via StudioPage) |

All indirect consumers filter out `__grp::` markers before use.

---

## API Endpoints — Complete Map

### Endpoints that read draft data (CORRECT)

| Endpoint | Draft field order? | Draft field rules? | Notes |
|----------|:-:|:-:|-------|
| `GET /studio/{cat}/payload` | Yes | Yes | Deep-merges compiled + draft. Source of hydration data. |
| `GET /studio/{cat}/drafts` | Yes | Yes | Returns raw draft file contents. |
| `GET /review/{cat}/layout` | Yes | Yes | Calls `buildReviewLayout` with both overrides. Derives positional groups from `__grp::` markers. |
| `GET /review/{cat}/product/{pid}` | Yes | Yes | Builds layout with draft overrides, passes to `buildProductReviewPayload`. |
| `GET /review/{cat}/products` | Yes | Yes | Builds shared layout once with draft overrides, passes to each product payload. |
| `GET /field-labels/{cat}` | Yes | Yes | Merges draft labels over compiled. Filters `__grp::` from field order. |
| `GET /review-components/{cat}/components` | Yes | No | Reorders property columns by draft field order. Filters `__grp::`. |
| `GET /review-components/{cat}/enums` | Yes | No | Reorders enum fields by draft field order. Filters `__grp::`. |
| `GET /summary/{cat}/product/{pid}` | Yes | No | Returns draft field order (filtered). |
| `getReviewFieldRow()` (helper) | Yes | Yes | Internal helper. 15-second cache. Both overrides. |

### Write endpoint

| Endpoint | What it writes |
|----------|---------------|
| `POST /studio/{cat}/save-drafts` | Shallow-merges `fieldRulesDraft` into `field_rules_draft.json`. Writes `renames` to `pending_renames.json`. Broadcasts `data-change` WS event. |

---

## How Group Headers Work (End to End)

### In Studio (Frontend — Zustand store)

1. Groups are `__grp::GroupName` markers in `editedFieldOrder`
2. `deriveGroupsTs(editedFieldOrder, editedRules)` walks the array and builds group → keys mapping for the DraggableKeyList
3. `syncGroupsFromOrder` keeps each rule's `ui.group` in sync with its positional `__grp::` marker
4. Group add/remove/rename/reorder all modify the `__grp::` markers in `editedFieldOrder`

### On Save (Store → Disk)

1. `getSnapshot()` returns `editedFieldOrder` (with `__grp::` markers) and `editedRules` (with synced `ui.group`)
2. Both are written to `field_rules_draft.json`

### In Review Grid (Backend → Frontend)

1. `GET /review/{cat}/layout` → `buildReviewLayout()`
2. `buildReviewLayout` walks `fieldOrderOverride` to build `positionalGroupMap`:
   ```
   for each item in fieldOrderOverride:
     if starts with '__grp::' → currentGroup = item.slice(7)
     else → positionalGroupMap[normalizeField(item)] = currentGroup
   ```
3. Each row gets: `group: positionalGroupMap[key] || ui.group`
4. Positional groups from `__grp::` markers TAKE PRECEDENCE over `ui.group` from rule properties
5. ReviewPage renders group headers by detecting `row.group` changes between consecutive rows

### In Product Page (Backend → Frontend)

1. `GET /review/{cat}/product/{pid}` builds layout with draft overrides
2. Layout rows have correct groups from positional derivation
3. Field values are keyed by field key, ordered by layout row order

### In Field Labels (Backend → Frontend)

1. `GET /field-labels/{cat}` merges draft `ui.label` over compiled labels
2. `useFieldLabels(category)` hook caches with 5-minute staleTime
3. Invalidated on save-drafts and compile completion

---

## React Query Cache Invalidation Map

When save-drafts succeeds, these query keys are invalidated:

| Query Key | What refetches | Why |
|-----------|---------------|-----|
| `['studio-drafts', category]` | Raw draft file | Store may need re-seed |
| `['studio', category]` | Studio payload (compiled + draft merge) | Re-hydrates store |
| `['reviewLayout', category]` | Review Grid layout (field order + groups + labels) | Groups/order may have changed |
| `['product', category]` | Product page data | Field order may have changed |
| `['componentReview', category]` | Component Review items | Field order may have changed |
| `['enumReview', category]` | Enum Review items | Field order may have changed |
| `['fieldLabels', category]` | Label map for all pages | Labels may have changed |

When compile completes (process exit), these additional keys are also invalidated:

| Query Key | What refetches | Why |
|-----------|---------------|-----|
| `['studio-known-values', category]` | Known enum values | Compile regenerates |
| `['studio-component-db', category]` | Component DB | Compile regenerates |
| `['catalog', category]` | Product catalog | Compile may update |
| `['reviewProductsIndex', category]` | Review queue | Compile may update scores |
| `['componentReviewLayout', category]` | Component type layout | Compile may update |
| `['enumReviewData', category]` | Enum review data | Compile may update |

---

## Common Pitfalls

### 1. Filtering `__grp::` markers

Any code that iterates `editedFieldOrder` for field key purposes MUST filter out `__grp::` markers:

```typescript
// WRONG — includes group markers
const keys = editedFieldOrder;

// CORRECT
const keys = editedFieldOrder.filter(k => !k.startsWith('__grp::'));
```

Locations that already do this:
- `buildWorkbenchRows` in `workbenchHelpers.ts`
- `ConstraintEditor.productOptions` in `StudioPage.tsx`
- `KeyConstraintEditor.compatible` in `StudioPage.tsx`
- `EditableComponentSource.fieldKeyGroups` in `StudioPage.tsx`
- `buildReviewLayout.fieldSource` in `reviewGridData.js`
- All server endpoints that pass `fieldOrderOverride` to component/enum reviews

### 2. `_edited` flag persistence

The draft file on disk may contain `_edited: true` on rules from prior saves. The store's `hydrate()` and `rehydrate()` strip this flag so the UI starts clean. If you add a new hydration path, you must also strip `_edited`.

### 3. Shallow vs deep merge on save

`POST /studio/{cat}/save-drafts` does a SHALLOW merge: `{ ...existing, ...body.fieldRulesDraft }`. This means sending `{ fields: {...} }` replaces the entire `fields` object. The store's `getSnapshot()` always sends the complete state, so this is safe. But if you build a custom save call, be aware of this.

### 4. Store persistence across tab switches

The Zustand store persists across Studio tab switches (Keys → Contract → Mapping → etc.). This is the primary reason it exists — local `useState` was destroyed on tab switch because tabs conditionally render. The store is NOT persisted across page navigation (e.g., leaving Studio entirely). On return, the store re-hydrates from the API.

### 5. Adding a new consumer

If you add a new page or component that needs field order, labels, or groups:

- **Inside Studio page**: Import `useFieldRulesStore` directly or receive store data via props from StudioPage.
- **Outside Studio page**: Use the appropriate API endpoint. The endpoint already merges draft data. Use the correct React Query key so it's invalidated on save.
- **New API endpoint**: Call `loadDraftFieldOrder(category)` and `loadDraftFieldRules(category)`, then merge with compiled data from `loadCategoryConfig()`. Filter `__grp::` from field order before returning to non-Studio consumers. Use `buildReviewLayout` if you need full layout with positional group derivation.

### 6. Group derivation precedence

For the Review Grid and any other server-side consumer that needs groups:

```
Positional group (from __grp:: markers in fieldOrder)  >  rule.ui.group  >  rule.group  >  'ungrouped'
```

This is implemented in `buildReviewLayout()` via `positionalGroupMap`. The `__grp::` markers are the authoritative source for group assignment.

---

## File Reference

| File | Role |
|------|------|
| `tools/gui-react/src/pages/studio/useFieldRulesStore.ts` | Zustand store definition |
| `tools/gui-react/src/pages/studio/StudioPage.tsx` | Store hydration, save mutation, tab orchestration |
| `tools/gui-react/src/pages/studio/workbench/FieldRulesWorkbench.tsx` | Contract tab — reads/writes store |
| `tools/gui-react/src/pages/studio/workbench/WorkbenchDrawer.tsx` | Field drawer — writes store |
| `tools/gui-react/src/pages/studio/workbench/workbenchHelpers.ts` | `setNested`, `buildWorkbenchRows`, `buildFieldLabelsMap` |
| `tools/gui-react/src/pages/studio/keyUtils.ts` | `deriveGroupsTs`, `reorderFieldOrder` |
| `tools/gui-react/src/pages/studio/DraggableKeyList.tsx` | Renders key list with group headers, `_edited` indicators |
| `tools/gui-react/src/hooks/useFieldLabels.ts` | Shared hook for field label display |
| `src/api/guiServer.js` | All REST endpoints, `loadDraftFieldOrder`, `loadDraftFieldRules` |
| `src/review/reviewGridData.js` | `buildReviewLayout` (positional group derivation), `buildFieldLabelsMap`, `buildProductReviewPayload` |
| `src/review/componentReviewData.js` | `buildComponentReviewPayloads`, `buildEnumReviewPayloads` |
| `helper_files/{cat}/_control_plane/field_rules_draft.json` | Draft persistence on disk |
