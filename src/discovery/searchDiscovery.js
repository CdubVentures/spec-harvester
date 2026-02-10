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
import { runSearchProviders, searchProviderAvailability } from '../search/searchProviders.js';
import { rerankSearchResults } from '../search/resultReranker.js';
import { buildTargetedQueries } from '../search/queryBuilder.js';

function fillTemplate(template, variables) {
  return String(template || '')
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
  return {
    url: parsed.toString(),
    host,
    rootDomain: extractRootDomain(host),
    title: result.title || '',
    snippet: result.snippet || '',
    query: result.query || '',
    provider: result.provider || result.source || 'plan',
    approvedDomain: isApprovedHost(host, categoryConfig),
    tier: resolveTierForHost(host, categoryConfig),
    tierName: resolveTierNameForHost(host, categoryConfig),
    role: inferRoleForHost(host, categoryConfig)
  };
}

function buildPlanOnlyResults({ categoryConfig, queries, maxQueries = 3 }) {
  const planned = [];
  for (const sourceHost of categoryConfig.sourceHosts || []) {
    for (const query of queries.slice(0, Math.max(1, maxQueries))) {
      planned.push({
        url: `https://${sourceHost.host}/search?q=${encodeURIComponent(query)}`,
        title: `${sourceHost.host} search`,
        snippet: 'planned source search URL',
        provider: 'plan',
        query
      });
    }
  }
  return planned;
}

function dedupeQueries(queries, limit) {
  return [...new Set((queries || []).map((query) => String(query || '').trim()).filter(Boolean))]
    .slice(0, Math.max(1, limit));
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

async function loadLearningArtifacts({
  storage,
  category
}) {
  const base = storage.resolveOutputKey('_learning', category);
  const [lexicon, queryTemplates, fieldYield] = await Promise.all([
    storage.readJsonOrNull(`${base}/field_lexicon.json`),
    storage.readJsonOrNull(`${base}/query_templates.json`),
    storage.readJsonOrNull(`${base}/field_yield.json`)
  ]);
  return {
    lexicon: lexicon || {},
    queryTemplates: queryTemplates || {},
    fieldYield: fieldYield || {}
  };
}

export async function discoverCandidateSources({
  config,
  storage,
  categoryConfig,
  job,
  runId,
  logger,
  planningHints = {},
  llmContext = {}
}) {
  if (!config.discoveryEnabled) {
    return {
      enabled: false,
      discoveryKey: null,
      candidatesKey: null,
      candidates: [],
      approvedUrls: [],
      candidateUrls: [],
      queries: [],
      llm_queries: []
    };
  }

  const variables = {
    brand: job.identityLock?.brand || '',
    model: job.identityLock?.model || '',
    variant: job.identityLock?.variant || '',
    category: job.category || categoryConfig.category
  };
  const missingFields = [
    ...new Set([
      ...toArray(planningHints.missingRequiredFields),
      ...toArray(planningHints.missingCriticalFields),
      ...toArray(job.requirements?.llmTargetFields)
    ])
  ];

  const learning = await loadLearningArtifacts({
    storage,
    category: categoryConfig.category
  });
  const baseQueries = toArray(categoryConfig.searchTemplates)
    .map((template) => fillTemplate(template, variables))
    .filter(Boolean);
  const targetedQueries = buildTargetedQueries({
    job,
    categoryConfig,
    missingFields,
    lexicon: learning.lexicon,
    learnedQueries: learning.queryTemplates,
    maxQueries: Math.max(6, Number(config.discoveryMaxQueries || 8) * 2)
  });
  const llmQueries = await planDiscoveryQueriesLLM({
    job,
    categoryConfig,
    baseQueries: [...baseQueries, ...targetedQueries],
    missingCriticalFields: planningHints.missingCriticalFields || [],
    config,
    logger,
    llmContext
  });

  const extraQueries = toArray(planningHints.extraQueries);
  const queryLimit = Math.max(1, Number(config.discoveryMaxQueries || 8));
  const queries = dedupeQueries(
    [...baseQueries, ...targetedQueries, ...llmQueries, ...extraQueries],
    Math.max(queryLimit, 6)
  );
  const resultsPerQuery = Math.max(1, Number(config.discoveryResultsPerQuery || 10));
  const discoveryCap = Math.max(1, Number(config.discoveryMaxDiscovered || 120));

  const providerState = searchProviderAvailability(config);
  const rawResults = [];
  const searchAttempts = [];

  const canSearchInternet =
    providerState.provider !== 'none' &&
    (
      (providerState.provider === 'bing' && providerState.bing_ready) ||
      (providerState.provider === 'google' && providerState.google_ready) ||
      (providerState.provider === 'dual' && (providerState.bing_ready || providerState.google_ready))
    );

  if (canSearchInternet) {
    for (const query of queries.slice(0, queryLimit)) {
      const providerResults = await runSearchProviders({
        config,
        query,
        limit: resultsPerQuery,
        logger
      });
      rawResults.push(...providerResults.map((row) => ({ ...row, query })));
      searchAttempts.push({
        query,
        provider: config.searchProvider,
        result_count: providerResults.length
      });
    }
  } else {
    const planned = buildPlanOnlyResults({
      categoryConfig,
      queries,
      maxQueries: Math.min(queryLimit, 12)
    });
    rawResults.push(...planned);
    searchAttempts.push({
      query: '',
      provider: 'plan',
      result_count: planned.length
    });
  }

  const byUrl = new Map();
  for (const raw of rawResults) {
    try {
      const parsed = new URL(raw.url);
      if (parsed.protocol !== 'https:') {
        continue;
      }
      const host = normalizeHost(parsed.hostname);
      if (!host || isDeniedHost(host, categoryConfig)) {
        continue;
      }
      if (!byUrl.has(parsed.toString())) {
        byUrl.set(parsed.toString(), classifyUrlCandidate(raw, categoryConfig));
      }
    } catch {
      // ignore malformed URL
    }
  }

  const reranked = rerankSearchResults({
    results: [...byUrl.values()],
    categoryConfig,
    missingFields,
    fieldYieldMap: learning.fieldYield
  });
  const discovered = reranked.slice(0, discoveryCap);

  const approvedOnly = discovered.filter((item) => item.approved_domain || item.approvedDomain);
  const candidateOnly = discovered.filter((item) => !(item.approved_domain || item.approvedDomain));

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
    provider_state: providerState,
    llm_query_planning: Boolean(config.llmEnabled && config.llmPlanDiscoveryQueries),
    query_count: queries.length,
    discovered_count: discovered.length,
    approved_count: approvedOnly.length,
    candidate_count: candidateOnly.length,
    queries,
    llm_queries: llmQueries,
    targeted_missing_fields: missingFields,
    search_attempts: searchAttempts,
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

  await storage.writeObject(
    discoveryKey,
    Buffer.from(JSON.stringify(discoveryPayload, null, 2), 'utf8'),
    { contentType: 'application/json' }
  );
  await storage.writeObject(
    candidatesKey,
    Buffer.from(JSON.stringify(candidatePayload, null, 2), 'utf8'),
    { contentType: 'application/json' }
  );

  return {
    enabled: true,
    discoveryKey,
    candidatesKey,
    candidates: discovered,
    approvedUrls: approvedOnly.map((item) => item.url),
    candidateUrls: candidateOnly.map((item) => item.url),
    queries,
    llm_queries: llmQueries,
    search_attempts: searchAttempts
  };
}
