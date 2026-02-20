import fs from 'node:fs/promises';
import path from 'node:path';
import { toPosixKey } from '../s3/storage.js';
import { normalizeToken, normalizeWhitespace } from '../utils/common.js';
import { upsertQueueProduct } from '../queue/queueState.js';
import { slugify as canonicalSlugify } from '../catalog/slugify.js';
import {
  evaluateIdentityGate,
  loadCanonicalIdentityIndex,
  registerCanonicalIdentity
} from '../catalog/identityGate.js';

const CACHE = new Map();
const CACHE_TTL_MS = 45_000;

const BRAND_ALIASES = {
  'logitech g': 'logitech',
  logitechg: 'logitech',
  'endgame gear': 'endgamegear',
  'lenovo legion': 'lenovo',
  'mad catz': 'madcatz',
  'zowie by benq': 'zowie',
  'benq zowie': 'zowie',
  'xtrfy by cherry': 'xtrfy'
};

const IDENTITY_FIELDS = new Set([
  'id',
  'brand',
  'model',
  'base_model',
  'category',
  'sku'
]);

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function asString(value) {
  return normalizeWhitespace(value);
}

function hasValue(value) {
  if (Array.isArray(value)) {
    return value.some((entry) => hasValue(entry));
  }
  const token = String(value ?? '').trim().toLowerCase();
  return token !== '' && token !== 'unk' && token !== 'null' && token !== 'undefined';
}

function slug(value) {
  return canonicalSlugify(value);
}

function normalizeBrand(value) {
  const token = normalizeToken(value)
    .replace(/\s+/g, ' ')
    .trim();
  return BRAND_ALIASES[token] || token;
}

function normalizeModel(value) {
  return normalizeToken(value)
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeModelLoose(value) {
  return normalizeModel(value)
    .replace(/\b(mouse|gaming|wireless|wired|edition|series|version|aim|lab)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeVariant(value) {
  return normalizeToken(value)
    .replace(/\s+/g, ' ')
    .trim();
}

function identityKey(brand, model) {
  const b = normalizeBrand(brand);
  const m = normalizeModel(model);
  if (!b || !m) {
    return '';
  }
  return `${b}||${m}`;
}

function identityKeyLoose(brand, model) {
  const b = normalizeBrand(brand);
  const m = normalizeModelLoose(model);
  if (!b || !m) {
    return '';
  }
  return `${b}||${m}`;
}

function helperRoot(config) {
  return path.resolve(config.helperFilesRoot || 'helper_files');
}

function resolveCategoryPaths(config, category) {
  const root = helperRoot(config);
  const categoryRoot = path.join(root, category);
  return {
    root,
    categoryRoot,
    activeFilteringPath: path.join(categoryRoot, 'activeFiltering.json')
  };
}

async function readJsonFileOrNull(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return JSON.parse(text);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function normalizeCanonicalValue(value) {
  if (!hasValue(value)) {
    return '';
  }
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeCanonicalValue(entry))
      .filter(Boolean)
      .join(', ');
  }
  return asString(value);
}

function parseBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  const token = normalizeToken(value);
  if (!token) {
    return null;
  }
  if (['1', 'true', 'yes', 'y', 'enabled', 'wireless'].includes(token)) {
    return true;
  }
  if (['0', 'false', 'no', 'n', 'disabled', 'wired'].includes(token)) {
    return false;
  }
  return null;
}

function firstArrayValue(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return '';
  }
  return value[0];
}

function firstSwitchObject(row) {
  const list = toArray(row.mouse__switch_objects);
  return list[0] || null;
}

function firstEncoderObject(row) {
  const list = toArray(row.mouse__scroll_wheel_encoder_objects);
  return list[0] || null;
}

