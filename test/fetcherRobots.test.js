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

test('HttpFetcher enforces robots.txt disallow rules', async () => {
  const originalFetch = global.fetch;
  const seen = [];

  global.fetch = async (url) => {
    const key = String(url);
    seen.push(key);
    if (key === 'https://example.com/robots.txt') {
      return mockResponse({
        status: 200,
        url: key,
        body: [
          'User-agent: *',
          'Disallow: /private'
        ].join('\n')
      });
    }
    throw new Error(`unexpected fetch for ${key}`);
  };

  try {
    const fetcher = new HttpFetcher({
      perHostMinDelayMs: 0,
      pageGotoTimeoutMs: 1000,
      userAgent: 'SpecHarvester/1.0',
      robotsTxtCompliant: true,
      robotsTxtTimeoutMs: 1000
    });

    const page = await fetcher.fetch({
      url: 'https://example.com/private/specs',
      host: 'example.com'
    });

    assert.equal(page.status, 451);
    assert.equal(page.blockedByRobots, true);
    assert.deepEqual(seen, ['https://example.com/robots.txt']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('HttpFetcher proceeds when robots allows path', async () => {
  const originalFetch = global.fetch;
  const seen = [];

  global.fetch = async (url) => {
    const key = String(url);
    seen.push(key);
    if (key === 'https://example.com/robots.txt') {
      return mockResponse({
        status: 200,
        url: key,
        body: [
          'User-agent: *',
          'Disallow: /private',
          'Allow: /private/specs'
        ].join('\n')
      });
    }
    if (key === 'https://example.com/private/specs') {
      return mockResponse({
        status: 200,
        url: key,
        headers: { 'content-type': 'text/html' },
        body: '<html><head><title>Specs</title></head><body>DPI 32000</body></html>'
      });
    }
    throw new Error(`unexpected fetch for ${key}`);
  };

  try {
    const fetcher = new HttpFetcher({
      perHostMinDelayMs: 0,
      pageGotoTimeoutMs: 1000,
      userAgent: 'SpecHarvester/1.0',
      robotsTxtCompliant: true,
      robotsTxtTimeoutMs: 1000
    });

    const page = await fetcher.fetch({
      url: 'https://example.com/private/specs',
      host: 'example.com'
    });

    assert.equal(page.status, 200);
    assert.equal(page.title, 'Specs');
    assert.equal(page.blockedByRobots, undefined);
    assert.deepEqual(seen, ['https://example.com/robots.txt', 'https://example.com/private/specs']);
  } finally {
    global.fetch = originalFetch;
  }
});
