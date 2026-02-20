import { runProduct } from '../pipeline/runProduct.js';
import { applyRunProfile } from '../config.js';
import { loadCategoryConfig } from '../categories/loader.js';
import { evaluateSearchLoopStop } from '../search/searchLoop.js';
import { EventLogger } from '../logger.js';
import { loadCategoryBrain } from '../learning/categoryBrain.js';
import { availabilitySearchEffort } from '../learning/fieldAvailability.js';
import { normalizeFieldList } from '../utils/fieldKeys.js';
import {
  markQueueRunning,
  recordQueueRunResult,
  upsertQueueProduct
} from '../queue/queueState.js';
import {
  ruleRequiredLevel,
  ruleAvailability,
  ruleDifficulty,
  ruleEffort,
  ruleAiMode,
  ruleAiMaxCalls
} from '../engine/ruleAccessors.js';

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizedMode(value, fallback = 'balanced') {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'uber_aggressive' || token === 'uber' || token === 'ultra') {
    return 'uber_aggressive';
  }
  if (token === 'aggressive') {
    return 'aggressive';
  }
  if (token === 'balanced') {
    return 'balanced';
  }
  return fallback;
}

function normalizedRoundCount(value, fallback = 4) {
  const parsed = toInt(value, fallback);
  return Math.max(1, Math.min(12, parsed || fallback));
}

function summaryProgress(summary = {}) {
  return {
    missingRequiredCount: toArray(summary.missing_required_fields).length,
    criticalCount: toArray(summary.critical_fields_below_pass_target).length,
    contradictionCount: toInt(summary.constraint_analysis?.contradiction_count, 0),
    confidence: Number.parseFloat(String(summary.confidence || 0)) || 0,
    validated: Boolean(summary.validated)
  };
}

function isCompleted(summary = {}) {
  const missingRequiredCount = toArray(summary.missing_required_fields).length;
  const criticalCount = toArray(summary.critical_fields_below_pass_target).length;
  return Boolean(summary.validated) && missingRequiredCount === 0 && criticalCount === 0;
}

function makeRoundHint(round) {
  if (round === 0) return 'fast_pass';
  if (round === 1) return 'targeted_search_pass';
  if (round === 2) return 'deep_manufacturer_pass';
  return 'conflict_resolution_pass';
}

function normalizeFieldForSearchQuery(value) {
  const token = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^fields\./, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!token) {
    return '';
  }

  const blocked = new Set([
    'id',
    'brand',
    'model',
    'base model',
    'category',
    'variant',
    'active',
    'status',
    'flags'
  ]);
  if (blocked.has(token)) {
    return '';
  }

  if (token === 'lngth') return 'length';
  if (token === 'cpi') return 'dpi';
  return token;
}

function buildAvailabilityQueries({
  job,
  expectedFields = [],
  sometimesFields = [],
  criticalFields = []
}) {
  const brand = String(job?.identityLock?.brand || '').trim();
  const model = String(job?.identityLock?.model || '').trim();
  const variant = String(job?.identityLock?.variant || '').trim();
  const product = [brand, model, variant].filter(Boolean).join(' ').trim();
  if (!product) {
    return [];
  }
  const fields = [...new Set([
    ...(expectedFields || []),
    ...(criticalFields || [])
  ])];
  const queries = [];

  const baseline = [
    `${product} specifications`,
    `${product} specs`,
    `${product} technical specifications`,
    `${product} datasheet`,
    `${product} manual pdf`,
    `${product} official specs`,
    `${product} review`
  ];
  queries.push(...baseline);

  for (const field of fields.slice(0, 8)) {
    const normalizedField = normalizeFieldForSearchQuery(field);
    if (!normalizedField) {
      continue;
    }
    queries.push(`${product} ${normalizedField} specification`);
    queries.push(`${product} ${normalizedField} support`);
    queries.push(`${product} ${normalizedField} manual pdf`);
  }
  for (const field of (sometimesFields || []).slice(0, 4)) {
    const normalizedField = normalizeFieldForSearchQuery(field);
    if (!normalizedField) {
      continue;
    }
    queries.push(`${product} ${normalizedField} specs`);
  }
  return [...new Set(queries.map((query) => query.trim()).filter(Boolean))].slice(0, 30);
}

function normalizeFieldContractToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^fields\./, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// readRuleToken and inferRuleEffort replaced by ruleAccessors imports

export function buildContractEffortPlan({
  missingRequiredFields = [],
  missingCriticalFields = [],
  categoryConfig = {}
} = {}) {
  const ruleMap = categoryConfig?.fieldRules?.fields || {};
  const fieldOrder = categoryConfig?.fieldOrder || [];
  const requiredFields = normalizeFieldList(toArray(missingRequiredFields), { fieldOrder })
    .map((field) => normalizeFieldContractToken(field))
    .filter(Boolean);
  const criticalSet = new Set(
    normalizeFieldList(toArray(missingCriticalFields), { fieldOrder })
      .map((field) => normalizeFieldContractToken(field))
      .filter(Boolean)
  );
  const dedupedRequired = [...new Set(requiredFields)];

  const fieldPlans = [];
  let totalEffort = 0;
  let hardMissingCount = 0;
  let expectedRequiredCount = 0;

  for (const field of dedupedRequired) {
    const rule = ruleMap[field] || ruleMap[`fields.${field}`] || {};
    const requiredLevel = ruleRequiredLevel(rule);
    const availability = ruleAvailability(rule);
    const difficulty = ruleDifficulty(rule);
    const effort = ruleEffort(rule);
    totalEffort += effort;

    if (difficulty === 'hard') {
      hardMissingCount += 1;
    }
    if (availability === 'expected') {
      expectedRequiredCount += 1;
    }
    if (requiredLevel === 'critical') {
      criticalSet.add(field);
    }

    fieldPlans.push({
      field,
      required_level: requiredLevel || null,
      availability: availability || null,
      difficulty: difficulty || null,
      effort,
      ai_mode: ruleAiMode(rule),
      ai_max_calls: ruleAiMaxCalls(rule)
    });
  }

  return {
    total_effort: Math.round(totalEffort),
    required_missing_count: dedupedRequired.length,
    critical_missing_count: criticalSet.size,
    hard_missing_count: hardMissingCount,
    expected_required_count: expectedRequiredCount,
    fields: fieldPlans
  };
}

