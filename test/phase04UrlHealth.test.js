import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { FrontierDb } from '../src/research/frontierDb.js';
import { FrontierDbSqlite } from '../src/research/frontierSqlite.js';
import { canonicalizeUrl, pathSignature, isTrackingParam } from '../src/research/urlNormalize.js';
import { resolveDeepeningTier, uberStopDecision } from '../src/research/frontierScheduler.js';
import {
  buildRepairSearchQuery,
  normalizeHostToken,
  hostFromHttpUrl,
  classifyFetchOutcome
} from '../src/pipeline/fetchParseWorker.js';

function createStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    resolveOutputKey: (...parts) => parts.filter(Boolean).join('/'),
    async readJsonOrNull(key) {
      return data.has(key) ? data.get(key) : null;
    },
    async writeObject(key, body) {
      data.set(key, JSON.parse(Buffer.from(body).toString('utf8')));
    }
  };
}

function tmpDbPath() {
  return path.join(os.tmpdir(), `phase04-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanup(dbPath) {
  try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
}

const FRONTIER_KEY = 'specs/outputs/_intel/frontier/frontier.json';

describe('Phase 04 Audit — URL Canonicalization', () => {
  it('strips tracking params (utm_*, gclid, fbclid)', () => {
    const result = canonicalizeUrl('https://example.com/spec?utm_source=google&utm_medium=cpc&gclid=abc&real_param=val');
    console.log('[P04-CANON-01] canonical_url:', result.canonical_url);
    assert.ok(!result.canonical_url.includes('utm_source'));
    assert.ok(!result.canonical_url.includes('gclid'));
    assert.ok(result.canonical_url.includes('real_param=val'));
  });

  it('strips www prefix and normalizes host to lowercase', () => {
    const result = canonicalizeUrl('https://WWW.Example.COM/page');
    console.log('[P04-CANON-02] domain:', result.domain, 'canonical:', result.canonical_url);
    assert.equal(result.domain, 'example.com');
    assert.ok(!result.canonical_url.includes('www.'));
  });

  it('normalizes trailing slashes and /amp/ prefixes', () => {
    const normal = canonicalizeUrl('https://example.com/page/');
    const amp = canonicalizeUrl('https://example.com/amp/page');
    console.log('[P04-CANON-03] trailing_slash:', normal.canonical_url, 'amp:', amp.canonical_url);
    assert.ok(!normal.canonical_url.endsWith('/page/'));
    assert.ok(!amp.canonical_url.includes('/amp/'));
  });

  it('produces stable path signatures for numeric and hex segments', () => {
    const sig1 = pathSignature('/products/12345/reviews');
    const sig2 = pathSignature('/products/67890/reviews');
    const sig3 = pathSignature('/items/abcdef1234567890/details');
    console.log('[P04-CANON-04] sig1:', sig1, 'sig2:', sig2, 'sig3:', sig3);
    assert.equal(sig1, sig2);
    assert.ok(sig3.includes(':id'));
  });

  it('returns empty canonical_url for invalid URLs', () => {
    const result = canonicalizeUrl('not-a-url');
    console.log('[P04-CANON-05] invalid_url result:', JSON.stringify(result));
    assert.equal(result.canonical_url, '');
    assert.equal(result.domain, '');
  });

  it('identifies tracking params correctly', () => {
    assert.equal(isTrackingParam('utm_source'), true);
    assert.equal(isTrackingParam('utm_campaign'), true);
    assert.equal(isTrackingParam('fbclid'), true);
    assert.equal(isTrackingParam('gclid'), true);
    assert.equal(isTrackingParam('page'), false);
    assert.equal(isTrackingParam('id'), false);
    console.log('[P04-CANON-06] tracking param identification OK');
  });
});

describe('Phase 04 Audit — JSON FrontierDb Cooldown Logic', () => {
  it('applies 404 cooldown and skips URL', async () => {
    const storage = createStorage();
    const db = new FrontierDb({
      storage,
      key: FRONTIER_KEY,
      config: { frontierCooldown404Seconds: 3600 }
    });
    await db.load();
    db.recordFetch({ productId: 'p1', url: 'https://example.com/dead', status: 404 });
    const skip = db.shouldSkipUrl('https://example.com/dead');
    console.log('[P04-JSON-01] 404 skip:', JSON.stringify(skip));
    assert.equal(skip.skip, true);
    assert.equal(skip.reason, 'cooldown');
  });

  it('applies 403 backoff with exponential escalation', async () => {
    const storage = createStorage();
    const db = new FrontierDb({
      storage,
      key: FRONTIER_KEY,
      config: { frontierCooldown403BaseSeconds: 60 }
    });
    await db.load();
    db.recordFetch({ productId: 'p1', url: 'https://blocked.com/page', status: 403 });
    const row1 = db.getUrlRow('https://blocked.com/page');
    const seconds1 = row1.cooldown.seconds;
    db.recordFetch({ productId: 'p1', url: 'https://blocked.com/page', status: 403 });
    const row2 = db.getUrlRow('https://blocked.com/page');
    const seconds2 = row2.cooldown.seconds;
    console.log('[P04-JSON-02] 403 backoff: first=', seconds1, 'second=', seconds2);
    assert.equal(row1.cooldown.reason, 'status_403_backoff');
    assert.ok(seconds2 > seconds1, 'second 403 should have longer cooldown');
  });

  it('applies 429 backoff with exponential escalation', async () => {
    const storage = createStorage();
    const db = new FrontierDb({
      storage,
      key: FRONTIER_KEY,
      config: { frontierCooldown429BaseSeconds: 60 }
    });
    await db.load();
    db.recordFetch({ productId: 'p1', url: 'https://rate.com/api', status: 429 });
    const row1 = db.getUrlRow('https://rate.com/api');
    db.recordFetch({ productId: 'p1', url: 'https://rate.com/api', status: 429 });
    const row2 = db.getUrlRow('https://rate.com/api');
    console.log('[P04-JSON-03] 429 backoff: first=', row1.cooldown.seconds, 'second=', row2.cooldown.seconds);
    assert.equal(row1.cooldown.reason, 'status_429_backoff');
    assert.ok(row2.cooldown.seconds > row1.cooldown.seconds);
  });

  it('applies 410 long cooldown', async () => {
    const storage = createStorage();
    const db = new FrontierDb({
      storage,
      key: FRONTIER_KEY,
      config: { frontierCooldown410Seconds: 7776000 }
    });
    await db.load();
    db.recordFetch({ productId: 'p1', url: 'https://gone.com/removed', status: 410 });
    const row = db.getUrlRow('https://gone.com/removed');
    console.log('[P04-JSON-04] 410 cooldown:', row.cooldown.reason, row.cooldown.seconds);
    assert.equal(row.cooldown.reason, 'status_410');
    assert.equal(row.cooldown.seconds, 7776000);
  });

  it('escalates 404 to repeated after 3+ fetches', async () => {
    const storage = createStorage();
    const db = new FrontierDb({
      storage,
      key: FRONTIER_KEY,
      config: { frontierCooldown404Seconds: 60, frontierCooldown404RepeatSeconds: 600 }
    });
    await db.load();
    db.recordFetch({ productId: 'p1', url: 'https://dead.com/p', status: 404 });
    const row1 = db.getUrlRow('https://dead.com/p');
    assert.equal(row1.cooldown.reason, 'status_404');
    db.recordFetch({ productId: 'p1', url: 'https://dead.com/p', status: 404 });
    db.recordFetch({ productId: 'p1', url: 'https://dead.com/p', status: 404 });
    const row3 = db.getUrlRow('https://dead.com/p');
    console.log('[P04-JSON-05] 404 repeat escalation: reason=', row3.cooldown.reason, 'seconds=', row3.cooldown.seconds);
    assert.equal(row3.cooldown.reason, 'status_404_repeated');
    assert.equal(row3.cooldown.seconds, 600);
  });

  it('does not apply cooldown for 200 responses', async () => {
    const storage = createStorage();
    const db = new FrontierDb({ storage, key: FRONTIER_KEY });
    await db.load();
    db.recordFetch({ productId: 'p1', url: 'https://ok.com/spec', status: 200, fieldsFound: ['weight'] });
    const skip = db.shouldSkipUrl('https://ok.com/spec');
    console.log('[P04-JSON-06] 200 response skip:', skip.skip);
    assert.equal(skip.skip, false);
  });

  it('detects path dead pattern after threshold notfound count', async () => {
    const storage = createStorage();
    const db = new FrontierDb({
      storage,
      key: FRONTIER_KEY,
      config: { frontierPathPenaltyNotfoundThreshold: 2 }
    });
    await db.load();
    db.recordFetch({ productId: 'p1', url: 'https://site.com/support/111', status: 404 });
    db.recordFetch({ productId: 'p1', url: 'https://site.com/support/222', status: 404 });
    const skip = db.shouldSkipUrl('https://site.com/support/333');
    console.log('[P04-JSON-07] path dead pattern:', JSON.stringify(skip));
    assert.equal(skip.skip, true);
    assert.equal(skip.reason, 'path_dead_pattern');
  });

  it('path dead pattern does not trigger when ok_count > 0', async () => {
    const storage = createStorage();
    const db = new FrontierDb({
      storage,
      key: FRONTIER_KEY,
      config: { frontierPathPenaltyNotfoundThreshold: 2 }
    });
    await db.load();
    db.recordFetch({ productId: 'p1', url: 'https://site.com/support/111', status: 404 });
    db.recordFetch({ productId: 'p1', url: 'https://site.com/support/222', status: 200 });
    db.recordFetch({ productId: 'p1', url: 'https://site.com/support/333', status: 404 });
    const skip = db.shouldSkipUrl('https://site.com/support/444');
    console.log('[P04-JSON-08] path mixed status skip:', skip.skip);
    assert.equal(skip.skip, false);
  });

  it('caps 403 backoff exponent at 4 (max 16x base)', async () => {
    const storage = createStorage();
    const db = new FrontierDb({
      storage,
      key: FRONTIER_KEY,
      config: { frontierCooldown403BaseSeconds: 60 }
    });
    await db.load();
    for (let i = 0; i < 10; i++) {
      db.recordFetch({ productId: 'p1', url: 'https://blocked.com/x', status: 403 });
    }
    const row = db.getUrlRow('https://blocked.com/x');
    const maxExpected = 60 * Math.pow(2, 4);
    console.log('[P04-JSON-09] 403 max backoff: actual=', row.cooldown.seconds, 'expected_cap=', maxExpected);
    assert.ok(row.cooldown.seconds <= maxExpected, `cooldown ${row.cooldown.seconds} should be <= ${maxExpected}`);
  });

  it('query cooldown prevents duplicate queries within window', async () => {
    const storage = createStorage();
    const db = new FrontierDb({
      storage,
      key: FRONTIER_KEY,
      config: { frontierQueryCooldownSeconds: 3600 }
    });
    await db.load();
    assert.equal(db.shouldSkipQuery({ productId: 'p1', query: 'razer viper specs' }), false);
    db.recordQuery({ productId: 'p1', query: 'razer viper specs', provider: 'searxng', fields: ['weight'] });
    assert.equal(db.shouldSkipQuery({ productId: 'p1', query: 'razer viper specs' }), true);
    assert.equal(db.shouldSkipQuery({ productId: 'p1', query: 'razer viper specs', force: true }), false);
    assert.equal(db.shouldSkipQuery({ productId: 'p2', query: 'razer viper specs' }), false);
    console.log('[P04-JSON-10] query cooldown + force + product isolation OK');
  });

  it('query cooldown is case-insensitive', async () => {
    const storage = createStorage();
    const db = new FrontierDb({
      storage,
      key: FRONTIER_KEY,
      config: { frontierQueryCooldownSeconds: 3600 }
    });
    await db.load();
    db.recordQuery({ productId: 'p1', query: 'RAZER Viper SPECS', provider: 'google' });
    const skip = db.shouldSkipQuery({ productId: 'p1', query: 'razer viper specs' });
    console.log('[P04-JSON-11] case-insensitive query dedupe:', skip);
    assert.equal(skip, true);
  });

  it('rankPenaltyForUrl returns negative for 404/410 URLs', async () => {
    const storage = createStorage();
    const db = new FrontierDb({ storage, key: FRONTIER_KEY });
    await db.load();
    db.recordFetch({ productId: 'p1', url: 'https://dead.com/spec', status: 404 });
    const penalty = db.rankPenaltyForUrl('https://dead.com/spec');
    console.log('[P04-JSON-12] rankPenalty for 404:', penalty);
    assert.ok(penalty < 0, 'penalty should be negative for 404');
    assert.equal(penalty, -1.5);
  });
});

describe('Phase 04 Audit — SQLite FrontierDb Contract Parity', () => {
  it('SQLite 404 cooldown matches JSON reason string', () => {
    const dbPath = tmpDbPath();
    try {
      const frontier = new FrontierDbSqlite({ dbPath });
      frontier.recordFetch({ productId: 'p1', url: 'https://example.com/missing', status: 404 });
      const row = frontier.getUrlRow('https://example.com/missing');
      console.log('[P04-SQL-01] SQLite 404 reason:', row?.cooldown?.reason);
      assert.equal(row?.cooldown?.reason, 'status_404',
        `BUG CSV-4a: SQLite 404 reason should be 'status_404' to match JSON backend, got '${row?.cooldown?.reason}'`);
      frontier.close();
    } finally {
      cleanup(dbPath);
    }
  });

  it('SQLite 403 cooldown matches JSON reason string', () => {
    const dbPath = tmpDbPath();
    try {
      const frontier = new FrontierDbSqlite({ dbPath, config: { frontierCooldown403BaseSeconds: 60 } });
      frontier.recordFetch({ productId: 'p1', url: 'https://blocked.com/x', status: 403 });
      const row = frontier.getUrlRow('https://blocked.com/x');
      console.log('[P04-SQL-02] SQLite 403 reason:', row?.cooldown?.reason);
      assert.equal(row?.cooldown?.reason, 'status_403_backoff',
        `BUG CSV-4a: SQLite 403 reason should be 'status_403_backoff' to match JSON backend, got '${row?.cooldown?.reason}'`);
      frontier.close();
    } finally {
      cleanup(dbPath);
    }
  });

  it('SQLite 429 cooldown matches JSON reason string', () => {
    const dbPath = tmpDbPath();
    try {
      const frontier = new FrontierDbSqlite({ dbPath, config: { frontierCooldown429BaseSeconds: 60 } });
      frontier.recordFetch({ productId: 'p1', url: 'https://rate.com/api', status: 429 });
      const row = frontier.getUrlRow('https://rate.com/api');
      console.log('[P04-SQL-03] SQLite 429 reason:', row?.cooldown?.reason);
      assert.equal(row?.cooldown?.reason, 'status_429_backoff',
        `BUG CSV-4a: SQLite 429 reason should be 'status_429_backoff' to match JSON backend, got '${row?.cooldown?.reason}'`);
      frontier.close();
    } finally {
      cleanup(dbPath);
    }
  });

  it('SQLite 410 cooldown matches JSON reason string', () => {
    const dbPath = tmpDbPath();
    try {
      const frontier = new FrontierDbSqlite({ dbPath, config: { frontierCooldown410Seconds: 7776000 } });
      frontier.recordFetch({ productId: 'p1', url: 'https://gone.com/x', status: 410 });
      const row = frontier.getUrlRow('https://gone.com/x');
      console.log('[P04-SQL-04] SQLite 410 reason:', row?.cooldown?.reason);
      assert.equal(row?.cooldown?.reason, 'status_410',
        `BUG CSV-4a: SQLite 410 reason should be 'status_410' to match JSON backend, got '${row?.cooldown?.reason}'`);
      frontier.close();
    } finally {
      cleanup(dbPath);
    }
  });

  it('SQLite 404 repeat escalation matches JSON behavior', () => {
    const dbPath = tmpDbPath();
    try {
      const frontier = new FrontierDbSqlite({
        dbPath,
        config: { frontierCooldown404Seconds: 60, frontierCooldown404RepeatSeconds: 600 }
      });
      frontier.recordFetch({ productId: 'p1', url: 'https://dead.com/p', status: 404 });
      frontier.recordFetch({ productId: 'p1', url: 'https://dead.com/p', status: 404 });
      frontier.recordFetch({ productId: 'p1', url: 'https://dead.com/p', status: 404 });
      const row = frontier.getUrlRow('https://dead.com/p');
      console.log('[P04-SQL-05] SQLite 404 repeat: reason=', row?.cooldown?.reason, 'seconds=', row?.cooldown?.seconds);
      assert.equal(row?.cooldown?.reason, 'status_404_repeated',
        `BUG CSV-4b: SQLite should distinguish 404 repeat from first 404, got '${row?.cooldown?.reason}'`);
      frontier.close();
    } finally {
      cleanup(dbPath);
    }
  });

  it('SQLite 403 backoff caps exponent at 4 (matching JSON)', () => {
    const dbPath = tmpDbPath();
    try {
      const frontier = new FrontierDbSqlite({ dbPath, config: { frontierCooldown403BaseSeconds: 60 } });
      for (let i = 0; i < 10; i++) {
        frontier.recordFetch({ productId: 'p1', url: 'https://blocked.com/x', status: 403 });
      }
      const row = frontier.getUrlRow('https://blocked.com/x');
      const maxExpected = 60 * Math.pow(2, 4);
      console.log('[P04-SQL-06] SQLite 403 max backoff: actual=', row?.cooldown?.seconds, 'expected_cap=', maxExpected);
      assert.ok(row?.cooldown?.seconds <= maxExpected,
        `BUG CSV-4c: SQLite 403 exponent cap should be 4, not 8. Actual cooldown ${row?.cooldown?.seconds} exceeds ${maxExpected}`);
      frontier.close();
    } finally {
      cleanup(dbPath);
    }
  });
});

describe('Phase 04 Audit — Repair Query Builder', () => {
  it('builds site-scoped repair query with identity', () => {
    const query = buildRepairSearchQuery({
      domain: 'razer.com',
      brand: 'Razer',
      model: 'Viper V3 Pro',
      variant: ''
    });
    console.log('[P04-REPAIR-01] repair query:', query);
    assert.ok(query.includes('site:razer.com'));
    assert.ok(query.includes('Razer'));
    assert.ok(query.includes('Viper V3 Pro'));
    assert.ok(query.includes('spec OR manual OR pdf'));
  });

  it('returns empty for empty domain', () => {
    const query = buildRepairSearchQuery({ domain: '', brand: 'Razer', model: 'Viper' });
    console.log('[P04-REPAIR-02] empty domain query:', JSON.stringify(query));
    assert.equal(query, '');
  });

  it('normalizes host token (strips www, lowercases)', () => {
    assert.equal(normalizeHostToken('WWW.Example.COM'), 'example.com');
    assert.equal(normalizeHostToken('razer.com'), 'razer.com');
    console.log('[P04-REPAIR-03] host normalization OK');
  });

  it('extracts host from HTTP URL', () => {
    assert.equal(hostFromHttpUrl('https://www.razer.com/spec'), 'razer.com');
    assert.equal(hostFromHttpUrl(''), '');
    assert.equal(hostFromHttpUrl('not-a-url'), '');
    console.log('[P04-REPAIR-04] hostFromHttpUrl OK');
  });
});

describe('Phase 04 Audit — Fetch Outcome Classification', () => {
  it('classifies 200 as ok', () => {
    const outcome = classifyFetchOutcome({ status: 200, contentType: 'text/html', html: '<html>content</html>' });
    console.log('[P04-OUTCOME-01] 200:', outcome);
    assert.equal(outcome, 'ok');
  });

  it('classifies 404 as not_found', () => {
    const outcome = classifyFetchOutcome({ status: 404 });
    console.log('[P04-OUTCOME-02] 404:', outcome);
    assert.equal(outcome, 'not_found');
  });

  it('classifies 403 as blocked', () => {
    const outcome = classifyFetchOutcome({ status: 403 });
    console.log('[P04-OUTCOME-03] 403:', outcome);
    assert.equal(outcome, 'blocked');
  });

  it('classifies 429 as rate_limited', () => {
    const outcome = classifyFetchOutcome({ status: 429 });
    console.log('[P04-OUTCOME-04] 429:', outcome);
    assert.equal(outcome, 'rate_limited');
  });

  it('classifies timeout errors as network_timeout', () => {
    const outcome = classifyFetchOutcome({ status: 0, message: 'ETIMEDOUT connecting' });
    console.log('[P04-OUTCOME-05] timeout:', outcome);
    assert.equal(outcome, 'network_timeout');
  });

  it('classifies captcha/bot challenge on 403 as bot_challenge', () => {
    const outcome = classifyFetchOutcome({ status: 403, message: 'cloudflare captcha detected' });
    console.log('[P04-OUTCOME-06] bot_challenge:', outcome);
    assert.equal(outcome, 'bot_challenge');
  });

  it('classifies 200 with captcha message still as ok (status takes precedence)', () => {
    const outcome = classifyFetchOutcome({ status: 200, message: 'cloudflare captcha detected' });
    console.log('[P04-OUTCOME-07] 200+captcha_msg:', outcome);
    assert.equal(outcome, 'ok');
  });
});

describe('Phase 04 Audit — Frontier Scheduler', () => {
  it('resolveDeepeningTier starts at tier0 for round 0', () => {
    const tier = resolveDeepeningTier({ round: 0, mode: 'balanced' });
    console.log('[P04-SCHED-01] round0 balanced:', tier);
    assert.equal(tier, 'tier0');
  });

  it('resolveDeepeningTier escalates to tier3 in uber_aggressive with stalled criticals', () => {
    const tier = resolveDeepeningTier({
      round: 3,
      mode: 'uber_aggressive',
      previousSummary: {
        missing_required_fields: ['dpi'],
        critical_fields_below_pass_target: ['dpi']
      },
      noProgressRounds: 2
    });
    console.log('[P04-SCHED-02] uber_aggressive tier3:', tier);
    assert.equal(tier, 'tier3');
  });

  it('uberStopDecision stops when required+critical satisfied', () => {
    const result = uberStopDecision({
      summary: { missing_required_fields: [], critical_fields_below_pass_target: [] },
      round: 1
    });
    console.log('[P04-SCHED-03] satisfied stop:', result);
    assert.equal(result.stop, true);
    assert.equal(result.reason, 'required_and_critical_satisfied');
  });

  it('uberStopDecision stops on diminishing returns', () => {
    const result = uberStopDecision({
      summary: { missing_required_fields: ['weight'] },
      round: 4,
      noNewHighYieldRounds: 2,
      noNewFieldsRounds: 2
    });
    console.log('[P04-SCHED-04] diminishing returns:', result);
    assert.equal(result.stop, true);
    assert.equal(result.reason, 'diminishing_returns');
  });

  it('uberStopDecision stops on max rounds', () => {
    const result = uberStopDecision({
      summary: { missing_required_fields: ['weight'] },
      round: 7,
      maxRounds: 8
    });
    console.log('[P04-SCHED-05] max rounds:', result);
    assert.equal(result.stop, true);
    assert.equal(result.reason, 'max_rounds_reached');
  });

  it('uberStopDecision stops on time budget exceeded', () => {
    const result = uberStopDecision({
      summary: { missing_required_fields: ['weight'] },
      round: 1,
      elapsedMs: 600000,
      maxMs: 500000
    });
    console.log('[P04-SCHED-06] time budget:', result);
    assert.equal(result.stop, true);
    assert.equal(result.reason, 'time_budget_exceeded');
  });

  it('uberStopDecision continues when work remains', () => {
    const result = uberStopDecision({
      summary: { missing_required_fields: ['weight'], critical_fields_below_pass_target: ['dpi'] },
      round: 2,
      maxRounds: 8
    });
    console.log('[P04-SCHED-07] continue:', result);
    assert.equal(result.stop, false);
    assert.equal(result.reason, 'continue');
  });
});

describe('Phase 04 Audit — Snapshot + Persistence', () => {
  it('snapshotForProduct aggregates field_yield from recorded fetches', async () => {
    const storage = createStorage();
    const db = new FrontierDb({ storage, key: FRONTIER_KEY });
    await db.load();
    db.recordFetch({ productId: 'mouse-1', url: 'https://a.com/spec', status: 200, fieldsFound: ['weight', 'dpi'] });
    db.recordFetch({ productId: 'mouse-1', url: 'https://b.com/spec', status: 200, fieldsFound: ['sensor'] });
    db.recordQuery({ productId: 'mouse-1', query: 'mouse specs', provider: 'google', results: [{ url: 'https://a.com/spec' }] });
    const snap = db.snapshotForProduct('mouse-1');
    console.log('[P04-SNAP-01] field_yield:', JSON.stringify(snap.field_yield));
    assert.ok(snap.field_yield.weight >= 1);
    assert.ok(snap.field_yield.dpi >= 1);
    assert.ok(snap.field_yield.sensor >= 1);
    assert.equal(snap.query_count, 1);
  });

  it('frontierSnapshot returns URLs sorted by last_seen desc', async () => {
    const storage = createStorage();
    const db = new FrontierDb({ storage, key: FRONTIER_KEY });
    await db.load();
    db.recordFetch({ productId: 'p1', url: 'https://old.com', status: 200, ts: '2025-01-01T00:00:00.000Z' });
    db.recordFetch({ productId: 'p1', url: 'https://new.com', status: 200, ts: '2025-06-15T00:00:00.000Z' });
    const snap = db.frontierSnapshot({ limit: 10 });
    console.log('[P04-SNAP-02] snapshot order: first=', snap.urls[0]?.canonical_url, 'last=', snap.urls[1]?.canonical_url);
    assert.equal(snap.urls.length, 2);
    assert.ok(snap.urls[0].last_seen_ts >= snap.urls[1].last_seen_ts);
  });

  it('save and load round-trip preserves state', async () => {
    const storage = createStorage();
    const db1 = new FrontierDb({ storage, key: FRONTIER_KEY });
    await db1.load();
    db1.recordQuery({ productId: 'p1', query: 'test query', provider: 'google', fields: ['weight'] });
    db1.recordFetch({ productId: 'p1', url: 'https://example.com/spec', status: 200, fieldsFound: ['weight'] });
    await db1.save();
    const db2 = new FrontierDb({ storage, key: FRONTIER_KEY });
    await db2.load();
    const skip = db2.shouldSkipQuery({ productId: 'p1', query: 'test query' });
    console.log('[P04-SNAP-03] round-trip query skip:', skip);
    assert.equal(skip, true);
    const row = db2.getUrlRow('https://example.com/spec');
    assert.ok(row);
    assert.equal(row.last_status, 200);
  });
});
