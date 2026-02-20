function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBool(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const token = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(token)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(token)) {
    return false;
  }
  return fallback;
}

export function normalizeHostToken(host) {
  return String(host || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '');
}

export function normalizeDynamicFetchPolicyMap(input = {}) {
  const output = {};
  if (!input || typeof input !== 'object') {
    return output;
  }

  for (const [rawHost, rawPolicy] of Object.entries(input)) {
    const host = normalizeHostToken(rawHost);
    if (!host || !rawPolicy || typeof rawPolicy !== 'object') {
      continue;
    }

    output[host] = {
      perHostMinDelayMs: toInt(rawPolicy.perHostMinDelayMs, 0),
      pageGotoTimeoutMs: toInt(rawPolicy.pageGotoTimeoutMs, 0),
      pageNetworkIdleTimeoutMs: toInt(rawPolicy.pageNetworkIdleTimeoutMs, 0),
      postLoadWaitMs: toInt(rawPolicy.postLoadWaitMs, 0),
      autoScrollEnabled: toBool(rawPolicy.autoScrollEnabled, false),
      autoScrollPasses: toInt(rawPolicy.autoScrollPasses, 0),
      autoScrollDelayMs: toInt(rawPolicy.autoScrollDelayMs, 0),
      graphqlReplayEnabled: toBool(rawPolicy.graphqlReplayEnabled, true),
      maxGraphqlReplays: toInt(rawPolicy.maxGraphqlReplays, 0),
      retryBudget: toInt(
        rawPolicy.retryBudget ?? rawPolicy.retry_budget,
        0
      ),
      retryBackoffMs: toInt(
        rawPolicy.retryBackoffMs ?? rawPolicy.retry_backoff_ms,
        0
      )
    };
  }

  return output;
}

function hostCandidates(host) {
  const normalized = normalizeHostToken(host);
  if (!normalized) {
    return [];
  }
  const tokens = normalized.split('.');
  const candidates = [];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    candidates.push(tokens.slice(i).join('.'));
  }
  return candidates;
}

export function resolveDynamicFetchPolicy(config = {}, source = {}) {
  const host = normalizeHostToken(source.host || source.url || '');
  const map = config.dynamicFetchPolicyMap || {};

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
    perHostMinDelayMs: Number(config.perHostMinDelayMs || 0),
    pageGotoTimeoutMs: Number(config.pageGotoTimeoutMs || 30_000),
    pageNetworkIdleTimeoutMs: Number(config.pageNetworkIdleTimeoutMs || 6_000),
    postLoadWaitMs: Number(config.postLoadWaitMs || 0),
    autoScrollEnabled: Boolean(config.autoScrollEnabled),
    autoScrollPasses: Number(config.autoScrollPasses || 0),
    autoScrollDelayMs: Number(config.autoScrollDelayMs || 900),
    graphqlReplayEnabled: config.graphqlReplayEnabled !== false,
    maxGraphqlReplays: Number(config.maxGraphqlReplays || 0),
    retryBudget: Number(config.dynamicFetchRetryBudget || 0),
    retryBackoffMs: Number(config.dynamicFetchRetryBackoffMs || 0)
  };

  if (!matchedPolicy) {
    policy.overrideApplied = false;
    return policy;
  }

  policy.overrideApplied = true;
  policy.perHostMinDelayMs = matchedPolicy.perHostMinDelayMs > 0
    ? matchedPolicy.perHostMinDelayMs
    : policy.perHostMinDelayMs;
  policy.pageGotoTimeoutMs = matchedPolicy.pageGotoTimeoutMs > 0
    ? matchedPolicy.pageGotoTimeoutMs
    : policy.pageGotoTimeoutMs;
  policy.pageNetworkIdleTimeoutMs = matchedPolicy.pageNetworkIdleTimeoutMs > 0
    ? matchedPolicy.pageNetworkIdleTimeoutMs
    : policy.pageNetworkIdleTimeoutMs;
  policy.postLoadWaitMs = matchedPolicy.postLoadWaitMs >= 0
    ? matchedPolicy.postLoadWaitMs
    : policy.postLoadWaitMs;
  policy.autoScrollEnabled = matchedPolicy.autoScrollEnabled;
  policy.autoScrollPasses = matchedPolicy.autoScrollPasses > 0
    ? matchedPolicy.autoScrollPasses
    : 0;
  policy.autoScrollDelayMs = matchedPolicy.autoScrollDelayMs > 0
    ? matchedPolicy.autoScrollDelayMs
    : policy.autoScrollDelayMs;
  policy.graphqlReplayEnabled = matchedPolicy.graphqlReplayEnabled;
  policy.maxGraphqlReplays = matchedPolicy.maxGraphqlReplays > 0
    ? matchedPolicy.maxGraphqlReplays
    : policy.maxGraphqlReplays;
  policy.retryBudget = matchedPolicy.retryBudget > 0
    ? matchedPolicy.retryBudget
    : policy.retryBudget;
  policy.retryBackoffMs = matchedPolicy.retryBackoffMs > 0
    ? matchedPolicy.retryBackoffMs
    : policy.retryBackoffMs;

  return policy;
}