export function selectRoundSearchProvider({
  baseConfig = {},
  discoveryEnabled = true,
  missingRequiredCount = 0,
  requiredSearchIteration = 0
}) {
  return resolveSearchProviderDecision({
    baseConfig,
    discoveryEnabled,
    missingRequiredCount,
    requiredSearchIteration
  }).provider;
}

export function explainSearchProviderSelection({
  baseConfig = {},
  discoveryEnabled = true,
  missingRequiredCount = 0,
  requiredSearchIteration = 0
}) {
  const decision = resolveSearchProviderDecision({
    baseConfig,
    discoveryEnabled,
    missingRequiredCount,
    requiredSearchIteration
  });
  return {
    provider: decision.provider,
    reason_code: decision.reasonCode,
    configured_provider: decision.configured,
    discovery_enabled: decision.discoveryEnabled,
    missing_required_count: decision.missingRequiredCount,
    required_search_iteration: decision.requiredSearchIteration,
    cse_rescue_only_mode: decision.cseRescueOnlyMode,
    cse_rescue_required_iteration: decision.rescueIterationThreshold,
    use_paid_rescue: decision.usePaidRescue,
    paid_provider_ready: decision.canUsePaidProvider,
    free_provider_ready: decision.hasFreeProvider,
    searxng_ready: decision.searxngReady,
    duckduckgo_ready: decision.duckduckgoReady,
    bing_ready: decision.bingReady,
    google_ready: decision.googleReady,
    google_cse_disabled: decision.googleCseDisabled
  };
}

function resolveSearchProviderDecision({
  baseConfig = {},
  discoveryEnabled = true,
  missingRequiredCount = 0,
  requiredSearchIteration = 0
}) {
  const normalizedMissingRequired = Math.max(0, toInt(missingRequiredCount, 0));
  const normalizedRequiredIteration = Math.max(0, toInt(requiredSearchIteration, 0));

  if (!discoveryEnabled) {
    return {
      provider: 'none',
      reasonCode: 'discovery_disabled',
      configured: String(baseConfig.searchProvider || 'none').trim().toLowerCase(),
      discoveryEnabled: false,
      missingRequiredCount: normalizedMissingRequired,
      requiredSearchIteration: normalizedRequiredIteration,
      googleCseDisabled: Boolean(baseConfig.disableGoogleCse),
      bingReady: false,
      googleReady: false,
      searxngReady: false,
      duckduckgoReady: false,
      hasFreeProvider: false,
      cseRescueOnlyMode: baseConfig.cseRescueOnlyMode !== false,
      rescueIterationThreshold: Math.max(1, toInt(baseConfig.cseRescueRequiredIteration, 2)),
      canUsePaidProvider: false,
      usePaidRescue: false
    };
  }

  const configured = String(baseConfig.searchProvider || 'none').trim().toLowerCase();
  const googleCseDisabled = Boolean(baseConfig.disableGoogleCse);
  const bingReady = Boolean(baseConfig.bingSearchEndpoint && baseConfig.bingSearchKey);
  const googleReady = !googleCseDisabled && Boolean(baseConfig.googleCseKey && baseConfig.googleCseCx);
  const searxngReady = Boolean(baseConfig.searxngBaseUrl);
  const duckduckgoReady = baseConfig.duckduckgoEnabled !== false;
  const hasFreeProvider = searxngReady || duckduckgoReady;
  const cseRescueOnlyMode = baseConfig.cseRescueOnlyMode !== false;
  const rescueIterationThreshold = Math.max(1, toInt(baseConfig.cseRescueRequiredIteration, 2));
  const canUsePaidProvider = bingReady || googleReady;
  const usePaidRescue =
    canUsePaidProvider &&
    (
      !cseRescueOnlyMode ||
      !hasFreeProvider ||
      (
        normalizedMissingRequired > 0 &&
        normalizedRequiredIteration >= rescueIterationThreshold
      )
    );
  const baseDecision = {
    configured,
    discoveryEnabled: true,
    missingRequiredCount: normalizedMissingRequired,
    requiredSearchIteration: normalizedRequiredIteration,
    googleCseDisabled,
    bingReady,
    googleReady,
    searxngReady,
    duckduckgoReady,
    hasFreeProvider,
    cseRescueOnlyMode,
    rescueIterationThreshold,
    canUsePaidProvider,
    usePaidRescue
  };

  if (configured === 'bing') {
    if (bingReady) {
      return {
        ...baseDecision,
        provider: 'bing',
        reasonCode: 'configured_bing_ready'
      };
    }
    if (searxngReady) {
      return {
        ...baseDecision,
        provider: 'searxng',
        reasonCode: 'configured_bing_fallback_searxng'
      };
    }
    if (duckduckgoReady) {
      return {
        ...baseDecision,
        provider: 'duckduckgo',
        reasonCode: 'configured_bing_fallback_duckduckgo'
      };
    }
    return {
      ...baseDecision,
      provider: 'none',
      reasonCode: 'configured_bing_no_provider_ready'
    };
  }
  if (configured === 'google') {
    if (googleReady) {
      return {
        ...baseDecision,
        provider: 'google',
        reasonCode: 'configured_google_ready'
      };
    }
    if (searxngReady) {
      return {
        ...baseDecision,
        provider: 'searxng',
        reasonCode: 'configured_google_fallback_searxng'
      };
    }
    if (duckduckgoReady) {
      return {
        ...baseDecision,
        provider: 'duckduckgo',
        reasonCode: 'configured_google_fallback_duckduckgo'
      };
    }
    return {
      ...baseDecision,
      provider: 'none',
      reasonCode: 'configured_google_no_provider_ready'
    };
  }
  if (configured === 'dual') {
    if (usePaidRescue) {
      return {
        ...baseDecision,
        provider: 'dual',
        reasonCode: cseRescueOnlyMode ? 'configured_dual_paid_rescue' : 'configured_dual_paid_always'
      };
    }
    if (searxngReady) {
      return {
        ...baseDecision,
        provider: 'searxng',
        reasonCode: 'configured_dual_free_searxng'
      };
    }
    if (duckduckgoReady) {
      return {
        ...baseDecision,
        provider: 'duckduckgo',
        reasonCode: 'configured_dual_free_duckduckgo'
      };
    }
    return {
      ...baseDecision,
      provider: 'none',
      reasonCode: 'configured_dual_no_provider_ready'
    };
  }
  if (configured === 'searxng') {
    if (searxngReady) {
      return {
        ...baseDecision,
        provider: 'searxng',
        reasonCode: 'configured_searxng_ready'
      };
    }
    if (duckduckgoReady) {
      return {
        ...baseDecision,
        provider: 'duckduckgo',
        reasonCode: 'configured_searxng_fallback_duckduckgo'
      };
    }
    return {
      ...baseDecision,
      provider: 'none',
      reasonCode: 'configured_searxng_no_provider_ready'
    };
  }
  if (configured === 'duckduckgo' || configured === 'ddg') {
    return {
      ...baseDecision,
      provider: duckduckgoReady ? 'duckduckgo' : 'none',
      reasonCode: duckduckgoReady ? 'configured_duckduckgo_ready' : 'configured_duckduckgo_no_provider_ready'
    };
  }

  if (normalizedMissingRequired > 0) {
    if (usePaidRescue) {
      if (bingReady && googleReady) {
        return {
          ...baseDecision,
          provider: 'dual',
          reasonCode: cseRescueOnlyMode ? 'auto_paid_rescue_dual' : 'auto_paid_dual'
        };
      }
      if (bingReady) {
        return {
          ...baseDecision,
          provider: 'bing',
          reasonCode: cseRescueOnlyMode ? 'auto_paid_rescue_bing' : 'auto_paid_bing'
        };
      }
      if (googleReady) {
        return {
          ...baseDecision,
          provider: 'google',
          reasonCode: cseRescueOnlyMode ? 'auto_paid_rescue_google' : 'auto_paid_google'
        };
      }
    }
    if (searxngReady) {
      return {
        ...baseDecision,
        provider: 'searxng',
        reasonCode: 'auto_free_searxng_for_missing_required'
      };
    }
    if (duckduckgoReady) {
      return {
        ...baseDecision,
        provider: 'duckduckgo',
        reasonCode: 'auto_free_duckduckgo_for_missing_required'
      };
    }
  } else if (searxngReady || duckduckgoReady) {
    return {
      ...baseDecision,
      provider: searxngReady ? 'searxng' : 'duckduckgo',
      reasonCode: searxngReady ? 'auto_free_searxng_no_required_gap' : 'auto_free_duckduckgo_no_required_gap'
    };
  }
  return {
    ...baseDecision,
    provider: 'none',
    reasonCode: 'no_provider_ready'
  };
}

