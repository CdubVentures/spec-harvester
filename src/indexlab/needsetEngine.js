import {
  ruleMinEvidenceRefs,
  ruleRequiredLevel
} from '../engine/ruleAccessors.js';

const UNKNOWN_VALUE_TOKENS = new Set(['', 'unk', 'unknown', 'n/a', 'na', 'none', 'null', 'undefined']);

const REQUIRED_WEIGHT = {
  identity: 5,
  critical: 4,
  required: 2,
  expected: 1,
  optional: 1
};
const IDENTITY_GATED_LEVELS = new Set(['identity', 'critical', 'required']);
const DEFAULT_IDENTITY_AUDIT_LIMIT = 24;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function toNumber(value, fallback = null) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeRequiredLevel(value) {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'identity' || token === 'critical' || token === 'required' || token === 'expected') {
    return token;
  }
  return 'optional';
}

function hasKnownFieldValue(value) {
  return !UNKNOWN_VALUE_TOKENS.has(String(value ?? '').trim().toLowerCase());
}

function toTierNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Number.isFinite(Number(value))) {
    const n = Math.max(1, Math.floor(Number(value)));
    return n;
  }
  const token = String(value).trim().toLowerCase();
  if (!token) return null;
  const match = token.match(/tier\s*([1-9])/i);
  if (match) return Number.parseInt(match[1], 10);
  if (token.includes('manufacturer')) return 1;
  if (token.includes('lab') || token.includes('review')) return 2;
  if (token.includes('retailer')) return 3;
  if (token.includes('database') || token.includes('aggregator') || token.includes('community')) return 4;
  return null;
}

function parseTierPreference(rule = {}) {
  const evidence = isObject(rule.evidence) ? rule.evidence : {};
  const raw = Array.isArray(evidence.tier_preference) ? evidence.tier_preference : [];
  const out = [];
  for (const entry of raw) {
    const tier = toTierNumber(entry);
    if (tier && !out.includes(tier)) out.push(tier);
  }
  return out;
}

function countDistinctEvidenceRefs(evidenceRows = []) {
  const seen = new Set();
  for (const row of evidenceRows || []) {
    if (!isObject(row)) continue;
    const key = [
      String(row.url || '').trim(),
      String(row.keyPath || row.key_path || '').trim(),
      String(row.snippetId || row.snippet_id || row.id || '').trim()
    ].join('|');
    seen.add(key);
  }
  return seen.size;
}

function bestTierSeen(evidenceRows = []) {
  let best = null;
  for (const row of evidenceRows || []) {
    if (!isObject(row)) continue;
    const tier = toTierNumber(row.tier ?? row.tier_name ?? row.tierName);
    if (tier === null) continue;
    if (best === null || tier < best) {
      best = tier;
    }
  }
  return best;
}

function isFieldConflict(field, fieldReasoning = {}, constraintAnalysis = {}) {
  const reasoning = fieldReasoning?.[field] || {};
  if (Array.isArray(reasoning.reasons) && reasoning.reasons.includes('constraint_conflict')) {
    return true;
  }
  if (Array.isArray(reasoning.contradictions) && reasoning.contradictions.length > 0) {
    return true;
  }
  const contradictions = Array.isArray(constraintAnalysis?.contradictions)
    ? constraintAnalysis.contradictions
    : [];
  return contradictions.some((row) => Array.isArray(row?.fields) && row.fields.includes(field));
}