function mouseSupportiveCanonicalFields(row) {
  const switchObj = firstSwitchObject(row);
  const encoderObj = firstEncoderObject(row);
  const wireless = parseBoolean(row.mouse__wireless);
  const sensorBrand = firstArrayValue(row.mouse__sensor_brand_names);
  const switchBrand = firstArrayValue(switchObj?.general__brand_names);
  const switchValue = normalizeWhitespace([
    switchObj?.general__model || '',
    switchObj?.general__variant || ''
  ].filter(Boolean).join(' '));

  const fields = {
    release_date: row.general__release_date || '',
    connection: wireless === true ? 'wireless' : wireless === false ? 'wired' : '',
    connectivity: wireless === true ? 'wireless' : wireless === false ? 'wired' : '',
    weight: row.mouse__weight,
    lngth: row.mouse__length,
    width: row.mouse__width,
    height: row.mouse__height,
    form_factor: row.mouse__shape,
    shape: row.mouse__shape,
    thumb_rest: row.mouse__thumb_rest,
    sensor: row.mouse__sensor_model,
    sensor_brand: sensorBrand,
    sensor_type: row.mouse__sensor_type,
    polling_rate: row.mouse__polling_rate,
    dpi: row.mouse__dpi,
    switch: switchValue,
    switch_brand: switchBrand,
    hot_swappable: row.mouse__hot_swappable_switches,
    side_buttons: row.mouse__side_buttons,
    middle_buttons: row.mouse__middle_buttons,
    encoder: encoderObj?.general__model || '',
    encoder_brand: firstArrayValue(encoderObj?.general__brand_names),
    wireless_charging: row.mouse__wireless_charging || '',
    material: row.mouse__material_name_general || row.mouse__material_name_specific || ''
  };

  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    const normalized = normalizeCanonicalValue(value);
    if (!normalized) {
      continue;
    }
    out[key] = normalized;
  }
  return out;
}

function canonicalFieldsFromSchemaLikeRow(row, fieldOrder) {
  const set = new Set(fieldOrder || []);
  const output = {};
  for (const key of Object.keys(row || {})) {
    if (set.has(key)) {
      const normalized = normalizeCanonicalValue(row[key]);
      if (normalized) {
        output[key] = normalized;
      }
      continue;
    }
    if (key === 'switch_link' && set.has('switches_link')) {
      const normalized = normalizeCanonicalValue(row[key]);
      if (normalized) {
        output.switches_link = normalized;
      }
    }
  }
  return output;
}

function parseActiveRow({ row, category, categoryConfig, sourceFile }) {
  const brand = asString(row.brand);
  const model = asString(row.model);
  if (!brand || !model) {
    return null;
  }
  const variant = asString(row.variant);
  const seedUrls = [];
  if (hasValue(row.url)) {
    seedUrls.push(asString(row.url));
  }
  for (const value of toArray(row.seedUrls || row.seed_urls || [])) {
    if (hasValue(value)) {
      seedUrls.push(asString(value));
    }
  }
  const canonicalFields = canonicalFieldsFromSchemaLikeRow(row, categoryConfig.fieldOrder || []);

  return {
    source: sourceFile,
    record_id: row.id ?? null,
    brand,
    model,
    variant,
    category: asString(row.category) || category,
    identity_key: identityKey(brand, model),
    identity_key_loose: identityKeyLoose(brand, model),
    seed_urls: [...new Set(seedUrls.filter(Boolean))],
    canonical_fields: canonicalFields,
    raw: row
  };
}

function extractSupportiveRows(raw) {
  if (!raw) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw;
  }
  if (Array.isArray(raw.rows)) {
    return raw.rows;
  }
  if (Array.isArray(raw.items)) {
    return raw.items;
  }
  if (Array.isArray(raw.data)) {
    return raw.data;
  }
  if (raw && typeof raw === 'object') {
    if (raw.brand && raw.model) {
      return [raw];
    }
    if (raw.general__model) {
      return [raw];
    }
  }
  return [];
}

