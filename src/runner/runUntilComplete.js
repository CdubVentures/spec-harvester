import { runProduct } from '../pipeline/runProduct.js';
import { applyRunProfile } from '../config.js';
import { loadCategoryConfig } from '../categories/loader.js';
import { evaluateSearchLoopStop } from '../search/searchLoop.js';
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

function buildRoundConfig(baseConfig, { round, mode }) {
  const profile = round === 0
    ? 'fast'
    : round >= 2 || mode === 'aggressive'
      ? 'thorough'
      : 'standard';
  const next = applyRunProfile(
    {
      ...baseConfig,
      runProfile: profile,
      discoveryEnabled: true,
      fetchCandidateSources: round > 0,
      manufacturerBroadDiscovery: round >= 2 || Boolean(baseConfig.manufacturerBroadDiscovery),
      searchProvider:
        round === 0
          ? (baseConfig.searchProvider === 'none' ? 'none' : baseConfig.searchProvider)
          : (baseConfig.searchProvider === 'none' ? 'dual' : baseConfig.searchProvider),
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

function withRoundRequirements(job, llmTargetFields, previousSummary) {
  const requirements = {
    ...(job.requirements || {})
  };
  requirements.llmTargetFields = llmTargetFields;
  if (previousSummary) {
    requirements.requiredFields = [
      ...new Set([
        ...toArray(previousSummary.missing_required_fields),
        ...toArray(job.requirements?.requiredFields)
      ])
    ];
  }
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

  const categoryConfig = await loadCategoryConfig(category, { storage, config });
  const normalizedModeValue = normalizedMode(mode, config.accuracyMode || 'balanced');
  const roundsLimit = normalizedRoundCount(maxRounds, normalizedModeValue === 'aggressive' ? 8 : 4);
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

  for (let round = 0; round < roundsLimit; round += 1) {
    const roundHint = makeRoundHint(round);
    await markQueueRunning({
      storage,
      category,
      productId,
      s3key,
      nextActionHint: roundHint
    });

    const roundConfig = buildRoundConfig(config, {
      round,
      mode: normalizedModeValue
    });
    const llmTargetFields = makeLlmTargetFields({
      previousSummary,
      categoryConfig
    });
    const jobOverride = withRoundRequirements(job, llmTargetFields, previousSummary);

    const roundResult = await runProduct({
      storage,
      config: roundConfig,
      s3Key: s3key,
      jobOverride,
      roundContext: {
        round,
        mode: normalizedModeValue,
        llm_target_fields: llmTargetFields
      }
    });
    finalResult = roundResult;

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

    const stopDecision = evaluateSearchLoopStop({
      noNewUrlsRounds,
      noNewFieldsRounds,
      budgetReached: false,
      repeatedLowQualityRounds: lowQualityRounds,
      maxNoProgressRounds: 2,
      maxLowQualityRounds: 3
    });

    if (stopDecision.stop || noProgressStreak >= 2) {
      exhausted = true;
      stopReason = stopDecision.stop ? stopDecision.reason : 'no_progress_two_rounds';
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
  }

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
