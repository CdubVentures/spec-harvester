function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoolOrNull(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const token = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(token)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(token)) {
    return false;
  }
  return null;
}

export function normalizeArticleHostToken(host) {
  return String(host || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '');
}

export function normalizeArticleExtractorMode(value, fallback = 'auto') {
  const token = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, '_');
  if (!token) return fallback;
  if (token === 'auto') return 'auto';
  if (token === 'prefer_readability' || token === 'readability' || token === 'readability_preferred') {
    return 'prefer_readability';
  }
  if (token === 'prefer_fallback' || token === 'fallback' || token === 'heuristic') {
    return 'prefer_fallback';
  }
  return fallback;
}

export function normalizeArticleExtractorPolicyMap(input = {}) {
  const output = {};
  if (!input || typeof input !== 'object') {
    return output;
  }

  for (const [rawHost, rawPolicy] of Object.entries(input)) {
    const host = normalizeArticleHostToken(rawHost);
    if (!host || !rawPolicy || typeof rawPolicy !== 'object') {
      continue;
    }
    output[host] = {
      mode: normalizeArticleExtractorMode(rawPolicy.mode || rawPolicy.preference || 'auto', 'auto'),
      enabled: toBoolOrNull(rawPolicy.enabled),
      minChars: toInt(rawPolicy.minChars ?? rawPolicy.min_chars, 0),
      minScore: toInt(rawPolicy.minScore ?? rawPolicy.min_score, 0),
      maxChars: toInt(rawPolicy.maxChars ?? rawPolicy.max_chars, 0)
    };
  }
  return output;
}

function hostCandidates(host) {
  const normalized = normalizeArticleHostToken(host);
  if (!normalized) return [];
  const tokens = normalized.split('.');
  const candidates = [];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    candidates.push(tokens.slice(i).join('.'));
  }
  return candidates;
}

export function resolveArticleExtractionPolicy(config = {}, source = {}) {
  const host = normalizeArticleHostToken(source.host || source.url || '');
  const map = config.articleExtractorDomainPolicyMap || {};
  let matchedHost = '';
  let matchedPolicy = null;

  for (const candidate of hostCandidates(host)) {
    if (map[candidate]) {
      matchedHost = candidate;
      matchedPolicy = map[candidate];
      break;
    }
  }

  const policy = {
    host,
    matchedHost,
    overrideApplied: false,
    mode: 'auto',
    enabled: config.articleExtractorV2Enabled !== false,
    minChars: Math.max(100, Number(config.articleExtractorMinChars || 700)),
    minScore: Math.max(1, Number(config.articleExtractorMinScore || 45)),
    maxChars: Math.max(1000, Number(config.articleExtractorMaxChars || 24_000))
  };

  if (!matchedPolicy) {
    return policy;
  }

  policy.overrideApplied = true;
  policy.mode = normalizeArticleExtractorMode(matchedPolicy.mode || '', 'auto');
  if (typeof matchedPolicy.enabled === 'boolean') {
    policy.enabled = matchedPolicy.enabled;
  }
  if (Number(matchedPolicy.minChars || 0) > 0) {
    policy.minChars = Math.max(100, Number(matchedPolicy.minChars));
  }
  if (Number(matchedPolicy.minScore || 0) > 0) {
    policy.minScore = Math.max(1, Number(matchedPolicy.minScore));
  }
  if (Number(matchedPolicy.maxChars || 0) > 0) {
    policy.maxChars = Math.max(1000, Number(matchedPolicy.maxChars));
  }
  return policy;
}