export function evaluateRequiredSearchExhaustion({
  round = 0,
  missingRequiredCount = 0,
  noNewUrlsRounds = 0,
  noNewFieldsRounds = 0,
  threshold = 2
} = {}) {
  if (missingRequiredCount <= 0) {
    return { stop: false, reason: 'continue' };
  }
  const cap = Math.max(1, Number(threshold || 2));
  if (round >= cap && noNewUrlsRounds >= cap && noNewFieldsRounds >= cap) {
    return {
      stop: true,
      reason: 'required_search_exhausted_no_new_urls_or_fields'
    };
  }
  return { stop: false, reason: 'continue' };
}

export function shouldForceExpectedFieldRetry({
  summary = {},
  categoryConfig = {},
  fieldAvailabilityArtifact = {},
  overrideCount = 0
} = {}) {
  if (overrideCount > 0) {
    return {
      force: false,
      fields: [],
      reason: 'already_forced_once'
    };
  }

  for (const row of Object.values(summary.field_reasoning || {})) {
    const reason = String(row?.unknown_reason || '').trim().toLowerCase();
    if (!reason) {
      continue;
    }
    if (reason.includes('budget') || reason.includes('identity') || reason.includes('blocked')) {
      return {
        force: false,
        fields: [],
        reason: 'blocked_or_budget_or_identity'
      };
    }
  }

  const missingRequired = normalizeFieldList(
    toArray(summary.missing_required_fields),
    { fieldOrder: categoryConfig.fieldOrder || [] }
  );
  if (!missingRequired.length) {
    return {
      force: false,
      fields: [],
      reason: 'no_missing_required'
    };
  }

  const expectedFields = [];
  for (const field of missingRequired) {
    const unknownReason = String(summary.field_reasoning?.[field]?.unknown_reason || '').trim().toLowerCase();
    const classification = String(fieldAvailabilityArtifact?.fields?.[field]?.classification || '').trim().toLowerCase();
    if (unknownReason === 'not_found_after_search' && classification === 'expected') {
      expectedFields.push(field);
    }
  }
  if (!expectedFields.length) {
    return {
      force: false,
      fields: [],
      reason: 'no_expected_required_not_found'
    };
  }

  return {
    force: true,
    fields: expectedFields,
    reason: 'expected_required_not_found'
  };
}

