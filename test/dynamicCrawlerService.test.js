import test from 'node:test';
import assert from 'node:assert/strict';
import { DynamicCrawlerService } from '../src/fetcher/dynamicCrawlerService.js';

function basePageData(url = 'https://example.com/specs') {
  return {
    url,
    finalUrl: url,
    status: 200,
    title: 'Example',
    html: '<html><body>ok</body></html>',
    ldjsonBlocks: [],
    embeddedState: {},
    networkResponses: []
  };
}

function loggerStub() {
  return {
    info() {},
    warn() {},
    error() {}
  };
}

test('DynamicCrawlerService falls back to http when crawlee start fails', async () => {
  const service = new DynamicCrawlerService(
    { dynamicCrawleeEnabled: true },
    loggerStub(),
    {
      fetcherFactories: {
        crawlee: () => ({
          async start() {
            throw new Error('crawlee_start_failed');
          },
          async stop() {},
          async fetch() {
            return basePageData();
          }
        }),
        http: () => ({
          async start() {},
          async stop() {},
          async fetch() {
            return basePageData();
          }
        })
      }
    }
  );

  await service.start();
  assert.equal(service.getMode(), 'http');
  assert.equal(service.getStartFallbackReason().includes('crawlee_start_failed'), true);
});

test('DynamicCrawlerService degrades from crawlee to playwright on no_result', async () => {
  let crawleeFetchCalls = 0;
  let playwrightFetchCalls = 0;

  const service = new DynamicCrawlerService(
    { dynamicCrawleeEnabled: true },
    loggerStub(),
    {
      fetcherFactories: {
        crawlee: () => ({
          async start() {},
          async stop() {},
          async fetch() {
            crawleeFetchCalls += 1;
            throw new Error('Crawlee fetch failed: no_result');
          }
        }),
        playwright: () => ({
          async start() {},
          async stop() {},
          async fetch() {
            playwrightFetchCalls += 1;
            return basePageData('https://example.com/fallback');
          }
        }),
        http: () => ({
          async start() {},
          async stop() {},
          async fetch() {
            return basePageData('https://example.com/http');
          }
        })
      }
    }
  );

  await service.start();
  const page = await service.fetch({ url: 'https://example.com/specs', host: 'example.com' });

  assert.equal(crawleeFetchCalls, 1);
  assert.equal(playwrightFetchCalls, 1);
  assert.equal(service.getMode(), 'playwright');
  assert.equal(page.fetchTelemetry.fetcher_kind, 'playwright');
  assert.equal(page.fetchTelemetry.degraded_from_mode, 'crawlee');
});

test('DynamicCrawlerService degrades to http when crawlee and playwright fail', async () => {
  let httpFetchCalls = 0;

  const service = new DynamicCrawlerService(
    { dynamicCrawleeEnabled: true },
    loggerStub(),
    {
      fetcherFactories: {
        crawlee: () => ({
          async start() {},
          async stop() {},
          async fetch() {
            throw new Error('Crawlee fetch failed: no_result');
          }
        }),
        playwright: () => ({
          async start() {},
          async stop() {},
          async fetch() {
            throw new Error('playwright_navigation_timeout');
          }
        }),
        http: () => ({
          async start() {},
          async stop() {},
          async fetch() {
            httpFetchCalls += 1;
            return basePageData('https://example.com/http-fallback');
          }
        })
      }
    }
  );

  await service.start();
  const page = await service.fetch({ url: 'https://example.com/specs', host: 'example.com' });

  assert.equal(httpFetchCalls, 1);
  assert.equal(service.getMode(), 'http');
  assert.equal(page.fetchTelemetry.fetcher_kind, 'http');
  assert.equal(page.fetchTelemetry.degraded_from_mode, 'crawlee');
});
