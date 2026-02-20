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

export function computeNeedSet({
  runId = '',
  category = '',
  productId = '',
  fieldOrder = [],
  provenance = {},
  fieldRules = {},
  fieldReasoning = {},
  constraintAnalysis = {},
  now = new Date().toISOString()
} = {}) {
  const rulesMap = isObject(fieldRules?.fields) ? fieldRules.fields : (isObject(fieldRules) ? fieldRules : {});
  const fields = collectFieldKeys({ fieldOrder, provenance, fieldRules: rulesMap });
  const rows = [];
  const reasonCounts = {
    missing: 0,
    tier_deficit: 0,
    min_refs_fail: 0,
    conflict: 0,
    low_conf: 0
  };
  const requiredLevelCounts = requiredLevelCountSeed();

  for (const field of fields) {
    const bucket = provenance?.[field] || {};
    const rule = rulesMap?.[field] || {};
    const requiredLevel = normalizeRequiredLevel(ruleRequiredLevel(rule));
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
    const minRefsDeficit = refsFound < minRefs;
    const lowConf = confidence === null ? !missing : confidence < passTarget;

    const reasons = [];
    if (missing) reasons.push('missing');
    if (tierDeficit) reasons.push('tier_deficit');
    if (minRefsDeficit) reasons.push('min_refs_fail');
    if (conflict) reasons.push('conflict');
    if (lowConf) reasons.push('low_conf');
    if (reasons.length === 0) {
      continue;
    }

    for (const reason of reasons) {
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    }
    requiredLevelCounts[requiredLevel] = (requiredLevelCounts[requiredLevel] || 0) + 1;

    const missingMultiplier = missing ? 2 : 1;
    const confTerm = confidence === null ? 1 : (1 - clamp01(confidence));
    const tierDeficitMultiplier = tierDeficit ? 2 : 1;
    const minRefsDeficitMultiplier = minRefsDeficit ? 1.5 : 1;
    const conflictMultiplier = conflict ? 1.5 : 1;
    const needScore = missingMultiplier
      * confTerm
      * requiredWeight
      * tierDeficitMultiplier
      * minRefsDeficitMultiplier
      * conflictMultiplier;

    rows.push({
      field_key: field,
      required_level: requiredLevel,
      required_weight: requiredWeight,
      status: missing ? 'unknown' : (conflict ? 'conflict' : 'accepted'),
      value,
      confidence,
      pass_target: passTarget,
      meets_pass_target: meetsPassTarget,
      refs_found: refsFound,
      min_refs: minRefs,
      best_tier_seen: bestTier,
      tier_preference: tierPreference,
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
