import fs from 'node:fs/promises';
import path from 'node:path';

const cache = new Map();
const signatureCache = new Map();
const CACHE_MISSING = 'missing';
const SIGNATURE_TTL_MS = 1000;

/**
 * Invalidate cached field rules so that component/enum edits take effect
 * immediately without requiring a process restart.
 * @param {string} [category] - If provided, only invalidate caches for this category.
 *                               If omitted, clears all cached field rules.
 */
export function invalidateFieldRulesCache(category) {
  if (category) {
    const catLower = String(category).trim().toLowerCase();
    for (const key of cache.keys()) {
      if (String(key).toLowerCase().includes(catLower)) cache.delete(key);
    }
    for (const key of signatureCache.keys()) {
      if (String(key).toLowerCase().includes(catLower)) signatureCache.delete(key);
    }
  } else {
    cache.clear();
    signatureCache.clear();
  }
}

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

function normalizeCategory(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+$/g, '');
}

async function resolveCategoryAlias(helperRoot, category) {
  if (!category) {
    return category;
  }
  if (category.startsWith('_test_') || !category.startsWith('test_')) {
    return category;
  }
  const directPath = path.join(helperRoot, category, '_generated', 'field_rules.json');
  if (await fileExists(directPath)) {
    return category;
  }
  const canonicalTestCategory = `_${category}`;
  const aliasedPath = path.join(helperRoot, canonicalTestCategory, '_generated', 'field_rules.json');
  if (await fileExists(aliasedPath)) {
    return canonicalTestCategory;
  }
  return category;
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

async function statSignature(filePath, label) {
  try {
    const stat = await fs.stat(filePath);
    const mtime = Number.isFinite(stat.mtimeMs) ? Math.trunc(stat.mtimeMs) : 0;
    return `${label}:${mtime}:${stat.size}`;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return `${label}:${CACHE_MISSING}`;
    }
    throw error;
  }
}

