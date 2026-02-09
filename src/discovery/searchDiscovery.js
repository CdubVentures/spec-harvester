import { toPosixKey } from '../s3/storage.js';
import {
  inferRoleForHost,
  isApprovedHost,
  isDeniedHost,
  resolveTierForHost,
  resolveTierNameForHost
} from '../categories/loader.js';
import { extractRootDomain } from '../utils/common.js';
import { planDiscoveryQueriesLLM } from '../llm/discoveryPlanner.js';

function fillTemplate(template, variables) {
  return template
    .replaceAll('{brand}', variables.brand || '')
    .replaceAll('{model}', variables.model || '')
    .replaceAll('{variant}', variables.variant || '')
    .replaceAll('{category}', variables.category || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeHost(hostname) {
  return String(hostname || '').toLowerCase().replace(/^www\./, '');
}

function classifyUrlCandidate(result, categoryConfig) {
  const parsed = new URL(result.url);
  const host = normalizeHost(parsed.hostname);
  const approvedDomain = isApprovedHost(host, categoryConfig);

  return {
    url: parsed.toString(),
    host,
    rootDomain: extractRootDomain(host),
    title: result.title || '',
    snippet: result.snippet || '',
    query: result.query || '',
    provider: result.source || result.provider || 'plan',
    approvedDomain,
    tier: resolveTierForHost(host, categoryConfig),
    tierName: resolveTierNameForHost(host, categoryConfig),
    role: inferRoleForHost(host, categoryConfig)
  };
}

async function searchBing({ endpoint, key, query, limit }) {
  if (!endpoint || !key) {
    return [];
  }

  const url = new URL(endpoint);
  if (!url.pathname || url.pathname === '/') {
    url.pathname = '/v7.0/search';
  }
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(limit));

  const response = await fetch(url, {
    headers: {
      'Ocp-Apim-Subscription-Key': key
    }
  });

  if (!response.ok) {
    return [];
  }

  const data = await response.json();
  return (data.webPages?.value || []).map((item) => ({
    url: item.url,
    title: item.name || '',
    snippet: item.snippet || '',
    source: 'bing'
  }));
}

async function searchGoogleCse({ key, cx, query, limit }) {
  if (!key || !cx) {
    return [];
  }

  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', key);
  url.searchParams.set('cx', cx);
  url.searchParams.set('q', query);
  url.searchParams.set('num', String(Math.min(10, limit)));

  const response = await fetch(url);
  if (!response.ok) {
    return [];
  }

  const data = await response.json();
  return (data.items || []).map((item) => ({
    url: item.link,
    title: item.title || '',
    snippet: item.snippet || '',
    source: 'google_cse'
  }));
}

function buildPlanOnlyResults({ categoryConfig, queries }) {
  const planned = [];

  for (const sourceHost of categoryConfig.sourceHosts || []) {
    for (const query of queries.slice(0, 3)) {
      planned.push({
        url: `https://${sourceHost.host}/search?q=${encodeURIComponent(query)}`,
        title: `${sourceHost.host} search`,
        snippet: 'planned source search URL',
        source: 'plan',
        query
      });
    }
  }

  return planned;
}

function rankCandidate(candidate) {
  let score = 0;
  if (candidate.approvedDomain) {
    score += 30;
  }
  if (candidate.tier === 1) {
    score += 100;
  } else if (candidate.tier === 2) {
    score += 70;
  } else if (candidate.tier === 3) {
    score += 30;
  }
  if (candidate.role === 'manufacturer') {
    score += 40;
  }
  return score;
}

export async function discoverCandidateSources({
  config,
  storage,
  categoryConfig,
  job,
  runId,
  logger,
  planningHints = {}
}) {
  if (!config.discoveryEnabled) {
    return {
      enabled: false,
      discoveryKey: null,
      candidatesKey: null,
      candidates: [],
      approvedUrls: [],
      candidateUrls: []
    };
  }

  const variables = {
    brand: job.identityLock?.brand || '',
    model: job.identityLock?.model || '',
    variant: job.identityLock?.variant || '',
    category: job.category || categoryConfig.category
  };

  const templates = categoryConfig.searchTemplates || [];
  const baseQueries = templates.map((template) => fillTemplate(template, variables)).filter(Boolean);
  const llmQueries = await planDiscoveryQueriesLLM({
    job,
    categoryConfig,
    baseQueries,
    missingCriticalFields: planningHints.missingCriticalFields || [],
    config,
    logger
  });
  const queries = [...new Set([...baseQueries, ...llmQueries])];

  const rawResults = [];
  if (config.searchProvider === 'bing' || config.searchProvider === 'google_cse') {
    for (const query of queries.slice(0, 8)) {
      try {
        let results = [];
        if (config.searchProvider === 'bing') {
          results = await searchBing({
            endpoint: config.bingSearchEndpoint,
            key: config.bingSearchKey,
            query,
            limit: 10
          });
        } else {
          results = await searchGoogleCse({
            key: config.googleCseKey,
            cx: config.googleCseCx,
            query,
            limit: 10
          });
        }
        rawResults.push(...results.map((result) => ({ ...result, query })));
      } catch (error) {
        logger?.warn?.('discovery_query_failed', { query, message: error.message });
      }
    }
  } else {
    rawResults.push(...buildPlanOnlyResults({ categoryConfig, queries }));
  }

  const byUrl = new Map();
  for (const raw of rawResults) {
    try {
      const parsed = new URL(raw.url);
      if (parsed.protocol !== 'https:') {
        continue;
      }
      const host = normalizeHost(parsed.hostname);
      if (isDeniedHost(host, categoryConfig)) {
        continue;
      }

      const normalized = classifyUrlCandidate(raw, categoryConfig);
      if (!byUrl.has(normalized.url)) {
        byUrl.set(normalized.url, normalized);
      }
    } catch {
      // ignore malformed URL
    }
  }

  const discovered = [...byUrl.values()]
    .sort((a, b) => rankCandidate(b) - rankCandidate(a))
    .slice(0, 120);

  const candidateOnly = discovered.filter((item) => !item.approvedDomain);
  const approvedOnly = discovered.filter((item) => item.approvedDomain);

  const discoveryKey = toPosixKey(
    config.s3InputPrefix,
    '_discovery',
    categoryConfig.category,
    `${runId}.json`
  );

  const candidatesKey = toPosixKey(
    config.s3InputPrefix,
    '_sources',
    'candidates',
    categoryConfig.category,
    `${runId}.json`
  );

  const discoveryPayload = {
    category: categoryConfig.category,
    productId: job.productId,
    runId,
    generated_at: new Date().toISOString(),
    provider: config.searchProvider,
    llm_query_planning: Boolean(config.llmEnabled && config.llmPlanDiscoveryQueries),
    query_count: queries.length,
    discovered_count: discovered.length,
    approved_count: approvedOnly.length,
    candidate_count: candidateOnly.length,
    queries,
    discovered
  };

  const candidatePayload = {
    category: categoryConfig.category,
    productId: job.productId,
    runId,
    generated_at: new Date().toISOString(),
    candidate_count: candidateOnly.length,
    candidates: candidateOnly
  };

  await storage.writeObject(discoveryKey, Buffer.from(JSON.stringify(discoveryPayload, null, 2), 'utf8'), {
    contentType: 'application/json'
  });

  await storage.writeObject(candidatesKey, Buffer.from(JSON.stringify(candidatePayload, null, 2), 'utf8'), {
    contentType: 'application/json'
  });

  return {
    enabled: true,
    discoveryKey,
    candidatesKey,
    candidates: discovered,
    approvedUrls: approvedOnly.map((item) => item.url),
    candidateUrls: candidateOnly.map((item) => item.url)
  };
}
