import { nowIso } from '../utils/common.js';

function round(value, digits = 6) {
  return Number.parseFloat(Number(value || 0).toFixed(digits));
}

function cleanQuery(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureQuery(artifact, query) {
  if (!artifact.queries[query]) {
    artifact.queries[query] = {
      query,
      attempts: 0,
      success_count: 0,
      success_rate: 0,
      providers: {},
      brands: {},
      fields: {},
      last_seen_at: nowIso()
    };
  }
  return artifact.queries[query];
}

function trimQueries(map, maxEntries = 1500) {
  const sorted = Object.entries(map || {})
    .sort((a, b) => {
      const left = (a[1].success_rate || 0) * Math.log(1 + (a[1].attempts || 1));
      const right = (b[1].success_rate || 0) * Math.log(1 + (b[1].attempts || 1));
      if (right !== left) {
        return right - left;
      }
      return a[0].localeCompare(b[0]);
    })
    .slice(0, maxEntries);
  return Object.fromEntries(sorted);
}

function buildSuccessSignal(summary = {}) {
  const validated = Boolean(summary.validated);
  if (validated) {
    return 1;
  }
  const confidence = Number.parseFloat(String(summary.confidence || 0)) || 0;
  const identityMatched = Number.parseInt(String(summary.sources_identity_matched || 0), 10) || 0;
  const missingRequired = toArray(summary.missing_required_fields).length;
  const criticalMissing = toArray(summary.critical_fields_below_pass_target).length;
  const contradictionCount = Number.parseInt(String(summary.constraint_analysis?.contradiction_count || 0), 10) || 0;

  let signal = 0;
  signal += Math.min(0.6, confidence * 0.7);
  signal += identityMatched > 0 ? 0.25 : 0;
  signal += missingRequired === 0 ? 0.1 : 0;
  signal -= Math.min(0.3, criticalMissing * 0.08);
  signal -= Math.min(0.2, contradictionCount * 0.04);
  return Math.max(0, Math.min(1, signal));
}

function topQueriesForField(queriesMap, field, limit = 40) {
  const rows = Object.values(queriesMap || {})
    .filter((row) => (row.fields?.[field] || 0) > 0)
    .sort((a, b) => {
      const left = (a.success_rate || 0) * Math.log(1 + (a.attempts || 1));
      const right = (b.success_rate || 0) * Math.log(1 + (b.attempts || 1));
      if (right !== left) {
        return right - left;
      }
      return a.query.localeCompare(b.query);
    })
    .slice(0, limit)
    .map((row) => ({
      query: row.query,
      attempts: row.attempts,
      success_rate: round(row.success_rate, 6)
    }));
  return rows;
}

export function defaultQueryLearning() {
  return {
    version: 1,
    updated_at: nowIso(),
    queries: {},
    templates_by_field: {},
    templates_by_brand: {},
    stats: {
      updates_total: 0
    }
  };
}

export function updateQueryLearning({
  artifact,
  summary,
  job,
  discoveryResult,
  seenAt = nowIso()
}) {
  const next = artifact && typeof artifact === 'object'
    ? artifact
    : defaultQueryLearning();
  next.stats = next.stats || { updates_total: 0 };
  next.stats.updates_total += 1;

  const successSignal = buildSuccessSignal(summary);
  const brand = String(job?.identityLock?.brand || '').trim().toLowerCase();
  const focusFields = [
    ...new Set([
      ...toArray(summary?.missing_required_fields),
      ...toArray(summary?.critical_fields_below_pass_target),
      ...toArray(job?.requirements?.llmTargetFields)
    ])
  ];
  const providers = {};
  for (const row of toArray(discoveryResult?.candidates)) {
    const provider = String(row.provider || '').trim().toLowerCase();
    if (!provider) {
      continue;
    }
    providers[provider] = (providers[provider] || 0) + 1;
  }

  const queries = toArray(discoveryResult?.queries || discoveryResult?.llm_queries || [])
    .map(cleanQuery)
    .filter(Boolean);

  for (const query of queries) {
    const row = ensureQuery(next, query);
    row.attempts += 1;
    row.success_count = round((row.success_count || 0) + successSignal, 6);
    row.success_rate = round(row.success_count / Math.max(1, row.attempts), 6);
    if (brand) {
      row.brands[brand] = (row.brands[brand] || 0) + 1;
    }
    for (const field of focusFields) {
      row.fields[field] = (row.fields[field] || 0) + 1;
    }
    for (const [provider, count] of Object.entries(providers)) {
      row.providers[provider] = (row.providers[provider] || 0) + count;
    }
    row.last_seen_at = seenAt;
  }

  next.queries = trimQueries(next.queries);
  next.templates_by_field = {};
  for (const field of focusFields) {
    next.templates_by_field[field] = topQueriesForField(next.queries, field);
  }

  if (brand) {
    const rows = Object.values(next.queries)
      .filter((row) => (row.brands?.[brand] || 0) > 0)
      .sort((a, b) => {
        const left = (a.success_rate || 0) * Math.log(1 + (a.attempts || 1));
        const right = (b.success_rate || 0) * Math.log(1 + (b.attempts || 1));
        if (right !== left) {
          return right - left;
        }
        return a.query.localeCompare(b.query);
      })
      .slice(0, 80)
      .map((row) => ({
        query: row.query,
        attempts: row.attempts,
        success_rate: round(row.success_rate, 6)
      }));
    next.templates_by_brand[brand] = rows;
  }

  next.updated_at = seenAt;
  return next;
}
