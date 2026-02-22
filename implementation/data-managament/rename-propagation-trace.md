# Brand + Model Rename Propagation Trace

Generated on: 2026-02-21

This trace covers:
- Rename from `Catalog > Models` tab (`ProductManager` model/variant rename).
- Rename from `Catalog > Brands` tab (`BrandManager` brand rename).
- Frontend surfaces that should refresh on save.
- Backend JSON/artifact/queue effects.
- SQL/SpecDb effects.

## 1) Save Triggers and Query Invalidation

### A) Models tab rename (category-scoped)
- Trigger: `tools/gui-react/src/pages/catalog/ProductManager.tsx:409`
- API call: `PUT /api/v1/catalog/{category}/products/{pid}` from `tools/gui-react/src/pages/catalog/ProductManager.tsx:312`
- On success:
  - `setSelectedProduct(newPid)` when the renamed product was selected: `tools/gui-react/src/pages/catalog/ProductManager.tsx:319`
  - Invalidate:
    - `['catalog-products', category]` at `tools/gui-react/src/pages/catalog/ProductManager.tsx:352`
    - `['catalog', category]` at `tools/gui-react/src/pages/catalog/ProductManager.tsx:353`
    - `['reviewProductsIndex', category]` at `tools/gui-react/src/pages/catalog/ProductManager.tsx:354`
    - `['product', category]` at `tools/gui-react/src/pages/catalog/ProductManager.tsx:355`

### B) Brands tab rename (cross-category cache invalidation)
- Trigger: `tools/gui-react/src/pages/studio/BrandManager.tsx:319`
- API call: `PUT /api/v1/brands/{slug}` from `tools/gui-react/src/pages/studio/BrandManager.tsx:245`
- On success invalidate:
  - `['brands']` at `tools/gui-react/src/pages/studio/BrandManager.tsx:227`
  - `['brand-impact']` at `tools/gui-react/src/pages/studio/BrandManager.tsx:228`
  - `['catalog-products']` at `tools/gui-react/src/pages/studio/BrandManager.tsx:230`
  - `['catalog']` at `tools/gui-react/src/pages/studio/BrandManager.tsx:231`
  - `['reviewProductsIndex']` at `tools/gui-react/src/pages/studio/BrandManager.tsx:232`
  - `['product']` at `tools/gui-react/src/pages/studio/BrandManager.tsx:233`

## 2) Frontend Surfaces That Should Update

### A) Surfaces fed by `catalog-products`
- Catalog Models table, brand/model columns:
  - `tools/gui-react/src/pages/catalog/ProductManager.tsx:191`
  - `tools/gui-react/src/pages/catalog/ProductManager.tsx:197`
  - query key at `tools/gui-react/src/pages/catalog/ProductManager.tsx:294`

### B) Surfaces fed by `brands`
- Catalog Brands table (`Brand Name`):
  - `tools/gui-react/src/pages/studio/BrandManager.tsx:119`
  - query key at `tools/gui-react/src/pages/studio/BrandManager.tsx:195`
- Catalog Models brand selector options (brand dropdown):
  - query key at `tools/gui-react/src/pages/catalog/ProductManager.tsx:299`

### C) Surfaces fed by `catalog`
- Sidebar brand/model selectors and selected-product info:
  - query key `['catalog', category]`: `tools/gui-react/src/components/layout/Sidebar.tsx:39`
  - brand/model selectors: `tools/gui-react/src/components/layout/Sidebar.tsx:159`, `tools/gui-react/src/components/layout/Sidebar.tsx:174`
  - selected product binding by brand/model: `tools/gui-react/src/components/layout/Sidebar.tsx:89`
- Overview table brand/model:
  - columns: `tools/gui-react/src/pages/overview/OverviewPage.tsx:16`, `tools/gui-react/src/pages/overview/OverviewPage.tsx:17`
  - query key: `tools/gui-react/src/pages/overview/OverviewPage.tsx:103`
- Indexing Product Picker brand/model/selected summary:
  - query key `['catalog', category, 'indexing']`: `tools/gui-react/src/pages/indexing/IndexingPage.tsx:1549`
  - picker UI: `tools/gui-react/src/pages/indexing/IndexingPage.tsx:8917`
  - brand/model selects: `tools/gui-react/src/pages/indexing/IndexingPage.tsx:8944`, `tools/gui-react/src/pages/indexing/IndexingPage.tsx:8961`
  - selected summary text: `tools/gui-react/src/pages/indexing/IndexingPage.tsx:8987`

### D) Surfaces fed by `reviewProductsIndex`
- Review grid product headers:
  - `tools/gui-react/src/pages/review/ReviewMatrix.tsx:116`
  - `tools/gui-react/src/pages/review/ReviewMatrix.tsx:117`
- Review brand chip bar:
  - `tools/gui-react/src/pages/review/BrandFilterBar.tsx:45`
  - `tools/gui-react/src/pages/review/BrandFilterBar.tsx:58`
- Review action labels:
  - finalize button uses brand/model: `tools/gui-react/src/pages/review/ReviewPage.tsx:690`
  - drawer subtitle uses brand/model: `tools/gui-react/src/pages/review/ReviewPage.tsx:781`
  - products index query key: `tools/gui-react/src/pages/review/ReviewPage.tsx:79`

