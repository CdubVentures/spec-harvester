import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeHostToken,
  hostFromHttpUrl,
  classifyFetchOutcome,
  FETCH_OUTCOME_KEYS,
  createFetchOutcomeCounters,
  createHostBudgetRow,
  ensureHostBudgetRow,
  noteHostRetryTs,
  bumpHostOutcome,
  applyHostBudgetBackoff,
  resolveHostBudgetState,
  compactQueryText,
  buildRepairSearchQuery
} from '../src/pipeline/fetchParseWorker.js';

describe('normalizeHostToken', () => {
  it('lowercases and trims', () => {
    assert.equal(normalizeHostToken('  EXAMPLE.COM  '), 'example.com');
  });

  it('strips www. prefix', () => {
    assert.equal(normalizeHostToken('www.example.com'), 'example.com');
  });

  it('returns empty string for empty input', () => {
    assert.equal(normalizeHostToken(''), '');
    assert.equal(normalizeHostToken(null), '');
    assert.equal(normalizeHostToken(undefined), '');
  });
});

describe('hostFromHttpUrl', () => {
  it('extracts and normalizes host from a URL', () => {
    assert.equal(hostFromHttpUrl('https://www.example.com/path?q=1'), 'example.com');
  });

  it('returns empty for invalid URL', () => {
    assert.equal(hostFromHttpUrl('not-a-url'), '');
  });

  it('returns empty for empty input', () => {
    assert.equal(hostFromHttpUrl(''), '');
    assert.equal(hostFromHttpUrl(null), '');
  });
});

describe('classifyFetchOutcome', () => {
  it('returns ok for 200 with content', () => {
    assert.equal(classifyFetchOutcome({ status: 200 }), 'ok');
  });

  it('returns ok for 301 redirect', () => {
    assert.equal(classifyFetchOutcome({ status: 301 }), 'ok');
  });

  it('returns not_found for 404', () => {
    assert.equal(classifyFetchOutcome({ status: 404 }), 'not_found');
  });

  it('returns not_found for 410', () => {
    assert.equal(classifyFetchOutcome({ status: 410 }), 'not_found');
  });

  it('returns rate_limited for 429', () => {
    assert.equal(classifyFetchOutcome({ status: 429 }), 'rate_limited');
  });

  it('returns login_wall for 401', () => {
    assert.equal(classifyFetchOutcome({ status: 401 }), 'login_wall');
  });

  it('returns blocked for 403', () => {
    assert.equal(classifyFetchOutcome({ status: 403 }), 'blocked');
  });

  it('returns bot_challenge for 403 with captcha message', () => {
    assert.equal(
      classifyFetchOutcome({ status: 403, message: 'captcha detected' }),
      'bot_challenge'
    );
  });

  it('returns server_error for 500+', () => {
    assert.equal(classifyFetchOutcome({ status: 500 }), 'server_error');
    assert.equal(classifyFetchOutcome({ status: 503 }), 'server_error');
  });

  it('returns bad_content for 200 with octet-stream and no html', () => {
    assert.equal(
      classifyFetchOutcome({ status: 200, contentType: 'application/octet-stream', html: '' }),
      'bad_content'
    );
  });

  it('returns network_timeout for timeout message', () => {
    assert.equal(
      classifyFetchOutcome({ status: 0, message: 'timeout' }),
      'network_timeout'
    );
  });

  it('returns fetch_error for unknown error', () => {
    assert.equal(classifyFetchOutcome({ status: 0, message: 'unknown problem' }), 'fetch_error');
  });

  it('returns ok for no args', () => {
    assert.equal(classifyFetchOutcome({}), 'fetch_error');
  });
});

describe('FETCH_OUTCOME_KEYS', () => {
  it('includes expected keys', () => {
    assert.ok(FETCH_OUTCOME_KEYS.includes('ok'));
    assert.ok(FETCH_OUTCOME_KEYS.includes('not_found'));
    assert.ok(FETCH_OUTCOME_KEYS.includes('blocked'));
    assert.ok(FETCH_OUTCOME_KEYS.includes('rate_limited'));
    assert.ok(FETCH_OUTCOME_KEYS.includes('fetch_error'));
    assert.equal(FETCH_OUTCOME_KEYS.length, 10);
  });
});

describe('createFetchOutcomeCounters', () => {
  it('returns object with all keys at zero', () => {
    const counters = createFetchOutcomeCounters();
    for (const key of FETCH_OUTCOME_KEYS) {
      assert.equal(counters[key], 0);
    }
  });
});

