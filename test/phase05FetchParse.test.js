import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyFetchOutcome,
  FETCH_OUTCOME_KEYS,
  createFetchOutcomeCounters,
  createHostBudgetRow,
  ensureHostBudgetRow,
  noteHostRetryTs,
  bumpHostOutcome,
  applyHostBudgetBackoff,
  resolveHostBudgetState
} from '../src/pipeline/fetchParseWorker.js';

import { selectFetcherMode } from '../src/fetcher/fetcherMode.js';

import {
  normalizeDynamicFetchPolicyMap,
  resolveDynamicFetchPolicy
} from '../src/fetcher/dynamicFetchPolicy.js';

describe('Phase 05 Audit — Host Budget Score Formula', () => {
  it('starts at 100 for fresh host', () => {
    const row = createHostBudgetRow();
    const result = resolveHostBudgetState(row);
    console.log('[P05-SCORE-01] fresh host: score=', result.score, 'state=', result.state);
    assert.equal(result.score, 100);
    assert.equal(result.state, 'open');
  });

  it('deducts 6 per not_found', () => {
    const row = createHostBudgetRow();
    row.outcome_counts.not_found = 3;
    const result = resolveHostBudgetState(row);
    console.log('[P05-SCORE-02] 3x not_found: score=', result.score);
    assert.equal(result.score, 100 - (3 * 6));
  });

  it('deducts 8 per blocked', () => {
    const row = createHostBudgetRow();
    row.outcome_counts.blocked = 2;
    const result = resolveHostBudgetState(row);
    console.log('[P05-SCORE-03] 2x blocked: score=', result.score);
    assert.equal(result.score, 100 - (2 * 8));
  });

  it('deducts 12 per rate_limited', () => {
    const row = createHostBudgetRow();
    row.outcome_counts.rate_limited = 2;
    const result = resolveHostBudgetState(row);
    console.log('[P05-SCORE-04] 2x rate_limited: score=', result.score);
    assert.equal(result.score, 100 - (2 * 12));
  });

  it('deducts 14 per bot_challenge (highest penalty)', () => {
    const row = createHostBudgetRow();
    row.outcome_counts.bot_challenge = 1;
    const result = resolveHostBudgetState(row);
    console.log('[P05-SCORE-05] 1x bot_challenge: score=', result.score);
    assert.equal(result.score, 100 - 14);
  });

  it('caps ok bonus at +12 (6 successful fetches maxes out)', () => {
    const row = createHostBudgetRow();
    row.outcome_counts.ok = 10;
    const result = resolveHostBudgetState(row);
    console.log('[P05-SCORE-06] 10x ok: score=', result.score, '(capped at +12)');
    assert.equal(result.score, 100);
    row.outcome_counts.blocked = 3;
    const degraded = resolveHostBudgetState(row);
    console.log('[P05-SCORE-06b] 10x ok + 3x blocked: score=', degraded.score);
    assert.equal(degraded.score, 100 - (3 * 8) + Math.min(12, 10 * 2));
  });

  it('caps evidence_used bonus at +10', () => {
    const row = createHostBudgetRow();
    row.evidence_used = 20;
    const result = resolveHostBudgetState(row);
    console.log('[P05-SCORE-07] evidence_used=20: score=', result.score);
    assert.equal(result.score, 100);
  });

  it('score floor is 0 (never negative)', () => {
    const row = createHostBudgetRow();
    row.outcome_counts.bot_challenge = 10;
    row.outcome_counts.rate_limited = 5;
    const result = resolveHostBudgetState(row);
    console.log('[P05-SCORE-08] extreme penalties: score=', result.score);
    assert.equal(result.score, 0);
  });

  it('score ceiling is 100 (even with max bonuses)', () => {
    const row = createHostBudgetRow();
    row.outcome_counts.ok = 100;
    row.evidence_used = 100;
    const result = resolveHostBudgetState(row);
    console.log('[P05-SCORE-09] max bonuses: score=', result.score);
    assert.equal(result.score, 100);
  });

  it('dedupe_hits reduce score by 1 each', () => {
    const row = createHostBudgetRow();
    row.dedupe_hits = 5;
    const result = resolveHostBudgetState(row);
    console.log('[P05-SCORE-10] 5 dedupe_hits: score=', result.score);
    assert.equal(result.score, 95);
  });
});