export function buildRoundConfig(baseConfig, {
  round,
  mode,
  availabilityEffort = {},
  contractEffort = {},
  missingRequiredCount,
  missingExpectedCount,
  missingCriticalCount,
  previousValidated,
  requiredSearchIteration
} = {}) {
  const aggressiveLike = mode === 'aggressive' || mode === 'uber_aggressive';
  const uberMode = mode === 'uber_aggressive';
  const expectedCount = toInt(availabilityEffort.expected_count, 0);
  const sometimesCount = toInt(availabilityEffort.sometimes_count, 0);
  const rareCount = toInt(availabilityEffort.rare_count, 0);
  const resolvedMissingRequired = toInt(missingRequiredCount, toInt(availabilityEffort.required_count, 0));
  const resolvedMissingExpected = toInt(missingExpectedCount, expectedCount);
  const resolvedMissingCritical = toInt(missingCriticalCount, 0);
  const resolvedPreviousValidated = previousValidated === undefined ? null : Boolean(previousValidated);
  const requiredIteration = toInt(requiredSearchIteration, 0);
  const hasExplicitMissingCounts =
    missingRequiredCount !== undefined ||
    missingExpectedCount !== undefined;
  const aggressiveThoroughFromRound = Math.max(1, toInt(baseConfig.aggressiveThoroughFromRound, 2));
  const profile = round === 0
    ? 'fast'
    : aggressiveLike
      ? (round >= aggressiveThoroughFromRound ? 'thorough' : 'standard')
      : (round >= 2 ? 'thorough' : 'standard');
  const aggressiveRound1UrlCap = Math.max(24, toInt(baseConfig.aggressiveRound1MaxUrls, 90));
  const aggressiveRound1CandidateCap = Math.max(32, toInt(baseConfig.aggressiveRound1MaxCandidateUrls, 120));
  const aggressiveRound1 = aggressiveLike && round === 1;
  const next = applyRunProfile(
    {
      ...baseConfig,
      runProfile: profile,
      discoveryEnabled: round > 0,
      fetchCandidateSources: round > 0,
      manufacturerBroadDiscovery: round >= 2 || Boolean(baseConfig.manufacturerBroadDiscovery),
      searchProvider: round === 0 ? 'none' : baseConfig.searchProvider,
      llmMaxCallsPerRound:
        round === 0
          ? Math.max(1, Math.min(baseConfig.llmMaxCallsPerProductFast || 2, baseConfig.llmMaxCallsPerRound || 4))
          : Math.max(1, baseConfig.llmMaxCallsPerRound || 4),
      maxUrlsPerProduct:
        round === 0
          ? Math.min(baseConfig.maxUrlsPerProduct || 20, 24)
          : (
            round >= 2
              ? Math.max(baseConfig.maxUrlsPerProduct || 20, uberMode ? 220 : 160)
              : (aggressiveRound1
                ? Math.min(Math.max(baseConfig.maxUrlsPerProduct || 20, 60), aggressiveRound1UrlCap)
                : Math.max(baseConfig.maxUrlsPerProduct || 20, 60))
          ),
      maxCandidateUrls:
        round === 0
          ? Math.min(baseConfig.maxCandidateUrls || 50, 40)
          : (
            round >= 2
              ? Math.max(baseConfig.maxCandidateUrls || 50, uberMode ? 300 : 220)
              : (aggressiveRound1
                ? Math.min(Math.max(baseConfig.maxCandidateUrls || 50, 90), aggressiveRound1CandidateCap)
                : Math.max(baseConfig.maxCandidateUrls || 50, 90))
          )
    },
    profile
  );

  if (uberMode && round > 0) {
    next.discoveryMaxQueries = Math.max(next.discoveryMaxQueries || 0, Math.max(12, toInt(baseConfig.discoveryMaxQueries, 8) + 4));
    next.maxUrlsPerProduct = Math.max(next.maxUrlsPerProduct || 0, Math.max(120, toInt(baseConfig.uberMaxUrlsPerProduct, 25)));
    next.maxCandidateUrls = Math.max(next.maxCandidateUrls || 0, Math.max(180, toInt(baseConfig.maxCandidateUrls, 50) + 40));
    next.maxPagesPerDomain = Math.max(next.maxPagesPerDomain || 0, Math.max(3, toInt(baseConfig.uberMaxUrlsPerDomain, 6)));
    next.maxManufacturerUrlsPerProduct = Math.max(next.maxManufacturerUrlsPerProduct || 0, Math.max(24, toInt(baseConfig.maxManufacturerUrlsPerProduct, 20)));
  }

  if (expectedCount > 0) {
    next.discoveryMaxQueries = Math.max(next.discoveryMaxQueries || 0, 10 + Math.min(14, expectedCount * 2));
    next.discoveryResultsPerQuery = Math.max(next.discoveryResultsPerQuery || 0, 12);
    next.maxUrlsPerProduct = Math.max(next.maxUrlsPerProduct || 0, 90 + Math.min(140, expectedCount * 12));
    next.maxCandidateUrls = Math.max(next.maxCandidateUrls || 0, 130 + Math.min(200, expectedCount * 16));
  } else if (rareCount > 0 && sometimesCount === 0) {
    next.discoveryMaxQueries = Math.min(next.discoveryMaxQueries || 8, 6);
    next.maxUrlsPerProduct = Math.min(next.maxUrlsPerProduct || 60, 70);
    next.maxCandidateUrls = Math.min(next.maxCandidateUrls || 90, 90);
  }

  const contractTotalEffort = Math.max(0, toInt(contractEffort.total_effort, 0));
  const hardMissingCount = Math.max(0, toInt(contractEffort.hard_missing_count, 0));
  const contractCriticalMissingCount = Math.max(0, toInt(contractEffort.critical_missing_count, 0));
  const expectedRequiredCount = Math.max(0, toInt(contractEffort.expected_required_count, 0));
  if (round > 0 && contractTotalEffort > 0) {
    const effortTier = Math.min(4, Math.floor(contractTotalEffort / 8));
    const queryBoost = effortTier + Math.min(6, expectedRequiredCount);
    const urlBoost = (effortTier * 20) + (hardMissingCount * 14) + (contractCriticalMissingCount * 10);
    const candidateBoost = (effortTier * 30) + (hardMissingCount * 18) + (contractCriticalMissingCount * 12);
    next.discoveryMaxQueries = Math.max(next.discoveryMaxQueries || 0, (next.discoveryMaxQueries || 0) + queryBoost);
    next.maxUrlsPerProduct = Math.max(next.maxUrlsPerProduct || 0, (next.maxUrlsPerProduct || 0) + urlBoost);
    next.maxCandidateUrls = Math.max(next.maxCandidateUrls || 0, (next.maxCandidateUrls || 0) + candidateBoost);
  }

  if (round === 0) {
    next.discoveryEnabled = false;
    next.fetchCandidateSources = false;
    next.searchProvider = 'none';
  } else {
    let discoveryEnabled = Boolean(next.discoveryEnabled);
    let fetchCandidateSources = Boolean(next.fetchCandidateSources);

    if (hasExplicitMissingCounts) {
      const aggressiveShouldContinue =
        aggressiveLike &&
        (
          resolvedMissingCritical > 0 ||
          resolvedPreviousValidated === false
        );
      if (resolvedMissingRequired === 0 && resolvedMissingExpected === 0 && !aggressiveShouldContinue) {
        discoveryEnabled = false;
        fetchCandidateSources = false;
      } else if (
        resolvedMissingRequired > 0 &&
        Boolean(baseConfig.discoveryInternalFirst) &&
        requiredIteration > 0 &&
        requiredIteration <= 1
      ) {
        discoveryEnabled = false;
        fetchCandidateSources = false;
      } else {
        discoveryEnabled = true;
        fetchCandidateSources = true;
      }
    }

    next.discoveryEnabled = discoveryEnabled;
    next.fetchCandidateSources = fetchCandidateSources;
    const searchProviderSelection = explainSearchProviderSelection({
      baseConfig,
      discoveryEnabled,
      missingRequiredCount: resolvedMissingRequired,
      requiredSearchIteration: requiredIteration
    });
    next.searchProvider = searchProviderSelection.provider;
    next.searchProviderSelection = searchProviderSelection;
    if (!discoveryEnabled) {
      next.searchProvider = 'none';
      next.searchProviderSelection = {
        ...searchProviderSelection,
        provider: 'none',
        reason_code: 'discovery_disabled'
      };
    }
  }

  const aggressiveKeepRoundOpen =
    aggressiveLike &&
    (
      resolvedMissingCritical > 0 ||
      resolvedPreviousValidated === false
    );
  if (hasExplicitMissingCounts && round > 0 && resolvedMissingRequired === 0 && resolvedMissingExpected === 0 && !aggressiveKeepRoundOpen) {
    next.maxUrlsPerProduct = Math.min(next.maxUrlsPerProduct || 60, 48);
    next.maxCandidateUrls = Math.min(next.maxCandidateUrls || 90, 48);
    next.maxManufacturerUrlsPerProduct = Math.min(next.maxManufacturerUrlsPerProduct || 24, 24);
    next.manufacturerBroadDiscovery = false;
  } else if (next.maxManufacturerUrlsPerProduct === undefined) {
    next.maxManufacturerUrlsPerProduct = Math.max(12, Math.min(next.maxUrlsPerProduct || 24, 24));
  }

  if (aggressiveLike) {
    const aggressiveRoundCallFloor = Math.max(1, toInt(baseConfig.aggressiveLlmMaxCallsPerRound, 16));
    const aggressiveTotalCallFloor = Math.max(
      aggressiveRoundCallFloor,
      toInt(baseConfig.aggressiveLlmMaxCallsPerProductTotal, 48)
    );
    if (round > 0) {
      next.llmMaxCallsPerRound = Math.max(next.llmMaxCallsPerRound || 0, aggressiveRoundCallFloor);
    }
    next.llmMaxCallsPerProductTotal = Math.max(next.llmMaxCallsPerProductTotal || 0, aggressiveTotalCallFloor);
  }

  if (Boolean(baseConfig.llmExplicitlySet)) {
    const explicitEnabled = baseConfig.llmExplicitlyEnabled;
    next.llmEnabled = explicitEnabled === undefined ? Boolean(baseConfig.llmEnabled) : Boolean(explicitEnabled);
  }

  return next;
}

