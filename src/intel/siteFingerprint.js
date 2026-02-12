import crypto from 'node:crypto';

function normalizePath(pathname) {
  const parts = String(pathname || '/')
    .split('/')
    .filter(Boolean)
    .map((part) => {
      if (/^[0-9]+$/.test(part)) {
        return ':id';
      }
      if (/^[a-f0-9]{8,}$/i.test(part)) {
        return ':hex';
      }
      return part.toLowerCase();
    })
    .slice(0, 8);

  if (!parts.length) {
    return '/';
  }
  return `/${parts.join('/')}`;
}

function topCounts(map, limit = 8) {
  return Object.entries(map || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(1, limit))
    .map(([key, count]) => ({ key, count }));
}

function safeTopKeys(input, limit = 20) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return [];
  }
  return Object.keys(input)
    .slice(0, Math.max(1, limit))
    .sort();
}

function countMethods(candidates) {
  const map = {};
  for (const row of candidates || []) {
    const method = String(row.method || 'unknown');
    map[method] = (map[method] || 0) + 1;
  }
  return map;
}

export function buildSiteFingerprint({ source, pageData }) {
  const html = String(pageData?.html || '');
  const title = String(pageData?.title || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const finalUrl = String(pageData?.finalUrl || source?.url || '');

  let normalizedPath = '/';
  try {
    normalizedPath = normalizePath(new URL(finalUrl).pathname || '/');
  } catch {
    normalizedPath = '/';
  }

  const classCounts = {};
  for (const row of pageData?.networkResponses || []) {
    const key = String(row.classification || 'unknown').toLowerCase();
    classCounts[key] = (classCounts[key] || 0) + 1;
  }

  const signal = {
    host: String(source?.rootDomain || source?.host || '').toLowerCase(),
    path_shape: normalizedPath,
    has_ldjson: (pageData?.ldjsonBlocks || []).length > 0,
    has_embedded_state: Boolean(pageData?.embeddedState && typeof pageData.embeddedState === 'object'),
    embedded_keys: safeTopKeys(pageData?.embeddedState, 18),
    ldjson_types: (pageData?.ldjsonBlocks || [])
      .map((row) => String(row['@type'] || row.type || '').toLowerCase())
      .filter(Boolean)
      .slice(0, 12)
      .sort(),
    script_tag_count: (html.match(/<script\b/gi) || []).length,
    table_count: (html.match(/<table\b/gi) || []).length,
    network_classes: topCounts(classCounts, 8),
    title_signature: title.slice(0, 90)
  };

  const id = crypto
    .createHash('sha1')
    .update(JSON.stringify(signal))
    .digest('hex')
    .slice(0, 16);

  return {
    id,
    signal
  };
}

export function computeParserHealth({
  source,
  mergedFieldCandidates,
  identity,
  anchorCheck,
  criticalFieldSet,
  endpointSignals = []
}) {
  const uniqueFields = new Set();
  const uniqueCriticalFields = new Set();

  for (const candidate of mergedFieldCandidates || []) {
    const field = String(candidate.field || '');
    if (!field) {
      continue;
    }
    uniqueFields.add(field);
    if (criticalFieldSet?.has(field)) {
      uniqueCriticalFields.add(field);
    }
  }

  const majorConflicts = (anchorCheck?.majorConflicts || []).length;
  const methods = countMethods(mergedFieldCandidates);
  const criticalCoverage = criticalFieldSet?.size
    ? uniqueCriticalFields.size / criticalFieldSet.size
    : 0;

  let score = 0;
  score += Math.min(0.5, uniqueFields.size / 40);
  score += Math.min(0.25, criticalCoverage * 0.8);
  score += identity?.match ? 0.15 : 0;
  score += majorConflicts === 0 ? 0.1 : -0.1;
  score += endpointSignals.length > 0 ? 0.05 : 0;

  if ((mergedFieldCandidates || []).length === 0) {
    score -= 0.2;
  }

  return {
    role: source?.role || 'other',
    candidate_count: (mergedFieldCandidates || []).length,
    unique_field_count: uniqueFields.size,
    critical_field_hits: uniqueCriticalFields.size,
    critical_coverage: Number.parseFloat(criticalCoverage.toFixed(6)),
    method_counts: methods,
    identity_match: Boolean(identity?.match),
    major_anchor_conflicts: majorConflicts,
    endpoint_signal_count: endpointSignals.length,
    health_score: Number.parseFloat(Math.max(0, Math.min(1, score)).toFixed(6))
  };
}
