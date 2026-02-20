/**
 * Product Catalog — per-category product management.
 *
 * Stored at: helper_files/{category}/_control_plane/product_catalog.json
 * Managed by: GUI Catalog page + API
 *
 * Each product entry maps to an input file at specs/inputs/{cat}/products/{productId}.json
 * and a queue entry. Mutations here are atomic: catalog + input file + queue stay in sync.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { slugify, buildProductId } from './slugify.js';
import { normalizeProductIdentity } from './identityDedup.js';
import { loadWorkbookProducts, loadWorkbookProductsWithFields } from './workbookProductLoader.js';
import { generateIdentifier, nextAvailableId } from './productIdentity.js';
import { migrateProductArtifacts, appendRenameLog } from './artifactMigration.js';
import { buildWorkbookFieldOverrideCandidateId } from '../utils/candidateIdentifier.js';

function catalogPath(config, category) {
  const root = config?.helperFilesRoot || 'helper_files';
  return path.resolve(root, category, '_control_plane', 'product_catalog.json');
}

function nowIso() {
  return new Date().toISOString();
}

function emptyCatalog() {
  return {
    _doc: 'Per-category product catalog. Managed by GUI.',
    _version: 1,
    products: {}
  };
}

/**
 * Build the standard input file JSON for a product.
 */
function buildInputFile({ productId, category, brand, model, variant, id, identifier, seedUrls = [] }) {
  return {
    productId,
    category,
    identityLock: {
      id: id || 0,
      identifier: identifier || '',
      brand,
      model,
      variant: variant || '',
      sku: '',
      mpn: '',
      gtin: ''
    },
    seedUrls: Array.isArray(seedUrls) ? seedUrls : [],
    anchors: {}
  };
}

// ── Load / Save ───────────────────────────────────────────────────

export async function loadProductCatalog(config, category) {
  const filePath = catalogPath(config, category);
  try {
    const text = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || !data.products) {
      return emptyCatalog();
    }
    return data;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return emptyCatalog();
    }
    throw err;
  }
}

export async function saveProductCatalog(config, category, catalog) {
  const filePath = catalogPath(config, category);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(catalog, null, 2), 'utf8');
  return catalog;
}

// ── CRUD ──────────────────────────────────────────────────────────

/**
 * Add a product. Creates catalog entry + input file + queue entry.
 * Returns { ok, productId, product } or { ok: false, error }.
 */
export async function addProduct({
  config,
  category,
  brand,
  model,
  variant = '',
  seedUrls = [],
  storage = null,
  upsertQueue = null
}) {
  const cat = String(category ?? '').trim().toLowerCase();
  const cleanBrand = String(brand ?? '').trim();
  const cleanModel = String(model ?? '').trim();

  if (!cat) return { ok: false, error: 'category_required' };
  if (!cleanBrand) return { ok: false, error: 'brand_required' };
  if (!cleanModel) return { ok: false, error: 'model_required' };

  // Normalize identity (strips fabricated variants)
  const identity = normalizeProductIdentity(cat, cleanBrand, cleanModel, variant);
  const pid = identity.productId;

  const catalog = await loadProductCatalog(config, cat);

  if (catalog.products[pid]) {
    return { ok: false, error: 'product_already_exists', productId: pid };
  }

  const product = {
    id: nextAvailableId(catalog),
    identifier: generateIdentifier(),
    brand: identity.brand,
    model: identity.model,
    variant: identity.variant,
    status: 'active',
    seed_urls: Array.isArray(seedUrls) ? seedUrls.filter(Boolean) : [],
    added_at: nowIso(),
    added_by: 'gui'
  };

  catalog.products[pid] = product;
  await saveProductCatalog(config, cat, catalog);

  // Create input file if storage provided
  if (storage) {
    const inputKey = `specs/inputs/${cat}/products/${pid}.json`;
    const inputFile = buildInputFile({
      productId: pid,
      category: cat,
      brand: identity.brand,
      model: identity.model,
      variant: identity.variant,
      id: product.id,
      identifier: product.identifier,
      seedUrls
    });
    await storage.writeObject(inputKey, Buffer.from(JSON.stringify(inputFile, null, 2)));
  }

  // Upsert queue entry
  if (upsertQueue) {
    const s3key = `specs/inputs/${cat}/products/${pid}.json`;
    await upsertQueue({ storage, category: cat, productId: pid, s3key, patch: { status: 'pending', next_action_hint: 'fast_pass' } });
  }

  return { ok: true, productId: pid, product };
}

