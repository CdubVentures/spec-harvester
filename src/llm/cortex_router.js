function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const token = String(value).trim().toLowerCase();
  return token === '1' || token === 'true' || token === 'yes' || token === 'on';
}

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toFloat(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeTask(task = {}, index = 0) {
  return {
    id: String(task.id || `task-${index + 1}`),
    type: String(task.type || 'generic'),
    critical: Boolean(task.critical),
    payload: task.payload || {}
  };
}

export function shouldEscalateToDeep({ context = {}, config = {} } = {}) {
  const confidence = toFloat(context.confidence, 1);
  const threshold = toFloat(config.cortexEscalateConfidenceLt, 0.85);
  const conflictEnabled = toBool(config.cortexEscalateIfConflict, true);
  const hasCriticalConflict = conflictEnabled && Boolean(context.critical_conflicts_remain);
  const hasCriticalGap = Boolean(context.critical_gaps_remain);
  const hasAuditFailure = Boolean(context.evidence_audit_failed_on_critical);
  const lowConfidence = confidence < threshold;
  const escalate = hasCriticalConflict || hasCriticalGap || hasAuditFailure || lowConfidence;
  return {
    escalate,
    reasons: {
      has_critical_conflict: hasCriticalConflict,
      has_critical_gap: hasCriticalGap,
      has_audit_failure: hasAuditFailure,
      low_confidence: lowConfidence
    },
    threshold,
    confidence
  };
}

function isVisionTask(task) {
  const token = String(task.type || '').toLowerCase();
  return token.includes('vision') || token.includes('screenshot') || token.includes('image');
}

function prefersDeep(task) {
  const token = String(task.type || '').toLowerCase();
  return token.includes('deep') || token.includes('critical_gap') || token.includes('critical_conflict');
}

function modelForTask(task, tier, config = {}) {
  if (isVisionTask(task)) {
    return String(config.cortexModelVision || config.cortexModelReasoningDeep || 'gpt-5-high');
  }
  if (tier === 'deep') {
    return String(config.cortexModelReasoningDeep || 'gpt-5-high');
  }
  return String(config.cortexModelFast || 'gpt-5-low');
}

function transportForTier(tier) {
  return tier === 'deep' ? 'async' : 'sync';
}

export function buildCortexTaskPlan({ tasks = [], context = {}, config = {} } = {}) {
  const normalizedTasks = tasks.map((task, idx) => normalizeTask(task, idx));
  const deepCap = Math.max(0, toInt(config.cortexMaxDeepFieldsPerProduct, 12));
  const criticalOnly = toBool(config.cortexEscalateCriticalOnly, true);
  const escalation = shouldEscalateToDeep({ context, config });

  const assignments = [];
  let deepCount = 0;
  for (const task of normalizedTasks) {
    const alwaysDeep = isVisionTask(task);
    const eligibleForEscalation = alwaysDeep
      || prefersDeep(task)
      || (escalation.escalate && (!criticalOnly || task.critical));
    const canUseDeep = eligibleForEscalation && deepCount < deepCap;
    const tier = canUseDeep ? 'deep' : 'fast';
    if (tier === 'deep') {
      deepCount += 1;
    }

    assignments.push({
      ...task,
      tier,
      model: modelForTask(task, tier, config),
      transport: transportForTier(tier)
    });
  }

  const deepTasks = assignments.filter((row) => row.tier === 'deep');
  return {
    generated_at: new Date().toISOString(),
    escalated: deepTasks.length > 0,
    escalation,
    deep_cap: deepCap,
    deep_task_count: deepTasks.length,
    deep_task_ids: deepTasks.map((row) => row.id),
    assignments
  };
}
