import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createFetchScheduler } from '../src/concurrency/fetchScheduler.js';

function makeQueue(items) {
  let idx = 0;
  return {
    hasNext() { return idx < items.length; },
    next() { return items[idx++]; }
  };
}

function makeSource(url, host) {
  return { url, host: host || new URL(url).hostname };
}

describe('FetchScheduler — core scheduling', () => {
  it('processes sources concurrently up to pool limit', async () => {
    const inFlight = [];
    let maxInFlight = 0;
    const sources = makeQueue([
      makeSource('https://a.com/1', 'a.com'),
      makeSource('https://b.com/1', 'b.com'),
      makeSource('https://c.com/1', 'c.com'),
      makeSource('https://d.com/1', 'd.com')
    ]);

    const scheduler = createFetchScheduler({ concurrency: 2, perHostDelayMs: 0 });
    const result = await scheduler.drainQueue({
      sources,
      fetchFn: async (source) => {
        inFlight.push(source.url);
        maxInFlight = Math.max(maxInFlight, inFlight.length);
        await new Promise((r) => setTimeout(r, 20));
        inFlight.splice(inFlight.indexOf(source.url), 1);
        return { status: 200 };
      },
      onFetchResult: () => {},
      onFetchError: () => {}
    });

    assert.equal(result.processed, 4);
    assert.ok(maxInFlight <= 2, `max in-flight was ${maxInFlight}, expected <= 2`);
  });

  it('processes sequentially when concurrency=1', async () => {
    const order = [];
    const sources = makeQueue([
      makeSource('https://a.com/1', 'a.com'),
      makeSource('https://b.com/1', 'b.com')
    ]);

    const scheduler = createFetchScheduler({ concurrency: 1, perHostDelayMs: 0 });
    await scheduler.drainQueue({
      sources,
      fetchFn: async (source) => {
        order.push(`start:${source.url}`);
        await new Promise((r) => setTimeout(r, 10));
        order.push(`end:${source.url}`);
        return { status: 200 };
      },
      onFetchResult: () => {},
      onFetchError: () => {}
    });

    assert.equal(order[0], 'start:https://a.com/1');
    assert.equal(order[1], 'end:https://a.com/1');
    assert.equal(order[2], 'start:https://b.com/1');
    assert.equal(order[3], 'end:https://b.com/1');
  });

  it('respects per-host delay between same-host sources', async () => {
    const timestamps = [];
    let now = 1000;
    const sources = makeQueue([
      makeSource('https://a.com/1', 'a.com'),
      makeSource('https://a.com/2', 'a.com')
    ]);

    const scheduler = createFetchScheduler({
      concurrency: 2,
      perHostDelayMs: 200,
      nowFn: () => now,
      sleepFn: async (ms) => { now += ms; }
    });

    await scheduler.drainQueue({
      sources,
      fetchFn: async (source) => {
        timestamps.push({ url: source.url, at: now });
        return { status: 200 };
      },
      onFetchResult: () => {},
      onFetchError: () => {}
    });

    assert.equal(timestamps.length, 2);
    assert.ok(timestamps[1].at - timestamps[0].at >= 200,
      `Expected >= 200ms gap, got ${timestamps[1].at - timestamps[0].at}ms`);
  });

  it('different hosts run without delay', async () => {
    let concurrentCount = 0;
    let maxConcurrent = 0;
    const sources = makeQueue([
      makeSource('https://a.com/1', 'a.com'),
      makeSource('https://b.com/1', 'b.com')
    ]);

    const scheduler = createFetchScheduler({ concurrency: 2, perHostDelayMs: 500 });
    await scheduler.drainQueue({
      sources,
      fetchFn: async () => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        await new Promise((r) => setTimeout(r, 20));
        concurrentCount--;
        return { status: 200 };
      },
      onFetchResult: () => {},
      onFetchError: () => {}
    });

    assert.equal(maxConcurrent, 2);
  });

  it('skips sources that fail shouldSkip predicate', async () => {
    const processed = [];
    const skipped = [];
    const sources = makeQueue([
      makeSource('https://a.com/1', 'a.com'),
      makeSource('https://skip.com/1', 'skip.com'),
      makeSource('https://b.com/1', 'b.com')
    ]);

    const scheduler = createFetchScheduler({ concurrency: 1, perHostDelayMs: 0 });
    const result = await scheduler.drainQueue({
      sources,
      fetchFn: async (source) => {
        processed.push(source.url);
        return { status: 200 };
      },
      shouldSkip: (source) => source.host === 'skip.com',
      onFetchResult: () => {},
      onFetchError: () => {},
      onSkipped: (source, reason) => skipped.push(source.url)
    });

    assert.deepEqual(processed, ['https://a.com/1', 'https://b.com/1']);
    assert.deepEqual(skipped, ['https://skip.com/1']);
    assert.equal(result.skipped, 1);
    assert.equal(result.processed, 2);
  });

  it('stops processing when shouldStop returns true', async () => {
    let fetchCount = 0;
    const sources = makeQueue([
      makeSource('https://a.com/1', 'a.com'),
      makeSource('https://b.com/1', 'b.com'),
      makeSource('https://c.com/1', 'c.com')
    ]);

    const scheduler = createFetchScheduler({ concurrency: 1, perHostDelayMs: 0 });
    const result = await scheduler.drainQueue({
      sources,
      fetchFn: async () => {
        fetchCount++;
        return { status: 200 };
      },
      shouldStop: () => fetchCount >= 2,
      onFetchResult: () => {},
      onFetchError: () => {}
    });

    assert.equal(fetchCount, 2);
    assert.equal(result.processed, 2);
  });

  it('calls onFetchResult for each completed fetch', async () => {
    const results = [];
    const sources = makeQueue([
      makeSource('https://a.com/1', 'a.com'),
      makeSource('https://b.com/1', 'b.com')
    ]);

    const scheduler = createFetchScheduler({ concurrency: 1, perHostDelayMs: 0 });
    await scheduler.drainQueue({
      sources,
      fetchFn: async (source) => ({ status: 200, url: source.url }),
      onFetchResult: (source, result) => results.push({ url: source.url, status: result.status }),
      onFetchError: () => {}
    });

    assert.equal(results.length, 2);
    assert.equal(results[0].status, 200);
    assert.equal(results[1].status, 200);
  });

  it('calls onFetchError for failed fetches', async () => {
    const errors = [];
    const sources = makeQueue([
      makeSource('https://fail.com/1', 'fail.com')
    ]);

    const scheduler = createFetchScheduler({ concurrency: 1, perHostDelayMs: 0 });
    const result = await scheduler.drainQueue({
      sources,
      fetchFn: async () => { throw new Error('network down'); },
      onFetchResult: () => {},
      onFetchError: (source, error) => errors.push({ url: source.url, msg: error.message })
    });

    assert.equal(errors.length, 1);
    assert.equal(errors[0].msg, 'network down');
    assert.equal(result.failed, 1);
  });

  it('returns summary with counts', async () => {
    const sources = makeQueue([
      makeSource('https://a.com/1', 'a.com'),
      makeSource('https://b.com/1', 'b.com'),
      makeSource('https://skip.com/1', 'skip.com')
    ]);

    const scheduler = createFetchScheduler({ concurrency: 1, perHostDelayMs: 0 });
    const result = await scheduler.drainQueue({
      sources,
      fetchFn: async () => ({ status: 200 }),
      shouldSkip: (source) => source.host === 'skip.com',
      onFetchResult: () => {},
      onFetchError: () => {},
      onSkipped: () => {}
    });

    assert.equal(result.processed, 2);
    assert.equal(result.skipped, 1);
    assert.equal(result.failed, 0);
    assert.ok(typeof result.elapsed_ms === 'number');
  });

  it('empty queue returns immediately', async () => {
    const sources = makeQueue([]);
    const scheduler = createFetchScheduler({ concurrency: 2, perHostDelayMs: 0 });
    const result = await scheduler.drainQueue({
      sources,
      fetchFn: async () => ({ status: 200 }),
      onFetchResult: () => {},
      onFetchError: () => {}
    });

    assert.equal(result.processed, 0);
    assert.equal(result.skipped, 0);
    assert.equal(result.failed, 0);
  });
});