/**
 * Update a product. Patches provided fields.
 * If brand/model/variant change, the productId changes → old files removed, new files created.
 */
export async function updateProduct({
  config,
  category,
  productId,
  patch = {},
  storage = null,
  upsertQueue = null
}) {
  const cat = String(category ?? '').trim().toLowerCase();
  if (!cat) return { ok: false, error: 'category_required' };
  if (!productId) return { ok: false, error: 'product_id_required' };

  const catalog = await loadProductCatalog(config, cat);
  const existing = catalog.products[productId];
  if (!existing) {
    return { ok: false, error: 'product_not_found', productId };
  }

  // Apply patches
  const newBrand = patch.brand !== undefined ? String(patch.brand).trim() : existing.brand;
  const newModel = patch.model !== undefined ? String(patch.model).trim() : existing.model;
  const newVariant = patch.variant !== undefined ? String(patch.variant).trim() : existing.variant;

  if (patch.seed_urls !== undefined) {
    existing.seed_urls = Array.isArray(patch.seed_urls) ? patch.seed_urls.filter(Boolean) : existing.seed_urls;
  }
  if (patch.status !== undefined) {
    existing.status = patch.status;
  }

  // Check if identity changed → productId changes
  const identity = normalizeProductIdentity(cat, newBrand, newModel, newVariant);
  const newPid = identity.productId;

  let migrationResult = null;

  if (newPid !== productId) {
    // Ensure new pid doesn't already exist
    if (catalog.products[newPid]) {
      return { ok: false, error: 'product_already_exists', productId: newPid };
    }

    // Migrate all storage artifacts from old slug to new slug
    if (storage) {
      migrationResult = await migrateProductArtifacts({
        storage,
        config,
        category: cat,
        oldProductId: productId,
        newProductId: newPid,
        identifier: existing.identifier
      });
    } else {
      migrationResult = { ok: true, migrated_count: 0, failed_count: 0 };
    }

    // Record rename in per-product history
    existing.rename_history = [
      ...(existing.rename_history || []),
      {
        previous_slug: productId,
        previous_model: existing.model,
        previous_variant: existing.variant || '',
        renamed_at: nowIso(),
        migration_result: { migrated_count: migrationResult.migrated_count, failed_count: migrationResult.failed_count }
      }
    ];

    // Append to category rename log
    await appendRenameLog(config, cat, {
      identifier: existing.identifier,
      id: existing.id,
      old_slug: productId,
      new_slug: newPid,
      migrated_count: migrationResult.migrated_count,
      failed_count: migrationResult.failed_count
    });

    // Remove old catalog entry
    delete catalog.products[productId];

    // Delete old input file (migration engine handles other artifacts, but input file
    // is recreated below so we delete the old one explicitly)
    if (storage) {
      const oldKey = `specs/inputs/${cat}/products/${productId}.json`;
      try { await storage.deleteObject(oldKey); } catch {}
    }
  } else {
    delete catalog.products[productId];
  }

  const updated = {
    ...existing,
    brand: identity.brand,
    model: identity.model,
    variant: identity.variant,
    updated_at: nowIso()
  };

  catalog.products[newPid] = updated;
  await saveProductCatalog(config, cat, catalog);

  // Write new input file
  if (storage) {
    const newKey = `specs/inputs/${cat}/products/${newPid}.json`;
    const inputFile = buildInputFile({
      productId: newPid,
      category: cat,
      brand: identity.brand,
      model: identity.model,
      variant: identity.variant,
      id: updated.id,
      identifier: updated.identifier,
      seedUrls: updated.seed_urls
    });
    await storage.writeObject(newKey, Buffer.from(JSON.stringify(inputFile, null, 2)));
  }

  // Upsert queue (only if no migration — migration already handles queue)
  if (upsertQueue && !migrationResult?.queue_migrated) {
    const s3key = `specs/inputs/${cat}/products/${newPid}.json`;
    await upsertQueue({ storage, category: cat, productId: newPid, s3key, patch: { status: 'pending' } });
  }

  const result = { ok: true, productId: newPid, previousProductId: productId !== newPid ? productId : undefined, product: updated };
  if (migrationResult) {
    result.migration = {
      ok: migrationResult.ok,
      migrated_count: migrationResult.migrated_count,
      failed_count: migrationResult.failed_count
    };
  }
  return result;
}