async function dirJsonSignature(dirPath, label) {
  let entries = [];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return `${label}:${CACHE_MISSING}`;
    }
    throw error;
  }

  const parts = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) {
      continue;
    }
    const fullPath = path.join(dirPath, entry.name);
    try {
      const stat = await fs.stat(fullPath);
      const mtime = Number.isFinite(stat.mtimeMs) ? Math.trunc(stat.mtimeMs) : 0;
      parts.push(`${entry.name}:${mtime}:${stat.size}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }
  parts.sort((left, right) => left.localeCompare(right));
  return `${label}:${parts.join(',') || CACHE_MISSING}`;
}

async function buildFieldRulesSignature(helperRoot, category) {
  const generatedRoot = path.join(helperRoot, category, '_generated');
  const componentRoot = path.join(generatedRoot, 'component_db');
  const overrideDir = path.join(helperRoot, category, '_overrides', 'components');

  const [
    fieldRulesSig,
    knownValuesSig,
    parseTemplatesSig,
    crossRulesSig,
    uiCatalogSig,
    componentDbSig,
    overridesSig
  ] = await Promise.all([
    statSignature(path.join(generatedRoot, 'field_rules.json'), 'field_rules'),
    statSignature(path.join(generatedRoot, 'known_values.json'), 'known_values'),
    statSignature(path.join(generatedRoot, 'parse_templates.json'), 'parse_templates'),
    statSignature(path.join(generatedRoot, 'cross_validation_rules.json'), 'cross_validation_rules'),
    statSignature(path.join(generatedRoot, 'ui_field_catalog.json'), 'ui_field_catalog'),
    dirJsonSignature(componentRoot, 'component_db'),
    dirJsonSignature(overrideDir, 'component_overrides')
  ]);

  return [
    fieldRulesSig,
    knownValuesSig,
    parseTemplatesSig,
    crossRulesSig,
    uiCatalogSig,
    componentDbSig,
    overridesSig
  ].join('|');
}

async function getFieldRulesSignature(helperRoot, category) {
  const cacheKey = keyForCache(category, helperRoot);
  const now = Date.now();
  const cached = signatureCache.get(cacheKey);
  if (cached && (now - cached.at) < SIGNATURE_TTL_MS) {
    return cached.value;
  }
  const value = await buildFieldRulesSignature(helperRoot, category);
  signatureCache.set(cacheKey, { at: now, value });
  return value;
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

function componentEntryStorageKey(entry, fallbackKey, existingEntries) {
  const canonicalName = String(entry?.canonical_name || '').trim();
  const maker = String(entry?.maker || '').trim();
  const base = `${canonicalName || String(fallbackKey || '').trim()}::${maker}`;
  const seed = base || canonicalName || String(fallbackKey || '').trim() || 'component_entry';
  let key = seed;
  let ordinal = 1;
  while (Object.prototype.hasOwnProperty.call(existingEntries, key)) {
    key = `${seed}::${ordinal}`;
    ordinal += 1;
  }
  return key;
}

function appendIndexToken(index, indexAll, tokenRaw, entry) {
  const token = normalizeToken(tokenRaw);
  if (!token) return;
  if (!index.has(token)) index.set(token, entry);
  if (!indexAll.has(token)) indexAll.set(token, []);
  indexAll.get(token).push(entry);
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
      const key = componentEntryStorageKey(entry, rawKey, entries);
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
      const key = componentEntryStorageKey(entry, entry.canonical_name, entries);
      entries[key] = entry;
    }
  }

  const index = new Map();
  const indexAll = new Map();
  // Build a lightweight lookup index so runtime component matching stays O(1).
  for (const entry of Object.values(entries)) {
    const canonicalToken = normalizeToken(entry.canonical_name);
    if (canonicalToken) {
      appendIndexToken(index, indexAll, canonicalToken, entry);
      appendIndexToken(index, indexAll, canonicalToken.replace(/\s+/g, ''), entry);
    }
    for (const alias of entry.aliases || []) {
      const aliasToken = normalizeToken(alias);
      if (!aliasToken) {
        continue;
      }
      appendIndexToken(index, indexAll, aliasToken, entry);
      appendIndexToken(index, indexAll, aliasToken.replace(/\s+/g, ''), entry);
    }
  }

  return {
    ...rawPayload,
    db_name: dbName,
    entries,
    __index: index,
    __indexAll: indexAll
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
    const key = normalizeFieldKey(payload.component_type || path.basename(entry.name, '.json'));
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
  return isObject(componentDBs[normalized]) ? componentDBs[normalized] : null;
}

export async function loadFieldRules(category, options = {}) {
  const normalizedCategory = normalizeCategory(category);
  if (!normalizedCategory) {
    throw new Error('category_required');
  }

  const helperRoot = path.resolve(options.config?.helperFilesRoot || 'helper_files');
  const resolvedCategory = await resolveCategoryAlias(helperRoot, normalizedCategory);
  const cacheKey = keyForCache(resolvedCategory, helperRoot);
  const cached = cache.get(cacheKey);
  if (!options.reload && cached) {
    const cacheSignature = await getFieldRulesSignature(helperRoot, resolvedCategory);
    if (cached.signature === cacheSignature) {
      return cached.loaded;
    }
  }

  const generatedRoot = path.join(helperRoot, resolvedCategory, '_generated');
  const fieldRulesPath = path.join(generatedRoot, 'field_rules.json');
  if (!(await fileExists(fieldRulesPath))) {
    throw new Error(`missing_field_rules:${fieldRulesPath}`);
  }

  const overrideDir = path.join(helperRoot, resolvedCategory, '_overrides', 'components');
  const [rulesRaw, knownRaw, parseRaw, crossRaw, uiRaw, componentDBs] = await Promise.all([
    readJsonIfExists(fieldRulesPath),
    readJsonIfExists(path.join(generatedRoot, 'known_values.json')),
    readJsonIfExists(path.join(generatedRoot, 'parse_templates.json')),
    readJsonIfExists(path.join(generatedRoot, 'cross_validation_rules.json')),
    readJsonIfExists(path.join(generatedRoot, 'ui_field_catalog.json')),
    readComponentDbs(path.join(generatedRoot, 'component_db'))
  ]);

  // Merge component overrides into loaded component DBs at runtime
  try {
    const overrideEntries = await fs.readdir(overrideDir, { withFileTypes: true });
    for (const entry of overrideEntries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        const ovr = JSON.parse(await fs.readFile(path.join(overrideDir, entry.name), 'utf8'));
        if (!ovr?.componentType || !ovr?.name) continue;
        if (!isObject(ovr?.properties) && !isObject(ovr?.identity)) continue;
        const typeKey = normalizeFieldKey(ovr.componentType);
        const db = componentDBs[typeKey];
        if (!db?.entries) continue;
        const nameToken = normalizeToken(ovr.name);
        // Find the matching entry via the index or by iterating entries
        const matched = db.__index?.get(nameToken) || db.__index?.get(nameToken.replace(/\s+/g, ''));
        if (matched && isObject(ovr.properties) && isObject(matched.properties)) {
          for (const [prop, val] of Object.entries(ovr.properties)) {
            if (val !== undefined && val !== null && val !== '') {
              matched.properties[prop] = val;
              if (!matched.__overridden) matched.__overridden = {};
              matched.__overridden[prop] = true;
            }
          }
        }
        // Apply identity overrides (name, maker, aliases, links)
        if (matched && isObject(ovr.identity)) {
          if (ovr.identity.name) matched.canonical_name = ovr.identity.name;
          if (ovr.identity.maker) matched.maker = ovr.identity.maker;
          if (Array.isArray(ovr.identity.aliases)) {
            // Replace aliases entirely so removals propagate; the override
            // file is the authoritative alias list when present.
            matched.aliases = ovr.identity.aliases;
          }
          if (Array.isArray(ovr.identity.links)) matched.links = ovr.identity.links;
        }
        // Update the index for any new aliases from identity overrides
        if (matched && Array.isArray(ovr.identity?.aliases) && db.__index) {
          for (const alias of ovr.identity.aliases) {
            const aliasToken = normalizeToken(alias);
            if (aliasToken) {
              db.__index.set(aliasToken, matched);
              db.__index.set(aliasToken.replace(/\s+/g, ''), matched);
            }
          }
        }
      } catch { /* skip corrupt override files */ }
    }
  } catch (err) {
    if (err?.code !== 'ENOENT') { /* overrides dir doesn't exist, that's fine */ }
  }

  const rules = isObject(rulesRaw) ? rulesRaw : {};
  const knownValues = normalizeKnownValues(knownRaw || {});
  const parseTemplates = normalizeParseTemplates(parseRaw || {}, rules);
  const crossValidation = normalizeCrossValidation(crossRaw || {}, rules);
  const uiFieldCatalog = isObject(uiRaw) ? uiRaw : { category: resolvedCategory, fields: [] };

  const loaded = {
    category: resolvedCategory,
    generatedRoot,
    rules,
    knownValues,
    parseTemplates,
    crossValidation: toArray(crossValidation.rules),
    componentDBs,
    uiFieldCatalog
  };

  const signature = await buildFieldRulesSignature(helperRoot, resolvedCategory);
  signatureCache.set(cacheKey, { at: Date.now(), value: signature });
  cache.set(cacheKey, { signature, loaded });
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
  signatureCache.clear();
}
