import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStorage } from '../src/s3/storage.js';
import { persistSourceIntel } from '../src/intel/sourceIntel.js';
import { discoverCandidateSources } from '../src/discovery/searchDiscovery.js';

function baseCategoryConfig() {
  return {
    category: 'mouse',
    sourceHosts: [
      { host: 'razer.com', tier: 1, tierName: 'manufacturer', role: 'manufacturer' },
      { host: 'rtings.com', tier: 2, tierName: 'lab', role: 'lab' }
    ],
    denylist: [],
    searchTemplates: ['{brand} {model} specs'],
    fieldOrder: ['weight', 'dpi', 'polling_rate', 'connection'],
    criticalFieldSet: new Set(['weight', 'dpi'])
  };
}

function sourceResultFixture() {
  return {
    url: 'https://www.razer.com/gaming-mice/viper-v3-pro',
    finalUrl: 'https://www.razer.com/gaming-mice/viper-v3-pro',
    host: 'razer.com',
    rootDomain: 'razer.com',
    role: 'manufacturer',
    tier: 1,
    approvedDomain: true,
    identity: {
      match: true
    },
    anchorCheck: {
      majorConflicts: []
    },
    fieldCandidates: [
      { field: 'weight', value: '54', method: 'dom_table' },
      { field: 'dpi', value: '30000', method: 'network_json' },
      { field: 'polling_rate', value: '8000', method: 'dom_table' }
    ],
    endpointSignals: [],
    parserHealth: {
      candidate_count: 3,
      identity_match: true,
      major_anchor_conflicts: 0,
      health_score: 1
    },
    status: 200,
    ts: new Date().toISOString(),
    title: 'Razer Viper V3 Pro'
  };
}

function provenanceFixture() {
  return {
    weight: {
      value: '54',
      evidence: [
        {
          url: 'https://www.razer.com/gaming-mice/viper-v3-pro',
          host: 'razer.com',
          rootDomain: 'razer.com',
          method: 'dom_table'
        }
      ]
    },
    dpi: {
      value: '30000',
      evidence: [
        {
          url: 'https://www.razer.com/gaming-mice/viper-v3-pro',
          host: 'razer.com',
          rootDomain: 'razer.com',
          method: 'network_json'
        }
      ]
    }
  };
}

function jobFixture() {
  return {
    productId: 'mouse-razer-viper-v3-pro',
    category: 'mouse',
    identityLock: {
      brand: 'Razer',
      model: 'Viper V3 Pro',
      variant: ''
    }
  };
}

