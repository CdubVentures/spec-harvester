/**
 * Brand Registry — global brand management across all categories.
 *
 * Stored at: helper_files/_global/brand_registry.json
 * Managed by: GUI Brand Manager tab + API
 *
 * A brand is global — it can belong to multiple categories (e.g. Razer → mouse, keyboard, headset).
 * The registry is the single source for brand names, aliases, and category assignments.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { slugify } from './slugify.js';
import { loadWorkbookProducts, discoverCategoriesLocal } from './workbookProductLoader.js';
import { generateIdentifier } from './productIdentity.js';
import { loadProductCatalog, updateProduct as catalogUpdateProduct } from './productCatalog.js';
import { loadActiveFilteringData } from './activeFilteringLoader.js';

function registryPath(config) {
  const root = config?.helperFilesRoot || 'helper_files';
  return path.resolve(root, '_global', 'brand_registry.json');
}

function nowIso() {
  return new Date().toISOString();
}

function emptyRegistry() {
  return {
    _doc: 'Global brand registry. Managed by GUI.',
    _version: 1,
    brands: {}
  };
}

/**
 * Load the brand registry. Returns empty registry if file doesn't exist.
 */
export async function loadBrandRegistry(config) {
  const filePath = registryPath(config);
  try {
    const text = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || !data.brands) {
      return emptyRegistry();
    }

    // Backfill identifiers for brands that predate the identifier feature
    let needsSave = false;
    for (const brand of Object.values(data.brands)) {
      if (!brand.identifier) {
        brand.identifier = generateIdentifier();
        needsSave = true;
      }
    }
    if (needsSave) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    }

    return data;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return emptyRegistry();
    }
    throw err;
  }
}

/**
 * Save the brand registry atomically.
 */
export async function saveBrandRegistry(config, registry) {
  const filePath = registryPath(config);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(registry, null, 2), 'utf8');
  return registry;
}

/**
 * Add a new brand. Returns { ok, slug, brand } or { ok: false, error }.
 */
export async function addBrand({ config, name, aliases = [], categories = [], website = '' }) {
  const trimmedName = String(name ?? '').trim();
  if (!trimmedName) {
    return { ok: false, error: 'brand_name_required' };
  }

  const brandSlug = slugify(trimmedName);
  if (!brandSlug) {
    return { ok: false, error: 'brand_name_invalid' };
  }

  const registry = await loadBrandRegistry(config);

  if (registry.brands[brandSlug]) {
    return { ok: false, error: 'brand_already_exists', slug: brandSlug };
  }

  const cleanAliases = (Array.isArray(aliases) ? aliases : [])
    .map(a => String(a).trim())
    .filter(Boolean);

  const cleanCategories = (Array.isArray(categories) ? categories : [])
    .map(c => String(c).trim().toLowerCase())
    .filter(Boolean);

  const brand = {
    canonical_name: trimmedName,
    identifier: generateIdentifier(),
    aliases: cleanAliases,
    categories: cleanCategories,
    website: String(website ?? '').trim(),
    added_at: nowIso(),
    added_by: 'gui'
  };

  registry.brands[brandSlug] = brand;
  await saveBrandRegistry(config, registry);

  return { ok: true, slug: brandSlug, brand };
}

/**
 * Update an existing brand. Only patches provided fields.
 */
export async function updateBrand({ config, slug, patch = {} }) {
  const brandSlug = String(slug ?? '').trim();
  if (!brandSlug) {
    return { ok: false, error: 'slug_required' };
  }

  const registry = await loadBrandRegistry(config);
  const existing = registry.brands[brandSlug];
  if (!existing) {
    return { ok: false, error: 'brand_not_found', slug: brandSlug };
  }

  if (patch.name !== undefined) {
    existing.canonical_name = String(patch.name).trim();
  }
  if (patch.aliases !== undefined) {
    existing.aliases = (Array.isArray(patch.aliases) ? patch.aliases : [])
      .map(a => String(a).trim())
      .filter(Boolean);
  }
  if (patch.categories !== undefined) {
    existing.categories = (Array.isArray(patch.categories) ? patch.categories : [])
      .map(c => String(c).trim().toLowerCase())
      .filter(Boolean);
  }
  if (patch.website !== undefined) {
    existing.website = String(patch.website).trim();
  }

  existing.updated_at = nowIso();
  registry.brands[brandSlug] = existing;
  await saveBrandRegistry(config, registry);

  return { ok: true, slug: brandSlug, brand: existing };
}

