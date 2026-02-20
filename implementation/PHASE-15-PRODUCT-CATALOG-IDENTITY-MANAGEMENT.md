# PHASE 15 — PRODUCT CATALOG & IDENTITY MANAGEMENT

**Order:** After Phase 13 + Improvement Phases 01-02 (dead config fixes complete).
**Priority:** HIGH — blocks reliable 24/7 operation and GUI usability.

---

## CONTEXT

## IMPLEMENTATION UPDATE (2026-02-18)

Delivered in code:

- Canonical candidate ID generation is now centralized for synthetic/manual/workbook flows.
  - Backend: `src/utils/candidateIdentifier.js`
  - Frontend: `tools/gui-react/src/utils/candidateIdentifier.ts`
- Review hierarchy and lane behavior are SQL-backed and context-driven:
  - item lane (`grid_key`) and shared lane (`component_key` / `enum_key`) are independent.
  - `confirm` does not auto-accept; `accept` does not auto-confirm.
- Drawer components are projection-only over persisted key-review state.

Still out of scope:

- Physical schema rename from `enum_key` to `list_key`.
- Historical rewrite of legacy candidate IDs already stored in old artifacts.

### What activeFiltering.json Actually Is

`activeFiltering.json` is an **external input** — a list of products that have been validated and are live in production on the site. Our system **reads it but never writes to it**. It answers one question: "which products should we go research?"

```
activeFiltering.json (INPUT: "here are 342 products to research")
         │
         │  READ by syncJobsFromActiveFiltering()
         ▼
specs/inputs/{cat}/products/*.json (job files — "go research this product")
         │
         │  Pipeline runs, gathers data from web
         ▼
specs/outputs/{cat}/{productId}/  (gathered & validated spec data)
  normalized.json, summary.json, provenance.json
         │
         │  User reviews → finalizes
         ▼
out/final/{cat}/{productId}/  (published output)
```

### What's Broken Today

1. **690 duplicate input files** for 342 products — stale job files from old workspace with fabricated variants. Every product appears twice in the GUI catalog.
2. **No brand management** — can't add a new brand, can't assign brands to categories, no central brand list.
3. **No model/variant CRUD** — can't add a product to be researched without editing JSON files manually.
4. **No production sync** — no way to pull what's live on the site and compare against what we have locally. If production adds 50 new mice, we don't know until someone manually updates activeFiltering.json.
5. **No identity dedup gate** — any sync path can create duplicate input files without checking against a canonical product list.

---

## MISSION

Build product identity management in three phases:

1. **Phase 1:** Brand registry + GUI + fix the duplicate files
2. **Phase 2:** Model & variant CRUD per category + workbook import
3. **Phase 3:** Production source integration — pull what's live on the site, flag discrepancies, use it as the canonical product list going forward

---

## DATA MODEL

### New: `helper_files/_global/brand_registry.json`

Global. A brand makes products across categories. Define once, assign to categories.

```jsonc
{
  "_doc": "Global brand registry. Managed by GUI.",
  "_version": 1,
  "brands": {
    "logitech": {
      "canonical_name": "Logitech",
      "aliases": ["Logitech G", "Logi"],
      "categories": ["mouse", "keyboard", "headset"],
      "website": "https://www.logitechg.com",
      "added_at": "2026-02-14T12:00:00Z",
      "added_by": "seed"
    },
    "razer": {
      "canonical_name": "Razer",
      "aliases": [],
      "categories": ["mouse", "keyboard", "headset"],
      "website": "https://www.razer.com",
      "added_at": "2026-02-14T12:00:00Z",
      "added_by": "seed"
    }
  }
}
```

### New: `helper_files/{category}/_control_plane/product_catalog.json`

Per-category product list. GUI is the write authority. This is what drives "which products to research."

```jsonc
{
  "_doc": "Per-category product catalog. GUI writes here.",
  "_version": 1,
  "products": {
    "mouse-logitech-g-pro-x-superlight-2": {
      "brand": "Logitech",
      "model": "G Pro X Superlight 2",
      "variant": "",
      "status": "active",
      "seed_urls": ["https://www.logitechg.com/..."],
      "import_source": "activeFiltering",
      "imported_at": "2026-02-14T12:00:00Z",
      "updated_at": "2026-02-14T12:00:00Z"
    }
  },
  "meta": {
    "total_active": 342,
    "last_import": "2026-02-14T12:00:00Z",
    "last_reconcile": null,
    "last_production_sync": null
  }
}
```

