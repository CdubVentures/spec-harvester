/**
 * Canonical slugify — matches the production site's slug formula exactly.
 * ALL slug generation in this codebase MUST use this function.
 */

export function slugify(str) {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildProductId(category, brand, model, variant) {
  return [slugify(category), slugify(brand), slugify(model), slugify(variant)]
    .filter(Boolean)
    .join('-');
}