test('discoverCandidateSources uses internal source corpus when external providers are unavailable', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-internal-corpus-'));
  const localInputRoot = path.join(tempRoot, 'fixtures');
  const localOutputRoot = path.join(tempRoot, 'out');
  const config = {
    localMode: true,
    localInputRoot,
    localOutputRoot,
    s3InputPrefix: 'specs/inputs',
    s3OutputPrefix: 'specs/outputs',
    discoveryEnabled: true,
    discoveryInternalFirst: true,
    discoveryInternalMinResults: 1,
    discoveryMaxQueries: 3,
    discoveryResultsPerQuery: 5,
    discoveryMaxDiscovered: 20,
    searchProvider: 'none',
    llmEnabled: false,
    llmPlanDiscoveryQueries: false
  };
  const storage = createStorage(config);
  const categoryConfig = baseCategoryConfig();
  const job = jobFixture();

  try {
    await persistSourceIntel({
      storage,
      config,
      category: 'mouse',
      productId: job.productId,
      brand: job.identityLock.brand,
      model: job.identityLock.model,
      variant: job.identityLock.variant,
      sourceResults: [sourceResultFixture()],
      provenance: provenanceFixture(),
      categoryConfig
    });

    const discovery = await discoverCandidateSources({
      config,
      storage,
      categoryConfig,
      job,
      runId: 'run-internal-only',
      logger: null,
      planningHints: {
        missingRequiredFields: ['weight', 'dpi']
      },
      llmContext: {}
    });

    assert.equal(discovery.approvedUrls.some((url) => url.includes('razer.com/gaming-mice/viper-v3-pro')), true);
    assert.equal((discovery.search_attempts || []).some((row) => row.provider === 'internal'), true);
    assert.equal(
      (discovery.search_attempts || []).some((row) => row.provider === 'internal' && row.reason_code === 'internal_corpus_lookup'),
      true
    );
    assert.equal((discovery.search_attempts || []).some((row) => row.provider === 'plan'), false);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('discoverCandidateSources skips external search when internal recall already satisfies target', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-internal-satisfied-'));
  const localInputRoot = path.join(tempRoot, 'fixtures');
  const localOutputRoot = path.join(tempRoot, 'out');
  const config = {
    localMode: true,
    localInputRoot,
    localOutputRoot,
    s3InputPrefix: 'specs/inputs',
    s3OutputPrefix: 'specs/outputs',
    discoveryEnabled: true,
    discoveryInternalFirst: true,
    discoveryInternalMinResults: 1,
    discoveryMaxQueries: 2,
    discoveryResultsPerQuery: 5,
    discoveryMaxDiscovered: 20,
    searchProvider: 'searxng',
    searxngBaseUrl: 'http://127.0.0.1:8080',
    llmEnabled: false,
    llmPlanDiscoveryQueries: false,
    searchCacheTtlSeconds: 0
  };
  const storage = createStorage(config);
  const categoryConfig = baseCategoryConfig();
  const job = jobFixture();

  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async (...args) => {
    fetchCalls += 1;
    return originalFetch(...args);
  };

  try {
    await persistSourceIntel({
      storage,
      config,
      category: 'mouse',
      productId: job.productId,
      brand: job.identityLock.brand,
      model: job.identityLock.model,
      variant: job.identityLock.variant,
      sourceResults: [sourceResultFixture()],
      provenance: provenanceFixture(),
      categoryConfig
    });

    const discovery = await discoverCandidateSources({
      config,
      storage,
      categoryConfig,
      job,
      runId: 'run-internal-satisfied',
      logger: null,
      planningHints: {
        missingRequiredFields: ['weight', 'dpi'],
        requiredOnlySearch: true
      },
      llmContext: {}
    });

    assert.equal(discovery.internal_satisfied, true);
    assert.equal(discovery.external_search_reason, 'internal_satisfied_skip_external');
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = originalFetch;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('discoverCandidateSources annotates dual-mode searxng fallback reason when only searxng is available', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-searxng-fallback-'));
  const localInputRoot = path.join(tempRoot, 'fixtures');
  const localOutputRoot = path.join(tempRoot, 'out');
  const config = {
    localMode: true,
    localInputRoot,
    localOutputRoot,
    s3InputPrefix: 'specs/inputs',
    s3OutputPrefix: 'specs/outputs',
    discoveryEnabled: true,
    discoveryInternalFirst: true,
    discoveryInternalMinResults: 99,
    discoveryMaxQueries: 1,
    discoveryResultsPerQuery: 5,
    discoveryMaxDiscovered: 20,
    searchProvider: 'dual',
    searxngBaseUrl: 'http://127.0.0.1:8080',
    llmEnabled: false,
    llmPlanDiscoveryQueries: false,
    searchCacheTtlSeconds: 0
  };
  const storage = createStorage(config);
  const categoryConfig = baseCategoryConfig();
  const job = jobFixture();

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return {
        results: [
          {
            url: 'https://www.razer.com/gaming-mice/viper-v3-pro',
            title: 'Razer Viper V3 Pro',
            content: 'Official specs',
            engine: 'duckduckgo'
          }
        ]
      };
    }
  });

  try {
    const discovery = await discoverCandidateSources({
      config,
      storage,
      categoryConfig,
      job,
      runId: 'run-searxng-fallback',
      logger: null,
      planningHints: {
        missingRequiredFields: ['weight', 'dpi'],
        requiredOnlySearch: true
      },
      llmContext: {}
    });

    assert.equal(discovery.external_search_reason, 'required_fields_missing_internal_under_target');
    assert.equal(
      (discovery.search_attempts || []).some(
        (row) => row.provider === 'dual' && row.reason_code === 'dual_fallback_searxng_only'
      ),
      true
    );
  } finally {
    global.fetch = originalFetch;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
