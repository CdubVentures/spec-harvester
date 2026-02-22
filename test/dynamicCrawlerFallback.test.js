import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DynamicCrawlerService } from '../src/fetcher/dynamicCrawlerService.js';

function makeMockFetchers(behavior = {}) {
  const calls = [];
  const factory = (mode) => ({
    started: false,
    async start() { this.started = true; },
    async stop() { this.started = false; },
    async fetch(source) {
      calls.push({ mode, url: source.url });
      const fn = behavior[mode];
      if (typeof fn === 'function') return fn(source);
      return { html: '<html></html>', status: 200 };
    }
  });
  const factories = {
    crawlee: (config, logger) => factory('crawlee'),
    playwright: (config, logger) => factory('playwright'),
    http: (config, logger) => factory('http'),
    dryrun: (config, logger) => factory('dryrun')
  };
  return { calls, factories };
}

describe('DynamicCrawlerService — enhanced fallback', () => {
  it('403 error triggers playwright→http fallback', async () => {
    const { calls, factories } = makeMockFetchers({
      crawlee: () => { throw Object.assign(new Error('403 Forbidden'), { statusCode: 403 }); },
      playwright: () => ({ html: '<html></html>', status: 200 })
    });

    const service = new DynamicCrawlerService({}, null, {
      mode: 'crawlee',
      fetcherFactories: factories
    });
    await service.start();
    const result = await service.fetch({ url: 'https://blocked.com/page' });

    assert.ok(calls.some((c) => c.mode === 'crawlee'));
    assert.ok(calls.some((c) => c.mode === 'playwright'));
    assert.ok(result.fetchTelemetry?.degraded_from_mode === 'crawlee');
  });

  it('timeout error triggers fallback', async () => {
    const { calls, factories } = makeMockFetchers({
      crawlee: () => { throw new Error('Navigation timeout of 30000 ms exceeded'); },
      playwright: () => ({ html: '<html></html>', status: 200 })
    });

    const service = new DynamicCrawlerService({}, null, {
      mode: 'crawlee',
      fetcherFactories: factories
    });
    await service.start();
    const result = await service.fetch({ url: 'https://slow.com/page' });

    assert.ok(calls.some((c) => c.mode === 'playwright'));
    assert.ok(result.fetchTelemetry?.degraded_from_mode === 'crawlee');
  });

  it('500 error triggers fallback', async () => {
    const { calls, factories } = makeMockFetchers({
      crawlee: () => { throw Object.assign(new Error('500 Internal Server Error'), { statusCode: 500 }); },
      playwright: () => ({ html: '<html></html>', status: 200 })
    });

    const service = new DynamicCrawlerService({}, null, {
      mode: 'crawlee',
      fetcherFactories: factories
    });
    await service.start();
    const result = await service.fetch({ url: 'https://error.com/page' });

    assert.ok(calls.some((c) => c.mode === 'playwright'));
  });

  it('429 does NOT switch mode (same-mode semantics preserved)', async () => {
    const { calls, factories } = makeMockFetchers({
      crawlee: () => { throw Object.assign(new Error('429 Too Many Requests'), { statusCode: 429 }); }
    });

    const service = new DynamicCrawlerService({}, null, {
      mode: 'crawlee',
      fetcherFactories: factories
    });
    await service.start();

    try {
      await service.fetch({ url: 'https://ratelimited.com/page' });
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('429'));
    }
    const playwrightCalls = calls.filter((c) => c.mode === 'playwright');
    assert.equal(playwrightCalls.length, 0, 'should not switch to playwright on 429');
  });

  it('telemetry includes fallback_from_mode', async () => {
    const { calls, factories } = makeMockFetchers({
      crawlee: () => { throw new Error('no_result'); },
      playwright: () => ({ html: '<html></html>', status: 200 })
    });

    const service = new DynamicCrawlerService({}, null, {
      mode: 'crawlee',
      fetcherFactories: factories
    });
    await service.start();
    const result = await service.fetch({ url: 'https://fallback.com/page' });

    assert.equal(result.fetchTelemetry.degraded_from_mode, 'crawlee');
    assert.ok(result.fetchTelemetry.degraded_reason);
  });

  it('exhaustion throws original error after all modes tried', async () => {
    const { calls, factories } = makeMockFetchers({
      crawlee: () => { throw new Error('network_error fetch failed'); },
      playwright: () => { throw new Error('playwright also failed'); },
      http: () => { throw new Error('http also failed'); }
    });

    const service = new DynamicCrawlerService({}, null, {
      mode: 'crawlee',
      fetcherFactories: factories
    });
    await service.start();

    try {
      await service.fetch({ url: 'https://allfail.com/page' });
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err.message.includes('network_error'));
    }

    assert.ok(calls.length >= 2, `Expected >= 2 attempts, got ${calls.length}`);
  });
});
