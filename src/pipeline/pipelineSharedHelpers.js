function toFloat(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clamp01(value, fallback = 0) {
  const parsed = toFloat(value, fallback);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, parsed));
}

export function normalizeToken(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function buildIdentityTargetTokens(identityTarget = {}) {
  const brand = normalizeToken(identityTarget?.brand || '');
  const model = normalizeToken(identityTarget?.model || '');
  const sku = normalizeToken(identityTarget?.sku || '');
  const variant = normalizeToken(identityTarget?.variant || '');
  const modelTokens = model
    .split(/\s+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  const variantTokens = variant
    .split(/\s+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  return {
    brand,
    model,
    sku,
    variant,
    modelTokens,
    variantTokens
  };
}

export function tokenWeight(token = '') {
  const text = String(token || '').trim().toLowerCase();
  if (!text) return 0;
  if (['pro', 'max', 'plus', 'mini', 'edition', 'series'].includes(text)) {
    return 0.2;
  }
  if (text.length >= 5) return 1;
  if (text.length >= 3) return 0.65;
  return 0.35;
}

export function weightedTokenCoverage(tokens = [], normalizedText = '') {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return 0;
  }
  let totalWeight = 0;
  let matchedWeight = 0;
  for (const token of tokens) {
    const weight = tokenWeight(token);
    if (weight <= 0) {
      continue;
    }
    totalWeight += weight;
    if (normalizedText.includes(token)) {
      matchedWeight += weight;
    }
  }
  if (totalWeight <= 0) {
    return 0;
  }
  return clamp01(matchedWeight / totalWeight, 0);
}

export function evaluateTargetMatchText({
  text = '',
  identityTarget = {},
  threshold = 0.55,
  rejectReason = 'cluster_mismatch'
} = {}) {
  const target = buildIdentityTargetTokens(identityTarget);
  if (!target.brand && !target.model && !target.sku && !target.variant) {
    return {
      target_match_score: 1,
      target_match_passed: true,
      identity_reject_reason: ''
    };
  }

  const normalizedText = normalizeToken(text);
  if (!normalizedText) {
    return {
      target_match_score: 0,
      target_match_passed: false,
      identity_reject_reason: rejectReason
    };
  }

  let score = 0;
  const hasBrand = target.brand ? normalizedText.includes(target.brand) : false;
  if (hasBrand) {
    score += 0.15;
  }
  const hasModelPhrase = target.model ? normalizedText.includes(target.model) : false;
  if (hasModelPhrase) {
    score += 0.55;
  } else {
    score += 0.3 * weightedTokenCoverage(target.modelTokens, normalizedText);
  }
  const hasSku = target.sku ? normalizedText.includes(target.sku) : false;
  if (hasSku) {
    score += 0.7;
  }
  if (target.variant) {
    if (normalizedText.includes(target.variant)) {
      score += 0.15;
    } else {
      score += 0.1 * weightedTokenCoverage(target.variantTokens, normalizedText);
    }
  }

  if (target.sku && !hasSku) {
    score = Math.min(score, 0.25);
  }

  if (!target.model && target.brand) {
    score = hasBrand ? 0.5 : 0;
  }

  score = clamp01(score, 0);
  const passed = score >= clamp01(threshold, 0.55);

  return {
    target_match_score: score,
    target_match_passed: passed,
    identity_reject_reason: passed ? '' : rejectReason
  };
}

export function normalizeErrorList(errors = [], fallbackReason = '') {
  const rows = [
    ...(Array.isArray(errors) ? errors : []),
    ...(fallbackReason ? [fallbackReason] : [])
  ];
  return rows.map((row) => String(row || '').trim()).filter(Boolean);
}

export function resultSuccess(data = {}) {
  return {
    ok: true,
    status: 'success',
    errors: [],
    ...data
  };
}

export function resultSkip(data = {}, reason = 'skipped') {
  return {
    ok: false,
    status: 'skipped',
    reason: String(reason || 'skipped'),
    errors: normalizeErrorList([], reason),
    ...data
  };
}

export function resultError(data = {}, reason = 'error', errors = []) {
  return {
    ok: false,
    status: 'error',
    reason: String(reason || 'error'),
    errors: normalizeErrorList(errors, reason),
    ...data
  };
}

export function failOpenEnvelope(base = {}, { errors = [], reason = '' } = {}) {
  return {
    ...(base || {}),
    ok: false,
    errors: normalizeErrorList(errors, reason)
  };
}

export async function sleep(ms = 0) {
  const waitMs = Math.max(0, Number(ms || 0));
  if (waitMs <= 0) {
    return;
  }
  await new Promise((resolve) => {
    setTimeout(resolve, waitMs);
  });
}

export async function runWithRetry(task, {
  attempts = 1,
  shouldRetry = () => false,
  onRetry = null,
  backoffMs = 0
} = {}) {
  const maxAttempts = Math.max(1, Number.parseInt(String(attempts || 1), 10) || 1);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await task({ attempt, maxAttempts, lastError });
    } catch (error) {
      lastError = error;
      const canRetry = attempt < maxAttempts && Boolean(shouldRetry(error, { attempt, maxAttempts }));
      if (!canRetry) {
        throw error;
      }
      if (typeof onRetry === 'function') {
        await onRetry(error, { attempt, maxAttempts });
      }
      const waitMs = typeof backoffMs === 'function'
        ? Number(backoffMs(error, { attempt, maxAttempts }) || 0)
        : Number(backoffMs || 0);
      if (waitMs > 0) {
        await sleep(waitMs);
      }
    }
  }

  throw lastError || new Error('retry_exhausted');
}

