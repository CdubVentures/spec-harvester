import { normalizeToken } from '../utils/common.js';

function tokenize(value) {
  return normalizeToken(value)
    .split(' ')
    .filter(Boolean);
}

function includesAllTokens(haystack, needles) {
  return needles.every((token) => haystack.includes(token));
}

function tokenOverlapScore(expectedTokens, candidateText) {
  const candidateTokens = tokenize(candidateText);
  if (!expectedTokens.length || !candidateTokens.length) {
    return 0;
  }
  const expectedSet = new Set(expectedTokens);
  const matched = expectedTokens.filter((token) => candidateTokens.includes(token));
  const coverage = matched.length / expectedSet.size;

  const expectedNumeric = expectedTokens.filter((token) => /^\d+$/.test(token));
  const matchedNumeric = expectedNumeric.filter((token) => candidateTokens.includes(token));
  const numericBoost = expectedNumeric.length > 0 && matchedNumeric.length > 0 ? 0.1 : 0;
  return Math.min(1, coverage + numericBoost);
}

function likelyProductSpecificSource(source) {
  const rawUrl = String(source?.url || '');
  const url = rawUrl.toLowerCase();
  try {
    const parsed = new URL(rawUrl);
    const path = parsed.pathname.toLowerCase();
    const query = parsed.search.toLowerCase();
    const categoryHubSignals = [
      '/products/gaming-mice',
      '/products/mice',
      '/shop/c/',
      '/search',
      '/sitemap',
      '/robots.txt'
    ];
    if (categoryHubSignals.some((token) => path.includes(token))) {
      return false;
    }
    if (query.includes('q=') || query.includes('query=')) {
      return false;
    }
  } catch {
    // continue with heuristic fallback
  }

  const title = normalizeToken(source?.title || '');
  const signals = [
    '/product',
    '/products/',
    '/support/',
    '/manual',
    '/spec',
    '/download'
  ];
  if (signals.some((signal) => url.includes(signal))) {
    return true;
  }
  return title.includes('spec') || title.includes('support') || title.includes('manual');
}

function dynamicMatchThreshold(identityLock = {}) {
  const hasVariant = str(identityLock.variant) !== '';
  const hasStrongId = str(identityLock.sku) !== '' || str(identityLock.mpn) !== '' || str(identityLock.gtin) !== '';
  let threshold = 0.8;
  if (!hasVariant) {
    threshold -= 0.1;
  }
  if (!hasStrongId) {
    threshold -= 0.05;
  }
  return Math.max(0.65, Math.min(0.85, threshold));
}

function detectConnectionClass(value) {
  const token = normalizeToken(value);
  if (!token) {
    return 'unk';
  }
  if (token.includes('wireless') && token.includes('wired')) {
    return 'dual';
  }
  if (token.includes('wireless')) {
    return 'wireless';
  }
  if (token.includes('wired')) {
    return 'wired';
  }
  return 'unk';
}

function firstKnownClass(...classes) {
  for (const value of classes) {
    if (value && value !== 'unk') {
      return value;
    }
  }
  return 'unk';
}

function str(value) {
  return String(value || '').trim();
}

function firstFieldValue(source, field) {
  const hit = (source.fieldCandidates || []).find((row) => row.field === field && row.value !== 'unk');
  return hit?.value || null;
}

function dimensionConflict(values) {
  const nums = values
    .map((v) => Number.parseFloat(String(v)))
    .filter((n) => Number.isFinite(n));
  if (nums.length < 2) {
    return false;
  }
  return Math.max(...nums) - Math.min(...nums) > 1;
}

