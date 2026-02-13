import fs from 'node:fs/promises';
import path from 'node:path';

const cache = new Map();

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function normalizeFieldKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function keyForCache(category, helperRoot) {
  return `${helperRoot}::${category}`;
}

function normalizeComponentEntry(rawEntry = {}, fallbackName = '') {
  const canonicalName = String(
    rawEntry.canonical_name ||
    rawEntry.name ||
    fallbackName
  ).trim();
  return {
    ...rawEntry,
    canonical_name: canonicalName,
    aliases: toArray(rawEntry.aliases)
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  };
}

function normalizeComponentDbPayload(rawPayload = {}, fallbackName = '') {
  const dbName = String(rawPayload.db_name || fallbackName).trim() || fallbackName;
  const entries = {};

  if (isObject(rawPayload.entries)) {
    for (const [rawKey, rawEntry] of Object.entries(rawPayload.entries)) {
      if (!isObject(rawEntry)) {
        continue;
      }
      const entry = normalizeComponentEntry(rawEntry, rawKey);
      const key = entry.canonical_name || rawKey;
      if (!key) {
        continue;
      }
      entries[key] = entry;
    }
  } else if (Array.isArray(rawPayload.items)) {
    for (const rawEntry of rawPayload.items) {
      if (!isObject(rawEntry)) {
        continue;
      }
      const entry = normalizeComponentEntry(rawEntry, rawEntry.name || rawEntry.canonical_name || '');
      if (!entry.canonical_name) {
        continue;
      }
      entries[entry.canonical_name] = entry;
    }
  }

  const index = new Map();
  // Build a lightweight lookup index so runtime component matching stays O(1).
  for (const entry of Object.values(entries)) {
    const canonicalToken = normalizeToken(entry.canonical_name);
    if (canonicalToken) {
      index.set(canonicalToken, entry);
      index.set(canonicalToken.replace(/\s+/g, ''), entry);
    }
    for (const alias of entry.aliases || []) {
      const aliasToken = normalizeToken(alias);
      if (!aliasToken) {
        continue;
      }
      index.set(aliasToken, entry);
      index.set(aliasToken.replace(/\s+/g, ''), entry);
    }
  }

  return {
    ...rawPayload,
    db_name: dbName,
    entries,
    __index: index
  };
}

function normalizeKnownValues(rawKnownValues = {}) {
  if (!isObject(rawKnownValues)) {
    return { enums: {} };
  }
  if (isObject(rawKnownValues.enums)) {
    return rawKnownValues;
  }
  const fieldBuckets = isObject(rawKnownValues.fields) ? rawKnownValues.fields : {};
  const enums = {};
  for (const [fieldKeyRaw, valuesRaw] of Object.entries(fieldBuckets)) {
    const fieldKey = normalizeFieldKey(fieldKeyRaw);
    if (!fieldKey) {
      continue;
    }
    const values = toArray(valuesRaw)
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    enums[fieldKey] = {
      policy: 'open',
      values
    };
  }
  return {
    ...rawKnownValues,
    enums
  };
}

function normalizeParseTemplates(rawParseTemplates = {}, fieldRules = {}) {
  if (isObject(rawParseTemplates) && isObject(rawParseTemplates.templates)) {
    return rawParseTemplates;
  }

  const templates = {};
  if (isObject(fieldRules.fields)) {
    for (const [fieldKeyRaw, fieldRule] of Object.entries(fieldRules.fields)) {
      const fieldKey = normalizeFieldKey(fieldKeyRaw);
      if (!fieldKey || !isObject(fieldRule)) {
        continue;
      }
      const parse = isObject(fieldRule.parse) ? fieldRule.parse : {};
      templates[fieldKey] = {
        template: String(parse.template || '').trim(),
        patterns: []
      };
    }
  }

  return {
    category: String(fieldRules.category || '').trim(),
    version: 1,
    templates
  };
}

function normalizeCrossValidation(rawCrossValidation = {}, fieldRules = {}) {
  if (isObject(rawCrossValidation) && Array.isArray(rawCrossValidation.rules)) {
    return rawCrossValidation;
  }
  return {
    category: String(fieldRules.category || '').trim(),
    version: 1,
    rules: []
  };
}

async function readComponentDbs(componentRoot) {
  const out = {};
  let entries = [];
  try {
    entries = await fs.readdir(componentRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return out;
    }
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) {
      continue;
    }
    const filePath = path.join(componentRoot, entry.name);
    const payload = await readJsonIfExists(filePath);
    if (!isObject(payload)) {
      continue;
    }
    const key = normalizeFieldKey(path.basename(entry.name, '.json'));
    if (!key) {
      continue;
    }
    out[key] = normalizeComponentDbPayload(payload, key);
  }
  return out;
}