function llmBlocked(summary = {}) {
  return String(summary.llm?.budget?.blocked_reason || '').trim();
}

function isIdentityOrEditorialField(field, categoryConfig = {}) {
  const token = String(field || '').trim().toLowerCase();
  if (!token) {
    return true;
  }
  if (['id', 'brand', 'model', 'base_model', 'category', 'sku', 'mpn', 'gtin', 'variant'].includes(token)) {
    return true;
  }
  const editorial = new Set(
    normalizeFieldList(toArray(categoryConfig?.schema?.editorial_fields || []), {
      fieldOrder: categoryConfig?.fieldOrder || []
    })
  );
  return editorial.has(token);
}

function makeLlmTargetFields({
  previousSummary,
  categoryConfig,
  mode = 'balanced',
  fallbackRequiredFields = [],
  config = {}
}) {
  const requiredFallback = normalizeFieldList(
    toArray(fallbackRequiredFields).length > 0
      ? toArray(fallbackRequiredFields)
      : toArray(categoryConfig.requiredFields),
    { fieldOrder: categoryConfig.fieldOrder || [] }
  );
  const criticalBase = normalizeFieldList(
    toArray(categoryConfig.schema?.critical_fields),
    { fieldOrder: categoryConfig.fieldOrder || [] }
  );
  const uberMode = mode === 'uber_aggressive';
  const aggressiveMode = mode === 'aggressive' || uberMode;
  const aggressiveTargetCap = Math.max(
    requiredFallback.length || 1,
    Math.min(
      Math.max(1, toInt(config.aggressiveLlmTargetMaxFields, uberMode ? 110 : 75)),
      Math.max(1, toArray(categoryConfig.fieldOrder).length || 75)
    )
  );
  const aggressiveAllFields = normalizeFieldList(toArray(categoryConfig.fieldOrder), {
    fieldOrder: categoryConfig.fieldOrder || []
  }).filter((field) => !isIdentityOrEditorialField(field, categoryConfig));

  if (!previousSummary) {
    const base = [
      ...new Set([
        ...requiredFallback,
        ...criticalBase
      ])
    ];
    if (!aggressiveMode) {
      return base;
    }
    return [...new Set([...base, ...aggressiveAllFields])].slice(0, aggressiveTargetCap);
  }

  const missing = normalizeFieldList(
    toArray(previousSummary.missing_required_fields),
    { fieldOrder: categoryConfig.fieldOrder || [] }
  );
  const critical = normalizeFieldList(
    toArray(previousSummary.critical_fields_below_pass_target),
    { fieldOrder: categoryConfig.fieldOrder || [] }
  );
  const belowPassTarget = normalizeFieldList(
    toArray(previousSummary.fields_below_pass_target),
    { fieldOrder: categoryConfig.fieldOrder || [] }
  );
  const contradictions = toArray(previousSummary.constraint_analysis?.top_uncertain_fields || [])
    .map((item) => item.field)
    .filter(Boolean);
  const combined = normalizeFieldList(
    [...new Set([...missing, ...critical, ...contradictions])],
    { fieldOrder: categoryConfig.fieldOrder || [] }
  );
  if (combined.length > 0) {
    if (!aggressiveMode) {
      return combined;
    }
    return [...new Set([
      ...combined,
      ...requiredFallback,
      ...belowPassTarget,
      ...aggressiveAllFields
    ])].slice(0, aggressiveTargetCap);
  }
  if (aggressiveMode) {
    return [...new Set([
      ...requiredFallback,
      ...criticalBase,
      ...belowPassTarget,
      ...aggressiveAllFields
    ])].slice(0, aggressiveTargetCap);
  }
  return [
    ...new Set([
      ...requiredFallback,
      ...criticalBase
    ])
  ];
}