function parseSupportiveRow({
  row,
  index,
  category,
  categoryConfig,
  sourceFile
}) {
  const output = [];
  const schemaLikeBrand = asString(row.brand);
  const schemaLikeModel = asString(row.model);
  if (schemaLikeBrand && schemaLikeModel) {
    output.push({
      source: sourceFile,
      record_id: row.id ?? index,
      brand: schemaLikeBrand,
      model: schemaLikeModel,
      variant: asString(row.variant),
      category: asString(row.category) || category,
      identity_key: identityKey(schemaLikeBrand, schemaLikeModel),
      identity_key_loose: identityKeyLoose(schemaLikeBrand, schemaLikeModel),
      canonical_fields: canonicalFieldsFromSchemaLikeRow(row, categoryConfig.fieldOrder || []),
      raw: row
    });
    return output;
  }

  if (category !== 'mouse') {
    return output;
  }

  const model = asString(row.general__model);
  if (!model) {
    return output;
  }
  const variant = asString(row.general__variant);
  const brandNames = toArray(row.general__brand_names);
  for (const brandName of brandNames) {
    const brand = asString(brandName);
    if (!brand) {
      continue;
    }
    output.push({
      source: sourceFile,
      record_id: row.general__id ?? index,
      brand,
      model,
      variant,
      category,
      identity_key: identityKey(brand, model),
      identity_key_loose: identityKeyLoose(brand, model),
      canonical_fields: mouseSupportiveCanonicalFields(row),
      raw: row
    });
  }

  return output;
}

function buildIndex(records) {
  const exact = new Map();
  const loose = new Map();
  for (const row of records || []) {
    if (row.identity_key) {
      if (!exact.has(row.identity_key)) {
        exact.set(row.identity_key, []);
      }
      exact.get(row.identity_key).push(row);
    }
    if (row.identity_key_loose) {
      if (!loose.has(row.identity_key_loose)) {
        loose.set(row.identity_key_loose, []);
      }
      loose.get(row.identity_key_loose).push(row);
    }
  }
  return {
    exact,
    loose
  };
}

function pickBestByVariant(rows, identityLock = {}) {
  if (!rows.length) {
    return null;
  }
  const expectedVariant = normalizeVariant(identityLock.variant);
  if (!expectedVariant) {
    return rows[0];
  }
  const best = rows
    .map((row) => {
      const variant = normalizeVariant(row.variant);
      let score = 0;
      if (!variant) {
        score += 0.1;
      }
      if (variant === expectedVariant) {
        score += 1;
      } else if (variant && expectedVariant && (variant.includes(expectedVariant) || expectedVariant.includes(variant))) {
        score += 0.7;
      }
      return { row, score };
    })
    .sort((a, b) => b.score - a.score);
  return best[0]?.row || rows[0];
}

export async function loadHelperCategoryData({
  config,
  category,
  categoryConfig,
  forceRefresh = false
}) {
  if (!config.helperFilesEnabled) {
    return {
      enabled: false,
      category,
      root: helperRoot(config),
      active: [],
      supportive: [],
      supportive_files: [],
      active_index: buildIndex([]),
      supportive_index: buildIndex([])
    };
  }

  const cacheKey = `${helperRoot(config)}::${category}`;
  const cached = CACHE.get(cacheKey);
  if (!forceRefresh && cached && (Date.now() - cached.loadedAt) < CACHE_TTL_MS) {
    return cached.data;
  }

  const paths = resolveCategoryPaths(config, category);
  const activeRaw = await readJsonFileOrNull(paths.activeFilteringPath);
  const activeRows = toArray(activeRaw)
    .map((row) => parseActiveRow({
      row,
      category,
      categoryConfig,
      sourceFile: path.basename(paths.activeFilteringPath)
    }))
    .filter(Boolean);

  const supportiveRows = [];
  const supportiveFiles = [];

  const data = {
    enabled: true,
    category,
    root: paths.root,
    category_root: paths.categoryRoot,
    active: activeRows,
    supportive: supportiveRows,
    supportive_files: supportiveFiles.map((filePath) => path.basename(filePath)),
    active_index: buildIndex(activeRows),
    supportive_index: buildIndex(supportiveRows)
  };

  CACHE.set(cacheKey, {
    loadedAt: Date.now(),
    data
  });

  return data;
}

