import {
  normalizeIdentityToken,
  ambiguityLevelFromFamilyCount,
  normalizeAmbiguityLevel
} from '../../utils/identityNormalize.js';
import { sha256 } from './cryptoHelpers.js';
import { loadProductCatalog } from '../../catalog/productCatalog.js';
import { toFloat } from './typeHelpers.js';

export async function resolveIdentityAmbiguitySnapshot({ config, category = '', identityLock = {} } = {}) {
  const brandToken = normalizeIdentityToken(identityLock?.brand);
  const modelToken = normalizeIdentityToken(identityLock?.model);
  if (!brandToken || !modelToken) {
    return {
      family_model_count: 0,
      ambiguity_level: 'unknown',
      source: 'missing_identity'
    };
  }

  try {
    const catalog = await loadProductCatalog(config || {}, String(category || '').trim().toLowerCase());
    const rows = Object.values(catalog?.products || {});
    const familyCount = rows.filter((row) =>
      normalizeIdentityToken(row?.brand) === brandToken
      && normalizeIdentityToken(row?.model) === modelToken
    ).length;
    const safeCount = Math.max(1, familyCount);
    return {
      family_model_count: safeCount,
      ambiguity_level: ambiguityLevelFromFamilyCount(safeCount),
      source: 'catalog'
    };
  } catch {
    return {
      family_model_count: 1,
      ambiguity_level: 'easy',
      source: 'fallback'
    };
  }
}

export function buildRunIdentityFingerprint({ category = '', productId = '', identityLock = {} } = {}) {
  const lockBrand = normalizeIdentityToken(identityLock?.brand);
  const lockModel = normalizeIdentityToken(identityLock?.model);
  const lockVariant = normalizeIdentityToken(identityLock?.variant);
  const lockSku = normalizeIdentityToken(identityLock?.sku);
  const seed = [
    normalizeIdentityToken(category),
    normalizeIdentityToken(productId),
    lockBrand,
    lockModel,
    lockVariant,
    lockSku
  ].join('|');
  return `sha256:${sha256(seed)}`;
}

export function bestIdentityFromSources(sourceResults, identityLock = {}) {
  const expectedVariant = normalizeIdentityToken(identityLock?.variant);
  const identityMatched = (sourceResults || []).filter((source) => source.identity?.match);
  const pool = identityMatched.length > 0 ? identityMatched : (sourceResults || []);
  const sorted = [...pool].sort((a, b) => {
    const aMatched = a.identity?.match ? 1 : 0;
    const bMatched = b.identity?.match ? 1 : 0;
    if (bMatched !== aMatched) {
      return bMatched - aMatched;
    }
    if ((b.identity?.score || 0) !== (a.identity?.score || 0)) {
      return (b.identity?.score || 0) - (a.identity?.score || 0);
    }

    const aVariant = normalizeIdentityToken(a.identityCandidates?.variant);
    const bVariant = normalizeIdentityToken(b.identityCandidates?.variant);
    const variantScore = (variant) => {
      if (expectedVariant) {
        if (variant === expectedVariant) {
          return 2;
        }
        if (variant && (variant.includes(expectedVariant) || expectedVariant.includes(variant))) {
          return 1;
        }
        if (!variant) {
          return 0.25;
        }
        return 0;
      }
      return variant ? 0 : 1;
    };
    const aVariantScore = variantScore(aVariant);
    const bVariantScore = variantScore(bVariant);
    if (bVariantScore !== aVariantScore) {
      return bVariantScore - aVariantScore;
    }

    return (a.tier || 99) - (b.tier || 99);
  });
  return sorted[0]?.identityCandidates || {};
}

export function isIdentityLockedField(field) {
  return ['id', 'brand', 'model', 'base_model', 'category', 'sku'].includes(field);
}

export function helperSupportsProvisionalFill(helperContext, identityLock = {}) {
  const topMatch = helperContext?.supportive_matches?.[0] || helperContext?.active_match || null;
  if (!topMatch) {
    return false;
  }

  const expectedBrand = normalizeIdentityToken(identityLock?.brand);
  const expectedModel = normalizeIdentityToken(identityLock?.model);
  if (!expectedBrand || !expectedModel) {
    return false;
  }

  const matchBrand = normalizeIdentityToken(topMatch.brand);
  const matchModel = normalizeIdentityToken(topMatch.model);
  if (matchBrand !== expectedBrand || matchModel !== expectedModel) {
    return false;
  }

  const expectedVariant = normalizeIdentityToken(identityLock?.variant);
  if (!expectedVariant) {
    return true;
  }

  const matchVariant = normalizeIdentityToken(topMatch.variant);
  if (!matchVariant) {
    return true;
  }

  return (
    matchVariant === expectedVariant ||
    matchVariant.includes(expectedVariant) ||
    expectedVariant.includes(matchVariant)
  );
}

export function deriveNeedSetIdentityState({
  identityGate = {},
  identityConfidence = 0
} = {}) {
  if (identityGate?.validated && Number(identityConfidence || 0) >= 0.95) {
    return 'locked';
  }
  const reasonCodes = Array.isArray(identityGate?.reasonCodes) ? identityGate.reasonCodes : [];
  const hasConflictCode = reasonCodes.some((row) => {
    const token = String(row || '').toLowerCase();
    return token.includes('conflict') || token.includes('mismatch') || token.includes('major_anchor');
  });
  if (hasConflictCode || identityGate?.status === 'IDENTITY_CONFLICT') {
    return 'conflict';
  }
  if (Number(identityConfidence || 0) >= 0.70) {
    return 'provisional';
  }
  return 'unlocked';
}

export function resolveExtractionGateOpen({
  identityLock = {},
  identityGate = {}
} = {}) {
  if (identityGate?.validated) {
    return true;
  }
  const reasonCodes = Array.isArray(identityGate?.reasonCodes) ? identityGate.reasonCodes : [];
  const hasHardConflict = reasonCodes.some((row) => {
    const token = String(row || '').toLowerCase();
    return token.includes('conflict') || token.includes('mismatch') || token.includes('major_anchor');
  }) || String(identityGate?.status || '').toUpperCase() === 'IDENTITY_CONFLICT';
  if (hasHardConflict) {
    return false;
  }
  const hasVariant = Boolean(normalizeIdentityToken(identityLock?.variant));
  if (hasVariant) {
    return false;
  }
  const familyCount = Math.max(0, Number.parseInt(String(identityLock?.family_model_count || 0), 10) || 0);
  const ambiguityLevel = normalizeAmbiguityLevel(
    identityLock?.ambiguity_level || ambiguityLevelFromFamilyCount(familyCount)
  );
  if (ambiguityLevel === 'hard' || ambiguityLevel === 'very_hard' || ambiguityLevel === 'extra_hard') {
    return false;
  }
  return Boolean(normalizeIdentityToken(identityLock?.brand) && normalizeIdentityToken(identityLock?.model));
}

export function buildNeedSetIdentityAuditRows(identityReport = {}, limit = 24) {
  const pages = Array.isArray(identityReport?.pages) ? identityReport.pages : [];
  return pages
    .map((row) => ({
      source_id: String(row?.source_id || '').trim(),
      url: String(row?.url || '').trim(),
      decision: String(row?.decision || '').trim().toUpperCase(),
      confidence: toFloat(row?.confidence, 0),
      reason_codes: Array.isArray(row?.reason_codes) ? row.reason_codes.slice(0, 12) : []
    }))
    .filter((row) => row.source_id || row.url)
    .slice(0, Math.max(1, Number(limit || 24)));
}