/**
 * Remove a brand from the registry.
 */
export async function removeBrand({ config, slug, force = false }) {
  const brandSlug = String(slug ?? '').trim();
  if (!brandSlug) {
    return { ok: false, error: 'slug_required' };
  }

  const registry = await loadBrandRegistry(config);
  const brand = registry.brands[brandSlug];
  if (!brand) {
    return { ok: false, error: 'brand_not_found', slug: brandSlug };
  }

  const productsByCategory = {};
  let totalProducts = 0;
  for (const category of brand.categories || []) {
    const catalog = await loadProductCatalog(config, category);
    const count = Object.values(catalog.products || {})
      .filter((row) => row.brand === brand.canonical_name).length;
    productsByCategory[category] = count;
    totalProducts += count;
  }

  if (totalProducts > 0 && !force) {
    return {
      ok: false,
      error: 'brand_in_use',
      slug: brandSlug,
      warning: `${totalProducts} products reference this brand`,
      total_products: totalProducts,
      products_by_category: productsByCategory
    };
  }

  delete registry.brands[brandSlug];
  await saveBrandRegistry(config, registry);

  return {
    ok: true,
    slug: brandSlug,
    removed: true,
    total_products: totalProducts,
    products_by_category: productsByCategory
  };
}

/**
 * Get all brands for a specific category.
 */
export function getBrandsForCategory(registry, category) {
  const cat = String(category ?? '').trim().toLowerCase();
  if (!cat) return [];

  return Object.entries(registry.brands || {})
    .filter(([, brand]) => brand.categories.includes(cat))
    .map(([slug, brand]) => ({ slug, ...brand }))
    .sort((a, b) => a.canonical_name.localeCompare(b.canonical_name));
}

/**
 * Find a brand by name or alias. Returns { slug, brand } or null.
 */
export function findBrandByAlias(registry, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return null;

  for (const [slug, brand] of Object.entries(registry.brands || {})) {
    if (brand.canonical_name.toLowerCase() === q) {
      return { slug, ...brand };
    }
    if (brand.aliases?.some(a => a.toLowerCase() === q)) {
      return { slug, ...brand };
    }
  }
  return null;
}

/**
 * Seed brands from activeFiltering data.
 * Uses product catalog categories first; falls back to activeFiltering source when catalog is absent.
 */
export async function seedBrandsFromActiveFiltering({ config, category = 'all', extraCategories = [] }) {
  const root = config?.helperFilesRoot || 'helper_files';
  const cat = String(category ?? '').trim().toLowerCase();
  const categories = cat && cat !== 'all'
    ? [cat]
    : [...new Set([...(await discoverCategoriesLocal({ helperFilesRoot: root })), ...extraCategories])].sort();

  if (categories.length === 0) {
    return { ok: true, seeded: 0, skipped: 0, categories_scanned: 0, total_brands: 0 };
  }

  const registry = await loadBrandRegistry(config);
  const brandMap = new Map(); // slug -> { canonical, cats:Set }

  for (const categoryName of categories) {
    const rows = await loadActiveFilteringData({
      helperFilesRoot: root,
      category: categoryName
    });
    if (!Array.isArray(rows) || rows.length === 0) continue;

    for (const row of rows) {
      const brandName = String(row?.brand ?? '').trim();
      if (!brandName) continue;
      const brandSlug = slugify(brandName);
      if (!brandSlug) continue;
      if (!brandMap.has(brandSlug)) {
        brandMap.set(brandSlug, { canonical: brandName, cats: new Set() });
      }
      brandMap.get(brandSlug).cats.add(categoryName);
    }
  }

  let seeded = 0;
  let skipped = 0;
  for (const [brandSlug, { canonical, cats: brandCats }] of brandMap.entries()) {
    if (registry.brands[brandSlug]) {
      const existing = registry.brands[brandSlug];
      const merged = new Set([...(existing.categories || []), ...brandCats]);
      existing.categories = [...merged].sort();
      skipped += 1;
      continue;
    }
    registry.brands[brandSlug] = {
      canonical_name: canonical,
      identifier: generateIdentifier(),
      aliases: [],
      categories: [...brandCats].sort(),
      website: '',
      added_at: nowIso(),
      added_by: 'seed'
    };
    seeded += 1;
  }

  await saveBrandRegistry(config, registry);
  return {
    ok: true,
    seeded,
    skipped,
    categories_scanned: categories.length,
    total_brands: Object.keys(registry.brands || {}).length
  };
}