describe('createHostBudgetRow', () => {
  it('returns fresh budget row with zero counts', () => {
    const row = createHostBudgetRow();
    assert.equal(row.started_count, 0);
    assert.equal(row.completed_count, 0);
    assert.equal(row.dedupe_hits, 0);
    assert.equal(row.evidence_used, 0);
    assert.equal(row.parse_fail_count, 0);
    assert.equal(row.next_retry_ts, '');
    assert.equal(row.outcome_counts.ok, 0);
    assert.equal(row.outcome_counts.blocked, 0);
  });
});

describe('ensureHostBudgetRow', () => {
  it('creates a new row if host is not in map', () => {
    const map = new Map();
    const row = ensureHostBudgetRow(map, 'example.com');
    assert.equal(row.started_count, 0);
    assert.ok(map.has('example.com'));
  });

  it('returns existing row if already present', () => {
    const map = new Map();
    const first = ensureHostBudgetRow(map, 'example.com');
    first.started_count = 5;
    const second = ensureHostBudgetRow(map, 'example.com');
    assert.equal(second.started_count, 5);
  });

  it('normalizes host to lowercase', () => {
    const map = new Map();
    ensureHostBudgetRow(map, 'Example.COM');
    assert.ok(map.has('example.com'));
  });

  it('uses __unknown__ for empty host', () => {
    const map = new Map();
    ensureHostBudgetRow(map, '');
    assert.ok(map.has('__unknown__'));
  });
});

describe('noteHostRetryTs', () => {
  it('sets next_retry_ts when empty', () => {
    const row = createHostBudgetRow();
    noteHostRetryTs(row, '2026-02-20T12:00:00.000Z');
    assert.equal(row.next_retry_ts, '2026-02-20T12:00:00.000Z');
  });

  it('updates to a later timestamp', () => {
    const row = createHostBudgetRow();
    row.next_retry_ts = '2026-02-20T12:00:00.000Z';
    noteHostRetryTs(row, '2026-02-20T13:00:00.000Z');
    assert.equal(row.next_retry_ts, '2026-02-20T13:00:00.000Z');
  });

  it('does not regress to an earlier timestamp', () => {
    const row = createHostBudgetRow();
    row.next_retry_ts = '2026-02-20T13:00:00.000Z';
    noteHostRetryTs(row, '2026-02-20T12:00:00.000Z');
    assert.equal(row.next_retry_ts, '2026-02-20T13:00:00.000Z');
  });

  it('ignores empty or invalid values', () => {
    const row = createHostBudgetRow();
    noteHostRetryTs(row, '');
    assert.equal(row.next_retry_ts, '');
    noteHostRetryTs(row, 'garbage');
    assert.equal(row.next_retry_ts, '');
  });

  it('handles null row safely', () => {
    noteHostRetryTs(null, '2026-02-20T12:00:00.000Z');
  });
});

describe('bumpHostOutcome', () => {
  it('increments existing outcome key', () => {
    const row = createHostBudgetRow();
    bumpHostOutcome(row, 'ok');
    bumpHostOutcome(row, 'ok');
    assert.equal(row.outcome_counts.ok, 2);
  });

  it('creates new key for unknown outcome', () => {
    const row = createHostBudgetRow();
    bumpHostOutcome(row, 'custom_status');
    assert.equal(row.outcome_counts.custom_status, 1);
  });

  it('ignores null row or empty outcome', () => {
    bumpHostOutcome(null, 'ok');
    const row = createHostBudgetRow();
    bumpHostOutcome(row, '');
    assert.equal(row.outcome_counts.ok, 0);
  });
});

