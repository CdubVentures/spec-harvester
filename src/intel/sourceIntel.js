import { toPosixKey } from '../s3/storage.js';

function round(value, digits = 4) {
  return Number.parseFloat(Number(value || 0).toFixed(digits));
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeSourcePath(url) {
  try {
    const parsed = new URL(url);
    const rawPath = String(parsed.pathname || '/')
      .toLowerCase()
      .replace(/\/+/g, '/');
    if (!rawPath || rawPath === '/') {
      return '/';
    }
    return rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
  } catch {
    return '/';
  }
}

const FIELD_REWARD_MAX_ENTRIES = 1200;

function rewardKey(field, method) {
  return `${String(field || '').trim()}::${String(method || 'unknown').trim() || 'unknown'}`;
}

function parseIsoMs(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : null;
}

function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

function trimLowestScoreEntries(map, maxEntries = FIELD_REWARD_MAX_ENTRIES) {
  const entries = Object.entries(map || {});
  if (entries.length <= maxEntries) {
    return map;
  }

  entries.sort((a, b) => {
    const aScore = Number.parseFloat(String(a[1]?.reward_score || 0));
    const bScore = Number.parseFloat(String(b[1]?.reward_score || 0));
    if (bScore !== aScore) {
      return bScore - aScore;
    }
    return (b[1]?.seen_count || 0) - (a[1]?.seen_count || 0);
  });
  return Object.fromEntries(entries.slice(0, maxEntries));
}

function createFieldRewardEntry(field, method) {
  return {
    field: String(field || '').trim(),
    method: String(method || 'unknown').trim() || 'unknown',
    seen_count: 0,
    success_count: 0,
    fail_count: 0,
    contradiction_count: 0,
    success_rate: 0,
    contradiction_rate: 0,
    reward_score: 0,
    last_seen_at: null,
    last_decay_at: null
  };
}

function ensureFieldRewardMap(entry) {
  if (!entry.field_method_reward || typeof entry.field_method_reward !== 'object') {
    entry.field_method_reward = {};
  }
  if (!entry.per_field_reward || typeof entry.per_field_reward !== 'object') {
    entry.per_field_reward = {};
  }
  return entry.field_method_reward;
}

function applyDecayToRewardEntry(rewardEntry, nowMs, seenAt, halfLifeDays = 45) {
  const baseMs = parseIsoMs(rewardEntry.last_decay_at || rewardEntry.last_seen_at);
  if (baseMs === null) {
    rewardEntry.last_decay_at = seenAt;
    return;
  }

  const elapsedDays = (nowMs - baseMs) / 86_400_000;
  if (!Number.isFinite(elapsedDays) || elapsedDays <= 0) {
    rewardEntry.last_decay_at = seenAt;
    return;
  }

  const halfLife = Math.max(1, Number.parseFloat(String(halfLifeDays || 45)) || 45);
  const decayFactor = Math.pow(0.5, elapsedDays / halfLife);

  rewardEntry.seen_count = round((rewardEntry.seen_count || 0) * decayFactor, 6);
  rewardEntry.success_count = round((rewardEntry.success_count || 0) * decayFactor, 6);
  rewardEntry.fail_count = round((rewardEntry.fail_count || 0) * decayFactor, 6);
  rewardEntry.contradiction_count = round((rewardEntry.contradiction_count || 0) * decayFactor, 6);
  rewardEntry.last_decay_at = seenAt;
}

function finalizeRewardEntry(rewardEntry) {
  const total = Math.max(0, rewardEntry.success_count + rewardEntry.fail_count + rewardEntry.contradiction_count);
  rewardEntry.seen_count = Math.max(rewardEntry.seen_count || 0, total);
  rewardEntry.success_rate = round(rewardEntry.success_count / Math.max(1, total), 6);
  rewardEntry.contradiction_rate = round(rewardEntry.contradiction_count / Math.max(1, total), 6);

  const rawReward =
    (rewardEntry.success_count - (rewardEntry.fail_count * 0.7) - (rewardEntry.contradiction_count * 1.2)) /
    Math.max(1, total);
  rewardEntry.reward_score = round(clamp(rawReward, -1, 1), 6);
}

function updateFieldReward(entry, { field, method, outcome, seenAt, halfLifeDays }) {
  const rewardMap = ensureFieldRewardMap(entry);
  const key = rewardKey(field, method);
  if (!rewardMap[key]) {
    rewardMap[key] = createFieldRewardEntry(field, method);
  }

  const rewardEntry = rewardMap[key];
  const nowMs = parseIsoMs(seenAt) ?? Date.now();
  applyDecayToRewardEntry(rewardEntry, nowMs, seenAt, halfLifeDays);

  rewardEntry.seen_count += 1;
  if (outcome === 'success') {
    rewardEntry.success_count += 1;
  } else if (outcome === 'contradiction') {
    rewardEntry.contradiction_count += 1;
  } else {
    rewardEntry.fail_count += 1;
  }
  rewardEntry.last_seen_at = seenAt;
  rewardEntry.last_decay_at = seenAt;
  finalizeRewardEntry(rewardEntry);
  entry.field_method_reward = trimLowestScoreEntries(rewardMap, FIELD_REWARD_MAX_ENTRIES);
}

function decayFieldRewardMap(entry, seenAt, halfLifeDays) {
  const rewardMap = ensureFieldRewardMap(entry);
  const nowMs = parseIsoMs(seenAt) ?? Date.now();
  for (const rewardEntry of Object.values(rewardMap)) {
    applyDecayToRewardEntry(rewardEntry, nowMs, seenAt, halfLifeDays);
    finalizeRewardEntry(rewardEntry);
  }
}

function summarizeFieldRewards(fieldMethodReward) {
  const byField = {};
  for (const rewardEntry of Object.values(fieldMethodReward || {})) {
    const field = String(rewardEntry.field || '').trim();
    if (!field) {
      continue;
    }
    if (!byField[field]) {
      byField[field] = {
        field,
        sample_count: 0,
        weighted_score_total: 0,
        weighted_success_total: 0,
        weighted_contradiction_total: 0,
        best_method: rewardEntry.method,
        best_method_score: rewardEntry.reward_score || 0
      };
    }
    const bucket = byField[field];
    const seen = Math.max(0, rewardEntry.seen_count || 0);
    bucket.sample_count += seen;
    bucket.weighted_score_total += (rewardEntry.reward_score || 0) * Math.max(1, seen);
    bucket.weighted_success_total += (rewardEntry.success_rate || 0) * Math.max(1, seen);
    bucket.weighted_contradiction_total += (rewardEntry.contradiction_rate || 0) * Math.max(1, seen);
    if ((rewardEntry.reward_score || 0) > (bucket.best_method_score || -1)) {
      bucket.best_method = rewardEntry.method;
      bucket.best_method_score = rewardEntry.reward_score || 0;
    }
  }

  const output = {};
  for (const [field, bucket] of Object.entries(byField)) {
    const denom = Math.max(1, bucket.sample_count);
    output[field] = {
      field,
      sample_count: round(bucket.sample_count, 6),
      score: round(bucket.weighted_score_total / denom, 6),
      success_rate: round(bucket.weighted_success_total / denom, 6),
      contradiction_rate: round(bucket.weighted_contradiction_total / denom, 6),
      best_method: bucket.best_method,
      best_method_score: round(bucket.best_method_score || 0, 6)
    };
  }
  return output;
}

function buildAcceptedEvidenceIndex(provenance) {
  const domainField = new Set();
  const domainFieldMethod = new Set();
  const domainPathField = new Set();
  const domainPathFieldMethod = new Set();

  for (const [field, row] of Object.entries(provenance || {})) {
    if (!valueIsFilled(row?.value)) {
      continue;
    }
    for (const evidence of row?.evidence || []) {
      const rootDomain = evidence?.rootDomain || evidence?.host || '';
      if (!rootDomain) {
        continue;
      }
      const path = normalizeSourcePath(evidence?.url || '');
      const method = String(evidence?.method || 'unknown');

      domainField.add(`${rootDomain}||${field}`);
      domainFieldMethod.add(`${rootDomain}||${field}||${method}`);
      domainPathField.add(`${rootDomain}||${path}||${field}`);
      domainPathFieldMethod.add(`${rootDomain}||${path}||${field}||${method}`);
    }
  }

  return {
    domainField,
    domainFieldMethod,
    domainPathField,
    domainPathFieldMethod
  };
}

function createStatsTemplate(extra = {}) {
  return {
    attempts: 0,
    http_ok_count: 0,
    http_ok: 0,
    identity_match_count: 0,
    identity_match: 0,
    major_anchor_conflict_count: 0,
    major_anchor_conflicts: 0,
    fields_contributed_count: 0,
    fields_accepted_count: 0,
    accepted_fields_count: 0,
    accepted_critical_fields_count: 0,
    products_seen: 0,
    recent_products: [],
    approved_attempts: 0,
    candidate_attempts: 0,
    per_field_helpfulness: {},
    per_field_accept_count: {},
    field_method_reward: {},
    per_field_reward: {},
    field_reward_strength: 0,
    endpoint_signal_count: 0,
    endpoint_signal_score_total: 0,
    endpoint_signal_avg_score: 0,
    parser_runs: 0,
    parser_success_count: 0,
    parser_zero_candidate_count: 0,
    parser_identity_miss_count: 0,
    parser_anchor_block_count: 0,
    parser_health_score_total: 0,
    parser_health_score: 0,
    fingerprint_counts: {},
    fingerprint_unique_count: 0,
    fingerprint_drift_rate: 0,
    last_seen_at: null,
    ...extra
  };
}

function hydrateStatsShape(entry) {
  const defaults = createStatsTemplate();
  for (const [key, value] of Object.entries(defaults)) {
    if (entry[key] !== undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      entry[key] = [];
    } else if (value && typeof value === 'object') {
      entry[key] = {};
    } else {
      entry[key] = value;
    }
  }
  return entry;
}

function ensureDomainStats(domains, rootDomain) {
  if (!domains[rootDomain]) {
    domains[rootDomain] = createStatsTemplate({
      rootDomain,
      per_brand: {},
      per_path: {}
    });
  } else if (!domains[rootDomain].per_brand) {
    domains[rootDomain].per_brand = {};
  }
  if (!domains[rootDomain].per_path) {
    domains[rootDomain].per_path = {};
  }
  return hydrateStatsShape(domains[rootDomain]);
}

function ensurePathStats(domainEntry, pathKey) {
  const normalizedPath = String(pathKey || '/');
  if (!domainEntry.per_path[normalizedPath]) {
    domainEntry.per_path[normalizedPath] = createStatsTemplate({
      path: normalizedPath
    });
  }
  return hydrateStatsShape(domainEntry.per_path[normalizedPath]);
}

function ensureBrandStats(domainEntry, brand) {
  const normalizedBrand = String(brand || '').trim();
  if (!normalizedBrand) {
    return null;
  }

  const brandKey = slug(normalizedBrand);
  if (!brandKey) {
    return null;
  }

  if (!domainEntry.per_brand[brandKey]) {
    domainEntry.per_brand[brandKey] = createStatsTemplate({
      brand: normalizedBrand,
      brand_key: brandKey
    });
  }
  return hydrateStatsShape(domainEntry.per_brand[brandKey]);
}

function incrementMapValue(map, key, delta = 1) {
  map[key] = (map[key] || 0) + delta;
}

function trimLowestCountEntries(map, maxEntries = 64) {
  const entries = Object.entries(map || {});
  if (entries.length <= maxEntries) {
    return map;
  }

  entries.sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(entries.slice(0, maxEntries));
}

function applySourceDiagnostics(entry, source) {
  const endpointSignals = source.endpointSignals || [];
  if (endpointSignals.length > 0) {
    const scoreSum = endpointSignals.reduce((sum, row) => sum + (row.signal_score || 0), 0);
    entry.endpoint_signal_count += endpointSignals.length;
    entry.endpoint_signal_score_total += scoreSum;
  }

  const parser = source.parserHealth || null;
  if (parser) {
    entry.parser_runs += 1;
    entry.parser_health_score_total += parser.health_score || 0;
    if ((parser.candidate_count || 0) > 0) {
      entry.parser_success_count += 1;
    } else {
      entry.parser_zero_candidate_count += 1;
    }
    if (parser.identity_match === false) {
      entry.parser_identity_miss_count += 1;
    }
    if ((parser.major_anchor_conflicts || 0) > 0) {
      entry.parser_anchor_block_count += 1;
    }
  }

  const fingerprintId = source.fingerprint?.id;
  if (fingerprintId) {
    incrementMapValue(entry.fingerprint_counts, fingerprintId, 1);
    entry.fingerprint_counts = trimLowestCountEntries(entry.fingerprint_counts, 96);
  }
}

function updateDerivedStats(entry, seenAt, halfLifeDays = 45) {
  decayFieldRewardMap(entry, seenAt, halfLifeDays);
  entry.per_field_reward = summarizeFieldRewards(entry.field_method_reward);
  const rewardRows = Object.values(entry.per_field_reward || {});
  entry.field_reward_strength = rewardRows.length
    ? round(
      rewardRows.reduce((sum, row) => sum + Math.max(-1, Math.min(1, row.score || 0)), 0) / rewardRows.length,
      6
    )
    : 0;

  const attempts = Math.max(1, entry.attempts || 0);
  entry.http_ok_rate = round((entry.http_ok_count || 0) / attempts, 6);
  entry.identity_match_rate = round((entry.identity_match_count || 0) / attempts, 6);
  entry.major_anchor_conflict_rate = round((entry.major_anchor_conflict_count || 0) / attempts, 6);
  entry.acceptance_yield = round(
    (entry.fields_accepted_count || 0) / Math.max(1, entry.fields_contributed_count || 0),
    6
  );
  entry.endpoint_signal_avg_score = round(
    (entry.endpoint_signal_score_total || 0) / Math.max(1, entry.endpoint_signal_count || 0),
    6
  );
  entry.parser_health_score = round(
    (entry.parser_health_score_total || 0) / Math.max(1, entry.parser_runs || 0),
    6
  );
  entry.fingerprint_unique_count = Object.keys(entry.fingerprint_counts || {}).length;
  entry.fingerprint_drift_rate = round(
    entry.fingerprint_unique_count / Math.max(1, entry.parser_runs || 0),
    6
  );

  const yieldBoost = Math.min(1, entry.acceptance_yield * 10);
  const parserBoost = Math.min(1, entry.parser_health_score || 0);
  const endpointBoost = Math.min(1, (entry.endpoint_signal_avg_score || 0) / 4);
  const rewardBoost = Math.max(-0.15, Math.min(0.15, (entry.field_reward_strength || 0) * 0.15));
  entry.planner_score = round(
    (entry.identity_match_rate * 0.5) +
      ((1 - entry.major_anchor_conflict_rate) * 0.2) +
      (entry.http_ok_rate * 0.1) +
      (yieldBoost * 0.15) +
      (parserBoost * 0.03) +
      (endpointBoost * 0.02) +
      rewardBoost,
    6
  );
}

function syncNamedMetrics(entry, seenAt) {
  entry.http_ok = entry.http_ok_count || 0;
  entry.identity_match = entry.identity_match_count || 0;
  entry.major_anchor_conflicts = entry.major_anchor_conflict_count || 0;
  entry.accepted_fields_count = entry.fields_accepted_count || 0;
  entry.per_field_accept_count = { ...(entry.per_field_helpfulness || {}) };
  entry.parser_success_rate = round(
    (entry.parser_success_count || 0) / Math.max(1, entry.parser_runs || 0),
    6
  );
  entry.parser_identity_miss_rate = round(
    (entry.parser_identity_miss_count || 0) / Math.max(1, entry.parser_runs || 0),
    6
  );
  entry.last_seen_at = seenAt;
}

function valueIsFilled(value) {
  const text = String(value || '').trim().toLowerCase();
  return text !== '' && text !== 'unk';
}

function sourceCandidateOutcome({
  rootDomain,
  pathKey,
  field,
  method,
  source,
  acceptedEvidenceIndex,
  contradictionFieldSet
}) {
  const domainFieldKey = `${rootDomain}||${field}`;
  const domainFieldMethodKey = `${rootDomain}||${field}||${method}`;
  const pathFieldKey = `${rootDomain}||${pathKey}||${field}`;
  const pathFieldMethodKey = `${rootDomain}||${pathKey}||${field}||${method}`;

  const accepted =
    acceptedEvidenceIndex.domainPathFieldMethod.has(pathFieldMethodKey) ||
    acceptedEvidenceIndex.domainPathField.has(pathFieldKey) ||
    acceptedEvidenceIndex.domainFieldMethod.has(domainFieldMethodKey) ||
    acceptedEvidenceIndex.domainField.has(domainFieldKey);
  if (accepted) {
    return 'success';
  }

  const hasAnchorConflict = (source.anchorCheck?.majorConflicts || [])
    .some((item) => String(item?.field || '').trim() === field);
  const hasGlobalContradiction = contradictionFieldSet.has(field);
  if (hasAnchorConflict || hasGlobalContradiction || source.identity?.match === false) {
    return 'contradiction';
  }

  return 'fail';
}

function applyFieldRewardsForSource({
  source,
  rootDomain,
  pathKey,
  entry,
  brandStats,
  pathStats,
  acceptedEvidenceIndex,
  contradictionFieldSet,
  seenAt,
  halfLifeDays
}) {
  for (const candidate of source.fieldCandidates || []) {
    const field = String(candidate?.field || '').trim();
    if (!field || !valueIsFilled(candidate?.value)) {
      continue;
    }
    const method = String(candidate?.method || 'unknown').trim() || 'unknown';
    const outcome = sourceCandidateOutcome({
      rootDomain,
      pathKey,
      field,
      method,
      source,
      acceptedEvidenceIndex,
      contradictionFieldSet
    });

    updateFieldReward(entry, {
      field,
      method,
      outcome,
      seenAt,
      halfLifeDays
    });
    if (brandStats) {
      updateFieldReward(brandStats, {
        field,
        method,
        outcome,
        seenAt,
        halfLifeDays
      });
    }
    updateFieldReward(pathStats, {
      field,
      method,
      outcome,
      seenAt,
      halfLifeDays
    });
  }
}

function collectAcceptedDomainHelpfulness(provenance, criticalFieldSet) {
  const map = {};

  for (const [field, row] of Object.entries(provenance || {})) {
    if (!valueIsFilled(row?.value)) {
      continue;
    }

    const evidence = row?.evidence || [];
    if (!evidence.length) {
      continue;
    }

    const uniqueDomainsForField = new Set();
    for (const item of evidence) {
      const rootDomain = item?.rootDomain || item?.host || '';
      if (!rootDomain) {
        continue;
      }
      uniqueDomainsForField.add(rootDomain);
    }

    for (const rootDomain of uniqueDomainsForField) {
      if (!map[rootDomain]) {
        map[rootDomain] = {
          fieldsAccepted: 0,
          acceptedCriticalFields: 0,
          perField: {}
        };
      }

      map[rootDomain].fieldsAccepted += 1;
      map[rootDomain].perField[field] = (map[rootDomain].perField[field] || 0) + 1;
      if (criticalFieldSet.has(field)) {
        map[rootDomain].acceptedCriticalFields += 1;
      }
    }
  }

  return map;
}

function collectAcceptedPathHelpfulness(provenance, criticalFieldSet) {
  const map = {};

  for (const [field, row] of Object.entries(provenance || {})) {
    if (!valueIsFilled(row?.value)) {
      continue;
    }

    const evidence = row?.evidence || [];
    if (!evidence.length) {
      continue;
    }

    const uniquePathEntries = new Set();
    for (const item of evidence) {
      const rootDomain = item?.rootDomain || item?.host || '';
      if (!rootDomain) {
        continue;
      }
      const path = normalizeSourcePath(item?.url || '');
      uniquePathEntries.add(`${rootDomain}||${path}`);
    }

    for (const compositeKey of uniquePathEntries) {
      if (!map[compositeKey]) {
        map[compositeKey] = {
          fieldsAccepted: 0,
          acceptedCriticalFields: 0,
          perField: {}
        };
      }

      map[compositeKey].fieldsAccepted += 1;
      map[compositeKey].perField[field] = (map[compositeKey].perField[field] || 0) + 1;
      if (criticalFieldSet.has(field)) {
        map[compositeKey].acceptedCriticalFields += 1;
      }
    }
  }

  return map;
}

function topHelpfulFields(perFieldHelpfulness, limit = 12) {
  return Object.entries(perFieldHelpfulness || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([field, count]) => ({ field, count }));
}

function applyPromotionThresholds(domains) {
  const rows = Object.values(domains || {});
  return rows
    .filter((entry) => (entry.approved_attempts || 0) === 0)
    .filter((entry) => (entry.products_seen || 0) >= 20)
    .filter((entry) => (entry.identity_match_rate || 0) >= 0.98)
    .filter((entry) => (entry.major_anchor_conflict_count || 0) === 0)
    .filter((entry) => (entry.fields_accepted_count || 0) >= 10)
    .filter((entry) => (entry.accepted_critical_fields_count || 0) >= 1)
    .sort((a, b) => (b.planner_score || 0) - (a.planner_score || 0))
    .map((entry) => ({
      rootDomain: entry.rootDomain,
      products_seen: entry.products_seen,
      identity_match_rate: entry.identity_match_rate,
      major_anchor_conflict_count: entry.major_anchor_conflict_count,
      fields_accepted_count: entry.fields_accepted_count,
      accepted_critical_fields_count: entry.accepted_critical_fields_count,
      planner_score: entry.planner_score
    }));
}

function buildPerBrandExpansionPlans(domains, approvedRootDomains) {
  const approved = approvedRootDomains || new Set();
  const byBrand = new Map();

  for (const domain of Object.values(domains || {})) {
    const rootDomain = domain.rootDomain;
    if (!rootDomain || approved.has(rootDomain)) {
      continue;
    }

    const perBrand = domain.per_brand || {};
    for (const [brandKey, stats] of Object.entries(perBrand)) {
      if ((stats.attempts || 0) < 2) {
        continue;
      }
      if ((stats.identity_match_rate || 0) < 0.9) {
        continue;
      }
      if ((stats.fields_accepted_count || 0) < 1) {
        continue;
      }
      if ((stats.major_anchor_conflict_count || 0) > 1) {
        continue;
      }

      let readiness = 'low';
      if (
        (stats.attempts || 0) >= 8 &&
        (stats.identity_match_rate || 0) >= 0.98 &&
        (stats.major_anchor_conflict_count || 0) === 0 &&
        (stats.fields_accepted_count || 0) >= 8
      ) {
        readiness = 'high';
      } else if (
        (stats.attempts || 0) >= 4 &&
        (stats.identity_match_rate || 0) >= 0.95 &&
        (stats.fields_accepted_count || 0) >= 3
      ) {
        readiness = 'medium';
      }

      const score = round(
        ((stats.identity_match_rate || 0) * 0.5) +
          ((1 - (stats.major_anchor_conflict_rate || 0)) * 0.2) +
          (Math.min(1, (stats.fields_accepted_count || 0) / 10) * 0.2) +
          (Math.min(1, (stats.products_seen || 0) / 20) * 0.1),
        6
      );

      if (!byBrand.has(brandKey)) {
        byBrand.set(brandKey, {
          brand: stats.brand || brandKey,
          brand_key: brandKey,
          generated_at: new Date().toISOString(),
          suggestions: []
        });
      }

      byBrand.get(brandKey).suggestions.push({
        rootDomain,
        readiness,
        score,
        attempts: stats.attempts || 0,
        candidate_attempts: stats.candidate_attempts || 0,
        identity_match_rate: stats.identity_match_rate || 0,
        major_anchor_conflict_rate: stats.major_anchor_conflict_rate || 0,
        fields_accepted_count: stats.fields_accepted_count || 0,
        accepted_critical_fields_count: stats.accepted_critical_fields_count || 0,
        top_fields: topHelpfulFields(stats.per_field_helpfulness, 8)
      });
    }
  }

  const plans = [...byBrand.values()].map((plan) => ({
    ...plan,
    suggestions: plan.suggestions.sort((a, b) => b.score - a.score),
    suggestion_count: plan.suggestions.length
  }));

  plans.sort((a, b) => b.suggestion_count - a.suggestion_count || a.brand.localeCompare(b.brand));
  return plans;
}

export function sourceIntelKey(config, category) {
  return toPosixKey(config.s3OutputPrefix, '_source_intel', category, 'domain_stats.json');
}

export function promotionSuggestionsKey(config, category, date = new Date()) {
  const stamp = date.toISOString().slice(0, 10);
  return toPosixKey(
    config.s3OutputPrefix,
    '_source_intel',
    category,
    'promotion_suggestions',
    `${stamp}.json`
  );
}

export function expansionPlanKey(config, category, date = new Date()) {
  const stamp = date.toISOString().slice(0, 10);
  return toPosixKey(
    config.s3OutputPrefix,
    '_source_intel',
    category,
    'expansion_plans',
    `${stamp}.json`
  );
}

export function brandExpansionPlanKey(config, category, brandKey, date = new Date()) {
  const stamp = date.toISOString().slice(0, 10);
  return toPosixKey(
    config.s3OutputPrefix,
    '_source_intel',
    category,
    'expansion_plans',
    'brands',
    brandKey,
    `${stamp}.json`
  );
}

export async function loadSourceIntel({ storage, config, category }) {
  const key = sourceIntelKey(config, category);
  const existing = await storage.readJsonOrNull(key);

  return {
    key,
    data: existing || {
      category,
      updated_at: null,
      domains: {}
    }
  };
}

async function writeExpansionPlans({
  storage,
  config,
  category,
  intelPayload,
  categoryConfig,
  date = new Date()
}) {
  const plans = buildPerBrandExpansionPlans(
    intelPayload.domains || {},
    categoryConfig?.approvedRootDomains || new Set()
  );

  const globalKey = expansionPlanKey(config, category, date);
  const globalPayload = {
    category,
    generated_at: new Date().toISOString(),
    plan_count: plans.length,
    plans: plans.map((plan) => ({
      brand: plan.brand,
      brand_key: plan.brand_key,
      suggestion_count: plan.suggestion_count,
      top_suggestions: plan.suggestions.slice(0, 20)
    }))
  };

  await storage.writeObject(globalKey, Buffer.from(JSON.stringify(globalPayload, null, 2), 'utf8'), {
    contentType: 'application/json'
  });

  const perBrandKeys = [];
  for (const plan of plans) {
    const key = brandExpansionPlanKey(config, category, plan.brand_key, date);
    const payload = {
      category,
      brand: plan.brand,
      brand_key: plan.brand_key,
      generated_at: new Date().toISOString(),
      suggestion_count: plan.suggestion_count,
      suggestions: plan.suggestions
    };

    await storage.writeObject(key, Buffer.from(JSON.stringify(payload, null, 2), 'utf8'), {
      contentType: 'application/json'
    });
    perBrandKeys.push(key);
  }

  return {
    expansionPlanKey: globalKey,
    brandPlanKeys: perBrandKeys,
    planCount: plans.length
  };
}

export async function generateSourceExpansionPlans({
  storage,
  config,
  category,
  categoryConfig
}) {
  const loaded = await loadSourceIntel({ storage, config, category });
  return writeExpansionPlans({
    storage,
    config,
    category,
    intelPayload: loaded.data,
    categoryConfig
  });
}

export async function persistSourceIntel({
  storage,
  config,
  category,
  productId,
  brand,
  sourceResults,
  provenance,
  categoryConfig,
  constraintAnalysis = null
}) {
  const loaded = await loadSourceIntel({ storage, config, category });
  const current = loaded.data;
  const domains = { ...(current.domains || {}) };
  const perDomainRunSeen = new Set();
  const perPathRunSeen = new Set();
  const seenAt = new Date().toISOString();
  const halfLifeDays = Math.max(1, Number.parseFloat(String(config.fieldRewardHalfLifeDays || 45)) || 45);
  const acceptedEvidenceIndex = buildAcceptedEvidenceIndex(provenance);
  const contradictionFieldSet = new Set(
    (constraintAnalysis?.contradictions || [])
      .flatMap((item) => item.fields || [])
      .map((field) => String(field || '').trim())
      .filter(Boolean)
  );

  for (const source of sourceResults || []) {
    const rootDomain = source.rootDomain || source.host;
    if (!rootDomain) {
      continue;
    }

    const entry = ensureDomainStats(domains, rootDomain);
    const brandStats = ensureBrandStats(entry, brand);
    const pathKey = normalizeSourcePath(source.finalUrl || source.url || '');
    const pathStats = ensurePathStats(entry, pathKey);
    entry.attempts += 1;
    if (brandStats) {
      brandStats.attempts += 1;
    }
    pathStats.attempts += 1;

    const status = Number.parseInt(source.status || 0, 10);
    if (status >= 200 && status < 400) {
      entry.http_ok_count += 1;
      if (brandStats) {
        brandStats.http_ok_count += 1;
      }
      pathStats.http_ok_count += 1;
    }

    if (source.identity?.match) {
      entry.identity_match_count += 1;
      if (brandStats) {
        brandStats.identity_match_count += 1;
      }
      pathStats.identity_match_count += 1;
    }

    if ((source.anchorCheck?.majorConflicts || []).length > 0) {
      entry.major_anchor_conflict_count += 1;
      if (brandStats) {
        brandStats.major_anchor_conflict_count += 1;
      }
      pathStats.major_anchor_conflict_count += 1;
    }

    const contributedCount = (source.fieldCandidates || []).length;
    entry.fields_contributed_count += contributedCount;
    if (brandStats) {
      brandStats.fields_contributed_count += contributedCount;
    }
    pathStats.fields_contributed_count += contributedCount;

    if (source.approvedDomain) {
      entry.approved_attempts += 1;
      if (brandStats) {
        brandStats.approved_attempts += 1;
      }
      pathStats.approved_attempts += 1;
    } else {
      entry.candidate_attempts += 1;
      if (brandStats) {
        brandStats.candidate_attempts += 1;
      }
      pathStats.candidate_attempts += 1;
    }

    applySourceDiagnostics(entry, source);
    if (brandStats) {
      applySourceDiagnostics(brandStats, source);
    }
    applySourceDiagnostics(pathStats, source);
    applyFieldRewardsForSource({
      source,
      rootDomain,
      pathKey,
      entry,
      brandStats,
      pathStats,
      acceptedEvidenceIndex,
      contradictionFieldSet,
      seenAt,
      halfLifeDays
    });

    perDomainRunSeen.add(rootDomain);
    perPathRunSeen.add(`${rootDomain}||${pathKey}`);
  }

  for (const rootDomain of perDomainRunSeen) {
    const entry = ensureDomainStats(domains, rootDomain);
    const recent = new Set(entry.recent_products || []);
    if (!recent.has(productId)) {
      entry.products_seen += 1;
    }
    recent.add(productId);
    entry.recent_products = [...recent].slice(-200);

    const brandStats = ensureBrandStats(entry, brand);
    if (brandStats) {
      const brandRecent = new Set(brandStats.recent_products || []);
      if (!brandRecent.has(productId)) {
        brandStats.products_seen += 1;
      }
      brandRecent.add(productId);
      brandStats.recent_products = [...brandRecent].slice(-200);
    }
  }

  for (const compositeKey of perPathRunSeen) {
    const [rootDomain, pathKey] = compositeKey.split('||');
    if (!rootDomain) {
      continue;
    }
    const entry = ensureDomainStats(domains, rootDomain);
    const pathStats = ensurePathStats(entry, pathKey || '/');
    const recent = new Set(pathStats.recent_products || []);
    if (!recent.has(productId)) {
      pathStats.products_seen += 1;
    }
    recent.add(productId);
    pathStats.recent_products = [...recent].slice(-200);
  }

  const acceptedHelpfulness = collectAcceptedDomainHelpfulness(
    provenance,
    categoryConfig?.criticalFieldSet || new Set()
  );
  const acceptedPathHelpfulness = collectAcceptedPathHelpfulness(
    provenance,
    categoryConfig?.criticalFieldSet || new Set()
  );

  for (const [rootDomain, stat] of Object.entries(acceptedHelpfulness)) {
    const entry = ensureDomainStats(domains, rootDomain);
    const brandStats = ensureBrandStats(entry, brand);
    entry.fields_accepted_count += stat.fieldsAccepted;
    entry.accepted_critical_fields_count += stat.acceptedCriticalFields;
    if (brandStats) {
      brandStats.fields_accepted_count += stat.fieldsAccepted;
      brandStats.accepted_critical_fields_count += stat.acceptedCriticalFields;
    }

    for (const [field, count] of Object.entries(stat.perField || {})) {
      entry.per_field_helpfulness[field] = (entry.per_field_helpfulness[field] || 0) + count;
      if (brandStats) {
        brandStats.per_field_helpfulness[field] =
          (brandStats.per_field_helpfulness[field] || 0) + count;
      }
    }
  }

  for (const [compositeKey, stat] of Object.entries(acceptedPathHelpfulness)) {
    const [rootDomain, pathKey] = compositeKey.split('||');
    if (!rootDomain) {
      continue;
    }

    const entry = ensureDomainStats(domains, rootDomain);
    const pathStats = ensurePathStats(entry, pathKey || '/');
    pathStats.fields_accepted_count += stat.fieldsAccepted;
    pathStats.accepted_critical_fields_count += stat.acceptedCriticalFields;

    for (const [field, count] of Object.entries(stat.perField || {})) {
      pathStats.per_field_helpfulness[field] = (pathStats.per_field_helpfulness[field] || 0) + count;
    }
  }

  for (const entry of Object.values(domains)) {
    updateDerivedStats(entry, seenAt, halfLifeDays);
    syncNamedMetrics(entry, seenAt);
    for (const brandEntry of Object.values(entry.per_brand || {})) {
      updateDerivedStats(brandEntry, seenAt, halfLifeDays);
      syncNamedMetrics(brandEntry, seenAt);
    }
    for (const pathEntry of Object.values(entry.per_path || {})) {
      updateDerivedStats(pathEntry, seenAt, halfLifeDays);
      syncNamedMetrics(pathEntry, seenAt);
    }
  }

  const payload = {
    category,
    updated_at: new Date().toISOString(),
    domains
  };

  await storage.writeObject(loaded.key, Buffer.from(JSON.stringify(payload, null, 2), 'utf8'), {
    contentType: 'application/json'
  });

  const suggestions = applyPromotionThresholds(domains);
  const suggestionKey = promotionSuggestionsKey(config, category);
  const suggestionPayload = {
    category,
    generated_at: new Date().toISOString(),
    thresholds: {
      min_products_seen: 20,
      min_identity_match_rate: 0.98,
      max_major_anchor_conflicts: 0,
      min_fields_accepted_count: 10,
      min_accepted_critical_fields_count: 1
    },
    suggestion_count: suggestions.length,
    suggestions
  };

  await storage.writeObject(suggestionKey, Buffer.from(JSON.stringify(suggestionPayload, null, 2), 'utf8'), {
    contentType: 'application/json'
  });

  const expansionResult = await writeExpansionPlans({
    storage,
    config,
    category,
    intelPayload: payload,
    categoryConfig
  });

  return {
    domainStatsKey: loaded.key,
    promotionSuggestionsKey: suggestionKey,
    expansionPlanKey: expansionResult.expansionPlanKey,
    brandExpansionPlanCount: expansionResult.planCount,
    intel: payload
  };
}