/**
 * Seed brands from workbook data.
 * If `category` is provided (and not 'all'), only scan that single category's workbook.
 * If `category` is 'all' or omitted, scan all category directories.
 * Reads product identities from the Excel workbook configured via Mapping Studio.
 * Extracts unique brands, infers category membership, writes registry.
 * Skips brands that already exist (merges categories).
 */
export async function seedBrandsFromWorkbook({ config, category = 'all', extraCategories = [] }) {
  const root = config?.helperFilesRoot || 'helper_files';

  let categories;
  const cat = String(category ?? '').trim().toLowerCase();
  if (cat && cat !== 'all') {
    // Single category mode — only scan the selected category
    categories = [cat];
  } else {
    // All mode — discover from local dirs + any explicit extras
    const localCats = await discoverCategoriesLocal({ helperFilesRoot: root });
    const cats = new Set([...localCats, ...extraCategories]);
    categories = [...cats].sort();
  }

  if (categories.length === 0) {
    return { ok: true, seeded: 0, skipped: 0, categories_scanned: 0, total_brands: 0 };
  }

  const registry = await loadBrandRegistry(config);
  const brandMap = new Map(); // slug → { canonical, cats }

  for (const category of categories) {
    const products = await loadWorkbookProducts({ category, config });
    if (!products || products.length === 0) continue;

    for (const row of products) {
      const brand = String(row.brand ?? '').trim();
      if (!brand) continue;

      const brandSlug = slugify(brand);
      if (!brandSlug) continue;

      if (!brandMap.has(brandSlug)) {
        brandMap.set(brandSlug, { canonical: brand, cats: new Set() });
      }
      brandMap.get(brandSlug).cats.add(category);
    }
  }

  let seeded = 0;
  let skipped = 0;

  for (const [brandSlug, { canonical, cats: brandCats }] of brandMap) {
    if (registry.brands[brandSlug]) {
      // Brand exists — merge categories
      const existing = registry.brands[brandSlug];
      const merged = new Set([...existing.categories, ...brandCats]);
      existing.categories = [...merged].sort();
      skipped += 1;
      continue;
    }

    registry.brands[brandSlug] = {
      canonical_name: canonical,
      identifier: generateIdentifier(),
      aliases: [],
      categories: [...brandCats].sort(),
      website: '',
      added_at: nowIso(),
      added_by: 'seed'
    };
    seeded += 1;
  }

  await saveBrandRegistry(config, registry);

  return {
    ok: true,
    seeded,
    skipped,
    categories_scanned: categories.length,
    total_brands: Object.keys(registry.brands).length
  };
}

/**
 * Rename a brand. Cascades slug/name changes to all product catalogs.
 *
 * When the brand name changes:
 * 1. Registry entry moves from old slug → new slug (identifier preserved)
 * 2. Old canonical name added to aliases
 * 3. Every product with brand === oldCanonicalName is updated via updateProduct()
 *    (which handles slug rebuild + artifact migration automatically)
 *
 * @returns {{ ok, oldSlug, newSlug, identifier, cascaded_products, cascade_failures, cascade_results[] }}
 */
