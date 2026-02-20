function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function missingCount(summary = {}) {
  return {
    required: toArray(summary.missing_required_fields).length,
    expected: toArray(summary.missing_expected_fields).length,
    critical: toArray(summary.critical_fields_below_pass_target).length
  };
}

export function resolveDeepeningTier({
  round = 0,
  mode = 'balanced',
  previousSummary = {},
  noProgressRounds = 0
} = {}) {
  const missing = missingCount(previousSummary || {});
  const normalizedMode = String(mode || '').trim().toLowerCase();
  if (normalizedMode !== 'uber_aggressive') {
    if (round === 0) return 'tier0';
    if (round <= 2) return 'tier1';
    return 'tier2';
  }

  if (round === 0) return 'tier0';
  if (missing.required > 0 || missing.critical > 0) {
    if (round >= 3 && noProgressRounds >= 2) {
      return 'tier3';
    }
    return round >= 2 ? 'tier2' : 'tier1';
  }
  if (missing.expected > 0 && round >= 2) {
    return 'tier2';
  }
  return round >= 4 ? 'tier2' : 'tier1';
}

export function uberStopDecision({
  summary = {},
  round = 0,
  maxRounds = 8,
  noNewHighYieldRounds = 0,
  noNewFieldsRounds = 0,
  elapsedMs = 0,
  maxMs = 0
} = {}) {
  const missing = missingCount(summary || {});
  if (missing.required === 0 && missing.critical === 0) {
    return { stop: true, reason: 'required_and_critical_satisfied' };
  }
  if (maxMs > 0 && elapsedMs >= maxMs) {
    return { stop: true, reason: 'time_budget_exceeded' };
  }
  if (round + 1 >= Math.max(1, toInt(maxRounds, 8))) {
    return { stop: true, reason: 'max_rounds_reached' };
  }
  if (noNewHighYieldRounds >= 2 && noNewFieldsRounds >= 2) {
    return { stop: true, reason: 'diminishing_returns' };
  }
  return { stop: false, reason: 'continue' };
}