function buildIdentityCriticalContradictions(sources) {
  const contradictions = [];
  const accepted = sources.filter((s) => s.identity?.match && !s.discoveryOnly);

  const connectionValues = new Set(
    accepted
      .map((s) => firstFieldValue(s, 'connection'))
      .filter(Boolean)
      .map((v) => normalizeToken(v))
  );
  if (connectionValues.size > 1) {
    contradictions.push({ source: 'aggregate', conflict: 'connection_class_conflict' });
  }

  const sensorValues = new Set(
    accepted
      .map((s) => firstFieldValue(s, 'sensor'))
      .filter(Boolean)
      .map((v) => normalizeToken(v))
  );
  if (sensorValues.size > 1) {
    contradictions.push({ source: 'aggregate', conflict: 'sensor_family_conflict' });
  }

  const skuValues = new Set(
    accepted
      .map((s) => s.identityCandidates?.sku)
      .filter(Boolean)
      .map((v) => normalizeToken(v))
  );
  if (skuValues.size > 1) {
    contradictions.push({ source: 'aggregate', conflict: 'sku_conflict' });
  }

  const lengthValues = accepted.map((s) => firstFieldValue(s, 'lngth')).filter(Boolean);
  const widthValues = accepted.map((s) => firstFieldValue(s, 'width')).filter(Boolean);
  const heightValues = accepted.map((s) => firstFieldValue(s, 'height')).filter(Boolean);
  if (
    dimensionConflict(lengthValues) ||
    dimensionConflict(widthValues) ||
    dimensionConflict(heightValues)
  ) {
    contradictions.push({ source: 'aggregate', conflict: 'size_class_conflict' });
  }

  return contradictions;
}

export function evaluateSourceIdentity(source, identityLock = {}) {
  const candidate = source.identityCandidates || {};
  const reasons = [];
  const criticalConflicts = [];
  let score = 0;

  const expectedBrand = str(identityLock.brand);
  const expectedModel = str(identityLock.model);
  const expectedVariant = str(identityLock.variant);
  const expectedSku = str(identityLock.sku);
  const expectedMpn = str(identityLock.mpn);
  const expectedGtin = str(identityLock.gtin);

  const candidateBrandToken = normalizeToken(candidate.brand);
  const candidateModelToken = normalizeToken(candidate.model);
  const candidateVariantToken = normalizeToken(candidate.variant || source.connectionHint || '');

  if (expectedBrand) {
    const brandTokens = tokenize(expectedBrand);
    if (includesAllTokens(candidateBrandToken, brandTokens) || includesAllTokens(candidateModelToken, brandTokens)) {
      score += 0.35;
      reasons.push('brand_match');
    } else if (candidateBrandToken) {
      criticalConflicts.push('brand_mismatch');
    }
  } else {
    score += 0.1;
  }

  if (expectedModel) {
    const modelTokens = tokenize(expectedModel);
    const titleToken = normalizeToken(source.title || '');
    const urlToken = normalizeToken(source.url || '');
    const candidateModelOverlap = tokenOverlapScore(modelTokens, candidateModelToken);
    const titleOverlap = tokenOverlapScore(modelTokens, titleToken);
    const urlOverlap = tokenOverlapScore(modelTokens, urlToken);
    const bestModelOverlap = Math.max(candidateModelOverlap, titleOverlap, urlOverlap);

    if (
      includesAllTokens(candidateModelToken, modelTokens) ||
      includesAllTokens(titleToken, modelTokens) ||
      includesAllTokens(urlToken, modelTokens) ||
      bestModelOverlap >= 0.72 ||
      (
        bestModelOverlap >= 0.55 &&
        modelTokens.some((token) => /^\d+$/.test(token)) &&
        (
          candidateModelToken.includes(modelTokens.find((token) => /^\d+$/.test(token)) || '') ||
          titleToken.includes(modelTokens.find((token) => /^\d+$/.test(token)) || '') ||
          urlToken.includes(modelTokens.find((token) => /^\d+$/.test(token)) || '')
        )
      )
    ) {
      score += 0.35;
      reasons.push('model_match');
    } else if (candidateModelToken && likelyProductSpecificSource(source)) {
      criticalConflicts.push('model_mismatch');
    }
  } else {
    score += 0.1;
  }

  if (expectedVariant) {
    const expectedClass = detectConnectionClass(expectedVariant);
    const candidateClass = firstKnownClass(
      detectConnectionClass(candidateVariantToken),
      detectConnectionClass(source.connectionHint)
    );

    if (expectedClass === 'unk') {
      if (normalizeToken(expectedVariant) && normalizeToken(expectedVariant) === candidateVariantToken) {
        score += 0.15;
        reasons.push('variant_match');
      }
    } else if (candidateClass === expectedClass || candidateClass === 'dual') {
      score += 0.15;
      reasons.push('variant_match');
    } else if (candidateClass !== 'unk') {
      criticalConflicts.push('variant_mismatch');
    }
  } else {
    score += 0.05;
  }

  const idMatches = [];
  if (expectedSku) {
    if (normalizeToken(expectedSku) === normalizeToken(candidate.sku)) {
      idMatches.push('sku');
    } else if (candidate.sku) {
      criticalConflicts.push('sku_mismatch');
    }
  }
  if (expectedMpn) {
    if (normalizeToken(expectedMpn) === normalizeToken(candidate.mpn)) {
      idMatches.push('mpn');
    } else if (candidate.mpn) {
      criticalConflicts.push('mpn_mismatch');
    }
  }
  if (expectedGtin) {
    if (normalizeToken(expectedGtin) === normalizeToken(candidate.gtin)) {
      idMatches.push('gtin');
    } else if (candidate.gtin) {
      criticalConflicts.push('gtin_mismatch');
    }
  }

  if (idMatches.length > 0) {
    score += 0.15;
    reasons.push(`${idMatches.join('_')}_match`);
  }

  score = Math.max(0, Math.min(1, score));
  const matchThreshold = dynamicMatchThreshold(identityLock);
  const match = score >= matchThreshold && criticalConflicts.length === 0;

  return {
    match,
    score,
    matchThreshold,
    reasons,
    criticalConflicts
  };
}

