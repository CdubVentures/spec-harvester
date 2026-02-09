function toPercent(value) {
  return Number.parseFloat((value * 100).toFixed(2));
}

export function evaluateValidationGate({
  identityConfidence,
  anchorMajorConflictsCount,
  completenessRequired,
  targetCompleteness,
  confidence,
  targetConfidence,
  criticalFieldsBelowPassTarget
}) {
  const criticalMissing = criticalFieldsBelowPassTarget || [];

  const checks = {
    identity_confidence_ok: identityConfidence >= 0.99,
    anchor_conflicts_ok: anchorMajorConflictsCount === 0,
    required_completeness_ok: completenessRequired >= targetCompleteness,
    confidence_ok: confidence >= targetConfidence,
    critical_fields_ok: criticalMissing.length === 0
  };

  const reasons = [];
  if (!checks.identity_confidence_ok) {
    reasons.push('MODEL_AMBIGUITY_ALERT');
  }
  if (!checks.anchor_conflicts_ok) {
    reasons.push('ANCHOR_CONFLICT_ALERT');
  }
  if (!checks.required_completeness_ok) {
    reasons.push('BELOW_REQUIRED_COMPLETENESS');
  }
  if (!checks.confidence_ok) {
    reasons.push('BELOW_CONFIDENCE_THRESHOLD');
  }
  if (!checks.critical_fields_ok) {
    reasons.push('CRITICAL_FIELDS_BELOW_PASS_TARGET');
  }

  return {
    validated: reasons.length === 0,
    validatedReason: reasons.length === 0 ? 'OK' : reasons[0],
    reasons,
    checks,
    targetCompleteness,
    targetConfidence,
    completenessRequiredPercent: toPercent(completenessRequired),
    coverageOverallPercent: null,
    confidencePercent: toPercent(confidence)
  };
}
