import fs from 'node:fs/promises';
import path from 'node:path';
import { nowIso } from '../utils/common.js';
import { loadCategoryConfig } from '../categories/loader.js';
import { loadQueueState } from '../queue/queueState.js';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeField(field) {
  return String(field || '')
    .trim()
    .toLowerCase()
    .replace(/^fields\./, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizePathToken(value, fallback = 'unknown') {
  const token = normalizeToken(value).replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return token || fallback;
}

function hasKnownValue(value) {
  const token = String(value ?? '').trim().toLowerCase();
  return token !== '' && token !== 'unk' && token !== 'unknown' && token !== 'n/a' && token !== 'null';
}

function parseExcelRowFromCell(cell) {
  const text = String(cell || '').trim().toUpperCase();
  const match = text.match(/[A-Z]+(\d+)/);
  if (!match) {
    return null;
  }
  const row = Number.parseInt(match[1], 10);
  return Number.isFinite(row) ? row : null;
}

function extractExcelHints(rule = {}) {
  const blocks = [
    rule.excel_hints,
    rule.excel
  ].filter(isObject);
  for (const block of blocks) {
    for (const key of ['dataEntry', 'dataentry']) {
      if (isObject(block[key])) {
        return block[key];
      }
    }
    if (isObject(block.data) && isObject(block.data.dataEntry)) {
      return block.data.dataEntry;
    }
    if (isObject(block.default)) {
      return block.default;
    }
  }
  return {};
}

function inferWorkbookPath(helperRoot, category) {
  const direct = path.join(helperRoot, category, `${category}Data.xlsm`);
  return direct;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function reviewKeys(storage, category, productId) {
  const reviewBase = ['final', normalizePathToken(category), normalizePathToken(productId), 'review'].join('/');
  const legacyReviewBase = storage.resolveOutputKey(category, productId, 'review');
  return {
    reviewBase,
    legacyReviewBase,
    candidatesKey: `${reviewBase}/candidates.json`,
    legacyCandidatesKey: `${legacyReviewBase}/candidates.json`,
    reviewQueueKey: `${reviewBase}/review_queue.json`,
    legacyReviewQueueKey: `${legacyReviewBase}/review_queue.json`,
    productKey: `${reviewBase}/product.json`,
    legacyProductKey: `${legacyReviewBase}/product.json`
  };
}

function normalizeFieldContract(rule = {}) {
  const contract = isObject(rule.contract) ? rule.contract : {};
  const requiredLevel = String(
    rule.required_level ||
    (isObject(rule.priority) ? rule.priority.required_level : '')
  ).trim().toLowerCase();
  return {
    type: String(contract.type || 'string'),
    required: requiredLevel === 'required' || requiredLevel === 'critical' || requiredLevel === 'identity',
    units: contract.unit || null,
    enum_name: String(rule.enum_name || '').trim() || null
  };
}

async function writeJson(storage, key, value) {
  await storage.writeObject(
    key,
    Buffer.from(JSON.stringify(value, null, 2), 'utf8'),
    { contentType: 'application/json' }
  );
}

function candidateEvidenceFromRows(candidate = {}, provenanceRow = {}) {
  const candidateEvidence = isObject(candidate.evidence) ? candidate.evidence : {};
  const provenanceEvidence = toArray(provenanceRow.evidence)[0] || {};
  const quote = String(candidateEvidence.quote || provenanceEvidence.quote || '').trim();
  return {
    url: String(candidateEvidence.url || candidate.url || provenanceEvidence.url || '').trim(),
    retrieved_at: String(
      candidateEvidence.retrieved_at ||
      candidate.retrieved_at ||
      provenanceEvidence.retrieved_at ||
      nowIso()
    ),
    snippet_id: String(candidateEvidence.snippet_id || candidate.snippet_id || provenanceEvidence.snippet_id || '').trim(),
    snippet_hash: String(candidateEvidence.snippet_hash || candidate.snippet_hash || provenanceEvidence.snippet_hash || '').trim(),
    quote,
    quote_span: Array.isArray(candidateEvidence.quote_span)
      ? candidateEvidence.quote_span
      : (Array.isArray(provenanceEvidence.quote_span) ? provenanceEvidence.quote_span : null),
    snippet_text: String(candidateEvidence.snippet_text || candidate.snippet_text || '').trim() || quote,
    source_id: String(
      candidateEvidence.source_id ||
      candidate.source_id ||
      provenanceEvidence.source_id ||
      ''
    ).trim()
  };
}

function candidateScore(candidate = {}, provenanceRow = {}) {
  const score = toNumber(candidate.score, NaN);
  if (Number.isFinite(score)) {
    return Math.max(0, Math.min(1, score));
  }
  const confidence = toNumber(provenanceRow.confidence, NaN);
  if (Number.isFinite(confidence)) {
    return Math.max(0, Math.min(1, confidence));
  }
  return candidate.approvedDomain ? 0.8 : 0.5;
}

function inferReasonCodes({
  field,
  selectedValue,
  selectedConfidence,
  summary,
  hasConflict = false
}) {
  const reasons = [];
  const below = new Set(toArray(summary.fields_below_pass_target).map((item) => normalizeField(item)));
  const criticalBelow = new Set(toArray(summary.critical_fields_below_pass_target).map((item) => normalizeField(item)));
  const missingRequired = new Set(toArray(summary.missing_required_fields).map((item) => normalizeField(item)));
  const normalizedField = normalizeField(field);
  const fieldReasoning = isObject(summary.field_reasoning?.[field])
    ? summary.field_reasoning[field]
    : (isObject(summary.field_reasoning?.[normalizedField]) ? summary.field_reasoning[normalizedField] : {});

  if (!hasKnownValue(selectedValue)) {
    reasons.push('missing_value');
  }
  if (criticalBelow.has(normalizedField)) {
    reasons.push('critical_field_below_pass_target');
  } else if (below.has(normalizedField)) {
    reasons.push('below_pass_target');
  }
  if (missingRequired.has(normalizedField)) {
    reasons.push('missing_required_field');
  }
  if (selectedConfidence < 0.6 && hasKnownValue(selectedValue)) {
    reasons.push('low_confidence');
  } else if (selectedConfidence < 0.85 && hasKnownValue(selectedValue)) {
    reasons.push('needs_review_confidence');
  }
  if (hasConflict) {
    reasons.push('constraint_conflict');
  }
  const unknownReason = String(fieldReasoning.unknown_reason || '').trim();
  if (unknownReason) {
    reasons.push(unknownReason);
  }
  return [...new Set(reasons)];
}

export async function buildReviewLayout({
  storage,
  config = {},
  category
}) {
  const categoryConfig = await loadCategoryConfig(category, { storage, config });
  const fields = categoryConfig.fieldRules?.fields || {};
  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  const workbookPath = inferWorkbookPath(helperRoot, category);
  const workbookExists = await fileExists(workbookPath);

  const rows = [];
  for (const field of categoryConfig.fieldOrder || Object.keys(fields || {})) {
    const rule = isObject(fields[field]) ? fields[field] : {};
    const ui = isObject(rule.ui) ? rule.ui : {};
    const excel = extractExcelHints(rule);
    const excelRow = toInt(excel.row, parseExcelRowFromCell(excel.key_cell));
    rows.push({
      excel_row: excelRow > 0 ? excelRow : null,
      group: String(ui.group || '').trim(),
      key: normalizeField(field),
      label: String(ui.label || field),
      field_rule: normalizeFieldContract(rule),
      _order: toInt(ui.order, Number.MAX_SAFE_INTEGER)
    });
  }

  rows.sort((a, b) => {
    const aRow = a.excel_row === null ? Number.MAX_SAFE_INTEGER : a.excel_row;
    const bRow = b.excel_row === null ? Number.MAX_SAFE_INTEGER : b.excel_row;
    if (aRow !== bRow) {
      return aRow - bRow;
    }
    if (a._order !== b._order) {
      return a._order - b._order;
    }
    return a.key.localeCompare(b.key);
  });

  let currentGroup = '';
  for (const row of rows) {
    if (String(row.group || '').trim()) {
      currentGroup = String(row.group).trim();
    } else if (currentGroup) {
      row.group = currentGroup;
    }
    delete row._order;
  }

  const excelRows = rows.map((row) => row.excel_row).filter((value) => Number.isFinite(value));
  const minRow = excelRows.length > 0 ? Math.min(...excelRows) : 9;
  const maxRow = excelRows.length > 0 ? Math.max(...excelRows) : 83;
  return {
    category,
    excel: {
      workbook: workbookExists ? path.basename(workbookPath) : `${category}Data.xlsm`,
      workbook_path: workbookExists ? workbookPath : '',
      sheet: 'dataEntry',
      key_range: `B${minRow}:B${maxRow}`,
      brand_key_cell: 'B3',
      model_key_cell: 'B4'
    },
    rows
  };
}

async function readLatestArtifacts(storage, category, productId) {
  const latestBase = storage.resolveOutputKey(category, productId, 'latest');
  const normalized = await storage.readJsonOrNull(`${latestBase}/normalized.json`);
  const provenance = await storage.readJsonOrNull(`${latestBase}/provenance.json`);
  const summary = await storage.readJsonOrNull(`${latestBase}/summary.json`);
  let candidates = await storage.readJsonOrNull(`${latestBase}/candidates.json`);
  if (!candidates && summary?.runId) {
    const runBase = storage.resolveOutputKey(category, productId, 'runs', summary.runId);
    candidates = await storage.readJsonOrNull(`${runBase}/provenance/fields.candidates.json`);
  }
  return {
    latestBase,
    normalized: normalized || { identity: {}, fields: {} },
    provenance: provenance || {},
    summary: summary || {},
    candidates: candidates || {}
  };
}

function buildFieldState({
  field,
  candidates,
  normalized,
  provenance,
  summary,
  includeCandidates = true
}) {
  const fieldKey = normalizeField(field);
  const normalizedFields = isObject(normalized.fields) ? normalized.fields : {};
  const selectedValue = Object.prototype.hasOwnProperty.call(normalizedFields, fieldKey)
    ? normalizedFields[fieldKey]
    : 'unk';
  const provenanceRow = isObject(provenance[fieldKey]) ? provenance[fieldKey] : {};
  const selectedConfidence = toNumber(provenanceRow.confidence, 0);
  const candidateRows = toArray(candidates[fieldKey]);
  const hasConflict = toArray(summary.constraint_analysis?.contradictions).some((row) =>
    toArray(row?.fields).map((token) => normalizeField(token)).includes(fieldKey)
  );
  const reasonCodes = inferReasonCodes({
    field: fieldKey,
    selectedValue,
    selectedConfidence,
    summary,
    hasConflict
  });

  let normalizedCandidates = [];
  if (includeCandidates) {
    normalizedCandidates = candidateRows.map((candidate, index) => {
      const evidence = candidateEvidenceFromRows(candidate, provenanceRow);
      return {
        candidate_id: String(candidate.candidate_id || `cand_${fieldKey}_${index + 1}`),
        value: candidate.value ?? 'unk',
        score: candidateScore(candidate, provenanceRow),
        source_id: String(candidate.source_id || evidence.source_id || candidate.host || '').trim(),
        source: String(candidate.host || '').trim(),
        tier: toInt(candidate.tier, 0) || null,
        method: String(candidate.method || '').trim() || null,
        evidence
      };
    });

    if (normalizedCandidates.length === 0 && hasKnownValue(selectedValue)) {
      normalizedCandidates.push({
        candidate_id: `cand_${fieldKey}_selected`,
        value: selectedValue,
        score: Math.max(0, Math.min(1, selectedConfidence || 0.5)),
        source_id: '',
        source: '',
        tier: null,
        method: 'selected_value',
        evidence: candidateEvidenceFromRows({}, provenanceRow)
      });
    }
  }

  let color = 'gray';
  if (hasKnownValue(selectedValue)) {
    color = 'green';
    if (selectedConfidence < 0.85) {
      color = 'yellow';
    }
    if (selectedConfidence < 0.6 || reasonCodes.includes('constraint_conflict')) {
      color = 'red';
    }
  }
  if (reasonCodes.includes('critical_field_below_pass_target') || reasonCodes.includes('below_pass_target')) {
    color = 'red';
  }

  return {
    selected: {
      value: selectedValue,
      confidence: selectedConfidence,
      status: reasonCodes.length > 0 ? 'needs_review' : 'ok',
      color
    },
    needs_review: reasonCodes.length > 0,
    reason_codes: reasonCodes,
    candidate_count: candidateRows.length,
    candidates: normalizedCandidates
  };
}

export async function buildProductReviewPayload({
  storage,
  config = {},
  category,
  productId,
  layout = null,
  includeCandidates = true
}) {
  const resolvedLayout = layout || await buildReviewLayout({ storage, config, category });
  const latest = await readLatestArtifacts(storage, category, productId);
  const rows = {};
  let reviewFieldCount = 0;

  for (const row of resolvedLayout.rows || []) {
    const field = normalizeField(row.key);
    rows[field] = buildFieldState({
      field,
      candidates: latest.candidates,
      normalized: latest.normalized,
      provenance: latest.provenance,
      summary: latest.summary,
      includeCandidates
    });
    if (rows[field].needs_review) {
      reviewFieldCount += 1;
    }
  }

  const identity = isObject(latest.normalized.identity) ? latest.normalized.identity : {};
  return {
    product_id: productId,
    category,
    identity: {
      brand: identity.brand || '',
      model: identity.model || '',
      variant: identity.variant || ''
    },
    fields: rows,
    metrics: {
      confidence: toNumber(latest.summary.confidence, 0),
      coverage: toNumber(latest.summary.coverage_overall, 0),
      flags: reviewFieldCount,
      updated_at: String(latest.summary.generated_at || nowIso())
    }
  };
}

export async function writeProductReviewArtifacts({
  storage,
  config = {},
  category,
  productId
}) {
  const layout = await buildReviewLayout({ storage, config, category });
  const payload = await buildProductReviewPayload({
    storage,
    config,
    category,
    productId,
    layout
  });
  const keys = reviewKeys(storage, category, productId);

  const items = [];
  const byField = {};
  const queueItems = [];
  for (const row of layout.rows || []) {
    const field = normalizeField(row.key);
    const state = payload.fields[field] || {
      selected: { value: 'unk', confidence: 0, status: 'needs_review', color: 'gray' },
      needs_review: true,
      reason_codes: ['missing_value'],
      candidates: []
    };
    byField[field] = [];
    for (let index = 0; index < state.candidates.length; index += 1) {
      const candidate = state.candidates[index];
      const item = {
        candidate_id: candidate.candidate_id,
        candidate_index: index,
        field,
        value: candidate.value,
        score: candidate.score,
        source_id: candidate.source_id || '',
        source: candidate.source || '',
        tier: candidate.tier,
        method: candidate.method || '',
        evidence: candidate.evidence || {},
        needs_review: state.needs_review
      };
      items.push(item);
      byField[field].push(item);
    }
    if (state.needs_review) {
      queueItems.push({
        field,
        reason_codes: state.reason_codes || [],
        selected_value: state.selected.value,
        confidence: state.selected.confidence,
        color: state.selected.color
      });
    }
  }

  const candidatesArtifact = {
    version: 1,
    generated_at: nowIso(),
    category,
    product_id: productId,
    candidate_count: items.length,
    field_count: Object.keys(byField).length,
    items,
    by_field: byField
  };
  const reviewQueueArtifact = {
    version: 1,
    generated_at: nowIso(),
    category,
    product_id: productId,
    count: queueItems.length,
    items: queueItems
  };

  await Promise.all([
    writeJson(storage, keys.candidatesKey, candidatesArtifact),
    writeJson(storage, keys.legacyCandidatesKey, candidatesArtifact),
    writeJson(storage, keys.reviewQueueKey, reviewQueueArtifact),
    writeJson(storage, keys.legacyReviewQueueKey, reviewQueueArtifact),
    writeJson(storage, keys.productKey, payload),
    writeJson(storage, keys.legacyProductKey, payload)
  ]);

  return {
    product_id: productId,
    category,
    candidate_count: items.length,
    review_field_count: queueItems.length,
    keys
  };
}

function parseDateMs(value) {
  const text = String(value || '').trim();
  if (!text) {
    return 0;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function urgencyScore(row = {}) {
  const flags = toInt(row.flags, 0);
  const confidence = toNumber(row.confidence, 0);
  const coverage = toNumber(row.coverage, 0);
  let score = flags * 100;
  score += Math.max(0, (0.9 - confidence) * 40);
  if (coverage < 0.85) {
    score += 10;
  }
  if (normalizeToken(row.status) === 'needs_manual') {
    score += 20;
  }
  return score;
}

export async function buildReviewQueue({
  storage,
  config = {},
  category,
  status = 'needs_review',
  limit = 200
}) {
  const loaded = await loadQueueState({ storage, category });
  const products = Object.values(loaded.state.products || {});
  const rows = [];

  for (const product of products) {
    const productId = String(product.productId || '').trim();
    if (!productId) {
      continue;
    }
    const latest = await readLatestArtifacts(storage, category, productId);
    const keys = reviewKeys(storage, category, productId);
    let reviewQueue = await storage.readJsonOrNull(keys.reviewQueueKey);
    if (!reviewQueue) {
      reviewQueue = await storage.readJsonOrNull(keys.legacyReviewQueueKey);
    }
    const flags = toInt(reviewQueue?.count, 0);
    const confidence = toNumber(latest.summary.confidence, 0);
    const coverage = toNumber(latest.summary.coverage_overall, 0);
    const identity = isObject(latest.normalized.identity) ? latest.normalized.identity : {};
    const item = {
      product_id: productId,
      category,
      brand: String(identity.brand || '').trim(),
      model: String(identity.model || '').trim(),
      variant: String(identity.variant || '').trim(),
      coverage,
      confidence,
      flags,
      status: String(product.status || '').trim() || 'unknown',
      updated_at: String(product.updated_at || latest.summary.generated_at || nowIso())
    };
    const needsReview = flags > 0 || ['needs_manual', 'exhausted', 'failed'].includes(normalizeToken(item.status));
    if (normalizeToken(status) === 'needs_review' && !needsReview) {
      continue;
    }
    if (normalizeToken(status) && normalizeToken(status) !== 'needs_review') {
      if (normalizeToken(item.status) !== normalizeToken(status)) {
        continue;
      }
    }
    rows.push(item);
  }

  rows.sort((a, b) => {
    const urgency = urgencyScore(b) - urgencyScore(a);
    if (urgency !== 0) {
      return urgency;
    }
    const updated = parseDateMs(b.updated_at) - parseDateMs(a.updated_at);
    if (updated !== 0) {
      return updated;
    }
    return a.product_id.localeCompare(b.product_id);
  });

  return rows.slice(0, Math.max(1, toInt(limit, 200)));
}

export async function writeCategoryReviewArtifacts({
  storage,
  config = {},
  category,
  status = 'needs_review',
  limit = 200
}) {
  const items = await buildReviewQueue({
    storage,
    config,
    category,
    status,
    limit
  });
  const key = `_review/${normalizePathToken(category)}/queue.json`;
  const payload = {
    version: 1,
    generated_at: nowIso(),
    category,
    status: normalizeToken(status) || 'needs_review',
    count: items.length,
    items
  };
  await writeJson(storage, key, payload);
  return {
    key,
    count: items.length,
    items
  };
}
