import {
  inferRoleForHost,
  isApprovedHost,
  isDeniedHost,
  resolveTierForHost,
  resolveTierNameForHost
} from '../categories/loader.js';
import { extractRootDomain } from '../utils/common.js';
import { normalizeFieldList } from '../utils/fieldKeys.js';

function normalizeHost(value) {
  return String(value || '').toLowerCase().replace(/^www\./, '');
}

function textScore(text, tokens) {
  const haystack = String(text || '').toLowerCase();
  let score = 0;
  for (const token of tokens || []) {
    if (haystack.includes(String(token || '').toLowerCase())) {
      score += 1;
    }
  }
  return score;
}

function parseCandidateUrl(url) {
  try {
    const parsed = new URL(url);
    return {
      url: parsed.toString(),
      host: normalizeHost(parsed.hostname),
      path: String(parsed.pathname || '/').toLowerCase(),
      query: String(parsed.search || '').toLowerCase()
    };
  } catch {
    return null;
  }
}

function computeScore(row, { categoryConfig, missingFields, fieldYieldMap }) {
  const parsed = parseCandidateUrl(row.url);
  if (!parsed) {
    return Number.NEGATIVE_INFINITY;
  }
  if (isDeniedHost(parsed.host, categoryConfig)) {
    return Number.NEGATIVE_INFINITY;
  }

  const rootDomain = extractRootDomain(parsed.host);
  let score = 0;
  if (isApprovedHost(parsed.host, categoryConfig)) {
    score += 40;
  }
  const tier = resolveTierForHost(parsed.host, categoryConfig);
  if (tier === 1) score += 50;
  if (tier === 2) score += 35;
  if (tier === 3) score += 20;

  const role = inferRoleForHost(parsed.host, categoryConfig);
  if (role === 'manufacturer') score += 30;
  if (role === 'review') score += 12;
  if (role === 'manufacturer' && /manual|datasheet|support|spec|product/.test(parsed.path)) {
    score += 20;
  }

  if (/manual|datasheet|spec|support|download|technical/.test(parsed.path)) {
    score += 18;
  }
  if (parsed.path.endsWith('.pdf')) {
    score += 12;
  }
  if (/forum|community|reddit|news|blog|shop\/c\//.test(parsed.path)) {
    score -= 15;
  }

  const tokenPool = [
    ...(missingFields || []).map((field) => String(field || '').replace(/_/g, ' ')),
    row.title || '',
    row.snippet || ''
  ];
  score += textScore(`${row.title || ''} ${row.snippet || ''} ${parsed.path}`, tokenPool) * 2;

  const domainYield = fieldYieldMap?.by_domain?.[rootDomain];
  if (domainYield) {
    for (const field of missingFields || []) {
      const yieldRow = domainYield.fields?.[field];
      if (!yieldRow) {
        continue;
      }
      score += Math.max(0, Number.parseFloat(String(yieldRow.yield || 0)) * 12);
    }
  }

  return score;
}

export function rerankSearchResults({
  results = [],
  categoryConfig,
  missingFields = [],
  fieldYieldMap = {}
}) {
  const normalizedMissingFields = normalizeFieldList(missingFields, {
    fieldOrder: categoryConfig?.fieldOrder || []
  });
  const rows = [];
  const dedupe = new Set();
  for (const row of results || []) {
    const parsed = parseCandidateUrl(row.url);
    if (!parsed) {
      continue;
    }
    if (dedupe.has(parsed.url)) {
      continue;
    }
    dedupe.add(parsed.url);
    const score = computeScore(row, {
      categoryConfig,
      missingFields: normalizedMissingFields,
      fieldYieldMap
    });
    if (!Number.isFinite(score)) {
      continue;
    }
    rows.push({
      ...row,
      url: parsed.url,
      host: parsed.host,
      rootDomain: extractRootDomain(parsed.host),
      path: parsed.path,
      tier: resolveTierForHost(parsed.host, categoryConfig),
      tier_name: resolveTierNameForHost(parsed.host, categoryConfig),
      role: inferRoleForHost(parsed.host, categoryConfig),
      approved_domain: isApprovedHost(parsed.host, categoryConfig),
      score
    });
  }

  return rows.sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));
}
