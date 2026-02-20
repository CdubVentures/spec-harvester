/**
 * Product Reconciler — scans existing product input files,
 * detects orphans with fabricated variants, and optionally removes them.
 *
 * An "orphan" is a product input file whose variant is fabricated
 * (variant tokens are a subset of model tokens) AND a canonical
 * version (without variant) already exists.
 */

import { isFabricatedVariant, cleanVariant } from './identityDedup.js';
import { buildProductId } from './slugify.js';
import { loadQueueState, saveQueueState } from '../queue/queueState.js';
import { loadCanonicalIdentityIndex } from './identityGate.js';

function normalizeToken(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function pairKey(brand, model) {
  const b = normalizeToken(brand);
  const m = normalizeToken(model);
  if (!b || !m) return '';
  return `${b}||${m}`;
}

function tupleKey(brand, model, variant) {
  return `${pairKey(brand, model)}||${normalizeToken(cleanVariant(variant))}`;
}

/**
 * Scan all product input files in a category and classify them.
 *
 * Returns:
 *   canonical[]  — products with no variant or a real variant
 *   orphans[]    — products with fabricated variants whose canonical exists
 *   warnings[]   — products with fabricated variants but NO canonical (needs manual review)
 */
export async function scanOrphans({ storage, category, config = {} }) {
  const keys = await storage.listInputKeys(category);

  const products = [];
  for (const key of keys) {
    const data = await storage.readJsonOrNull(key);
    if (!data) continue;
    const identity = data.identityLock || {};
    products.push({
      key,
      productId: data.productId,
      brand: identity.brand || '',
      model: identity.model || '',
      variant: identity.variant || '',
      hasSeed: Boolean(data.seed),
      seedSource: data.seed?.source || null
    });
  }

  const canonicalIndex = config?.helperFilesRoot
    ? await loadCanonicalIdentityIndex({
      config,
      category
    })
    : { source: 'none', pairVariants: new Map(), tupleToProductId: new Map() };
  const hasCanonicalSource = canonicalIndex.source !== 'none'
    && canonicalIndex.pairVariants.size > 0;

  if (hasCanonicalSource) {
    const canonical = [];
    const orphans = [];
    const untracked = [];

    for (const p of products) {
      const pPairKey = pairKey(p.brand, p.model);
      const canonicalVariants = canonicalIndex.pairVariants.get(pPairKey);
      const canonicalProductId = canonicalIndex.tupleToProductId.get(
        tupleKey(p.brand, p.model, p.variant)
      ) || '';

      if (canonicalProductId) {
        canonical.push({
          ...p,
          canonicalProductId
        });
        continue;
      }

      if (!canonicalVariants || canonicalVariants.size === 0) {
        untracked.push({
          ...p,
          reason: 'not_in_canonical_source'
        });
        continue;
      }

      if (cleanVariant(p.variant)) {
        const expectedCanonicalId = buildProductId(category, p.brand, p.model, '');
        const reason = isFabricatedVariant(p.model, p.variant)
          ? 'fabricated_variant_with_canonical'
          : 'variant_not_in_canonical';
        orphans.push({
          ...p,
          canonicalProductId: canonicalIndex.tupleToProductId.get(tupleKey(p.brand, p.model, ''))
            || expectedCanonicalId,
          reason
        });
        continue;
      }

      untracked.push({
        ...p,
        reason: 'canonical_variant_mismatch'
      });
    }

    return {
      category,
      canonical_source: canonicalIndex.source,
      total_scanned: products.length,
      canonical_count: canonical.length,
      orphan_count: orphans.length,
      warning_count: untracked.length,
      untracked_count: untracked.length,
      canonical,
      orphans,
      warnings: untracked,
      untracked
    };
  }

  // Build a set of canonical productIds (no variant or real variant)
  const canonicalIds = new Set();
  const canonical = [];
  const fabricated = [];

  for (const p of products) {
    if (isFabricatedVariant(p.model, p.variant)) {
      fabricated.push(p);
    } else {
      canonical.push(p);
      canonicalIds.add(p.productId);
    }
  }

  // Classify fabricated: orphan (canonical exists) vs warning (no canonical)
  const orphans = [];
  const warnings = [];

  for (const p of fabricated) {
    const expectedCanonicalId = buildProductId(category, p.brand, p.model, '');
    if (canonicalIds.has(expectedCanonicalId)) {
      orphans.push({
        ...p,
        canonicalProductId: expectedCanonicalId,
        reason: 'fabricated_variant_with_canonical'
      });
    } else {
      warnings.push({
        ...p,
        expectedCanonicalId,
        reason: 'fabricated_variant_no_canonical'
      });
    }
  }

  return {
    category,
    canonical_source: 'inputs_fallback',
    total_scanned: products.length,
    canonical_count: canonical.length,
    orphan_count: orphans.length,
    warning_count: warnings.length,
    untracked_count: warnings.length,
    canonical,
    orphans,
    warnings,
    untracked: warnings
  };
}

/**
 * Remove orphan product files and their queue entries.
 *
 * In dry-run mode, returns what WOULD be removed without modifying anything.
 */
export async function reconcileOrphans({
  storage,
  category,
  config = {},
  dryRun = true
}) {
  const scan = await scanOrphans({ storage, category, config });

  if (scan.orphan_count === 0) {
    return {
      command: 'product-reconcile',
      category,
      dry_run: dryRun,
      ...scan,
      deleted_count: 0,
      deleted: [],
      queue_cleaned: 0
    };
  }

  const deleted = [];
  let queueCleaned = 0;

  if (!dryRun) {
    // Load queue state once for batch removal
    const loaded = await loadQueueState({ storage, category });
    let queueChanged = false;

    for (const orphan of scan.orphans) {
      // Delete the product input file
      await storage.deleteObject(orphan.key);
      deleted.push({
        productId: orphan.productId,
        key: orphan.key,
        canonicalProductId: orphan.canonicalProductId
      });

      // Remove from queue if present
      if (loaded.state.products?.[orphan.productId]) {
        delete loaded.state.products[orphan.productId];
        queueCleaned += 1;
        queueChanged = true;
      }
    }

    if (queueChanged) {
      await saveQueueState({ storage, category, state: loaded.state });
    }
  }

  return {
    command: 'product-reconcile',
    category,
    dry_run: dryRun,
    total_scanned: scan.total_scanned,
    canonical_count: scan.canonical_count,
    orphan_count: scan.orphan_count,
    warning_count: scan.warning_count,
    untracked_count: scan.untracked_count || 0,
    deleted_count: dryRun ? 0 : deleted.length,
    deleted: dryRun ? scan.orphans.map(o => ({
      productId: o.productId,
      key: o.key,
      canonicalProductId: o.canonicalProductId,
      would_delete: true
    })) : deleted,
    warnings: scan.warnings,
    untracked: scan.untracked || [],
    queue_cleaned: queueCleaned
  };
}