export function resolveMissingRequiredForPlanning({
  previousSummary = null,
  categoryConfig = {},
  mode = 'balanced'
} = {}) {
  const previousMissing = normalizeFieldList(
    toArray(previousSummary?.missing_required_fields),
    { fieldOrder: categoryConfig.fieldOrder || [] }
  );
  if (previousMissing.length > 0) {
    return previousMissing;
  }
  const requiredDefaults = normalizeFieldList(
    toArray(categoryConfig.requiredFields),
    { fieldOrder: categoryConfig.fieldOrder || [] }
  );
  if (!previousSummary) {
    return requiredDefaults;
  }
  if (Boolean(previousSummary.validated)) {
    return previousMissing;
  }
  if (mode === 'aggressive' || mode === 'uber_aggressive') {
    return requiredDefaults;
  }
  const criticalMissing = normalizeFieldList(
    toArray(previousSummary.critical_fields_below_pass_target),
    { fieldOrder: categoryConfig.fieldOrder || [] }
  );
  if (criticalMissing.length > 0) {
    return requiredDefaults;
  }
  return previousMissing;
}

export function buildRoundRequirements(job, llmTargetFields, previousSummary, fallbackRequiredFields = []) {
  const requirements = {
    ...(job.requirements || {})
  };
  requirements.llmTargetFields = llmTargetFields;
  const previousMissing = toArray(previousSummary?.missing_required_fields);
  const requiredSeed = previousMissing.length > 0
    ? previousMissing
    : toArray(fallbackRequiredFields);
  requirements.requiredFields = [
    ...new Set([
      ...toArray(job.requirements?.requiredFields),
      ...requiredSeed
    ])
  ];
  return {
    ...job,
    requirements
  };
}

function calcProgressDelta(previous, current) {
  if (!previous) {
    return {
      improved: true,
      reasons: ['first_round']
    };
  }
  const reasons = [];
  if (current.validated && !previous.validated) {
    reasons.push('validated');
  }
  if (current.missingRequiredCount < previous.missingRequiredCount) {
    reasons.push('missing_required_reduced');
  }
  if (current.criticalCount < previous.criticalCount) {
    reasons.push('critical_reduced');
  }
  if (current.contradictionCount < previous.contradictionCount) {
    reasons.push('contradictions_reduced');
  }
  if (current.confidence > previous.confidence + 0.01) {
    reasons.push('confidence_up');
  }
  return {
    improved: reasons.length > 0,
    reasons
  };
}