function resolveComponentDb(componentDBs = {}, dbName = '') {
  const normalized = normalizeFieldKey(dbName);
  if (!normalized) {
    return null;
  }
  if (isObject(componentDBs[normalized])) {
    return componentDBs[normalized];
  }
  if (normalized.endsWith('s') && isObject(componentDBs[normalized.slice(0, -1)])) {
    return componentDBs[normalized.slice(0, -1)];
  }
  if (isObject(componentDBs[`${normalized}s`])) {
    return componentDBs[`${normalized}s`];
  }
  return null;
}

export async function loadFieldRules(category, options = {}) {
  const normalizedCategory = normalizeFieldKey(category);
  if (!normalizedCategory) {
    throw new Error('category_required');
  }

  const helperRoot = path.resolve(options.config?.helperFilesRoot || 'helper_files');
  const cacheKey = keyForCache(normalizedCategory, helperRoot);
  if (!options.reload && cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const generatedRoot = path.join(helperRoot, normalizedCategory, '_generated');
  const fieldRulesPath = path.join(generatedRoot, 'field_rules.json');
  if (!(await fileExists(fieldRulesPath))) {
    throw new Error(`missing_field_rules:${fieldRulesPath}`);
  }

  const [rulesRaw, knownRaw, parseRaw, crossRaw, uiRaw, componentDBs] = await Promise.all([
    readJsonIfExists(fieldRulesPath),
    readJsonIfExists(path.join(generatedRoot, 'known_values.json')),
    readJsonIfExists(path.join(generatedRoot, 'parse_templates.json')),
    readJsonIfExists(path.join(generatedRoot, 'cross_validation_rules.json')),
    readJsonIfExists(path.join(generatedRoot, 'ui_field_catalog.json')),
    readComponentDbs(path.join(generatedRoot, 'component_db'))
  ]);

  const rules = isObject(rulesRaw) ? rulesRaw : {};
  const knownValues = normalizeKnownValues(knownRaw || {});
  const parseTemplates = normalizeParseTemplates(parseRaw || {}, rules);
  const crossValidation = normalizeCrossValidation(crossRaw || {}, rules);
  const uiFieldCatalog = isObject(uiRaw) ? uiRaw : { category: normalizedCategory, fields: [] };

  const loaded = {
    category: normalizedCategory,
    generatedRoot,
    rules,
    knownValues,
    parseTemplates,
    crossValidation: toArray(crossValidation.rules),
    componentDBs,
    uiFieldCatalog
  };

  cache.set(cacheKey, loaded);
  return loaded;
}

export async function getFieldRule(category, fieldKey, options = {}) {
  const loaded = await loadFieldRules(category, options);
  const normalizedField = normalizeFieldKey(fieldKey);
  if (!normalizedField) {
    return null;
  }
  const fields = isObject(loaded.rules?.fields) ? loaded.rules.fields : {};
  return isObject(fields[normalizedField]) ? fields[normalizedField] : null;
}

export async function getKnownValues(category, enumRef, options = {}) {
  const loaded = await loadFieldRules(category, options);
  const normalizedRef = normalizeFieldKey(enumRef);
  if (!normalizedRef) {
    return null;
  }
  const enums = isObject(loaded.knownValues?.enums) ? loaded.knownValues.enums : {};
  const row = enums[normalizedRef];
  if (!row) {
    return null;
  }
  if (Array.isArray(row.values)) {
    return {
      policy: String(row.policy || 'open'),
      values: row.values
    };
  }
  return {
    policy: String(row.policy || 'open'),
    values: toArray(row.values)
  };
}

export async function lookupComponent(category, dbName, query, options = {}) {
  const loaded = await loadFieldRules(category, options);
  const db = resolveComponentDb(loaded.componentDBs, dbName);
  if (!db) {
    return null;
  }
  const token = normalizeToken(query);
  if (!token) {
    return null;
  }
  return db.__index.get(token) || db.__index.get(token.replace(/\s+/g, '')) || null;
}

export async function getParseTemplate(category, fieldKey, options = {}) {
  const loaded = await loadFieldRules(category, options);
  const normalizedField = normalizeFieldKey(fieldKey);
  if (!normalizedField) {
    return null;
  }
  const templates = isObject(loaded.parseTemplates?.templates)
    ? loaded.parseTemplates.templates
    : {};
  if (isObject(templates[normalizedField])) {
    return templates[normalizedField];
  }
  const fieldRule = isObject(loaded.rules?.fields?.[normalizedField])
    ? loaded.rules.fields[normalizedField]
    : null;
  if (!fieldRule) {
    return null;
  }
  const parse = isObject(fieldRule.parse) ? fieldRule.parse : {};
  if (!Object.keys(parse).length) {
    return null;
  }
  return {
    template: String(parse.template || '').trim(),
    patterns: []
  };
}

export async function getCrossValidationRules(category, options = {}) {
  const loaded = await loadFieldRules(category, options);
  return toArray(loaded.crossValidation);
}

export function clearFieldRulesCache() {
  cache.clear();
}