function findIndexedRows(index, identityLock = {}) {
  const exactKey = identityKey(identityLock.brand, identityLock.model);
  const looseKey = identityKeyLoose(identityLock.brand, identityLock.model);
  const exactRows = exactKey ? (index.exact.get(exactKey) || []) : [];
  if (exactRows.length > 0) {
    return exactRows;
  }
  const looseRows = looseKey ? (index.loose.get(looseKey) || []) : [];
  return looseRows;
}

export function resolveHelperProductContext({
  helperData,
  job
}) {
  if (!helperData?.enabled) {
    return {
      enabled: false,
      active_match: null,
      supportive_matches: []
    };
  }

  const identityLock = job.identityLock || {};
  const activeMatches = findIndexedRows(helperData.active_index, identityLock);
  const activeMatch = pickBestByVariant(activeMatches, identityLock);

  const seedUrls = [
    ...(activeMatch?.seed_urls || []),
    ...toArray(job.seedUrls || [])
  ].filter(Boolean);

  return {
    enabled: true,
    active_match: activeMatch,
    supportive_matches: [],
    seed_urls: [...new Set(seedUrls)],
    stats: {
      active_total: helperData.active.length,
      supportive_total: 0,
      supportive_file_count: 0,
      active_matched_count: activeMatches.length,
      supportive_matched_count: 0
    }
  };
}

function supportSourceUrl(category, match) {
  return `helper_files://${category}/${match.source}#${match.record_id ?? 'row'}`;
}

export function buildSupportiveSyntheticSources({
  helperContext,
  job,
  categoryConfig,
  anchors = {},
  maxSources = 6
}) {
  if (!helperContext?.enabled) {
    return [];
  }
  const limit = Math.max(1, maxSources);
  const matches = [];
  const seen = new Set();
  for (const match of (helperContext.supportive_matches || []).slice(0, limit)) {
    const key = `${match.source}#${match.record_id ?? ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    matches.push({
      ...match,
      __helper_method: 'helper_supportive',
      __helper_reason: 'helper_supportive_match'
    });
  }
  if (helperContext.active_match) {
    const active = helperContext.active_match;
    const key = `${active.source}#${active.record_id ?? ''}`;
    if (!seen.has(key)) {
      matches.push({
        ...active,
        __helper_method: 'helper_active_filtering',
        __helper_reason: 'helper_active_match'
      });
    }
  }
  const output = [];

  for (const match of matches) {
    const helperMethod = match.__helper_method || 'helper_supportive';
    const fieldCandidates = [];
    for (const field of categoryConfig.fieldOrder || []) {
      if (IDENTITY_FIELDS.has(field)) {
        continue;
      }
      const value = normalizeCanonicalValue(match.canonical_fields?.[field]);
      if (!value) {
        continue;
      }
      fieldCandidates.push({
        field,
        value,
        method: helperMethod,
        keyPath: `${helperMethod}.${field}`
      });
    }

    if (!fieldCandidates.length) {
      continue;
    }

    const url = supportSourceUrl(job.category || categoryConfig.category, match);
    const source = {
      url,
      finalUrl: url,
      host: 'helper-files.local',
      rootDomain: 'helper-files.local',
      tier: 2,
      tierName: 'database',
      role: 'database',
      approvedDomain: true,
      candidateSource: false,
      ts: new Date().toISOString(),
      title: `${match.brand} ${match.model} ${helperMethod === 'helper_active_filtering' ? 'helper active' : 'helper supportive'}`,
      identityCandidates: {
        brand: match.brand,
        model: match.model,
        variant: match.variant || '',
        sku: asString(match.raw?.sku || ''),
        mpn: asString(match.raw?.mpn || ''),
        gtin: asString(match.raw?.gtin || '')
      },
      fieldCandidates,
      anchorCheck: {
        conflicts: [],
        majorConflicts: []
      },
      anchorStatus: 'pass',
      identity: {
        match: true,
        score: 0.99,
        reasons: [match.__helper_reason || 'helper_supportive_match'],
        criticalConflicts: []
      },
      endpointSignals: [],
      endpointSuggestions: [],
      temporalSignals: [],
      fingerprint: {
        id: `helper:${match.source}`
      },
      parserHealth: {
        candidate_count: fieldCandidates.length,
        identity_match: true,
        major_anchor_conflicts: 0,
        health_score: 1
      },
      status: 200,
      helperSource: true
    };

    // Honor explicit anchor locks: do not emit conflicting helper candidates.
    source.fieldCandidates = source.fieldCandidates.filter((candidate) => {
      const lock = normalizeCanonicalValue(anchors[candidate.field]);
      if (!lock) {
        return true;
      }
      return normalizeToken(lock) === normalizeToken(candidate.value);
    });
    if (source.fieldCandidates.length === 0) {
      continue;
    }
    output.push(source);
  }

  return output;
}

