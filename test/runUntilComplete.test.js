import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRoundConfig,
  buildRoundRequirements,
  evaluateRequiredSearchExhaustion,
  selectRoundSearchProvider,
  shouldForceExpectedFieldRetry
} from '../src/runner/runUntilComplete.js';

test('shouldForceExpectedFieldRetry forces one extra loop for expected required fields with not_found_after_search', () => {
  const result = shouldForceExpectedFieldRetry({
    summary: {
      missing_required_fields: ['fields.weight', 'dpi'],
      field_reasoning: {
        weight: { unknown_reason: 'not_found_after_search' },
        dpi: { unknown_reason: 'not_found_after_search' }
      }
    },
    categoryConfig: {
      fieldOrder: ['weight', 'dpi']
    },
    fieldAvailabilityArtifact: {
      fields: {
        weight: { classification: 'expected' },
        dpi: { classification: 'sometimes' }
      }
    },
    overrideCount: 0
  });

  assert.equal(result.force, true);
  assert.deepEqual(result.fields, ['weight']);
  assert.equal(result.reason, 'expected_required_not_found');
});

test('shouldForceExpectedFieldRetry does not force when blocked/budget/identity reasons are present', () => {
  const result = shouldForceExpectedFieldRetry({
    summary: {
      missing_required_fields: ['weight'],
      field_reasoning: {
        weight: { unknown_reason: 'not_found_after_search' },
        dpi: { unknown_reason: 'budget_exhausted' }
      }
    },
    categoryConfig: {
      fieldOrder: ['weight', 'dpi']
    },
    fieldAvailabilityArtifact: {
      fields: {
        weight: { classification: 'expected' }
      }
    },
    overrideCount: 0
  });

  assert.equal(result.force, false);
  assert.equal(result.reason, 'blocked_or_budget_or_identity');
});

test('shouldForceExpectedFieldRetry only forces once per run', () => {
  const result = shouldForceExpectedFieldRetry({
    summary: {
      missing_required_fields: ['weight'],
      field_reasoning: {
        weight: { unknown_reason: 'not_found_after_search' }
      }
    },
    categoryConfig: {
      fieldOrder: ['weight']
    },
    fieldAvailabilityArtifact: {
      fields: {
        weight: { classification: 'expected' }
      }
    },
    overrideCount: 1
  });

  assert.equal(result.force, false);
  assert.equal(result.reason, 'already_forced_once');
});

test('buildRoundRequirements preserves base required fields across rounds', () => {
  const job = {
    productId: 'mouse-logitech-g-pro-x-superlight-2',
    requirements: {
      requiredFields: ['identity.brand', 'fields.connection']
    }
  };
  const out = buildRoundRequirements(job, ['weight'], {
    missing_required_fields: []
  });

  assert.deepEqual(out.requirements.llmTargetFields, ['weight']);
  assert.deepEqual(out.requirements.requiredFields, ['identity.brand', 'fields.connection']);
});

test('buildRoundRequirements unions previous missing required fields without dropping base required fields', () => {
  const job = {
    requirements: {
      requiredFields: ['identity.brand', 'fields.connection']
    }
  };
  const out = buildRoundRequirements(job, ['weight'], {
    missing_required_fields: ['fields.dpi', 'fields.connection']
  });

  assert.deepEqual(
    out.requirements.requiredFields,
    ['identity.brand', 'fields.connection', 'fields.dpi']
  );
});

test('evaluateRequiredSearchExhaustion stops after required-field loop has no new urls/fields', () => {
  const stop = evaluateRequiredSearchExhaustion({
    round: 2,
    missingRequiredCount: 2,
    noNewUrlsRounds: 2,
    noNewFieldsRounds: 2,
    threshold: 2
  });
  assert.equal(stop.stop, true);
  assert.equal(stop.reason, 'required_search_exhausted_no_new_urls_or_fields');
});

test('evaluateRequiredSearchExhaustion continues before threshold or without missing required fields', () => {
  const pending = evaluateRequiredSearchExhaustion({
    round: 1,
    missingRequiredCount: 1,
    noNewUrlsRounds: 1,
    noNewFieldsRounds: 0,
    threshold: 2
  });
  assert.equal(pending.stop, false);
  assert.equal(pending.reason, 'continue');

  const noMissing = evaluateRequiredSearchExhaustion({
    round: 3,
    missingRequiredCount: 0,
    noNewUrlsRounds: 4,
    noNewFieldsRounds: 4,
    threshold: 2
  });
  assert.equal(noMissing.stop, false);
});

