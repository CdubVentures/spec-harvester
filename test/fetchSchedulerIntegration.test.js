import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createFetchScheduler } from '../src/concurrency/fetchScheduler.js';
import { classifyFallbackAction, buildFallbackDecision } from '../src/concurrency/fallbackPolicy.js';
import { loadConfig } from '../src/config.js';

function makeQueue(items) {
  let idx = 0;
  return {
    hasNext() { return idx < items.length; },
    next() { return items[idx++]; }
  };
}

function makeSource(url, host) {
  return { url, host: host || new URL(url).hostname, tier: 1 };
}

describe('FetchScheduler integration — feature flag', () => {
  it('feature flag false uses sequential behavior (default config)', () => {
    const config = loadConfig({});
    assert.equal(config.fetchSchedulerEnabled, false);
  });

  it('feature flag true enables scheduler', () => {
    const saved = process.env.FETCH_SCHEDULER_ENABLED;
    try {
      process.env.FETCH_SCHEDULER_ENABLED = 'true';
      const config = loadConfig({});
      assert.equal(config.fetchSchedulerEnabled, true);
    } finally {
      if (saved === undefined) delete process.env.FETCH_SCHEDULER_ENABLED;
      else process.env.FETCH_SCHEDULER_ENABLED = saved;
    }
  });

  it('sequential mode produces identical results to expected behavior', async () => {
    const processed = [];
    const sources = makeQueue([
      makeSource('https://a.com/1', 'a.com'),
      makeSource('https://b.com/1', 'b.com'),
      makeSource('https://c.com/1', 'c.com')
    ]);

    const scheduler = createFetchScheduler({ concurrency: 1, perHostDelayMs: 0 });
    const result = await scheduler.drainQueue({
      sources,
      fetchFn: async (source) => {
        processed.push(source.url);
        return { status: 200 };
      },
      onFetchResult: () => {},
      onFetchError: () => {}
    });

    assert.deepEqual(processed, [
      'https://a.com/1',
      'https://b.com/1',
      'https://c.com/1'
    ]);
    assert.equal(result.processed, 3);
  });

  it('concurrent mode processes all sources', async () => {
    const processed = [];
    const sources = makeQueue([
      makeSource('https://a.com/1', 'a.com'),
      makeSource('https://b.com/1', 'b.com'),
      makeSource('https://c.com/1', 'c.com')
    ]);

    const scheduler = createFetchScheduler({ concurrency: 3, perHostDelayMs: 0 });
    const result = await scheduler.drainQueue({
      sources,
      fetchFn: async (source) => {
        processed.push(source.url);
        await new Promise((r) => setTimeout(r, 5));
        return { status: 200 };
      },
      onFetchResult: () => {},
      onFetchError: () => {}
    });

    assert.equal(processed.length, 3);
    assert.equal(result.processed, 3);
  });

  it('concurrent mode respects per-host delay', async () => {
    const timestamps = [];
    let now = 1000;
    const sources = makeQueue([
      makeSource('https://a.com/1', 'a.com'),
      makeSource('https://a.com/2', 'a.com'),
      makeSource('https://b.com/1', 'b.com')
    ]);

    const scheduler = createFetchScheduler({
      concurrency: 3,
      perHostDelayMs: 200,
      nowFn: () => now,
      sleepFn: async (ms) => { now += ms; }
    });

    await scheduler.drainQueue({
      sources,
      fetchFn: async (source) => {
        timestamps.push({ url: source.url, host: source.host, at: now });
        return { status: 200 };
      },
      onFetchResult: () => {},
      onFetchError: () => {}
    });

    const aTimestamps = timestamps.filter((t) => t.host === 'a.com').map((t) => t.at);
    assert.ok(aTimestamps.length === 2);
    assert.ok(aTimestamps[1] - aTimestamps[0] >= 200,
      `Expected >= 200ms gap for same host, got ${aTimestamps[1] - aTimestamps[0]}ms`);
  });

  it('fallback retries failed fetch with alternate mode', async () => {
    const modesUsed = [];
    const sources = makeQueue([makeSource('https://blocked.com/1', 'blocked.com')]);

    const scheduler = createFetchScheduler({ concurrency: 1, perHostDelayMs: 0, maxRetries: 2 });
    const result = await scheduler.drainQueue({
      sources,
      fetchWithMode: async (source, mode) => {
        modesUsed.push(mode);
        if (mode === 'crawlee') throw new Error('403 Forbidden');
        return { status: 200 };
      },
      classifyOutcome: () => 'blocked',
      onFetchResult: () => {},
      onFetchError: () => {},
      initialMode: 'crawlee'
    });

    assert.equal(modesUsed[0], 'crawlee');
    assert.equal(modesUsed[1], 'playwright');
    assert.equal(result.processed, 1);
  });

  it('scheduler events are logged', async () => {
    const events = [];
    const sources = makeQueue([
      makeSource('https://a.com/1', 'a.com'),
      makeSource('https://b.com/1', 'b.com')
    ]);

    const scheduler = createFetchScheduler({ concurrency: 1, perHostDelayMs: 0 });
    await scheduler.drainQueue({
      sources,
      fetchFn: async () => ({ status: 200 }),
      onFetchResult: () => {},
      onFetchError: () => {},
      emitEvent: (name, payload) => events.push(name)
    });

    assert.ok(events.includes('scheduler_tick'));
    assert.ok(events.includes('scheduler_drain_completed'));
  });
});