describe('Phase 05 Audit — Host Budget State Machine', () => {
  it('transitions to degraded when score < 55', () => {
    const row = createHostBudgetRow();
    row.outcome_counts.blocked = 6;
    const result = resolveHostBudgetState(row);
    console.log('[P05-STATE-01] 6x blocked: score=', result.score, 'state=', result.state);
    assert.ok(result.score < 55);
    assert.equal(result.state, 'degraded');
  });

  it('transitions to degraded when bad_content > 0 (even if score is high)', () => {
    const row = createHostBudgetRow();
    row.outcome_counts.bad_content = 1;
    const result = resolveHostBudgetState(row);
    console.log('[P05-STATE-02] bad_content: score=', result.score, 'state=', result.state);
    assert.equal(result.state, 'degraded');
  });

  it('transitions to degraded when parse_fail_count > 0', () => {
    const row = createHostBudgetRow();
    row.parse_fail_count = 1;
    const result = resolveHostBudgetState(row);
    console.log('[P05-STATE-03] parse_fail: state=', result.state);
    assert.equal(result.state, 'degraded');
  });

  it('transitions to active when in-flight requests exist and score is good', () => {
    const row = createHostBudgetRow();
    row.started_count = 3;
    row.completed_count = 1;
    const result = resolveHostBudgetState(row);
    console.log('[P05-STATE-04] in_flight=2: state=', result.state);
    assert.equal(result.state, 'active');
  });

  it('transitions to backoff when cooldown active but score is OK', () => {
    const row = createHostBudgetRow();
    const nowMs = Date.parse('2026-02-20T12:00:00.000Z');
    row.next_retry_ts = '2026-02-20T12:30:00.000Z';
    const result = resolveHostBudgetState(row, nowMs);
    console.log('[P05-STATE-05] cooldown active: state=', result.state, 'cd=', result.cooldown_seconds);
    assert.equal(result.state, 'backoff');
    assert.ok(result.cooldown_seconds > 0);
  });

  it('transitions to blocked when cooldown active + low score', () => {
    const row = createHostBudgetRow();
    const nowMs = Date.parse('2026-02-20T12:00:00.000Z');
    row.next_retry_ts = '2026-02-20T12:30:00.000Z';
    row.outcome_counts.blocked = 5;
    row.outcome_counts.rate_limited = 3;
    const result = resolveHostBudgetState(row, nowMs);
    console.log('[P05-STATE-06] cooldown + low score: score=', result.score, 'state=', result.state);
    assert.equal(result.state, 'blocked');
  });

  it('transitions to blocked when cooldown active + 2+ blocked signals', () => {
    const row = createHostBudgetRow();
    const nowMs = Date.parse('2026-02-20T12:00:00.000Z');
    row.next_retry_ts = '2026-02-20T12:30:00.000Z';
    row.outcome_counts.blocked = 1;
    row.outcome_counts.rate_limited = 1;
    const result = resolveHostBudgetState(row, nowMs);
    console.log('[P05-STATE-07] cooldown + blocked signals: score=', result.score, 'state=', result.state);
    assert.equal(result.state, 'blocked');
  });

  it('cooldown expires and state returns to open', () => {
    const row = createHostBudgetRow();
    const nowMs = Date.parse('2026-02-20T13:00:00.000Z');
    row.next_retry_ts = '2026-02-20T12:30:00.000Z';
    const result = resolveHostBudgetState(row, nowMs);
    console.log('[P05-STATE-08] cooldown expired: state=', result.state, 'cd=', result.cooldown_seconds);
    assert.equal(result.state, 'open');
    assert.equal(result.cooldown_seconds, 0);
  });
});

describe('Phase 05 Audit — applyHostBudgetBackoff Integration', () => {
  it('429 applies backoff from config', () => {
    const row = createHostBudgetRow();
    const nowMs = Date.parse('2026-02-20T12:00:00.000Z');
    applyHostBudgetBackoff(row, { status: 429, outcome: 'rate_limited', config: { frontierCooldown429BaseSeconds: 120 }, nowMs });
    const retryMs = Date.parse(row.next_retry_ts);
    console.log('[P05-BACKOFF-01] 429 retry_ts:', row.next_retry_ts);
    assert.ok(retryMs > nowMs);
    assert.equal(retryMs - nowMs, 120 * 1000);
  });

  it('403 applies backoff from config', () => {
    const row = createHostBudgetRow();
    const nowMs = Date.parse('2026-02-20T12:00:00.000Z');
    applyHostBudgetBackoff(row, { status: 403, outcome: 'blocked', config: { frontierCooldown403BaseSeconds: 60 }, nowMs });
    const retryMs = Date.parse(row.next_retry_ts);
    console.log('[P05-BACKOFF-02] 403 retry delay ms:', retryMs - nowMs);
    assert.equal(retryMs - nowMs, 60 * 1000);
  });

  it('200 ok does NOT apply backoff', () => {
    const row = createHostBudgetRow();
    applyHostBudgetBackoff(row, { status: 200, outcome: 'ok', config: {} });
    console.log('[P05-BACKOFF-03] 200 retry_ts:', row.next_retry_ts);
    assert.equal(row.next_retry_ts, '');
  });

  it('bot_challenge on status 0 applies 403-level backoff', () => {
    const row = createHostBudgetRow();
    const nowMs = Date.parse('2026-02-20T12:00:00.000Z');
    applyHostBudgetBackoff(row, { status: 0, outcome: 'bot_challenge', config: { frontierCooldown403BaseSeconds: 60 }, nowMs });
    console.log('[P05-BACKOFF-04] bot_challenge backoff:', row.next_retry_ts);
    assert.notEqual(row.next_retry_ts, '');
  });

  it('noteHostRetryTs never regresses to earlier timestamp', () => {
    const row = createHostBudgetRow();
    noteHostRetryTs(row, '2026-02-20T14:00:00.000Z');
    noteHostRetryTs(row, '2026-02-20T13:00:00.000Z');
    console.log('[P05-BACKOFF-05] no regression:', row.next_retry_ts);
    assert.equal(row.next_retry_ts, '2026-02-20T14:00:00.000Z');
  });
});