describe('applyHostBudgetBackoff', () => {
  it('sets backoff for 429 status', () => {
    const row = createHostBudgetRow();
    const nowMs = Date.parse('2026-02-20T12:00:00.000Z');
    applyHostBudgetBackoff(row, { status: 429, outcome: 'rate_limited', config: {}, nowMs });
    assert.notEqual(row.next_retry_ts, '');
    const retryMs = Date.parse(row.next_retry_ts);
    assert.ok(retryMs > nowMs);
  });

  it('sets backoff for 403 blocked', () => {
    const row = createHostBudgetRow();
    const nowMs = Date.parse('2026-02-20T12:00:00.000Z');
    applyHostBudgetBackoff(row, { status: 403, outcome: 'blocked', config: {}, nowMs });
    assert.notEqual(row.next_retry_ts, '');
  });

  it('sets backoff for network_timeout', () => {
    const row = createHostBudgetRow();
    const nowMs = Date.parse('2026-02-20T12:00:00.000Z');
    applyHostBudgetBackoff(row, { status: 0, outcome: 'network_timeout', config: {}, nowMs });
    assert.notEqual(row.next_retry_ts, '');
  });

  it('does not set backoff for ok outcome', () => {
    const row = createHostBudgetRow();
    const nowMs = Date.parse('2026-02-20T12:00:00.000Z');
    applyHostBudgetBackoff(row, { status: 200, outcome: 'ok', config: {}, nowMs });
    assert.equal(row.next_retry_ts, '');
  });

  it('handles null row safely', () => {
    applyHostBudgetBackoff(null, { status: 429 });
  });
});

describe('resolveHostBudgetState', () => {
  it('returns open state for fresh row', () => {
    const result = resolveHostBudgetState(createHostBudgetRow());
    assert.equal(result.state, 'open');
    assert.equal(result.score, 100);
    assert.equal(result.cooldown_seconds, 0);
  });

  it('returns degraded for rows with bad_content', () => {
    const row = createHostBudgetRow();
    row.outcome_counts.bad_content = 1;
    const result = resolveHostBudgetState(row);
    assert.equal(result.state, 'degraded');
  });

  it('returns degraded for rows with parse failures', () => {
    const row = createHostBudgetRow();
    row.parse_fail_count = 1;
    const result = resolveHostBudgetState(row);
    assert.equal(result.state, 'degraded');
  });

  it('returns active when in-flight requests exist', () => {
    const row = createHostBudgetRow();
    row.started_count = 3;
    row.completed_count = 1;
    const result = resolveHostBudgetState(row);
    assert.equal(result.state, 'active');
  });

  it('returns blocked for cooldown + low score + blocked signals', () => {
    const row = createHostBudgetRow();
    row.outcome_counts.blocked = 3;
    row.outcome_counts.rate_limited = 2;
    const nowMs = Date.parse('2026-02-20T12:00:00.000Z');
    row.next_retry_ts = '2026-02-20T13:00:00.000Z';
    const result = resolveHostBudgetState(row, nowMs);
    assert.equal(result.state, 'blocked');
    assert.ok(result.cooldown_seconds > 0);
  });

  it('returns backoff for cooldown without heavy signals', () => {
    const row = createHostBudgetRow();
    const nowMs = Date.parse('2026-02-20T12:00:00.000Z');
    row.next_retry_ts = '2026-02-20T12:05:00.000Z';
    const result = resolveHostBudgetState(row, nowMs);
    assert.equal(result.state, 'backoff');
    assert.ok(result.cooldown_seconds > 0);
  });

  it('score increases with ok outcomes', () => {
    const row = createHostBudgetRow();
    row.outcome_counts.blocked = 2;
    const base = resolveHostBudgetState(row);
    row.outcome_counts.ok = 5;
    const improved = resolveHostBudgetState(row);
    assert.ok(improved.score > base.score);
  });

  it('handles null row gracefully', () => {
    const result = resolveHostBudgetState(null);
    assert.equal(result.state, 'open');
    assert.equal(result.score, 100);
  });
});

describe('compactQueryText', () => {
  it('collapses whitespace', () => {
    assert.equal(compactQueryText('  hello   world  '), 'hello world');
  });

  it('returns empty for empty input', () => {
    assert.equal(compactQueryText(''), '');
    assert.equal(compactQueryText(null), '');
  });
});

describe('buildRepairSearchQuery', () => {
  it('builds site-scoped query with identity', () => {
    const query = buildRepairSearchQuery({
      domain: 'example.com',
      brand: 'Razer',
      model: 'Viper V3 Pro'
    });
    assert.ok(query.includes('site:example.com'));
    assert.ok(query.includes('"Razer Viper V3 Pro"'));
    assert.ok(query.includes('spec'));
  });

  it('returns empty for missing domain', () => {
    assert.equal(buildRepairSearchQuery({ brand: 'Razer' }), '');
  });

  it('works without brand/model', () => {
    const query = buildRepairSearchQuery({ domain: 'example.com' });
    assert.ok(query.includes('site:example.com'));
    assert.ok(!query.includes('""'));
  });
});
