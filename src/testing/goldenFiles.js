import fs from 'node:fs/promises';
import path from 'node:path';
import { extractExcelSeedData, loadCategoryFieldRules } from '../ingest/excelSeed.js';
import { ruleRequiredLevel } from '../engine/ruleAccessors.js';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeFieldKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeCategory(value) {
  return normalizeFieldKey(value);
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function nowIso() {
  return new Date().toISOString();
}

function sortDeep(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortDeep(item));
  }
  if (!isObject(value)) {
    return value;
  }
  const out = {};
  for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
    out[key] = sortDeep(value[key]);
  }
  return out;
}

function stableStringify(value) {
  return JSON.stringify(sortDeep(value), null, 2);
}

async function writeJsonStable(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${stableStringify(payload)}\n`, 'utf8');
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

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function toNumberIfFinite(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number.parseFloat(String(value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeForCompare(value) {
  if (value === null || value === undefined) {
    return 'unk';
  }
  const num = toNumberIfFinite(value);
  if (num !== null) {
    return `num:${num}`;
  }
  return `str:${String(value).trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

function isUnknownValue(value) {
  const token = String(value ?? '').trim().toLowerCase();
  return !token || token === 'unk' || token === 'unknown' || token === 'n/a';
}

function goldenRootFromConfig(config = {}) {
  return path.resolve(config.goldenRoot || path.join('fixtures', 'golden'));
}

function categoryGoldenRoot(category, config = {}) {
  return path.join(goldenRootFromConfig(config), normalizeCategory(category));
}

function manifestPath(category, config = {}) {
  return path.join(categoryGoldenRoot(category, config), 'manifest.json');
}

async function resolveWorkbookPathFromMap({
  workbookPath = '',
  helperRoot = '',
  category = ''
}) {
  const token = normalizeText(workbookPath);
  if (!token) {
    return '';
  }
  if (path.isAbsolute(token)) {
    return token;
  }
  const normalizedCategory = normalizeCategory(category);
  const candidates = [
    path.resolve(token),
    path.resolve(helperRoot, normalizedCategory, token),
    path.resolve(helperRoot, token),
    path.resolve(process.cwd(), token)
  ];
  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    if (await fileExists(candidate)) {
      return candidate;
    }
  }
  return path.resolve(helperRoot, normalizedCategory, path.basename(token));
}

function defaultManifest(category) {
  return {
    version: 1,
    category: normalizeCategory(category),
    updated_at: nowIso(),
    cases: []
  };
}

async function loadManifest(category, config = {}) {
  const fullPath = manifestPath(category, config);
  const parsed = await readJsonIfExists(fullPath);
  if (!isObject(parsed) || !Array.isArray(parsed.cases)) {
    return {
      file_path: fullPath,
      value: defaultManifest(category)
    };
  }
  return {
    file_path: fullPath,
    value: {
      ...defaultManifest(category),
      ...parsed,
      category: normalizeCategory(parsed.category || category),
      cases: toArray(parsed.cases)
    }
  };
}

async function saveManifest(filePath, manifest) {
  const cases = toArray(manifest.cases)
    .filter((row) => isObject(row) && normalizeText(row.product_id))
    .map((row) => ({
      product_id: normalizeText(row.product_id),
      identity: isObject(row.identity) ? row.identity : {},
      expected_path: normalizeText(row.expected_path),
      identity_path: normalizeText(row.identity_path),
      notes_path: normalizeText(row.notes_path),
      created_at: normalizeText(row.created_at) || nowIso(),
      updated_at: normalizeText(row.updated_at) || nowIso()
    }))
    .sort((a, b) => a.product_id.localeCompare(b.product_id));
  await writeJsonStable(filePath, {
    ...manifest,
    updated_at: nowIso(),
    cases
  });
}

function normalizeExpectedFields(fields = {}) {
  const out = {};
  for (const [rawField, rawValue] of Object.entries(isObject(fields) ? fields : {})) {
    const field = normalizeFieldKey(rawField);
    if (!field) {
      continue;
    }
    if (isObject(rawValue) && Object.prototype.hasOwnProperty.call(rawValue, 'value')) {
      out[field] = {
        value: rawValue.value,
        confidence: normalizeText(rawValue.confidence || 'verified') || 'verified',
        source: normalizeText(rawValue.source || 'seed') || 'seed'
      };
      continue;
    }
    out[field] = {
      value: rawValue,
      confidence: 'verified',
      source: 'seed'
    };
  }
  return out;
}

function normalizeIdentity({
  category,
  productId,
  identity = {}
}) {
  const normalized = {
    brand: normalizeText(identity.brand || ''),
    model: normalizeText(identity.model || ''),
    variant: normalizeText(identity.variant || '')
  };
  if (!normalized.brand || !normalized.model) {
    const pieces = String(productId || '').split('-').filter(Boolean);
    if (pieces.length >= 3 && normalizeCategory(category) === pieces[0]) {
      normalized.brand = normalized.brand || pieces[1];
      normalized.model = normalized.model || pieces.slice(2).join(' ');
    }
  }
  return normalized;
}

function normalizeExpectedUnknowns(expectedUnknowns = {}) {
  const out = {};
  for (const [rawField, rawReason] of Object.entries(isObject(expectedUnknowns) ? expectedUnknowns : {})) {
    const field = normalizeFieldKey(rawField);
    const reason = normalizeText(rawReason);
    if (!field || !reason) {
      continue;
    }
    out[field] = reason;
  }
  return out;
}

function inferProductId({
  category,
  identity,
  fallback = ''
}) {
  if (normalizeText(fallback)) {
    return normalizeText(fallback);
  }
  const parts = [
    normalizeCategory(category),
    slug(identity.brand),
    slug(identity.model),
    slug(identity.variant)
  ].filter(Boolean);
  return parts.join('-');
}

function normalizeExpectedFieldValue(rawValue) {
  if (isObject(rawValue) && Object.prototype.hasOwnProperty.call(rawValue, 'value')) {
    return rawValue.value;
  }
  return rawValue;
}

// readRequiredLevel replaced by ruleRequiredLevel from ruleAccessors.js
const readRequiredLevel = ruleRequiredLevel;

function readGroup(rule = {}) {
  return normalizeFieldKey(
    rule.group ||
    (isObject(rule.ui) ? rule.ui.group : '') ||
    'general'
  ) || 'general';
}

export async function createGoldenFixture({
  category,
  productId = '',
  identity = {},
  fields = {},
  expectedUnknowns = {},
  notes = '',
  config = {}
}) {
  const normalizedCategory = normalizeCategory(category);
  if (!normalizedCategory) {
    throw new Error('category_required');
  }
  const normalizedIdentity = normalizeIdentity({
    category: normalizedCategory,
    productId,
    identity
  });
  const normalizedProductId = inferProductId({
    category: normalizedCategory,
    identity: normalizedIdentity,
    fallback: productId
  });
  if (!normalizedProductId) {
    throw new Error('product_id_required');
  }

  const categoryRoot = categoryGoldenRoot(normalizedCategory, config);
  const caseRoot = path.join(categoryRoot, normalizedProductId);
  const expectedPath = path.join(caseRoot, 'expected.json');
  const identityPath = path.join(caseRoot, 'identity.json');
  const notesPath = path.join(caseRoot, 'notes.md');

  const expectedPayload = {
    product_id: normalizedProductId,
    category: normalizedCategory,
    identity: normalizedIdentity,
    fields: normalizeExpectedFields(fields),
    expected_unknowns: normalizeExpectedUnknowns(expectedUnknowns)
  };

  await writeJsonStable(expectedPath, expectedPayload);
  await writeJsonStable(identityPath, normalizedIdentity);
  if (normalizeText(notes)) {
    await fs.mkdir(caseRoot, { recursive: true });
    await fs.writeFile(notesPath, `${String(notes).trim()}\n`, 'utf8');
  }

  const loadedManifest = await loadManifest(normalizedCategory, config);
  const manifest = loadedManifest.value;
  const caseRelDir = path.relative(path.dirname(loadedManifest.file_path), caseRoot).replace(/\\/g, '/');
  const nextRow = {
    product_id: normalizedProductId,
    identity: normalizedIdentity,
    expected_path: `${caseRelDir}/expected.json`,
    identity_path: `${caseRelDir}/identity.json`,
    notes_path: normalizeText(notes) ? `${caseRelDir}/notes.md` : '',
    created_at: nowIso(),
    updated_at: nowIso()
  };
  const existingIndex = manifest.cases.findIndex((row) => row?.product_id === normalizedProductId);
  if (existingIndex >= 0) {
    nextRow.created_at = normalizeText(manifest.cases[existingIndex].created_at) || nextRow.created_at;
    manifest.cases[existingIndex] = nextRow;
  } else {
    manifest.cases.push(nextRow);
  }
  await saveManifest(loadedManifest.file_path, manifest);

  return {
    created: true,
    category: normalizedCategory,
    product_id: normalizedProductId,
    fixture_root: caseRoot,
    expected_path: expectedPath,
    identity_path: identityPath,
    notes_path: normalizeText(notes) ? notesPath : ''
  };
}

async function listGoldenCasesWithPayload(category, config = {}) {
  const normalizedCategory = normalizeCategory(category);
  const loadedManifest = await loadManifest(normalizedCategory, config);
  const baseDir = path.dirname(loadedManifest.file_path);
  const rows = [];

  for (const row of loadedManifest.value.cases) {
    const productId = normalizeText(row?.product_id);
    if (!productId) {
      continue;
    }
    const expectedPath = normalizeText(row.expected_path)
      ? path.resolve(baseDir, row.expected_path)
      : path.join(baseDir, productId, 'expected.json');
    const identityPath = normalizeText(row.identity_path)
      ? path.resolve(baseDir, row.identity_path)
      : path.join(baseDir, productId, 'identity.json');
    const [expected, identity] = await Promise.all([
      readJsonIfExists(expectedPath),
      readJsonIfExists(identityPath)
    ]);
    rows.push({
      product_id: productId,
      expected_path: expectedPath,
      identity_path: identityPath,
      expected,
      identity
    });
  }
  return {
    category: normalizedCategory,
    manifest_path: loadedManifest.file_path,
    manifest: loadedManifest.value,
    cases: rows
  };
}

export async function createGoldenFromExcel({
  category,
  count = 50,
  productId = '',
  config = {}
}) {
  const normalizedCategory = normalizeCategory(category);
  if (!normalizedCategory) {
    throw new Error('category_required');
  }
  const fieldRules = await loadCategoryFieldRules(normalizedCategory, config);
  if (!fieldRules?.value || !isObject(fieldRules.value.fields)) {
    throw new Error(`field_rules_not_found:${normalizedCategory}`);
  }
  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  const workbookMapPath = path.join(
    helperRoot,
    normalizedCategory,
    '_control_plane',
    'workbook_map.json'
  );
  const workbookMap = await readJsonIfExists(workbookMapPath);
  const resolvedWorkbookPath = await resolveWorkbookPathFromMap({
    workbookPath: normalizeText(workbookMap?.workbook_path || ''),
    helperRoot,
    category: normalizedCategory
  });
  const excelOverride = isObject(workbookMap)
    ? {
      workbook: resolvedWorkbookPath || normalizeText(workbookMap.workbook_path || ''),
      sheet: normalizeText(workbookMap?.key_list?.sheet || workbookMap?.product_table?.sheet || 'dataEntry') || 'dataEntry',
      field_label_column: normalizeText(workbookMap?.key_list?.column || 'B') || 'B',
      field_row_start: Number.parseInt(String(workbookMap?.key_list?.row_start || '9'), 10) || 9,
      field_row_end: Number.parseInt(String(workbookMap?.key_list?.row_end || '83'), 10) || 83,
      brand_row: Number.parseInt(String(workbookMap?.product_table?.brand_row || '3'), 10) || 3,
      model_row: Number.parseInt(String(workbookMap?.product_table?.model_row || '4'), 10) || 4,
      variant_row: Number.parseInt(String(workbookMap?.product_table?.variant_row || '5'), 10) || 5,
      data_column_start: normalizeText(workbookMap?.product_table?.value_col_start || 'C') || 'C',
      data_column_end: normalizeText(workbookMap?.product_table?.value_col_end || '')
    }
    : {};
  const fieldRulesForSeed = {
    ...fieldRules.value,
    excel: {
      ...(isObject(fieldRules.value.excel) ? fieldRules.value.excel : {}),
      ...excelOverride
    }
  };
  const fieldOrder = Object.keys(fieldRules.value.fields)
    .map((value) => normalizeFieldKey(value))
    .filter(Boolean);
  const extracted = await extractExcelSeedData({
    category: normalizedCategory,
    config,
    fieldRules: fieldRulesForSeed,
    fieldOrder
  });
  if (!extracted.enabled) {
    throw new Error(`excel_seed_unavailable:${extracted.error || 'unknown'}`);
  }

  const chosen = [];
  if (normalizeText(productId)) {
    const wanted = normalizeText(productId);
    for (const row of extracted.products) {
      const inferred = inferProductId({
        category: normalizedCategory,
        identity: {
          brand: row.brand,
          model: row.model,
          variant: row.variant
        }
      });
      if (inferred === wanted) {
        chosen.push(row);
        break;
      }
    }
  } else {
    const limit = Math.max(1, Number.parseInt(String(count || 50), 10) || 50);
    chosen.push(...extracted.products.slice(0, limit));
  }

  let createdCount = 0;
  const created = [];
  for (const row of chosen) {
    const identity = {
      brand: row.brand,
      model: row.model,
      variant: row.variant
    };
    const inferredProductId = inferProductId({
      category: normalizedCategory,
      identity
    });
    const createdFixture = await createGoldenFixture({
      category: normalizedCategory,
      productId: inferredProductId,
      identity,
      fields: row.canonical_fields || {},
      config
    });
    createdCount += 1;
    created.push(createdFixture.product_id);
  }

  const listing = await listGoldenCasesWithPayload(normalizedCategory, config);
  return {
    category: normalizedCategory,
    workbook_path: extracted.workbook_path,
    parser: extracted.parser || 'unknown',
    products_seen: extracted.products.length,
    created_count: createdCount,
    created_product_ids: created,
    case_count: listing.cases.length,
    manifest_path: listing.manifest_path
  };
}

export async function validateGoldenFixtures({
  category,
  config = {}
}) {
  const normalizedCategory = normalizeCategory(category);
  if (!normalizedCategory) {
    throw new Error('category_required');
  }

  const listing = await listGoldenCasesWithPayload(normalizedCategory, config);
  const fieldRules = await loadCategoryFieldRules(normalizedCategory, config);
  const fieldKeySet = new Set(
    Object.keys(isObject(fieldRules?.value?.fields) ? fieldRules.value.fields : {})
      .map((field) => normalizeFieldKey(field))
      .filter(Boolean)
  );

  const errors = [];
  const warnings = [];
  for (const row of listing.cases) {
    if (!isObject(row.expected)) {
      errors.push(`${row.product_id}: expected.json missing or invalid`);
      continue;
    }
    const expectedFields = isObject(row.expected.fields) ? row.expected.fields : {};
    const unknowns = isObject(row.expected.expected_unknowns) ? row.expected.expected_unknowns : {};
    if (!isObject(row.identity)) {
      warnings.push(`${row.product_id}: identity.json missing or invalid`);
    }
    for (const field of Object.keys(expectedFields)) {
      const key = normalizeFieldKey(field);
      if (!key) {
        errors.push(`${row.product_id}: invalid field key '${field}'`);
        continue;
      }
      if (fieldKeySet.size > 0 && !fieldKeySet.has(key)) {
        errors.push(`${row.product_id}: field '${key}' not found in generated field_rules`);
      }
    }
    for (const field of Object.keys(unknowns)) {
      const key = normalizeFieldKey(field);
      if (!key) {
        errors.push(`${row.product_id}: invalid expected_unknowns key '${field}'`);
      }
    }
  }

  return {
    category: normalizedCategory,
    valid: errors.length === 0,
    manifest_path: listing.manifest_path,
    case_count: listing.cases.length,
    errors,
    warnings
  };
}

function updateBucketMetric(bucket, status) {
  bucket.total += 1;
  if (status === 'correct') {
    bucket.correct += 1;
  } else if (status === 'incorrect') {
    bucket.incorrect += 1;
  } else if (status === 'unknown') {
    bucket.unknown += 1;
  }
}

function finalizeBucketMetric(bucket) {
  const total = Math.max(0, bucket.total);
  return {
    ...bucket,
    accuracy: total > 0 ? Number.parseFloat((bucket.correct / total).toFixed(6)) : 0,
    coverage: total > 0 ? Number.parseFloat(((bucket.correct + (bucket.incorrect || 0)) / total).toFixed(6)) : 0
  };
}

export async function buildAccuracyReport({
  category,
  storage,
  config = {},
  maxCases = 0,
  runId = ''
}) {
  const normalizedCategory = normalizeCategory(category);
  if (!normalizedCategory) {
    throw new Error('category_required');
  }
  if (!storage || typeof storage.readJsonOrNull !== 'function' || typeof storage.resolveOutputKey !== 'function') {
    throw new Error('storage_required');
  }

  const listing = await listGoldenCasesWithPayload(normalizedCategory, config);
  const fieldRules = await loadCategoryFieldRules(normalizedCategory, config);
  const rulesByField = isObject(fieldRules?.value?.fields) ? fieldRules.value.fields : {};
  const chosenCases = maxCases > 0
    ? listing.cases.slice(0, Math.max(1, Number.parseInt(String(maxCases), 10) || 1))
    : listing.cases;

  const byField = {};
  const byRequiredLevel = {};
  const byGroup = {};
  const productResults = [];
  let total = 0;
  let correct = 0;
  let nonUnknown = 0;

  for (const row of chosenCases) {
    const expectedFields = isObject(row.expected?.fields) ? row.expected.fields : {};
    const latestBase = storage.resolveOutputKey(normalizedCategory, row.product_id, 'latest');
    const normalized = await storage.readJsonOrNull(`${latestBase}/normalized.json`);
    const actualFields = isObject(normalized?.fields) ? normalized.fields : {};
    const result = {
      product_id: row.product_id,
      checked_fields: 0,
      correct_fields: 0,
      incorrect_fields: 0,
      unknown_fields: 0
    };

    for (const [rawField, expectedRaw] of Object.entries(expectedFields)) {
      const field = normalizeFieldKey(rawField);
      if (!field) {
        continue;
      }
      if (!isObject(byField[field])) {
        byField[field] = {
          correct: 0,
          incorrect: 0,
          unknown: 0,
          total: 0
        };
      }
      const rule = isObject(rulesByField[field]) ? rulesByField[field] : {};
      const requiredLevel = readRequiredLevel(rule);
      const group = readGroup(rule);
      if (!isObject(byRequiredLevel[requiredLevel])) {
        byRequiredLevel[requiredLevel] = { correct: 0, incorrect: 0, unknown: 0, total: 0 };
      }
      if (!isObject(byGroup[group])) {
        byGroup[group] = { correct: 0, incorrect: 0, unknown: 0, total: 0 };
      }

      const expectedValue = normalizeExpectedFieldValue(expectedRaw);
      const actualValue = actualFields[field];
      let status = 'incorrect';
      if (isUnknownValue(actualValue)) {
        status = 'unknown';
      } else if (normalizeForCompare(actualValue) === normalizeForCompare(expectedValue)) {
        status = 'correct';
      }

      total += 1;
      result.checked_fields += 1;
      updateBucketMetric(byField[field], status);
      updateBucketMetric(byRequiredLevel[requiredLevel], status);
      updateBucketMetric(byGroup[group], status);
      if (status === 'correct') {
        correct += 1;
        nonUnknown += 1;
        result.correct_fields += 1;
      } else if (status === 'incorrect') {
        nonUnknown += 1;
        result.incorrect_fields += 1;
      } else {
        result.unknown_fields += 1;
      }
    }
    productResults.push(result);
  }

  const finalizedByField = {};
  for (const [field, metrics] of Object.entries(byField)) {
    finalizedByField[field] = finalizeBucketMetric(metrics);
  }

  const finalizedByRequired = {};
  for (const [bucket, metrics] of Object.entries(byRequiredLevel)) {
    finalizedByRequired[bucket] = finalizeBucketMetric(metrics);
  }

  const finalizedByGroup = {};
  for (const [bucket, metrics] of Object.entries(byGroup)) {
    finalizedByGroup[bucket] = finalizeBucketMetric(metrics);
  }

  const failureRows = [];
  for (const [field, metrics] of Object.entries(finalizedByField)) {
    if ((metrics.incorrect || 0) > 0) {
      failureRows.push({
        field,
        reason: 'value_mismatch',
        count: metrics.incorrect
      });
    }
    if ((metrics.unknown || 0) > 0) {
      failureRows.push({
        field,
        reason: 'unknown_or_missing',
        count: metrics.unknown
      });
    }
  }
  failureRows.sort((a, b) => b.count - a.count || a.field.localeCompare(b.field));

  return {
    category: normalizedCategory,
    run_id: normalizeText(runId) || `golden-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    products_tested: chosenCases.length,
    overall_accuracy: total > 0 ? Number.parseFloat((correct / total).toFixed(6)) : 0,
    overall_coverage: total > 0 ? Number.parseFloat((nonUnknown / total).toFixed(6)) : 0,
    by_required_level: finalizedByRequired,
    by_group: finalizedByGroup,
    by_field: finalizedByField,
    common_failures: failureRows.slice(0, 15),
    product_results: productResults
  };
}

export function renderAccuracyReportMarkdown(report = {}) {
  const category = normalizeCategory(report.category || 'unknown');
  const lines = [];
  lines.push(`# Accuracy Report: ${category}`);
  lines.push('');
  lines.push(`- Run ID: ${normalizeText(report.run_id) || 'n/a'}`);
  lines.push(`- Products tested: ${Number(report.products_tested || 0)}`);
  lines.push(`- Overall accuracy: ${Number(report.overall_accuracy || 0)}`);
  lines.push(`- Overall coverage: ${Number(report.overall_coverage || 0)}`);
  lines.push('');
  lines.push('## By Field');
  lines.push('');
  lines.push('| Field | Accuracy | Coverage | Correct | Incorrect | Unknown |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  const rows = Object.entries(isObject(report.by_field) ? report.by_field : {})
    .map(([field, metrics]) => ({ field, metrics }))
    .sort((a, b) => a.field.localeCompare(b.field));
  for (const row of rows) {
    const m = isObject(row.metrics) ? row.metrics : {};
    lines.push(
      `| ${row.field} | ${Number(m.accuracy || 0)} | ${Number(m.coverage || 0)} | ${Number(m.correct || 0)} | ${Number(m.incorrect || 0)} | ${Number(m.unknown || 0)} |`
    );
  }
  lines.push('');
  lines.push('## Common Failures');
  lines.push('');
  const failures = toArray(report.common_failures);
  if (failures.length === 0) {
    lines.push('- none');
  } else {
    for (const row of failures) {
      lines.push(`- ${normalizeText(row.field)}: ${normalizeText(row.reason)} (${Number(row.count || 0)})`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}