export async function renameBrand({ config, slug, newName, storage, upsertQueue }) {
  const oldSlug = String(slug ?? '').trim();
  if (!oldSlug) return { ok: false, error: 'slug_required' };

  const trimmedNew = String(newName ?? '').trim();
  if (!trimmedNew) return { ok: false, error: 'new_name_required' };

  const registry = await loadBrandRegistry(config);
  const existing = registry.brands[oldSlug];
  if (!existing) return { ok: false, error: 'brand_not_found', slug: oldSlug };

  const newSlug = slugify(trimmedNew);
  if (!newSlug) return { ok: false, error: 'new_name_invalid' };

  const oldCanonicalName = existing.canonical_name;

  // If slug collides with a different brand, reject
  if (newSlug !== oldSlug && registry.brands[newSlug]) {
    return { ok: false, error: 'brand_already_exists', slug: newSlug };
  }

  // Move registry entry if slug changed
  if (newSlug !== oldSlug) {
    registry.brands[newSlug] = existing;
    delete registry.brands[oldSlug];
  }

  // Update canonical name
  existing.canonical_name = trimmedNew;

  // Add old canonical name to aliases (backward compatibility) if not already present
  if (!existing.aliases.some(a => a.toLowerCase() === oldCanonicalName.toLowerCase())) {
    existing.aliases = [...existing.aliases, oldCanonicalName];
  }

  // Record rename history on the brand
  existing.rename_history = [
    ...(existing.rename_history || []),
    {
      previous_slug: oldSlug,
      previous_name: oldCanonicalName,
      renamed_at: nowIso()
    }
  ];

  existing.updated_at = nowIso();
  await saveBrandRegistry(config, registry);

  // Append to global brand rename log
  await appendBrandRenameLog(config, {
    identifier: existing.identifier,
    old_slug: oldSlug,
    new_slug: newSlug,
    old_name: oldCanonicalName,
    new_name: trimmedNew
  });

  // Cascade to all product catalogs in every category the brand belongs to
  const cascade_results = [];
  let cascaded_products = 0;
  let cascade_failures = 0;

  for (const category of existing.categories) {
    const catalog = await loadProductCatalog(config, category);
    const productsToUpdate = Object.entries(catalog.products || {})
      .filter(([, p]) => p.brand === oldCanonicalName);

    for (const [pid, product] of productsToUpdate) {
      try {
        const result = await catalogUpdateProduct({
          config,
          category,
          productId: pid,
          patch: { brand: trimmedNew },
          storage: storage || null,
          upsertQueue: upsertQueue || null
        });
        cascade_results.push({
          category,
          old_pid: pid,
          new_pid: result.productId,
          ok: result.ok,
          migration: result.migration || null
        });
        if (result.ok) cascaded_products++;
        else cascade_failures++;
      } catch (err) {
        cascade_results.push({
          category,
          old_pid: pid,
          new_pid: null,
          ok: false,
          error: err.message || String(err)
        });
        cascade_failures++;
      }
    }
  }

  return {
    ok: cascade_failures === 0,
    oldSlug,
    newSlug,
    identifier: existing.identifier,
    oldName: oldCanonicalName,
    newName: trimmedNew,
    cascaded_products,
    cascade_failures,
    cascade_results
  };
}

/**
 * Get impact analysis for a brand rename/delete.
 * Counts products per category that reference this brand.
 */
export async function getBrandImpactAnalysis({ config, slug }) {
  const brandSlug = String(slug ?? '').trim();
  if (!brandSlug) return { ok: false, error: 'slug_required' };

  const registry = await loadBrandRegistry(config);
  const existing = registry.brands[brandSlug];
  if (!existing) return { ok: false, error: 'brand_not_found', slug: brandSlug };

  const products_by_category = {};
  const product_details = {};
  let total_products = 0;

  for (const category of existing.categories) {
    const catalog = await loadProductCatalog(config, category);
    const matched = Object.entries(catalog.products || {})
      .filter(([, p]) => p.brand === existing.canonical_name);
    products_by_category[category] = matched.length;
    product_details[category] = matched.map(([pid]) => pid);
    total_products += matched.length;
  }

  return {
    ok: true,
    slug: brandSlug,
    identifier: existing.identifier,
    canonical_name: existing.canonical_name,
    categories: existing.categories,
    products_by_category,
    product_details,
    total_products
  };
}

/**
 * Append an entry to the global brand rename log.
 * Stored at: helper_files/_global/brand_rename_log.json
 */
export async function appendBrandRenameLog(config, entry) {
  const root = config?.helperFilesRoot || 'helper_files';
  const logPath = path.resolve(root, '_global', 'brand_rename_log.json');

  let log;
  try {
    const text = await fs.readFile(logPath, 'utf8');
    log = JSON.parse(text);
    if (!log || !Array.isArray(log.entries)) {
      log = { _doc: 'Log of all brand renames. Append-only.', entries: [] };
    }
  } catch {
    log = { _doc: 'Log of all brand renames. Append-only.', entries: [] };
  }

  log.entries.push({
    ...entry,
    renamed_at: entry.renamed_at || nowIso()
  });

  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.writeFile(logPath, JSON.stringify(log, null, 2), 'utf8');
}
