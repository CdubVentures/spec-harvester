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
  maxLowQualityRounds = 3
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
