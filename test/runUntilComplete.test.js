import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContractEffortPlan,
  buildRoundConfig,
  buildRoundRequirements,
  evaluateRequiredSearchExhaustion,
  resolveMissingRequiredForPlanning,
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

test('buildRoundRequirements falls back to planning required fields when previous summary has no missing_required_fields', () => {
  const job = {
    requirements: {
      requiredFields: ['identity.brand']
    }
  };
  const out = buildRoundRequirements(job, ['weight'], {
    validated: false,
    missing_required_fields: []
  }, ['fields.connection', 'fields.dpi']);

  assert.deepEqual(
    out.requirements.requiredFields,
    ['identity.brand', 'fields.connection', 'fields.dpi']
  );
});

test('resolveMissingRequiredForPlanning restores category required fields for unresolved aggressive rounds', () => {
  const missing = resolveMissingRequiredForPlanning({
    previousSummary: {
      validated: false,
      missing_required_fields: [],
      critical_fields_below_pass_target: ['polling_rate']
    },
    categoryConfig: {
      fieldOrder: ['connection', 'dpi', 'polling_rate'],
      requiredFields: ['connection', 'dpi']
    },
    mode: 'aggressive'
  });

  assert.deepEqual(missing, ['connection', 'dpi']);
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

test('selectRoundSearchProvider falls back to duckduckgo when no keyed providers are configured', () => {
  const provider = selectRoundSearchProvider({
    baseConfig: {
      searchProvider: 'none',
      searxngBaseUrl: '',
      duckduckgoEnabled: true
    },
    discoveryEnabled: true,
    missingRequiredCount: 1
  });
  assert.equal(provider, 'duckduckgo');
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

test('buildRoundConfig keeps aggressive discovery enabled when critical gaps remain and product not validated', () => {
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
      llmMaxCallsPerProductTotal: 12,
      aggressiveLlmMaxCallsPerRound: 18,
      aggressiveLlmMaxCallsPerProductTotal: 64,
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
      missingRequiredCount: 0,
      missingExpectedCount: 0,
      missingCriticalCount: 1,
      previousValidated: false
    }
  );

  assert.equal(roundConfig.discoveryEnabled, true);
  assert.equal(roundConfig.fetchCandidateSources, true);
  assert.equal(roundConfig.searchProvider, 'searxng');
  assert.equal(roundConfig.llmMaxCallsPerRound >= 18, true);
  assert.equal(roundConfig.llmMaxCallsPerProductTotal >= 64, true);
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

test('buildRoundConfig keeps aggressive round 1 in standard profile by default', () => {
  const roundConfig = buildRoundConfig(
    {
      runProfile: 'standard',
      aggressiveThoroughFromRound: 2,
      maxUrlsPerProduct: 140,
      maxCandidateUrls: 180,
      llmMaxCallsPerRound: 5,
      llmMaxCallsPerProductFast: 2,
      discoveryEnabled: true,
      fetchCandidateSources: true,
      searchProvider: 'searxng',
      searxngBaseUrl: 'http://127.0.0.1:8080'
    },
    {
      round: 1,
      mode: 'aggressive',
      missingRequiredCount: 3
    }
  );

  assert.equal(roundConfig.runProfile, 'standard');
  assert.equal(roundConfig.maxUrlsPerProduct <= 90, true);
  assert.equal(roundConfig.maxCandidateUrls <= 120, true);
});

test('buildRoundConfig allows aggressive thorough profile from configured round', () => {
  const roundConfig = buildRoundConfig(
    {
      runProfile: 'standard',
      aggressiveThoroughFromRound: 1,
      maxUrlsPerProduct: 90,
      maxCandidateUrls: 120,
      llmMaxCallsPerRound: 5,
      llmMaxCallsPerProductFast: 2,
      discoveryEnabled: true,
      fetchCandidateSources: true,
      searchProvider: 'searxng',
      searxngBaseUrl: 'http://127.0.0.1:8080'
    },
    {
      round: 1,
      mode: 'aggressive',
      missingRequiredCount: 3
    }
  );

  assert.equal(roundConfig.runProfile, 'thorough');
});

test('buildContractEffortPlan derives weighted effort from field rule contracts', () => {
  const plan = buildContractEffortPlan({
    missingRequiredFields: ['weight', 'dpi', 'connection'],
    missingCriticalFields: ['weight'],
    categoryConfig: {
      fieldRules: {
        fields: {
          weight: { required_level: 'critical', availability: 'expected', difficulty: 'easy', effort: 2 },
          dpi: { required_level: 'required', availability: 'expected', difficulty: 'medium', effort: 5 },
          connection: { required_level: 'required', availability: 'sometimes', difficulty: 'hard', effort: 8 }
        }
      }
    }
  });

  assert.equal(plan.total_effort, 15);
  assert.equal(plan.critical_missing_count, 1);
  assert.equal(plan.hard_missing_count, 1);
  assert.equal(plan.expected_required_count, 2);
});

test('buildRoundConfig raises deep-search budgets for high contract effort plans', () => {
  const low = buildRoundConfig(
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
      round: 2,
      mode: 'balanced',
      missingRequiredCount: 2,
      contractEffort: {
        total_effort: 4,
        hard_missing_count: 0,
        critical_missing_count: 0,
        expected_required_count: 2
      }
    }
  );

  const high = buildRoundConfig(
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
      round: 2,
      mode: 'balanced',
      missingRequiredCount: 2,
      contractEffort: {
        total_effort: 26,
        hard_missing_count: 2,
        critical_missing_count: 2,
        expected_required_count: 2
      }
    }
  );

  assert.equal(high.maxUrlsPerProduct >= low.maxUrlsPerProduct, true);
  assert.equal(high.maxCandidateUrls >= low.maxCandidateUrls, true);
  assert.equal(high.discoveryMaxQueries >= low.discoveryMaxQueries, true);
});