/**
 * Remove a product. Deletes catalog entry + input file + queue entry.
 * Output files are preserved (they may be useful for reference).
 */
export async function removeProduct({
  config,
  category,
  productId,
  storage = null
}) {
  const cat = String(category ?? '').trim().toLowerCase();
  if (!cat) return { ok: false, error: 'category_required' };
  if (!productId) return { ok: false, error: 'product_id_required' };

  const catalog = await loadProductCatalog(config, cat);
  if (!catalog.products[productId]) {
    return { ok: false, error: 'product_not_found', productId };
  }

  delete catalog.products[productId];
  await saveProductCatalog(config, cat, catalog);

  // Delete input file
  if (storage) {
    const inputKey = `specs/inputs/${cat}/products/${productId}.json`;
    try { await storage.deleteObject(inputKey); } catch {}
  }

  return { ok: true, productId, removed: true };
}

/**
 * Seed catalog from the Excel workbook.
 * Reads products (and optionally field values) from the workbook configured via Mapping Studio.
 * Imports all products that don't already exist in the catalog.
 *
 * @param {object} opts
 * @param {string} opts.mode - 'identity' (default): brand/model/variant only.
 *                             'full': also imports field values as overrides with confidence 0.99.
 */
export async function seedFromWorkbook({
  config,
  category,
  mode = 'identity',
  storage = null,
  upsertQueue = null
}) {
  const cat = String(category ?? '').trim().toLowerCase();
  if (!cat) return { ok: false, error: 'category_required' };

  const isFullMode = mode === 'full';
  const products = isFullMode
    ? await loadWorkbookProductsWithFields({ category: cat, config })
    : await loadWorkbookProducts({ category: cat, config });

  if (!products || products.length === 0) {
    return { ok: true, seeded: 0, skipped: 0, total: 0, fields_imported: 0, message: 'no_workbook_data' };
  }

  const catalog = await loadProductCatalog(config, cat);
  let seeded = 0;
  let skipped = 0;
  let fieldsImported = 0;

  for (const row of products) {
    const brand = String(row.brand ?? '').trim();
    const model = String(row.model ?? '').trim();
    const rawVariant = String(row.variant ?? '').trim();

    if (!brand || !model) continue;

    // In full mode, skip products with brand+model but zero data fields
    if (isFullMode) {
      const fieldCount = row.canonical_fields
        ? Object.keys(row.canonical_fields).length
        : 0;
      if (fieldCount === 0) {
        skipped += 1;
        continue;
      }
    }

    const identity = normalizeProductIdentity(cat, brand, model, rawVariant);
    const pid = identity.productId;

    const isExisting = Boolean(catalog.products[pid]);
    if (isExisting && !isFullMode) {
      skipped += 1;
      continue;
    }

    if (!isExisting) {
      catalog.products[pid] = {
        id: nextAvailableId(catalog),
        identifier: generateIdentifier(),
        brand: identity.brand,
        model: identity.model,
        variant: identity.variant,
        status: 'active',
        seed_urls: [],
        added_at: nowIso(),
        added_by: isFullMode ? 'workbook_import' : 'seed'
      };
    }

    // Create input file
    if (storage) {
      const inputKey = `specs/inputs/${cat}/products/${pid}.json`;
      const exists = await storage.objectExists(inputKey);
      if (!exists) {
        const catEntry = catalog.products[pid];
        const inputFile = buildInputFile({
          productId: pid,
          category: cat,
          brand: identity.brand,
          model: identity.model,
          variant: identity.variant,
          id: catEntry.id,
          identifier: catEntry.identifier
        });
        await storage.writeObject(inputKey, Buffer.from(JSON.stringify(inputFile, null, 2)));
      }
    }

    // Full mode: write field value overrides (merge with existing, don't overwrite manual edits)
    if (isFullMode && row.canonical_fields && Object.keys(row.canonical_fields).length > 0) {
      const overrideDir = path.resolve(config?.helperFilesRoot || 'helper_files', cat, '_overrides');
      await fs.mkdir(overrideDir, { recursive: true });
      const overridePath = path.join(overrideDir, `${pid}.overrides.json`);
      const setAt = nowIso();

      // Load existing override file if updating an existing product
      let existingOverrideFile = null;
      if (isExisting) {
        try { existingOverrideFile = JSON.parse(await fs.readFile(overridePath, 'utf8')); } catch { /* no existing overrides */ }
      }
      const existingOverrides = existingOverrideFile?.overrides || {};

      const overrides = { ...existingOverrides };
      for (const [field, value] of Object.entries(row.canonical_fields)) {
        const trimmed = String(value ?? '').trim();
        if (!trimmed) continue;
        // Don't overwrite manual user edits (only replace workbook_import or missing entries)
        const prev = existingOverrides[field];
        if (prev && prev.override_source !== 'workbook_import') continue;
        overrides[field] = {
          field,
          override_source: 'workbook_import',
          candidate_index: null,
          override_value: trimmed,
          override_reason: 'Imported from workbook',
          override_provenance: null,
          overridden_by: null,
          overridden_at: setAt,
          validated: null,
          candidate_id: buildWorkbookFieldOverrideCandidateId({
            productId: pid,
            fieldKey: field,
            value: trimmed,
          }),
          value: trimmed,
          confidence: 0.99,
          source: {
            host: 'workbook.local',
            source_id: null,
            method: 'workbook_import',
            tier: 1,
            evidence_key: null
          },
          set_at: setAt
        };
        fieldsImported += 1;
      }
      if (Object.keys(overrides).length > 0) {
        const overrideFile = {
          version: 1,
          category: cat,
          product_id: pid,
          created_at: existingOverrideFile?.created_at || setAt,
          review_started_at: existingOverrideFile?.review_started_at || setAt,
          review_status: 'in_progress',
          updated_at: setAt,
          overrides
        };
        await fs.writeFile(overridePath, JSON.stringify(overrideFile, null, 2), 'utf8');
      }
    }

    if (!isExisting) seeded += 1;

    // Upsert queue
    if (upsertQueue) {
      const s3key = `specs/inputs/${cat}/products/${pid}.json`;
      await upsertQueue({ storage, category: cat, productId: pid, s3key, patch: { status: 'pending', next_action_hint: 'fast_pass' } });
    }
  }

  await saveProductCatalog(config, cat, catalog);

  return {
    ok: true,
    seeded,
    skipped,
    total: Object.keys(catalog.products).length,
    fields_imported: fieldsImported
  };
}

/**
 * List products from catalog.
 */
export async function listProducts(config, category) {
  const cat = String(category ?? '').trim().toLowerCase();
  if (!cat) return [];

  const catalog = await loadProductCatalog(config, cat);

  return Object.entries(catalog.products)
    .map(([pid, p]) => ({ productId: pid, ...p }))
    .sort((a, b) =>
      a.brand.localeCompare(b.brand) ||
      a.model.localeCompare(b.model) ||
      (a.variant || '').localeCompare(b.variant || '')
    );
}