function collectFieldKeys({ fieldOrder = [], provenance = {}, fieldRules = {} }) {
  const out = [];
  const seen = new Set();
  const push = (value) => {
    const key = String(value || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  };
  for (const field of fieldOrder || []) push(field);
  for (const field of Object.keys(provenance || {})) push(field);
  const ruleRows = isObject(fieldRules?.fields) ? fieldRules.fields : fieldRules;
  for (const field of Object.keys(ruleRows || {})) push(field);
  return out;
}

function requiredLevelCountSeed() {
  return {
    identity: 0,
    critical: 0,
    required: 0,
    expected: 0,
    optional: 0
  };
}

function toIso(value, fallback = '') {
  const raw = String(value || '').trim();
  const ms = Date.parse(raw);
  if (Number.isFinite(ms)) {
    return new Date(ms).toISOString();
  }
  if (fallback) return fallback;
  return new Date().toISOString();
}

function normalizeReasonCode(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_');
}

function uniqueReasonCodes(values = []) {
  const out = [];
  const seen = new Set();
  for (const row of values || []) {
    const token = normalizeReasonCode(row);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

function normalizeIdentityState(input = {}) {
  const token = String(input?.status || '').trim().toLowerCase();
  if (token === 'locked' || token === 'provisional' || token === 'unlocked' || token === 'conflict') {
    return token;
  }
  const confidence = clamp01(toNumber(input?.confidence, 0));
  const gateValidated = Boolean(input?.identity_gate_validated);
  const reasonCodes = uniqueReasonCodes(input?.reason_codes || []);
  const hasConflictCode = reasonCodes.some((code) =>
    code.includes('conflict')
    || code.includes('mismatch')
    || code.includes('major_anchor')
  );
  if (gateValidated && confidence >= 0.99) {
    return 'locked';
  }
  if (hasConflictCode) {
    return 'conflict';
  }
  if (confidence >= 0.9) {
    return 'provisional';
  }
  return 'unlocked';
}

function normalizeAmbiguityLevel(value = '', familyModelCount = 0) {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'easy' || token === 'low') return 'easy';
  if (token === 'medium' || token === 'mid') return 'medium';
  if (token === 'hard' || token === 'high') return 'hard';
  if (token === 'very_hard' || token === 'very-hard' || token === 'very hard') return 'very_hard';
  if (token === 'extra_hard' || token === 'extra-hard' || token === 'extra hard') return 'extra_hard';
  const count = Math.max(0, Number.parseInt(String(familyModelCount || 0), 10) || 0);
  if (count >= 9) return 'extra_hard';
  if (count >= 6) return 'very_hard';
  if (count >= 4) return 'hard';
  if (count >= 2) return 'medium';
  if (count === 1) return 'easy';
  return 'unknown';
}

function confidenceCapForIdentityState(status = 'unlocked') {
  const token = String(status || '').trim().toLowerCase();
  if (token === 'locked') return 1;
  if (token === 'provisional') return 0.74;
  if (token === 'conflict') return 0.39;
  return 0.59;
}

function normalizeIdentityContext(identityContext = {}, now = '') {
  const normalizedNow = toIso(now);
  const reasonCodes = uniqueReasonCodes(identityContext.reason_codes || []);
  const publishBlockers = uniqueReasonCodes(identityContext.publish_blockers || []);
  const status = normalizeIdentityState({
    ...identityContext,
    reason_codes: reasonCodes
  });
  const confidence = clamp01(toNumber(identityContext.confidence, 0));
  const maxMatchScore = clamp01(toNumber(identityContext.max_match_score, confidence));
  const familyModelCount = Math.max(0, Number.parseInt(String(identityContext.family_model_count || 0), 10) || 0);
  const ambiguityLevel = normalizeAmbiguityLevel(identityContext.ambiguity_level, familyModelCount);
  const extractionGateOpen =
    Boolean(identityContext.extraction_gate_open)
    || status === 'locked';
  const auditRowsRaw = Array.isArray(identityContext.audit_rows) ? identityContext.audit_rows : [];
  const auditRows = auditRowsRaw
    .map((row, index) => ({
      source_id: String(row?.source_id || row?.sourceId || `source_${String(index + 1).padStart(3, '0')}`).trim(),
      url: String(row?.url || '').trim(),
      host: String(row?.host || '').trim(),
      decision: String(row?.decision || '').trim().toUpperCase(),
      confidence: clamp01(toNumber(row?.confidence, 0)),
      reason_codes: uniqueReasonCodes(row?.reason_codes || row?.reasonCodes || []),
      ts: toIso(row?.ts || row?.updated_at || normalizedNow, normalizedNow)
    }))
    .filter((row) => row.source_id || row.url)
    .slice(0, DEFAULT_IDENTITY_AUDIT_LIMIT);
  return {
    status,
    confidence,
    identity_gate_validated: Boolean(identityContext.identity_gate_validated),
    extraction_gate_open: extractionGateOpen,
    family_model_count: familyModelCount,
    ambiguity_level: ambiguityLevel,
    publishable: Boolean(identityContext.publishable),
    publish_blockers: publishBlockers,
    reason_codes: reasonCodes,
    page_count: Math.max(0, Number.parseInt(String(identityContext.page_count || 0), 10) || 0),
    max_match_score: maxMatchScore,
    updated_at: normalizedNow,
    audit_rows: auditRows
  };
}

export function computeNeedSet({
  runId = '',
  category = '',
  productId = '',
  fieldOrder = [],
  provenance = {},
  fieldRules = {},
  fieldReasoning = {},
  constraintAnalysis = {},
  identityContext = {},
  now = new Date().toISOString()
} = {}) {
  const identity = normalizeIdentityContext(identityContext, now);
  const rulesMap = isObject(fieldRules?.fields) ? fieldRules.fields : (isObject(fieldRules) ? fieldRules : {});
  const fields = collectFieldKeys({ fieldOrder, provenance, fieldRules: rulesMap });
  const rows = [];
  const reasonCounts = {
    missing: 0,
    tier_pref_unmet: 0,
    min_refs_fail: 0,
    conflict: 0,
    low_conf: 0,
    identity_unlocked: 0,
    blocked_by_identity: 0,
    publish_gate_block: 0
  };
  const requiredLevelCounts = requiredLevelCountSeed();

  for (const field of fields) {
    const bucket = provenance?.[field] || {};
    const reasoning = isObject(fieldReasoning?.[field]) ? fieldReasoning[field] : {};
    const rule = rulesMap?.[field] || {};
    const requiredLevel = normalizeRequiredLevel(ruleRequiredLevel(rule));
    const gatedField = IDENTITY_GATED_LEVELS.has(requiredLevel);
    const requiredWeight = REQUIRED_WEIGHT[requiredLevel] ?? 1;
    const value = bucket.value ?? 'unk';
    const confidence = toNumber(bucket.confidence, null);
    const passTarget = clamp01(toNumber(bucket.pass_target, 0.8));
    const meetsPassTarget = Boolean(bucket.meets_pass_target);
    const evidenceRows = Array.isArray(bucket.evidence) ? bucket.evidence : [];
    const refsFound = countDistinctEvidenceRefs(evidenceRows);
    const minRefs = Math.max(1, Number(ruleMinEvidenceRefs(rule) || 1));
    const tierPreference = parseTierPreference(rule);
    const bestTier = bestTierSeen(evidenceRows);
    const missing = !hasKnownFieldValue(value);
    const conflict = isFieldConflict(field, fieldReasoning, constraintAnalysis);
    const tierDeficit = tierPreference.includes(1) && (bestTier === null || bestTier > 1);
    const blockedByIdentity = gatedField && !identity.extraction_gate_open;
    const publishGateBlocked = gatedField && !identity.publishable;
    const confidenceCap = gatedField && !identity.extraction_gate_open
      ? confidenceCapForIdentityState(identity.status)
      : 1;
    const effectiveConfidence = confidence === null
      ? null
      : Math.min(clamp01(confidence), confidenceCap);
    const confidenceCapped = confidence !== null && effectiveConfidence !== null && effectiveConfidence < clamp01(confidence);
    const minRefsDeficit = refsFound < minRefs;
    const lowConf = effectiveConfidence === null ? !missing : effectiveConfidence < passTarget;

    const reasons = [];
    if (missing) reasons.push('missing');
    if (tierDeficit) reasons.push('tier_pref_unmet');
    if (minRefsDeficit) reasons.push('min_refs_fail');
    if (conflict) reasons.push('conflict');
    if (lowConf) reasons.push('low_conf');
    if (missing && !identity.extraction_gate_open) reasons.push('identity_unlocked');
    if (blockedByIdentity) reasons.push('blocked_by_identity');
    if (publishGateBlocked) reasons.push('publish_gate_block');
    if (reasons.length === 0) {
      continue;
    }

    for (const reason of reasons) {
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    }
    requiredLevelCounts[requiredLevel] = (requiredLevelCounts[requiredLevel] || 0) + 1;

    const missingMultiplier = missing ? 2 : 1;
    const confTerm = effectiveConfidence === null ? 1 : (1 - clamp01(effectiveConfidence));
    const tierDeficitMultiplier = tierDeficit ? 2 : 1;
    const minRefsDeficitMultiplier = minRefsDeficit ? 1.5 : 1;
    const conflictMultiplier = conflict ? 1.5 : 1;
    const identityBlockMultiplier = blockedByIdentity ? 1.35 : 1;
    const publishBlockMultiplier = publishGateBlocked ? 1.2 : 1;
    const needScore = missingMultiplier
      * confTerm
      * requiredWeight
      * tierDeficitMultiplier
      * minRefsDeficitMultiplier
      * conflictMultiplier
      * identityBlockMultiplier
      * publishBlockMultiplier;

    const blockedBy = [];
    if (blockedByIdentity) blockedBy.push('identity_lock');
    if (publishGateBlocked) blockedBy.push('publish_gate');
    if (identity.status === 'conflict') blockedBy.push('identity_conflict');
    const unknownReason = String(reasoning.unknown_reason || '').trim() || null;
    const reasonPayload = {
      why_missing: missing ? (unknownReason || 'missing_value') : null,
      why_low_conf: lowConf
        ? (effectiveConfidence === null ? 'no_confidence_available' : 'below_pass_target')
        : null,
      why_blocked: blockedBy.length > 0 ? blockedBy.join('|') : null
    };

    rows.push({
      field_key: field,
      required_level: requiredLevel,
      required_weight: requiredWeight,
      status: missing ? 'unknown' : (conflict ? 'conflict' : 'accepted'),
      value,
      confidence,
      effective_confidence: effectiveConfidence,
      confidence_capped: confidenceCapped,
      pass_target: passTarget,
      meets_pass_target: meetsPassTarget,
      refs_found: refsFound,
      min_refs: minRefs,
      best_tier_seen: bestTier,
      tier_preference: tierPreference,
      identity_state: identity.status,
      best_identity_match: identity.max_match_score,
      blocked_by: blockedBy,
      quarantined: blockedByIdentity && hasKnownFieldValue(value),
      unknown_reason: unknownReason,
      reason_payload: reasonPayload,
      conflict,
      reasons,
      need_score: Number.parseFloat(needScore.toFixed(6))
    });
  }

  rows.sort((a, b) => {
    if (b.need_score !== a.need_score) return b.need_score - a.need_score;
    const levelDelta = (REQUIRED_WEIGHT[b.required_level] ?? 0) - (REQUIRED_WEIGHT[a.required_level] ?? 0);
    if (levelDelta !== 0) return levelDelta;
    return String(a.field_key).localeCompare(String(b.field_key));
  });

  const needsetSize = rows.length;
  return {
    run_id: String(runId || '').trim(),
    category: String(category || '').trim(),
    product_id: String(productId || '').trim(),
    generated_at: now,
    total_fields: fields.length,
    needset_size: needsetSize,
    identity_lock_state: {
      status: identity.status,
      confidence: identity.confidence,
      identity_gate_validated: identity.identity_gate_validated,
      extraction_gate_open: identity.extraction_gate_open,
      family_model_count: identity.family_model_count,
      ambiguity_level: identity.ambiguity_level,
      publishable: identity.publishable,
      publish_blockers: identity.publish_blockers,
      reason_codes: identity.reason_codes,
      page_count: identity.page_count,
      max_match_score: identity.max_match_score,
      updated_at: identity.updated_at
    },
    identity_audit_rows: identity.audit_rows,
    reason_counts: reasonCounts,
    required_level_counts: requiredLevelCounts,
    needs: rows,
    snapshots: [
      {
        ts: now,
        needset_size: needsetSize
      }
    ]
  };
}