describe('FetchScheduler — fallback integration', () => {
  it('retries with alternate mode on blocked (403) outcome', async () => {
    const modesUsed = [];
    const sources = makeQueue([makeSource('https://blocked.com/1', 'blocked.com')]);

    const scheduler = createFetchScheduler({
      concurrency: 1,
      perHostDelayMs: 0,
      maxRetries: 2
    });

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
    assert.equal(result.fallback_attempts, 1);
  });

  it('does NOT retry on skip outcomes (404, bad_content)', async () => {
    let fetchCallCount = 0;
    const sources = makeQueue([makeSource('https://gone.com/1', 'gone.com')]);

    const scheduler = createFetchScheduler({ concurrency: 1, perHostDelayMs: 0, maxRetries: 2 });
    const result = await scheduler.drainQueue({
      sources,
      fetchWithMode: async () => {
        fetchCallCount++;
        throw new Error('404 Not Found');
      },
      classifyOutcome: () => 'not_found',
      onFetchResult: () => {},
      onFetchError: () => {},
      initialMode: 'crawlee'
    });

    assert.equal(fetchCallCount, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.fallback_attempts, 0);
  });

  it('waits before retrying on rate_limited (429) outcome', async () => {
    const modesUsed = [];
    const sleeps = [];
    let now = 1000;
    const sources = makeQueue([makeSource('https://rl.com/1', 'rl.com')]);

    const scheduler = createFetchScheduler({
      concurrency: 1,
      perHostDelayMs: 0,
      maxRetries: 2,
      nowFn: () => now,
      sleepFn: async (ms) => { sleeps.push(ms); now += ms; }
    });

    let callCount = 0;
    const result = await scheduler.drainQueue({
      sources,
      fetchWithMode: async (source, mode) => {
        modesUsed.push(mode);
        callCount++;
        if (callCount === 1) throw new Error('429 Too Many Requests');
        return { status: 200 };
      },
      classifyOutcome: () => 'rate_limited',
      onFetchResult: () => {},
      onFetchError: () => {},
      initialMode: 'crawlee'
    });

    assert.equal(modesUsed[0], 'crawlee');
    assert.equal(modesUsed[1], 'crawlee');
    assert.ok(sleeps.length >= 1, 'should have waited');
    assert.equal(result.processed, 1);
  });

  it('exhausted fallback modes marks source as failed', async () => {
    const exhaustedCalls = [];
    const sources = makeQueue([makeSource('https://fail.com/1', 'fail.com')]);

    const scheduler = createFetchScheduler({
      concurrency: 1,
      perHostDelayMs: 0,
      maxRetries: 3
    });

    const result = await scheduler.drainQueue({
      sources,
      fetchWithMode: async () => { throw new Error('blocked'); },
      classifyOutcome: () => 'blocked',
      onFetchResult: () => {},
      onFetchError: () => {},
      onFallbackExhausted: (source, info) => exhaustedCalls.push(info),
      initialMode: 'crawlee'
    });

    assert.equal(result.failed, 1);
    assert.equal(exhaustedCalls.length, 1);
    assert.ok(exhaustedCalls[0].modes_tried.length >= 2);
  });

  it('emits onFallbackAttempt callback per retry', async () => {
    const attempts = [];
    const sources = makeQueue([makeSource('https://retry.com/1', 'retry.com')]);

    const scheduler = createFetchScheduler({
      concurrency: 1,
      perHostDelayMs: 0,
      maxRetries: 2
    });

    let callCount = 0;
    await scheduler.drainQueue({
      sources,
      fetchWithMode: async (source, mode) => {
        callCount++;
        if (callCount <= 2) throw new Error('blocked');
        return { status: 200 };
      },
      classifyOutcome: () => 'blocked',
      onFetchResult: () => {},
      onFetchError: () => {},
      onFallbackAttempt: (source, info) => attempts.push(info),
      initialMode: 'crawlee'
    });

    assert.ok(attempts.length >= 1);
    assert.equal(attempts[0].fromMode, 'crawlee');
    assert.equal(attempts[0].toMode, 'playwright');
    assert.equal(attempts[0].attempt, 1);
  });

  it('respects maxRetries limit', async () => {
    let fetchCallCount = 0;
    const sources = makeQueue([makeSource('https://max.com/1', 'max.com')]);

    const scheduler = createFetchScheduler({
      concurrency: 1,
      perHostDelayMs: 0,
      maxRetries: 1
    });

    const result = await scheduler.drainQueue({
      sources,
      fetchWithMode: async () => {
        fetchCallCount++;
        throw new Error('blocked');
      },
      classifyOutcome: () => 'blocked',
      onFetchResult: () => {},
      onFetchError: () => {},
      initialMode: 'crawlee'
    });

    assert.equal(fetchCallCount, 2);
    assert.equal(result.failed, 1);
  });

  it('fallback success uses result from successful mode', async () => {
    const results = [];
    const sources = makeQueue([makeSource('https://mixed.com/1', 'mixed.com')]);

    const scheduler = createFetchScheduler({
      concurrency: 1,
      perHostDelayMs: 0,
      maxRetries: 2
    });

    await scheduler.drainQueue({
      sources,
      fetchWithMode: async (source, mode) => {
        if (mode === 'crawlee') throw new Error('blocked');
        return { status: 200, mode };
      },
      classifyOutcome: () => 'blocked',
      onFetchResult: (source, result) => results.push(result),
      onFetchError: () => {},
      initialMode: 'crawlee'
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].mode, 'playwright');
    assert.equal(results[0].status, 200);
  });

  it('summary includes fallback_attempts count', async () => {
    const sources = makeQueue([makeSource('https://fb.com/1', 'fb.com')]);

    const scheduler = createFetchScheduler({
      concurrency: 1,
      perHostDelayMs: 0,
      maxRetries: 2
    });

    let callCount = 0;
    const result = await scheduler.drainQueue({
      sources,
      fetchWithMode: async (source, mode) => {
        callCount++;
        if (callCount === 1) throw new Error('blocked');
        return { status: 200 };
      },
      classifyOutcome: () => 'blocked',
      onFetchResult: () => {},
      onFetchError: () => {},
      initialMode: 'crawlee'
    });

    assert.ok(result.fallback_attempts >= 1);
    assert.equal(result.processed, 1);
  });
});