function comparableValue(value) {
  const text = normalizeCanonicalValue(value);
  if (!text) {
    return '';
  }
  const numeric = Number.parseFloat(text);
  if (Number.isFinite(numeric) && String(text).match(/^-?\d+(\.\d+)?$/)) {
    return String(Number.isInteger(numeric) ? numeric : Number.parseFloat(numeric.toFixed(4)));
  }
  return normalizeToken(text);
}

export function applySupportiveFillToResult({
  helperContext,
  normalized,
  provenance,
  fieldsBelowPassTarget,
  criticalFieldsBelowPassTarget,
  categoryConfig
}) {
  const supportMatches = [];
  const seen = new Set();
  for (const match of helperContext?.supportive_matches || []) {
    const key = `${match.source}#${match.record_id ?? ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    supportMatches.push({
      match,
      method: 'helper_supportive',
      keyPrefix: 'helper_supportive'
    });
  }
  if (helperContext?.active_match) {
    const active = helperContext.active_match;
    const key = `${active.source}#${active.record_id ?? ''}`;
    if (!seen.has(key)) {
      supportMatches.push({
        match: active,
        method: 'helper_active_filtering',
        keyPrefix: 'helper_active_filtering'
      });
    }
  }

  if (!supportMatches.length) {
    return {
      filled_fields: [],
      mismatches: [],
      filled_by_method: {},
      fields_below_pass_target: fieldsBelowPassTarget,
      critical_fields_below_pass_target: criticalFieldsBelowPassTarget
    };
  }

  const filledFields = [];
  const filledByMethod = {};
  const mismatches = [];
  const fieldsBelow = new Set(fieldsBelowPassTarget || []);
  const criticalBelow = new Set(criticalFieldsBelowPassTarget || []);

  for (const field of categoryConfig.fieldOrder || []) {
    if (IDENTITY_FIELDS.has(field)) {
      continue;
    }
    const sourceEntry = supportMatches.find((entry) =>
      normalizeCanonicalValue(entry.match.canonical_fields?.[field])
    );
    if (!sourceEntry) {
      continue;
    }
    const pickedMatch = sourceEntry.match;
    const helperMethod = sourceEntry.method;
    const keyPrefix = sourceEntry.keyPrefix;
    const pickedValue = normalizeCanonicalValue(pickedMatch.canonical_fields?.[field]);
    const sourceUrl = supportSourceUrl(normalized.category, pickedMatch);

    const current = normalizeCanonicalValue(normalized.fields?.[field]);
    if (!current || current.toLowerCase() === 'unk') {
      normalized.fields[field] = pickedValue;
      const previous = provenance[field] || {};
      provenance[field] = {
        ...previous,
        value: pickedValue,
        anchor_locked: Boolean(previous.anchor_locked),
        confirmations: Math.max(1, Number.parseInt(String(previous.confirmations || 0), 10) || 0),
        approved_confirmations: Math.max(1, Number.parseInt(String(previous.approved_confirmations || 0), 10) || 0),
        pass_target: 1,
        meets_pass_target: true,
        confidence: Math.max(0.95, Number.parseFloat(String(previous.confidence || 0)) || 0.95),
        evidence: [
          ...(previous.evidence || []),
          {
            url: sourceUrl,
            host: 'helper-files.local',
            rootDomain: 'helper-files.local',
            tier: 2,
            tierName: 'database',
            method: helperMethod,
            keyPath: `${keyPrefix}.${field}`,
            approvedDomain: true
          }
        ]
      };
      fieldsBelow.delete(field);
      criticalBelow.delete(field);
      filledFields.push(field);
      filledByMethod[helperMethod] = (filledByMethod[helperMethod] || 0) + 1;
      continue;
    }

    if (comparableValue(current) !== comparableValue(pickedValue)) {
      mismatches.push({
        field,
        pipeline_value: current,
        supportive_value: pickedValue,
        supportive_source: pickedMatch.source,
        helper_method: helperMethod
      });
    }
  }

  return {
    filled_fields: filledFields,
    mismatches,
    filled_by_method: filledByMethod,
    fields_below_pass_target: [...fieldsBelow],
    critical_fields_below_pass_target: [...criticalBelow]
  };
}