### E) Surfaces fed by `product`
- Product page title brand/model:
  - query key `['product', category, productId]`: `tools/gui-react/src/pages/product/ProductPage.tsx:53`
  - display: `tools/gui-react/src/pages/product/ProductPage.tsx:131`

## 3) Backend Mutation Path and File Effects

## A) Product rename (`PUT /catalog/{cat}/products/{pid}`)
- Route entry: `src/api/guiServer.js:5463`
- Calls `catalogUpdateProduct(...)`: `src/api/guiServer.js:5466`
- Product catalog update logic: `src/catalog/productCatalog.js:329`
- When slug changes:
  - migrate artifacts: `src/catalog/productCatalog.js:373`
  - append category rename log: `src/catalog/productCatalog.js:398`
  - delete old input file: `src/catalog/productCatalog.js:413`
  - write new input file: `src/catalog/productCatalog.js:433`
  - save updated catalog JSON: `src/catalog/productCatalog.js:429`

### Artifact migration (`migrateProductArtifacts`)
- Function: `src/catalog/artifactMigration.js:38`
- Migrates output/final/published prefixes: `src/catalog/artifactMigration.js:46`
- Migrates overrides file:
  - from `helper_files/{cat}/_overrides/{oldPid}.overrides.json`
  - to `helper_files/{cat}/_overrides/{newPid}.overrides.json`
  - logic at `src/catalog/artifactMigration.js:124`
- Migrates queue entry via queue state: `src/catalog/artifactMigration.js:152`
- Appends product rename log:
  - `helper_files/{cat}/_control_plane/rename_log.json`
  - function at `src/catalog/artifactMigration.js:179`

### Queue JSON paths touched during rename
- Modern queue JSON key: `_queue/{category}/state.json` at `src/queue/queueState.js:123`
- Legacy queue JSON key (mirrored write): `storage.resolveOutputKey('_queue', category, 'state.json')` at `src/queue/queueState.js:127`
- Entry rename old->new key: `src/queue/queueState.js:319`

## B) Brand rename (`PUT /brands/{slug}` with changed name)
- Route detection + call to `renameBrand(...)`: `src/api/guiServer.js:7364`, `src/api/guiServer.js:7372`
- Brand registry rename logic: `src/catalog/brandRegistry.js:523`
- Writes:
  - `helper_files/_global/brand_registry.json` via `saveBrandRegistry(...)` at `src/catalog/brandRegistry.js:569`
  - `helper_files/_global/brand_rename_log.json` via `appendBrandRenameLog(...)` at `src/catalog/brandRegistry.js:572`, `src/catalog/brandRegistry.js:678`
- Cascade:
  - For each category in brand membership, each matching product is updated through `catalogUpdateProduct(...)`:
  - `src/catalog/brandRegistry.js:585`, `src/catalog/brandRegistry.js:592`
  - This reuses the full product rename path above (catalog/input/artifacts/queue JSON effects).

## 4) SQL / SpecDb Impact

### Direct rename-path SQL writes
- No direct SpecDb update is executed in the rename route path for products/brands.
- Queue helpers are called without `specDb` in this path:
  - Product route passes `upsertQueueProduct` function only: `src/api/guiServer.js:5471`
  - `updateProduct` uses that callback without passing a `specDb` object: `src/catalog/productCatalog.js:450`
  - Queue migrate also called without `specDb`: `src/catalog/artifactMigration.js:152`

### SQL tables relevant for eventual sync
- `products` table schema: `src/db/specDb.js:222`
- `product_queue` table schema: `src/db/specDb.js:239`
- Upsert methods:
  - queue: `src/db/specDb.js:3024`
  - products: `src/db/specDb.js:3137`

### How SQL gets refreshed later (indirect)
- `seedSpecDb(...)` repopulates SQL from JSON/artifacts:
  - seed product catalog JSON into `products`: `src/db/seed.js:1024`, `src/db/seed.js:1034`
  - seed queue JSON into `product_queue`: `src/db/seed.js:884`, `src/db/seed.js:897`
- Queue JSON dual-write flag default is `false`, but rename path still writes queue JSON because `specDb` is omitted:
  - config default: `src/config.js:790`
  - JSON write behavior when no `specDb`: `src/queue/queueState.js:238`

## 5) Diagram Outputs

- Frontend hierarchy:
  - Mermaid source: `implementation/data-managament/diagrams/rename-propagation/frontend-rename-propagation.mmd`
  - 4K PNG: `implementation/data-managament/diagrams/rename-propagation/frontend-rename-propagation.4k.png`
  - SVG: `implementation/data-managament/diagrams/rename-propagation/frontend-rename-propagation.svg`

- Backend SQL + JSON hierarchy:
  - Mermaid source: `implementation/data-managament/diagrams/rename-propagation/backend-rename-propagation.mmd`
  - 4K PNG: `implementation/data-managament/diagrams/rename-propagation/backend-rename-propagation.4k.png`
  - SVG: `implementation/data-managament/diagrams/rename-propagation/backend-rename-propagation.svg`