test('selectRoundSearchProvider promotes dual when required fields are missing and multiple providers are ready', () => {
  const provider = selectRoundSearchProvider({
    baseConfig: {
      searchProvider: 'none',
      bingSearchEndpoint: 'https://api.bing.microsoft.com/v7.0/search',
      bingSearchKey: 'bing-key',
      searxngBaseUrl: 'http://127.0.0.1:8080'
    },
    discoveryEnabled: true,
    missingRequiredCount: 2
  });
  assert.equal(provider, 'dual');
});

test('selectRoundSearchProvider falls back to searxng when configured providers are unavailable', () => {
  const provider = selectRoundSearchProvider({
    baseConfig: {
      searchProvider: 'none',
      searxngBaseUrl: 'http://127.0.0.1:8080'
    },
    discoveryEnabled: true,
    missingRequiredCount: 1
  });
  assert.equal(provider, 'searxng');
});

test('selectRoundSearchProvider returns none when discovery is disabled', () => {
  const provider = selectRoundSearchProvider({
    baseConfig: {
      searchProvider: 'dual',
      bingSearchEndpoint: 'https://api.bing.microsoft.com/v7.0/search',
      bingSearchKey: 'bing-key'
    },
    discoveryEnabled: false,
    missingRequiredCount: 3
  });
  assert.equal(provider, 'none');
});

test('buildRoundConfig keeps discovery disabled when required fields are already complete', () => {
  const roundConfig = buildRoundConfig(
    {
      runProfile: 'standard',
      discoveryEnabled: true,
      fetchCandidateSources: true,
      searchProvider: 'searxng',
      searxngBaseUrl: 'http://127.0.0.1:8080',
      maxUrlsPerProduct: 80,
      maxCandidateUrls: 120,
      maxPagesPerDomain: 3,
      llmMaxCallsPerRound: 4,
      llmMaxCallsPerProductFast: 2,
      endpointSignalLimit: 30,
      endpointSuggestionLimit: 12,
      endpointNetworkScanLimit: 600,
      hypothesisAutoFollowupRounds: 0,
      hypothesisFollowupUrlsPerRound: 12,
      postLoadWaitMs: 0,
      autoScrollEnabled: false,
      autoScrollPasses: 0,
      manufacturerBroadDiscovery: false
    },
    {
      round: 1,
      mode: 'aggressive',
      missingRequiredCount: 0
    }
  );

  assert.equal(roundConfig.discoveryEnabled, false);
  assert.equal(roundConfig.fetchCandidateSources, false);
  assert.equal(roundConfig.searchProvider, 'none');
  assert.equal(roundConfig.manufacturerBroadDiscovery, false);
  assert.equal(roundConfig.maxUrlsPerProduct <= 48, true);
  assert.equal(roundConfig.maxCandidateUrls <= 48, true);
  assert.equal(roundConfig.maxManufacturerUrlsPerProduct <= 24, true);
});

test('buildRoundConfig enables discovery + searxng fallback when required fields are missing', () => {
  const roundConfig = buildRoundConfig(
    {
      runProfile: 'standard',
      discoveryEnabled: true,
      fetchCandidateSources: true,
      searchProvider: 'none',
      searxngBaseUrl: 'http://127.0.0.1:8080',
      maxUrlsPerProduct: 80,
      maxCandidateUrls: 120,
      maxPagesPerDomain: 3,
      llmMaxCallsPerRound: 4,
      llmMaxCallsPerProductFast: 2,
      endpointSignalLimit: 30,
      endpointSuggestionLimit: 12,
      endpointNetworkScanLimit: 600,
      hypothesisAutoFollowupRounds: 0,
      hypothesisFollowupUrlsPerRound: 12,
      postLoadWaitMs: 0,
      autoScrollEnabled: false,
      autoScrollPasses: 0,
      manufacturerBroadDiscovery: false
    },
    {
      round: 1,
      mode: 'balanced',
      missingRequiredCount: 2,
      requiredSearchIteration: 2
    }
  );

  assert.equal(roundConfig.discoveryEnabled, true);
  assert.equal(roundConfig.fetchCandidateSources, true);
  assert.equal(roundConfig.searchProvider, 'searxng');
});

