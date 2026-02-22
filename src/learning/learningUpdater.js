export function evaluateLearningGate({
  field,
  confidence,
  refsFound,
  minRefs,
  fieldStatus,
  tierHistory,
  componentRef,
  componentReviewStatus,
  config
}) {
  const threshold = config?.learningConfidenceThreshold ?? 0.85;
  const requiredRefs = minRefs ?? 2;

  if (confidence < threshold) return { accepted: false, reason: 'confidence_below_threshold' };
  if (refsFound < requiredRefs) return { accepted: false, reason: 'evidence_refs_insufficient' };
  if (fieldStatus !== 'accepted') return { accepted: false, reason: 'field_not_accepted' };

  const hasTier1or2 = (tierHistory || []).some((t) => t <= 2);
  if (!hasTier1or2) return { accepted: false, reason: 'tier_criteria_not_met' };

  if (componentRef && componentReviewStatus !== 'accepted') {
    return { accepted: false, reason: 'component_not_accepted' };
  }

  return { accepted: true, reason: null };
}
