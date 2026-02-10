import { nowIso, normalizeToken } from '../utils/common.js';

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function tokenize(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

function ensureBrand(artifact, brand) {
  const brandKey = slug(brand);
  if (!artifact.brands[brandKey]) {
    artifact.brands[brandKey] = {
      brand,
      brand_key: brandKey,
      models: {},
      updated_at: nowIso()
    };
  }
  return artifact.brands[brandKey];
}

function ensureModel(brandRow, model) {
  const modelKey = slug(model);
  if (!brandRow.models[modelKey]) {
    brandRow.models[modelKey] = {
      model,
      model_key: modelKey,
      count: 0,
      variant_tokens: {},
      sku_prefixes: {},
      mpn_prefixes: {},
      gtin_prefixes: {},
      updated_at: nowIso()
    };
  }
  return brandRow.models[modelKey];
}

function bumpMap(map, key) {
  if (!key) {
    return;
  }
  map[key] = (map[key] || 0) + 1;
}

function tokenPrefix(value, length = 5) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return text.slice(0, length).toUpperCase();
}

export function defaultIdentityGrammar() {
  return {
    version: 1,
    updated_at: nowIso(),
    brands: {},
    normalization_rules: {
      token_aliases: {}
    },
    stats: {
      updates_total: 0,
      validated_updates: 0
    }
  };
}

export function updateIdentityGrammar({
  artifact,
  job,
  normalized,
  summary,
  seenAt = nowIso()
}) {
  const next = artifact && typeof artifact === 'object'
    ? artifact
    : defaultIdentityGrammar();
  next.stats = next.stats || {
    updates_total: 0,
    validated_updates: 0
  };
  next.stats.updates_total += 1;

  const identity = {
    brand: normalized?.identity?.brand || job?.identityLock?.brand || '',
    model: normalized?.identity?.model || job?.identityLock?.model || '',
    variant: normalized?.identity?.variant || job?.identityLock?.variant || '',
    sku: normalized?.identity?.sku || job?.identityLock?.sku || '',
    mpn: normalized?.identity?.mpn || job?.identityLock?.mpn || '',
    gtin: normalized?.identity?.gtin || job?.identityLock?.gtin || ''
  };
  if (!identity.brand || !identity.model) {
    next.updated_at = seenAt;
    return next;
  }

  const validated = Boolean(summary?.identity_gate_validated);
  if (validated) {
    next.stats.validated_updates += 1;
  }

  const brandRow = ensureBrand(next, identity.brand);
  const modelRow = ensureModel(brandRow, identity.model);
  modelRow.count += 1;

  for (const token of tokenize(identity.variant)) {
    bumpMap(modelRow.variant_tokens, token);
  }
  bumpMap(modelRow.sku_prefixes, tokenPrefix(identity.sku));
  bumpMap(modelRow.mpn_prefixes, tokenPrefix(identity.mpn));
  bumpMap(modelRow.gtin_prefixes, tokenPrefix(identity.gtin, 6));

  const modelAlias = normalizeToken(identity.model).replace(/\bii\b/g, '2').replace(/\biii\b/g, '3');
  const canonical = normalizeToken(identity.model);
  if (modelAlias && canonical && modelAlias !== canonical) {
    next.normalization_rules.token_aliases[modelAlias] = canonical;
  }

  modelRow.updated_at = seenAt;
  brandRow.updated_at = seenAt;
  next.updated_at = seenAt;
  return next;
}