test('buildRoundConfig defers external discovery on first required-search iteration when internal-first is enabled', () => {
  const roundConfig = buildRoundConfig(
    {
      runProfile: 'standard',
      discoveryEnabled: true,
      fetchCandidateSources: true,
      discoveryInternalFirst: true,
      searchProvider: 'searxng',
      searxngBaseUrl: 'http://127.0.0.1:8080',
      maxUrlsPerProduct: 80,
      maxCandidateUrls: 120,
      maxPagesPerDomain: 3,
      llmMaxCallsPerRound: 4,
      llmMaxCallsPerProductFast: 2,
      endpointSignalLimit: 30,
      endpointSuggestionLimit: 12,
      endpointNetworkScanLimit: 600,
      hypothesisAutoFollowupRounds: 0,
      hypothesisFollowupUrlsPerRound: 12,
      postLoadWaitMs: 0,
      autoScrollEnabled: false,
      autoScrollPasses: 0,
      manufacturerBroadDiscovery: false
    },
    {
      round: 1,
      mode: 'balanced',
      missingRequiredCount: 2,
      requiredSearchIteration: 1
    }
  );

  assert.equal(roundConfig.discoveryEnabled, false);
  assert.equal(roundConfig.fetchCandidateSources, false);
  assert.equal(roundConfig.searchProvider, 'none');
});

test('buildRoundConfig enables one expected-field search pass when required fields are complete', () => {
  const roundConfig = buildRoundConfig(
    {
      runProfile: 'standard',
      discoveryEnabled: true,
      fetchCandidateSources: true,
      searchProvider: 'searxng',
      searxngBaseUrl: 'http://127.0.0.1:8080',
      maxUrlsPerProduct: 80,
      maxCandidateUrls: 120,
      maxPagesPerDomain: 3,
      llmMaxCallsPerRound: 4,
      llmMaxCallsPerProductFast: 2,
      endpointSignalLimit: 30,
      endpointSuggestionLimit: 12,
      endpointNetworkScanLimit: 600,
      hypothesisAutoFollowupRounds: 0,
      hypothesisFollowupUrlsPerRound: 12,
      postLoadWaitMs: 0,
      autoScrollEnabled: false,
      autoScrollPasses: 0,
      manufacturerBroadDiscovery: false
    },
    {
      round: 1,
      mode: 'balanced',
      missingRequiredCount: 0,
      missingExpectedCount: 2,
      requiredSearchIteration: 2
    }
  );

  assert.equal(roundConfig.discoveryEnabled, true);
  assert.equal(roundConfig.fetchCandidateSources, true);
  assert.equal(roundConfig.searchProvider, 'searxng');
});

test('buildRoundConfig preserves explicit LLM enablement in fast round 0 with tiny call cap', () => {
  const roundConfig = buildRoundConfig(
    {
      runProfile: 'standard',
      llmEnabled: true,
      llmExplicitlySet: true,
      llmExplicitlyEnabled: true,
      llmMaxCallsPerRound: 4,
      llmMaxCallsPerProductFast: 2,
      discoveryEnabled: false,
      fetchCandidateSources: false,
      searchProvider: 'none',
      maxUrlsPerProduct: 30,
      maxCandidateUrls: 40
    },
    {
      round: 0,
      mode: 'balanced',
      missingRequiredCount: 3
    }
  );

  assert.equal(roundConfig.runProfile, 'fast');
  assert.equal(roundConfig.llmEnabled, true);
  assert.equal(roundConfig.llmMaxCallsPerRound <= 2, true);
});

test('buildRoundConfig preserves explicit LLM disablement in fast round 0', () => {
  const roundConfig = buildRoundConfig(
    {
      runProfile: 'standard',
      llmEnabled: false,
      llmExplicitlySet: true,
      llmExplicitlyEnabled: false,
      llmMaxCallsPerRound: 4,
      llmMaxCallsPerProductFast: 2,
      discoveryEnabled: false,
      fetchCandidateSources: false,
      searchProvider: 'none',
      maxUrlsPerProduct: 30,
      maxCandidateUrls: 40
    },
    {
      round: 0,
      mode: 'balanced',
      missingRequiredCount: 3
    }
  );

  assert.equal(roundConfig.runProfile, 'fast');
  assert.equal(roundConfig.llmEnabled, false);
});
