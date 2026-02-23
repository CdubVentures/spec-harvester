function normalizeToken(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function serializePart(value) {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function hashParts(parts) {
  const input = parts.map((part) => serializePart(part)).join('\u001f');
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function tokenPart(value, fallback = 'na') {
  const token = normalizeToken(serializePart(value));
  if (!token) {
    return fallback;
  }
  return token.length > 48 ? token.slice(0, 48) : token;
}

export function buildCandidateId(prefix, parts = []) {
  const safePrefix = tokenPart(prefix, 'cand');
  const tokens = Array.isArray(parts)
    ? parts.map((part) => tokenPart(part)).filter(Boolean)
    : [tokenPart(parts)];
  const hash = hashParts([safePrefix, ...parts]);
  return [safePrefix, ...tokens, hash].join('_');
}

export function buildSyntheticGridCandidateId({ productId, fieldKey, value }) {
  return buildCandidateId('pl_grid', [productId, fieldKey, value]);
}

export function buildSyntheticGridAttributeCandidateId({ productId, fieldKey, attributeKey, value }) {
  return buildCandidateId('pl_grid_attr', [productId, fieldKey, attributeKey, value]);
}

export function buildComponentReviewSyntheticCandidateId({ productId, fieldKey, reviewId, value }) {
  return buildCandidateId('pl_cr', [productId, fieldKey, reviewId || value, value]);
}

export function buildSyntheticComponentCandidateId({ componentType, componentName, componentMaker, propertyKey, value }) {
  const baseParts = [componentType, componentName, propertyKey, value];
  const withMaker = componentMaker !== undefined
    ? [componentType, componentName, componentMaker, propertyKey, value]
    : baseParts;
  return buildCandidateId('pl_comp', withMaker);
}

export function buildReferenceComponentCandidateId({ componentType, componentName, componentMaker, propertyKey, value = '' }) {
  const baseParts = [componentType, componentName, propertyKey, value];
  const withMaker = componentMaker !== undefined
    ? [componentType, componentName, componentMaker, propertyKey, value]
    : baseParts;
  return buildCandidateId('ref_comp', withMaker);
}

export function buildPipelineEnumCandidateId({ fieldKey, value }) {
  return buildCandidateId('pl_enum', [fieldKey, value]);
}

export function buildReferenceEnumCandidateId({ fieldKey, value }) {
  return buildCandidateId('ref_enum', [fieldKey, value]);
}

export function buildUserFieldOverrideCandidateId({ productId, fieldKey, value = '' }) {
  return buildCandidateId('user_item', [productId, fieldKey, value]);
}

export function buildManualOverrideCandidateId({ category, productId, fieldKey, value, evidenceUrl = '', evidenceQuote = '' }) {
  return buildCandidateId('manual_item', [category, productId, fieldKey, value, evidenceUrl, evidenceQuote]);
}

export function buildFallbackFieldCandidateId({ productId = '', fieldKey, value = '', index = 0, variant = 'candidate' }) {
  const prefix = variant === 'selected' ? 'selected_item' : 'cand_item';
  return buildCandidateId(prefix, [productId, fieldKey, value, index]);
}

/**
 * Build a deterministic, item+field scoped candidate id from raw source candidate ids.
 * This prevents collisions when different fields reuse the same raw candidate_id.
 */
export function buildScopedItemCandidateId({
  productId,
  fieldKey,
  rawCandidateId = '',
  value = '',
  sourceHost = '',
  sourceMethod = '',
  index = 0,
  runId = '',
}) {
  const pid = String(productId || '').trim();
  const field = String(fieldKey || '').trim() || 'field';
  const raw = String(rawCandidateId || '').trim();
  const scopedPrefix = pid ? `${pid}::${field}::` : `${field}::`;

  if (raw) {
    if (raw.startsWith(scopedPrefix)) return raw;
    if (pid && raw.startsWith(`${pid}::`)) {
      const tail = raw.slice(`${pid}::`.length);
      return tail.startsWith(`${field}::`) ? raw : `${scopedPrefix}${tail}`;
    }
    return `${scopedPrefix}${raw}`;
  }

  return buildCandidateId('item_source', [
    pid,
    field,
    value,
    sourceHost,
    sourceMethod,
    index,
    runId,
  ]);
}
