import { extractRootDomain, normalizeToken } from '../utils/common.js';

function round(value, digits = 4) {
  return Number.parseFloat(Number(value || 0).toFixed(digits));
}

function toHost(value) {
  return String(value || '').trim().toLowerCase().replace(/^www\./, '');
}

function normalizeEndpointPath(pathname) {
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
      if (/^[a-z0-9_-]{16,}$/i.test(part)) {
        return ':token';
      }
      return part.toLowerCase();
    })
    .slice(0, 8);

  if (!parts.length) {
    return '/';
  }
  return `/${parts.join('/')}`;
}

function classifySignal(row, parsedUrl) {
  const classification = String(row.classification || '').toLowerCase();
  let score = 0;

  if (classification === 'specs' || classification === 'product_payload') {
    score += 3;
  } else if (classification === 'variant_matrix') {
    score += 2;
  }

  if (Boolean(row.isGraphQl)) {
    score += 2;
  }

  const method = String(row.request_method || 'GET').toUpperCase();
  if (method === 'POST') {
    score += 1;
  }

  const signalText = `${parsedUrl.pathname} ${parsedUrl.search}`.toLowerCase();
  if (/\b(api|graphql|product|spec|support|manual|datasheet|download)\b/.test(signalText)) {
    score += 1;
  }

  return score;
}

function collectFieldHints(text, criticalFields) {
  const token = normalizeToken(text);
  if (!token) {
    return [];
  }

  const hints = [];
  for (const field of criticalFields || []) {
    const normalizedField = String(field || '').toLowerCase();
    if (!normalizedField) {
      continue;
    }

    const fieldToken = normalizedField.replace(/_/g, ' ');
    const alternateToken = normalizedField.replace(/_/g, '');
    if (
      token.includes(fieldToken) ||
      (alternateToken && token.includes(alternateToken))
    ) {
      hints.push(normalizedField);
    }
  }

  return hints;
}

function addMapCount(map, key, delta = 1) {
  map[key] = (map[key] || 0) + delta;
}

function topEntries(countMap, limit = 3) {
  return Object.entries(countMap || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(1, limit))
    .map(([key]) => key);
}

function endpointSuggestionScore(endpoint) {
  const fieldBoost = Math.min(3, (endpoint.field_hints || []).length * 0.5);
  return round((endpoint.signal_score || 0) + fieldBoost + Math.min(2, (endpoint.hit_count || 0) / 3), 4);
}

