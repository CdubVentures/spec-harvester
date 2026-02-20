import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpFetcher } from '../src/fetcher/playwrightFetcher.js';

function mockResponse({ status = 200, body = '', headers = {}, url = '' }) {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), String(value)])
  );
  return {
    status,
    url,
    headers: {
      get(name) {
        return lower[String(name || '').toLowerCase()] || null;
      }
    },
    async text() {
      return String(body);
    }
  };
}

test('HttpFetcher retries once on transient fetch error when retry budget is configured', async () => {
  const originalFetch = global.fetch;
  let attempts = 0;

  global.fetch = async (url) => {
    attempts += 1;
    if (attempts === 1) {
      throw new Error('network timeout while connecting');
    }
    return mockResponse({
      status: 200,
      url: String(url),
      headers: { 'content-type': 'text/html' },
      body: '<html><head><title>Recovered</title></head><body>ok</body></html>'
    });
  };

  try {
    const fetcher = new HttpFetcher({
      perHostMinDelayMs: 0,
      pageGotoTimeoutMs: 1000,
      userAgent: 'SpecHarvester/1.0',
      robotsTxtCompliant: false,
      dynamicFetchRetryBudget: 1,
      dynamicFetchRetryBackoffMs: 0
    });

    const page = await fetcher.fetch({
      url: 'https://example.com/specs',
      host: 'example.com'
    });

    assert.equal(page.status, 200);
    assert.equal(page.title, 'Recovered');
    assert.equal(attempts, 2);
    assert.equal(page.fetchTelemetry.fetcher_kind, 'http');
    assert.equal(page.fetchTelemetry.retry_count, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('HttpFetcher retries once on transient 5xx status when retry budget is configured', async () => {
  const originalFetch = global.fetch;
  let attempts = 0;

  global.fetch = async (url) => {
    attempts += 1;
    if (attempts === 1) {
      return mockResponse({
        status: 503,
        url: String(url),
        headers: { 'content-type': 'text/html' },
        body: '<html><body>temporarily unavailable</body></html>'
      });
    }
    return mockResponse({
      status: 200,
      url: String(url),
      headers: { 'content-type': 'text/html' },
      body: '<html><head><title>Recovered</title></head><body>ok</body></html>'
    });
  };

  try {
    const fetcher = new HttpFetcher({
      perHostMinDelayMs: 0,
      pageGotoTimeoutMs: 1000,
      userAgent: 'SpecHarvester/1.0',
      robotsTxtCompliant: false,
      dynamicFetchRetryBudget: 1,
      dynamicFetchRetryBackoffMs: 0
    });

    const page = await fetcher.fetch({
      url: 'https://example.com/specs',
      host: 'example.com'
    });

    assert.equal(page.status, 200);
    assert.equal(page.title, 'Recovered');
    assert.equal(attempts, 2);
    assert.equal(page.fetchTelemetry.fetcher_kind, 'http');
    assert.equal(page.fetchTelemetry.retry_count, 1);
  } finally {
    global.fetch = originalFetch;
  }
});
