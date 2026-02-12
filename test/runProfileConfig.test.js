import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRunProfile, loadConfig } from '../src/config.js';

test('applyRunProfile thorough raises deep crawl and backend capture budgets', () => {
  const profiled = applyRunProfile({
    runProfile: 'standard',
    maxRunSeconds: 300,
    maxUrlsPerProduct: 20,
    maxCandidateUrls: 50,
    maxPagesPerDomain: 2,
    maxManufacturerUrlsPerProduct: 20,
    maxManufacturerPagesPerDomain: 8,
    manufacturerReserveUrls: 10,
    maxJsonBytes: 2_000_000,
    maxGraphqlReplays: 5,
    maxHypothesisItems: 50,
    maxNetworkResponsesPerPage: 1200,
    endpointNetworkScanLimit: 600,
    endpointSignalLimit: 30,
    endpointSuggestionLimit: 12,
    hypothesisAutoFollowupRounds: 0,
    hypothesisFollowupUrlsPerRound: 12,
    pageGotoTimeoutMs: 30_000,
    pageNetworkIdleTimeoutMs: 6_000,
    postLoadWaitMs: 0,
    autoScrollEnabled: false,
    autoScrollPasses: 0,
    autoScrollDelayMs: 900,
    discoveryEnabled: false,
    fetchCandidateSources: true,
    discoveryMaxQueries: 8,
    discoveryResultsPerQuery: 10,
    discoveryMaxDiscovered: 120,
    llmPlanDiscoveryQueries: false,
    manufacturerBroadDiscovery: false
  }, 'thorough');

  assert.equal(profiled.runProfile, 'thorough');
  assert.equal(profiled.maxRunSeconds >= 3600, true);
  assert.equal(profiled.maxUrlsPerProduct >= 220, true);
  assert.equal(profiled.maxManufacturerUrlsPerProduct >= 140, true);
  assert.equal(profiled.endpointNetworkScanLimit >= 1800, true);
  assert.equal(profiled.maxNetworkResponsesPerPage >= 2500, true);
  assert.equal(profiled.hypothesisAutoFollowupRounds >= 2, true);
  assert.equal(profiled.autoScrollEnabled, true);
  assert.equal(profiled.discoveryEnabled, true);
  assert.equal(profiled.manufacturerBroadDiscovery, true);
});

test('loadConfig supports thorough profile override', () => {
  const cfg = loadConfig({ runProfile: 'thorough' });

  assert.equal(cfg.runProfile, 'thorough');
  assert.equal(cfg.maxRunSeconds >= 3600, true);
  assert.equal(cfg.endpointSuggestionLimit >= 36, true);
  assert.equal(cfg.discoveryMaxQueries >= 24, true);
  assert.equal(cfg.hypothesisFollowupUrlsPerRound >= 24, true);
});

test('loadConfig uses DeepSeek fallback key and defaults when OPENAI_API_KEY is missing', () => {
  const keys = [
    'OPENAI_API_KEY',
    'DEEPSEEK_API_KEY',
    'OPENAI_BASE_URL',
    'OPENAI_MODEL_EXTRACT',
    'LLM_REASONING_MODE'
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  try {
    delete process.env.OPENAI_API_KEY;
    process.env.DEEPSEEK_API_KEY = 'ds-test-key';
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_MODEL_EXTRACT;
    delete process.env.LLM_REASONING_MODE;

    const cfg = loadConfig({});
    assert.equal(cfg.openaiApiKey, 'ds-test-key');
    assert.equal(cfg.openaiBaseUrl, 'https://api.deepseek.com');
    assert.equal(cfg.openaiModelExtract, 'deepseek-reasoner');
    assert.equal(cfg.llmReasoningMode, true);
    assert.equal(cfg.llmProvider, 'deepseek');
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
});