export async function syncJobsFromActiveFiltering({
  storage,
  config,
  category,
  categoryConfig,
  limit = 0,
  logger = null
}) {
  if (!config.helperFilesEnabled || !config.helperAutoSeedTargets) {
    return {
      enabled: false,
      category,
      active_rows: 0,
      created: 0,
      skipped_existing: 0,
      skipped_identity_gate: 0,
      failed: 0
    };
  }

  const helperData = await loadHelperCategoryData({
    config,
    category,
    categoryConfig,
    forceRefresh: false
  });
  const rows = helperData.active || [];
  const configuredLimit = Math.max(0, Number.parseInt(String(config.helperActiveSyncLimit || 0), 10) || 0);
  const effectiveLimit = limit > 0 ? limit : configuredLimit;
  const bounded = effectiveLimit > 0 ? rows.slice(0, effectiveLimit) : rows;
  const canonicalIndex = await loadCanonicalIdentityIndex({ config, category });
  let created = 0;
  let skippedExisting = 0;
  let skippedIdentityGate = 0;
  let failed = 0;

  for (const row of bounded) {
    const brand = asString(row.brand);
    const model = asString(row.model);
    const rawVariant = asString(row.variant);
    if (!brand || !model) {
      continue;
    }
    const gate = evaluateIdentityGate({
      category,
      brand,
      model,
      variant: rawVariant,
      canonicalIndex
    });
    if (!gate.valid) {
      skippedIdentityGate += 1;
      logger?.info?.('identity_gate_rejected', {
        category,
        brand,
        model,
        variant: rawVariant,
        reason: gate.reason,
        canonicalProductId: gate.canonicalProductId
      });
      continue;
    }

    const identity = gate.normalized;
    const productId = identity.productId;
    const variant = identity.variant;
    if (!productId) continue;
    registerCanonicalIdentity({
      canonicalIndex,
      brand: identity.brand,
      model: identity.model,
      variant,
      productId
    });

    const s3key = toPosixKey(config.s3InputPrefix, category, 'products', `${productId}.json`);
    const exists = await storage.objectExists(s3key);
    if (exists) {
      skippedExisting += 1;
      continue;
    }

    const job = {
      productId,
      category,
      identityLock: {
        brand,
        model,
        variant,
        sku: asString(row.raw?.sku || ''),
        mpn: asString(row.raw?.mpn || ''),
        gtin: asString(row.raw?.gtin || '')
      },
      seedUrls: [...new Set((row.seed_urls || []).filter(Boolean))],
      anchors: {}
    };

    try {
      await storage.writeObject(
        s3key,
        Buffer.from(JSON.stringify(job, null, 2), 'utf8'),
        { contentType: 'application/json' }
      );
      await upsertQueueProduct({
        storage,
        category,
        productId,
        s3key,
        patch: {
          status: 'pending',
          next_action_hint: 'fast_pass'
        }
      });
      created += 1;
    } catch (error) {
      failed += 1;
      logger?.warn?.('helper_active_target_sync_failed', {
        category,
        productId,
        s3key,
        message: error.message
      });
    }
  }

  return {
    enabled: true,
    category,
    active_rows: rows.length,
    created,
    skipped_existing: skippedExisting,
    skipped_identity_gate: skippedIdentityGate,
    failed
  };
}
