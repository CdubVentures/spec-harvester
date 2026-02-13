import fs from 'node:fs/promises';
import path from 'node:path';
import { nowIso } from '../utils/common.js';
import { toRawFieldKey } from '../utils/fieldKeys.js';
import { createFieldRulesEngine } from '../engine/fieldRulesEngine.js';
import { applyRuntimeFieldRules } from '../engine/runtimeGate.js';

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

export async function setOverrideFromCandidate({
  storage,
  config = {},
  category,
  productId,
  field,
  candidateId
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
  const current = isObject(existing) ? existing : {
    version: 1,
    category,
    product_id: productId,
    created_at: nowIso(),
    overrides: {}
  };

  const source = {
    host: candidate.host || null,
    method: candidate.method || null,
    tier: candidate.tier || null,
    evidence_key: candidate.evidence_key || null
  };
  current.version = 1;
  current.category = category;
  current.product_id = productId;
  current.updated_at = nowIso();
  current.overrides = {
    ...(isObject(current.overrides) ? current.overrides : {}),
    [normalizedField]: {
      field: normalizedField,
      candidate_id: candidate.candidate_id,
      value: String(candidate.value || '').trim(),
      source,
      set_at: nowIso()
    }
  };

  await writeJsonStable(overridePath, current);
  return {
    override_path: overridePath,
    field: normalizedField,
    candidate_id: candidate.candidate_id,
    value: String(candidate.value || '').trim()
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
  applyOverrides = false
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
    const value = String(override?.value || '').trim();
    if (!normalizedField || !value) {
      continue;
    }

    const previous = String(nextNormalized.fields[normalizedField] ?? 'unk');
    nextNormalized.fields[normalizedField] = value;

    const existingProv = isObject(nextProvenance[normalizedField]) ? nextProvenance[normalizedField] : {};
    nextProvenance[normalizedField] = {
      ...existingProv,
      value,
      confidence: 1,
      meets_pass_target: true,
      evidence: [
        {
          url: `helper_files://${category}/_overrides/${productId}.overrides.json`,
          host: String(override?.source?.host || 'manual-override.local'),
          method: 'manual_override',
          keyPath: `overrides.${normalizedField}`,
          tier: 1,
          tierName: 'user_override'
        }
      ],
      override: {
        candidate_id: String(override?.candidate_id || ''),
        set_at: String(override?.set_at || nowIso())
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
      candidate_id: String(override?.candidate_id || '')
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

  nextSummary.field_reasoning = nextFieldReasoning;
  nextSummary.review_overrides = {
    applied_at: nowIso(),
    override_count: appliedRows.length,
    fields: appliedRows.map((row) => row.field),
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
