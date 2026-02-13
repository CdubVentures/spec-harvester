import fs from 'node:fs/promises';
import path from 'node:path';
import { nowIso } from '../utils/common.js';
import { toRawFieldKey } from '../utils/fieldKeys.js';
import { createFieldRulesEngine } from '../engine/fieldRulesEngine.js';
import { applyRuntimeFieldRules } from '../engine/runtimeGate.js';
import { buildProductReviewPayload } from './reviewGridData.js';

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeField(field) {
  return toRawFieldKey(String(field || '').trim(), { fieldOrder: [] });
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hasKnownValue(value) {
  const token = normalizeToken(value);
  return token !== '' && token !== 'unk' && token !== 'unknown' && token !== 'n/a' && token !== 'null';
}

function normalizeComparableValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (Array.isArray(value) || typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  const text = String(value).trim();
  if (!text) {
    return '';
  }
  const numeric = Number.parseFloat(text);
  if (Number.isFinite(numeric) && String(numeric) === text.replace(/,/g, '')) {
    return String(numeric);
  }
  return normalizeToken(text.replace(/,/g, ''));
}

function normalizeQuoteSpan(value) {
  if (!Array.isArray(value) || value.length !== 2) {
    return null;
  }
  const start = Number.parseInt(String(value[0]), 10);
  const end = Number.parseInt(String(value[1]), 10);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }
  return [start, end];
}

function normalizeOverrideEvidence(evidence = {}) {
  const url = String(evidence?.url || '').trim();
  const quote = String(evidence?.quote || '').trim();
  if (!url || !quote) {
    throw new Error('manual override requires evidence.url and evidence.quote');
  }
  return {
    url,
    source_id: String(evidence?.source_id || '').trim() || null,
    retrieved_at: String(evidence?.retrieved_at || nowIso()).trim(),
    snippet_id: String(evidence?.snippet_id || '').trim() || null,
    snippet_hash: String(evidence?.snippet_hash || '').trim() || null,
    quote_span: normalizeQuoteSpan(evidence?.quote_span),
    quote
  };
}

function manualCandidateId(field) {
  const token = normalizeField(field) || 'field';
  const stamp = Date.now().toString(36);
  return `manual_snp_${token}_${stamp}`;
}

function extractOverrideValue(override = {}) {
  const value = String(
    override?.override_value ??
    override?.value ??
    ''
  ).trim();
  return value;
}

function extractOverrideProvenance(override = {}, category, productId, field) {
  const source = isObject(override?.override_provenance) ? override.override_provenance : {};
  const fallbackSource = isObject(override?.source) ? override.source : {};
  const quote = String(source.quote || '').trim();
  const url = String(source.url || '').trim();
  if (url && quote) {
    return {
      url,
      source_id: String(source.source_id || '').trim() || null,
      retrieved_at: String(source.retrieved_at || nowIso()).trim(),
      snippet_id: String(source.snippet_id || '').trim() || null,
      snippet_hash: String(source.snippet_hash || '').trim() || null,
      quote_span: normalizeQuoteSpan(source.quote_span),
      quote
    };
  }
  return {
    url: `helper_files://${category}/_overrides/${productId}.overrides.json`,
    source_id: String(fallbackSource.source_id || '').trim() || null,
    retrieved_at: nowIso(),
    snippet_id: null,
    snippet_hash: null,
    quote_span: null,
    quote: `override ${field}`
  };
}

