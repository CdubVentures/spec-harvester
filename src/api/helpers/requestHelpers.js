import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

export function toInt(v, fallback = 0) {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

export function toFloat(v, fallback = 0) {
  const n = Number.parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : fallback;
}

export function toUnitRatio(v) {
  const n = Number.parseFloat(String(v ?? ''));
  if (!Number.isFinite(n)) return undefined;
  if (n > 1) return Math.max(0, Math.min(1, n / 100));
  return Math.max(0, Math.min(1, n));
}

export function hasKnownValue(v) {
  const token = String(v ?? '').trim().toLowerCase();
  return token !== '' && token !== 'unk' && token !== 'unknown' && token !== 'n/a';
}

export function normalizeModelToken(value) {
  return String(value || '').trim().toLowerCase();
}

export function parseCsvTokens(value) {
  return String(value || '')
    .split(/[,\n]/g)
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

export function normalizePathToken(value, fallback = '') {
  const token = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return token || fallback;
}

export function normalizeJsonText(value, maxChars = 12000) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2).slice(0, Math.max(0, Number(maxChars) || 0));
    } catch {
      return '';
    }
  }
  const text = String(value || '');
  return text.slice(0, Math.max(0, Number(maxChars) || 0));
}

export function jsonRes(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(data));
}

export function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export async function readJsonBody(req, maxBytes = 2_000_000) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) throw new Error('body_too_large');
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

export async function safeReadJson(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return JSON.parse(text);
  } catch { return null; }
}

export async function safeStat(filePath) {
  try { return await fs.stat(filePath); } catch { return null; }
}

export async function listDirs(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name).sort();
  } catch { return []; }
}

export async function listFiles(dirPath, ext = '') {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter(e => e.isFile() && (!ext || e.name.endsWith(ext)))
      .map(e => e.name)
      .sort();
  } catch { return []; }
}

export function normalizeDomainToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

export function domainFromUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    return normalizeDomainToken(parsed.hostname);
  } catch {
    return normalizeDomainToken(url);
  }
}

export function urlPathToken(url) {
  try {
    const parsed = new URL(String(url || ''));
    return `${parsed.pathname}${parsed.search}`.toLowerCase();
  } catch {
    return String(url || '').toLowerCase();
  }
}

export function parseTsMs(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : NaN;
}

export function percentileFromSorted(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const idx = Math.min(
    values.length - 1,
    Math.max(0, Math.floor((values.length - 1) * percentile))
  );
  return Number(values[idx]) || 0;
}

