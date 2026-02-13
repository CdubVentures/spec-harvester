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

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizedMode(value, fallback = 'balanced') {
  const token = String(value || '').trim().toLowerCase();
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
  const fields = [...new Set([
    ...(expectedFields || []),
    ...(criticalFields || [])
  ])];
  const queries = [];
  for (const field of fields.slice(0, 8)) {
    queries.push(`${product} ${field} specification`);
    queries.push(`${product} ${field} support`);
    queries.push(`${product} ${field} manual pdf`);
  }
  for (const field of (sometimesFields || []).slice(0, 4)) {
    queries.push(`${product} ${field} specs`);
  }
  return [...new Set(queries.map((query) => query.trim()).filter(Boolean))].slice(0, 24);
}

function normalizeFieldContractToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^fields\./, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function readRuleToken(rule = {}, key) {
  const direct = rule?.[key];
  if (direct !== undefined && direct !== null && String(direct).trim() !== '') {
    return direct;
  }
  const nested = rule?.priority?.[key];
  return nested !== undefined ? nested : '';
}

function inferRuleEffort(rule = {}) {
  const effortRaw = Number.parseFloat(String(readRuleToken(rule, 'effort') || ''));
  if (Number.isFinite(effortRaw) && effortRaw > 0) {
    return effortRaw;
  }
  const difficulty = String(readRuleToken(rule, 'difficulty') || '').trim().toLowerCase();
  if (difficulty === 'hard') {
    return 8;
  }
  if (difficulty === 'medium') {
    return 5;
  }
  if (difficulty === 'easy') {
    return 2;
  }
  return 3;
}

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
    const requiredLevel = String(readRuleToken(rule, 'required_level') || '').trim().toLowerCase();
    const availability = String(readRuleToken(rule, 'availability') || '').trim().toLowerCase();
    const difficulty = String(readRuleToken(rule, 'difficulty') || '').trim().toLowerCase();
    const effort = inferRuleEffort(rule);
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
      effort
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
  missingRequiredCount = 0
}) {
  if (!discoveryEnabled) {
    return 'none';
  }

  const configured = String(baseConfig.searchProvider || 'none').trim().toLowerCase();
  const bingReady = Boolean(baseConfig.bingSearchEndpoint && baseConfig.bingSearchKey);
  const googleReady = Boolean(baseConfig.googleCseKey && baseConfig.googleCseCx);
  const searxngReady = Boolean(baseConfig.searxngBaseUrl);

  if (configured === 'bing') {
    return bingReady ? 'bing' : (searxngReady ? 'searxng' : 'none');
  }
  if (configured === 'google') {
    return googleReady ? 'google' : (searxngReady ? 'searxng' : 'none');
  }
  if (configured === 'dual') {
    if (bingReady || googleReady) {
      return 'dual';
    }
    return searxngReady ? 'searxng' : 'none';
  }
  if (configured === 'searxng') {
    return searxngReady ? 'searxng' : 'none';
  }

  if (missingRequiredCount > 0) {
    if ((bingReady || googleReady) && searxngReady) {
      return 'dual';
    }
    if (bingReady && googleReady) {
      return 'dual';
    }
    if (bingReady) {
      return 'bing';
    }
    if (googleReady) {
      return 'google';
    }
    if (searxngReady) {
      return 'searxng';
    }
  } else if (searxngReady) {
    return 'searxng';
  }
  return 'none';
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
  requiredSearchIteration
} = {}) {
  const expectedCount = toInt(availabilityEffort.expected_count, 0);
  const sometimesCount = toInt(availabilityEffort.sometimes_count, 0);
  const rareCount = toInt(availabilityEffort.rare_count, 0);
  const resolvedMissingRequired = toInt(missingRequiredCount, toInt(availabilityEffort.required_count, 0));
  const resolvedMissingExpected = toInt(missingExpectedCount, expectedCount);
  const requiredIteration = toInt(requiredSearchIteration, 0);
  const hasExplicitMissingCounts =
    missingRequiredCount !== undefined ||
    missingExpectedCount !== undefined;
  const profile = round === 0
    ? 'fast'
    : round >= 2 || mode === 'aggressive'
      ? 'thorough'
      : 'standard';
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
          : (round >= 2 ? Math.max(baseConfig.maxUrlsPerProduct || 20, 160) : Math.max(baseConfig.maxUrlsPerProduct || 20, 60)),
      maxCandidateUrls:
        round === 0
          ? Math.min(baseConfig.maxCandidateUrls || 50, 40)
          : (round >= 2 ? Math.max(baseConfig.maxCandidateUrls || 50, 220) : Math.max(baseConfig.maxCandidateUrls || 50, 90))
    },
    profile
  );

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
      if (resolvedMissingRequired === 0 && resolvedMissingExpected === 0) {
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
    next.searchProvider = selectRoundSearchProvider({
      baseConfig,
      discoveryEnabled,
      missingRequiredCount: resolvedMissingRequired
    });
    if (!discoveryEnabled) {
      next.searchProvider = 'none';
    }
  }

  if (hasExplicitMissingCounts && round > 0 && resolvedMissingRequired === 0 && resolvedMissingExpected === 0) {
    next.maxUrlsPerProduct = Math.min(next.maxUrlsPerProduct || 60, 48);
    next.maxCandidateUrls = Math.min(next.maxCandidateUrls || 90, 48);
    next.maxManufacturerUrlsPerProduct = Math.min(next.maxManufacturerUrlsPerProduct || 24, 24);
    next.manufacturerBroadDiscovery = false;
  } else if (next.maxManufacturerUrlsPerProduct === undefined) {
    next.maxManufacturerUrlsPerProduct = Math.max(12, Math.min(next.maxUrlsPerProduct || 24, 24));
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

function makeLlmTargetFields({ previousSummary, categoryConfig }) {
  if (!previousSummary) {
    return [
      ...new Set([
        ...(categoryConfig.requiredFields || []),
        ...(categoryConfig.schema?.critical_fields || [])
      ])
    ];
  }

  const missing = toArray(previousSummary.missing_required_fields);
  const critical = toArray(previousSummary.critical_fields_below_pass_target);
  const contradictions = toArray(previousSummary.constraint_analysis?.top_uncertain_fields || [])
    .map((item) => item.field)
    .filter(Boolean);
  const combined = [...new Set([...missing, ...critical, ...contradictions])];
  if (combined.length) {
    return combined;
  }
  return [
    ...new Set([
      ...(categoryConfig.requiredFields || []),
      ...(categoryConfig.schema?.critical_fields || [])
    ])
  ];
}

export function buildRoundRequirements(job, llmTargetFields, previousSummary) {
  const requirements = {
    ...(job.requirements || {})
  };
  requirements.llmTargetFields = llmTargetFields;
  requirements.requiredFields = [
    ...new Set([
      ...toArray(job.requirements?.requiredFields),
      ...toArray(previousSummary?.missing_required_fields)
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
  let roundsLimit = normalizedRoundCount(maxRounds, normalizedModeValue === 'aggressive' ? 8 : 4);
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

    const missingRequiredForPlanning = normalizeFieldList(
      previousSummary?.missing_required_fields || categoryConfig.requiredFields || [],
      { fieldOrder: categoryConfig.fieldOrder || [] }
    );
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
      requiredSearchIteration
    });
    let llmTargetFields = makeLlmTargetFields({
      previousSummary,
      categoryConfig
    });
    if (forcedExpectedRetryFields.length > 0) {
      llmTargetFields = [...new Set([...llmTargetFields, ...forcedExpectedRetryFields])];
      forcedExpectedRetryFields = [];
    }
    const jobOverride = buildRoundRequirements(job, llmTargetFields, previousSummary);

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
        llm_target_fields: llmTargetFields
      }
    });
    finalResult = roundResult;
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
