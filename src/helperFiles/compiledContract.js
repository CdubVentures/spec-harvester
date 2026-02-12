import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { BOOLEAN_FIELDS, LIST_FIELDS, NUMERIC_FIELDS } from '../constants.js';
import { normalizeMissingFieldTargets } from '../utils/fieldKeys.js';
import { normalizeToken, normalizeWhitespace } from '../utils/common.js';

const require = createRequire(import.meta.url);

const CONTRACT_VERSION = 1;
const IDENTITY_FIELDS = new Set([
  'id',
  'brand',
  'model',
  'base_model',
  'variant',
  'sku',
  'mpn',
  'gtin',
  'category'
]);

const DEFAULT_NUMERIC_RANGES = {
  weight: { min: 10, max: 300 },
  lngth: { min: 20, max: 200 },
  width: { min: 20, max: 200 },
  height: { min: 20, max: 200 },
  dpi: { min: 100, max: 100000 },
  ips: { min: 10, max: 1000 },
  acceleration: { min: 5, max: 200 },
  polling_rate: { min: 50, max: 10000 },
  side_buttons: { min: 0, max: 24 },
  middle_buttons: { min: 0, max: 16 },
  programmable_buttons: { min: 0, max: 32 }
};

const DEFAULT_EXPECTED_SOMETIMES_FIELDS = new Set([
  'edition',
  'release_date',
  'price_range',
  'colors'
]);

function compiledRootDir(config = {}) {
  return path.resolve(config.helperCompiledRoot || path.join('data', 'helpers_compiled'));
}

function contractFilePath(category, config = {}) {
  return path.join(compiledRootDir(config), `${category}.spec_helpers.compiled.json`);
}

function helperMirrorDir(category, config = {}) {
  return path.resolve(config.helperFilesRoot || 'helper_files', category, '_compiled');
}

function helperMirrorContractPath(category, config = {}) {
  return path.join(helperMirrorDir(category, config), `${category}.spec_helpers.compiled.json`);
}

function normalizeField(value) {
  return String(value || '').trim();
}