function endpointLooksIndexable(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    if (path.endsWith('.json') || path.endsWith('.js')) {
      return false;
    }
    if (path.includes('/api/') || path.includes('/graphql')) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function mineEndpointSignals({
  source,
  pageData,
  criticalFields = [],
  limit = 30,
  suggestionLimit = 12
}) {
  const rows = pageData?.networkResponses || [];
  const bySignature = new Map();

  for (const row of rows.slice(0, 600)) {
    const endpointUrl = row.request_url || row.url;
    if (!endpointUrl) {
      continue;
    }

    let parsed;
    try {
      parsed = new URL(endpointUrl);
    } catch {
      continue;
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      continue;
    }

    const method = String(row.request_method || 'GET').toUpperCase();
    const host = toHost(parsed.hostname);
    if (!host) {
      continue;
    }

    const rootDomain = extractRootDomain(host);
    const normalizedPath = normalizeEndpointPath(parsed.pathname);
    const signature = `${method} ${rootDomain}${normalizedPath}`;

    if (!bySignature.has(signature)) {
      bySignature.set(signature, {
        signature,
        rootDomain,
        host,
        method,
        endpoint: `${rootDomain}${normalizedPath}`,
        normalized_path: normalizedPath,
        sample_url: `${parsed.origin}${parsed.pathname}`,
        hit_count: 0,
        graphql_hits: 0,
        status_counts: {},
        classifications: {},
        field_hints: new Set(),
        signal_score_total: 0,
        signal_score: 0
      });
    }

    const bucket = bySignature.get(signature);
    bucket.hit_count += 1;

    if (row.isGraphQl) {
      bucket.graphql_hits += 1;
    }

    const status = Number.parseInt(row.status || 0, 10);
    const statusBucket = status >= 500
      ? '5xx'
      : status >= 400
        ? '4xx'
        : status >= 300
          ? '3xx'
          : status >= 200
            ? '2xx'
            : 'other';
    addMapCount(bucket.status_counts, statusBucket);

    const classification = String(row.classification || 'unknown').toLowerCase();
    addMapCount(bucket.classifications, classification);

    const bodyPreview = row.jsonFull
      ? JSON.stringify(row.jsonFull).slice(0, 3000)
      : row.jsonPreview
        ? JSON.stringify(row.jsonPreview).slice(0, 3000)
        : '';
    const hintText = `${endpointUrl} ${classification} ${bodyPreview}`;
    for (const hint of collectFieldHints(hintText, criticalFields)) {
      bucket.field_hints.add(hint);
    }

    const signalScore = classifySignal(row, parsed);
    bucket.signal_score_total += signalScore;
    bucket.signal_score = Math.max(bucket.signal_score, signalScore);
  }

  const endpointSignals = [...bySignature.values()]
    .map((row) => {
      const classes = topEntries(row.classifications, 3);
      const okCount = (row.status_counts['2xx'] || 0) + (row.status_counts['3xx'] || 0);
      return {
        signature: row.signature,
        rootDomain: row.rootDomain,
        host: row.host,
        method: row.method,
        endpoint: row.endpoint,
        normalized_path: row.normalized_path,
        sample_url: row.sample_url,
        hit_count: row.hit_count,
        graphql_hits: row.graphql_hits,
        status_ok_rate: round(okCount / Math.max(1, row.hit_count), 6),
        top_classifications: classes,
        field_hints: [...row.field_hints].sort(),
        signal_score: round(row.signal_score_total / Math.max(1, row.hit_count), 4),
        max_signal_score: row.signal_score
      };
    })
    .sort((a, b) => {
      if ((b.max_signal_score || 0) !== (a.max_signal_score || 0)) {
        return (b.max_signal_score || 0) - (a.max_signal_score || 0);
      }
      if ((b.signal_score || 0) !== (a.signal_score || 0)) {
        return (b.signal_score || 0) - (a.signal_score || 0);
      }
      return (b.hit_count || 0) - (a.hit_count || 0);
    })
    .slice(0, Math.max(1, limit));

  const nextBestUrls = endpointSignals
    .filter((row) => endpointLooksIndexable(row.sample_url))
    .map((row) => ({
      url: row.sample_url,
      score: endpointSuggestionScore(row),
      reason: 'endpoint_signal',
      rootDomain: row.rootDomain,
      field_hints: row.field_hints,
      endpoint: row.endpoint,
      host: row.host,
      source_url: source?.url || ''
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, suggestionLimit));

  return {
    endpointSignals,
    nextBestUrls
  };
}

export function aggregateEndpointSignals(sourceResults, limit = 50) {
  const bySignature = new Map();

  for (const source of sourceResults || []) {
    for (const endpoint of source.endpointSignals || []) {
      const key = endpoint.signature || `${endpoint.method} ${endpoint.endpoint}`;
      if (!bySignature.has(key)) {
        bySignature.set(key, {
          ...endpoint,
          source_count: 0,
          source_urls: []
        });
      }

      const bucket = bySignature.get(key);
      bucket.hit_count = (bucket.hit_count || 0) + (endpoint.hit_count || 0);
      bucket.source_count += 1;
      bucket.max_signal_score = Math.max(
        bucket.max_signal_score || 0,
        endpoint.max_signal_score || endpoint.signal_score || 0
      );
      bucket.signal_score = round(
        ((bucket.signal_score || 0) + (endpoint.signal_score || 0)) / 2,
        4
      );
      bucket.field_hints = [...new Set([...(bucket.field_hints || []), ...(endpoint.field_hints || [])])];
      bucket.source_urls = [...new Set([...(bucket.source_urls || []), source.url || source.finalUrl || ''])]
        .filter(Boolean)
        .slice(0, 20);
    }
  }

  const ranked = [...bySignature.values()]
    .sort((a, b) => {
      if ((b.max_signal_score || 0) !== (a.max_signal_score || 0)) {
        return (b.max_signal_score || 0) - (a.max_signal_score || 0);
      }
      if ((b.signal_score || 0) !== (a.signal_score || 0)) {
        return (b.signal_score || 0) - (a.signal_score || 0);
      }
      return (b.hit_count || 0) - (a.hit_count || 0);
    })
    .slice(0, Math.max(1, limit));

  return {
    endpoint_count: ranked.length,
    top_endpoints: ranked
  };
}