export async function runUntilComplete({
  storage,
  config,
  s3key,
  maxRounds = 4,
  mode = config.accuracyMode || 'balanced'
}) {
  const job = await storage.readJson(s3key);
  const category = job.category || 'mouse';
  const productId = job.productId;
  if (!productId) {
    throw new Error(`Job at ${s3key} is missing productId`);
  }
  const logger = new EventLogger({
    storage,
    runtimeEventsKey: config.runtimeEventsKey || '_runtime/events.jsonl',
    context: {
      category,
      productId
    }
  });
  logger.info('queue_transition', {
    from: 'none',
    to: 'pending',
    reason: 'run_until_complete_started'
  });

  const categoryConfig = await loadCategoryConfig(category, { storage, config });
  const categoryBrain = await loadCategoryBrain({ storage, category });
  const fieldAvailabilityArtifact = categoryBrain?.artifacts?.fieldAvailability?.value || {};
  const normalizedModeValue = normalizedMode(mode, config.accuracyMode || 'balanced');
  const defaultRounds = normalizedModeValue === 'uber_aggressive'
    ? Math.max(8, toInt(config.uberMaxRounds, 6))
    : (normalizedModeValue === 'aggressive' ? 8 : 4);
  let roundsLimit = normalizedRoundCount(maxRounds, defaultRounds);
  const rounds = [];

  await upsertQueueProduct({
    storage,
    category,
    productId,
    s3key,
    patch: {
      status: 'pending',
      next_action_hint: 'fast_pass'
    }
  });

  let previousSummary = null;
  let previousProgress = null;
  let noProgressStreak = 0;
  let completed = false;
  let exhausted = false;
  let needsManual = false;
  let finalResult = null;
  let stopReason = '';
  let previousUrlCount = 0;
  let noNewUrlsRounds = 0;
  let noNewFieldsRounds = 0;
  let lowQualityRounds = 0;
  let requiredSearchIteration = 0;
  let expectedRetryOverrideCount = 0;
  let forcedExpectedRetryFields = [];
  const fieldCallCounts = new Map();
  let escalatedFields = [];  // Fields that failed extraction in prior round → escalate model

  for (let round = 0; round < roundsLimit; round += 1) {
    const roundHint = makeRoundHint(round);
    await markQueueRunning({
      storage,
      category,
      productId,
      s3key,
      nextActionHint: roundHint
    });
    logger.info('queue_transition', {
      from: 'pending',
      to: 'running',
      round,
      next_action_hint: roundHint
    });

    const missingRequiredForPlanning = resolveMissingRequiredForPlanning({
      previousSummary,
      categoryConfig,
      mode: normalizedModeValue
    });
    const missingCriticalForPlanning = normalizeFieldList(
      previousSummary?.critical_fields_below_pass_target || categoryConfig.schema?.critical_fields || [],
      { fieldOrder: categoryConfig.fieldOrder || [] }
    );
    const availabilityEffort = availabilitySearchEffort({
      artifact: fieldAvailabilityArtifact,
      missingFields: missingRequiredForPlanning,
      fieldOrder: categoryConfig.fieldOrder || []
    });
    const contractEffort = buildContractEffortPlan({
      missingRequiredFields: missingRequiredForPlanning,
      missingCriticalFields: missingCriticalForPlanning,
      categoryConfig
    });
    const missingRequiredCount = missingRequiredForPlanning.length;
    const missingExpectedCount = Math.max(
      0,
      toInt(availabilityEffort.expected_count, 0)
    );
    if (round > 0 && missingRequiredCount > 0) {
      requiredSearchIteration += 1;
    } else if (missingRequiredCount === 0) {
      requiredSearchIteration = 0;
    }
    const extraQueries = buildAvailabilityQueries({
      job,
      expectedFields: availabilityEffort.missing_expected_fields || [],
      sometimesFields: availabilityEffort.missing_sometimes_fields || [],
      criticalFields: missingCriticalForPlanning
    });

    const roundConfig = buildRoundConfig(config, {
      round,
      mode: normalizedModeValue,
      availabilityEffort,
      contractEffort,
      missingRequiredCount,
      missingExpectedCount,
      missingCriticalCount: missingCriticalForPlanning.length,
      previousValidated: previousSummary?.validated,
      requiredSearchIteration
    });
    const providerSelection = roundConfig.searchProviderSelection || explainSearchProviderSelection({
      baseConfig: config,
      discoveryEnabled: roundConfig.discoveryEnabled,
      missingRequiredCount,
      requiredSearchIteration
    });
    logger.info('search_provider_selected', {
      round,
      provider: providerSelection.provider,
      reason_code: providerSelection.reason_code,
      configured_provider: providerSelection.configured_provider,
      required_search_iteration: providerSelection.required_search_iteration,
      missing_required_count: providerSelection.missing_required_count,
      cse_rescue_only_mode: providerSelection.cse_rescue_only_mode,
      cse_rescue_required_iteration: providerSelection.cse_rescue_required_iteration,
      use_paid_rescue: providerSelection.use_paid_rescue,
      paid_provider_ready: providerSelection.paid_provider_ready,
      free_provider_ready: providerSelection.free_provider_ready,
      google_ready: providerSelection.google_ready,
      bing_ready: providerSelection.bing_ready,
      searxng_ready: providerSelection.searxng_ready,
      duckduckgo_ready: providerSelection.duckduckgo_ready,
      google_cse_disabled: providerSelection.google_cse_disabled
    });
    let llmTargetFields = makeLlmTargetFields({
      previousSummary,
      categoryConfig,
      mode: normalizedModeValue,
      fallbackRequiredFields: missingRequiredForPlanning,
      config
    });
    if (forcedExpectedRetryFields.length > 0) {
      llmTargetFields = [...new Set([...llmTargetFields, ...forcedExpectedRetryFields])];
      forcedExpectedRetryFields = [];
    }
    // Per-field call budget enforcement: exclude fields that have exhausted ai_max_calls
    const ruleMap = categoryConfig?.fieldRules?.fields || {};
    const budgetExhaustedFields = [];
    llmTargetFields = llmTargetFields.filter((field) => {
      const key = normalizeFieldContractToken(field);
      const rule = ruleMap[key] || ruleMap[`fields.${key}`] || {};
      const maxCalls = ruleAiMaxCalls(rule);
      const currentCalls = fieldCallCounts.get(key) || 0;
      if (currentCalls >= maxCalls) {
        budgetExhaustedFields.push(key);
        return false;
      }
      return true;
    });
    if (budgetExhaustedFields.length > 0) {
      logger.info('field_budget_exhausted', {
        round,
        fields: budgetExhaustedFields,
        remaining_target_count: llmTargetFields.length
      });
    }
    const jobOverride = buildRoundRequirements(job, llmTargetFields, previousSummary, missingRequiredForPlanning);

    const roundResult = await runProduct({
      storage,
      config: roundConfig,
      s3Key: s3key,
      jobOverride,
      roundContext: {
        round,
        mode: normalizedModeValue,
        force_verify_llm: Boolean(
          config.llmVerifyMode &&
          Array.isArray(previousSummary?.missing_required_fields) &&
          previousSummary.missing_required_fields.length > 0
        ),
        missing_required_fields: missingRequiredForPlanning,
        missing_critical_fields: missingCriticalForPlanning,
        availability: availabilityEffort,
        contract_effort: contractEffort,
        extra_queries: extraQueries,
        llm_target_fields: llmTargetFields,
        escalated_fields: escalatedFields
      }
    });
    finalResult = roundResult;
    // Increment per-field call counts for all fields targeted this round
    for (const field of llmTargetFields) {
      const key = normalizeFieldContractToken(field);
      fieldCallCounts.set(key, (fieldCallCounts.get(key) || 0) + 1);
    }
    // Dynamic escalation: fields targeted this round that are still missing → escalate next round
    const stillMissing = new Set(
      (roundResult.summary?.missing_required_fields || [])
        .map((f) => normalizeFieldContractToken(f))
        .filter(Boolean)
    );
    escalatedFields = llmTargetFields
      .map((f) => normalizeFieldContractToken(f))
      .filter((f) => stillMissing.has(f));
    if (escalatedFields.length > 0) {
      logger.info('fields_escalated_for_next_round', {
        round,
        count: escalatedFields.length,
        fields: escalatedFields.slice(0, 10)
      });
    }
    logger.info('round_completed', {
      round,
      run_id: roundResult.runId,
      validated: Boolean(roundResult.summary?.validated),
      confidence: Number(roundResult.summary?.confidence || 0),
      missing_required_count: (roundResult.summary?.missing_required_fields || []).length,
      critical_missing_count: (roundResult.summary?.critical_fields_below_pass_target || []).length
    });

    const progress = summaryProgress(roundResult.summary);
    const delta = calcProgressDelta(previousProgress, progress);
    if (delta.improved) {
      noProgressStreak = 0;
      noNewFieldsRounds = 0;
    } else {
      noProgressStreak += 1;
      noNewFieldsRounds += 1;
    }

    const budgetBlockedReason = llmBlocked(roundResult.summary);
    const budgetExceeded = budgetBlockedReason.includes('budget');
    const urlsFetchedCount = toArray(roundResult.summary?.urls_fetched).length;
    if (urlsFetchedCount > previousUrlCount) {
      noNewUrlsRounds = 0;
      previousUrlCount = urlsFetchedCount;
    } else {
      noNewUrlsRounds += 1;
    }
    if (
      (Number.parseInt(String(roundResult.summary?.sources_identity_matched || 0), 10) || 0) === 0 ||
      progress.confidence < 0.2
    ) {
      lowQualityRounds += 1;
    } else {
      lowQualityRounds = 0;
    }

    await recordQueueRunResult({
      storage,
      category,
      s3key,
      result: roundResult,
      roundResult: {
        exhausted: false,
        budgetExceeded,
        nextActionHint: makeRoundHint(round + 1)
      }
    });

    rounds.push({
      round,
      round_profile: roundConfig.runProfile,
      run_id: roundResult.runId,
      search_provider: providerSelection.provider,
      search_provider_reason: providerSelection.reason_code || null,
      search_provider_used_paid_rescue: Boolean(providerSelection.use_paid_rescue),
      validated: progress.validated,
      missing_required_count: progress.missingRequiredCount,
      critical_missing_count: progress.criticalCount,
      contradiction_count: progress.contradictionCount,
      confidence: progress.confidence,
      llm_budget_blocked_reason: budgetBlockedReason || null,
      availability_effort: availabilityEffort,
      contract_effort: contractEffort,
      improved: delta.improved,
      improvement_reasons: delta.reasons
    });

    if (isCompleted(roundResult.summary)) {
      completed = true;
      stopReason = 'complete';
      break;
    }

    if (budgetExceeded && round >= 1) {
      exhausted = true;
      needsManual = true;
      stopReason = 'budget_exhausted';
      break;
    }

    const requiredSearchStop = evaluateRequiredSearchExhaustion({
      round,
      missingRequiredCount: progress.missingRequiredCount,
      noNewUrlsRounds,
      noNewFieldsRounds,
      threshold: Math.max(1, toInt(config.requiredSearchExhaustionThreshold, 2))
    });
    if (requiredSearchStop.stop) {
      exhausted = true;
      stopReason = requiredSearchStop.reason;
      break;
    }

    const stopDecision = evaluateSearchLoopStop({
      noNewUrlsRounds,
      noNewFieldsRounds,
      budgetReached: false,
      repeatedLowQualityRounds: lowQualityRounds,
      maxNoProgressRounds: (availabilityEffort.expected_count || 0) > 0 ? 3 : 2,
      maxLowQualityRounds: 3
    });

    const noProgressLimit = (availabilityEffort.expected_count || 0) > 0 ? 3 : 2;
    if (stopDecision.stop || noProgressStreak >= noProgressLimit) {
      const expectedRetryDecision = shouldForceExpectedFieldRetry({
        summary: roundResult.summary,
        categoryConfig,
        fieldAvailabilityArtifact,
        overrideCount: expectedRetryOverrideCount
      });
      if (expectedRetryDecision.force) {
        expectedRetryOverrideCount += 1;
        forcedExpectedRetryFields = expectedRetryDecision.fields;
        noProgressStreak = 0;
        noNewFieldsRounds = 0;
        if (round + 1 >= roundsLimit) {
          roundsLimit = normalizedRoundCount(roundsLimit + 1, 12);
        }
        logger.info('expected_retry_forced', {
          round,
          fields: expectedRetryDecision.fields
        });
        previousSummary = roundResult.summary;
        previousProgress = progress;
        continue;
      }
      exhausted = true;
      stopReason = stopDecision.stop ? stopDecision.reason : `no_progress_${noProgressLimit}_rounds`;
      break;
    }

    previousSummary = roundResult.summary;
    previousProgress = progress;
  }

  if (!completed && !exhausted && rounds.length >= roundsLimit) {
    exhausted = true;
    stopReason = 'max_rounds_reached';
  }

  if (finalResult) {
    const finalStatus = completed
      ? 'complete'
      : needsManual
        ? 'needs_manual'
        : exhausted
          ? 'exhausted'
          : 'running';
    await upsertQueueProduct({
      storage,
      category,
      productId,
      s3key,
      patch: {
        status: finalStatus,
        next_action_hint: completed ? 'none' : 'manual_or_retry'
      }
    });
    logger.info('queue_transition', {
      from: 'running',
      to: finalStatus,
      reason: stopReason || (completed ? 'complete' : 'stopped')
    });
  }

  await logger.flush();

  return {
    s3key,
    productId,
    category,
    mode: normalizedModeValue,
    max_rounds: roundsLimit,
    round_count: rounds.length,
    complete: completed,
    exhausted,
    needs_manual: needsManual,
    stop_reason: stopReason || null,
    final_run_id: finalResult?.runId || null,
    final_summary: finalResult?.summary || null,
    rounds
  };
}