function titleFromKey(value) {
  return String(value || '')
    .split('_')
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ')
    .trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asNumber(value) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function addToSetMap(map, key, values = []) {
  if (!map.has(key)) {
    map.set(key, new Set());
  }
  const bucket = map.get(key);
  for (const value of values) {
    const text = normalizeWhitespace(value);
    if (text) {
      bucket.add(text);
    }
  }
}

function hasKnownValue(value) {
  if (Array.isArray(value)) {
    return value.some((item) => hasKnownValue(item));
  }
  const token = normalizeToken(value);
  return token !== '' && token !== 'unk' && token !== 'null' && token !== 'undefined' && token !== 'n/a';
}

function toSortedObjectOfArrays(map) {
  const out = {};
  for (const [key, set] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    out[key] = [...set].sort((a, b) => a.localeCompare(b));
  }
  return out;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function hashPayload(value) {
  const serialized = stableStringify(value);
  return createHash('sha256').update(serialized).digest('hex');
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

function readModuleIfExists(filePath) {
  try {
    if (!filePath) {
      return null;
    }
    // Keep dynamic modules fresh across repeated trainer/dev loops.
    const resolved = require.resolve(filePath);
    delete require.cache[resolved];
    return require(filePath);
  } catch {
    return null;
  }
}

async function resolveOptionalModule(baseDir, names = []) {
  for (const name of names) {
    const candidate = path.join(baseDir, name);
    if (await fileExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

function normalizeEnumToken(value) {
  return normalizeToken(value).replace(/\s+/g, ' ').trim();
}

function parseNumericRangeCandidate(value) {
  if (isObject(value)) {
    const min = asNumber(value.min);
    const max = asNumber(value.max);
    if (min !== null || max !== null) {
      return {
        min,
        max
      };
    }
  }
  const parsed = asNumber(value);
  if (parsed === null) {
    return null;
  }
  return {
    min: parsed,
    max: parsed
  };
}

function mergeRange(base = {}, next = {}) {
  const minCandidates = [asNumber(base.min), asNumber(next.min)].filter((value) => value !== null);
  const maxCandidates = [asNumber(base.max), asNumber(next.max)].filter((value) => value !== null);
  return {
    min: minCandidates.length ? Math.max(...minCandidates) : null,
    max: maxCandidates.length ? Math.min(...maxCandidates) : null
  };
}

function sanitizeRange(range = {}) {
  const min = asNumber(range.min);
  const max = asNumber(range.max);
  if (min === null && max === null) {
    return null;
  }
  if (min !== null && max !== null && min > max) {
    return null;
  }
  return {
    ...(min !== null ? { min } : {}),
    ...(max !== null ? { max } : {})
  };
}

function buildSliderMetadata(sliderItems = []) {
  const byField = new Map();
  for (const item of toArray(sliderItems)) {
    if (!isObject(item)) {
      continue;
    }
    const keys = [];
    if (item.key) {
      keys.push(String(item.key));
    }
    for (const key of toArray(item.keys)) {
      keys.push(String(key));
    }
    const type = String(item.type || '').trim().toLowerCase();
    const unit = normalizeWhitespace(item.unit || '');
    const decimals = Number.isFinite(Number(item.decimals))
      ? Number(item.decimals)
      : null;

    for (const key of [...new Set(keys)].filter(Boolean)) {
      let range = null;
      if (type === 'number') {
        const fallback = isObject(item.fallback) ? item.fallback[key] ?? item.fallback : {};
        const minSource = item.min === 'auto' ? fallback?.min : item.min;
        const maxSource = item.max === 'auto' ? fallback?.max : item.max;
        range = sanitizeRange({
          min: minSource,
          max: maxSource
        });
      }
      byField.set(key, {
        type,
        unit,
        decimals,
        range
      });
    }
  }
  return byField;
}

function inferFieldType(field, sliderMeta) {
  if (sliderMeta?.type === 'date') {
    return 'date';
  }
  if (NUMERIC_FIELDS.has(field) || sliderMeta?.type === 'number') {
    return 'number';
  }
  if (BOOLEAN_FIELDS.has(field)) {
    return 'boolean';
  }
  if (LIST_FIELDS.has(field)) {
    return 'list';
  }
  if (IDENTITY_FIELDS.has(field)) {
    return 'identity';
  }
  return 'string';
}

function normalizeModuleValue(moduleData) {
  if (!moduleData) {
    return {};
  }
  if (isObject(moduleData.default)) {
    return {
      ...moduleData,
      ...moduleData.default
    };
  }
  return moduleData;
}

function collectLabels({
  fieldOrder = [],
  filtersModule = {},
  versusModule = {}
}) {
  const labelByField = new Map();
  for (const field of fieldOrder) {
    labelByField.set(field, titleFromKey(field));
  }

  for (const row of toArray(filtersModule.toggleItems)) {
    const key = normalizeField(row?.key);
    if (!key || !labelByField.has(key)) {
      continue;
    }
    const label = normalizeWhitespace(row?.label || '');
    if (label) {
      labelByField.set(key, label);
    }
  }

  for (const row of toArray(filtersModule.sliderItems)) {
    if (row?.key && labelByField.has(row.key)) {
      const label = normalizeWhitespace(row.label || row.sliderLabel || '');
      if (label) {
        labelByField.set(row.key, label);
      }
    }
    for (const key of toArray(row?.keys)) {
      const normalized = normalizeField(key);
      if (!normalized || !labelByField.has(normalized)) {
        continue;
      }
      const groupLabels = isObject(row?.sliderLabels) ? row.sliderLabels : {};
      const label = normalizeWhitespace(groupLabels[normalized] || '');
      if (label) {
        labelByField.set(normalized, label);
      }
    }
  }

  for (const row of toArray(versusModule.versusList)) {
    const key = normalizeField(row?.key);
    if (!key || !labelByField.has(key)) {
      continue;
    }
    const label = normalizeWhitespace(row?.label || '');
    if (label) {
      labelByField.set(key, label);
    }
  }

  return labelByField;
}

function collectEnumHints({
  fieldOrder = [],
  filtersModule = {},
  helperData = {},
  includeSupportive = true
}) {
  const enumMap = new Map();
  const fieldSet = new Set(fieldOrder);

  for (const row of toArray(filtersModule.toggleItems)) {
    const field = normalizeField(row?.key);
    if (!field || !fieldSet.has(field)) {
      continue;
    }
    const options = toArray(row?.options)
      .map((value) => normalizeWhitespace(value))
      .filter(Boolean);
    if (options.length > 0) {
      addToSetMap(enumMap, field, options);
    }
  }

  const candidateRows = [
    ...toArray(helperData.active),
    ...(includeSupportive ? toArray(helperData.supportive) : [])
  ];
  const sampled = candidateRows.slice(0, 6000);
  const perFieldValueSets = new Map();
  for (const field of fieldOrder) {
    perFieldValueSets.set(field, new Set());
  }

  for (const row of sampled) {
    const canonical = isObject(row?.canonical_fields) ? row.canonical_fields : {};
    for (const field of fieldOrder) {
      if (NUMERIC_FIELDS.has(field)) {
        continue;
      }
      const value = normalizeWhitespace(canonical[field] || '');
      if (!value || value.toLowerCase() === 'unk') {
        continue;
      }
      perFieldValueSets.get(field)?.add(value);
    }
  }

  for (const field of fieldOrder) {
    const values = [...(perFieldValueSets.get(field) || new Set())];
    if (values.length > 0 && values.length <= 12) {
      addToSetMap(enumMap, field, values);
    }
  }

  return enumMap;
}

function defaultEnumAliasesForField(field) {
  const normalizedField = normalizeToken(field);
  if (normalizedField === 'connection' || normalizedField === 'connectivity') {
    const map = {
      wired: [
        'wired',
        'wire',
        'usb',
        'usb wired'
      ],
      wireless: [
        'wireless',
        '2.4ghz',
        '2.4 ghz',
        'rf',
        'dongle',
        'receiver'
      ],
      hybrid: [
        'hybrid',
        'dual',
        'dual mode',
        'wired + wireless',
        'wireless + wired',
        'bluetooth + 2.4ghz + wired',
        '2.4ghz + wired',
        'bluetooth + wired',
        'bluetooth + 2.4ghz'
      ]
    };
    return map;
  }
  return {};
}

function enumAliasMap({
  field,
  fieldType,
  enumValues = []
}) {
  const enumSet = new Set(
    enumValues
      .map((value) => normalizeEnumToken(value))
      .filter(Boolean)
  );
  const out = {};
  if (!enumSet.size) {
    return out;
  }

  for (const value of enumSet) {
    out[value] = value;
    out[value.replace(/\s+/g, '')] = value;
    out[value.replace(/[-_]+/g, ' ')] = value;
  }

  if (fieldType === 'boolean') {
    const yes = ['yes', 'true', '1', 'enabled', 'on'];
    const no = ['no', 'false', '0', 'disabled', 'off'];
    if (enumSet.has('yes')) {
      for (const alias of yes) {
        out[alias] = 'yes';
      }
    }
    if (enumSet.has('no')) {
      for (const alias of no) {
        out[alias] = 'no';
      }
    }
  }

  const defaults = defaultEnumAliasesForField(field);
  for (const [canonical, aliases] of Object.entries(defaults)) {
    const normalizedCanonical = normalizeEnumToken(canonical);
    if (!enumSet.has(normalizedCanonical)) {
      continue;
    }
    for (const alias of aliases || []) {
      const normalizedAlias = normalizeEnumToken(alias);
      if (!normalizedAlias) {
        continue;
      }
      out[normalizedAlias] = normalizedCanonical;
      out[normalizedAlias.replace(/\s+/g, '')] = normalizedCanonical;
    }
  }

  return Object.fromEntries(
    Object.entries(out)
      .map(([key, value]) => [normalizeEnumToken(key), normalizeEnumToken(value)])
      .filter(([key, value]) => key && value && enumSet.has(value))
      .sort((a, b) => a[0].localeCompare(b[0]))
  );
}

function canonicalizeEnumValues(field, enumValues = []) {
  const normalizedField = normalizeToken(field);
  const values = [...new Set(
    (enumValues || [])
      .map((value) => normalizeEnumToken(value))
      .filter(Boolean)
  )];
  if (normalizedField !== 'connection' && normalizedField !== 'connectivity') {
    return values.sort((a, b) => a.localeCompare(b));
  }
  const set = new Set(values);
  if (set.has('dual')) {
    set.delete('dual');
    set.add('hybrid');
  }
  if (set.has('wired/wireless')) {
    set.delete('wired/wireless');
    set.add('hybrid');
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function collectSynonyms({
  fieldOrder = [],
  labels = new Map(),
  tooltipHints = {},
  filtersModule = {},
  versusModule = {}
}) {
  const synonymMap = new Map();
  const fieldSet = new Set(fieldOrder);
  for (const field of fieldOrder) {
    const synonyms = new Set();
    synonyms.add(field);
    synonyms.add(field.replace(/_/g, ' '));
    const label = normalizeWhitespace(labels.get(field) || '');
    if (label) {
      synonyms.add(label);
      synonyms.add(label.toLowerCase());
    }
    for (const hint of toArray(tooltipHints[field])) {
      synonyms.add(normalizeWhitespace(hint));
    }
    addToSetMap(synonymMap, field, [...synonyms].filter(Boolean));
  }

  for (const row of toArray(filtersModule.toggleItems)) {
    const field = normalizeField(row?.key);
    if (!field || !fieldSet.has(field)) {
      continue;
    }
    addToSetMap(synonymMap, field, [row?.label || '']);
  }
  for (const row of toArray(filtersModule.sliderItems)) {
    const field = normalizeField(row?.key);
    if (field && fieldSet.has(field)) {
      addToSetMap(synonymMap, field, [row?.label || '', row?.sliderLabel || '']);
    }
    for (const key of toArray(row?.keys)) {
      const normalized = normalizeField(key);
      if (!normalized || !fieldSet.has(normalized)) {
        continue;
      }
      const label = isObject(row?.sliderLabels) ? row.sliderLabels[normalized] : '';
      addToSetMap(synonymMap, normalized, [label || '']);
    }
  }
  for (const row of toArray(versusModule.versusList)) {
    const field = normalizeField(row?.key);
    if (!field || !fieldSet.has(field)) {
      continue;
    }
    addToSetMap(synonymMap, field, [row?.label || '']);
  }

  const out = {};
  for (const [field, values] of synonymMap.entries()) {
    const cleaned = [...values]
      .map((value) => normalizeWhitespace(value))
      .filter(Boolean)
      .map((value) => value.toLowerCase())
      .filter((value) => value.length >= 2)
      .sort((a, b) => a.localeCompare(b));
    out[field] = [...new Set(cleaned)];
  }
  return out;
}

function deriveNormalizationAndConstraints({
  fieldOrder = [],
  sliderMetadata = new Map(),
  enumHints = new Map()
}) {
  const normalization = {};
  const constraints = {
    fields: {}
  };

  for (const field of fieldOrder) {
    const sliderMeta = sliderMetadata.get(field) || null;
    const type = inferFieldType(field, sliderMeta);
    const rule = {
      type
    };
    if (sliderMeta?.unit) {
      rule.unit = sliderMeta.unit;
    }
    if (Number.isFinite(sliderMeta?.decimals)) {
      rule.decimals = Number(sliderMeta.decimals);
    }
    if (type === 'list') {
      rule.item_type = 'string';
      rule.separator = ',';
    }
    if (type === 'number') {
      const defaultRange = DEFAULT_NUMERIC_RANGES[field] || null;
      const mergedRange = mergeRange(defaultRange || {}, sliderMeta?.range || {});
      const cleaned = sanitizeRange(mergedRange);
      if (cleaned) {
        rule.range = cleaned;
      }
    }
    normalization[field] = rule;

    const fieldConstraint = { type };
    if (rule.range) {
      fieldConstraint.range = rule.range;
    }
    const enums = [...(enumHints.get(field) || new Set())];
    if (enums.length > 0 && type !== 'number') {
      let enumNorm = [...new Set(
        enums
          .map((value) => normalizeEnumToken(value))
          .filter(Boolean)
      )].sort((a, b) => a.localeCompare(b));
      enumNorm = canonicalizeEnumValues(field, enumNorm);
      if (enumNorm.length > 0 && enumNorm.length <= 50) {
        fieldConstraint.enum = enumNorm;
        const aliases = enumAliasMap({
          field,
          fieldType: type,
          enumValues: enumNorm
        });
        if (Object.keys(aliases).length > 0) {
          fieldConstraint.aliases = aliases;
        }
      }
    }
    constraints.fields[field] = fieldConstraint;
  }

  return {
    normalization,
    constraints
  };
}

function normalizeOverrideType(value) {
  const token = normalizeToken(value);
  if (token === 'number' || token === 'string' || token === 'boolean' || token === 'list' || token === 'identity' || token === 'date') {
    return token;
  }
  return '';
}

function normalizeOverrideAliases({ aliases = {}, allowedSet = new Set() }) {
  const out = {};
  if (!isObject(aliases) || !allowedSet.size) {
    return out;
  }
  for (const [aliasRaw, canonicalRaw] of Object.entries(aliases)) {
    const alias = normalizeEnumToken(aliasRaw);
    const canonical = normalizeEnumToken(canonicalRaw);
    if (!alias || !canonical || !allowedSet.has(canonical)) {
      continue;
    }
    out[alias] = canonical;
    out[alias.replace(/\s+/g, '')] = canonical;
  }
  return out;
}

function resolveFieldContractOverrides(schema = {}) {
  const candidates = [
    schema?.field_contract_overrides,
    schema?.field_contracts,
    schema?.output_contract?.fields
  ];
  const merged = {};
  for (const candidate of candidates) {
    if (!isObject(candidate)) {
      continue;
    }
    for (const [field, override] of Object.entries(candidate)) {
      if (!isObject(override)) {
        continue;
      }
      merged[field] = {
        ...(merged[field] || {}),
        ...override
      };
    }
  }
  return merged;
}

function applyFieldContractOverrides({
  fieldOrder = [],
  schema = {},
  normalization = {},
  constraints = {}
}) {
  const overrides = resolveFieldContractOverrides(schema);
  if (!Object.keys(overrides).length) {
    return {
      normalization,
      constraints
    };
  }

  const fieldSet = new Set(fieldOrder);
  const nextNormalization = { ...normalization };
  const baseFields = constraints?.fields && typeof constraints.fields === 'object'
    ? constraints.fields
    : {};
  const nextFields = { ...baseFields };

  for (const [field, override] of Object.entries(overrides)) {
    if (!fieldSet.has(field)) {
      continue;
    }
    const existingRule = isObject(nextNormalization[field]) ? nextNormalization[field] : {};
    const existingConstraint = isObject(nextFields[field]) ? nextFields[field] : {};
    const type = normalizeOverrideType(override?.type) || existingConstraint.type || existingRule.type || 'string';
    const rule = {
      ...existingRule,
      type
    };
    const constraint = {
      ...existingConstraint,
      type
    };

    if (override?.unit !== undefined) {
      const unit = normalizeWhitespace(override.unit || '');
      if (unit) {
        rule.unit = unit;
      } else {
        delete rule.unit;
      }
    }
    if (override?.decimals !== undefined) {
      const decimals = Number.parseInt(String(override.decimals), 10);
      if (Number.isFinite(decimals)) {
        rule.decimals = decimals;
      } else {
        delete rule.decimals;
      }
    }
    if (override?.item_type !== undefined) {
      const itemType = normalizeOverrideType(override.item_type) || normalizeWhitespace(override.item_type || '');
      if (itemType) {
        rule.item_type = itemType;
      } else {
        delete rule.item_type;
      }
    }
    if (override?.separator !== undefined) {
      const separator = String(override.separator || '').trim();
      if (separator) {
        rule.separator = separator;
      } else {
        delete rule.separator;
      }
    }

    if (override?.range !== undefined) {
      const min = asNumber(override?.range?.min);
      const max = asNumber(override?.range?.max);
      const range = sanitizeRange({
        min,
        max
      });
      if (range) {
        rule.range = range;
        constraint.range = range;
      } else {
        delete rule.range;
        delete constraint.range;
      }
    }

    if (override?.enum !== undefined) {
      const enumValues = canonicalizeEnumValues(
        field,
        toArray(override.enum)
          .map((value) => normalizeEnumToken(value))
          .filter(Boolean)
      );
      if (enumValues.length > 0) {
        constraint.enum = enumValues;
        const allowedSet = new Set(enumValues);
        const autoAliases = enumAliasMap({
          field,
          fieldType: type,
          enumValues
        });
        const manualAliases = normalizeOverrideAliases({
          aliases: override.aliases || {},
          allowedSet
        });
        const aliases = {
          ...autoAliases,
          ...manualAliases
        };
        if (Object.keys(aliases).length > 0) {
          constraint.aliases = aliases;
        } else {
          delete constraint.aliases;
        }
      } else {
        delete constraint.enum;
        delete constraint.aliases;
      }
    } else if (override?.aliases !== undefined && Array.isArray(constraint.enum) && constraint.enum.length > 0) {
      const allowedSet = new Set(
        constraint.enum
          .map((value) => normalizeEnumToken(value))
          .filter(Boolean)
      );
      const autoAliases = enumAliasMap({
        field,
        fieldType: type,
        enumValues: constraint.enum
      });
      const manualAliases = normalizeOverrideAliases({
        aliases: override.aliases || {},
        allowedSet
      });
      const aliases = {
        ...autoAliases,
        ...manualAliases
      };
      if (Object.keys(aliases).length > 0) {
        constraint.aliases = aliases;
      } else {
        delete constraint.aliases;
      }
    }

    nextNormalization[field] = rule;
    nextFields[field] = constraint;
  }

  return {
    normalization: nextNormalization,
    constraints: {
      ...constraints,
      fields: nextFields
    }
  };
}

function collectComponentAliases(helperData = {}) {
  const aliasMap = {};
  const components = ['sensor', 'switch', 'encoder', 'mcu'];
  for (const component of components) {
    const values = new Set();
    for (const row of toArray(helperData.supportive).slice(0, 8000)) {
      const value = normalizeWhitespace(row?.canonical_fields?.[component] || '');
      if (value) {
        values.add(value);
      }
    }
    aliasMap[component] = [...values].sort((a, b) => a.localeCompare(b)).slice(0, 400);
  }
  return aliasMap;
}

function collectComponentAliasesWithOptions(helperData = {}, { includeSupportive = true } = {}) {
  if (!includeSupportive) {
    return {
      sensor: [],
      switch: [],
      encoder: [],
      mcu: []
    };
  }
  return collectComponentAliases(helperData);
}

function buildFieldCatalog({
  categoryConfig,
  labels,
  normalizationRules
}) {
  const requiredFields = normalizeMissingFieldTargets(
    categoryConfig.requiredFields || [],
    { fieldOrder: categoryConfig.fieldOrder || [] }
  ).fields;
  const requiredSet = new Set(requiredFields);
  const criticalSet = new Set(categoryConfig.schema?.critical_fields || []);
  const fields = [];
  for (const field of categoryConfig.fieldOrder || []) {
    const type = normalizationRules[field]?.type || inferFieldType(field, null);
    fields.push({
      key: field,
      label: labels.get(field) || titleFromKey(field),
      type,
      required_level: requiredSet.has(field)
        ? 'required'
        : criticalSet.has(field)
          ? 'critical'
          : 'optional',
      expected_level: requiredSet.has(field) || criticalSet.has(field) ? 'expected' : 'optional'
    });
  }
  return fields;
}

function fieldCoverageRates({
  fieldOrder = [],
  helperData = {}
}) {
  const rows = [
    ...toArray(helperData.active),
    ...toArray(helperData.supportive)
  ];
  const denominator = Math.max(1, rows.length);
  const counts = {};
  for (const field of fieldOrder) {
    counts[field] = {
      seen: rows.length,
      filled: 0,
      fill_rate: 0
    };
  }
  for (const row of rows) {
    const canonical = isObject(row?.canonical_fields) ? row.canonical_fields : {};
    for (const field of fieldOrder) {
      if (hasKnownValue(canonical[field])) {
        counts[field].filled += 1;
      }
    }
  }
  for (const field of fieldOrder) {
    counts[field].fill_rate = Number((counts[field].filled / denominator).toFixed(6));
  }
  return counts;
}

function normalizeOverrideFields(values = [], fieldOrder = []) {
  return normalizeMissingFieldTargets(values, { fieldOrder }).fields;
}

function deriveExpectationProfile({
  categoryConfig,
  helperData,
  constraints
}) {
  const fieldOrder = toArray(categoryConfig.fieldOrder);
  const requiredFields = normalizeMissingFieldTargets(
    categoryConfig.requiredFields || [],
    { fieldOrder }
  ).fields;
  const criticalFields = normalizeMissingFieldTargets(
    categoryConfig.schema?.critical_fields || [],
    { fieldOrder }
  ).fields;
  const requiredSet = new Set(requiredFields);
  const criticalSet = new Set(criticalFields);
  const coverage = fieldCoverageRates({
    fieldOrder,
    helperData
  });

  const forcedEasy = new Set(normalizeOverrideFields(
    categoryConfig.schema?.expected_easy_fields || [],
    fieldOrder
  ));
  const forcedSometimes = new Set([
    ...normalizeOverrideFields(categoryConfig.schema?.expected_sometimes_fields || [], fieldOrder),
    ...[...DEFAULT_EXPECTED_SOMETIMES_FIELDS].filter((field) => fieldOrder.includes(field))
  ]);
  const forcedDeep = new Set(normalizeOverrideFields(
    categoryConfig.schema?.deep_fields || [],
    fieldOrder
  ));

  const expectedEasy = new Set();
  const expectedSometimes = new Set();
  const deepFields = new Set();

  for (const field of fieldOrder) {
    if (IDENTITY_FIELDS.has(field)) {
      continue;
    }
    if (requiredSet.has(field) || criticalSet.has(field) || forcedEasy.has(field)) {
      expectedEasy.add(field);
      continue;
    }
    if (forcedDeep.has(field)) {
      deepFields.add(field);
      continue;
    }
    if (forcedSometimes.has(field)) {
      expectedSometimes.add(field);
      continue;
    }
    const fillRate = Number(coverage[field]?.fill_rate || 0);
    if (fillRate >= 0.7) {
      expectedEasy.add(field);
    } else if (fillRate >= 0.2) {
      expectedSometimes.add(field);
    } else {
      deepFields.add(field);
    }
  }

  const fieldRules = {};
  for (const field of fieldOrder) {
    if (IDENTITY_FIELDS.has(field)) {
      continue;
    }
    const constraint = constraints?.fields?.[field] || {};
    const required = requiredSet.has(field) || criticalSet.has(field);
    const isEasy = expectedEasy.has(field) || required;
    const isSometimes = expectedSometimes.has(field);
    fieldRules[field] = {
      type: String(constraint?.type || 'string'),
      enum: toArray(constraint?.enum),
      aliases: isObject(constraint?.aliases) ? constraint.aliases : {},
      evidence_min_tier: required || isEasy ? 1 : 2,
      time_target: required || isEasy ? 'fast' : (isSometimes ? 'medium' : 'slow'),
      acceptance_policy: required || isEasy ? 'strict' : 'standard'
    };
  }

  return {
    required_fields: requiredFields,
    expected_easy_fields: [...expectedEasy].sort((a, b) => a.localeCompare(b)),
    expected_sometimes_fields: [...expectedSometimes].sort((a, b) => a.localeCompare(b)),
    deep_fields: [...deepFields].sort((a, b) => a.localeCompare(b)),
    coverage_rates: coverage,
    field_rules: fieldRules
  };
}

function buildContractCounts(contract = {}) {
  const fieldCount = toArray(contract.fields).length;
  const synonymCount = Object.values(contract.synonyms || {})
    .reduce((sum, list) => sum + toArray(list).length, 0);
  const enumCount = Object.values(contract.constraints?.fields || {})
    .reduce((sum, row) => sum + toArray(row?.enum).length, 0);
  const normalizationRuleCount = Object.values(contract.normalization || {}).length;
  return {
    fields: fieldCount,
    synonyms: synonymCount,
    enums: enumCount,
    normalization_rules: normalizationRuleCount
  };
}

function buildExpectationCounts(expectations = {}) {
  return {
    required_fields: toArray(expectations.required_fields).length,
    expected_easy_fields: toArray(expectations.expected_easy_fields).length,
    expected_sometimes_fields: toArray(expectations.expected_sometimes_fields).length,
    deep_fields: toArray(expectations.deep_fields).length
  };
}

function buildUiMetadata({
  categoryConfig,
  filtersModule,
  tooltipHints
}) {
  const required = normalizeMissingFieldTargets(
    categoryConfig.requiredFields || [],
    { fieldOrder: categoryConfig.fieldOrder || [] }
  ).fields;
  const critical = toArray(categoryConfig.schema?.critical_fields);
  const expected = [...new Set([...required, ...critical])];
  return {
    filter_order: toArray(filtersModule?.filterOrder),
    expected_fields: expected,
    required_fields: required,
    critical_fields: critical,
    tooltips: tooltipHints || {}
  };
}

function pickExistingLearningArtifacts(category, config = {}) {
  const base = path.resolve(config.learningArtifactsRoot || path.join('data', 'learning'));
  return {
    field_yield_map: path.join(base, `${category}.field_yield_map.json`),
    lexicon: path.join(base, `${category}.lexicon.json`),
    component_registry: path.join(base, `${category}.component_registry.json`),
    variant_rules: path.join(base, `${category}.variant_rules.json`)
  };
}

function expectationsFilePath(category, config = {}) {
  return path.join(compiledRootDir(config), `${category}.expectations.json`);
}

function helperMirrorExpectationsPath(category, config = {}) {
  return path.join(helperMirrorDir(category, config), `${category}.expectations.json`);
}

export async function loadCompiledHelperContract({ category, config = {} }) {
  const helperPath = helperMirrorContractPath(category, config);
  const helperLoaded = await readJsonIfExists(helperPath);
  if (helperLoaded) {
    return helperLoaded;
  }
  const filePath = contractFilePath(category, config);
  return readJsonIfExists(filePath);
}

export async function loadCompiledExpectations({ category, config = {} }) {
  const helperPath = helperMirrorExpectationsPath(category, config);
  const helperLoaded = await readJsonIfExists(helperPath);
  if (helperLoaded) {
    return helperLoaded;
  }
  const filePath = expectationsFilePath(category, config);
  return readJsonIfExists(filePath);
}

export async function buildCompiledHelperContract({
  category,
  categoryConfig,
  helperData,
  config
}) {
  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  const categoryRoot = helperData?.category_root || path.join(helperRoot, category);
  const workbookPath = helperData?.excel_seed?.workbook_path || '';
  const useSupportiveData = false;
  const filtersModule = {};
  const versusModule = {};
  const sliderMetadata = buildSliderMetadata(filtersModule?.sliderItems || []);
  const labels = collectLabels({
    fieldOrder: categoryConfig.fieldOrder || [],
    filtersModule,
    versusModule
  });
  const enumHints = collectEnumHints({
    fieldOrder: categoryConfig.fieldOrder || [],
    filtersModule,
    helperData,
    includeSupportive: false
  });
  const synonyms = collectSynonyms({
    fieldOrder: categoryConfig.fieldOrder || [],
    labels,
    tooltipHints: helperData?.tooltip_hints || {},
    filtersModule,
    versusModule
  });
  const derivedRulesBase = deriveNormalizationAndConstraints({
    fieldOrder: categoryConfig.fieldOrder || [],
    sliderMetadata,
    enumHints
  });
  const derivedRules = applyFieldContractOverrides({
    fieldOrder: categoryConfig.fieldOrder || [],
    schema: categoryConfig.schema || {},
    normalization: derivedRulesBase.normalization,
    constraints: derivedRulesBase.constraints
  });
  const fields = buildFieldCatalog({
    categoryConfig,
    labels,
    normalizationRules: derivedRules.normalization
  });
  const sourceFiles = [
    workbookPath,
    helperData?.schema_file || null,
    helperData?.field_rules_file || null,
  ]
    .filter(Boolean)
    .map((filePath) => path.relative(process.cwd(), filePath).replace(/\\/g, '/'));

  const compiledAt = new Date().toISOString();
  const contractCore = {
    version: CONTRACT_VERSION,
    category,
    source_files: sourceFiles,
    fields,
    normalization: derivedRules.normalization,
    constraints: {
      ...derivedRules.constraints,
      identity: {
        minimum_identifiers: ['brand', 'model'],
        anti_merge: {
          require_brand_and_model_match: true,
          sku_disagreement_blocks_merge: true
        }
      }
    },
    synonyms,
    ui: buildUiMetadata({
      categoryConfig,
      filtersModule,
      tooltipHints: helperData?.tooltip_hints || {}
    }),
    identity: {
      minimum_identifiers: ['brand', 'model'],
      variant_fields: ['variant', 'edition', 'sku', 'mpn', 'gtin']
    },
    components: {
      registry_hooks: ['sensor', 'switch', 'encoder', 'mcu'],
      alias_map: collectComponentAliasesWithOptions(helperData, {
        includeSupportive: false
      })
    },
    learning_artifacts: pickExistingLearningArtifacts(category, config)
  };

  const hash = hashPayload(contractCore);
  const contract = {
    ...contractCore,
    generated_at: compiledAt,
    hash,
    counts: buildContractCounts(contractCore)
  };

  const expectationsCore = {
    version: CONTRACT_VERSION,
    category,
    contract_hash: hash,
    source_files: sourceFiles,
    ...deriveExpectationProfile({
      categoryConfig,
      helperData,
      constraints: contract.constraints
    })
  };
  const expectationsHash = hashPayload(expectationsCore);
  const expectations = {
    ...expectationsCore,
    generated_at: compiledAt,
    hash: expectationsHash,
    counts: buildExpectationCounts(expectationsCore)
  };

  const outputPath = contractFilePath(category, config);
  const expectationsPath = expectationsFilePath(category, config);
  const helperOutputPath = helperMirrorContractPath(category, config);
  const helperExpectationsPath = helperMirrorExpectationsPath(category, config);
  await fs.mkdir(path.dirname(helperOutputPath), { recursive: true });
  await fs.writeFile(helperOutputPath, `${JSON.stringify(contract, null, 2)}\n`, 'utf8');
  await fs.writeFile(helperExpectationsPath, `${JSON.stringify(expectations, null, 2)}\n`, 'utf8');

  let wroteDataMirror = false;
  if (config.helperWriteDataCompiledMirror) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(contract, null, 2)}\n`, 'utf8');
    await fs.writeFile(expectationsPath, `${JSON.stringify(expectations, null, 2)}\n`, 'utf8');
    wroteDataMirror = true;
  }

  return {
    file_path: wroteDataMirror ? outputPath : helperOutputPath,
    helper_file_path: helperOutputPath,
    contract,
    expectations_file_path: wroteDataMirror ? expectationsPath : helperExpectationsPath,
    helper_expectations_file_path: helperExpectationsPath,
    expectations,
    data_mirror_written: wroteDataMirror
  };
}
