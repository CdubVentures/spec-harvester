import fs from 'node:fs/promises';
import path from 'node:path';
import { extractRootDomain } from '../utils/common.js';
import { toPosixKey } from '../s3/storage.js';

const cache = new Map();

function normalizeHost(host) {
  return String(host || '').trim().toLowerCase().replace(/^www\./, '');
}

function hostMatches(host, candidate) {
  return host === candidate || host.endsWith(`.${candidate}`);
}

function flattenApprovedHosts(sources) {
  const byTier = sources?.approved || {};
  const hosts = [];
  for (const [tierName, tierHosts] of Object.entries(byTier)) {
    for (const host of tierHosts || []) {
      hosts.push({ host: normalizeHost(host), tierName });
    }
  }
  return hosts;
}

function tierToNumeric(tierName) {
  if (tierName === 'manufacturer' || tierName === 'lab') {
    return 1;
  }
  if (tierName === 'database') {
    return 2;
  }
  if (tierName === 'retailer') {
    return 3;
  }
  return 4;
}

export function resolveTierNameForHost(host, categoryConfig) {
  const norm = normalizeHost(host);
  for (const item of categoryConfig.sourceHosts) {
    if (hostMatches(norm, item.host)) {
      return item.tierName;
    }
  }
  return 'candidate';
}

export function resolveTierForHost(host, categoryConfig) {
  return tierToNumeric(resolveTierNameForHost(host, categoryConfig));
}

export function isApprovedHost(host, categoryConfig) {
  const norm = normalizeHost(host);
  return categoryConfig.sourceHosts.some((item) => hostMatches(norm, item.host));
}

export function isDeniedHost(host, categoryConfig) {
  const norm = normalizeHost(host);
  return (categoryConfig.denylist || []).some((entry) => hostMatches(norm, entry));
}

export function inferRoleForHost(host, categoryConfig) {
  const tierName = resolveTierNameForHost(host, categoryConfig);
  if (tierName === 'manufacturer') return 'manufacturer';
  if (tierName === 'lab') return 'review';
  if (tierName === 'database') return 'review';
  if (tierName === 'retailer') return 'retailer';
  return 'other';
}

export function isInstrumentedHost(host, categoryConfig) {
  const tierName = resolveTierNameForHost(host, categoryConfig);
  return tierName === 'lab';
}

function mergeUnique(arr = []) {
  return [...new Set((arr || []).map((item) => normalizeHost(item)).filter(Boolean))];
}

function mergeSources(baseSources, overrideSources) {
  if (!overrideSources || typeof overrideSources !== 'object') {
    return baseSources;
  }

  const mergedApproved = {};
  const baseApproved = baseSources?.approved || {};
  const overrideApproved = overrideSources?.approved || {};
  const tierNames = new Set([...Object.keys(baseApproved), ...Object.keys(overrideApproved)]);

  for (const tierName of tierNames) {
    mergedApproved[tierName] = mergeUnique([
      ...(baseApproved[tierName] || []),
      ...(overrideApproved[tierName] || [])
    ]);
  }

  return {
    approved: mergedApproved,
    denylist: mergeUnique([...(baseSources?.denylist || []), ...(overrideSources?.denylist || [])])
  };
}

function buildCategoryConfig({
  category,
  schema,
  sources,
  requiredFields,
  anchors,
  searchTemplates
}) {
  const sourceHosts = flattenApprovedHosts(sources);
  const denylist = (sources.denylist || []).map(normalizeHost);

  return {
    category,
    schema,
    sources,
    requiredFields,
    anchorFields: anchors,
    searchTemplates,
    sourceHosts,
    denylist,
    requiredFieldSet: new Set(requiredFields),
    criticalFieldSet: new Set(schema.critical_fields || []),
    editorialFieldSet: new Set(schema.editorial_fields || []),
    fieldOrder: schema.field_order || [],
    approvedRootDomains: new Set(sourceHosts.map((item) => extractRootDomain(item.host)))
  };
}

async function loadCategoryBaseConfig(category) {
  if (cache.has(category)) {
    return cache.get(category);
  }

  const baseDir = path.resolve('categories', category);
  const [schemaRaw, sourcesRaw, requiredRaw, anchorsRaw, searchTemplatesRaw] = await Promise.all([
    fs.readFile(path.join(baseDir, 'schema.json'), 'utf8'),
    fs.readFile(path.join(baseDir, 'sources.json'), 'utf8'),
    fs.readFile(path.join(baseDir, 'required_fields.json'), 'utf8'),
    fs.readFile(path.join(baseDir, 'anchors.json'), 'utf8'),
    fs.readFile(path.join(baseDir, 'search_templates.json'), 'utf8')
  ]);

  const schema = JSON.parse(schemaRaw);
  const sources = JSON.parse(sourcesRaw);
  const requiredFields = JSON.parse(requiredRaw);
  const anchors = JSON.parse(anchorsRaw);
  const searchTemplates = JSON.parse(searchTemplatesRaw);

  const config = buildCategoryConfig({
    category,
    schema,
    sources,
    requiredFields,
    anchors,
    searchTemplates
  });

  cache.set(category, config);
  return config;
}

export async function loadCategoryConfig(category, options = {}) {
  const baseConfig = await loadCategoryBaseConfig(category);

  const storage = options.storage;
  const config = options.config;

  if (!storage || !config) {
    return baseConfig;
  }

  const overrideKey = toPosixKey(
    config.s3InputPrefix,
    '_sources',
    'overrides',
    category,
    'sources.override.json'
  );

  const overrideSources = await storage.readJsonOrNull(overrideKey);
  if (!overrideSources) {
    return baseConfig;
  }

  const mergedSources = mergeSources(baseConfig.sources, overrideSources);

  return {
    ...buildCategoryConfig({
      category,
      schema: baseConfig.schema,
      sources: mergedSources,
      requiredFields: baseConfig.requiredFields,
      anchors: baseConfig.anchorFields,
      searchTemplates: baseConfig.searchTemplates
    }),
    sources_override_key: overrideKey
  };
}
