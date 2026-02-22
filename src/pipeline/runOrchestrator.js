import { planEscalationQueries } from '../discovery/escalationPlanner.js';
import { validateRoundSummary } from './summaryContract.js';

function normalizeMode(value) {
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
  return 'balanced';
}

function clampRound(value) {
  const parsed = Number.parseInt(String(value ?? 0), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function buildRoundContext({
  round = 0,
  mode = 'balanced',
  forceVerifyLlm = false,
  missingRequiredFields = [],
  missingCriticalFields = [],
  availability = {},
  contractEffort = {},
  extraQueries = [],
  llmTargetFields = [],
  escalatedFields = []
} = {}) {
  return {
    round: clampRound(round),
    mode: normalizeMode(mode),
    force_verify_llm: Boolean(forceVerifyLlm),
    missing_required_fields: Array.isArray(missingRequiredFields) ? missingRequiredFields : [],
    missing_critical_fields: Array.isArray(missingCriticalFields) ? missingCriticalFields : [],
    availability: availability && typeof availability === 'object' ? availability : {},
    contract_effort: contractEffort && typeof contractEffort === 'object' ? contractEffort : {},
    extra_queries: Array.isArray(extraQueries) ? extraQueries : [],
    llm_target_fields: Array.isArray(llmTargetFields) ? llmTargetFields : [],
    escalated_fields: Array.isArray(escalatedFields) ? escalatedFields : []
  };
}

export function evaluateRoundProgress({ previous = null, current = {} } = {}) {
  if (!previous) {
    return { improved: true, reasons: ['first_round'] };
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

export function evaluateStopConditions({
  completed = false,
  budgetExceeded = false,
  round = 0,
  roundsLimit = 4,
  roundsCompleted = 0,
  noProgressStreak = 0,
  noProgressLimit = 3,
  lowQualityRounds = 0,
  maxLowQualityRounds = 3,
  identityStuckRounds = 0,
  identityFailFastRounds = 1
} = {}) {
  if (completed) {
    return { stop: true, reason: 'complete' };
  }
  if (budgetExceeded && round >= 1) {
    return { stop: true, reason: 'budget_exhausted' };
  }
  if (roundsCompleted >= roundsLimit) {
    return { stop: true, reason: 'max_rounds_reached' };
  }
  if (identityFailFastRounds > 0 && identityStuckRounds >= identityFailFastRounds) {
    return { stop: true, reason: 'identity_gate_stuck' };
  }
  if (noProgressStreak >= noProgressLimit && noProgressLimit > 0) {
    return { stop: true, reason: `no_progress_${noProgressLimit}_rounds` };
  }
  if (lowQualityRounds >= maxLowQualityRounds && maxLowQualityRounds > 0) {
    return { stop: true, reason: 'repeated_low_quality' };
  }
  return { stop: false, reason: null };
}

export async function orchestrateRound({
  runProductFn,
  storage,
  config,
  s3Key,
  jobOverride,
  roundContext
}) {
  return runProductFn({
    storage,
    config,
    s3Key,
    jobOverride,
    roundContext
  });
}

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toFloat(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

export function summarizeRoundProgress(summary) {
  const s = summary && typeof summary === 'object' ? summary : {};
  return {
    missingRequiredCount: toArray(s.missing_required_fields).length,
    criticalCount: toArray(s.critical_fields_below_pass_target).length,
    contradictionCount: toInt(s.constraint_analysis?.contradiction_count, 0),
    confidence: toFloat(s.confidence, 0),
    validated: Boolean(s.validated)
  };
}

function isCompleted(summary) {
  const s = summary && typeof summary === 'object' ? summary : {};
  const missingRequired = toArray(s.missing_required_fields).length;
  const criticalBelow = toArray(s.critical_fields_below_pass_target).length;
  return Boolean(s.validated) && missingRequired === 0 && criticalBelow === 0;
}

function compactIdentity(identityLock = {}) {
  return [
    String(identityLock?.brand || '').trim(),
    String(identityLock?.model || '').trim(),
    String(identityLock?.variant || '').trim()
  ].filter(Boolean).join(' ').trim();
}

function humanizeFieldKey(key) {
  return String(key || '')
    .replace(/^fields\./, '')
    .replace(/[_-]+/g, ' ')
    .trim();
}

export function buildNeedSetDispatch({
  needSet = {},
  identityLock = {},
  previousTargetFields = [],
  maxQueries = 20,
  maxTargetFields = 30
} = {}) {
  const needs = toArray(needSet?.needs);
  if (needs.length === 0) {
    return { llmTargetFields: [], extraQueries: [], escalatedFields: [] };
  }

  const product = compactIdentity(identityLock);
  const previousSet = new Set(previousTargetFields.map((f) => String(f || '').trim().toLowerCase()));

  const sorted = [...needs].sort((a, b) => (b.need_score || 0) - (a.need_score || 0));

  const llmTargetFields = sorted
    .filter((n) => n.required_level !== 'optional' || n.need_score >= 2)
    .map((n) => n.field_key)
    .slice(0, maxTargetFields);

  const escalatedFields = llmTargetFields
    .filter((f) => previousSet.has(f.toLowerCase()));

  const queries = [];
  const seen = new Set();
  const pushQuery = (q, targetFields = []) => {
    const trimmed = q.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) return;
    seen.add(trimmed.toLowerCase());
    queries.push({ query: trimmed, target_fields: targetFields });
  };

  const tierDeficitFields = sorted.filter((n) =>
    toArray(n.reasons).includes('tier_pref_unmet')
  );
  const conflictFields = sorted.filter((n) =>
    toArray(n.reasons).includes('conflict')
  );

  if (product && tierDeficitFields.length > 0) {
    const tierFields = tierDeficitFields.slice(0, 5).map((n) => n.field_key);
    pushQuery(`${product} specifications`, tierFields);
    pushQuery(`${product} spec sheet`, tierFields);
    pushQuery(`${product} datasheet`, tierFields);
    pushQuery(`${product} manual pdf`, tierFields);
    pushQuery(`${product} official specs`, tierFields);
    for (const n of tierDeficitFields.slice(0, 5)) {
      const humanField = humanizeFieldKey(n.field_key);
      if (humanField) {
        pushQuery(`${product} ${humanField} specification`, [n.field_key]);
      }
    }
  }

  if (product && conflictFields.length > 0) {
    const confFields = conflictFields.slice(0, 3).map((n) => n.field_key);
    pushQuery(`${product} review`, confFields);
    pushQuery(`${product} teardown`, confFields);
    pushQuery(`${product} test results`, confFields);
    pushQuery(`${product} detailed review`, confFields);
    for (const n of conflictFields.slice(0, 3)) {
      const humanField = humanizeFieldKey(n.field_key);
      if (humanField) {
        pushQuery(`${product} ${humanField} review test`, [n.field_key]);
      }
    }
  }

  if (product) {
    const missingHighPriority = sorted
      .filter((n) => toArray(n.reasons).includes('missing') && n.need_score >= 4)
      .slice(0, 4);
    for (const n of missingHighPriority) {
      const humanField = humanizeFieldKey(n.field_key);
      if (humanField) {
        pushQuery(`${product} ${humanField}`, [n.field_key]);
      }
    }
  }

  return {
    llmTargetFields,
    extraQueries: queries.slice(0, maxQueries),
    escalatedFields
  };
}

const DEFAULT_NO_PROGRESS_LIMIT = 3;

function noopLogger() {
  return { info() {} };
}

export async function runConvergenceLoop({
  runProductFn,
  computeNeedSetFn,
  storage,
  config,
  s3Key,
  job = {},
  maxRounds,
  mode = 'balanced',
  logger = null
}) {
  const log = logger || noopLogger();
  const normalizedModeValue = normalizeMode(mode);
  const roundsLimit = Math.max(1, Math.min(12, toInt(maxRounds ?? config?.convergenceMaxRounds, 5)));
  const rounds = [];
  let previousProgress = null;
  let previousSummary = null;
  let previousRoundResult = null;
  let previousTargetFields = [];
  let noProgressStreak = 0;
  let lowQualityRounds = 0;
  let finalResult = null;
  let completed = false;
  let stopReason = null;
  let lastNeedSetSize = 0;
  let identityStuckRounds = 0;
  let previousIdentityCertainty = 0;
  const identityFailFastLimit = toInt(config?.convergenceIdentityFailFastRounds, 1);
  const identityPublishThreshold = toFloat(config?.identityGatePublishThreshold, 0.70);
  const allTimeQueries = new Set();

  for (let round = 0; round < roundsLimit; round += 1) {
    let llmTargetFields = [];
    let extraQueries = [];
    let escalatedFields = [];
    let missingRequired = [];
    let missingCritical = [];
    let needSetSize = 0;
    let queriesDedupedCount = 0;

    if (round > 0 && previousSummary) {
      missingRequired = toArray(previousSummary.missing_required_fields);
      missingCritical = toArray(previousSummary.critical_fields_below_pass_target);

      const needSet = computeNeedSetFn({
        provenance: previousRoundResult?.provenance || previousSummary.provenance || {},
        fieldRules: previousSummary.fieldRules || job.fieldRules || {},
        fieldOrder: previousSummary.fieldOrder || job.fieldOrder || [],
        fieldReasoning: previousSummary.field_reasoning || previousSummary.fieldReasoning || {},
        constraintAnalysis: previousSummary.constraint_analysis || {},
        identityContext: previousSummary.identityContext || {}
      });

      const dispatch = buildNeedSetDispatch({
        needSet,
        identityLock: job.identityLock || {},
        previousTargetFields,
        maxQueries: toInt(config?.convergenceMaxDispatchQueries, 20),
        maxTargetFields: toInt(config?.convergenceMaxTargetFields, 30)
      });

      llmTargetFields = dispatch.llmTargetFields;
      extraQueries = dispatch.extraQueries;
      escalatedFields = dispatch.escalatedFields;
      needSetSize = toArray(needSet?.needs).length;

      if (escalatedFields.length > 0 && config.llmEnabled) {
        try {
          const escalationQueries = await planEscalationQueries({
            missingFields: escalatedFields,
            product: {
              brand: job.identityLock?.brand || '',
              model: job.identityLock?.model || '',
              variant: job.identityLock?.variant || '',
              category: job.category || ''
            },
            previousQueries: extraQueries.map(q => q.query || q),
            config,
            callLlmFn: job._escalationCallLlmFn || null
          });
          for (const eq of escalationQueries) {
            extraQueries.push(eq);
          }
        } catch {
          // escalation planning is non-essential
        }
      }

      const beforeDedup = extraQueries.length;
      extraQueries = extraQueries.filter((q) => {
        const key = String(typeof q === 'object' ? q.query : q || '').trim().toLowerCase();
        return key && !allTimeQueries.has(key);
      });
      for (const q of extraQueries) {
        const key = String(typeof q === 'object' ? q.query : q || '').trim().toLowerCase();
        if (key) allTimeQueries.add(key);
      }
      queriesDedupedCount = beforeDedup - extraQueries.length;
    }

    log.info('convergence_round_started', {
      round,
      mode: normalizedModeValue,
      needset_size: needSetSize,
      llm_target_field_count: llmTargetFields.length,
      extra_query_count: extraQueries.length,
      escalated_field_count: escalatedFields.length,
      queries_deduped_count: queriesDedupedCount
    });

    const roundContext = buildRoundContext({
      round,
      mode: normalizedModeValue,
      forceVerifyLlm: round > 0 && missingRequired.length > 0,
      missingRequiredFields: missingRequired,
      missingCriticalFields: missingCritical,
      extraQueries,
      llmTargetFields,
      escalatedFields
    });

    const roundResult = await orchestrateRound({
      runProductFn,
      storage,
      config,
      s3Key,
      roundContext
    });

    finalResult = roundResult;
    const summaryValidation = validateRoundSummary(roundResult.summary);
    if (summaryValidation.warnings.length > 0) {
      log.info('summary_contract_warnings', {
        round,
        valid: summaryValidation.valid,
        warnings: summaryValidation.warnings
      });
    }
    const currentProgress = summarizeRoundProgress(roundResult.summary);

    const delta = evaluateRoundProgress({
      previous: previousProgress,
      current: currentProgress
    });

    if (delta.improved) {
      noProgressStreak = 0;
    } else {
      noProgressStreak += 1;
    }

    const sourcesIdentityMatched = toInt(roundResult.summary?.sources_identity_matched, 0);
    if (sourcesIdentityMatched === 0 || currentProgress.confidence < toFloat(config?.convergenceLowQualityConfidence, 0.2)) {
      lowQualityRounds += 1;
    } else {
      lowQualityRounds = 0;
    }

    const rawIdentityCertainty = roundResult.summary?.identity_confidence;
    const hasIdentityData = rawIdentityCertainty !== undefined && rawIdentityCertainty !== null;
    const currentIdentityCertainty = toFloat(rawIdentityCertainty, 0);
    if (hasIdentityData && currentIdentityCertainty < identityPublishThreshold) {
      const improvement = currentIdentityCertainty - previousIdentityCertainty;
      if (improvement < 0.05) {
        identityStuckRounds += 1;
      } else {
        identityStuckRounds = 0;
      }
    } else if (hasIdentityData) {
      identityStuckRounds = 0;
    }
    if (hasIdentityData) {
      previousIdentityCertainty = currentIdentityCertainty;
    }

    lastNeedSetSize = needSetSize;

    log.info('convergence_round_completed', {
      round,
      run_id: roundResult.runId || null,
      needset_size: needSetSize,
      missing_required_count: currentProgress.missingRequiredCount,
      critical_count: currentProgress.criticalCount,
      confidence: currentProgress.confidence,
      validated: currentProgress.validated,
      improved: delta.improved,
      improvement_reasons: delta.reasons,
      no_progress_streak: noProgressStreak,
      low_quality_rounds: lowQualityRounds
    });

    rounds.push({
      round,
      run_id: roundResult.runId || null,
      missing_required_count: currentProgress.missingRequiredCount,
      critical_count: currentProgress.criticalCount,
      confidence: currentProgress.confidence,
      validated: currentProgress.validated,
      improved: delta.improved,
      improvement_reasons: delta.reasons
    });

    if (isCompleted(roundResult.summary)) {
      completed = true;
      stopReason = 'complete';
      break;
    }

    const noProgressLimit = toInt(config?.convergenceNoProgressLimit, DEFAULT_NO_PROGRESS_LIMIT);
    const stopCheck = evaluateStopConditions({
      completed: false,
      round,
      roundsLimit,
      roundsCompleted: round + 1,
      noProgressStreak,
      noProgressLimit,
      lowQualityRounds,
      maxLowQualityRounds: toInt(config?.convergenceMaxLowQualityRounds, 3),
      identityStuckRounds,
      identityFailFastRounds: identityFailFastLimit
    });

    if (stopCheck.stop) {
      stopReason = stopCheck.reason;
      break;
    }

    previousRoundResult = roundResult;
    previousSummary = roundResult.summary || {};
    previousProgress = currentProgress;
    previousTargetFields = llmTargetFields;
  }

  if (!completed && !stopReason && rounds.length >= roundsLimit) {
    stopReason = 'max_rounds_reached';
  }

  log.info('convergence_stop', {
    stop_reason: stopReason || null,
    round_count: rounds.length,
    complete: completed,
    final_confidence: finalResult?.summary?.confidence || 0,
    final_needset_size: lastNeedSetSize
  });

  return {
    s3Key,
    category: job.category || '',
    product_id: job.productId || '',
    mode: normalizedModeValue,
    max_rounds: roundsLimit,
    round_count: rounds.length,
    complete: completed,
    stop_reason: stopReason || null,
    final_run_id: finalResult?.runId || null,
    final_summary: finalResult?.summary || null,
    final_result: finalResult || null,
    rounds
  };
}

export function validateAndMigrateKeys({ data, migrationMap, knownKeys }) {
  const input = data && typeof data === 'object' ? data : {};
  const map = migrationMap && typeof migrationMap === 'object' ? migrationMap : {};
  const known = knownKeys instanceof Set ? knownKeys : new Set();

  const migrated = {};
  const unknown = [];
  const migratedKeys = [];

  for (const [key, value] of Object.entries(input)) {
    if (map[key]) {
      const newKey = map[key];
      migrated[newKey] = value;
      migratedKeys.push({ from: key, to: newKey });
    } else if (known.has(key)) {
      migrated[key] = value;
    } else {
      unknown.push(key);
    }
  }

  return { migrated, unknown, migratedKeys };
}

export function bridgeAsLogger(bridge) {
  return {
    info(event, payload = {}) {
      const runId = bridge.runId || '';
      bridge.onRuntimeEvent({ event, runId, ...payload, ts: new Date().toISOString() });
    }
  };
}