describe('Phase 05 Audit — Outcome Classification Edge Cases', () => {
  it('407 proxy auth returns login_wall', () => {
    const outcome = classifyFetchOutcome({ status: 407 });
    console.log('[P05-CLASSIFY-01] 407:', outcome);
    assert.equal(outcome, 'login_wall');
  });

  it('403 with login message returns login_wall (not blocked)', () => {
    const outcome = classifyFetchOutcome({ status: 403, message: 'Please sign-in to continue' });
    console.log('[P05-CLASSIFY-02] 403+login:', outcome);
    assert.equal(outcome, 'login_wall');
  });

  it('502 returns server_error', () => {
    const outcome = classifyFetchOutcome({ status: 502 });
    console.log('[P05-CLASSIFY-03] 502:', outcome);
    assert.equal(outcome, 'server_error');
  });

  it('status 0 with rate_limit message returns rate_limited', () => {
    const outcome = classifyFetchOutcome({ status: 0, message: 'rate limit exceeded' });
    console.log('[P05-CLASSIFY-04] 0+ratelimit:', outcome);
    assert.equal(outcome, 'rate_limited');
  });

  it('status 0 with no message returns fetch_error', () => {
    const outcome = classifyFetchOutcome({ status: 0, message: '' });
    console.log('[P05-CLASSIFY-05] 0+empty:', outcome);
    assert.equal(outcome, 'fetch_error');
  });

  it('status 0 with ECONNRESET returns network_timeout', () => {
    const outcome = classifyFetchOutcome({ status: 0, message: 'ECONNRESET' });
    console.log('[P05-CLASSIFY-06] ECONNRESET:', outcome);
    assert.equal(outcome, 'network_timeout');
  });

  it('status 0 with socket hang up returns network_timeout', () => {
    const outcome = classifyFetchOutcome({ status: 0, message: 'socket hang up' });
    console.log('[P05-CLASSIFY-07] socket hang up:', outcome);
    assert.equal(outcome, 'network_timeout');
  });

  it('status 0 with DNS error returns network_timeout', () => {
    const outcome = classifyFetchOutcome({ status: 0, message: 'dns resolution failed' });
    console.log('[P05-CLASSIFY-08] dns:', outcome);
    assert.equal(outcome, 'network_timeout');
  });

  it('FETCH_OUTCOME_KEYS has exactly 10 entries', () => {
    console.log('[P05-CLASSIFY-09] keys:', FETCH_OUTCOME_KEYS);
    assert.equal(FETCH_OUTCOME_KEYS.length, 10);
  });

  it('createFetchOutcomeCounters initializes all keys to 0', () => {
    const counters = createFetchOutcomeCounters();
    const nonZero = Object.values(counters).filter(v => v !== 0);
    console.log('[P05-CLASSIFY-10] counter keys:', Object.keys(counters).length);
    assert.equal(Object.keys(counters).length, 10);
    assert.equal(nonZero.length, 0);
  });
});

describe('Phase 05 Audit — Fetcher Mode Selection', () => {
  it('priority order: dryrun > http > crawlee > playwright', () => {
    assert.equal(selectFetcherMode({ dryRun: true, preferHttpFetcher: true, dynamicCrawleeEnabled: true }), 'dryrun');
    assert.equal(selectFetcherMode({ dryRun: false, preferHttpFetcher: true, dynamicCrawleeEnabled: true }), 'http');
    assert.equal(selectFetcherMode({ dryRun: false, preferHttpFetcher: false, dynamicCrawleeEnabled: true }), 'crawlee');
    assert.equal(selectFetcherMode({ dryRun: false, preferHttpFetcher: false, dynamicCrawleeEnabled: false }), 'playwright');
    console.log('[P05-FETCHER-01] priority chain verified');
  });

  it('defaults to playwright with empty config', () => {
    const mode = selectFetcherMode({});
    console.log('[P05-FETCHER-02] empty config:', mode);
    assert.equal(mode, 'playwright');
  });
});