### New Derived Snapshot: `.specfactory_tmp/{category}/spec.sqlite` (SpecDb)

This is a derived relational snapshot used for data management and audit workflows. It is created by:

```bash
node src/cli/spec.js seed-db --category <category> --local
```

Core lineage tables:

- `candidates`: one row per extracted candidate with source lineage (`source_url`, `source_host`, `source_root_domain`, `source_tier`, `source_method`, snippets/quotes/evidence URL).
- `item_field_state`: current per-product per-field value; `accepted_candidate_id` anchors each value to candidate evidence.
- `candidate_reviews`: review state for candidate/context (`context_type` supports `item`, `component`, `list`).

Sharing tables:

- `component_identity`, `component_aliases`, `component_values`: canonical component records and properties.
- `list_values`: canonical enum/list values per field.
- `item_component_links`: maps item fields to canonical component identity.
- `item_list_links`: maps item fields to canonical list values.

This gives one connected graph from item values to evidence, then out to shared component/list entities.

### How These Relate to activeFiltering.json

```
TODAY (broken):
  activeFiltering.json ──READ──→ syncJobsFromActiveFiltering ──→ input job files
  Excel workbook ──READ──→ syncJobsFromExcelSeed ──→ MORE input job files (duplicates!)

AFTER PHASE 15:
  Phase 1-2: product_catalog.json ──→ sync to input job files (single path)
             activeFiltering.json still works as fallback if catalog doesn't exist

  Phase 3:   Production site API ──PULL──→ product_catalog.json (canonical source)
             Local additions (GUI CRUD) ──MERGE──→ product_catalog.json
             Discrepancies flagged in GUI
```

activeFiltering.json is NOT deprecated — it remains a valid input for seeding the catalog. But it stops being the only way to define "which products to research." The GUI becomes the management interface, and in Phase 3, the production site becomes the authoritative source that the catalog syncs from.

---

# PHASE 15.1 — BRAND REGISTRY + CLEANUP

**Goal:** Global brand management in GUI. Fix the 690 duplicate files. Prevent recurrence.

---

## 15.1A — Identity Dedup Gate (prerequisite)

**What:** Shared module that ALL product sync paths call before creating input files.

**New module:** `src/catalog/identityGate.js`

**Logic:**
1. Load canonical product set (from product_catalog.json → fallback activeFiltering.json)
2. For any new product being created:
   - Normalize brand/model/variant
   - Check if `(brand, model)` already exists with a different variant
   - If variant is non-empty and a substring of the model name → REJECT as fabricated
   - If `(brand, model, "")` exists but caller wants to create `(brand, model, "310")` → REJECT
3. Return `{ valid, reason, canonicalProductId }`

**Wire into (modify existing files):**
- `src/helperFiles/index.js` → `syncJobsFromActiveFiltering()` calls gate before creating job
- `src/ingest/excelSeed.js` → `syncJobsFromExcelSeed()` calls gate before creating job
- `src/queue/queueState.js` → `syncQueueFromInputs()` calls gate before adding to queue

**Tests:** `test/identityGate.test.js`
- Rejects fabricated variant ("Cestus 310" + variant "310")
- Rejects duplicate when canonical has empty variant
- Accepts legitimate variant when explicitly in catalog
- Falls back to activeFiltering when no catalog exists

**Acceptance:**
- `syncJobsFromExcelSeed` can never create variant duplicates again
- Every rejection logged with reason
- Zero regressions — gate is additive, existing products are not removed

---

## 15.1B — Product Reconciler

**What:** CLI command + API to clean up the 690 stale duplicate input files.

**CLI:** `node src/cli/spec.js product-reconcile --category mouse --dry-run`

**New module:** `src/catalog/reconciler.js`