describe('FetchScheduler — event emission', () => {
  it('emits scheduler_tick with pool stats on each completion', async () => {
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
      emitEvent: (name, payload) => events.push({ name, payload })
    });

    const ticks = events.filter((e) => e.name === 'scheduler_tick');
    assert.equal(ticks.length, 2);
    assert.ok('active' in ticks[0].payload);
    assert.ok('host_count' in ticks[0].payload);
  });

  it('emits scheduler_fallback_started when fallback attempted', async () => {
    const events = [];
    const sources = makeQueue([makeSource('https://fb.com/1', 'fb.com')]);
    let callCount = 0;

    const scheduler = createFetchScheduler({ concurrency: 1, perHostDelayMs: 0, maxRetries: 2 });
    await scheduler.drainQueue({
      sources,
      fetchWithMode: async (source, mode) => {
        callCount++;
        if (callCount === 1) throw new Error('blocked');
        return { status: 200 };
      },
      classifyOutcome: () => 'blocked',
      onFetchResult: () => {},
      onFetchError: () => {},
      emitEvent: (name, payload) => events.push({ name, payload }),
      initialMode: 'crawlee'
    });

    const started = events.filter((e) => e.name === 'scheduler_fallback_started');
    assert.equal(started.length, 1);
    assert.equal(started[0].payload.from_mode, 'crawlee');
    assert.equal(started[0].payload.to_mode, 'playwright');
    assert.equal(started[0].payload.outcome, 'blocked');
  });

  it('emits scheduler_fallback_exhausted when all modes fail', async () => {
    const events = [];
    const sources = makeQueue([makeSource('https://exh.com/1', 'exh.com')]);

    const scheduler = createFetchScheduler({ concurrency: 1, perHostDelayMs: 0, maxRetries: 3 });
    await scheduler.drainQueue({
      sources,
      fetchWithMode: async () => { throw new Error('blocked'); },
      classifyOutcome: () => 'blocked',
      onFetchResult: () => {},
      onFetchError: () => {},
      emitEvent: (name, payload) => events.push({ name, payload }),
      initialMode: 'crawlee'
    });

    const exhausted = events.filter((e) => e.name === 'scheduler_fallback_exhausted');
    assert.equal(exhausted.length, 1);
    assert.ok(exhausted[0].payload.modes_tried.length >= 2);
    assert.equal(exhausted[0].payload.final_outcome, 'blocked');
  });

  it('emits scheduler_host_wait when pacer enforces delay', async () => {
    const events = [];
    let now = 1000;
    const sources = makeQueue([
      makeSource('https://a.com/1', 'a.com'),
      makeSource('https://a.com/2', 'a.com')
    ]);

    const scheduler = createFetchScheduler({
      concurrency: 2,
      perHostDelayMs: 200,
      nowFn: () => now,
      sleepFn: async (ms) => { now += ms; }
    });

    await scheduler.drainQueue({
      sources,
      fetchFn: async () => ({ status: 200 }),
      onFetchResult: () => {},
      onFetchError: () => {},
      emitEvent: (name, payload) => events.push({ name, payload })
    });

    const waits = events.filter((e) => e.name === 'scheduler_host_wait');
    assert.ok(waits.length >= 1);
    assert.equal(waits[0].payload.host, 'a.com');
    assert.ok(waits[0].payload.wait_ms > 0);
  });

  it('emits scheduler_drain_completed at drain end', async () => {
    const events = [];
    const sources = makeQueue([makeSource('https://a.com/1', 'a.com')]);

    const scheduler = createFetchScheduler({ concurrency: 1, perHostDelayMs: 0 });
    await scheduler.drainQueue({
      sources,
      fetchFn: async () => ({ status: 200 }),
      onFetchResult: () => {},
      onFetchError: () => {},
      emitEvent: (name, payload) => events.push({ name, payload })
    });

    const drain = events.filter((e) => e.name === 'scheduler_drain_completed');
    assert.equal(drain.length, 1);
    assert.equal(drain[0].payload.processed, 1);
    assert.ok(typeof drain[0].payload.elapsed_ms === 'number');
  });

  it('emits scheduler_fallback_succeeded when fallback works', async () => {
    const events = [];
    const sources = makeQueue([makeSource('https://ok.com/1', 'ok.com')]);
    let callCount = 0;

    const scheduler = createFetchScheduler({ concurrency: 1, perHostDelayMs: 0, maxRetries: 2 });
    await scheduler.drainQueue({
      sources,
      fetchWithMode: async (source, mode) => {
        callCount++;
        if (callCount === 1) throw new Error('blocked');
        return { status: 200 };
      },
      classifyOutcome: () => 'blocked',
      onFetchResult: () => {},
      onFetchError: () => {},
      emitEvent: (name, payload) => events.push({ name, payload }),
      initialMode: 'crawlee'
    });

    const succeeded = events.filter((e) => e.name === 'scheduler_fallback_succeeded');
    assert.equal(succeeded.length, 1);
    assert.equal(succeeded[0].payload.mode, 'playwright');
    assert.equal(succeeded[0].payload.from_mode, 'crawlee');
  });
});
