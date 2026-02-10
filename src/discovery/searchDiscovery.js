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
import { normalizeFieldList } from '../utils/fieldKeys.js';

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

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function tokenize(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

const BRAND_HOST_HINTS = {
  logitech: ['logitech', 'logitechg', 'logi'],
  razer: ['razer'],
  steelseries: ['steelseries'],
  zowie: ['zowie', 'benq'],
  benq: ['benq', 'zowie'],
  finalmouse: ['finalmouse'],
  lamzu: ['lamzu'],
  pulsar: ['pulsar'],
  corsair: ['corsair'],
  glorious: ['glorious'],
  endgame: ['endgamegear', 'endgame-gear']
};

function manufacturerHostHintsForBrand(brand) {
  const hints = new Set(tokenize(brand));
  const brandSlug = slug(brand);
  for (const [key, aliases] of Object.entries(BRAND_HOST_HINTS)) {
    if (brandSlug.includes(key) || hints.has(key)) {
      for (const alias of aliases) {
        hints.add(alias);
      }
    }
  }
  return [...hints];
}

function manufacturerHostMatchesBrand(host, hints) {
  const normalizedHost = normalizeHost(host);
  if (!normalizedHost || !hints.length) {
    return true;
  }
  return hints.some((hint) => hint && normalizedHost.includes(hint));
}

function productText(variables = {}) {
  return [variables.brand, variables.model, variables.variant]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

function buildModelSlugCandidates(variables = {}) {
  const entries = [];
  const brandSlug = slug(variables.brand || '');
  const modelSlug = slug(variables.model || '');
  const variantSlug = slug(variables.variant || '');
  const combinedModel = slug([variables.model, variables.variant].filter(Boolean).join(' '));
  const brandModel = slug([variables.brand, variables.model, variables.variant].filter(Boolean).join(' '));

  for (const value of [combinedModel, modelSlug, brandModel]) {
    if (value) {
      entries.push(value);
    }
  }
  if (modelSlug && variantSlug) {
    entries.push(`${modelSlug}-${variantSlug}`);
  }
  if (brandSlug && modelSlug) {
    entries.push(`${brandSlug}-${modelSlug}`);
    if (variantSlug) {
      entries.push(`${brandSlug}-${modelSlug}-${variantSlug}`);
    }
  }

  const unique = [];
  const seen = new Set();
  for (const value of entries) {
    const token = String(value || '').trim();
    if (!token || seen.has(token)) {
      continue;
    }
    seen.add(token);
    unique.push(token);
  }
  return unique.slice(0, 6);
}

function categoryPathSegments(category) {
  const token = slug(category || '');
  if (!token) {
    return [];
  }
  if (token === 'mouse') {
    return ['mouse', 'mice', 'gaming-mice'];
  }
  if (token === 'keyboard') {
    return ['keyboard', 'keyboards', 'gaming-keyboards'];
  }
  if (token === 'headset') {
    return ['headset', 'headsets', 'gaming-headsets'];
  }
  return [token, `${token}s`];
}

function buildManufacturerPlanUrls({ host, variables, queries, maxQueries = 3 }) {
  const urls = [];
  const product = productText(variables);
  const queryText = product || queries[0] || '';
  const slugs = buildModelSlugCandidates(variables);
  const brandSlug = slug(variables.brand || '');
  const categorySegments = categoryPathSegments(variables.category);

  const add = (path, query = '') => {
    const value = `https://${host}${path}`;
    if (!urls.some((row) => row.url === value)) {
      urls.push({
        url: value,
        title: `${host} planned manufacturer path`,
        snippet: 'planned manufacturer candidate URL',
        provider: 'plan',
        query
      });
    }
  };

  for (const modelSlug of slugs) {
    add(`/product/${modelSlug}`, queryText);
    add(`/products/${modelSlug}`, queryText);
    add(`/p/${modelSlug}`, queryText);
    add(`/${modelSlug}`, queryText);
    add(`/support/${modelSlug}`, queryText);
    add(`/manual/${modelSlug}`, queryText);
    add(`/downloads/${modelSlug}`, queryText);
    add(`/specs/${modelSlug}`, queryText);
    for (const segment of categorySegments) {
      add(`/${segment}/${modelSlug}`, queryText);
    }
    add(`/en-us/product/${modelSlug}`, queryText);
    add(`/en-us/products/${modelSlug}`, queryText);
    for (const segment of categorySegments) {
      add(`/en-us/products/${segment}/${modelSlug}`, queryText);
    }
    if (brandSlug && !modelSlug.startsWith(`${brandSlug}-`)) {
      add(`/product/${brandSlug}-${modelSlug}`, queryText);
      add(`/products/${brandSlug}-${modelSlug}`, queryText);
      for (const segment of categorySegments) {
        add(`/${segment}/${brandSlug}-${modelSlug}`, queryText);
      }
      add(`/en-us/products/${brandSlug}-${modelSlug}`, queryText);
      for (const segment of categorySegments) {
        add(`/en-us/products/${segment}/${brandSlug}-${modelSlug}`, queryText);
      }
    }
  }

  for (const query of queries.slice(0, Math.max(1, maxQueries))) {
    add(`/search?q=${encodeURIComponent(query)}`, query);
    add(`/search?query=${encodeURIComponent(query)}`, query);
    add(`/support/search?query=${encodeURIComponent(query)}`, query);
  }

  return urls.slice(0, 40);
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

function buildPlanOnlyResults({ categoryConfig, queries, variables, maxQueries = 3 }) {
  const planned = [];
  for (const sourceHost of categoryConfig.sourceHosts || []) {
    const host = sourceHost.host;
    const role = sourceHost.role || sourceHost.tierName || '';
    if (String(role).toLowerCase() === 'manufacturer') {
      planned.push(
        ...buildManufacturerPlanUrls({
          host,
          variables,
          queries,
          maxQueries
        })
      );
      continue;
    }

    for (const query of queries.slice(0, Math.max(1, maxQueries))) {
      planned.push({
        url: `https://${host}/search?q=${encodeURIComponent(query)}`,
        title: `${host} search`,
        snippet: 'planned source search URL',
        provider: 'plan',
        query
      });
      planned.push({
        url: `https://${host}/search/?q=${encodeURIComponent(query)}`,
        title: `${host} search`,
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

function prioritizeQueries(queries, variables = {}) {
  const brand = String(variables.brand || '').trim().toLowerCase();
  const model = String(variables.model || '').trim().toLowerCase();
  const brandToken = brand.replace(/\s+/g, '');
  const ranked = [...(queries || [])].map((query) => {
    const text = String(query || '').toLowerCase();
    let score = 0;
    if (text.includes('site:')) score += 6;
    if (/manual|datasheet|support|spec|technical|pdf/.test(text)) score += 5;
    if (brandToken && text.includes(brandToken)) score += 3;
    if (brand && text.includes(brand)) score += 2;
    if (model && text.includes(model)) score += 2;
    if (/rtings|techpowerup/.test(text)) score += 1;
    return {
      query,
      score
    };
  });
  return ranked
    .sort((a, b) => b.score - a.score || a.query.localeCompare(b.query))
    .map((row) => row.query);
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
  const missingFields = normalizeFieldList([
    ...toArray(planningHints.missingRequiredFields),
    ...toArray(planningHints.missingCriticalFields),
    ...toArray(job.requirements?.llmTargetFields)
  ], {
    fieldOrder: categoryConfig.fieldOrder || []
  });

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
  const queries = prioritizeQueries(dedupeQueries(
    [...baseQueries, ...targetedQueries, ...llmQueries, ...extraQueries],
    Math.max(queryLimit, 6)
  ), variables);
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
      logger?.info?.('discovery_query_started', {
        query,
        provider: config.searchProvider
      });
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
      logger?.info?.('discovery_query_completed', {
        query,
        provider: config.searchProvider,
        result_count: providerResults.length
      });
    }
  } else {
    const planned = buildPlanOnlyResults({
      categoryConfig,
      queries,
      variables,
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
  const manufacturerHostHints = manufacturerHostHintsForBrand(job.identityLock?.brand || '');
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
      const classified = classifyUrlCandidate(raw, categoryConfig);
      if (
        classified.role === 'manufacturer' &&
        manufacturerHostHints.length > 0 &&
        !manufacturerHostMatchesBrand(classified.host, manufacturerHostHints)
      ) {
        continue;
      }
      if (!byUrl.has(parsed.toString())) {
        byUrl.set(parsed.toString(), classified);
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
  const discoveredUrlSet = new Set(discovered.map((item) => item.url));
  const ensureTierCoverage = (tierName) => {
    const hasTier = discovered.some(
      (item) => String(item.tier_name || item.tierName || '').toLowerCase() === tierName
    );
    if (hasTier) {
      return;
    }
    const candidate = reranked.find(
      (item) =>
        String(item.tier_name || item.tierName || '').toLowerCase() === tierName &&
        !discoveredUrlSet.has(item.url)
    );
    if (!candidate) {
      return;
    }
    if (discovered.length >= discoveryCap && discovered.length > 0) {
      const removed = discovered.pop();
      discoveredUrlSet.delete(removed.url);
    }
    discovered.push(candidate);
    discoveredUrlSet.add(candidate.url);
  };
  ensureTierCoverage('lab');
  ensureTierCoverage('database');
  logger?.info?.('discovery_results_reranked', {
    discovered_count: discovered.length,
    approved_count: discovered.filter((item) => item.approved_domain || item.approvedDomain).length
  });

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
