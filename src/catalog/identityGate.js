/**
 * Identity Dedup Gate (Phase 15.1A)
 *
 * Gate decisions are based on a canonical identity set loaded from:
 * 1) product_catalog.json (preferred)
 * 2) activeFiltering.json (fallback)
 */

import { buildProductId, slugify } from './slugify.js';
import { cleanVariant, isFabricatedVariant } from './identityDedup.js';
import { loadProductCatalog } from './productCatalog.js';
import { loadActiveFilteringData } from './activeFilteringLoader.js';

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeToken(value) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, ' ');
}

function pairKey(brand, model) {
  const b = normalizeToken(brand);
  const m = normalizeToken(model);
  if (!b || !m) return '';
  return `${b}||${m}`;
}

function tupleKey(brand, model, variant) {
  const base = pairKey(brand, model);
  if (!base) return '';
  return `${base}||${normalizeToken(cleanVariant(variant))}`;
}

function firstCanonicalProductId(index, brand, model) {
  const variants = index.pairVariants.get(pairKey(brand, model));
  if (!variants || variants.size === 0) return '';
  for (const variant of variants) {
    const pid = index.tupleToProductId.get(tupleKey(brand, model, variant));
    if (pid) return pid;
  }
  return '';
}

export function buildCanonicalIdentityIndex({
  category,
  source = 'none',
  products = []
}) {
  const cat = normalizeText(category).toLowerCase();
  const pairVariants = new Map();
  const tupleToProductId = new Map();

  for (const row of Array.isArray(products) ? products : []) {
    const brand = normalizeText(row.brand);
    const model = normalizeText(row.model);
    if (!brand || !model) continue;
    const variant = cleanVariant(row.variant);

    const pKey = pairKey(brand, model);
    if (!pairVariants.has(pKey)) pairVariants.set(pKey, new Set());
    pairVariants.get(pKey).add(normalizeToken(variant));

    const pid = normalizeText(row.productId) || buildProductId(cat, brand, model, variant);
    tupleToProductId.set(tupleKey(brand, model, variant), pid);
  }

  return {
    category: cat,
    source,
    pairVariants,
    tupleToProductId
  };
}

export async function loadCanonicalIdentityIndex({ config, category }) {
  const cat = normalizeText(category).toLowerCase();
  const catalog = await loadProductCatalog(config, cat);
  const catalogEntries = Object.entries(catalog.products || {});

  if (catalogEntries.length > 0) {
    const products = catalogEntries.map(([productId, row]) => ({
      productId,
      brand: row.brand,
      model: row.model,
      variant: row.variant || ''
    }));
    return buildCanonicalIdentityIndex({
      category: cat,
      source: 'product_catalog',
      products
    });
  }

  const activeFiltering = await loadActiveFilteringData({
    helperFilesRoot: config?.helperFilesRoot,
    category: cat
  });

  if (Array.isArray(activeFiltering) && activeFiltering.length > 0) {
    const products = activeFiltering.map((row) => ({
      productId: buildProductId(cat, row.brand, row.model, cleanVariant(row.variant)),
      brand: row.brand,
      model: row.model,
      variant: row.variant || ''
    }));
    return buildCanonicalIdentityIndex({
      category: cat,
      source: 'active_filtering',
      products
    });
  }

  return buildCanonicalIdentityIndex({
    category: cat,
    source: 'none',
    products: []
  });
}

export function evaluateIdentityGate({
  category,
  brand,
  model,
  variant = '',
  canonicalIndex
}) {
  const cat = normalizeText(category).toLowerCase();
  const cleanBrand = normalizeText(brand);
  const cleanModel = normalizeText(model);
  const cleanVar = cleanVariant(variant);

  if (!cleanBrand || !cleanModel) {
    return {
      valid: false,
      reason: 'identity_incomplete',
      canonicalProductId: '',
      normalized: {
        brand: cleanBrand,
        model: cleanModel,
        variant: cleanVar,
        productId: ''
      }
    };
  }

  const normalized = {
    brand: cleanBrand,
    model: cleanModel,
    variant: cleanVar,
    productId: buildProductId(cat, cleanBrand, cleanModel, cleanVar)
  };

  if (cleanVar && isFabricatedVariant(cleanModel, cleanVar)) {
    const canonicalProductId =
      canonicalIndex?.tupleToProductId?.get(tupleKey(cleanBrand, cleanModel, ''))
      || buildProductId(cat, cleanBrand, cleanModel, '');
    return {
      valid: false,
      reason: 'variant_is_model_substring',
      canonicalProductId,
      normalized
    };
  }

  const pKey = pairKey(cleanBrand, cleanModel);
  const knownVariants = canonicalIndex?.pairVariants?.get(pKey);
  if (!knownVariants || knownVariants.size === 0) {
    return {
      valid: true,
      reason: null,
      canonicalProductId: normalized.productId,
      normalized
    };
  }

  const variantToken = normalizeToken(cleanVar);
  if (knownVariants.has(variantToken)) {
    const canonicalProductId =
      canonicalIndex?.tupleToProductId?.get(tupleKey(cleanBrand, cleanModel, cleanVar))
      || normalized.productId;
    return {
      valid: true,
      reason: null,
      canonicalProductId,
      normalized
    };
  }

  if (variantToken && knownVariants.has('')) {
    return {
      valid: false,
      reason: 'canonical_without_variant_exists',
      canonicalProductId:
        canonicalIndex?.tupleToProductId?.get(tupleKey(cleanBrand, cleanModel, ''))
        || buildProductId(cat, cleanBrand, cleanModel, ''),
      normalized
    };
  }

  if (!variantToken && knownVariants.size > 0) {
    return {
      valid: false,
      reason: 'canonical_variant_exists',
      canonicalProductId: firstCanonicalProductId(canonicalIndex, cleanBrand, cleanModel),
      normalized
    };
  }

  return {
    valid: false,
    reason: 'variant_conflict',
    canonicalProductId: firstCanonicalProductId(canonicalIndex, cleanBrand, cleanModel),
    normalized
  };
}

export function registerCanonicalIdentity({
  canonicalIndex,
  brand,
  model,
  variant = '',
  productId = ''
}) {
  if (!canonicalIndex) return;
  const cleanBrand = normalizeText(brand);
  const cleanModel = normalizeText(model);
  if (!cleanBrand || !cleanModel) return;
  const cleanVar = cleanVariant(variant);

  const pKey = pairKey(cleanBrand, cleanModel);
  if (!canonicalIndex.pairVariants.has(pKey)) {
    canonicalIndex.pairVariants.set(pKey, new Set());
  }
  canonicalIndex.pairVariants.get(pKey).add(normalizeToken(cleanVar));

  const pid = normalizeText(productId)
    || buildProductId(canonicalIndex.category, cleanBrand, cleanModel, cleanVar);
  canonicalIndex.tupleToProductId.set(tupleKey(cleanBrand, cleanModel, cleanVar), pid);
}

export function maybeCanonicalProductId(category, brand, model, variant = '') {
  const cat = normalizeText(category).toLowerCase();
  if (!cat || !normalizeText(brand) || !normalizeText(model)) return '';
  return buildProductId(cat, normalizeText(brand), normalizeText(model), cleanVariant(variant));
}

export function normalizeIdentityForGate(brand, model, variant = '') {
  return {
    brand: normalizeText(brand),
    model: normalizeText(model),
    variant: cleanVariant(variant),
    brand_slug: slugify(brand),
    model_slug: slugify(model),
    variant_slug: slugify(cleanVariant(variant))
  };
}
