import { toPosixKey } from '../s3/storage.js';
import {
  inferRoleForHost,
  isApprovedHost,
  isDeniedHost,
  resolveTierForHost,
  resolveTierNameForHost
} from '../categories/loader.js';

function fillTemplate(template, variables) {
  return template
    .replaceAll('{brand}', variables.brand || '')
    .replaceAll('{model}', variables.model || '')
    .replaceAll('{variant}', variables.variant || '')
    .replaceAll('{category}', variables.category || '');
}

function normalizeHost(hostname) {
  return String(hostname || '').toLowerCase().replace(/^www\./, '');
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

function rankCandidate(candidate, categoryConfig) {
  const tier = resolveTierForHost(candidate.host, categoryConfig);
  let score = 0;
  if (tier === 1) score += 100;
  if (tier === 2) score += 70;
  if (tier === 3) score += 30;
  if (candidate.approvedDomain) score += 30;
  if (candidate.role === 'manufacturer') score += 40;
  return score;
}

export async function discoverCandidateSources({
  config,
  storage,
  categoryConfig,
  job,
  runId,
  logger
}) {
  if (!config.discoveryEnabled || config.searchProvider === 'none') {
    return {
      enabled: false,
      candidatesKey: null,
      candidates: []
    };
  }

  const variables = {
    brand: job.identityLock?.brand || '',
    model: job.identityLock?.model || '',
    variant: job.identityLock?.variant || '',
    category: job.category || categoryConfig.category
  };

  const templates = categoryConfig.searchTemplates || [];
  const queries = templates.map((template) => fillTemplate(template, variables)).filter(Boolean);

  const rawResults = [];
  for (const query of queries.slice(0, 6)) {
    try {
      let results = [];
      if (config.searchProvider === 'bing') {
        results = await searchBing({
          endpoint: config.bingSearchEndpoint,
          key: config.bingSearchKey,
          query,
          limit: 10
        });
      } else if (config.searchProvider === 'google_cse') {
        results = await searchGoogleCse({
          key: config.googleCseKey,
          cx: config.googleCseCx,
          query,
          limit: 10
        });
      }
      rawResults.push(...results.map((item) => ({ ...item, query })));
    } catch (error) {
      logger?.warn?.('discovery_query_failed', { query, message: error.message });
    }
  }

  const byUrl = new Map();
  for (const result of rawResults) {
    try {
      const parsed = new URL(result.url);
      if (parsed.protocol !== 'https:') {
        continue;
      }
      const host = normalizeHost(parsed.hostname);
      if (isDeniedHost(host, categoryConfig)) {
        continue;
      }

      if (!byUrl.has(parsed.toString())) {
        const approvedDomain = isApprovedHost(host, categoryConfig);
        byUrl.set(parsed.toString(), {
          url: parsed.toString(),
          host,
          rootDomain: host.split('.').slice(-2).join('.'),
          title: result.title,
          snippet: result.snippet,
          query: result.query,
          provider: result.source,
          approvedDomain,
          tier: resolveTierForHost(host, categoryConfig),
          tierName: resolveTierNameForHost(host, categoryConfig),
          role: inferRoleForHost(host, categoryConfig)
        });
      }
    } catch {
      // skip invalid url
    }
  }

  const candidates = [...byUrl.values()]
    .sort((a, b) => rankCandidate(b, categoryConfig) - rankCandidate(a, categoryConfig))
    .slice(0, 80);

  const candidatesKey = toPosixKey(
    config.s3InputPrefix,
    '_sources',
    'candidates',
    categoryConfig.category,
    `${runId}.json`
  );

  const payload = {
    category: categoryConfig.category,
    productId: job.productId,
    runId,
    generated_at: new Date().toISOString(),
    provider: config.searchProvider,
    candidate_count: candidates.length,
    candidates
  };

  await storage.writeObject(
    candidatesKey,
    Buffer.from(JSON.stringify(payload, null, 2), 'utf8'),
    {
      contentType: 'application/json'
    }
  );

  return {
    enabled: true,
    candidatesKey,
    candidates
  };
}
