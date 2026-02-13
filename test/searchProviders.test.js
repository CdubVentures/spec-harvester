import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runSearchProviders,
  searchProviderAvailability
} from '../src/search/searchProviders.js';

function makeJsonResponse(payload, ok = true) {
  return {
    ok,
    async json() {
      return payload;
    }
  };
}

function makeTextResponse(payload, ok = true) {
  return {
    ok,
    async text() {
      return payload;
    }
  };
}

test('searchProviderAvailability includes searxng readiness', () => {
  const available = searchProviderAvailability({
    searchProvider: 'searxng',
    searxngBaseUrl: 'http://127.0.0.1:8080'
  });
  assert.equal(available.provider, 'searxng');
  assert.equal(available.searxng_ready, true);
  assert.equal(available.internet_ready, true);
});

test('runSearchProviders returns searxng results for searxng provider', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async (url) => {
    calls += 1;
    const token = String(url);
    assert.equal(token.includes('format=json'), true);
    assert.equal(token.includes('q=logitech'), true);
    return makeJsonResponse({
      results: [
        {
          url: 'https://example.com/spec',
          title: 'Spec Page',
          content: 'Polling rate 8000 Hz'
        }
      ]
    });
  };

  try {
    const rows = await runSearchProviders({
      config: {
        searchProvider: 'searxng',
        searxngBaseUrl: 'http://127.0.0.1:8080',
        searxngTimeoutMs: 5_000,
        searchCacheTtlSeconds: 0
      },
      query: 'logitech',
      limit: 5
    });

    assert.equal(calls, 1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].provider, 'searxng');
    assert.equal(rows[0].url, 'https://example.com/spec');
  } finally {
    global.fetch = originalFetch;
  }
});

test('searchProviderAvailability includes duckduckgo readiness', () => {
  const available = searchProviderAvailability({
    searchProvider: 'duckduckgo',
    duckduckgoEnabled: true
  });
  assert.equal(available.provider, 'duckduckgo');
  assert.equal(available.duckduckgo_ready, true);
  assert.equal(available.internet_ready, true);
});

test('runSearchProviders returns parsed duckduckgo results for duckduckgo provider', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async (url) => {
    calls += 1;
    const token = String(url);
    assert.equal(token.includes('q=viper+v3+pro') || token.includes('q=viper%20v3%20pro'), true);
    return makeTextResponse(
      [
        '<html><body>',
        '<a class="result__a" href="https://example.com/spec-page">Razer Viper V3 Pro Specs</a>',
        '<a class="result__snippet" href="https://example.com/spec-page">Weight 54 g, Polling 8000 Hz</a>',
        '</body></html>'
      ].join('')
    );
  };

  try {
    const rows = await runSearchProviders({
      config: {
        searchProvider: 'duckduckgo',
        duckduckgoEnabled: true,
        duckduckgoTimeoutMs: 5_000
      },
      query: 'viper v3 pro',
      limit: 5
    });

    assert.equal(calls, 1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].provider, 'duckduckgo');
    assert.equal(rows[0].url, 'https://example.com/spec-page');
  } finally {
    global.fetch = originalFetch;
  }
});

test('runSearchProviders dual mode falls back to searxng when bing/google are unavailable', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return makeJsonResponse({
      results: [
        {
          url: 'https://docs.vendor.com/manual.pdf',
          title: 'Manual',
          content: 'DPI and polling details'
        }
      ]
    });
  };

  try {
    const rows = await runSearchProviders({
      config: {
        searchProvider: 'dual',
        bingSearchEndpoint: '',
        bingSearchKey: '',
        googleCseKey: '',
        googleCseCx: '',
        searxngBaseUrl: 'http://127.0.0.1:8080',
        searchCacheTtlSeconds: 0
      },
      query: 'viper v3 pro dpi',
      limit: 6
    });

    assert.equal(calls, 1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].provider, 'searxng');
  } finally {
    global.fetch = originalFetch;
  }
});

test('runSearchProviders dual mode falls back to duckduckgo when bing/google/searxng are unavailable', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return makeTextResponse(
      '<a class="result__a" href="https://vendor.example/product">Vendor Product</a>'
    );
  };

  try {
    const rows = await runSearchProviders({
      config: {
        searchProvider: 'dual',
        bingSearchEndpoint: '',
        bingSearchKey: '',
        googleCseKey: '',
        googleCseCx: '',
        searxngBaseUrl: '',
        duckduckgoEnabled: true,
        searchCacheTtlSeconds: 0
      },
      query: 'g pro x superlight 2',
      limit: 6
    });

    assert.equal(calls, 1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].provider, 'duckduckgo');
  } finally {
    global.fetch = originalFetch;
  }
});