export function evaluateIdentityGate(sourceResults) {
  const accepted = sourceResults.filter(
    (s) =>
      !s.discoveryOnly &&
      s.identity?.match &&
      (s.anchorCheck?.majorConflicts || []).length === 0 &&
      s.approvedDomain
  );

  const manufacturer = accepted.find(
    (s) => s.role === 'manufacturer' && s.tier === 1 && s.approvedDomain
  );
  const credibleAdditionalDomains = new Set(
    accepted
      .filter((s) => s.tier <= 2 && s.approvedDomain)
      .filter((s) => !manufacturer || s.rootDomain !== manufacturer.rootDomain)
      .map((s) => s.rootDomain)
  );

  const directContradictions = sourceResults
    .filter((s) => !s.discoveryOnly)
    .filter((s) => (s.identity?.criticalConflicts || []).length > 0)
    .filter((s) =>
      (s.identity?.score || 0) >= 0.45 ||
      (s.identity?.reasons || []).includes('model_match') ||
      (
        (s.identity?.reasons || []).includes('brand_match') &&
        (s.identity?.reasons || []).includes('variant_match') &&
        likelyProductSpecificSource(s)
      )
    )
    .flatMap((s) =>
      (s.identity?.criticalConflicts || []).map((conflict) => ({
        source: s.url,
        conflict
      }))
    );
  const crossSourceContradictions = buildIdentityCriticalContradictions(sourceResults);
  const contradictions = [...directContradictions, ...crossSourceContradictions];

  const majorAnchors = sourceResults.flatMap((s) =>
    (s.anchorCheck?.majorConflicts || []).map((c) => ({
      source: s.url,
      ...c
    }))
  );

  const hasManufacturer = Boolean(manufacturer);
  const hasAdditional = credibleAdditionalDomains.size >= 2;
  const noContradictions = contradictions.length === 0;
  const noMajorAnchorConflicts = majorAnchors.length === 0;

  const validated = hasManufacturer && hasAdditional && noContradictions && noMajorAnchorConflicts;

  let certainty = 0.4;
  if (hasManufacturer) certainty += 0.25;
  if (hasAdditional) certainty += 0.2;
  if (noContradictions) certainty += 0.1;
  if (noMajorAnchorConflicts) certainty += 0.1;
  if (accepted.length >= 3) certainty += 0.05;
  certainty = Math.max(0, Math.min(1, certainty));

  if (validated) {
    certainty = Math.max(certainty, 0.99);
  }

  let reason = 'OK';
  if (!validated) {
    reason = 'MODEL_AMBIGUITY_ALERT';
  }

  return {
    validated,
    reason,
    certainty,
    requirements: {
      hasManufacturer,
      additionalCredibleSources: credibleAdditionalDomains.size,
      noContradictions,
      noMajorAnchorConflicts
    },
    contradictions,
    majorAnchors,
    manufacturerSource: manufacturer?.url || null
  };
}