function sortDeep(value) {
  if (Array.isArray(value)) {
    return value.map((row) => sortDeep(row));
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

async function writeJsonStable(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(sortDeep(value), null, 2)}\n`, 'utf8');
}

function removeFieldFromList(list = [], field = '') {
  if (!Array.isArray(list)) {
    return [];
  }
  const fieldRaw = normalizeField(field);
  const fieldPrefixed = `fields.${fieldRaw}`;
  return list.filter((entry) => {
    const token = String(entry || '').trim().toLowerCase();
    return token && token !== fieldRaw && token !== fieldPrefixed;
  });
}

function addFieldToList(list = [], field = '') {
  const out = Array.isArray(list) ? [...list] : [];
  const normalizedField = normalizeField(field);
  if (!normalizedField) {
    return out;
  }
  const prefixed = `fields.${normalizedField}`;
  const hasField = out.some((entry) => {
    const token = String(entry || '').trim().toLowerCase();
    return token === normalizedField || token === prefixed;
  });
  if (!hasField) {
    out.push(normalizedField);
  }
  return out;
}

function reviewKeys(storage, category, productId) {
  const reviewBase = ['final', normalizeToken(category) || 'unknown-category', normalizeToken(productId) || 'unknown-product', 'review'].join('/');
  const legacyReviewBase = storage.resolveOutputKey(category, productId, 'review');
  return {
    reviewBase,
    legacyReviewBase,
    candidatesKey: `${reviewBase}/candidates.json`,
    legacyCandidatesKey: `${legacyReviewBase}/candidates.json`,
    reviewQueueKey: `${reviewBase}/review_queue.json`,
    legacyReviewQueueKey: `${legacyReviewBase}/review_queue.json`,
    finalizeReportKey: `${reviewBase}/finalize_report.json`
  };
}

function latestKeys(storage, category, productId) {
  const latestBase = storage.resolveOutputKey(category, productId, 'latest');
  return {
    latestBase,
    normalizedKey: `${latestBase}/normalized.json`,
    provenanceKey: `${latestBase}/provenance.json`,
    summaryKey: `${latestBase}/summary.json`
  };
}

export function resolveOverrideFilePath({ config = {}, category, productId }) {
  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  return path.join(helperRoot, category, '_overrides', `${productId}.overrides.json`);
}

export async function readReviewArtifacts({ storage, category, productId }) {
  const keys = reviewKeys(storage, category, productId);
  let candidates = await storage.readJsonOrNull(keys.candidatesKey);
  let reviewQueue = await storage.readJsonOrNull(keys.reviewQueueKey);
  if (!candidates) {
    candidates = await storage.readJsonOrNull(keys.legacyCandidatesKey);
  }
  if (!reviewQueue) {
    reviewQueue = await storage.readJsonOrNull(keys.legacyReviewQueueKey);
  }
  return {
    keys,
    candidates: candidates || {
      version: 1,
      generated_at: nowIso(),
      category,
      product_id: productId,
      candidate_count: 0,
      field_count: 0,
      items: [],
      by_field: {}
    },
    reviewQueue: reviewQueue || {
      version: 1,
      generated_at: nowIso(),
      category,
      product_id: productId,
      count: 0,
      items: []
    }
  };
}

async function readOverrideFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (isObject(parsed)) {
      return parsed;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
  return null;
}

function findCandidateRows(candidatesArtifact = {}) {
  const items = toArray(candidatesArtifact.items).filter((row) => isObject(row));
  if (items.length > 0) {
    return items;
  }

  const rows = [];
  for (const [field, fieldRows] of Object.entries(candidatesArtifact.by_field || {})) {
    for (const row of toArray(fieldRows)) {
      if (!isObject(row)) {
        continue;
      }
      rows.push({
        ...row,
        field: row.field || field
      });
    }
  }
  return rows;
}

function buildCandidateOverrideEntry({
  candidate = {},
  category,
  productId,
  field,
  reviewer = '',
  reason = '',
  setAt = nowIso()
}) {
  const source = {
    host: candidate.host || candidate.source || null,
    source_id: candidate.source_id || null,
    method: candidate.method || null,
    tier: candidate.tier || null,
    evidence_key: candidate.evidence_key || null
  };
  const candidateEvidence = isObject(candidate.evidence) ? candidate.evidence : {};
  const overrideProvenance = {
    url: String(candidateEvidence.url || candidate.url || '').trim() || null,
    source_id: String(candidateEvidence.source_id || candidate.source_id || '').trim() || null,
    retrieved_at: String(candidateEvidence.retrieved_at || nowIso()).trim(),
    snippet_id: String(candidateEvidence.snippet_id || '').trim() || null,
    snippet_hash: String(candidateEvidence.snippet_hash || '').trim() || null,
    quote_span: normalizeQuoteSpan(candidateEvidence.quote_span),
    quote: String(candidateEvidence.quote || '').trim() || null
  };
  const normalizedField = normalizeField(field);
  return {
    field: normalizedField,
    override_source: 'candidate_selection',
    candidate_index: Number.isFinite(toNumber(candidate.candidate_index, NaN))
      ? toNumber(candidate.candidate_index, NaN)
      : null,
    override_value: String(candidate.value || '').trim(),
    override_reason: String(reason || '').trim() || null,
    override_provenance: overrideProvenance,
    overridden_by: String(reviewer || '').trim() || null,
    overridden_at: setAt,
    validated: null,
    candidate_id: String(candidate.candidate_id || ''),
    value: String(candidate.value || '').trim(),
    source,
    set_at: setAt,
    product_id: productId,
    category
  };
}

function buildCandidateMap(rows = []) {
  const byField = new Map();
  for (const row of rows) {
    if (!isObject(row)) {
      continue;
    }
    const field = normalizeField(row.field);
    if (!field) {
      continue;
    }
    if (!byField.has(field)) {
      byField.set(field, []);
    }
    byField.get(field).push({
      ...row,
      field
    });
  }
  return byField;
}

function selectCandidateForValue(candidateRows = [], selectedValue) {
  const target = normalizeComparableValue(selectedValue);
  if (!target) {
    return null;
  }
  const matches = candidateRows.filter((row) =>
    normalizeComparableValue(row?.value) === target
  );
  if (matches.length === 0) {
    return null;
  }
  matches.sort((a, b) => toNumber(b.score, 0) - toNumber(a.score, 0));
  return matches[0];
}

export async function setOverrideFromCandidate({
  storage,
  config = {},
  category,
  productId,
  field,
  candidateId,
  reviewer = '',
  reason = ''
}) {
  const normalizedField = normalizeField(field);
  if (!normalizedField) {
    throw new Error('set-override requires a valid --field');
  }
  const targetCandidateId = String(candidateId || '').trim();
  if (!targetCandidateId) {
    throw new Error('set-override requires --candidate-id');
  }

  const review = await readReviewArtifacts({ storage, category, productId });
  const rows = findCandidateRows(review.candidates);
  const candidate = rows.find((row) =>
    normalizeToken(row.candidate_id) === normalizeToken(targetCandidateId)
    && normalizeField(row.field) === normalizedField
  );
  if (!candidate) {
    throw new Error(`candidate_id '${targetCandidateId}' not found for field '${normalizedField}'`);
  }

  const overridePath = resolveOverrideFilePath({ config, category, productId });
  const existing = await readOverrideFile(overridePath);
  const startedAt = String(existing?.review_started_at || nowIso()).trim();
  const current = isObject(existing) ? existing : {
    version: 1,
    category,
    product_id: productId,
    created_at: nowIso(),
    review_started_at: startedAt,
    review_status: 'in_progress',
    overrides: {}
  };
  const setAt = nowIso();
  const entry = buildCandidateOverrideEntry({
    candidate,
    category,
    productId,
    field: normalizedField,
    reviewer,
    reason,
    setAt
  });
  current.version = 1;
  current.category = category;
  current.product_id = productId;
  current.review_started_at = startedAt;
  current.review_status = 'in_progress';
  current.updated_at = nowIso();
  current.overrides = {
    ...(isObject(current.overrides) ? current.overrides : {}),
    [normalizedField]: entry
  };

  await writeJsonStable(overridePath, current);
  return {
    override_path: overridePath,
    field: normalizedField,
    candidate_id: candidate.candidate_id,
    value: String(candidate.value || '').trim()
  };
}

export async function setManualOverride({
  storage,
  config = {},
  category,
  productId,
  field,
  value,
  evidence = {},
  reviewer = '',
  reason = ''
}) {
  const normalizedField = normalizeField(field);
  if (!normalizedField) {
    throw new Error('setManualOverride requires a valid field');
  }
  const nextValue = String(value || '').trim();
  if (!nextValue) {
    throw new Error('setManualOverride requires value');
  }
  const normalizedEvidence = normalizeOverrideEvidence(evidence);
  const overridePath = resolveOverrideFilePath({ config, category, productId });
  const existing = await readOverrideFile(overridePath);
  const startedAt = String(existing?.review_started_at || nowIso()).trim();
  const current = isObject(existing) ? existing : {
    version: 1,
    category,
    product_id: productId,
    created_at: nowIso(),
    review_started_at: startedAt,
    review_status: 'in_progress',
    overrides: {}
  };

  const setAt = nowIso();
  current.version = 1;
  current.category = category;
  current.product_id = productId;
  current.review_started_at = startedAt;
  current.review_status = 'in_progress';
  current.updated_at = setAt;
  current.overrides = {
    ...(isObject(current.overrides) ? current.overrides : {}),
    [normalizedField]: {
      field: normalizedField,
      override_source: 'manual_entry',
      candidate_index: null,
      override_value: nextValue,
      override_reason: String(reason || '').trim() || null,
      override_provenance: normalizedEvidence,
      overridden_by: String(reviewer || '').trim() || null,
      overridden_at: setAt,
      validated: null,
      candidate_id: manualCandidateId(normalizedField),
      value: nextValue,
      source: {
        host: 'manual-override.local',
        source_id: normalizedEvidence.source_id,
        method: 'manual_override',
        tier: 1,
        evidence_key: normalizedEvidence.url
      },
      set_at: setAt
    }
  };
  await writeJsonStable(overridePath, current);
  return {
    override_path: overridePath,
    field: normalizedField,
    candidate_id: current.overrides[normalizedField].candidate_id,
    value: nextValue
  };
}

async function readReviewProductPayload({ storage, config = {}, category, productId, keys }) {
  let payload = await storage.readJsonOrNull(`${keys.reviewBase}/product.json`);
  if (!payload) {
    payload = await storage.readJsonOrNull(`${keys.legacyReviewBase}/product.json`);
  }
  if (payload && isObject(payload.fields)) {
    return payload;
  }
  return await buildProductReviewPayload({
    storage,
    config,
    category,
    productId
  });
}

export async function approveGreenOverrides({
  storage,
  config = {},
  category,
  productId,
  reviewer = '',
  reason = ''
}) {
  const review = await readReviewArtifacts({ storage, category, productId });
  const keys = review.keys;
  const payload = await readReviewProductPayload({
    storage,
    config,
    category,
    productId,
    keys
  });
  const rows = findCandidateRows(review.candidates);
  const candidateMap = buildCandidateMap(rows);
  const overridePath = resolveOverrideFilePath({ config, category, productId });
  const existing = await readOverrideFile(overridePath);
  const startedAt = String(existing?.review_started_at || nowIso()).trim();
  const current = isObject(existing) ? existing : {
    version: 1,
    category,
    product_id: productId,
    created_at: nowIso(),
    review_started_at: startedAt,
    review_status: 'in_progress',
    overrides: {}
  };
  const overrides = isObject(current.overrides) ? { ...current.overrides } : {};
  const approvedFields = [];
  const skipped = [];

  for (const [fieldRaw, stateRaw] of Object.entries(payload.fields || {})) {
    const field = normalizeField(fieldRaw);
    const state = isObject(stateRaw) ? stateRaw : {};
    const selected = isObject(state.selected) ? state.selected : {};
    const selectedValue = selected.value;
    const color = normalizeToken(selected.color || '');
    const needsReview = Boolean(state.needs_review);

    if (color !== 'green' || needsReview || !hasKnownValue(selectedValue)) {
      skipped.push({
        field,
        reason: 'not_green_or_not_review_ready'
      });
      continue;
    }

    const candidateRows = candidateMap.get(field) || [];
    const candidate = selectCandidateForValue(candidateRows, selectedValue);
    if (!candidate) {
      skipped.push({
        field,
        reason: 'no_matching_candidate'
      });
      continue;
    }
    const setAt = nowIso();
    overrides[field] = buildCandidateOverrideEntry({
      candidate,
      category,
      productId,
      field,
      reviewer,
      reason: String(reason || '').trim() || 'bulk_approve_green',
      setAt
    });
    approvedFields.push(field);
  }

  current.version = 1;
  current.category = category;
  current.product_id = productId;
  current.review_started_at = startedAt;
  current.review_status = 'in_progress';
  current.updated_at = nowIso();
  current.overrides = overrides;

  if (approvedFields.length > 0) {
    await writeJsonStable(overridePath, current);
  }

  return {
    override_path: overridePath,
    approved_count: approvedFields.length,
    skipped_count: skipped.length,
    approved_fields: approvedFields,
    skipped
  };
}

async function listOverrideDocs(helperRoot, category) {
  const dir = path.join(helperRoot, category, '_overrides');
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.overrides.json')) {
      continue;
    }
    const filePath = path.join(dir, entry.name);
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
      if (isObject(parsed)) {
        out.push({
          path: filePath,
          payload: parsed
        });
      }
    } catch {
      // Ignore malformed override payloads in metrics rollup.
    }
  }
  return out;
}

function parseDateMs(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function buildReviewMetrics({
  config = {},
  category,
  windowHours = 24
}) {
  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  const rows = await listOverrideDocs(helperRoot, category);
  const now = Date.now();
  const cutoff = now - (Math.max(1, toNumber(windowHours, 24)) * 60 * 60 * 1000);
  let reviewedProducts = 0;
  let inProgressProducts = 0;
  let overridesTotal = 0;
  let reviewTimeTotalSeconds = 0;
  let reviewTimeCount = 0;

  for (const row of rows) {
    const payload = isObject(row.payload) ? row.payload : {};
    const overrides = isObject(payload.overrides) ? payload.overrides : {};
    const overrideCount = Object.keys(overrides).length;
    const reviewedAtMs = parseDateMs(payload.reviewed_at);
    const status = normalizeToken(payload.review_status || '');
    const reviewTimeSeconds = toNumber(payload.review_time_seconds, NaN);

    if (status === 'in_progress') {
      inProgressProducts += 1;
    }

    if (reviewedAtMs >= cutoff && status === 'approved') {
      reviewedProducts += 1;
      overridesTotal += overrideCount;
      if (Number.isFinite(reviewTimeSeconds) && reviewTimeSeconds >= 0) {
        reviewTimeTotalSeconds += reviewTimeSeconds;
        reviewTimeCount += 1;
      }
    }
  }

  const avgReviewTime = reviewTimeCount > 0
    ? (reviewTimeTotalSeconds / reviewTimeCount)
    : 0;
  const safeWindowHours = Math.max(1, toNumber(windowHours, 24));
  const productsPerHour = reviewedProducts / safeWindowHours;
  const overridesPerProduct = reviewedProducts > 0
    ? (overridesTotal / reviewedProducts)
    : 0;

  return {
    category,
    window_hours: safeWindowHours,
    reviewed_products: reviewedProducts,
    in_progress_products: inProgressProducts,
    overrides_total: overridesTotal,
    overrides_per_product: overridesPerProduct,
    average_review_time_seconds: avgReviewTime,
    products_per_hour: productsPerHour
  };
}

async function writeStorageJson(storage, key, value) {
  await storage.writeObject(
    key,
    Buffer.from(JSON.stringify(value, null, 2), 'utf8'),
    { contentType: 'application/json' }
  );
}

export async function finalizeOverrides({
  storage,
  config = {},
  category,
  productId,
  applyOverrides = false,
  saveAsDraft = false,
  reviewer = ''
}) {
  const overridePath = resolveOverrideFilePath({ config, category, productId });
  const overrideDoc = await readOverrideFile(overridePath);
  const overrides = isObject(overrideDoc?.overrides) ? overrideDoc.overrides : {};
  const overrideEntries = Object.entries(overrides);
  if (!overrideEntries.length) {
    return {
      applied: false,
      reason: 'no_overrides',
      override_path: overridePath,
      override_count: 0
    };
  }

  const latest = latestKeys(storage, category, productId);
  const normalized = await storage.readJsonOrNull(latest.normalizedKey);
  const provenance = await storage.readJsonOrNull(latest.provenanceKey);
  const summary = await storage.readJsonOrNull(latest.summaryKey);
  if (!normalized || !isObject(normalized.fields)) {
    throw new Error(`latest normalized output not found: ${latest.normalizedKey}`);
  }

  if (!applyOverrides) {
    return {
      applied: false,
      reason: 'apply_overrides_flag_not_set',
      override_path: overridePath,
      override_count: overrideEntries.length,
      pending_fields: overrideEntries.map(([field]) => field)
    };
  }

  const nextNormalized = {
    ...normalized,
    fields: {
      ...normalized.fields
    }
  };
  const nextProvenance = isObject(provenance) ? { ...provenance } : {};
  const nextSummary = isObject(summary) ? { ...summary } : {};
  const nextFieldReasoning = isObject(nextSummary.field_reasoning)
    ? { ...nextSummary.field_reasoning }
    : {};
  const appliedRows = [];

  for (const [field, override] of overrideEntries) {
    const normalizedField = normalizeField(field);
    const value = extractOverrideValue(override);
    if (!normalizedField || !value) {
      continue;
    }

    const previous = String(nextNormalized.fields[normalizedField] ?? 'unk');
    nextNormalized.fields[normalizedField] = value;
    const overrideProvenance = extractOverrideProvenance(override, category, productId, normalizedField);

    const existingProv = isObject(nextProvenance[normalizedField]) ? nextProvenance[normalizedField] : {};
    nextProvenance[normalizedField] = {
      ...existingProv,
      value,
      confidence: 1,
      meets_pass_target: true,
      evidence: [
        {
          url: overrideProvenance.url,
          host: String(override?.source?.host || 'manual-override.local'),
          method: String(override?.source?.method || 'manual_override'),
          keyPath: `overrides.${normalizedField}`,
          tier: 1,
          tierName: 'user_override',
          source_id: overrideProvenance.source_id || '',
          snippet_id: overrideProvenance.snippet_id || '',
          snippet_hash: overrideProvenance.snippet_hash || '',
          quote_span: overrideProvenance.quote_span,
          quote: overrideProvenance.quote,
          retrieved_at: overrideProvenance.retrieved_at
        }
      ],
      override: {
        candidate_id: String(override?.candidate_id || ''),
        set_at: String(override?.set_at || nowIso()),
        override_source: String(override?.override_source || '').trim() || 'manual_override',
        override_reason: String(override?.override_reason || '').trim() || null
      }
    };

    const existingReasoning = isObject(nextFieldReasoning[normalizedField]) ? nextFieldReasoning[normalizedField] : {};
    const existingReasons = toArray(existingReasoning.reasons).filter(Boolean).filter((reason) =>
      !String(reason).startsWith('unknown_')
    );
    nextFieldReasoning[normalizedField] = {
      ...existingReasoning,
      value,
      unknown_reason: null,
      reasons: [...new Set([...existingReasons, 'manual_override'])]
    };

    nextSummary.missing_required_fields = removeFieldFromList(nextSummary.missing_required_fields, normalizedField);
    nextSummary.fields_below_pass_target = removeFieldFromList(nextSummary.fields_below_pass_target, normalizedField);
    nextSummary.critical_fields_below_pass_target = removeFieldFromList(nextSummary.critical_fields_below_pass_target, normalizedField);
    appliedRows.push({
      field: normalizedField,
      previous,
      value,
      candidate_id: String(override?.candidate_id || ''),
      override_source: String(override?.override_source || '').trim() || 'manual_override',
      override_reason: String(override?.override_reason || '').trim() || null
    });
  }

  let runtimeGateResult = {
    applied: false,
    failures: [],
    warnings: [],
    changes: []
  };
  let runtimeEngineReady = false;
  try {
    const runtimeEngine = await createFieldRulesEngine(category, { config });
    runtimeEngineReady = true;
    const migratedInput = runtimeEngine.applyKeyMigrations(nextNormalized.fields);
    runtimeGateResult = applyRuntimeFieldRules({
      engine: runtimeEngine,
      fields: migratedInput,
      provenance: nextProvenance,
      fieldOrder: runtimeEngine.getAllFieldKeys(),
      enforceEvidence: false,
      strictEvidence: false,
      evidencePack: null
    });
    nextNormalized.fields = runtimeGateResult.fields || nextNormalized.fields;
  } catch {
    runtimeEngineReady = false;
  }

  for (const failure of runtimeGateResult.failures || []) {
    const normalizedField = normalizeField(failure?.field);
    if (!normalizedField) {
      continue;
    }
    const existingReasoning = isObject(nextFieldReasoning[normalizedField]) ? nextFieldReasoning[normalizedField] : {};
    const existingReasons = toArray(existingReasoning.reasons).filter(Boolean);
    nextFieldReasoning[normalizedField] = {
      ...existingReasoning,
      value: 'unk',
      unknown_reason: String(failure.reason_code || 'override_rejected_by_runtime_engine'),
      reasons: [...new Set([...existingReasons, 'override_rejected_by_runtime_engine'])]
    };
    nextSummary.missing_required_fields = addFieldToList(nextSummary.missing_required_fields, normalizedField);
    nextSummary.fields_below_pass_target = addFieldToList(nextSummary.fields_below_pass_target, normalizedField);
    nextSummary.critical_fields_below_pass_target = addFieldToList(
      nextSummary.critical_fields_below_pass_target,
      normalizedField
    );
  }

  if ((runtimeGateResult.failures || []).length > 0 && !saveAsDraft) {
    return {
      applied: false,
      reason: 'runtime_validation_failed',
      override_path: overridePath,
      override_count: overrideEntries.length,
      applied_count: appliedRows.length,
      latest_keys: latest,
      runtime_gate: {
        applied: Boolean(runtimeGateResult.applied),
        failure_count: (runtimeGateResult.failures || []).length,
        warning_count: (runtimeGateResult.warnings || []).length,
        failures: runtimeGateResult.failures || [],
        warnings: runtimeGateResult.warnings || []
      }
    };
  }

  nextSummary.field_reasoning = nextFieldReasoning;
  nextSummary.review_overrides = {
    applied_at: nowIso(),
    override_count: appliedRows.length,
    fields: appliedRows.map((row) => row.field),
    save_as_draft: Boolean(saveAsDraft),
    runtime_engine_ready: runtimeEngineReady,
    runtime_engine_failure_count: (runtimeGateResult.failures || []).length,
    runtime_engine_warning_count: (runtimeGateResult.warnings || []).length
  };

  await Promise.all([
    writeStorageJson(storage, latest.normalizedKey, nextNormalized),
    writeStorageJson(storage, latest.provenanceKey, nextProvenance),
    writeStorageJson(storage, latest.summaryKey, nextSummary)
  ]);

  const review = reviewKeys(storage, category, productId);
  const report = {
    version: 1,
    category,
    product_id: productId,
    applied_at: nowIso(),
    applied_count: appliedRows.length,
    applied_fields: appliedRows.map((row) => row.field),
    rows: appliedRows,
    runtime_gate: {
      applied: Boolean(runtimeGateResult.applied),
      failure_count: (runtimeGateResult.failures || []).length,
      warning_count: (runtimeGateResult.warnings || []).length,
      failures: runtimeGateResult.failures || [],
      warnings: runtimeGateResult.warnings || []
    },
    latest_keys: latest
  };
  await writeStorageJson(storage, review.finalizeReportKey, report);
  if (review.legacyReviewBase && review.legacyReviewBase !== review.reviewBase) {
    await writeStorageJson(storage, `${review.legacyReviewBase}/finalize_report.json`, report);
  }

  const reviewedAt = nowIso();
  const startedAtMs = parseDateMs(overrideDoc.review_started_at);
  const reviewedAtMs = parseDateMs(reviewedAt);
  const reviewTimeSeconds = startedAtMs > 0 && reviewedAtMs >= startedAtMs
    ? Math.round((reviewedAtMs - startedAtMs) / 1000)
    : null;
  const nextOverrideDoc = {
    ...(isObject(overrideDoc) ? overrideDoc : {}),
    version: 1,
    category,
    product_id: productId,
    review_status: saveAsDraft ? 'draft' : 'approved',
    reviewed_by: String(reviewer || '').trim() || null,
    reviewed_at: reviewedAt,
    review_time_seconds: reviewTimeSeconds,
    updated_at: reviewedAt,
    finalize_report_key: review.finalizeReportKey,
    runtime_gate: {
      applied: Boolean(runtimeGateResult.applied),
      failure_count: (runtimeGateResult.failures || []).length,
      warning_count: (runtimeGateResult.warnings || []).length
    },
    overrides
  };
  await writeJsonStable(overridePath, nextOverrideDoc);

  return {
    applied: true,
    override_path: overridePath,
    override_count: overrideEntries.length,
    applied_count: appliedRows.length,
    latest_keys: latest,
    finalize_report_key: review.finalizeReportKey,
    applied_fields: appliedRows.map((row) => row.field),
    runtime_gate: {
      applied: Boolean(runtimeGateResult.applied),
      failure_count: (runtimeGateResult.failures || []).length,
      warning_count: (runtimeGateResult.warnings || []).length
    }
  };
}