describe('Phase 05 Audit — Dynamic Fetch Policy', () => {
  it('normalizes policy map with string values', () => {
    const map = normalizeDynamicFetchPolicyMap({
      'rtings.com': { perHostMinDelayMs: '2000', pageGotoTimeoutMs: '45000' }
    });
    console.log('[P05-POLICY-01] normalized:', JSON.stringify(map['rtings.com']));
    assert.equal(map['rtings.com'].perHostMinDelayMs, 2000);
    assert.equal(map['rtings.com'].pageGotoTimeoutMs, 45000);
  });

  it('resolves subdomain to parent domain policy', () => {
    const config = {
      perHostMinDelayMs: 900,
      pageGotoTimeoutMs: 30000,
      dynamicFetchPolicyMap: normalizeDynamicFetchPolicyMap({
        'razer.com': { perHostMinDelayMs: 1500, pageGotoTimeoutMs: 20000 }
      })
    };
    const policy = resolveDynamicFetchPolicy(config, { host: 'shop.razer.com' });
    console.log('[P05-POLICY-02] subdomain resolution:', policy.matchedHost, policy.perHostMinDelayMs);
    assert.equal(policy.matchedHost, 'razer.com');
    assert.equal(policy.overrideApplied, true);
    assert.equal(policy.perHostMinDelayMs, 1500);
  });

  it('no override for unknown host returns global defaults', () => {
    const config = {
      perHostMinDelayMs: 900,
      pageGotoTimeoutMs: 30000,
      dynamicFetchPolicyMap: {}
    };
    const policy = resolveDynamicFetchPolicy(config, { host: 'unknown.com' });
    console.log('[P05-POLICY-03] no override:', policy.overrideApplied, policy.perHostMinDelayMs);
    assert.equal(policy.overrideApplied, false);
    assert.equal(policy.perHostMinDelayMs, 900);
  });

  it('override with 0 value falls back to global config', () => {
    const config = {
      perHostMinDelayMs: 900,
      pageGotoTimeoutMs: 30000,
      dynamicFetchPolicyMap: normalizeDynamicFetchPolicyMap({
        'example.com': { perHostMinDelayMs: 0, pageGotoTimeoutMs: 15000 }
      })
    };
    const policy = resolveDynamicFetchPolicy(config, { host: 'example.com' });
    console.log('[P05-POLICY-04] zero override fallback:', policy.perHostMinDelayMs, policy.pageGotoTimeoutMs);
    assert.equal(policy.perHostMinDelayMs, 900);
    assert.equal(policy.pageGotoTimeoutMs, 15000);
  });
});

describe('Phase 05 Audit — Host Budget Map Integration', () => {
  it('ensureHostBudgetRow creates separate rows per host', () => {
    const map = new Map();
    const row1 = ensureHostBudgetRow(map, 'razer.com');
    const row2 = ensureHostBudgetRow(map, 'rtings.com');
    row1.started_count = 5;
    row2.started_count = 3;
    console.log('[P05-MAP-01] razer:', row1.started_count, 'rtings:', row2.started_count);
    assert.equal(map.size, 2);
    assert.equal(ensureHostBudgetRow(map, 'razer.com').started_count, 5);
    assert.equal(ensureHostBudgetRow(map, 'rtings.com').started_count, 3);
  });

  it('bumpHostOutcome accumulates across multiple calls', () => {
    const row = createHostBudgetRow();
    bumpHostOutcome(row, 'ok');
    bumpHostOutcome(row, 'ok');
    bumpHostOutcome(row, 'blocked');
    bumpHostOutcome(row, 'not_found');
    console.log('[P05-MAP-02] outcomes:', JSON.stringify(row.outcome_counts));
    assert.equal(row.outcome_counts.ok, 2);
    assert.equal(row.outcome_counts.blocked, 1);
    assert.equal(row.outcome_counts.not_found, 1);
  });

  it('full lifecycle: fetch → bump → resolve tracks correctly', () => {
    const row = createHostBudgetRow();
    row.started_count = 1;
    bumpHostOutcome(row, 'ok');
    row.completed_count = 1;
    row.evidence_used = 1;
    const state1 = resolveHostBudgetState(row);
    console.log('[P05-MAP-03] after 1 ok: score=', state1.score, 'state=', state1.state);
    assert.equal(state1.state, 'open');
    assert.ok(state1.score >= 100);

    row.started_count = 2;
    bumpHostOutcome(row, 'blocked');
    row.completed_count = 2;
    const state2 = resolveHostBudgetState(row);
    console.log('[P05-MAP-03b] after 1 ok + 1 blocked: score=', state2.score);
    assert.ok(state2.score < 100);
    assert.ok(state2.score >= 55);
  });
});
