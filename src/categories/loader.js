import fs from 'node:fs/promises';
import path from 'node:path';
import { extractRootDomain } from '../utils/common.js';
import { toPosixKey } from '../s3/storage.js';

const cache = new Map();

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

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

function normalizeField(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function ruleRequiredLevel(rule = {}) {
  return String(
    rule.required_level ||
    (isObject(rule.priority) ? rule.priority.required_level : '')
  ).trim().toLowerCase();
}

function ruleAvailability(rule = {}) {
  return String(
    rule.availability ||
    (isObject(rule.priority) ? rule.priority.availability : '')
  ).trim().toLowerCase();
}

function ruleDifficulty(rule = {}) {
  return String(
    rule.difficulty ||
    (isObject(rule.priority) ? rule.priority.difficulty : '')
  ).trim().toLowerCase();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function defaultSources() {
  return {
    approved: {
      manufacturer: [],
      lab: [],
      database: [],
      retailer: []
    },
    denylist: []
  };
}

function defaultSchema(category) {
  return {
    category,
    field_order: [],
    critical_fields: [],
    expected_easy_fields: [],
    expected_sometimes_fields: [],
    deep_fields: [],
    editorial_fields: [],
    targets: {
      targetCompleteness: 0.9,
      targetConfidence: 0.8
    }
  };
}

function deriveRequiredFieldsFromFieldRules(fieldRulesPayload) {
  if (!isObject(fieldRulesPayload?.fields)) {
    return [];
  }
  const out = [];
  for (const [rawField, rawRule] of Object.entries(fieldRulesPayload.fields)) {
    const field = normalizeField(rawField);
    if (!field || !isObject(rawRule)) {
      continue;
    }
    const requiredLevel = ruleRequiredLevel(rawRule);
    if (requiredLevel === 'required' || requiredLevel === 'critical') {
      out.push(`fields.${field}`);
    }
  }
  return [...new Set(out)];
}

function deriveSchemaFromFieldRules(category, fieldRulesPayload, uiFieldCatalog) {
  if (!isObject(fieldRulesPayload?.fields)) {
    return null;
  }

  const uiRows = Array.isArray(uiFieldCatalog?.fields)
    ? uiFieldCatalog.fields
      .filter((row) => isObject(row) && String(row.key || '').trim())
      .map((row) => ({
        key: normalizeField(row.key),
        order: Number.isFinite(Number(row.order)) ? Number(row.order) : Number.MAX_SAFE_INTEGER
      }))
    : [];
  const uiOrderMap = new Map(uiRows.map((row) => [row.key, row.order]));

  const fieldEntries = Object.entries(fieldRulesPayload.fields)
    .map(([rawField, rawRule]) => ({
      field: normalizeField(rawField),
      rule: isObject(rawRule) ? rawRule : {}
    }))
    .filter((row) => Boolean(row.field))
    .sort((a, b) => {
      const ao = uiOrderMap.has(a.field) ? uiOrderMap.get(a.field) : Number.MAX_SAFE_INTEGER;
      const bo = uiOrderMap.has(b.field) ? uiOrderMap.get(b.field) : Number.MAX_SAFE_INTEGER;
      if (ao !== bo) {
        return ao - bo;
      }
      return a.field.localeCompare(b.field);
    });

  const fieldOrder = fieldEntries.map((row) => row.field);
  const critical = [];
  const expectedEasy = [];
  const expectedSometimes = [];
  const deep = [];

  for (const { field, rule } of fieldEntries) {
    const requiredLevel = ruleRequiredLevel(rule);
    const difficulty = ruleDifficulty(rule);
    const availability = ruleAvailability(rule);
    if (requiredLevel === 'critical') {
      critical.push(field);
    }
    if (requiredLevel === 'required' || requiredLevel === 'critical' || requiredLevel === 'expected') {
      if (difficulty === 'easy' || availability === 'expected') {
        expectedEasy.push(field);
      } else {
        expectedSometimes.push(field);
      }
    } else {
      deep.push(field);
    }
  }

  return {
    ...defaultSchema(category),
    category,
    field_order: fieldOrder,
    critical_fields: [...new Set(critical)],
    expected_easy_fields: [...new Set(expectedEasy)],
    expected_sometimes_fields: [...new Set(expectedSometimes)],
    deep_fields: [...new Set(deep)]
  };
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

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return isObject(parsed) || Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function loadGeneratedCategoryArtifacts(category, runtimeConfig = {}) {
  const helperRoot = path.resolve(runtimeConfig.helperFilesRoot || 'helper_files');
  const helperCategoryRoot = path.join(helperRoot, category);
  const generatedRoot = path.join(helperRoot, category, '_generated');

  const [schemaRaw, requiredRaw, fieldRulesRaw, fieldRulesRuntimeRaw, uiFieldCatalogRaw, generatedSourcesRaw, generatedAnchorsRaw, generatedSearchTemplatesRaw, helperSourcesRaw, helperAnchorsRaw, helperSearchTemplatesRaw] = await Promise.all([
    readJsonIfExists(path.join(generatedRoot, 'schema.json')),
    readJsonIfExists(path.join(generatedRoot, 'required_fields.json')),
    readJsonIfExists(path.join(generatedRoot, 'field_rules.json')),
    readJsonIfExists(path.join(generatedRoot, 'field_rules.runtime.json')),
    readJsonIfExists(path.join(generatedRoot, 'ui_field_catalog.json')),
    readJsonIfExists(path.join(generatedRoot, 'sources.json')),
    readJsonIfExists(path.join(generatedRoot, 'anchors.json')),
    readJsonIfExists(path.join(generatedRoot, 'search_templates.json')),
    readJsonIfExists(path.join(helperCategoryRoot, 'sources.json')),
    readJsonIfExists(path.join(helperCategoryRoot, 'anchors.json')),
    readJsonIfExists(path.join(helperCategoryRoot, 'search_templates.json'))
  ]);

  const fieldRulesPayload = isObject(fieldRulesRaw)
    ? fieldRulesRaw
    : (isObject(fieldRulesRuntimeRaw) ? fieldRulesRuntimeRaw : null);
  const fieldRulesPath = isObject(fieldRulesRaw)
    ? path.join(generatedRoot, 'field_rules.json')
    : (isObject(fieldRulesRuntimeRaw) ? path.join(generatedRoot, 'field_rules.runtime.json') : null);
  const uiFieldCatalog = isObject(uiFieldCatalogRaw) ? uiFieldCatalogRaw : null;
  const schema = isObject(schemaRaw)
    ? schemaRaw
    : deriveSchemaFromFieldRules(category, fieldRulesPayload, uiFieldCatalog);
  const requiredFields = Array.isArray(requiredRaw)
    ? requiredRaw
      .map((field) => String(field || '').trim())
      .filter(Boolean)
    : deriveRequiredFieldsFromFieldRules(fieldRulesPayload);

  const fieldRules = fieldRulesPayload
    ? {
      ...fieldRulesPayload,
      __meta: {
        ...(isObject(fieldRulesPayload.__meta) ? fieldRulesPayload.__meta : {}),
        file_path: fieldRulesPath
      }
    }
    : null;

  if (!fieldRules) {
    return null;
  }

  const sources = isObject(generatedSourcesRaw)
    ? generatedSourcesRaw
    : (isObject(helperSourcesRaw) ? helperSourcesRaw : defaultSources());
  const anchors = isObject(generatedAnchorsRaw)
    ? generatedAnchorsRaw
    : (isObject(helperAnchorsRaw) ? helperAnchorsRaw : {});
  const searchTemplates = Array.isArray(generatedSearchTemplatesRaw)
    ? generatedSearchTemplatesRaw
    : (Array.isArray(helperSearchTemplatesRaw) ? helperSearchTemplatesRaw : []);

  return {
    helperCategoryRoot,
    generatedRoot,
    schema,
    requiredFields,
    fieldRules,
    uiFieldCatalog,
    sources,
    anchors,
    searchTemplates,
    schemaPath: schema ? path.join(generatedRoot, 'schema.json') : null,
    requiredPath: requiredFields ? path.join(generatedRoot, 'required_fields.json') : null
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
    readJsonIfExists(path.join(baseDir, 'schema.json')),
    readJsonIfExists(path.join(baseDir, 'sources.json')),
    readJsonIfExists(path.join(baseDir, 'required_fields.json')),
    readJsonIfExists(path.join(baseDir, 'anchors.json')),
    readJsonIfExists(path.join(baseDir, 'search_templates.json'))
  ]);

  const schema = isObject(schemaRaw) ? schemaRaw : defaultSchema(category);
  const sources = isObject(sourcesRaw) ? sourcesRaw : defaultSources();
  const requiredFields = Array.isArray(requiredRaw) ? requiredRaw : [];
  const anchors = isObject(anchorsRaw) ? anchorsRaw : {};
  const searchTemplates = Array.isArray(searchTemplatesRaw) ? searchTemplatesRaw : [];

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
  const storage = options.storage || null;
  const runtimeConfig = options.config || {};

  const generated = await loadGeneratedCategoryArtifacts(category, runtimeConfig);
  if (!generated?.fieldRules) {
    throw new Error(`Missing generated field rules: helper_files/${category}/_generated/field_rules.json`);
  }

  const schema = generated?.schema || baseConfig.schema || defaultSchema(category);
  const requiredFields = Array.isArray(generated?.requiredFields) && generated.requiredFields.length > 0
    ? generated.requiredFields
    : (baseConfig.requiredFields || []);

  let sources = generated.sources || baseConfig.sources || defaultSources();
  let sourcesOverrideKey = null;

  if (storage && runtimeConfig?.s3InputPrefix) {
    const overrideKey = toPosixKey(
      runtimeConfig.s3InputPrefix,
      '_sources',
      'overrides',
      category,
      'sources.override.json'
    );
    const overrideSources = await storage.readJsonOrNull(overrideKey);
    if (overrideSources) {
      sources = mergeSources(baseConfig.sources, overrideSources);
      sourcesOverrideKey = overrideKey;
    }
  }

  const resolved = buildCategoryConfig({
    category,
    schema,
    sources,
    requiredFields,
    anchors: generated.anchors || baseConfig.anchorFields || {},
    searchTemplates: generated.searchTemplates || baseConfig.searchTemplates || []
  });

  resolved.fieldRules = generated.fieldRules;
  resolved.generated_root = generated.generatedRoot;
  resolved.generated_schema_path = generated.schemaPath;
  resolved.generated_required_fields_path = generated.requiredPath;
  if (sourcesOverrideKey) {
    resolved.sources_override_key = sourcesOverrideKey;
  }
  return resolved;
}
