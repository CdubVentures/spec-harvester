function round(value, digits = 4) {
  return Number.parseFloat(Number(value || 0).toFixed(digits));
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function hasValue(value) {
  const token = String(value || '').trim().toLowerCase();
  return token !== '' && token !== 'unk';
}

function normalizePath(url) {
  try {
    const path = new URL(url).pathname.toLowerCase().replace(/\/+/g, '/');
    if (!path || path === '/') {
      return '/';
    }
    return path.endsWith('/') ? path.slice(0, -1) : path;
  } catch {
    return '/';
  }
}

function addSuggestion(map, field, suggestion) {
  if (!map.has(field)) {
    map.set(field, new Map());
  }

  const bucket = map.get(field);
  const key = String(suggestion.url || '').trim();
  if (!key) {
    return;
  }

  if (!bucket.has(key)) {
    bucket.set(key, {
      ...suggestion,
      reasons: [suggestion.reason]
    });
    return;
  }

  const prev = bucket.get(key);
  prev.score = Math.max(prev.score || 0, suggestion.score || 0);
  prev.reason = prev.reason || suggestion.reason;
  prev.rootDomain = prev.rootDomain || suggestion.rootDomain;
  prev.sourceType = prev.sourceType || suggestion.sourceType;
  prev.reasons = [...new Set([...(prev.reasons || []), suggestion.reason])];
}

function sourceQualityScore(source) {
  let score = 0;
  if (source.role === 'manufacturer') {
    score += 2.5;
  }
  if (source.approvedDomain) {
    score += 1.6;
  }
  if (source.identity?.match) {
    score += 1.2;
  }
  if ((source.anchorCheck?.majorConflicts || []).length === 0) {
    score += 0.4;
  }
  score += Math.max(0, 4 - (source.tier || 4)) * 0.4;
  return score;
}

function methodWeight(method) {
  const token = String(method || '').toLowerCase();
  if (token === 'network_json' || token === 'adapter_api') {
    return 1.4;
  }
  if (token === 'embedded_state' || token === 'pdf_table') {
    return 1.1;
  }
  if (token === 'ldjson') {
    return 0.9;
  }
  if (token === 'dom') {
    return 0.7;
  }
  return 0.6;
}

function collectFromSourceCandidates({ field, sourceResults, suggestionMap }) {
  for (const source of sourceResults || []) {
    if (
      source.role === 'manufacturer' &&
      (source.identity?.criticalConflicts || []).includes('brand_mismatch')
    ) {
      continue;
    }
    const quality = sourceQualityScore(source);
    for (const candidate of source.fieldCandidates || []) {
      if (candidate.field !== field || !hasValue(candidate.value)) {
        continue;
      }

      addSuggestion(suggestionMap, field, {
        url: source.finalUrl || source.url,
        reason: 'existing_evidence_not_confirmed',
        sourceType: 'source_candidate',
        rootDomain: source.rootDomain || source.host,
        score: round(quality + methodWeight(candidate.method), 4),
        field,
        method: candidate.method,
        keyPath: candidate.keyPath
      });
    }
  }
}

function collectFromEndpointSignals({ field, sourceResults, suggestionMap }) {
  for (const source of sourceResults || []) {
    if (
      source.role === 'manufacturer' &&
      (source.identity?.criticalConflicts || []).includes('brand_mismatch')
    ) {
      continue;
    }
    for (const endpoint of source.endpointSuggestions || []) {
      const hints = endpoint.field_hints || [];
      if (!hints.includes(field)) {
        continue;
      }

      addSuggestion(suggestionMap, field, {
        url: endpoint.url,
        reason: 'endpoint_signal',
        sourceType: 'endpoint',
        rootDomain: endpoint.rootDomain || source.rootDomain || source.host,
        score: round((endpoint.score || 0) + sourceQualityScore(source) * 0.4, 4),
        field,
        endpoint: endpoint.endpoint
      });
    }
  }
}

function collectFromSourceIntel({ field, sourceIntelDomains, suggestionMap, brandKey = '' }) {
  for (const domain of Object.values(sourceIntelDomains || {})) {
    const brandStats = brandKey && domain?.per_brand?.[brandKey]
      ? domain.per_brand[brandKey]
      : null;
    if (brandKey && !brandStats) {
      continue;
    }
    const activeStats = brandStats || domain;

    const helpfulness = Number.parseFloat(String(activeStats.per_field_helpfulness?.[field] || 0));
    if (!Number.isFinite(helpfulness) || helpfulness <= 0) {
      continue;
    }

    const plannerScore = Number.parseFloat(String(activeStats.planner_score || domain.planner_score || 0));
    const topPaths = Object.values(domain.per_path || {})
      .filter((pathRow) => Number.parseFloat(String(pathRow.per_field_helpfulness?.[field] || 0)) > 0)
      .sort((a, b) => (b.planner_score || 0) - (a.planner_score || 0))
      .slice(0, 4);

    if (!topPaths.length) {
      addSuggestion(suggestionMap, field, {
        url: `https://${domain.rootDomain}/`,
        reason: 'historical_field_helpfulness',
        sourceType: 'source_intel',
        rootDomain: domain.rootDomain,
        score: round((helpfulness / 10) + plannerScore + 0.2, 4),
        field
      });
      continue;
    }

    for (const pathRow of topPaths) {
      const path = String(pathRow.path || '/');
      addSuggestion(suggestionMap, field, {
        url: `https://${domain.rootDomain}${path.startsWith('/') ? path : `/${path}`}`,
        reason: 'historical_field_helpfulness',
        sourceType: 'source_intel',
        rootDomain: domain.rootDomain,
        score: round((helpfulness / 12) + (pathRow.planner_score || plannerScore || 0) + 0.3, 4),
        field,
        path
      });
    }
  }
}

function buildFieldPriority({ field, criticalSet, provenance }) {
  const isCritical = criticalSet.has(field);
  const row = provenance?.[field] || {};
  const confidence = Number.parseFloat(String(row.confidence || 0));
  const missingBoost = hasValue(row.value) ? 0 : 0.8;
  const passGapBoost = row.meets_pass_target === false ? 0.4 : 0;
  return round(
    (isCritical ? 2 : 1) +
      missingBoost +
      passGapBoost +
      (1 - Math.max(0, Math.min(1, confidence))),
    4
  );
}

export function buildHypothesisQueue({
  criticalFieldsBelowPassTarget = [],
  missingRequiredFields = [],
  provenance = {},
  sourceResults = [],
  sourceIntelDomains = {},
  brand = '',
  criticalFieldSet = new Set(),
  maxItems = 40,
  perFieldLimit = 8
}) {
  const targetFields = [...new Set([
    ...(criticalFieldsBelowPassTarget || []),
    ...(missingRequiredFields || [])
  ])]
    .filter(Boolean);
  const brandKey = slug(brand);

  const suggestionMap = new Map();

  for (const field of targetFields) {
    collectFromSourceCandidates({ field, sourceResults, suggestionMap });
    collectFromEndpointSignals({ field, sourceResults, suggestionMap });
    collectFromSourceIntel({ field, sourceIntelDomains, suggestionMap, brandKey });
  }

  const queue = [];
  for (const field of targetFields) {
    const bucket = suggestionMap.get(field);
    const suggestions = bucket
      ? [...bucket.values()]
          .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))
          .slice(0, Math.max(1, perFieldLimit))
          .map((row) => ({
            ...row,
            path: normalizePath(row.url)
          }))
      : [];

    queue.push({
      field,
      priority: buildFieldPriority({
        field,
        criticalSet: criticalFieldSet,
        provenance
      }),
      suggestion_count: suggestions.length,
      suggestions
    });
  }

  return queue
    .sort((a, b) => b.priority - a.priority || b.suggestion_count - a.suggestion_count || a.field.localeCompare(b.field))
    .slice(0, Math.max(1, maxItems));
}

export function nextBestUrlsFromHypotheses({ hypothesisQueue = [], field = '', limit = 10 }) {
  const targetField = String(field || '').trim().toLowerCase();
  const urls = [];

  for (const row of hypothesisQueue || []) {
    if (targetField && String(row.field || '').toLowerCase() !== targetField) {
      continue;
    }
    for (const suggestion of row.suggestions || []) {
      urls.push({
        field: row.field,
        priority: row.priority,
        ...suggestion
      });
    }
  }

  return urls
    .sort((a, b) => {
      if ((b.priority || 0) !== (a.priority || 0)) {
        return (b.priority || 0) - (a.priority || 0);
      }
      if ((b.score || 0) !== (a.score || 0)) {
        return (b.score || 0) - (a.score || 0);
      }
      return String(a.url || '').localeCompare(String(b.url || ''));
    })
    .slice(0, Math.max(1, limit));
}