**Logic:**
1. Load canonical product list (activeFiltering.json — 342 products, all with empty variant)
2. Scan all input files in `specs/inputs/{cat}/products/`
3. Classify each file:
   - **CANONICAL:** `catalogKey(brand, model, variant)` matches an entry in canonical list → KEEP
   - **ORPHAN:** same `(brand, model)` exists in canonical but this file has a non-empty variant → DELETE candidate (fabricated variant from old sync)
   - **UNTRACKED:** no matching `(brand, model)` in canonical at all → FLAG (might be manually added, don't auto-delete)
4. Report: `{ kept: 342, orphans: 343, untracked: 5 }`
5. With `--apply`: delete orphan files, remove from queue state

**API:** `POST /api/v1/catalog/{category}/reconcile`
- `{ dryRun: true }` → returns report
- `{ dryRun: false }` → deletes orphans, returns report

**GUI:** "Reconcile" button on Workbook Context tab products panel. Shows orphan list, user confirms before deletion.

**Acceptance:**
- `product-reconcile --category mouse --apply` reduces 690 → 342 input files
- Queue state cleaned of orphan productIds
- Idempotent — running twice does nothing the second time
- Untracked files are flagged but NOT deleted (user decides)

---

## 15.1C — Brand Registry (Data Model + API)

**New file:** `helper_files/_global/brand_registry.json`

**New module:** `src/catalog/brandRegistry.js`

```javascript
export async function loadBrandRegistry(config)
export async function saveBrandRegistry(config, registry)
export async function addBrand({ config, name, aliases, categories, website })
export async function updateBrand({ config, slug, patch })
export async function removeBrand({ config, slug })
export async function seedBrandsFromActiveFiltering({ config, categories })
export function getBrandsForCategory(registry, category)
export function findBrandByAlias(registry, query)
```

**Seeding on first use:**
- If `brand_registry.json` doesn't exist and user opens Brands panel:
  - Scan `activeFiltering.json` for each category that has one
  - Extract unique brand names
  - Infer category membership (brand "Logitech" found in mouse and keyboard → assign both)
  - Write initial `brand_registry.json`
  - User can then edit/refine

**API endpoints (added to guiServer.js):**

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/brands` | List all brands, optionally filter by `?category=mouse` |
| POST | `/api/v1/brands` | Add brand: `{ name, aliases, categories, website }` |
| PUT | `/api/v1/brands/{slug}` | Update brand: `{ name?, aliases?, categories?, website? }` |
| DELETE | `/api/v1/brands/{slug}` | Remove brand (warns if products reference it) |
| POST | `/api/v1/brands/seed` | Auto-seed from activeFiltering across all categories |

**Acceptance:**
- `GET /api/v1/brands` returns all brands with category chips
- Adding a brand with `categories: ["mouse", "keyboard"]` makes it available in both
- Removing a brand with active products returns `{ warning: "12 products reference this brand" }`
- Seeding from activeFiltering produces correct brand-to-category mapping

---

## 15.1D — Brand Management GUI

**New component:** `tools/gui-react/src/pages/studio/BrandManager.tsx`

**Location in GUI:** New "Brands" tab in the Studio page (tab 6), or accessible from a global sidebar. This is NOT per-category — brands are global.

**UI elements:**

1. **Brand table** (DataTable with search):
   - Columns: Brand Name, Aliases, Categories (chips), Website, Added Date
   - Row click → inline edit panel
   - Bulk select for category assignment

2. **Add Brand form** (dialog or inline):
   - Brand name (text input, required)
   - Aliases (comma-separated text input)
   - Categories (checkbox list from available categories)
   - Website URL (optional)
   - "Add" button → calls POST `/api/v1/brands`

3. **Edit Brand** (inline panel on row click):
   - Same fields as Add, pre-populated
   - "Save" → calls PUT `/api/v1/brands/{slug}`
   - "Delete" → confirmation dialog → calls DELETE

4. **Seed from Active Filtering** button:
   - Only shown when brand_registry.json doesn't exist or is empty
   - Calls POST `/api/v1/brands/seed`
   - Shows preview of discovered brands with category assignments
   - User confirms

5. **Category filter dropdown:**
   - Filter the brand list to show only brands assigned to a specific category
   - "All Categories" default

**Acceptance:**
- User can add "SteelSeries" with categories ["mouse", "keyboard", "headset"]
- User can add alias "SS" for "SteelSeries"
- Filtering by "mouse" shows only mouse-assigned brands
- Brand table is searchable and sortable

---

## Phase 15.1 — File Inventory

### New Files
| File | Type | Purpose |
|------|------|---------|
| `helper_files/_global/brand_registry.json` | Data | Global brand list (created on first seed/add) |
| `src/catalog/identityGate.js` | Module | Identity validation + dedup gate |
| `src/catalog/brandRegistry.js` | Module | Brand CRUD operations |
| `src/catalog/reconciler.js` | Module | Orphan input file detection + cleanup |
| `test/identityGate.test.js` | Test | Identity gate unit tests |
| `test/brandRegistry.test.js` | Test | Brand registry CRUD tests |
| `test/reconciler.test.js` | Test | Reconciler tests |
| `tools/gui-react/src/pages/studio/BrandManager.tsx` | React | Brand management UI |

### Modified Files
| File | Change |
|------|--------|
| `src/api/guiServer.js` | Add brand CRUD endpoints + reconcile endpoint |
| `src/helperFiles/index.js` | Wire identity gate into syncJobsFromActiveFiltering |
| `src/ingest/excelSeed.js` | Wire identity gate into syncJobsFromExcelSeed |
| `src/queue/queueState.js` | Wire identity gate into syncQueueFromInputs |
| `src/cli/spec.js` | Add `product-reconcile` command |
| `tools/gui-react/src/pages/studio/StudioPage.tsx` | Add Brands tab |

### Phase 15.1 Acceptance Criteria
1. 690 duplicate input files cleaned to 342 (reconciler)
2. Identity gate prevents fabricated variant duplicates in all sync paths
3. Brand registry seeded from existing activeFiltering data
4. User can add/edit/remove brands in the GUI
5. Brands have global scope with per-category assignment
6. Zero regressions in existing test suite

---

# PHASE 15.2 — MODEL & VARIANT MANAGEMENT

**Goal:** Per-category product CRUD. Add models and variants through the GUI. Import from workbook.

**Depends on:** Phase 15.1 (brand registry must exist for brand dropdown).

---

## 15.2A — Product Catalog Data Model + API

**New file:** `helper_files/{cat}/_control_plane/product_catalog.json`

**New module:** `src/catalog/productCatalog.js`

```javascript
export async function loadProductCatalog({ config, category })
export async function saveProductCatalog({ config, category, catalog })
export async function addProduct({ config, category, brand, model, variant, seedUrls, storage })
export async function updateProduct({ config, category, productId, patch, storage })
export async function removeProduct({ config, category, productId, storage })
export async function bulkAddProducts({ config, category, products, storage })
export async function seedCatalogFromActiveFiltering({ config, category })
export async function syncCatalogToInputFiles({ config, category, storage })
```

**Key behaviors:**

1. **addProduct** — validates brand exists in registry for this category, generates productId, writes to catalog, creates input job file, upserts queue entry. Single atomic operation.

2. **removeProduct** — removes from catalog, deletes input job file, removes queue entry. Warns if product has output data (doesn't delete output).

3. **updateProduct** — if brand/model/variant change, regenerates productId, renames input file, updates queue. If only seedUrls change, updates in place.

4. **syncCatalogToInputFiles** — ensures every product in catalog has a corresponding input file and queue entry. Creates missing ones, flags orphan input files not in catalog. This replaces the role of `syncJobsFromActiveFiltering` when a catalog exists.

5. **seedCatalogFromActiveFiltering** — one-time import of all products from activeFiltering.json into catalog. Calls `addProduct` for each row, skipping duplicates.

**API endpoints (added to guiServer.js):**

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/catalog/{cat}/products` | List all products from catalog (falls back to activeFiltering) |
| POST | `/api/v1/catalog/{cat}/products` | Add product: `{ brand, model, variant, seedUrls }` |
| PUT | `/api/v1/catalog/{cat}/products/{pid}` | Update product: `{ brand?, model?, variant?, seedUrls?, status? }` |
| DELETE | `/api/v1/catalog/{cat}/products/{pid}` | Remove product |
| POST | `/api/v1/catalog/{cat}/products/bulk` | Bulk add: `{ products: [...] }` |
| POST | `/api/v1/catalog/{cat}/seed` | Seed catalog from activeFiltering.json |
| POST | `/api/v1/catalog/{cat}/sync` | Sync catalog → input files (create missing, flag orphans) |

**Backward compatibility:** If `product_catalog.json` does not exist, `GET /catalog/{cat}/products` falls back to building the product list from activeFiltering.json + storage inputs (current `buildCatalog()` behavior). This means nothing breaks until the user explicitly creates a catalog.

**Acceptance:**
- POST a new product → input file + queue entry created immediately
- DELETE a product → input file + queue entry removed
- PUT brand/model → productId regenerated, files renamed
- Seed from activeFiltering → catalog created with 342 products, no duplicates
- Sync → missing input files created, orphans flagged

---

## 15.2B — Product Management GUI

**New component:** `tools/gui-react/src/pages/studio/ProductCatalogTab.tsx`

**Location in GUI:** New "Products" tab in the Studio page (per-category, like other studio tabs).

**UI elements:**

1. **Product table** (DataTable with search/filter):
   - Columns: Brand, Model, Variant, Product ID, Status, Seed URLs, Import Source, Has Output
   - Filter by: brand (dropdown from registry), status (active/inactive/draft)
   - Sortable by any column
   - Row click → detail/edit panel

2. **Add Product form** (dialog):
   - Brand (dropdown — populated from brand registry, filtered to current category)
   - Model (text input, required)
   - Variant (text input, optional — with helper text: "Leave empty unless this is a color/edition variant")
   - Seed URLs (multi-line text area, one URL per line)
   - Preview of generated Product ID (live, below form)
   - "Add" button → POST `/api/v1/catalog/{cat}/products`
   - If brand not found in dropdown: "Add New Brand" link → opens Brand Manager

3. **Edit Product** (inline panel):
   - Same fields, pre-populated
   - "Save" → PUT
   - "Delete" → confirmation ("This product has output data — only the job will be removed, output is preserved") → DELETE

4. **Bulk actions:**
   - Select multiple rows → "Delete Selected" / "Set Inactive"
   - "Seed from Active Filtering" button (one-time, creates catalog from activeFiltering.json)
   - "Sync to Pipeline" button (ensures all catalog products have input files)

5. **Status badges:**
   - `active` (green) — will be processed by pipeline
   - `inactive` (gray) — skipped by pipeline
   - `draft` (yellow) — not yet synced to input files
   - `has_output` (blue) — pipeline has produced results
   - `needs_review` (orange) — flagged by production sync (Phase 15.3)

**Acceptance:**
- User selects "Razer" from brand dropdown, types "Viper V3 Pro", leaves variant empty → Product ID shows `mouse-razer-viper-v3-pro` → clicks Add → product appears in table
- User clicks "Add New Brand" → Brand Manager opens → adds "Fnatic" → returns → "Fnatic" now in dropdown
- User deletes product with output → warning shown → confirms → job removed, output preserved
- Seed from activeFiltering populates table with 342 products

---

## 15.2C — Import from Workbook

**What:** "Import Products from Workbook" button on the Products tab (or Workbook Context tab).

**API:** `POST /api/v1/catalog/{cat}/import/workbook`

**Flow:**
1. User clicks "Import from Workbook"
2. Backend reads Excel Rows 3-5 (brand, model, variant) for all product columns
3. Backend normalizes:
   - Empty/placeholder variants → stripped
   - Brands matched against brand registry (exact + alias match)
   - Unrecognized brands collected separately
4. Backend returns diff preview:
   ```jsonc
   {
     "new_products": [{ "brand": "NewCo", "model": "X1", "variant": "" }],
     "existing_products": [{ "brand": "Logitech", "model": "G Pro", "already_in_catalog": true }],
     "new_brands": ["NewCo"],
     "variant_warnings": [{ "model": "Cestus 310", "variant": "310", "reason": "variant_is_model_substring" }]
   }
   ```
5. GUI shows diff:
   - **New products** (green) — checkboxes, default selected
   - **Already in catalog** (gray) — shown for reference, not re-imported
   - **New brands discovered** (blue) — will be auto-added to brand registry
   - **Variant warnings** (red) — "310 looks like part of the model name" with toggle to include/exclude
6. User confirms → backend writes to catalog, creates input files, adds new brands

**Variant guard rule:** If variant is non-empty AND `slugify(variant)` appears in `slugify(model)`:
- Flag as `variant_is_model_substring`
- Default behavior: strip the variant (import as model-only)
- User can override per-product

**Acceptance:**
- Importing with empty Row 5 → all products created with no variant
- Importing with junk in Row 5 → warnings shown, user decides
- Re-importing → existing products skipped, only new ones added
- New brands discovered → auto-added to registry with current category
- Idempotent: importing twice produces same result

---

## Phase 15.2 — File Inventory

### New Files
| File | Type | Purpose |
|------|------|---------|
| `helper_files/{cat}/_control_plane/product_catalog.json` | Data | Per-category product list (created on first seed/add) |
| `src/catalog/productCatalog.js` | Module | Product CRUD + sync operations |
| `test/productCatalog.test.js` | Test | Product catalog unit tests |
| `tools/gui-react/src/pages/studio/ProductCatalogTab.tsx` | React | Product management UI |
| `tools/gui-react/src/components/dialogs/ImportWorkbookDialog.tsx` | React | Import diff preview + confirm |
| `tools/gui-react/src/components/dialogs/AddProductDialog.tsx` | React | Add product form |

### Modified Files
| File | Change |
|------|--------|
| `src/api/guiServer.js` | Add product CRUD + import + seed + sync endpoints |
| `src/daemon/daemon.js` | Use product_catalog.json when it exists (fallback to activeFiltering) |
| `src/cli/spec.js` | Add `product-seed`, `product-sync` commands |
| `tools/gui-react/src/pages/studio/StudioPage.tsx` | Add Products tab |

### Phase 15.2 Acceptance Criteria
1. User can add a product with brand dropdown + model + variant in the GUI
2. Adding a product creates the input job file and queue entry immediately
3. Deleting a product removes job file and queue entry (preserves output)
4. Import from Workbook shows diff preview with variant warnings
5. Seed from activeFiltering creates catalog with all 342 products
6. Pipeline uses product_catalog.json when it exists, falls back to activeFiltering
7. Zero regressions

---

# PHASE 15.3 — PRODUCTION SOURCE INTEGRATION

**Goal:** The production site is the authoritative source of "what products exist." Pull from it, flag discrepancies, and keep the local catalog in sync.

**Depends on:** Phase 15.2 (product catalog must exist to receive production data).

---

## 15.3A — Production Product Source Configuration

**What:** Configure where to pull the authoritative product list from. This is the live data on the production site — NOT the local activeFiltering.json helper file.

**Config (added to `helper_files/{cat}/_control_plane/product_source.json`):**

```jsonc
{
  "_doc": "Production product source. This is what's live on the site.",
  "source_type": "s3",
  "s3": {
    "bucket": "",
    "key": "production/activeFiltering/mouse.json",
    "region": "us-east-2"
  },
  "api": {
    "url": "",
    "auth_header": "",
    "product_list_path": "$.products"
  },
  "schedule": {
    "auto_pull": false,
    "interval_hours": 24
  },
  "last_pull": null,
  "last_pull_hash": null
}
```

Supports two source types:
- **s3** — pull a JSON file from an S3 bucket (production activeFiltering)
- **api** — call an HTTP endpoint that returns the product list (future: site API)

**GUI:** Configuration panel on the Products tab:
- Source type dropdown (S3 / API / Manual)
- S3 fields: bucket, key, region
- API fields: URL, auth header, JSON path
- "Test Connection" button
- Auto-pull toggle + interval

**Acceptance:**
- User can configure S3 bucket + key for production activeFiltering
- "Test Connection" verifies access and shows product count
- Configuration saved to `product_source.json`

---

## 15.3B — Pull from Production + Discrepancy Detection

**What:** Pull the production product list and compare against local catalog. Flag everything that's different.

**New module:** `src/catalog/productionSync.js`

```javascript
export async function pullFromProduction({ config, category })
export async function diffAgainstCatalog({ productionProducts, catalogProducts })
export async function applyProductionSync({ config, category, storage, actions })
```

**CLI:** `node src/cli/spec.js production-sync --category mouse --dry-run`

**Diff categories:**

| Category | Meaning | GUI Color | Default Action |
|----------|---------|-----------|----------------|
| `in_production_only` | Product is live on site but NOT in local catalog | Green | Add to catalog |
| `in_catalog_only` | Product is in local catalog but NOT live on site | Yellow | Flag for review (might be discontinued) |
| `identity_mismatch` | Same productId but different brand/model/variant | Red | Flag as conflict — user must resolve |
| `field_drift` | Same product but field values differ (e.g., different sensor, weight) | Orange | Flag — production values are authoritative for published fields |
| `matched` | Identical in both | Gray | No action needed |

**Diff output:**
```jsonc
{
  "summary": {
    "production_count": 365,
    "catalog_count": 342,
    "matched": 330,
    "in_production_only": 35,
    "in_catalog_only": 12,
    "identity_mismatch": 0,
    "field_drift": 7
  },
  "details": {
    "in_production_only": [
      { "brand": "Razer", "model": "Viper V4", "variant": "" }
    ],
    "in_catalog_only": [
      { "brand": "Alienware", "model": "AW310M", "variant": "", "reason": "possibly_discontinued" }
    ],
    "field_drift": [
      {
        "productId": "mouse-logitech-g-pro-x-superlight-2",
        "field": "weight",
        "production_value": "60",
        "catalog_value": "63",
        "note": "production value is authoritative"
      }
    ]
  }
}
```

**API:** `POST /api/v1/catalog/{cat}/production-sync`
- `{ dryRun: true }` → returns diff report
- `{ dryRun: false, actions: { add: [...pids], flag: [...pids], skip: [...pids] } }` → applies selected actions

**Acceptance:**
- Pulling from production shows exactly which products are new/missing/drifted
- New products can be batch-added to catalog with one click
- Drifted fields are flagged with production vs local values
- Catalog-only products are NOT auto-deleted (might be intentionally added locally)
- Pull result is cached — re-pulling within 1 hour uses cached data

---

## 15.3C — Production Sync GUI

**New component:** `tools/gui-react/src/components/dialogs/ProductionSyncDialog.tsx`

**Location:** "Sync from Production" button on the Products tab.

**UI flow:**

1. **Pre-sync:** Button shows last sync date or "Never synced"
2. **Click "Sync from Production":**
   - If source not configured → redirect to configuration panel
   - If configured → show loading spinner → pull → show diff report
3. **Diff report view:**
   - Summary bar: "35 new | 12 catalog-only | 7 drifted | 330 matched"
   - Tabs or sections for each category:
     - **New from Production** — table with checkboxes, "Add All" / "Add Selected" buttons
     - **Catalog Only** — table with status badges, "Mark Discontinued" / "Keep" buttons
     - **Field Drift** — table showing field, production value, local value, with "Accept Production Value" per-row
     - **Matched** — collapsed by default, expandable for full list
4. **Apply:** User selects actions → clicks "Apply" → catalog updated
5. **Post-sync:** Product table refreshes with new entries and status badges

**Status badges added to Product table:**
- `from_production` (green checkmark) — matches production
- `local_only` (yellow) — not in production, manually added
- `production_drift` (orange) — values differ from production
- `new_from_production` (blue) — just added from production sync
- `possibly_discontinued` (red) — in catalog but removed from production

**Acceptance:**
- Full sync flow from button click to catalog update works end-to-end
- Diff report is accurate and color-coded
- User has full control over what gets added/flagged/skipped
- Status badges persist after sync and are visible in product table

---

## 15.3D — Scheduled Production Sync (Optional)

**What:** If `auto_pull: true` in `product_source.json`, the daemon periodically pulls from production and logs discrepancies.

**Logic (in daemon.js):**
1. On each daemon iteration, check if `auto_pull` is enabled and interval has elapsed
2. If yes: pull from production, generate diff
3. Write diff report to `helper_files/{cat}/_control_plane/production_sync_report.json`
4. Log summary: "Production sync: 5 new products, 2 drifted fields"
5. Do NOT auto-apply changes — just report. User applies via GUI.

**Acceptance:**
- Daemon pulls production data on configured schedule
- Report available in GUI without manual trigger
- No auto-modifications to catalog — reporting only

---

## 15.3E — Field Rules Cross-Validation Against Production

**What:** During `category-compile`, optionally cross-check generated field_rules against the production product list.

**Checks:**
1. Enum values in production products not in `known_values.json` → warning (enum gap)
2. Numeric values in production products outside field `range` → warning (range violation)
3. Required-level fields missing from many production products → warning (requirement too strict)
4. Component DB refs in production not matching any entry → warning (missing component)

**Output (added to `_compile_report.json`):**
```jsonc
{
  "production_cross_validation": {
    "products_checked": 365,
    "warnings": [
      { "type": "enum_gap", "field": "switch", "value": "Huano Pink Dot", "count": 3 },
      { "type": "range_violation", "field": "weight", "value": "12", "min": 40 }
    ]
  }
}
```

**GUI:** Compile & Reports tab shows cross-validation warnings when production source is configured.

**Acceptance:**
- Compile report includes production cross-validation section when source configured
- Warnings are informational (do not block compilation)
- Enum gaps are actionable — user can add values via Studio

---

## Phase 15.3 — File Inventory

### New Files
| File | Type | Purpose |
|------|------|---------|
| `helper_files/{cat}/_control_plane/product_source.json` | Config | Production source configuration |
| `helper_files/{cat}/_control_plane/production_sync_report.json` | Report | Latest sync diff (auto-generated) |
| `src/catalog/productionSync.js` | Module | Pull + diff + apply operations |
| `test/productionSync.test.js` | Test | Production sync tests |
| `tools/gui-react/src/components/dialogs/ProductionSyncDialog.tsx` | React | Sync flow UI |
| `tools/gui-react/src/components/dialogs/ProductSourceConfig.tsx` | React | Source configuration panel |

### Modified Files
| File | Change |
|------|--------|
| `src/api/guiServer.js` | Add production-sync + source config endpoints |
| `src/daemon/daemon.js` | Add optional production auto-pull on schedule |
| `src/ingest/categoryCompile.js` | Add production cross-validation to compile report |
| `src/cli/spec.js` | Add `production-sync` command |
| `tools/gui-react/src/pages/studio/StudioPage.tsx` | Add source config + sync button to Products tab |
| `tools/gui-react/src/pages/studio/ProductCatalogTab.tsx` | Add status badges for production sync |

### Phase 15.3 Acceptance Criteria
1. User can configure S3 bucket/key for production product source
2. "Sync from Production" shows accurate diff with color-coded categories
3. New products from production can be batch-added to catalog
4. Drifted fields flagged with production vs local values
5. Catalog-only products flagged but NOT auto-deleted
6. Optional scheduled sync logs discrepancies without auto-applying
7. Compile cross-validation warns on enum gaps and range violations

---

# IMPLEMENTATION CONSTRAINTS

## Must Not Break
1. **Existing pipeline** — product_catalog.json is additive. If it doesn't exist, system falls back to activeFiltering.json (current behavior unchanged).
2. **Field rules engine** — No changes to fieldRulesEngine.js, runtimeGate.js, consensusEngine.js, or any Window 1-9 fixes.
3. **S3 storage layer** — No changes to storage.js.
4. **Compilation pipeline** — Phase 15.3E cross-validation is optional and informational (never blocks compile).
5. **activeFiltering.json** — Never modified by our code. Remains a valid read-only input.

## Backward Compatibility
- No product_catalog.json → falls back to activeFiltering.json everywhere
- No brand_registry.json → brands inferred from catalog or activeFiltering
- No product_source.json → production sync features disabled
- Migration is opt-in: user creates catalog via Seed or Import, never forced

## Identity Dedup Rule (prevents recurrence of 690-file bug)
For any `(brand, model)` pair, at most **one** input file may exist unless the variant is:
1. Explicitly present in product_catalog.json with a non-empty variant, AND
2. Not a substring of the model name (fabrication guard)

Enforced by `identityGate.js` at every sync path.

---

# FULL DEPENDENCY MAP

```
Phase 15.1 (Brand Registry + Cleanup)
  15.1A Identity Dedup Gate ─────┐
  15.1B Reconciler ──────────────┼──→ Cleans 690 → 342 files
  15.1C Brand Registry (API) ────┤
  15.1D Brand Manager (GUI) ─────┘
         │
         ▼
Phase 15.2 (Model & Variant CRUD)
  15.2A Product Catalog (API) ───┐
  15.2B Product Manager (GUI) ───┤──→ Full product CRUD in GUI
  15.2C Import from Workbook ────┘
         │
         ▼
Phase 15.3 (Production Source)
  15.3A Source Configuration ────┐
  15.3B Pull + Diff Logic ───────┤
  15.3C Sync GUI ────────────────┤──→ Production is authoritative source
  15.3D Scheduled Auto-Pull ─────┤
  15.3E Compile Cross-Validation ┘
```

---

# RISK ASSESSMENT

| Risk | Mitigation |
|------|------------|
| product_catalog.json and activeFiltering.json conflict | Catalog takes precedence when it exists; activeFiltering is read-only seed source |
| Brand aliases cause false merge during import | Exact + alias match only; never fuzzy. User confirms new brands |
| GUI writes corrupt catalog | Atomic writes (write temp → rename). Schema validation before save. Auto-backup before destructive operations |
| Production sync overwrites local work | Production sync is read-only by default. User must explicitly click "Apply" for each action |
| S3 pull requires AWS credentials | Source config validates credentials on save. Clear error in GUI if not configured |
| Reconciler deletes wanted files | Default is dry-run. Diff preview required before deletion. Untracked files are never auto-deleted |
| Pipeline picks up stale catalog | product_catalog.json has `meta.last_import` timestamp. Daemon logs catalog age on startup |
