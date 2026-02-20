/**
 * Identity Dedup Gate — prevents duplicate product input files
 * by detecting fabricated variants and normalizing identity before sync.
 *
 * A "fabricated variant" is one where the variant value is already
 * contained within the model name (e.g. model="Cestus 310", variant="310").
 * These duplicates arose from a legacy Excel seed with an empty variant row.
 */

import { slugify, buildProductId } from './slugify.js';

const VARIANT_PLACEHOLDERS = new Set([
  '', 'unk', 'unknown', 'na', 'n/a', 'none', 'null', '-', 'default'
]);

/**
 * Clean variant: strip placeholder values that don't represent real variants.
 */
export function cleanVariant(variant) {
  const trimmed = String(variant ?? '').trim();
  return VARIANT_PLACEHOLDERS.has(trimmed.toLowerCase()) ? '' : trimmed;
}

/**
 * Detect whether a variant is "fabricated" — i.e. its tokens are
 * already present in the model name, so it adds no distinguishing info.
 *
 * Examples:
 *   model="Cestus 310",   variant="310"        → fabricated (all variant tokens in model)
 *   model="Alienware Pro",variant="Pro"         → fabricated
 *   model="ROG Gladius III",variant="Gladius III"→ fabricated
 *   model="Viper V3 Pro", variant="Wireless"    → NOT fabricated (new info)
 *   model="Viper V3 Pro", variant=""            → NOT fabricated (empty)
 */
export function isFabricatedVariant(model, variant) {
  const cleanedVariant = cleanVariant(variant);
  if (!cleanedVariant) return false;

  const modelSlug = slugify(model);
  const variantSlug = slugify(cleanedVariant);
  if (!modelSlug || !variantSlug) return false;

  // Check if variant slug is a substring of model slug
  if (modelSlug.includes(variantSlug)) return true;

  // Token-level check: every token in the variant exists in the model
  const modelTokens = new Set(modelSlug.split('-'));
  const variantTokens = variantSlug.split('-');
  return variantTokens.length > 0 && variantTokens.every(t => modelTokens.has(t));
}

/**
 * Normalize a product identity for sync — strips fabricated variants
 * and produces a canonical productId.
 *
 * Returns { productId, brand, model, variant, wasCleaned, reason }
 */
export function normalizeProductIdentity(category, brand, model, variant) {
  const cleanedBrand = String(brand ?? '').trim();
  const cleanedModel = String(model ?? '').trim();
  let cleanedVariant = cleanVariant(variant);
  let wasCleaned = false;
  let reason = null;

  if (cleanedVariant && isFabricatedVariant(cleanedModel, cleanedVariant)) {
    cleanedVariant = '';
    wasCleaned = true;
    reason = 'fabricated_variant_stripped';
  }

  const productId = buildProductId(category, cleanedBrand, cleanedModel, cleanedVariant);

  return {
    productId,
    brand: cleanedBrand,
    model: cleanedModel,
    variant: cleanedVariant,
    wasCleaned,
    reason
  };
}