describe('FetchScheduler integration — E2E simulations', () => {
  it('full pipeline simulation: 10 sources, 4 hosts, concurrency=3', async () => {
    const hosts = ['host-a.com', 'host-b.com', 'host-c.com', 'host-d.com'];
    const items = [];
    for (let i = 0; i < 10; i++) {
      const h = hosts[i % hosts.length];
      items.push(makeSource(`https://${h}/page-${i}`, h));
    }

    const scheduler = createFetchScheduler({ concurrency: 3, perHostDelayMs: 0 });
    const result = await scheduler.drainQueue({
      sources: makeQueue(items),
      fetchFn: async () => {
        await new Promise((r) => setTimeout(r, 5));
        return { status: 200 };
      },
      onFetchResult: () => {},
      onFetchError: () => {}
    });

    assert.equal(result.processed, 10);
    assert.equal(result.failed, 0);
    assert.equal(result.skipped, 0);
  });

  it('mixed outcomes: ok/403/429/404 with correct fallback', async () => {
    const sources = makeQueue([
      { url: 'https://ok.com/1', host: 'ok.com', outcome: 'ok' },
      { url: 'https://blocked.com/1', host: 'blocked.com', outcome: 'blocked' },
      { url: 'https://ratelimited.com/1', host: 'ratelimited.com', outcome: 'rate_limited' },
      { url: 'https://gone.com/1', host: 'gone.com', outcome: 'not_found' }
    ]);

    let now = 1000;
    const scheduler = createFetchScheduler({
      concurrency: 1,
      perHostDelayMs: 0,
      maxRetries: 2,
      nowFn: () => now,
      sleepFn: async (ms) => { now += ms; }
    });

    const attempts = {};
    const result = await scheduler.drainQueue({
      sources,
      fetchWithMode: async (source, mode) => {
        attempts[source.url] = (attempts[source.url] || 0) + 1;
        if (source.outcome === 'ok') return { status: 200 };
        if (source.outcome === 'blocked' && mode === 'crawlee') throw new Error('403');
        if (source.outcome === 'blocked') return { status: 200 };
        if (source.outcome === 'rate_limited' && attempts[source.url] === 1) throw new Error('429');
        if (source.outcome === 'rate_limited') return { status: 200 };
        if (source.outcome === 'not_found') throw new Error('404');
        return { status: 200 };
      },
      classifyOutcome: (err) => {
        const msg = err.message;
        if (msg.includes('403')) return 'blocked';
        if (msg.includes('429')) return 'rate_limited';
        if (msg.includes('404')) return 'not_found';
        return 'fetch_error';
      },
      onFetchResult: () => {},
      onFetchError: () => {},
      initialMode: 'crawlee'
    });

    assert.equal(result.processed, 3);
    assert.equal(result.failed, 1);
  });

  it('all 6 event types emitted in mixed scenario', async () => {
    const events = new Set();
    let now = 1000;
    const sources = makeQueue([
      { url: 'https://a.com/1', host: 'a.com', outcome: 'ok' },
      { url: 'https://a.com/2', host: 'a.com', outcome: 'ok' },
      { url: 'https://blocked.com/1', host: 'blocked.com', outcome: 'blocked' },
      { url: 'https://allblocked.com/1', host: 'allblocked.com', outcome: 'always_blocked' }
    ]);

    const scheduler = createFetchScheduler({
      concurrency: 1,
      perHostDelayMs: 100,
      maxRetries: 3,
      nowFn: () => now,
      sleepFn: async (ms) => { now += ms; }
    });

    let callsByUrl = {};
    await scheduler.drainQueue({
      sources,
      fetchWithMode: async (source, mode) => {
        callsByUrl[source.url] = (callsByUrl[source.url] || 0) + 1;
        if (source.outcome === 'ok') return { status: 200 };
        if (source.outcome === 'blocked' && mode === 'crawlee') throw new Error('403');
        if (source.outcome === 'blocked') return { status: 200 };
        if (source.outcome === 'always_blocked') throw new Error('403');
        return { status: 200 };
      },
      classifyOutcome: () => 'blocked',
      onFetchResult: () => {},
      onFetchError: () => {},
      emitEvent: (name) => events.add(name),
      initialMode: 'crawlee'
    });

    assert.ok(events.has('scheduler_tick'), 'should emit scheduler_tick');
    assert.ok(events.has('scheduler_fallback_started'), 'should emit scheduler_fallback_started');
    assert.ok(events.has('scheduler_fallback_succeeded'), 'should emit scheduler_fallback_succeeded');
    assert.ok(events.has('scheduler_fallback_exhausted'), 'should emit scheduler_fallback_exhausted');
    assert.ok(events.has('scheduler_host_wait'), 'should emit scheduler_host_wait');
    assert.ok(events.has('scheduler_drain_completed'), 'should emit scheduler_drain_completed');
  });
});
