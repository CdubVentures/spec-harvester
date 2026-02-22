import { normalizeWhitespace } from '../utils/common.js';

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeHostToken(value = '') {
  return String(value || '').trim().toLowerCase().replace(/^www\./, '');
}

export function hostFromHttpUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return normalizeHostToken(new URL(raw).hostname);
  } catch {
    return '';
  }
}

export function compactQueryText(value = '') {
  return normalizeWhitespace(String(value || '').replace(/\s+/g, ' ').trim());
}

export function buildRepairSearchQuery({
  domain = '',
  brand = '',
  model = '',
  variant = ''
} = {}) {
  const host = normalizeHostToken(domain);
  if (!host) return '';
  const identity = compactQueryText([brand, model, variant].map((row) => String(row || '').trim()).filter(Boolean).join(' '));
  const identitySegment = identity ? `"${identity}"` : '';
  return compactQueryText(`site:${host} ${identitySegment} (spec OR manual OR pdf OR "user guide")`);
}

export function classifyFetchOutcome({
  status = 0,
  message = '',
  contentType = '',
  html = ''
} = {}) {
  const code = toInt(status, 0);
  const msg = String(message || '').toLowerCase();
  const contentTypeToken = String(contentType || '').toLowerCase();
  const htmlSize = String(html || '').trim().length;

  const looksBotChallenge = /(captcha|cloudflare|cf-ray|bot.?challenge|are you human|human verification|robot check)/.test(msg);
  const looksRateLimited = /(429|rate.?limit|too many requests|throttl)/.test(msg);
  const looksLoginWall = /(401|sign[ -]?in|login|authenticate|account required|subscription required)/.test(msg);
  const looksBlocked = /(403|forbidden|blocked|access denied|denied)/.test(msg);
  const looksTimeout = /(timeout|timed out|etimedout|econnreset|econnrefused|socket hang up|network error|dns)/.test(msg);
  const looksBadContent = /(parse|json|xml|cheerio|dom|extract|malformed|invalid content|unsupported content)/.test(msg);

  if (code >= 200 && code < 400) {
    if (contentTypeToken.includes('application/octet-stream') && htmlSize === 0) {
      return 'bad_content';
    }
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

export function createFetchOutcomeCounters() {
  return FETCH_OUTCOME_KEYS.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
}

export function createHostBudgetRow() {
  return {
    started_count: 0,
    completed_count: 0,
    dedupe_hits: 0,
    evidence_used: 0,
    parse_fail_count: 0,
    next_retry_ts: '',
    outcome_counts: createFetchOutcomeCounters()
  };
}

export function ensureHostBudgetRow(mapRef, host = '') {
  const token = String(host || '').trim().toLowerCase() || '__unknown__';
  if (!mapRef.has(token)) {
    mapRef.set(token, createHostBudgetRow());
  }
  return mapRef.get(token);
}

export function noteHostRetryTs(hostRow, retryTs = '') {
  if (!hostRow) return;
  const token = String(retryTs || '').trim();
  if (!token) return;
  const retryMs = Date.parse(token);
  if (!Number.isFinite(retryMs)) return;
  const currentMs = Date.parse(String(hostRow.next_retry_ts || ''));
  if (!Number.isFinite(currentMs) || retryMs > currentMs) {
    hostRow.next_retry_ts = new Date(retryMs).toISOString();
  }
}

export function bumpHostOutcome(hostRow, outcome = '') {
  if (!hostRow) return;
  const token = String(outcome || '').trim().toLowerCase();
  if (!token) return;
  if (!Object.prototype.hasOwnProperty.call(hostRow.outcome_counts, token)) {
    hostRow.outcome_counts[token] = 0;
  }
  hostRow.outcome_counts[token] += 1;
}

export function applyHostBudgetBackoff(hostRow, { status = 0, outcome = '', config = {}, nowMs = Date.now() } = {}) {
  if (!hostRow) return;
  const code = toInt(status, 0);
  const token = String(outcome || '').trim().toLowerCase();
  let seconds = 0;
  if (code === 429 || token === 'rate_limited') {
    seconds = Math.max(60, toInt(config.frontierCooldown429BaseSeconds, 15 * 60));
  } else if (code === 403 || token === 'blocked' || token === 'login_wall' || token === 'bot_challenge') {
    seconds = Math.max(60, toInt(config.frontierCooldown403BaseSeconds, 30 * 60));
  } else if (token === 'network_timeout' || token === 'fetch_error' || token === 'server_error') {
    seconds = Math.max(60, toInt(config.frontierCooldownTimeoutSeconds, 6 * 60 * 60));
  }
  if (seconds > 0) {
    noteHostRetryTs(hostRow, new Date(nowMs + (seconds * 1000)).toISOString());
  }
}

export function resolveHostBudgetState(hostRow, nowMs = Date.now()) {
  const row = hostRow || createHostBudgetRow();
  const outcomes = row.outcome_counts || createFetchOutcomeCounters();
  const started = toInt(row.started_count, 0);
  const completed = toInt(row.completed_count, 0);
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
  score -= toInt(row.dedupe_hits, 0);
  score += Math.min(12, toInt(outcomes.ok, 0) * 2);
  score += Math.min(10, toInt(row.evidence_used, 0) * 2);
  score = Math.max(0, Math.min(100, score));

  const nextRetryMs = Date.parse(String(row.next_retry_ts || ''));
  const cooldownSeconds = Number.isFinite(nextRetryMs)
    ? Math.max(0, Math.ceil((nextRetryMs - nowMs) / 1000))
    : 0;

  const blockedSignals = (
    toInt(outcomes.blocked, 0)
    + toInt(outcomes.rate_limited, 0)
    + toInt(outcomes.login_wall, 0)
    + toInt(outcomes.bot_challenge, 0)
  );

  let state = 'open';
  if (cooldownSeconds > 0 && (score <= 30 || blockedSignals >= 2)) {
    state = 'blocked';
  } else if (cooldownSeconds > 0) {
    state = 'backoff';
  } else if (score < 55 || toInt(outcomes.bad_content, 0) > 0 || toInt(row.parse_fail_count, 0) > 0) {
    state = 'degraded';
  } else if (inFlight > 0) {
    state = 'active';
  }

  return {
    score: Number(score.toFixed(3)),
    state,
    cooldown_seconds: cooldownSeconds,
    next_retry_ts: cooldownSeconds > 0 ? String(row.next_retry_ts || '').trim() || null : null
  };
}
