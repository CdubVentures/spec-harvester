import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStorage } from '../src/s3/storage.js';
import { discoverCandidateSources } from '../src/discovery/searchDiscovery.js';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeConfig(tempRoot, overrides = {}) {
  return {
    localMode: true,
    localInputRoot: path.join(tempRoot, 'fixtures'),
    localOutputRoot: path.join(tempRoot, 'out'),
    s3InputPrefix: 'specs/inputs',
    s3OutputPrefix: 'specs/outputs',
    discoveryEnabled: true,
    discoveryMaxQueries: 4,
    discoveryResultsPerQuery: 5,
    discoveryMaxDiscovered: 20,
    discoveryQueryConcurrency: 4,
    searchProvider: 'searxng',
    searxngBaseUrl: 'http://127.0.0.1:8080',
    llmEnabled: false,
    llmPlanDiscoveryQueries: false,
    ...overrides
  };
}

function makeJob(overrides = {}) {
  return {
    productId: 'mouse-hyperx-pulsefire-haste-2-core-wireless',
    category: 'mouse',
    identityLock: {
      brand: 'HyperX',
      model: 'Pulsefire Haste 2 Core Wireless',
      variant: ''
    },
    ...overrides
  };
}

test('discoverCandidateSources runs internet query fanout with concurrency > 1', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-discovery-concurrency-'));
  const config = makeConfig(tempRoot, {
    discoveryMaxQueries: 4,
    discoveryQueryConcurrency: 4
  });
  const storage = createStorage(config);
  const categoryConfig = {
    category: 'mouse',
    sourceHosts: [
      { host: 'rtings.com', tier: 2, tierName: 'review', role: 'review' }
    ],
    denylist: [],
    searchTemplates: [
      '{brand} {model} specs',
      '{brand} {model} manual',
      '{brand} {model} review',
      '{brand} {model} support'
    ],
    fieldOrder: []
  };
  const job = makeJob();

  const originalFetch = global.fetch;
  let inFlight = 0;
  let maxInFlight = 0;
  global.fetch = async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await delay(120);
    inFlight -= 1;
    return {
      ok: true,
      async json() {
        return {
          results: [
            {
              url: 'https://www.rtings.com/mouse/reviews/hyperx/pulsefire-haste-2-core-wireless',
              title: 'HyperX Pulsefire Haste 2 Core Wireless',
              content: 'Specs and measurements'
            }
          ]
        };
      }
    };
  };

  try {
    await discoverCandidateSources({
      config,
      storage,
      categoryConfig,
      job,
      runId: 'run-query-concurrency',
      logger: null,
      planningHints: {},
      llmContext: {}
    });

    assert.equal(maxInFlight > 1, true);
  } finally {
    global.fetch = originalFetch;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('discoverCandidateSources returns provider diagnostics for dual mode fallback readiness', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-provider-diag-'));
  const config = makeConfig(tempRoot, {
    searchProvider: 'dual',
    bingSearchEndpoint: '',
    bingSearchKey: '',
    googleCseKey: '',
    googleCseCx: '',
    searxngBaseUrl: 'http://127.0.0.1:8080',
    duckduckgoEnabled: true
  });
  const storage = createStorage(config);
  const categoryConfig = {
    category: 'mouse',
    sourceHosts: [
      { host: 'rtings.com', tier: 2, tierName: 'review', role: 'review' }
    ],
    denylist: [],
    searchTemplates: ['{brand} {model} specs'],
    fieldOrder: []
  };
  const job = makeJob();

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return {
        results: [
          {
            url: 'https://www.rtings.com/mouse/reviews/hyperx/pulsefire-haste-2-core-wireless',
            title: 'HyperX Pulsefire Haste 2 Core Wireless',
            content: 'Specs and measurements'
          }
        ]
      };
    }
  });

  try {
    const result = await discoverCandidateSources({
      config,
      storage,
      categoryConfig,
      job,
      runId: 'run-provider-diag',
      logger: null,
      planningHints: {},
      llmContext: {}
    });

    assert.deepEqual(
      [...(result.provider_state?.google_missing_credentials || [])].sort(),
      ['GOOGLE_CSE_CX', 'GOOGLE_CSE_KEY']
    );
    assert.equal((result.provider_state?.active_providers || []).includes('searxng'), true);
    assert.equal((result.provider_state?.active_providers || []).includes('duckduckgo'), true);
  } finally {
    global.fetch = originalFetch;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('discoverCandidateSources filters low-signal review URLs (rss/opensearch/search pages)', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-relevance-filter-'));
  const config = makeConfig(tempRoot, {
    searchProvider: 'searxng'
  });
  const storage = createStorage(config);
  const categoryConfig = {
    category: 'mouse',
    sourceHosts: [
      { host: 'rtings.com', tier: 2, tierName: 'review', role: 'review' }
    ],
    denylist: [],
    searchTemplates: ['{brand} {model} specs'],
    fieldOrder: []
  };
  const job = makeJob();

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return {
        results: [
          {
            url: 'https://www.rtings.com/opensearch.xml',
            title: 'Open Search',
            content: 'opensearch'
          },
          {
            url: 'https://www.rtings.com/latest-rss.xml',
            title: 'Latest RSS',
            content: 'rss feed'
          },
          {
            url: 'https://www.rtings.com/search?q=HyperX%20Pulsefire%20Haste%202%20Core%20Wireless',
            title: 'Search',
            content: 'search results'
          },
          {
            url: 'https://www.rtings.com/mouse/reviews/hyperx/pulsefire-haste-2-core-wireless',
            title: 'HyperX Pulsefire Haste 2 Core Wireless Review',
            content: 'Full review with measurements'
          }
        ]
      };
    }
  });

  try {
    const result = await discoverCandidateSources({
      config,
      storage,
      categoryConfig,
      job,
      runId: 'run-relevance-filter',
      logger: null,
      planningHints: {},
      llmContext: {}
    });

    const urls = [...new Set([...(result.approvedUrls || []), ...(result.candidateUrls || [])])];
    assert.equal(
      urls.includes('https://www.rtings.com/mouse/reviews/hyperx/pulsefire-haste-2-core-wireless'),
      true
    );
    assert.equal(urls.some((url) => url.includes('/opensearch.xml')), false);
    assert.equal(urls.some((url) => url.includes('/latest-rss.xml')), false);
    assert.equal(urls.some((url) => url.includes('/search?q=')), false);
  } finally {
    global.fetch = originalFetch;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