export function clampScore(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

export async function readJsonlEvents(filePath) {
  let text = '';
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch {
    return [];
  }
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export async function readGzipJsonlEvents(filePath) {
  let buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch {
    return [];
  }
  let text = '';
  try {
    text = zlib.gunzipSync(buffer).toString('utf8');
  } catch {
    return [];
  }
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function parseNdjson(text = '') {
  return String(text || '')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function safeJoin(basePath, ...parts) {
  const resolved = path.resolve(basePath, ...parts);
  const root = path.resolve(basePath);
  if (resolved === root) return resolved;
  if (!resolved.startsWith(`${root}${path.sep}`)) return null;
  return resolved;
}

export function incrementMapCounter(mapRef, key) {
  if (!mapRef || !key) return;
  mapRef.set(key, (mapRef.get(key) || 0) + 1);
}

export function countMapValuesAbove(mapRef, threshold = 1) {
  if (!mapRef || typeof mapRef.values !== 'function') return 0;
  let total = 0;
  for (const value of mapRef.values()) {
    if (Number(value) > threshold) total += 1;
  }
  return total;
}

export const UNKNOWN_VALUE_TOKENS = new Set(['', 'unk', 'unknown', 'n/a', 'na', 'none', 'null']);

export function isKnownValue(value) {
  const token = String(value || '').trim().toLowerCase();
  return !UNKNOWN_VALUE_TOKENS.has(token);
}

export function addTokensFromText(set, value) {
  for (const token of String(value || '').toLowerCase().split(/[^a-z0-9]+/g)) {
    const trimmed = token.trim();
    if (trimmed.length >= 4) {
      set.add(trimmed);
    }
  }
}

export const SITE_KIND_RANK = {
  manufacturer: 0,
  review: 1,
  database: 2,
  retailer: 3,
  community: 4,
  aggregator: 5,
  other: 9
};

export const REVIEW_DOMAIN_HINTS = [
  'rtings.com',
  'techpowerup.com',
  'eloshapes.com',
  'mousespecs.org',
  'tftcentral.co.uk',
  'displayninja.com'
];

export const RETAILER_DOMAIN_HINTS = [
  'amazon.',
  'bestbuy.',
  'newegg.',
  'walmart.',
  'microcenter.',
  'bhphotovideo.'
];

export const AGGREGATOR_DOMAIN_HINTS = [
  'wikipedia.org',
  'reddit.com',
  'fandom.com'
];

export const FETCH_OUTCOME_KEYS = [
  'ok',
  'not_found',
  'blocked',
  'rate_limited',
  'login_wall',
  'bot_challenge',
  'bad_content',
  'server_error',
  'network_timeout',
  'fetch_error'
];

export function inferSiteKindByDomain(domain = '') {
  const host = normalizeDomainToken(domain);
  if (!host) return 'other';
  if (REVIEW_DOMAIN_HINTS.some((hint) => host.includes(hint))) return 'review';
  if (RETAILER_DOMAIN_HINTS.some((hint) => host.includes(hint))) return 'retailer';
  if (AGGREGATOR_DOMAIN_HINTS.some((hint) => host.includes(hint))) return 'aggregator';
  return 'other';
}

export function classifySiteKind({
  domain = '',
  role = '',
  tierName = '',
  brandTokens = new Set()
} = {}) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  const normalizedTierName = String(tierName || '').trim().toLowerCase();
  if (normalizedRole === 'manufacturer' || normalizedTierName === 'manufacturer') return 'manufacturer';
  if (normalizedRole === 'review' || normalizedTierName === 'review') return 'review';
  if (normalizedRole === 'retailer' || normalizedTierName === 'retailer') return 'retailer';
  if (normalizedRole === 'database' || normalizedTierName === 'database') return 'database';
  if (normalizedRole === 'community' || normalizedTierName === 'community') return 'community';
  if (normalizedRole === 'aggregator' || normalizedTierName === 'aggregator') return 'aggregator';

  const host = normalizeDomainToken(domain);
  if (host) {
    for (const token of brandTokens) {
      if (!token) continue;
      if (host.includes(token)) return 'manufacturer';
    }
  }
  return inferSiteKindByDomain(host);
}

export function isHelperPseudoDomain(domain = '') {
  const host = normalizeDomainToken(domain);
  return host === 'helper-files.local' || host === 'helper_files.local';
}

export function createFetchOutcomeCounters() {
  return FETCH_OUTCOME_KEYS.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
}

export function normalizeFetchOutcome(value) {
  const token = String(value || '').trim().toLowerCase();
  if (!token) return '';
  return FETCH_OUTCOME_KEYS.includes(token) ? token : '';
}

export function classifyFetchOutcomeFromEvent(evt = {}) {
  const explicit = normalizeFetchOutcome(evt.outcome);
  if (explicit) return explicit;

  const code = toInt(evt.status, 0);
  const message = String(evt.message || evt.detail || '').toLowerCase();
  const contentType = String(evt.content_type || '').toLowerCase();

  const looksBotChallenge = /(captcha|cloudflare|cf-ray|bot.?challenge|are you human|human verification|robot check)/.test(message);
  const looksRateLimited = /(429|rate.?limit|too many requests|throttl)/.test(message);
  const looksLoginWall = /(401|sign[ -]?in|login|authenticate|account required|subscription required)/.test(message);
  const looksBlocked = /(403|forbidden|blocked|access denied|denied)/.test(message);
  const looksTimeout = /(timeout|timed out|etimedout|econnreset|econnrefused|socket hang up|network error|dns)/.test(message);
  const looksBadContent = /(parse|json|xml|cheerio|dom|extract|malformed|invalid content|unsupported content)/.test(message);

  if (code >= 200 && code < 400) {
    if (contentType.includes('application/octet-stream')) return 'bad_content';
    return 'ok';
  }
  if (code === 404 || code === 410) return 'not_found';
  if (code === 429) return 'rate_limited';
  if (code === 401 || code === 407) return 'login_wall';
  if (code === 403) {
    if (looksBotChallenge) return 'bot_challenge';
    if (looksLoginWall) return 'login_wall';
    return 'blocked';
  }
  if (code >= 500) return 'server_error';
  if (code >= 400) return 'blocked';
  if (looksBotChallenge) return 'bot_challenge';
  if (looksRateLimited) return 'rate_limited';
  if (looksLoginWall) return 'login_wall';
  if (looksBlocked) return 'blocked';
  if (looksBadContent) return 'bad_content';
  if (looksTimeout) return 'network_timeout';
  return 'fetch_error';
}

export function createDomainBucket(domain, siteKind = 'other') {
  return {
    domain,
    site_kind: siteKind,
    candidates_checked_urls: new Set(),
    urls_selected_urls: new Set(),
    fetched_ok_urls: new Set(),
    indexed_urls: new Set(),
    seen_urls: new Set(),
    url_stats: new Map(),
    started_count: 0,
    completed_count: 0,
    dedupe_hits: 0,
    err_404: 0,
    err_404_by_url: new Map(),
    blocked_count: 0,
    blocked_by_url: new Map(),
    parse_fail_count: 0,
    outcome_counts: createFetchOutcomeCounters(),
    fetch_durations: [],
    fields_filled_count: 0,
    evidence_hits: 0,
    evidence_used: 0,
    fields_covered: new Set(),
    publish_gated_fields: new Set(),
    last_success_at: '',
    next_retry_at: '',
    roles_seen: new Set()
  };
}

export function createUrlStat(url) {
  return {
    url: String(url || ''),
    checked_count: 0,
    selected_count: 0,
    fetch_started_count: 0,
    processed_count: 0,
    fetched_ok: false,
    indexed: false,
    err_404_count: 0,
    blocked_count: 0,
    parse_fail_count: 0,
    last_outcome: '',
    last_status: 0,
    last_event: '',
    last_ts: ''
  };
}

export function ensureUrlStat(bucket, url) {
  if (!bucket || !url) return null;
  const normalizedUrl = String(url || '').trim();
  if (!normalizedUrl) return null;
  if (!bucket.url_stats.has(normalizedUrl)) {
    bucket.url_stats.set(normalizedUrl, createUrlStat(normalizedUrl));
  }
  return bucket.url_stats.get(normalizedUrl);
}

export function bumpUrlStatEvent(urlStat, { eventName = '', ts = '', status = 0 } = {}) {
  if (!urlStat) return;
  const safeTs = String(ts || '').trim();
  const safeEvent = String(eventName || '').trim();
  const statusCode = Number.parseInt(String(status || ''), 10);
  if (safeTs && (!urlStat.last_ts || parseTsMs(safeTs) >= parseTsMs(urlStat.last_ts))) {
    urlStat.last_ts = safeTs;
    urlStat.last_event = safeEvent || urlStat.last_event;
    if (Number.isFinite(statusCode) && statusCode > 0) {
      urlStat.last_status = statusCode;
    }
  }
}

export function choosePreferredSiteKind(currentKind, nextKind) {
  const currentRank = SITE_KIND_RANK[currentKind] ?? 99;
  const nextRank = SITE_KIND_RANK[nextKind] ?? 99;
  return nextRank < currentRank ? nextKind : currentKind;
}

export function cooldownSecondsRemaining(nextRetryAt, nowMs = Date.now()) {
  const retryAtMs = parseTsMs(nextRetryAt);
  if (!Number.isFinite(retryAtMs)) return 0;
  return Math.max(0, Math.ceil((retryAtMs - nowMs) / 1000));
}

export function resolveHostBudget(bucket, cooldownSeconds = 0) {
  const outcomes = bucket?.outcome_counts || createFetchOutcomeCounters();
  const started = toInt(bucket?.started_count, 0);
  const completed = toInt(bucket?.completed_count, 0);
  const inFlight = Math.max(0, started - completed);

  let score = 100;
  score -= toInt(outcomes.not_found, 0) * 6;
  score -= toInt(outcomes.blocked, 0) * 8;
  score -= toInt(outcomes.rate_limited, 0) * 12;
  score -= toInt(outcomes.login_wall, 0) * 10;
  score -= toInt(outcomes.bot_challenge, 0) * 14;
  score -= toInt(outcomes.bad_content, 0) * 8;
  score -= toInt(outcomes.server_error, 0) * 6;
  score -= toInt(outcomes.network_timeout, 0) * 5;
  score -= toInt(outcomes.fetch_error, 0) * 4;
  score -= toInt(bucket?.dedupe_hits, 0);
  score += Math.min(12, toInt(outcomes.ok, 0) * 2);
  score += Math.min(10, toInt(bucket?.evidence_used, 0) * 2);
  score = clampScore(score, 0, 100);

  let state = 'open';
  const blockedSignals = (
    toInt(outcomes.blocked, 0)
    + toInt(outcomes.rate_limited, 0)
    + toInt(outcomes.login_wall, 0)
    + toInt(outcomes.bot_challenge, 0)
  );
  if (cooldownSeconds > 0 && (score <= 30 || blockedSignals >= 2)) {
    state = 'blocked';
  } else if (cooldownSeconds > 0) {
    state = 'backoff';
  } else if (score < 55 || toInt(outcomes.bad_content, 0) > 0 || toInt(bucket?.parse_fail_count, 0) > 0) {
    state = 'degraded';
  } else if (inFlight > 0) {
    state = 'active';
  }

  return {
    score,
    state
  };
}

export function resolveDomainChecklistStatus(bucket) {
  const candidatesChecked = bucket.candidates_checked_urls.size;
  const urlsSelected = bucket.urls_selected_urls.size;
  const pagesFetchedOk = bucket.fetched_ok_urls.size;
  const hasPositiveSignal = (
    pagesFetchedOk > 0
    || bucket.indexed_urls.size > 0
    || bucket.fields_filled_count > 0
    || bucket.evidence_hits > 0
    || bucket.evidence_used > 0
  );

  if (candidatesChecked === 0 && urlsSelected === 0) return 'not_started';
  if (bucket.started_count > bucket.completed_count) return 'in_progress';
  if (hasPositiveSignal) return 'good';
  if (bucket.blocked_count > 0 && pagesFetchedOk === 0) return 'blocked';
  if (bucket.err_404 > 0 && pagesFetchedOk === 0 && bucket.blocked_count === 0) return 'dead_urls(404)';
  return 'in_progress';
}

export function llmProviderFromModel(model) {
  const token = normalizeModelToken(model);
  if (!token) return 'openai';
  if (token.startsWith('gemini')) return 'gemini';
  if (token.startsWith('deepseek')) return 'deepseek';
  return 'openai';
}

export function classifyLlmTracePhase(purpose = '', routeRole = '') {
  const reason = String(purpose || '').trim().toLowerCase();
  const role = String(routeRole || '').trim().toLowerCase();
  if (role === 'extract') return 'extract';
  if (role === 'validate') return 'validate';
  if (role === 'write') return 'write';
  if (role === 'plan') return 'plan';
  if (
    reason.includes('discovery_planner') ||
    reason.includes('search_profile') ||
    reason.includes('searchprofile')
  ) {
    return 'phase_02';
  }
  if (
    reason.includes('serp') ||
    reason.includes('triage') ||
    reason.includes('rerank') ||
    reason.includes('discovery_query_plan')
  ) {
    return 'phase_03';
  }
  if (reason.includes('extract')) return 'extract';
  if (reason.includes('validate') || reason.includes('verify')) return 'validate';
  if (reason.includes('write') || reason.includes('summary')) return 'write';
  if (reason.includes('planner') || reason.includes('plan')) return 'plan';
  return 'other';
}

export function resolveLlmRoleDefaults(cfg = {}) {
  return {
    plan: String(cfg.llmModelPlan || '').trim(),
    fast: String(cfg.llmModelFast || '').trim(),
    triage: String(cfg.llmModelTriage || cfg.cortexModelRerankFast || cfg.cortexModelSearchFast || cfg.llmModelFast || '').trim(),
    reasoning: String(cfg.llmModelReasoning || '').trim(),
    extract: String(cfg.llmModelExtract || '').trim(),
    validate: String(cfg.llmModelValidate || '').trim(),
    write: String(cfg.llmModelWrite || '').trim()
  };
}

export function resolveLlmKnobDefaults(cfg = {}) {
  const modelDefaults = resolveLlmRoleDefaults(cfg);
  const tokenDefaults = {
    plan: toInt(cfg.llmMaxOutputTokensPlan, toInt(cfg.llmMaxOutputTokens, 1200)),
    fast: toInt(cfg.llmMaxOutputTokensFast, toInt(cfg.llmMaxOutputTokensPlan, 1200)),
    triage: toInt(cfg.llmMaxOutputTokensTriage, toInt(cfg.llmMaxOutputTokensFast, 1200)),
    reasoning: toInt(cfg.llmMaxOutputTokensReasoning, toInt(cfg.llmReasoningBudget, 4096)),
    extract: toInt(cfg.llmMaxOutputTokensExtract, toInt(cfg.llmExtractMaxTokens, 1200)),
    validate: toInt(cfg.llmMaxOutputTokensValidate, toInt(cfg.llmMaxOutputTokens, 1200)),
    write: toInt(cfg.llmMaxOutputTokensWrite, toInt(cfg.llmMaxOutputTokens, 1200))
  };
  return {
    phase_02_planner: {
      model: String(cfg.llmModelPlan || '').trim(),
      token_cap: tokenDefaults.plan
    },
    phase_03_triage: {
      model: String(cfg.llmModelTriage || '').trim(),
      token_cap: tokenDefaults.triage
    },
    fast_pass: {
      model: modelDefaults.fast,
      token_cap: tokenDefaults.fast
    },
    reasoning_pass: {
      model: modelDefaults.reasoning,
      token_cap: tokenDefaults.reasoning
    },
    extract_role: {
      model: modelDefaults.extract,
      token_cap: tokenDefaults.extract
    },
    validate_role: {
      model: modelDefaults.validate,
      token_cap: tokenDefaults.validate
    },
    write_role: {
      model: modelDefaults.write,
      token_cap: tokenDefaults.write
    },
    fallback_plan: {
      model: String(cfg.llmPlanFallbackModel || '').trim(),
      token_cap: toInt(cfg.llmMaxOutputTokensPlanFallback, tokenDefaults.plan)
    },
    fallback_extract: {
      model: String(cfg.llmExtractFallbackModel || '').trim(),
      token_cap: toInt(cfg.llmMaxOutputTokensExtractFallback, tokenDefaults.extract)
    },
    fallback_validate: {
      model: String(cfg.llmValidateFallbackModel || '').trim(),
      token_cap: toInt(cfg.llmMaxOutputTokensValidateFallback, tokenDefaults.validate)
    },
    fallback_write: {
      model: String(cfg.llmWriteFallbackModel || '').trim(),
      token_cap: toInt(cfg.llmMaxOutputTokensWriteFallback, tokenDefaults.write)
    }
  };
}

export function resolvePricingForModel(cfg, model) {
  const modelToken = normalizeModelToken(model);
  const defaultRates = {
    input_per_1m: toFloat(cfg?.llmCostInputPer1M, 1.25),
    output_per_1m: toFloat(cfg?.llmCostOutputPer1M, 10),
    cached_input_per_1m: toFloat(cfg?.llmCostCachedInputPer1M, 0.125)
  };
  if (!modelToken) {
    return defaultRates;
  }
  const pricingMap = (cfg?.llmModelPricingMap && typeof cfg.llmModelPricingMap === 'object')
    ? cfg.llmModelPricingMap
    : {};
  let selected = null;
  let selectedKey = '';
  for (const [rawModel, rawRates] of Object.entries(pricingMap)) {
    const key = normalizeModelToken(rawModel);
    if (!key || !rawRates || typeof rawRates !== 'object') continue;
    const isMatch = modelToken === key || modelToken.startsWith(key) || key.startsWith(modelToken);
    if (!isMatch) continue;
    if (!selected || key.length > selectedKey.length) {
      selected = rawRates;
      selectedKey = key;
    }
  }
  if (selected) {
    return {
      input_per_1m: toFloat(selected.inputPer1M ?? selected.input_per_1m ?? selected.input, defaultRates.input_per_1m),
      output_per_1m: toFloat(selected.outputPer1M ?? selected.output_per_1m ?? selected.output, defaultRates.output_per_1m),
      cached_input_per_1m: toFloat(
        selected.cachedInputPer1M ?? selected.cached_input_per_1m ?? selected.cached_input ?? selected.cached,
        defaultRates.cached_input_per_1m
      )
    };
  }
  if (modelToken.startsWith('deepseek-chat')) {
    return {
      input_per_1m: toFloat(cfg?.llmCostInputPer1MDeepseekChat, defaultRates.input_per_1m),
      output_per_1m: toFloat(cfg?.llmCostOutputPer1MDeepseekChat, defaultRates.output_per_1m),
      cached_input_per_1m: toFloat(cfg?.llmCostCachedInputPer1MDeepseekChat, defaultRates.cached_input_per_1m)
    };
  }
  if (modelToken.startsWith('deepseek-reasoner')) {
    return {
      input_per_1m: toFloat(cfg?.llmCostInputPer1MDeepseekReasoner, defaultRates.input_per_1m),
      output_per_1m: toFloat(cfg?.llmCostOutputPer1MDeepseekReasoner, defaultRates.output_per_1m),
      cached_input_per_1m: toFloat(cfg?.llmCostCachedInputPer1MDeepseekReasoner, defaultRates.cached_input_per_1m)
    };
  }
  return defaultRates;
}

export function resolveTokenProfileForModel(cfg, model) {
  const modelToken = normalizeModelToken(model);
  const defaultFallback = {
    default_output_tokens: toInt(cfg?.llmMaxOutputTokens, 1200),
    max_output_tokens: toInt(cfg?.llmMaxTokens, 16384)
  };
  if (!modelToken) {
    return defaultFallback;
  }
  const map = (cfg?.llmModelOutputTokenMap && typeof cfg.llmModelOutputTokenMap === 'object')
    ? cfg.llmModelOutputTokenMap
    : {};
  let selected = null;
  let selectedKey = '';
  for (const [rawModel, rawProfile] of Object.entries(map)) {
    const key = normalizeModelToken(rawModel);
    if (!key || !rawProfile || typeof rawProfile !== 'object') continue;
    const isMatch = modelToken === key || modelToken.startsWith(key) || key.startsWith(modelToken);
    if (!isMatch) continue;
    if (!selected || key.length > selectedKey.length) {
      selected = rawProfile;
      selectedKey = key;
    }
  }
  const defaultOutput = toInt(
    selected?.defaultOutputTokens ?? selected?.default_output_tokens,
    defaultFallback.default_output_tokens
  );
  const maxOutput = toInt(
    selected?.maxOutputTokens ?? selected?.max_output_tokens,
    defaultFallback.max_output_tokens
  );
  return {
    default_output_tokens: defaultOutput > 0 ? defaultOutput : defaultFallback.default_output_tokens,
    max_output_tokens: maxOutput > 0 ? maxOutput : defaultFallback.max_output_tokens
  };
}

export function collectLlmModels(cfg = {}) {
  const candidates = [
    cfg.llmModelPlan,
    cfg.llmModelFast,
    cfg.llmModelTriage,
    cfg.llmModelExtract,
    cfg.llmModelReasoning,
    cfg.llmModelValidate,
    cfg.llmModelWrite,
    cfg.cortexModelFast,
    cfg.cortexModelSearchFast,
    cfg.cortexModelRerankFast,
    cfg.cortexModelSearchDeep,
    cfg.cortexModelReasoningDeep,
    cfg.cortexModelVision,
    cfg.llmPlanFallbackModel,
    cfg.llmExtractFallbackModel,
    cfg.llmValidateFallbackModel,
    cfg.llmWriteFallbackModel,
    ...parseCsvTokens(cfg.llmModelCatalog || '')
  ];
  if (cfg.llmModelPricingMap && typeof cfg.llmModelPricingMap === 'object') {
    candidates.push(...Object.keys(cfg.llmModelPricingMap));
  }
  candidates.push(
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'deepseek-chat',
    'deepseek-reasoner'
  );
  const seen = new Set();
  const rows = [];
  for (const model of candidates) {
    const value = String(model || '').trim();
    if (!value) continue;
    const token = normalizeModelToken(value);
    if (seen.has(token)) continue;
    seen.add(token);
    rows.push(value);
  }
  rows.sort((a, b) => a.localeCompare(b));
  return rows;
}

export function deriveTrafficLightCounts({ summary = {}, provenance = {} } = {}, buildTrafficLightFn = null) {
  const fromSummary = summary?.traffic_light?.counts
    || summary?.traffic_light
    || summary?.trafficLight?.counts
    || summary?.trafficLight;
  if (fromSummary && typeof fromSummary === 'object') {
    const green = toInt(fromSummary.green, 0);
    const yellow = toInt(fromSummary.yellow, 0);
    const red = toInt(fromSummary.red, 0);
    if (green > 0 || yellow > 0 || red > 0) {
      return { green, yellow, red };
    }
  }

  if (buildTrafficLightFn) {
    try {
      const computed = buildTrafficLightFn({
        fieldOrder: Object.keys(provenance || {}),
        provenance,
        fieldReasoning: summary?.field_reasoning || {}
      });
      const green = toInt(computed?.counts?.green, 0);
      const yellow = toInt(computed?.counts?.yellow, 0);
      const red = toInt(computed?.counts?.red, 0);
      if (green > 0 || yellow > 0 || red > 0) {
        return { green, yellow, red };
      }
    } catch {
      // non-fatal, fall back to simple bucket counts below
    }
  }

  const skip = new Set(['id', 'brand', 'model', 'base_model', 'category']);
  let green = 0;
  let yellow = 0;
  let red = 0;
  for (const [field, row] of Object.entries(provenance || {})) {
    if (skip.has(field)) continue;
    const value = row?.value;
    const known = hasKnownValue(value);
    const meets = row?.meets_pass_target === true;
    if (known && meets) green += 1;
    else if (known) yellow += 1;
    else red += 1;
  }
  return { green, yellow, red };
}

export async function markEnumSuggestionStatus(category, field, value, status = 'accepted', helperRoot = '') {
  const sugPath = path.join(helperRoot, category, '_suggestions', 'enums.json');
  const doc = await safeReadJson(sugPath);
  if (!doc || !Array.isArray(doc.suggestions)) return;
  const normalized = String(value).trim().toLowerCase();
  let changed = false;
  for (const s of doc.suggestions) {
    if (String(s.field_key || '').trim() === field &&
        String(s.value || '').trim().toLowerCase() === normalized &&
        s.status === 'pending') {
      s.status = status;
      s.resolved_at = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) {
    await fs.writeFile(sugPath, JSON.stringify(doc, null, 2));
  }
}
