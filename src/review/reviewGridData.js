import fs from 'node:fs/promises';
import path from 'node:path';
import { nowIso } from '../utils/common.js';
import { loadCategoryConfig } from '../categories/loader.js';
import { loadQueueState } from '../queue/queueState.js';
import { ruleRequiredLevel } from '../engine/ruleAccessors.js';
import { confidenceColor } from './confidenceColor.js';
import { buildFallbackFieldCandidateId } from '../utils/candidateIdentifier.js';
import {
  isKnownSlotValue,
  normalizeSlotValueForShape,
  slotValueComparableToken,
  slotValueToText,
} from '../utils/slotValueShape.js';

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

function humanizeSlugToken(value) {
  return String(value || '')
    .split(/[^a-z0-9]+/i)
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function inferIdentityFromProductId(productId, category = '') {
  const tokens = normalizeToken(productId)
    .split('-')
    .map((part) => String(part || '').trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return { brand: '', model: '', variant: '' };
  }

  const normalizedCategory = normalizeToken(category);
  if (normalizedCategory && tokens[0] === normalizedCategory) {
    tokens.shift();
  }
  if (tokens.length === 0) {
    return { brand: '', model: '', variant: '' };
  }

  const brandToken = tokens.shift() || '';
  let modelTokens = [...tokens];
  let variantToken = '';
  if (modelTokens.length >= 2) {
    const tail = modelTokens[modelTokens.length - 1];
    const prev = modelTokens[modelTokens.length - 2];
    if (tail && tail === prev) {
      variantToken = tail;
      modelTokens = modelTokens.slice(0, -1);
    }
  }

  return {
    brand: humanizeSlugToken(brandToken),
    model: humanizeSlugToken(modelTokens.join(' ')),
    variant: humanizeSlugToken(variantToken)
  };
}

function hasKnownValue(value) {
  return isKnownSlotValue(value, 'scalar') || isKnownSlotValue(value, 'list');
}

function resolveOverrideFilePath({ config = {}, category, productId }) {
  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  return path.join(helperRoot, category, '_overrides', `${productId}.overrides.json`);
}

async function readOverrideFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (isObject(parsed)) return parsed;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return null;
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
  const level = ruleRequiredLevel(rule);
  const comp = isObject(rule.component) ? rule.component : null;
  const enu = isObject(rule.enum) ? rule.enum : null;
  return {
    type: String(contract.type || 'string'),
    shape: String(contract.shape || 'scalar').trim().toLowerCase() || 'scalar',
    required: level === 'required' || level === 'critical' || level === 'identity',
    units: contract.unit || null,
    enum_name: String(rule.enum_name || '').trim() || null,
    component_type: comp?.type || null,
    enum_source: enu?.source || null,
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

export async function readLatestArtifacts(storage, category, productId) {
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

function dbSourceLabel(source) {
  const token = normalizeToken(source);
  if (token === 'component_db' || token === 'known_values' || token === 'workbook') return 'Excel Import';
  if (token === 'pipeline') return 'Pipeline';
  if (token === 'user') return 'user';
  return String(source || '').trim();
}

function dbSourceMethod(source) {
  const token = normalizeToken(source);
  if (token === 'component_db' || token === 'known_values' || token === 'workbook') return 'workbook_import';
  if (token === 'pipeline') return 'pipeline_extract';
  if (token === 'user') return 'manual_override';
  return null;
}

function extractHostFromUrl(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function candidateSourceLabel(candidate = {}, evidence = {}) {
  const host = String(candidate.host || '').trim();
  if (host) return host;
  const source = String(candidate.source || '').trim();
  if (source) return source;
  const sourceId = String(candidate.source_id || evidence.source_id || '').trim();
  if (sourceId) {
    const mapped = dbSourceLabel(sourceId);
    return mapped || sourceId;
  }
  const evidenceUrl = String(evidence.url || candidate.url || '').trim();
  return extractHostFromUrl(evidenceUrl);
}

function toSpecDbCandidateRow(row = {}) {
  const quoteStart = row.quote_span_start;
  const quoteEnd = row.quote_span_end;
  const quoteSpan = Number.isFinite(Number(quoteStart)) && Number.isFinite(Number(quoteEnd))
    ? [Number(quoteStart), Number(quoteEnd)]
    : null;
  return {
    candidate_id: row.candidate_id || '',
    value: row.value ?? null,
    score: row.score ?? 0,
    source_id: row.source_host || row.source_root_domain || row.source_method || '',
    host: row.source_host || row.source_root_domain || '',
    tier: row.source_tier ?? null,
    method: row.source_method || '',
    evidence: {
      url: row.evidence_url || row.source_url || '',
      retrieved_at: row.evidence_retrieved_at || row.extracted_at || '',
      snippet_id: row.snippet_id || '',
      snippet_hash: row.snippet_hash || '',
      quote: row.quote || '',
      quote_span: quoteSpan,
      snippet_text: row.snippet_text || '',
      source_id: row.source_host || row.source_root_domain || row.source_method || '',
    },
    llm_extract_model: row.llm_extract_model || null,
    llm_extract_provider: row.llm_extract_provider || null,
    llm_validate_model: row.llm_validate_model || null,
    llm_validate_provider: row.llm_validate_provider || null,
  };
}

export function buildFieldState({
  field,
  candidates,
  normalized,
  provenance,
  summary,
  includeCandidates = true,
  category = '',
  productId = '',
  fieldShape = 'scalar',
  acceptedCandidateId = null,
  overridden = false,
}) {
  const fieldKey = normalizeField(field);
  const normalizedShape = String(fieldShape || 'scalar').trim().toLowerCase() || 'scalar';
  const normalizedFields = isObject(normalized.fields) ? normalized.fields : {};
  const rawSelectedValue = Object.prototype.hasOwnProperty.call(normalizedFields, fieldKey)
    ? normalizedFields[fieldKey]
    : 'unk';
  const selectedShapeValue = normalizeSlotValueForShape(rawSelectedValue, normalizedShape).value;
  const selectedValue = normalizedShape === 'list'
    ? (slotValueToText(selectedShapeValue, normalizedShape) ?? 'unk')
    : selectedShapeValue;
  const provenanceRow = isObject(provenance[fieldKey]) ? provenance[fieldKey] : {};
  const selectedConfidenceHint = Math.max(0, Math.min(1, toNumber(provenanceRow.confidence, 0)));
  const candidateRows = toArray(candidates[fieldKey]);
  let normalizedCandidates = candidateRows
    .map((candidate, index) => {
      const normalizedCandidateValue = normalizeSlotValueForShape(candidate.value, normalizedShape).value;
      if (!isKnownSlotValue(normalizedCandidateValue, normalizedShape)) {
        return null;
      }
      const evidence = candidateEvidenceFromRows(candidate, provenanceRow);
      const source = candidateSourceLabel(candidate, evidence);
      return {
        candidate_id: String(candidate.candidate_id || buildFallbackFieldCandidateId({
          productId,
          fieldKey,
          value: normalizedCandidateValue,
          index: index + 1,
          variant: 'candidate',
        })),
        value: normalizedShape === 'list'
          ? (slotValueToText(normalizedCandidateValue, normalizedShape) ?? 'unk')
          : normalizedCandidateValue,
        score: candidateScore(candidate, provenanceRow),
        source_id: String(candidate.source_id || evidence.source_id || candidate.host || '').trim(),
        source,
        tier: toInt(candidate.tier, 0) || null,
        method: String(candidate.method || '').trim() || null,
        evidence,
        llm_extract_model: candidate.llm_extract_model || null,
        llm_extract_provider: candidate.llm_extract_provider || null,
        llm_validate_model: candidate.llm_validate_model || null,
        llm_validate_provider: candidate.llm_validate_provider || null
      };
    })
    .filter(Boolean);

  if (!overridden && normalizedCandidates.length === 0 && hasKnownValue(selectedValue)) {
    // No candidate rows exist yet; preserve selected value as a synthetic candidate for slot provenance.
    const provenanceHost = String(provenanceRow.host || '').trim();
    const provenanceSourceToken = normalizeToken(provenanceRow.source || provenanceRow.source_id || '');
    const fallbackSourceToken = provenanceSourceToken || (provenanceHost ? '' : 'workbook');
    const fallbackSource = fallbackSourceToken
      ? (dbSourceLabel(fallbackSourceToken) || fallbackSourceToken)
      : '';
    const baseEvidence = candidateEvidenceFromRows({}, provenanceRow);
    normalizedCandidates.push({
      candidate_id: buildFallbackFieldCandidateId({
        productId,
        fieldKey,
        value: selectedValue,
        index: 0,
        variant: 'selected',
      }),
      value: selectedValue,
      score: Math.max(0, Math.min(1, selectedConfidenceHint || 0.5)),
      source_id: fallbackSourceToken || '',
      source: fallbackSource,
      tier: null,
      method: dbSourceMethod(fallbackSourceToken) || 'selected_value',
      evidence: {
        ...baseEvidence,
        quote: category ? `Imported from ${category}Data.xlsm` : baseEvidence.quote,
        snippet_text: category ? `Imported from ${category}Data.xlsm` : baseEvidence.snippet_text,
        retrieved_at: summary.generated_at || baseEvidence.retrieved_at,
        source_id: fallbackSourceToken || baseEvidence.source_id || '',
      },
      is_synthetic_selected: true,
    });
  }

  if (normalizedCandidates.length > 1) {
    normalizedCandidates.sort((left, right) => toNumber(right.score, 0) - toNumber(left.score, 0));
  }

  const acceptedCandidate = !overridden && String(acceptedCandidateId || '').trim()
    ? normalizedCandidates.find((candidate) => normalizeToken(candidate.candidate_id) === normalizeToken(acceptedCandidateId))
    : null;
  const topCandidate = normalizedCandidates[0] || null;
  const selectedToken = slotValueComparableToken(selectedValue, normalizedShape);
  const topToken = topCandidate ? slotValueComparableToken(topCandidate.value, normalizedShape) : '';

  let selectedCandidate = null;
  let resolvedSelectedValue = selectedValue;
  let resolvedSelectedConfidence = selectedConfidenceHint;
  if (!overridden) {
    if (acceptedCandidate) {
      selectedCandidate = acceptedCandidate;
      resolvedSelectedValue = acceptedCandidate.value;
      resolvedSelectedConfidence = Math.max(selectedConfidenceHint, toNumber(acceptedCandidate.score, selectedConfidenceHint));
    } else if (topCandidate) {
      selectedCandidate = topCandidate;
      if (!selectedToken || selectedToken !== topToken) {
        resolvedSelectedValue = topCandidate.value;
      }
      resolvedSelectedConfidence = Math.max(selectedConfidenceHint, toNumber(topCandidate.score, selectedConfidenceHint));
    } else if (!hasKnownValue(resolvedSelectedValue)) {
      resolvedSelectedValue = 'unk';
      resolvedSelectedConfidence = 0;
    }
  }

  const hasConflict = toArray(summary.constraint_analysis?.contradictions).some((row) =>
    toArray(row?.fields).map((token) => normalizeField(token)).includes(fieldKey)
  );
  const reasonCodes = inferReasonCodes({
    field: fieldKey,
    selectedValue: resolvedSelectedValue,
    selectedConfidence: resolvedSelectedConfidence,
    summary,
    hasConflict
  });

  const color = hasKnownValue(resolvedSelectedValue)
    ? confidenceColor(resolvedSelectedConfidence, reasonCodes)
    : 'gray';

  const sourceCandidate = selectedCandidate || topCandidate;
  const topEvidence = sourceCandidate
    ? (isObject(sourceCandidate.evidence)
      ? sourceCandidate.evidence
      : candidateEvidenceFromRows(sourceCandidate, provenanceRow))
    : null;
  const topSource = sourceCandidate
    ? (String(sourceCandidate.source || '').trim() || candidateSourceLabel(sourceCandidate, topEvidence || {}))
    : '';
  const topMethod = sourceCandidate
    ? (String(sourceCandidate.method || '').trim() || null)
    : null;
  const topTier = sourceCandidate ? (toInt(sourceCandidate.tier, 0) || null) : null;
  const topEvidenceUrl = topEvidence?.url || '';
  const topEvidenceQuote = topEvidence?.quote || '';

  return {
    selected: {
      value: resolvedSelectedValue,
      confidence: resolvedSelectedConfidence,
      status: reasonCodes.length > 0 ? 'needs_review' : 'ok',
      color
    },
    needs_review: reasonCodes.length > 0,
    reason_codes: reasonCodes,
    candidate_count: normalizedCandidates.length,
    candidates: includeCandidates ? normalizedCandidates : [],
    accepted_candidate_id: overridden ? null : (acceptedCandidate?.candidate_id || null),
    selected_candidate_id: overridden ? null : (selectedCandidate?.candidate_id || null),
    source: topSource,
    method: topMethod,
    tier: topTier,
    evidence_url: topEvidenceUrl,
    evidence_quote: topEvidenceQuote
  };
}

export async function buildProductReviewPayload({
  storage,
  config = {},
  category,
  productId,
  layout = null,
  includeCandidates = true,
  specDb = null,
}) {
  const resolvedLayout = layout || await buildReviewLayout({ storage, config, category });
  const latest = await readLatestArtifacts(storage, category, productId);
  const rows = {};
  let reviewableFlags = 0;
  let missingCount = 0;

  let useSpecDb = false;
  let dbHasAnyState = false;
  let dbProduct = null;
  let dbFieldRowsByField = new Map();
  let dbCandidatesByField = {};

  if (specDb) {
    try {
      useSpecDb = true;
      const dbFieldRows = toArray(specDb.getItemFieldState(productId));
      dbHasAnyState = dbFieldRows.length > 0;
      dbFieldRowsByField = new Map(dbFieldRows.map((row) => [normalizeField(row.field_key), row]));
      dbCandidatesByField = specDb.getCandidatesForProduct(productId) || {};
      dbProduct = specDb.getProduct(productId) || null;

      // ID-first invariant: every grid field must have a persisted slot row.
      // This guarantees itemFieldStateId exists for all drawer mutations.
      const layoutFields = toArray(resolvedLayout?.rows)
        .map((row) => normalizeField(row?.key))
        .filter(Boolean);
      const missingFields = layoutFields.filter((field) => !dbFieldRowsByField.has(field));
      if (missingFields.length > 0) {
        for (const fieldKey of missingFields) {
          specDb.upsertItemFieldState({
            productId,
            fieldKey,
            value: 'unk',
            confidence: 0,
            source: 'pipeline',
            acceptedCandidateId: null,
            overridden: false,
            needsAiReview: false,
            aiReviewComplete: false,
          });
        }
        const refreshedRows = toArray(specDb.getItemFieldState(productId));
        dbHasAnyState = refreshedRows.length > 0;
        dbFieldRowsByField = new Map(refreshedRows.map((row) => [normalizeField(row.field_key), row]));
      }
    } catch {
      useSpecDb = false;
      dbHasAnyState = false;
      dbFieldRowsByField = new Map();
      dbCandidatesByField = {};
    }
  }

  // Read override file only in JSON-primary mode.
  const overridePath = resolveOverrideFilePath({ config, category, productId });
  const overrideDoc = useSpecDb ? null : await readOverrideFile(overridePath);
  const overrides = isObject(overrideDoc?.overrides) ? overrideDoc.overrides : {};

  for (const row of resolvedLayout.rows || []) {
    const field = normalizeField(row.key);
    const fieldShape = String(row?.field_rule?.shape || 'scalar').trim().toLowerCase() || 'scalar';
    const dbFieldRow = useSpecDb ? dbFieldRowsByField.get(field) : null;

    if (dbFieldRow) {
      const dbCandidateRows = toArray(dbCandidatesByField[field]).map(toSpecDbCandidateRow);
      const isOverridden = Boolean(dbFieldRow.overridden);
      const selectedShapeValue = normalizeSlotValueForShape(
        dbFieldRow.value != null && String(dbFieldRow.value).trim() !== '' ? dbFieldRow.value : 'unk',
        fieldShape
      ).value;
      const selectedValue = slotValueToText(selectedShapeValue, fieldShape) ?? 'unk';
      const state = buildFieldState({
        field,
        candidates: { [field]: dbCandidateRows },
        normalized: { fields: { [field]: selectedValue } },
        provenance: {
          [field]: {
            value: selectedValue,
            confidence: Math.max(0, Math.min(1, toNumber(dbFieldRow.confidence, 0))),
            host: '',
            source: dbFieldRow.source || '',
            evidence: [],
          }
        },
        summary: latest.summary,
        includeCandidates,
        category,
        productId,
        fieldShape,
        acceptedCandidateId: dbFieldRow.accepted_candidate_id || null,
        overridden: isOverridden,
      });

      const needsReview = Boolean(dbFieldRow.needs_ai_review);
      const reasonCodes = needsReview
        ? (state.reason_codes.length > 0 ? state.reason_codes : ['needs_ai_review'])
        : [];
      const selectedConfidence = isOverridden
        ? 1
        : Math.max(
          Math.max(0, Math.min(1, toNumber(dbFieldRow.confidence, 0))),
          Math.max(0, Math.min(1, toNumber(state.selected?.confidence, 0)))
        );
      const color = hasKnownValue(state.selected?.value)
        ? confidenceColor(selectedConfidence, reasonCodes)
        : 'gray';

      state.selected = {
        value: isOverridden ? selectedValue : state.selected.value,
        confidence: selectedConfidence,
        status: needsReview ? 'needs_review' : 'ok',
        color,
      };
      state.needs_review = needsReview;
      state.reason_codes = reasonCodes;
      state.candidate_count = Number.isFinite(Number(state.candidate_count))
        ? Number(state.candidate_count)
        : dbCandidateRows.length;
      state.overridden = isOverridden;
      state.slot_id = dbFieldRow.id ?? null;
      state.accepted_candidate_id = state.overridden
        ? null
        : (state.accepted_candidate_id || String(dbFieldRow.accepted_candidate_id || '').trim() || null);
      state.source_timestamp = String(dbFieldRow.updated_at || '').trim() || null;

      if (state.overridden) {
        state.source = 'user';
        state.method = 'manual_override';
        state.tier = null;
      } else if (dbFieldRow.source) {
        state.source = state.source || dbSourceLabel(dbFieldRow.source);
        state.method = state.method || dbSourceMethod(dbFieldRow.source);
        state.tier = null;
      }

      rows[field] = state;
    } else if (useSpecDb) {
      rows[field] = buildFieldState({
        field,
        candidates: {},
        normalized: { fields: {} },
        provenance: {},
        summary: {},
        includeCandidates,
        category,
        productId,
        fieldShape,
      });
    } else {
      rows[field] = buildFieldState({
        field,
        candidates: latest.candidates,
        normalized: latest.normalized,
        provenance: latest.provenance,
        summary: latest.summary,
        includeCandidates,
        category,
        productId,
        fieldShape,
      });
    }

    // Apply override on top of pipeline data (JSON-primary mode only).
    const ovr = overrides[field];
    if (isObject(ovr) && ovr.override_value != null) {
      const overrideShapeValue = normalizeSlotValueForShape(ovr.override_value, fieldShape).value;
      const overrideValue = slotValueToText(overrideShapeValue, fieldShape) ?? 'unk';
      rows[field].selected = {
        value: overrideValue,
        confidence: 1.0,
        status: 'ok',
        color: 'green'
      };
      rows[field].needs_review = false;
      rows[field].reason_codes = [];
      // Only show OVR badge for manual entries — candidate acceptance is confirmation, not override
      rows[field].overridden = ovr.override_source === 'manual_entry';
      rows[field].accepted_candidate_id = rows[field].overridden
        ? null
        : String(ovr.candidate_id || '').trim() || null;
      // Surface the timestamp from override provenance
      rows[field].source_timestamp = ovr.overridden_at || ovr.set_at || null;

      // Populate source from override provenance so tooltip/drawer show correct source
      if (ovr.override_source === 'manual_entry') {
        rows[field].source = 'user';
        rows[field].method = 'manual_override';
        rows[field].tier = null;
      } else if (isObject(ovr.source)) {
        rows[field].source = String(ovr.source.host || '').trim();
        rows[field].method = String(ovr.source.method || '').trim();
        rows[field].tier = toInt(ovr.source.tier, 0) || null;
      }
      if (isObject(ovr.override_provenance)) {
        rows[field].evidence_url = String(ovr.override_provenance.url || '').trim();
        rows[field].evidence_quote = String(ovr.override_provenance.quote || '').trim();
      }
    }

    if (rows[field].needs_review) {
      if (hasKnownValue(rows[field].selected.value)) {
        reviewableFlags += 1;
      } else {
        missingCount += 1;
      }
    }
  }

  const fallbackConfidence = toNumber(latest.summary.confidence, 0);
  const fallbackCoverage = toNumber(latest.summary.coverage_overall_percent, 0) / 100;
  const computedCoverage = resolvedLayout.rows.length > 0
    ? (resolvedLayout.rows.length - missingCount) / resolvedLayout.rows.length
    : 0;
  const knownFieldStates = Object.values(rows).filter((state) => hasKnownValue(state?.selected?.value));
  const computedConfidence = knownFieldStates.length > 0
    ? knownFieldStates.reduce((sum, state) => sum + toNumber(state?.selected?.confidence, 0), 0) / knownFieldStates.length
    : 0;
  const confidence = useSpecDb && computedConfidence > 0 ? computedConfidence : fallbackConfidence;
  const coverage = useSpecDb ? computedCoverage : fallbackCoverage;

  const identity = isObject(latest.normalized.identity) ? latest.normalized.identity : {};
  const inferredIdentity = inferIdentityFromProductId(productId, category);
  const updatedAt = (() => {
    if (useSpecDb) {
      let maxTs = 0;
      for (const state of Object.values(rows)) {
        const ts = parseDateMs(state?.source_timestamp || '');
        if (ts > maxTs) maxTs = ts;
      }
      if (maxTs > 0) return new Date(maxTs).toISOString();
    }
    return String(latest.summary.generated_at || nowIso());
  })();

  return {
    product_id: productId,
    category,
    identity: {
      id: toInt(identity.id, toInt(dbProduct?.id, 0)),
      identifier: String(identity.identifier || dbProduct?.identifier || '').trim(),
      brand: String(identity.brand || dbProduct?.brand || inferredIdentity.brand || '').trim(),
      model: String(identity.model || dbProduct?.model || inferredIdentity.model || '').trim(),
      variant: String(identity.variant || dbProduct?.variant || inferredIdentity.variant || '').trim()
    },
    fields: rows,
    metrics: {
      confidence,
      coverage,
      flags: reviewableFlags,
      missing: missingCount,
      has_run: useSpecDb
        ? dbHasAnyState
        : !!(latest.summary.generated_at && (confidence > 0 || coverage > 0)),
      updated_at: updatedAt
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
  limit = 200,
  specDb = null,
}) {
  const loaded = await loadQueueState({ storage, category, specDb });
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
    const coverage = toNumber(latest.summary.coverage_overall_percent, 0) / 100;
    const identity = isObject(latest.normalized.identity) ? latest.normalized.identity : {};
    const inferredIdentity = inferIdentityFromProductId(productId, category);
    const item = {
      product_id: productId,
      category,
      id: toInt(identity.id, 0),
      identifier: String(identity.identifier || '').trim(),
      brand: String(identity.brand || inferredIdentity.brand || '').trim(),
      model: String(identity.model || inferredIdentity.model || '').trim(),
      variant: String(identity.variant || inferredIdentity.variant || '').trim(),
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
  limit = 200,
  specDb = null,
}) {
  const items = await buildReviewQueue({
    storage,
    config,
    category,
    status,
    limit,
    specDb,
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
