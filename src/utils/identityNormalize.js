export function normalizeIdentityToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function ambiguityLevelFromFamilyCount(count = 0) {
  const n = Math.max(0, Number.parseInt(String(count || 0), 10) || 0);
  if (n >= 9) return 'extra_hard';
  if (n >= 6) return 'very_hard';
  if (n >= 4) return 'hard';
  if (n >= 2) return 'medium';
  if (n === 1) return 'easy';
  return 'unknown';
}

export function normalizeAmbiguityLevel(value = '', familyModelCount = 0) {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'easy' || token === 'low') return 'easy';
  if (token === 'medium' || token === 'mid') return 'medium';
  if (token === 'hard' || token === 'high') return 'hard';
  if (token === 'very_hard' || token === 'very-hard' || token === 'very hard') return 'very_hard';
  if (token === 'extra_hard' || token === 'extra-hard' || token === 'extra hard') return 'extra_hard';
  return ambiguityLevelFromFamilyCount(familyModelCount);
}

export function resolveIdentityLockStatus(identityLock = {}) {
  const brand = normalizeIdentityToken(identityLock?.brand);
  const model = normalizeIdentityToken(identityLock?.model);
  const variant = normalizeIdentityToken(identityLock?.variant);
  const sku = normalizeIdentityToken(identityLock?.sku);
  const lockCount = [brand, model, variant, sku].filter(Boolean).length;
  if (brand && model && (variant || sku)) {
    return 'locked_full';
  }
  if (brand && model) {
    return 'locked_brand_model';
  }
  if (lockCount > 0) {
    return 'locked_partial';
  }
  return 'unlocked';
}
