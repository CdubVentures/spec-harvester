const IDENTITY_GATED_FIELDS = new Set([
  'brand', 'model', 'variant', 'sku', 'base_model',
  'mpn', 'gtin', 'upc', 'ean', 'asin'
]);

export function isIdentityGatedField(field) {
  const token = String(field || '').trim().toLowerCase();
  if (!token) return false;
  return IDENTITY_GATED_FIELDS.has(token);
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function applyIdentityGateToCandidates(candidates, identity) {
  if (!Array.isArray(candidates)) return [];
  if (candidates.length === 0) return [];

  const hasIdentity = identity && typeof identity === 'object';
  const matched = hasIdentity ? Boolean(identity.match) : false;
  const matchScore = hasIdentity ? clamp01(Number(identity.score) || 0) : 0;
  const rejectReason = !hasIdentity
    ? 'no_identity_evaluation'
    : (!matched ? 'source_identity_mismatch' : null);

  return candidates.map((candidate) => {
    const originalConfidence = clamp01(Number(candidate.confidence) || 0);
    const gatedField = isIdentityGatedField(candidate.field);

    if (matched) {
      return {
        ...candidate,
        target_match_passed: true,
        target_match_score: matchScore
      };
    }

    const identityConfidenceCap = gatedField
      ? Math.min(matchScore * 0.5, 0.15)
      : matchScore;

    return {
      ...candidate,
      target_match_passed: false,
      target_match_score: matchScore,
      original_confidence: originalConfidence,
      confidence: Math.min(originalConfidence, identityConfidenceCap),
      identity_reject_reason: rejectReason
    };
  });
}
