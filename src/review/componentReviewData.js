// ── Component Review Data Builder ────────────────────────────────────
//
// Mirrors reviewGridData.js patterns for component tables and enum lists.
// Three exported functions supply the review-components API endpoints.

import fs from 'node:fs/promises';
import path from 'node:path';
import { confidenceColor } from './confidenceColor.js';
import { evaluateVarianceBatch } from './varianceEvaluator.js';
import {
  buildComponentReviewSyntheticCandidateId,
  buildSyntheticComponentCandidateId,
  buildReferenceComponentCandidateId,
  buildPipelineEnumCandidateId,
  buildReferenceEnumCandidateId
} from '../utils/candidateIdentifier.js';
import { buildComponentIdentifier } from '../utils/componentIdentifier.js';

function isObject(v) { return Boolean(v) && typeof v === 'object' && !Array.isArray(v); }
function toArray(v) { return Array.isArray(v) ? v : []; }
function normalizeToken(v) { return String(v ?? '').trim().toLowerCase(); }
function slugify(v) { return String(v || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function splitCandidateParts(v) {
  if (Array.isArray(v)) {
    const nested = v.flatMap((entry) => splitCandidateParts(entry));
    return [...new Set(nested)];
  }
  const text = String(v ?? '').trim();
  if (!text) return [];
  const parts = text.includes(',')
    ? text.split(',').map((part) => part.trim()).filter(Boolean)
    : [text];
  return [...new Set(parts)];
}

function parseReviewItemAttributes(reviewItem) {
  const raw = reviewItem?.product_attributes;
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function makerTokensFromReviewItem(reviewItem, componentType) {
  const attrs = parseReviewItemAttributes(reviewItem);
  const fieldKey = String(reviewItem?.field_key || '').trim();
  const keys = [
    `${componentType}_brand`,
    `${componentType}_maker`,
    fieldKey ? `${fieldKey}_brand` : '',
    fieldKey ? `${fieldKey}_maker` : '',
    'brand',
    'maker',
  ].filter(Boolean);

  const tokens = [];
  for (const key of keys) {
    for (const value of splitCandidateParts(attrs[key])) {
      const token = normalizeToken(value);
      if (!hasKnownValue(token)) continue;
      tokens.push(token);
    }
  }
  for (const value of splitCandidateParts(reviewItem?.ai_suggested_maker)) {
    const token = normalizeToken(value);
    if (!hasKnownValue(token)) continue;
    tokens.push(token);
  }
  return [...new Set(tokens)];
}

function reviewItemMatchesMakerLane(reviewItem, {
  componentType,
  maker,
  allowMakerlessForNamedLane = false,
}) {
  const makerTokens = makerTokensFromReviewItem(reviewItem, componentType);
  const laneMakerToken = normalizeToken(maker);
  if (!laneMakerToken) {
    return makerTokens.length === 0;
  }
  if (makerTokens.length === 0) {
    return Boolean(allowMakerlessForNamedLane);
  }
  return makerTokens.includes(laneMakerToken);
}

function componentLaneSlug(componentName, componentMaker = '') {
  return `${slugify(componentName)}_${slugify(componentMaker || 'na')}`;
}

function isTestModeCategory(category) {
  return String(category || '').trim().toLowerCase().startsWith('_test_');
}

function discoveredFromSource(source) {
  const token = normalizeSourceToken(source);
  return token === 'pipeline' || token === 'discovered' || token === 'ai_discovered';
}

function normalizeDiscoveryRows(rows = []) {
  return toArray(rows).map((row) => {
    const source = String(row?.discovery_source || '').trim();
    const discovered = typeof row?.discovered === 'boolean'
      ? row.discovered
      : discoveredFromSource(source);
    return {
      ...row,
      discovery_source: source,
      discovered,
    };
  });
}

function enforceNonDiscoveredRows(rows = [], category = '') {
  const normalizedRows = normalizeDiscoveryRows(rows);
  if (!isTestModeCategory(category) || normalizedRows.length === 0) {
    return normalizedRows;
  }
  const maxNonDiscovered = 3;
  let nonDiscoveredSeen = 0;
  const result = normalizedRows.map((row) => {
    if (!row.discovered) {
      nonDiscoveredSeen += 1;
      if (nonDiscoveredSeen > maxNonDiscovered) {
        return { ...row, discovered: true };
      }
    }
    return row;
  });
  const hasNonDiscovered = result.some((row) => !row.discovered);
  if (!hasNonDiscovered) {
    const firstUnlinked = result.findIndex((row) => (row?.linked_products?.length || 0) === 0);
    const anchorIdx = firstUnlinked >= 0 ? firstUnlinked : 0;
    return result.map((row, index) => (index === anchorIdx ? { ...row, discovered: false } : row));
  }
  return result;
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${k}:${stableSerialize(v)}`).join(',')}}`;
  }
  return String(value ?? '');
}

function valueToken(value) {
  if (value == null) return '';
  if (typeof value === 'string') return normalizeToken(value);
  if (typeof value === 'number' || typeof value === 'boolean') return normalizeToken(value);
  return normalizeToken(stableSerialize(value));
}

function hasKnownValue(value) {
  const token = valueToken(value);
  return token !== '' && token !== 'unk' && token !== 'unknown' && token !== 'n/a' && token !== 'null';
}

function clamp01(value, fallback = 0) {
  const n = Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function normalizeSourceToken(source) {
  const token = normalizeToken(source);
  if (!token) return '';
  if (token === 'component_db' || token === 'known_values' || token === 'reference') {
    return 'reference';
  }
  if (token === 'pipeline' || token.startsWith('pipeline')) return 'pipeline';
  if (token === 'specdb') return 'specdb';
  if (token === 'manual' || token === 'user') return 'user';
  return token;
}

function sourceLabelFromToken(token, fallback = '') {
  const normalized = normalizeSourceToken(token);
  const fallbackLabel = String(fallback || '').trim();
  if (normalized === 'reference') return fallbackLabel || 'Reference';
  if (normalized === 'pipeline') return fallbackLabel || 'Pipeline';
  if (normalized === 'specdb') return fallbackLabel || 'SpecDb';
  if (normalized === 'user') return fallbackLabel || 'user';
  return fallbackLabel || normalized || '';
}

function sourceMethodFromToken(token, fallback = null) {
  const normalized = normalizeSourceToken(token);
  if (normalized === 'reference') return 'reference_data';
  if (normalized === 'pipeline') return 'pipeline_extraction';
  if (normalized === 'specdb') return 'specdb_lookup';
  if (normalized === 'user') return 'manual_override';
  return fallback;
}

function candidateSourceToken(candidate, fallback = '') {
  return normalizeSourceToken(candidate?.source_id || candidate?.source || fallback);
}

function buildPipelineAttributionContext(reviewItems) {
  const productIds = [...new Set(
    toArray(reviewItems)
      .map((entry) => String(entry?.product_id || '').trim())
      .filter(Boolean)
  )];
  const productCount = productIds.length;
  return {
    productIds,
    productCount,
    productLabel: `${productCount} product${productCount === 1 ? '' : 's'}`,
  };
}

function pipelineSourceFromAttribution(attributionContext) {
  const label = String(attributionContext?.productLabel || '').trim();
  return label ? `Pipeline (${label})` : 'Pipeline';
}

function buildPipelineEvidenceQuote(baseQuote, attributionContext) {
  const quote = String(baseQuote || '').trim();
  const label = String(attributionContext?.productLabel || '').trim();
  if (!label) return quote;
  if (!quote) return `Observed across ${label}`;
  return `${quote}; observed across ${label}`;
}

function reviewItemScore(reviewItem, fallback = 0.5) {
  const value = Number(reviewItem?.combined_score);
  return Number.isFinite(value) ? value : fallback;
}

function buildPipelineReviewCandidate({
  candidateId,
  value,
  reviewItem,
  method,
  quote,
  snippetText,
  attributionContext,
}) {
  return {
    candidate_id: candidateId,
    value,
    score: reviewItemScore(reviewItem),
    source_id: 'pipeline',
    source: pipelineSourceFromAttribution(attributionContext),
    tier: null,
    method,
    evidence: {
      url: '',
      retrieved_at: reviewItem?.created_at || '',
      snippet_id: '',
      snippet_hash: '',
      quote: buildPipelineEvidenceQuote(quote, attributionContext),
      quote_span: null,
      snippet_text: String(snippetText || '').trim(),
      source_id: 'pipeline',
    },
  };
}

function sortCandidatesByScore(candidates) {
  return [...candidates].sort((a, b) => {
    const aScore = clamp01(a?.score, -1);
    const bScore = clamp01(b?.score, -1);
    if (bScore !== aScore) return bScore - aScore;
    return String(a?.candidate_id || '').localeCompare(String(b?.candidate_id || ''));
  });
}

function ensureCandidateShape(candidate, fallbackId, fallbackSourceToken = '') {
  const sourceToken = candidateSourceToken(candidate, fallbackSourceToken);
  const sourceLabel = sourceLabelFromToken(sourceToken, String(candidate?.source || '').trim());
  const existingEvidence = isObject(candidate?.evidence) ? candidate.evidence : {};
  const isSyntheticSelected = Boolean(candidate?.is_synthetic_selected);
  return {
    candidate_id: String(candidate?.candidate_id || fallbackId || '').trim() || String(fallbackId || 'candidate'),
    value: candidate?.value ?? null,
    score: clamp01(candidate?.score, 0),
    source_id: sourceToken || String(candidate?.source_id || '').trim(),
    source: sourceLabel,
    tier: candidate?.tier ?? null,
    method: String(candidate?.method || '').trim() || sourceMethodFromToken(sourceToken, null),
    evidence: {
      url: String(existingEvidence.url || '').trim(),
      retrieved_at: String(existingEvidence.retrieved_at || '').trim(),
      snippet_id: String(existingEvidence.snippet_id || '').trim(),
      snippet_hash: String(existingEvidence.snippet_hash || '').trim(),
      quote: String(existingEvidence.quote || '').trim(),
      quote_span: Array.isArray(existingEvidence.quote_span) ? existingEvidence.quote_span : null,
      snippet_text: String(existingEvidence.snippet_text || '').trim(),
      source_id: String(existingEvidence.source_id || sourceToken || '').trim(),
    },
    is_synthetic_selected: isSyntheticSelected,
  };
}

function buildSyntheticSelectedCandidate({
  candidateId,
  value,
  confidence,
  sourceToken,
  sourceTimestamp = null,
  quote = '',
}) {
  const normalizedSource = normalizeSourceToken(sourceToken) || 'pipeline';
  const message = String(quote || '').trim() || 'Selected value carried from current slot state';
  return {
    candidate_id: String(candidateId || '').trim() || 'selected_value',
    value,
    score: clamp01(confidence, 0.5),
    source_id: normalizedSource,
    source: sourceLabelFromToken(normalizedSource),
    tier: null,
    method: sourceMethodFromToken(normalizedSource, 'selected_value'),
    evidence: {
      url: '',
      retrieved_at: String(sourceTimestamp || '').trim(),
      snippet_id: '',
      snippet_hash: '',
      quote: message,
      quote_span: null,
      snippet_text: message,
      source_id: normalizedSource,
    },
    is_synthetic_selected: true,
  };
}

function ensureTrackedStateCandidateInvariant(state, {
  fallbackCandidateId,
  fallbackQuote = '',
} = {}) {
  if (!isObject(state)) return;
  const sourceToken = normalizeSourceToken(state.source);
  const userDriven = Boolean(state.overridden) || sourceToken === 'user';
  const selectedValue = state?.selected?.value;
  const selectedToken = valueToken(selectedValue);
  const selectedConfidence = clamp01(state?.selected?.confidence, 0.5);
  const acceptedCandidateId = String(state?.accepted_candidate_id || '').trim();

  let candidates = toArray(state.candidates)
    .filter((candidate) => hasKnownValue(candidate?.value))
    .map((candidate, index) => ensureCandidateShape(
      candidate,
      `${fallbackCandidateId || 'candidate'}_${index + 1}`,
      sourceToken,
    ));

  const hasAcceptedCandidateId = acceptedCandidateId
    ? candidates.some((candidate) => String(candidate.candidate_id || '').trim() === acceptedCandidateId)
    : false;

  if (!userDriven && selectedToken && acceptedCandidateId && !hasAcceptedCandidateId) {
    candidates.push(buildSyntheticSelectedCandidate({
      candidateId: acceptedCandidateId,
      value: selectedValue,
      confidence: selectedConfidence,
      sourceToken,
      sourceTimestamp: state.source_timestamp,
      quote: fallbackQuote,
    }));
  }

  if (!userDriven && selectedToken && !candidates.some((candidate) => valueToken(candidate.value) === selectedToken)) {
    candidates.push(buildSyntheticSelectedCandidate({
      candidateId: `${fallbackCandidateId || 'candidate'}_selected`,
      value: selectedValue,
      confidence: selectedConfidence,
      sourceToken,
      sourceTimestamp: state.source_timestamp,
      quote: fallbackQuote,
    }));
  }

  candidates = sortCandidatesByScore(candidates);
  state.candidates = candidates;
  state.candidate_count = candidates.length;

  if (userDriven) {
    if (isObject(state.selected) && hasKnownValue(state.selected.value)) {
      const conf = clamp01(state.selected.confidence, selectedConfidence);
      state.selected.confidence = conf;
      state.selected.color = confidenceColor(conf, toArray(state.reason_codes));
    }
    return;
  }

  const acceptedId = String(state.accepted_candidate_id || '').trim();
  const acceptedCandidate = acceptedId
    ? candidates.find((candidate) => String(candidate.candidate_id || '').trim() === acceptedId)
    : null;
  const selectedCandidate = acceptedCandidate || candidates[0] || null;
  if (!selectedCandidate || !hasKnownValue(selectedCandidate.value)) return;

  const confidence = clamp01(selectedCandidate.score, selectedConfidence);
  state.selected = {
    ...(isObject(state.selected) ? state.selected : {}),
    value: selectedCandidate.value,
    confidence,
    status: acceptedCandidate ? 'accepted' : (state.needs_review ? 'needs_review' : 'ok'),
    color: confidenceColor(confidence, toArray(state.reason_codes)),
  };
  const candidateSource = candidateSourceToken(selectedCandidate, sourceToken);
  if (candidateSource) {
    state.source = candidateSource;
  }
}

function ensureEnumValueCandidateInvariant(entry, {
  fieldKey,
  fallbackQuote = '',
} = {}) {
  if (!isObject(entry)) return;
  const sourceToken = normalizeSourceToken(entry.source);
  const userDriven = sourceToken === 'user' || sourceToken === 'manual' || Boolean(entry.overridden);
  const selectedToken = valueToken(entry.value);
  const selectedConfidence = clamp01(entry.confidence, 0.5);
  const acceptedCandidateId = String(entry.accepted_candidate_id || '').trim();

  let candidates = toArray(entry.candidates)
    .filter((candidate) => hasKnownValue(candidate?.value))
    .map((candidate, index) => ensureCandidateShape(
      candidate,
      `enum_${slugify(fieldKey || 'field')}_${slugify(entry.value || index)}_${index + 1}`,
      sourceToken,
    ));

  const hasAcceptedCandidateId = acceptedCandidateId
    ? candidates.some((candidate) => String(candidate.candidate_id || '').trim() === acceptedCandidateId)
    : false;

  if (!userDriven && selectedToken && acceptedCandidateId && !hasAcceptedCandidateId) {
    candidates.push(buildSyntheticSelectedCandidate({
      candidateId: acceptedCandidateId,
      value: entry.value,
      confidence: selectedConfidence,
      sourceToken,
      sourceTimestamp: entry.source_timestamp,
      quote: fallbackQuote,
    }));
  }

  if (!userDriven && selectedToken && !candidates.some((candidate) => valueToken(candidate.value) === selectedToken)) {
    candidates.push(buildSyntheticSelectedCandidate({
      candidateId: `enum_${slugify(fieldKey || 'field')}_${slugify(entry.value || 'value')}_selected`,
      value: entry.value,
      confidence: selectedConfidence,
      sourceToken,
      sourceTimestamp: entry.source_timestamp,
      quote: fallbackQuote,
    }));
  }

  candidates = sortCandidatesByScore(candidates);
  entry.candidates = candidates;

  if (userDriven) {
    if (hasKnownValue(entry.value)) {
      entry.confidence = clamp01(entry.confidence, selectedConfidence);
      entry.color = confidenceColor(entry.confidence, entry.needs_review ? ['pending_ai'] : []);
    }
    return;
  }

  const acceptedId = String(entry.accepted_candidate_id || '').trim();
  const acceptedCandidate = acceptedId
    ? candidates.find((candidate) => String(candidate.candidate_id || '').trim() === acceptedId)
    : null;
  const selectedCandidate = acceptedCandidate || candidates[0] || null;
  if (!selectedCandidate || !hasKnownValue(selectedCandidate.value)) return;

  entry.value = String(selectedCandidate.value);
  entry.confidence = clamp01(selectedCandidate.score, selectedConfidence);
  const candidateSource = candidateSourceToken(selectedCandidate, sourceToken);
  if (candidateSource) {
    entry.source = candidateSource;
  }
  entry.color = confidenceColor(entry.confidence, entry.needs_review ? ['pending_ai'] : []);
}

function isSharedLanePending(state, basePending = false) {
  const laneStatus = String(state?.ai_confirm_shared_status || '').trim().toLowerCase();
  const userOverride = Boolean(state?.user_override_ai_shared);
  // Shared lane remains pending until explicitly AI-confirmed; user-accept is independent.
  if (userOverride) return false;
  if (laneStatus) return laneStatus !== 'confirmed';
  return Boolean(basePending);
}

function toSpecDbCandidate(row, fallbackId) {
  const candidateId = String(row?.candidate_id || fallbackId || '').trim()
    || `${fallbackId || 'specdb_candidate'}`;
  const productId = String(row?.product_id || '').trim();
  return {
    candidate_id: candidateId,
    value: row?.value ?? null,
    score: row?.score ?? 0,
    source_id: 'specdb',
    source: row?.source_host
      ? `${row.source_host}${productId ? ` (${productId})` : ''}`
      : `SpecDb${productId ? ` (${productId})` : ''}`,
    tier: row?.source_tier ?? null,
    method: row?.source_method || 'specdb_lookup',
    evidence: {
      url: row?.evidence_url || row?.source_url || '',
      snippet_id: row?.snippet_id || '',
      snippet_hash: row?.snippet_hash || '',
      quote: row?.quote || '',
      snippet_text: row?.snippet_text || '',
      source_id: 'specdb',
    },
  };
}

function appendAllSpecDbCandidates(target, rows, fallbackPrefix) {
  const existingIds = new Set(target.map((c) => String(c?.candidate_id || '')));
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const candidate = toSpecDbCandidate(row, `${fallbackPrefix}_${i}`);
    if (candidate.value == null || candidate.value === '') continue;
    if (existingIds.has(candidate.candidate_id)) continue;
    existingIds.add(candidate.candidate_id);
    target.push(candidate);
  }
}

function hasActionableCandidate(candidates) {
  return toArray(candidates).some((candidate) => (
    !candidate?.is_synthetic_selected
    && hasKnownValue(candidate?.value)
    && String(candidate?.candidate_id || '').trim().length > 0
  ));
}

function shouldIncludeEnumValueEntry(entry, { requireLinkedPendingPipeline = false } = {}) {
  if (!isObject(entry)) return false;
  if (!requireLinkedPendingPipeline) return true;
  const isPipeline = normalizeSourceToken(entry.source) === 'pipeline';
  const isPending = Boolean(entry.needs_review) && hasActionableCandidate(entry.candidates);
  if (!isPipeline || !isPending) return true;
  const linkedCount = Array.isArray(entry.linked_products) ? entry.linked_products.length : 0;
  return linkedCount > 0;
}

function buildCandidateReviewLookup(reviewRows) {
  const exact = new Map();
  for (const row of toArray(reviewRows)) {
    const candidateId = String(row?.candidate_id || '').trim();
    if (!candidateId) continue;
    exact.set(candidateId, row);
  }
  return { exact };
}

function getCandidateReviewRow(lookup, candidateId) {
  if (!lookup) return null;
  const cid = String(candidateId || '').trim();
  if (!cid) return null;
  if (lookup.exact.has(cid)) return lookup.exact.get(cid) || null;
  return null;
}

function normalizeCandidateSharedReviewStatus(candidate, reviewRow = null) {
  if (candidate?.is_synthetic_selected) return 'accepted';
  if (reviewRow) {
    const aiStatus = normalizeToken(reviewRow.ai_review_status);
    const aiReason = normalizeToken(reviewRow.ai_reason);
    // Shared-lane accept is independent from AI confirm.
    // Legacy rows with ai_reason=shared_accept (or human_accepted) must remain pending
    // so AI confirm buttons stay candidate-scoped and independent.
    if (
      (Number(reviewRow.human_accepted) === 1 || aiReason === 'shared_accept')
      && aiStatus === 'accepted'
    ) {
      return 'pending';
    }
    if (aiStatus === 'accepted') return 'accepted';
    if (aiStatus === 'rejected') return 'rejected';
    return 'pending';
  }
  const sourceToken = candidateSourceToken(candidate, '');
  if (
    sourceToken === 'reference'
    || sourceToken === 'known_values'
    || sourceToken === 'component_db'
    || sourceToken === 'manual'
    || sourceToken === 'user'
  ) {
    return 'accepted';
  }
  return 'pending';
}

function annotateCandidateSharedReviews(candidates, reviewRows = []) {
  const lookup = buildCandidateReviewLookup(reviewRows);
  for (const candidate of toArray(candidates)) {
    const candidateId = String(candidate?.candidate_id || '').trim();
    const reviewRow = candidateId ? getCandidateReviewRow(lookup, candidateId) : null;
    candidate.shared_review_status = normalizeCandidateSharedReviewStatus(candidate, reviewRow);
    candidate.human_accepted = Number(reviewRow?.human_accepted || 0) === 1;
  }
}

function reviewStatusToken(reviewItem) {
  return normalizeToken(reviewItem?.status);
}

function isReviewItemCandidateVisible(reviewItem) {
  const status = reviewStatusToken(reviewItem);
  // Keep historical reviewed rows (confirmed/accepted) as candidate evidence.
  // Only explicitly dismissed/ignored rows are hidden from candidate hydration.
  if (!status) return true;
  if (status === 'dismissed' || status === 'ignored' || status === 'rejected') return false;
  return true;
}

async function safeReadJson(fp) {
  try { return JSON.parse(await fs.readFile(fp, 'utf8')); } catch { return null; }
}

async function listJsonFiles(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter(e => e.isFile() && e.name.endsWith('.json')).map(e => e.name).sort();
  } catch { return []; }
}

// ── Field Rules Metadata Resolution ──────────────────────────────────

export function resolvePropertyFieldMeta(propertyKey, fieldRules) {
  if (!propertyKey || propertyKey.startsWith('__')) return null;
  const fields = fieldRules?.rules?.fields ?? fieldRules?.fields ?? {};
  const rule = fields[propertyKey];
  if (!rule) return null;

  const variance_policy = rule.variance_policy ?? null;
  const constraints = Array.isArray(rule.constraints) ? rule.constraints : [];

  let enum_values = null;
  let enum_policy = null;
  if (rule.enum && typeof rule.enum === 'object') {
    enum_policy = rule.enum.policy ?? null;
    const source = String(rule.enum.source || '');
    if (source.startsWith('data_lists.')) {
      const listKey = source.slice('data_lists.'.length);
      const enums = fieldRules?.knownValues?.enums ?? {};
      const entry = enums[listKey];
      if (entry) {
        const vals = Array.isArray(entry.values) ? entry.values : (Array.isArray(entry) ? entry : []);
        enum_values = vals
          .map(v => typeof v === 'object' ? String(v.canonical ?? v.value ?? '') : String(v))
          .filter(Boolean);
      }
    }
  }

  return { variance_policy, constraints, enum_values, enum_policy };
}

// ── Layout ──────────────────────────────────────────────────────────

export async function buildComponentReviewLayout({ config = {}, category, specDb = null }) {
  if (!specDb) {
    return buildComponentReviewLayoutLegacy({ config, category });
  }
  const typeRows = specDb.getComponentTypeList();
  const componentTypes = [...new Set(
    toArray(typeRows)
      .map((row) => String(row?.component_type || '').trim())
      .filter(Boolean)
  )];
  const payloads = await Promise.all(componentTypes.map(async (componentType) => {
    const payload = await buildComponentReviewPayloadsSpecDb({ config, category, componentType, specDb });
    return {
      type: componentType,
      property_columns: payload?.property_columns || specDb.getPropertyColumnsForType(componentType),
      item_count: Array.isArray(payload?.items) ? payload.items.length : 0,
    };
  }));
  const types = payloads;
  return { category, types };
}

async function buildComponentReviewLayoutLegacy({ config = {}, category }) {
  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  const dbDir = path.join(helperRoot, category, '_generated', 'component_db');
  const files = await listJsonFiles(dbDir);

  const types = [];
  for (const f of files) {
    const data = await safeReadJson(path.join(dbDir, f));
    if (!data?.component_type || !Array.isArray(data.items)) continue;

    // Collect all property keys across items
    const propKeys = new Set();
    for (const item of data.items) {
      if (isObject(item.properties)) {
        for (const k of Object.keys(item.properties)) {
          if (!k.startsWith('__')) propKeys.add(k);
        }
      }
    }

    types.push({
      type: data.component_type,
      property_columns: [...propKeys].sort(),
      item_count: data.items.length,
    });
  }

  return { category, types };
}

// ── Component Payloads ──────────────────────────────────────────────

export async function buildComponentReviewPayloads({ config = {}, category, componentType, specDb = null, fieldRules = null, fieldOrderOverride = null }) {
  let result;
  if (!specDb) {
    result = await buildComponentReviewPayloadsLegacy({ config, category, componentType, specDb });
  } else {
    result = await buildComponentReviewPayloadsSpecDb({ config, category, componentType, specDb, fieldRules });
  }
  if (Array.isArray(fieldOrderOverride) && fieldOrderOverride.length > 0 && Array.isArray(result?.property_columns)) {
    const orderIndex = new Map(fieldOrderOverride.map((k, i) => [k, i]));
    result.property_columns = [...result.property_columns].sort((a, b) => {
      const ai = orderIndex.has(a) ? orderIndex.get(a) : Number.MAX_SAFE_INTEGER;
      const bi = orderIndex.has(b) ? orderIndex.get(b) : Number.MAX_SAFE_INTEGER;
      return ai - bi;
    });
  }
  return result;
}

// ── SpecDb-primary component payloads ────────────────────────────────

async function buildComponentReviewPayloadsSpecDb({ config = {}, category, componentType, specDb, fieldRules = null }) {
  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');

  let allComponents = specDb.getAllComponentsForType(componentType);

  // Property columns from SpecDb
  const propertyColumns = specDb.getPropertyColumnsForType(componentType);

  // Still load pipeline component_review.json (kept for Phase 2 migration)
  const reviewPath = path.join(helperRoot, category, '_suggestions', 'component_review.json');
  const reviewDoc = await safeReadJson(reviewPath);
  const reviewItems = Array.isArray(reviewDoc?.items) ? reviewDoc.items : [];

  // Immutable reference baseline for this component type from component DB.
  const refDbByIdentity = new Map();
  const refDbByName = new Map();
  try {
    const dbDir = path.join(helperRoot, category, '_generated', 'component_db');
    const dbFiles = await listJsonFiles(dbDir);
    for (const fileName of dbFiles) {
      const dbData = await safeReadJson(path.join(dbDir, fileName));
      if (!dbData || dbData.component_type !== componentType) continue;
      for (const item of toArray(dbData.items)) {
        const name = String(item?.name || '').trim();
        if (!name) continue;
        const maker = String(item?.maker || '').trim();
        const identityKey = `${name.toLowerCase()}::${maker.toLowerCase()}`;
        refDbByIdentity.set(identityKey, item);
        if (!refDbByName.has(name.toLowerCase())) {
          refDbByName.set(name.toLowerCase(), item);
        }
      }
      break;
    }
  } catch {
    // Best-effort reference baseline only.
  }

  // Index review items by component name (case-insensitive)
  const dbNameLower = new Map();
  for (const comp of allComponents) {
    dbNameLower.set((comp.identity.canonical_name || '').toLowerCase(), comp.identity.canonical_name);
  }
  const reviewByComponent = new Map();
  for (const ri of reviewItems) {
    if (!isReviewItemCandidateVisible(ri)) continue;
    if (ri.component_type !== componentType) continue;
    let dbName = null;
    if (ri.matched_component) {
      const matched = String(ri.matched_component || '').trim();
      dbName = dbNameLower.get(matched.toLowerCase()) || matched;
    } else {
      const rawQuery = String(ri.raw_query || '').trim();
      dbName = dbNameLower.get(rawQuery.toLowerCase()) || rawQuery || null;
    }
    if (!dbName) continue;
    const componentKey = String(dbName).trim().toLowerCase();
    if (!componentKey) continue;
    if (!reviewByComponent.has(componentKey)) reviewByComponent.set(componentKey, []);
    reviewByComponent.get(componentKey).push(ri);
  }

  // Include unresolved component names seen in item field state and/or review queue.
  const existingNames = new Set(
    allComponents
      .map((c) => String(c?.identity?.canonical_name || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const unresolvedNames = new Set();

  for (const ri of reviewItems) {
    if (!isReviewItemCandidateVisible(ri)) continue;
    if (ri.component_type !== componentType) continue;
    const hasMatchedComponent = Boolean(String(ri.matched_component || '').trim());
    const matchType = String(ri.match_type || '').trim().toLowerCase();
    if (hasMatchedComponent || (matchType && matchType !== 'new_component')) continue;
    const rawQuery = String(ri.raw_query || '').trim();
    if (!rawQuery) continue;
    if (!existingNames.has(rawQuery.toLowerCase())) unresolvedNames.add(rawQuery);
  }

  try {
    const distinctValues = specDb.getDistinctItemFieldValues(componentType);
    for (const row of distinctValues) {
      const value = String(row?.value || '').trim();
      if (!value) continue;
      if (!existingNames.has(value.toLowerCase())) unresolvedNames.add(value);
    }
  } catch {
    // Best-effort only
  }

  let unresolvedInserted = false;
  for (const unresolvedName of unresolvedNames) {
    const lower = unresolvedName.toLowerCase();
    if (existingNames.has(lower)) continue;
    specDb.upsertComponentIdentity({
      componentType,
      canonicalName: unresolvedName,
      maker: '',
      links: [],
      source: 'pipeline',
    });
    unresolvedInserted = true;
    existingNames.add(lower);
  }
  if (unresolvedInserted) {
    allComponents = specDb.getAllComponentsForType(componentType);
  }
  if (!allComponents.length) {
    return { category, componentType, items: [], metrics: { total: 0, avg_confidence: 0, flags: 0 } };
  }

  const propertyTemplateByKey = new Map();
  for (const comp of allComponents) {
    for (const row of toArray(comp?.properties)) {
      const key = String(row?.property_key || '').trim();
      if (!key || propertyTemplateByKey.has(key)) continue;
      let constraints = [];
      if (typeof row?.constraints === 'string' && row.constraints.trim()) {
        try {
          const parsed = JSON.parse(row.constraints);
          constraints = Array.isArray(parsed) ? parsed : [];
        } catch {
          constraints = [];
        }
      }
      propertyTemplateByKey.set(key, {
        variance_policy: row?.variance_policy ?? null,
        constraints,
      });
    }
  }
  const makerVariantsByName = new Map();
  for (const comp of allComponents) {
    const nameKey = String(comp?.identity?.canonical_name || '').trim().toLowerCase();
    if (!nameKey) continue;
    if (!makerVariantsByName.has(nameKey)) makerVariantsByName.set(nameKey, new Set());
    makerVariantsByName.get(nameKey).add(normalizeToken(comp?.identity?.maker || ''));
  }

  const items = [];

  for (const comp of allComponents) {
    let { identity, aliases: aliasRows, properties: propRows } = comp;
    const itemName = identity.canonical_name;
    const itemMaker = identity.maker || '';
    if (identity?.id) {
      const propByKey = new Map(
        toArray(propRows).map((row) => [String(row?.property_key || '').trim(), row]),
      );
      let insertedSlots = false;
      for (const propertyKey of propertyColumns) {
        const key = String(propertyKey || '').trim();
        if (!key || propByKey.has(key)) continue;
        const template = propertyTemplateByKey.get(key) || null;
        const fieldMeta = resolvePropertyFieldMeta(key, fieldRules);
        specDb.upsertComponentValue({
          componentType,
          componentName: itemName,
          componentMaker: itemMaker,
          propertyKey: key,
          value: null,
          confidence: 0,
          variancePolicy: template?.variance_policy ?? null,
          source: 'pipeline',
          acceptedCandidateId: null,
          needsReview: true,
          overridden: false,
          constraints: fieldMeta?.constraints?.length > 0 ? fieldMeta.constraints : (template?.constraints || []),
        });
        insertedSlots = true;
      }
      if (insertedSlots) {
        propRows = specDb.getComponentValuesWithMaker(componentType, itemName, itemMaker) || [];
        const componentIdentifier = buildComponentIdentifier(componentType, itemName, itemMaker);
        for (const cv of propRows) {
          if (!cv?.id) continue;
          const existing = specDb.db.prepare(
            "SELECT id FROM key_review_state WHERE category = ? AND target_kind = 'component_key' AND component_value_id = ?"
          ).get(specDb.category, cv.id);
          if (existing) continue;
          specDb.upsertKeyReviewState({
            category: specDb.category,
            targetKind: 'component_key',
            componentIdentifier,
            propertyKey: cv.property_key,
            fieldKey: cv.property_key,
            componentValueId: cv.id,
            componentIdentityId: cv.component_identity_id ?? identity.id,
            aiConfirmSharedStatus: cv.needs_review ? 'pending' : 'not_run',
            userAcceptSharedStatus: cv.overridden ? 'accepted' : null,
          });
        }
      }
    }
    const itemAliases = aliasRows
      .filter(a => a.alias !== itemName) // exclude canonical_name alias
      .map(a => a.alias);
    const aliasesOverridden = Boolean(identity.aliases_overridden);
    const reviewStatus = identity.review_status || 'pending';

    // Build property map from DB rows
    const propMap = {};
    for (const row of propRows) {
      propMap[row.property_key] = row;
    }
    const refDbIdentityKey = `${String(itemName || '').toLowerCase()}::${String(itemMaker || '').toLowerCase()}`;
    const refDbItem = refDbByIdentity.get(refDbIdentityKey)
      || refDbByName.get(String(itemName || '').toLowerCase())
      || null;
    const componentIdentifier = buildComponentIdentifier(componentType, itemName, itemMaker);
    let nameKeyState = null;
    let makerKeyState = null;
    let componentKeyStateByProperty = new Map();
    try {
      const keyStates = specDb.getKeyReviewStatesForComponent(componentIdentifier) || [];
      const byProperty = new Map(keyStates.map((state) => [String(state?.property_key || ''), state]));
      componentKeyStateByProperty = byProperty;
      nameKeyState = byProperty.get('__name') || null;
      makerKeyState = byProperty.get('__maker') || null;
    } catch {
      nameKeyState = null;
      makerKeyState = null;
      componentKeyStateByProperty = new Map();
    }

    // Build ref_* candidate helper for component DB reference data
    const buildRefCandidate = (id, rawValue, dbGeneratedAt) => rawValue != null && rawValue !== '' ? [{
      candidate_id: id,
      value: rawValue,
      score: 1.0,
      source_id: 'reference',
      source: 'Reference',
      tier: null,
      method: 'reference_data',
      evidence: {
        url: '',
        retrieved_at: dbGeneratedAt || '',
        snippet_id: '',
        snippet_hash: '',
        quote: `From reference database`,
        quote_span: null,
        snippet_text: `From reference database`,
        source_id: 'reference',
      },
    }] : [];

    // Name tracked state — derive from DB source
    const nameSource = identity.source || 'component_db';
    const nameIsOverridden = nameSource === 'user';
    const nameIsPipeline = nameSource === 'pipeline';
    const nameBaseConfidence = nameIsPipeline ? 0.6 : 1.0;
    const nameNeedsReview = isSharedLanePending(nameKeyState, nameIsPipeline);
    const refNameValue = String(refDbItem?.name || '').trim();
    const nameRefCandidates = refNameValue
      ? buildRefCandidate(
        buildReferenceComponentCandidateId({
          componentType,
          componentName: itemName,
          componentMaker: itemMaker,
          propertyKey: '__name',
          value: refNameValue,
        }),
        refNameValue,
        identity.created_at
      )
      : [];
    const name_tracked = {
      selected: {
        value: nameKeyState?.selected_value ?? itemName,
        confidence: nameBaseConfidence,
        status: nameIsOverridden ? 'override' : (nameIsPipeline ? 'pipeline' : 'reference'),
        color: confidenceColor(nameBaseConfidence, nameNeedsReview ? ['new_component'] : []),
      },
      needs_review: nameNeedsReview,
      reason_codes: nameIsOverridden ? ['manual_override'] : (nameNeedsReview ? ['new_component'] : []),
      source: nameIsOverridden ? 'user' : (nameIsPipeline ? 'pipeline' : 'reference'),
      source_timestamp: null,
      variance_policy: null,
      constraints: [],
      overridden: nameIsOverridden,
      candidate_count: nameRefCandidates.length,
      candidates: nameRefCandidates,
      accepted_candidate_id: String(nameKeyState?.selected_candidate_id || '').trim() || null,
    };

    // Maker tracked state
    const makerIsOverridden = nameSource === 'user'; // identity source covers both name+maker
    const makerNeedsReview = isSharedLanePending(makerKeyState, !itemMaker && !makerIsOverridden);
    const refMakerValue = String(refDbItem?.maker || '').trim();
    const makerRefCandidates = refMakerValue ? buildRefCandidate(
      buildReferenceComponentCandidateId({
        componentType,
        componentName: itemName,
        componentMaker: itemMaker,
        propertyKey: '__maker',
        value: refMakerValue,
      }),
      refMakerValue,
      identity.created_at
    ) : [];
    const maker_tracked = {
      selected: {
        value: makerKeyState?.selected_value ?? itemMaker,
        confidence: itemMaker ? 1.0 : 0,
        status: makerIsOverridden ? 'override' : (itemMaker ? 'reference' : 'unknown'),
        color: confidenceColor(itemMaker ? 1.0 : 0, []),
      },
      needs_review: makerNeedsReview,
      reason_codes: makerIsOverridden ? ['manual_override'] : (makerNeedsReview ? ['new_component'] : []),
      source: makerIsOverridden ? 'user' : (itemMaker ? 'reference' : 'unknown'),
      source_timestamp: null,
      variance_policy: null,
      constraints: [],
      overridden: makerIsOverridden,
      candidate_count: makerRefCandidates.length,
      candidates: makerRefCandidates,
      accepted_candidate_id: String(makerKeyState?.selected_candidate_id || '').trim() || null,
    };

    // Links tracked state
    const effectiveLinks = toArray(identity.links ? JSON.parse(identity.links) : []);
    const links_tracked = effectiveLinks.map((url) => ({
      selected: { value: url, confidence: 1.0, status: 'reference', color: confidenceColor(1.0, []) },
      needs_review: false,
      reason_codes: [],
      source: 'reference',
      source_timestamp: null,
      overridden: false,
    }));

    const reviewItemsForName = reviewByComponent.get(String(itemName || '').toLowerCase()) || [];
    let itemReviewItems = [];
    let itemReviewAttribution = buildPipelineAttributionContext([]);

    // Build properties
    const properties = {};
    let itemPropCount = 0;
    let itemFlags = 0;

    for (const key of propertyColumns) {
      const dbRow = propMap[key];
      const propertyKeyState = componentKeyStateByProperty.get(key) || null;
      const rawValue = propertyKeyState?.selected_value ?? dbRow?.value ?? null;
      const hasRawValue = rawValue !== null && rawValue !== '' && rawValue !== '-';
      const isOverridden = Boolean(dbRow?.overridden);
      const source = dbRow?.source || (hasRawValue ? 'component_db' : 'unknown');
      const confidence = hasRawValue || isOverridden ? (dbRow?.confidence ?? 1.0) : 0;
      const variance = dbRow?.variance_policy || null;
      const meta = resolvePropertyFieldMeta(key, fieldRules);
      const fieldConstraints = meta?.constraints?.length > 0
        ? meta.constraints
        : (dbRow?.constraints ? JSON.parse(dbRow.constraints) : []);
      const baseNeedsReview = Boolean(dbRow?.needs_review) || (!hasRawValue && !isOverridden);
      const needsReview = isSharedLanePending(propertyKeyState, baseNeedsReview);
      const laneNeedsReview = propertyKeyState ? isSharedLanePending(propertyKeyState, false) : false;
      if (needsReview) itemFlags++;

      const reasonCodes = [];
      if (laneNeedsReview) reasonCodes.push('pending_ai');
      if (!hasRawValue && !isOverridden) reasonCodes.push('missing_value');
      if (isOverridden) reasonCodes.push('manual_override');
      for (const c of fieldConstraints) reasonCodes.push(`constraint:${c}`);

      properties[key] = {
        slot_id: dbRow?.id ?? null,
        selected: {
          value: rawValue,
          confidence,
          status: isOverridden ? 'override' : (source === 'user' ? 'override' : (hasRawValue ? 'reference' : 'unknown')),
          color: confidenceColor(confidence, reasonCodes),
        },
        needs_review: needsReview,
        reason_codes: reasonCodes,
        source: isOverridden ? 'user' : (source === 'component_db' ? 'reference' : source),
        source_timestamp: null,
        variance_policy: variance,
        constraints: fieldConstraints,
        overridden: isOverridden,
        candidate_count: 0,
        candidates: [],
        accepted_candidate_id: String(propertyKeyState?.selected_candidate_id || '').trim()
          || dbRow?.accepted_candidate_id
          || null,
        enum_values: meta?.enum_values ?? null,
        enum_policy: meta?.enum_policy ?? null,
      };

      itemPropCount++;
    }

    // Property candidates are sourced from linked-product candidate rows (SpecDb).
    // Pipeline review rows are used only as fallback when there are no linked products.

    // SpecDb enrichment: product-level candidates from SQLite
    const laneSlug = componentLaneSlug(itemName, itemMaker);
    let linkedProducts = [];
    let hasDbLinkedProducts = false;
    try {
      const linkRows = specDb.getProductsForComponent(componentType, itemName, itemMaker);
      const productIds = linkRows.map(r => r.product_id);
      hasDbLinkedProducts = productIds.length > 0;
      linkedProducts = linkRows.map(r => ({
        product_id: r.product_id,
        field_key: r.field_key,
        match_type: r.match_type || 'exact',
        match_score: r.match_score ?? null,
      }));

      if (productIds.length > 0) {
        const linkFieldKey = linkRows[0]?.field_key || componentType;
        const brandFieldKey = `${componentType}_brand`;

        // Name candidates from SpecDb
        const nameCandRows = specDb.getCandidatesForComponentProperty(componentType, itemName, itemMaker, linkFieldKey);
        if (nameCandRows.length > 0) {
          appendAllSpecDbCandidates(
            name_tracked.candidates,
            nameCandRows,
            `specdb_${componentType}_${laneSlug}_name`
          );
          name_tracked.candidate_count = name_tracked.candidates.length;
        }

        // Maker candidates from SpecDb
        const makerCandRows = specDb.getCandidatesForComponentProperty(componentType, itemName, itemMaker, brandFieldKey);
        if (makerCandRows.length > 0) {
          appendAllSpecDbCandidates(
            maker_tracked.candidates,
            makerCandRows,
            `specdb_${componentType}_${laneSlug}_maker`
          );
          maker_tracked.candidate_count = maker_tracked.candidates.length;
        }

        // Property candidates from SpecDb
        for (const key of propertyColumns) {
          const prop = properties[key];
          if (!prop) continue;
          const propCandRows = specDb.getCandidatesForComponentProperty(componentType, itemName, itemMaker, key);
          if (propCandRows.length > 0) {
            appendAllSpecDbCandidates(
              prop.candidates,
              propCandRows,
              `specdb_${componentType}_${laneSlug}_${key}`
            );
            prop.candidate_count = prop.candidates.length;
          }
        }

        // Variance evaluation
        for (const key of propertyColumns) {
          const prop = properties[key];
          if (!prop) continue;
          const policy = prop.variance_policy;
          if (!policy || policy === 'override_allowed') continue;
          const dbValue = prop.selected?.value;
          if (dbValue == null) continue;
          const fieldStates = specDb.getItemFieldStateForProducts(productIds, [key]);
          if (!fieldStates.length) continue;
          const entries = fieldStates.map(s => ({ product_id: s.product_id, value: s.value }));
          const batch = evaluateVarianceBatch(policy, dbValue, entries);
          if (batch.summary.violations > 0) {
            if (!prop.reason_codes.includes('variance_violation')) {
              prop.reason_codes.push('variance_violation');
            }
            prop.needs_review = true;
            prop.variance_violations = {
              count: batch.summary.violations,
              total_products: batch.summary.total,
              products: batch.results
                .filter(r => !r.compliant)
                .slice(0, 5)
                .map(r => ({ product_id: r.product_id, value: r.value, reason: r.reason, details: r.details })),
            };
            itemFlags++;
          }
        }
      }
    } catch (_specDbErr) {
      // SpecDb enrichment is best-effort
    }
    if (!hasDbLinkedProducts && reviewItemsForName.length > 0) {
      const makerVariants = makerVariantsByName.get(String(itemName || '').trim().toLowerCase()) || null;
      const allowMakerlessForNamedLane = Boolean(String(itemMaker || '').trim()) && Number(makerVariants?.size || 0) <= 1;
      itemReviewItems = reviewItemsForName.filter((ri) => reviewItemMatchesMakerLane(ri, {
        componentType,
        maker: itemMaker,
        allowMakerlessForNamedLane,
      }));
      itemReviewAttribution = buildPipelineAttributionContext(itemReviewItems);
      if (itemReviewItems.length > 0) {
        const existingNameCandidateIds = new Set(name_tracked.candidates.map((candidate) => String(candidate?.candidate_id || '').trim()));
        for (const ri of itemReviewItems) {
          const val = (ri.raw_query || '').trim();
          if (!val) continue;
          const candidateId = buildComponentReviewSyntheticCandidateId({
            productId: ri.product_id || '',
            fieldKey: '__name',
            reviewId: ri.review_id || '',
            value: val,
          });
          if (existingNameCandidateIds.has(candidateId)) continue;
          existingNameCandidateIds.add(candidateId);
          const productLabel = String(ri.product_id || '').trim() || 'unknown_product';
          name_tracked.candidates.push(buildPipelineReviewCandidate({
            candidateId,
            value: val,
            reviewItem: ri,
            method: ri.match_type || 'component_review',
            quote: `Extracted from ${productLabel}${ri.review_id ? ` (${ri.review_id})` : ''}`,
            snippetText: `Component ${ri.match_type === 'fuzzy_flagged' ? 'fuzzy matched' : 'not found in DB'}`,
            attributionContext: itemReviewAttribution,
          }));
        }
        name_tracked.candidate_count = name_tracked.candidates.length;

        const brandKey = `${componentType}_brand`;
        const existingMakerCandidateIds = new Set(maker_tracked.candidates.map((candidate) => String(candidate?.candidate_id || '').trim()));
        for (const ri of itemReviewItems) {
          const attrs = parseReviewItemAttributes(ri);
          const makerFromPipeline = attrs[brandKey] || attrs.ai_suggested_maker || ri.ai_suggested_maker;
          if (!makerFromPipeline) continue;
          for (const val of splitCandidateParts(makerFromPipeline)) {
            const candidateId = buildComponentReviewSyntheticCandidateId({
              productId: ri.product_id || '',
              fieldKey: '__maker',
              reviewId: ri.review_id || '',
              value: val,
            });
            if (existingMakerCandidateIds.has(candidateId)) continue;
            existingMakerCandidateIds.add(candidateId);
            const productLabel = String(ri.product_id || '').trim() || 'unknown_product';
            maker_tracked.candidates.push(buildPipelineReviewCandidate({
              candidateId,
              value: val,
              reviewItem: ri,
              method: 'product_extraction',
              quote: `Extracted ${brandKey}="${val}" from ${productLabel}${ri.review_id ? ` (${ri.review_id})` : ''}`,
              snippetText: 'Pipeline extraction from product runs',
              attributionContext: itemReviewAttribution,
            }));
          }
        }
        maker_tracked.candidate_count = maker_tracked.candidates.length;
      }
    }
    if (linkedProducts.length === 0 && itemReviewAttribution.productIds.length > 0) {
      linkedProducts = itemReviewAttribution.productIds.map((productId) => ({
        product_id: productId,
        field_key: componentType,
        match_type: 'pipeline_review',
        match_score: null,
      }));
    }
    if (!hasDbLinkedProducts && itemReviewItems.length > 0) {
      for (const key of propertyColumns) {
        const prop = properties[key];
        if (!prop) continue;
        const existingPropCandidateIds = new Set(prop.candidates.map((candidate) => String(candidate?.candidate_id || '').trim()));
        for (const ri of itemReviewItems) {
          const attrs = parseReviewItemAttributes(ri);
          const pipelineVal = attrs[key];
          if (pipelineVal === undefined || pipelineVal === null || pipelineVal === '') continue;
          for (const valStr of splitCandidateParts(pipelineVal)) {
            const candidateId = buildComponentReviewSyntheticCandidateId({
              productId: ri.product_id || '',
              fieldKey: key,
              reviewId: ri.review_id || '',
              value: valStr,
            });
            if (existingPropCandidateIds.has(candidateId)) continue;
            existingPropCandidateIds.add(candidateId);
            const productLabel = String(ri.product_id || '').trim() || 'unknown_product';
            prop.candidates.push(buildPipelineReviewCandidate({
              candidateId,
              value: valStr,
              reviewItem: ri,
              method: 'product_extraction',
              quote: `Extracted ${key}="${valStr}" from ${productLabel}${ri.review_id ? ` (${ri.review_id})` : ''}`,
              snippetText: 'Pipeline extraction from product runs',
              attributionContext: itemReviewAttribution,
            }));
          }
        }
        prop.candidate_count = prop.candidates.length;
      }
    }

    ensureTrackedStateCandidateInvariant(name_tracked, {
      fallbackCandidateId: `component_${slugify(componentType)}_${laneSlug}_name`,
      fallbackQuote: `Selected ${componentType} name retained for authoritative review`,
    });
    annotateCandidateSharedReviews(name_tracked.candidates, []);
    ensureTrackedStateCandidateInvariant(maker_tracked, {
      fallbackCandidateId: `component_${slugify(componentType)}_${laneSlug}_maker`,
      fallbackQuote: `Selected ${componentType} maker retained for authoritative review`,
    });
    annotateCandidateSharedReviews(maker_tracked.candidates, []);
    for (const key of propertyColumns) {
      const prop = properties[key];
      if (!prop) continue;
      ensureTrackedStateCandidateInvariant(prop, {
        fallbackCandidateId: `component_${slugify(componentType)}_${laneSlug}_${slugify(key)}`,
        fallbackQuote: `Selected ${key} retained for authoritative review`,
      });
      const slotId = Number(prop?.slot_id);
      const reviewRows = Number.isFinite(slotId) && slotId > 0
        ? (specDb.getReviewsForContext('component', String(slotId)) || [])
        : [];
      annotateCandidateSharedReviews(prop.candidates, reviewRows);
    }

    const confidenceValues = propertyColumns
      .map((key) => Number.parseFloat(String(properties[key]?.selected?.confidence ?? '')))
      .filter((value) => Number.isFinite(value));
    const avgConf = confidenceValues.length > 0
      ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
      : 0;
    const identitySource = String(identity?.source || '').trim();

    items.push({
      component_identity_id: identity.id ?? null,
      name: itemName,
      maker: itemMaker,
      aliases: itemAliases,
      aliases_overridden: aliasesOverridden,
      links: effectiveLinks,
      name_tracked,
      maker_tracked,
      links_tracked,
      properties,
      linked_products: linkedProducts,
      review_status: reviewStatus,
      discovery_source: identitySource,
      discovered: discoveredFromSource(identitySource),
      metrics: {
        confidence: Math.round(avgConf * 100) / 100,
        flags: itemFlags,
        property_count: itemPropCount,
      },
    });
  }

  const normalizedItems = enforceNonDiscoveredRows(items, category);
  const visibleItems = normalizedItems.filter((item) => {
    const linkedCount = Array.isArray(item.linked_products) ? item.linked_products.length : 0;
    if (isTestModeCategory(category) && item.discovered && linkedCount === 0) {
      return false;
    }
    const hasNamePending = Boolean(item.name_tracked?.needs_review) && hasActionableCandidate(item.name_tracked?.candidates);
    const hasMakerPending = Boolean(item.maker_tracked?.needs_review) && hasActionableCandidate(item.maker_tracked?.candidates);
    const hasPropertyPending = propertyColumns.some((key) => {
      const prop = item?.properties?.[key];
      return Boolean(prop?.needs_review) && hasActionableCandidate(prop?.candidates);
    });
    const hasCandidateEvidence = hasActionableCandidate(item?.name_tracked?.candidates)
      || hasActionableCandidate(item?.maker_tracked?.candidates)
      || propertyColumns.some((key) => hasActionableCandidate(item?.properties?.[key]?.candidates));
    const identitySources = [item?.name_tracked?.source, item?.maker_tracked?.source]
      .map((source) => String(source || '').trim().toLowerCase())
      .filter(Boolean);
    const hasStableIdentitySource = identitySources.some((source) => source !== 'pipeline' && source !== 'unknown');
    const hasStablePropertySource = propertyColumns.some((key) => {
      const source = String(item?.properties?.[key]?.source || '').trim().toLowerCase();
      const selectedValue = item?.properties?.[key]?.selected?.value;
      return source && source !== 'pipeline' && source !== 'unknown' && hasKnownValue(selectedValue);
    });
    return linkedCount > 0
      || hasNamePending
      || hasMakerPending
      || hasPropertyPending
      || hasCandidateEvidence
      || hasStableIdentitySource
      || hasStablePropertySource;
  });
  const finalItems = enforceNonDiscoveredRows(visibleItems, category);
  const visibleFlags = finalItems.reduce((sum, item) => sum + (item.metrics?.flags || 0), 0);
  const visibleAvgConfidence = finalItems.length > 0
    ? Math.round((finalItems.reduce((sum, item) => sum + (item.metrics?.confidence || 0), 0) / finalItems.length) * 100) / 100
    : 0;

  return {
    category,
    componentType,
    property_columns: propertyColumns,
    items: finalItems,
    metrics: {
      total: finalItems.length,
      avg_confidence: visibleAvgConfidence,
      flags: visibleFlags,
    },
  };
}

async function buildComponentReviewPayloadsLegacy({ config = {}, category, componentType, specDb = null }) {
  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  const dbDir = path.join(helperRoot, category, '_generated', 'component_db');
  const overrideDir = path.join(helperRoot, category, '_overrides', 'components');
  const files = await listJsonFiles(dbDir);

  let dbData = null;
  for (const f of files) {
    const data = await safeReadJson(path.join(dbDir, f));
    if (data?.component_type === componentType) { dbData = data; break; }
  }

  if (!dbData || !Array.isArray(dbData.items)) {
    return { category, componentType, items: [], metrics: { total: 0, avg_confidence: 0, flags: 0 } };
  }

  const dbGeneratedAt = dbData.generated_at || '';

  // Load overrides for this component type
  const overrides = {};
  const overrideFiles = await listJsonFiles(overrideDir);
  for (const of of overrideFiles) {
    if (of.startsWith(`${componentType}_`)) {
      const ovr = await safeReadJson(path.join(overrideDir, of));
      if (ovr?.name) overrides[ovr.name] = ovr;
    }
  }

  // Load identity observations for pipeline candidates on name/maker
  const identityPath = path.join(helperRoot, category, '_suggestions', 'component_identity.json');
  const identityDoc = await safeReadJson(identityPath);
  const identityObs = Array.isArray(identityDoc?.observations) ? identityDoc.observations : [];

  // Index identity observations by component_type + canonical_name
  const identityByComponent = new Map();
  for (const obs of identityObs) {
    if (obs.component_type !== componentType) continue;
    const name = (obs.canonical_name || '').trim();
    if (!name) continue;
    if (!identityByComponent.has(name)) identityByComponent.set(name, []);
    identityByComponent.get(name).push(obs);
  }

  // Load component_review.json for pipeline candidates (product_attributes)
  const reviewPath = path.join(helperRoot, category, '_suggestions', 'component_review.json');
  const reviewDoc = await safeReadJson(reviewPath);
  const reviewItems = Array.isArray(reviewDoc?.items) ? reviewDoc.items : [];

  // Index review items by component name (case-insensitive) for this component type
  // Includes both fuzzy_flagged (matched_component) and new_component (raw_query matches DB name)
  const dbNameLower = new Map(); // lowercase → actual DB name
  for (const dbItem of dbData.items) {
    dbNameLower.set((dbItem.name || '').toLowerCase(), dbItem.name);
  }
  const reviewByComponent = new Map(); // lowercase component name → review items[]
  for (const ri of reviewItems) {
    if (!isReviewItemCandidateVisible(ri)) continue;
    if (ri.component_type !== componentType) continue;
    // Match via matched_component (fuzzy_flagged) or raw_query (new_component matching DB name)
    let dbName = null;
    if (ri.matched_component) {
      const matched = String(ri.matched_component || '').trim();
      dbName = dbNameLower.get(matched.toLowerCase()) || matched;
    } else {
      const rawQuery = String(ri.raw_query || '').trim();
      dbName = dbNameLower.get(rawQuery.toLowerCase()) || rawQuery || null;
    }
    if (!dbName) continue;
    const componentKey = String(dbName).trim().toLowerCase();
    if (!componentKey) continue;
    if (!reviewByComponent.has(componentKey)) reviewByComponent.set(componentKey, []);
    reviewByComponent.get(componentKey).push(ri);
  }

  // Collect all property keys
  const allPropKeys = new Set();
  for (const item of dbData.items) {
    if (isObject(item.properties)) {
      for (const k of Object.keys(item.properties)) {
        if (!k.startsWith('__')) allPropKeys.add(k);
      }
    }
  }
  const propertyColumns = [...allPropKeys].sort();

  const items = [];

  for (const item of dbData.items) {
    const props = isObject(item.properties) ? item.properties : {};
    const variancePolicies = isObject(item.__variance_policies) ? item.__variance_policies : {};
    const constraints = isObject(item.__constraints) ? item.__constraints : {};
    const override = overrides[item.name] || null;

    // Identity overrides
    const nameOverride = override?.identity?.name;
    const makerOverride = override?.identity?.maker;
    const linksOverride = override?.identity?.links;
    const overrideTimestamps = isObject(override?.timestamps) ? override.timestamps : {};

    // Build tracked state for name
    const nameVal = nameOverride ?? item.name ?? '';
    const nameHasRaw = Boolean(item.name);
    const nameHasOverride = nameOverride !== undefined;
    // Generate reference candidate for name when value comes from component DB
    const nameRefCandidate = nameHasRaw ? [{
      candidate_id: buildReferenceComponentCandidateId({
        componentType,
        componentName: item.name,
        componentMaker: item.maker || '',
        propertyKey: '__name',
        value: item.name,
      }),
      value: item.name,
      score: 1.0,
      source_id: 'reference',
      source: 'Reference',
      tier: null,
      method: 'reference_data',
      evidence: {
        url: '',
        retrieved_at: dbGeneratedAt,
        snippet_id: '',
        snippet_hash: '',
        quote: `From reference database`,
        quote_span: null,
        snippet_text: `From reference database`,
        source_id: 'reference',
      },
    }] : [];

    const name_tracked = {
      selected: {
        value: nameVal,
        confidence: nameHasOverride ? 1.0 : nameHasRaw ? 1.0 : 0,
        status: nameHasOverride ? 'override' : nameHasRaw ? 'reference' : 'unknown',
        color: confidenceColor(nameHasOverride ? 1.0 : nameHasRaw ? 1.0 : 0, []),
      },
      needs_review: !nameHasRaw && !nameHasOverride,
      reason_codes: nameHasOverride ? ['manual_override'] : [],
      source: nameHasOverride ? 'user' : (nameHasRaw ? 'reference' : 'unknown'),
      source_timestamp: nameHasOverride ? (overrideTimestamps['__name'] || override?.updated_at || null) : null,
      variance_policy: null,
      constraints: [],
      overridden: nameHasOverride,
      candidate_count: nameRefCandidate.length,
      candidates: nameRefCandidate,
      accepted_candidate_id: null,
    };

    // Enrich name candidates with pipeline identity observations
    const nameObservations = identityByComponent.get(item.name) || [];
    if (nameObservations.length > 0) {
      const pipelineNameCandidate = {
        candidate_id: buildSyntheticComponentCandidateId({
          componentType,
          componentName: item.name,
          componentMaker: item.maker || '',
          propertyKey: '__name_identity',
          value: item.name,
        }),
        value: item.name,
        score: 1.0,
        source_id: 'pipeline',
        source: 'Pipeline (identity match)',
        tier: null,
        method: 'identity_observation',
        evidence: {
          url: '',
          retrieved_at: nameObservations[0].observed_at || '',
          snippet_id: '',
          snippet_hash: '',
          quote: `Matched ${nameObservations.length} time${nameObservations.length !== 1 ? 's' : ''} across products`,
          quote_span: null,
          snippet_text: `Resolved via ${nameObservations[0].match_type || 'exact'} match`,
          source_id: 'pipeline',
        },
      };
      // Avoid duplicating if reference candidate already present with same value
      if (!name_tracked.candidates.some((c) => c.value === pipelineNameCandidate.value && c.source_id === 'pipeline')) {
        name_tracked.candidates.push(pipelineNameCandidate);
        name_tracked.candidate_count = name_tracked.candidates.length;
      }
    }

    // Enrich name/maker candidates from component_review items (pipeline product extractions)
    // Keep one candidate per review item/source (no value-collapsing).
    const itemReviewItems = reviewByComponent.get(String(item.name || '').toLowerCase()) || [];
    const itemReviewAttribution = buildPipelineAttributionContext(itemReviewItems);
    if (itemReviewItems.length > 0) {
      const existingNameCandidateIds = new Set(name_tracked.candidates.map((candidate) => String(candidate?.candidate_id || '').trim()));
      for (const ri of itemReviewItems) {
        const val = (ri.raw_query || '').trim();
        if (!val) continue;
        const candidateId = buildComponentReviewSyntheticCandidateId({
          productId: ri.product_id || '',
          fieldKey: '__name',
          reviewId: ri.review_id || '',
          value: val,
        });
        if (existingNameCandidateIds.has(candidateId)) continue;
        existingNameCandidateIds.add(candidateId);
        const productLabel = String(ri.product_id || '').trim() || 'unknown_product';
        name_tracked.candidates.push(buildPipelineReviewCandidate({
          candidateId,
          value: val,
          reviewItem: ri,
          method: ri.match_type || 'component_review',
          quote: `Extracted from ${productLabel}${ri.review_id ? ` (${ri.review_id})` : ''}`,
          snippetText: `Component ${ri.match_type === 'fuzzy_flagged' ? 'fuzzy matched' : 'not found in DB'}`,
          attributionContext: itemReviewAttribution,
        }));
      }
      name_tracked.candidate_count = name_tracked.candidates.length;
    }

    // Build tracked state for maker
    const makerVal = makerOverride ?? item.maker ?? '';
    const makerHasRaw = Boolean(item.maker);
    const makerHasOverride = makerOverride !== undefined;
    // Generate reference candidate for maker when value comes from component DB
    const makerRefCandidate = makerHasRaw ? [{
      candidate_id: buildReferenceComponentCandidateId({
        componentType,
        componentName: item.name,
        componentMaker: item.maker || '',
        propertyKey: '__maker',
        value: item.maker,
      }),
      value: item.maker,
      score: 1.0,
      source_id: 'reference',
      source: 'Reference',
      tier: null,
      method: 'reference_data',
      evidence: {
        url: '',
        retrieved_at: dbGeneratedAt,
        snippet_id: '',
        snippet_hash: '',
        quote: `From reference database`,
        quote_span: null,
        snippet_text: `From reference database`,
        source_id: 'reference',
      },
    }] : [];

    const maker_tracked = {
      selected: {
        value: makerVal,
        confidence: makerHasOverride ? 1.0 : makerHasRaw ? 1.0 : 0,
        status: makerHasOverride ? 'override' : makerHasRaw ? 'reference' : 'unknown',
        color: confidenceColor(makerHasOverride ? 1.0 : makerHasRaw ? 1.0 : 0, []),
      },
      needs_review: !makerHasRaw && !makerHasOverride,
      reason_codes: makerHasOverride ? ['manual_override'] : [],
      source: makerHasOverride ? 'user' : (makerHasRaw ? 'reference' : 'unknown'),
      source_timestamp: makerHasOverride ? (overrideTimestamps['__maker'] || override?.updated_at || null) : null,
      variance_policy: null,
      constraints: [],
      overridden: makerHasOverride,
      candidate_count: makerRefCandidate.length,
      candidates: makerRefCandidate,
      accepted_candidate_id: null,
    };

    // Enrich maker candidates from pipeline product_attributes (e.g. sensor_brand, switch_brand)
    if (itemReviewItems.length > 0) {
      const brandKey = `${componentType}_brand`;
      const existingMakerCandidateIds = new Set(maker_tracked.candidates.map((candidate) => String(candidate?.candidate_id || '').trim()));
      for (const ri of itemReviewItems) {
        const attrs = isObject(ri.product_attributes) ? ri.product_attributes : {};
        const makerFromPipeline = attrs[brandKey] || attrs.ai_suggested_maker || ri.ai_suggested_maker;
        if (!makerFromPipeline) continue;
        for (const val of splitCandidateParts(makerFromPipeline)) {
          const candidateId = buildComponentReviewSyntheticCandidateId({
            productId: ri.product_id || '',
            fieldKey: '__maker',
            reviewId: ri.review_id || '',
            value: val,
          });
          if (existingMakerCandidateIds.has(candidateId)) continue;
          existingMakerCandidateIds.add(candidateId);
          const productLabel = String(ri.product_id || '').trim() || 'unknown_product';
          maker_tracked.candidates.push(buildPipelineReviewCandidate({
            candidateId,
            value: val,
            reviewItem: ri,
            method: 'product_extraction',
            quote: `Extracted ${brandKey}="${val}" from ${productLabel}${ri.review_id ? ` (${ri.review_id})` : ''}`,
            snippetText: 'Pipeline extraction from product runs',
            attributionContext: itemReviewAttribution,
          }));
        }
      }
      maker_tracked.candidate_count = maker_tracked.candidates.length;
    }

    // Build tracked state for links
    const effectiveLinks = linksOverride ?? toArray(item.links);
    const linksTimestamp = linksOverride ? (overrideTimestamps['__links'] || override?.updated_at || null) : null;
    const links_tracked = effectiveLinks.map((url) => ({
      selected: {
        value: url,
        confidence: linksOverride ? 1.0 : 1.0,
        status: linksOverride ? 'override' : 'reference',
        color: confidenceColor(linksOverride ? 1.0 : 1.0, []),
      },
      needs_review: false,
      reason_codes: linksOverride ? ['manual_override'] : [],
      source: linksOverride ? 'user' : 'reference',
      source_timestamp: linksTimestamp,
      overridden: Boolean(linksOverride),
    }));

    const properties = {};
    let itemPropCount = 0;
    let itemFlags = 0;

    for (const key of propertyColumns) {
      const rawValue = props[key];
      const hasRawValue = rawValue !== undefined && rawValue !== null && rawValue !== '' && rawValue !== '-';
      const overrideValue = override?.properties?.[key];
      const hasOverride = overrideValue !== undefined;
      const value = hasOverride ? overrideValue : rawValue;
      const variance = variancePolicies[key] || null;
      const fieldConstraints = toArray(constraints[key]);

      // Confidence + source based on provenance
      // Source reflects ORIGINAL provenance (never 'override') — the overridden flag handles user actions
      let confidence, source;
      if (hasOverride) {
        confidence = 1.0;
        source = 'user';
      } else if (hasRawValue) {
        confidence = 1.0;
        source = 'reference';
      } else {
        confidence = 0;
        source = 'unknown';
      }

      const needsReview = !hasRawValue && !hasOverride;
      if (needsReview) itemFlags++;

      // Build reason codes (matches reviewGridData.js pattern)
      const reasonCodes = [];
      if (needsReview) reasonCodes.push('missing_value');
      if (hasOverride) reasonCodes.push('manual_override');
      for (const c of fieldConstraints) reasonCodes.push(`constraint:${c}`);

      // Generate reference candidate when value comes from component DB
      const refCandidate = hasRawValue ? [{
        candidate_id: buildReferenceComponentCandidateId({
          componentType,
          componentName: item.name,
          componentMaker: item.maker || '',
          propertyKey: key,
          value: rawValue,
        }),
        value: rawValue,
        score: 1.0,
        source_id: 'reference',
        source: 'Reference',
        tier: null,
        method: 'reference_data',
        evidence: {
          url: '',
          retrieved_at: dbGeneratedAt,
          snippet_id: '',
          snippet_hash: '',
          quote: `From reference database`,
          quote_span: null,
          snippet_text: `From reference database`,
          source_id: 'reference',
        },
      }] : [];

      properties[key] = {
        selected: {
          value: value ?? null,
          confidence,
          status: source,
          color: confidenceColor(confidence, reasonCodes),
        },
        needs_review: needsReview,
        reason_codes: reasonCodes,
        source,
        source_timestamp: hasOverride ? (overrideTimestamps[key] || override?.updated_at || null) : null,
        variance_policy: variance,
        constraints: fieldConstraints,
        overridden: hasOverride,
        candidate_count: refCandidate.length,
        candidates: refCandidate,
        accepted_candidate_id: null,
      };

      itemPropCount++;
    }

    // Enrich property candidates from pipeline product_attributes (per review item/source).
    if (itemReviewItems.length > 0) {
      for (const key of propertyColumns) {
        const prop = properties[key];
        if (!prop) continue;
        const existingPropCandidateIds = new Set(prop.candidates.map((candidate) => String(candidate?.candidate_id || '').trim()));
        for (const ri of itemReviewItems) {
          const attrs = isObject(ri.product_attributes) ? ri.product_attributes : {};
          const pipelineVal = attrs[key];
          if (pipelineVal === undefined || pipelineVal === null || pipelineVal === '') continue;
          for (const valStr of splitCandidateParts(pipelineVal)) {
            const candidateId = buildComponentReviewSyntheticCandidateId({
              productId: ri.product_id || '',
              fieldKey: key,
              reviewId: ri.review_id || '',
              value: valStr,
            });
            if (existingPropCandidateIds.has(candidateId)) continue;
            existingPropCandidateIds.add(candidateId);
            const productLabel = String(ri.product_id || '').trim() || 'unknown_product';
            prop.candidates.push(buildPipelineReviewCandidate({
              candidateId,
              value: valStr,
              reviewItem: ri,
              method: 'product_extraction',
              quote: `Extracted ${key}="${valStr}" from ${productLabel}${ri.review_id ? ` (${ri.review_id})` : ''}`,
              snippetText: 'Pipeline extraction from product runs',
              attributionContext: itemReviewAttribution,
            }));
          }
        }
        prop.candidate_count = prop.candidates.length;
      }
    }

    // ── SpecDb enrichment: product-level candidates from SQLite ──────
    let linkedProducts = [];
    if (specDb) {
      try {
        const linkRows = specDb.getProductsForComponent(componentType, item.name, item.maker || '');
        const productIds = linkRows.map(r => r.product_id);
        linkedProducts = linkRows.map(r => ({
          product_id: r.product_id,
          field_key: r.field_key,
          match_type: r.match_type || 'exact',
          match_score: r.match_score ?? null,
        }));

        if (productIds.length > 0) {
          // Determine field_key for name from link rows (e.g. 'sensor')
          const linkFieldKey = linkRows[0]?.field_key || componentType;
          const brandFieldKey = `${componentType}_brand`;

          // --- Name candidates from SpecDb ---
          const nameCandRows = specDb.getCandidatesForComponentProperty(componentType, item.name, item.maker || '', linkFieldKey);
          if (nameCandRows.length > 0) {
            const nameByVal = new Map();
            for (const c of nameCandRows) {
              const v = (c.value || '').trim();
              if (!v) continue;
              if (!nameByVal.has(v)) nameByVal.set(v, { rows: [], count: 0 });
              const entry = nameByVal.get(v);
              entry.rows.push(c);
              entry.count++;
            }
            const existingNameVals = new Set(name_tracked.candidates.map(c => c.value));
            for (const [val, meta] of nameByVal) {
              if (existingNameVals.has(val)) continue;
              const best = meta.rows[0];
              const count = meta.count;
              name_tracked.candidates.push({
                candidate_id: `specdb_${componentType}_${componentLaneSlug(item.name, item.maker || '')}_name_${slugify(val)}`,
                value: val,
                score: best.score ?? 0,
                source_id: 'specdb',
                source: `${best.source_host || 'SpecDb'} (${count} product${count !== 1 ? 's' : ''})`,
                tier: best.source_tier ?? null,
                method: best.source_method || 'specdb_lookup',
                evidence: {
                  url: best.evidence_url || best.source_url || '',
                  snippet_id: best.snippet_id || '',
                  snippet_hash: best.snippet_hash || '',
                  quote: best.quote || '',
                  snippet_text: best.snippet_text || '',
                  source_id: 'specdb',
                },
              });
            }
            name_tracked.candidate_count = name_tracked.candidates.length;
          }

          // --- Maker candidates from SpecDb ---
          const makerCandRows = specDb.getCandidatesForComponentProperty(componentType, item.name, item.maker || '', brandFieldKey);
          if (makerCandRows.length > 0) {
            const makerByVal = new Map();
            for (const c of makerCandRows) {
              const v = (c.value || '').trim();
              if (!v) continue;
              if (!makerByVal.has(v)) makerByVal.set(v, { rows: [], count: 0 });
              const entry = makerByVal.get(v);
              entry.rows.push(c);
              entry.count++;
            }
            const existingMakerVals = new Set(maker_tracked.candidates.map(c => c.value));
            for (const [val, meta] of makerByVal) {
              if (existingMakerVals.has(val)) continue;
              const best = meta.rows[0];
              const count = meta.count;
              maker_tracked.candidates.push({
                candidate_id: `specdb_${componentType}_${componentLaneSlug(item.name, item.maker || '')}_maker_${slugify(val)}`,
                value: val,
                score: best.score ?? 0,
                source_id: 'specdb',
                source: `${best.source_host || 'SpecDb'} (${count} product${count !== 1 ? 's' : ''})`,
                tier: best.source_tier ?? null,
                method: best.source_method || 'specdb_lookup',
                evidence: {
                  url: best.evidence_url || best.source_url || '',
                  snippet_id: best.snippet_id || '',
                  snippet_hash: best.snippet_hash || '',
                  quote: best.quote || '',
                  snippet_text: best.snippet_text || '',
                  source_id: 'specdb',
                },
              });
            }
            maker_tracked.candidate_count = maker_tracked.candidates.length;
          }

          // --- Property candidates from SpecDb (key = field_key, 1:1 mapping) ---
          for (const key of propertyColumns) {
            const prop = properties[key];
            if (!prop) continue;
            const propCandRows = specDb.getCandidatesForComponentProperty(componentType, item.name, item.maker || '', key);
            if (propCandRows.length > 0) {
              const propByVal = new Map();
              for (const c of propCandRows) {
                const v = (c.value || '').trim();
                if (!v) continue;
                if (!propByVal.has(v)) propByVal.set(v, { rows: [], count: 0 });
                const entry = propByVal.get(v);
                entry.rows.push(c);
                entry.count++;
              }
              const existingPropVals = new Set(prop.candidates.map(c => String(c.value)));
              for (const [val, meta] of propByVal) {
                if (existingPropVals.has(val)) continue;
                const best = meta.rows[0];
                const count = meta.count;
                prop.candidates.push({
                  candidate_id: `specdb_${componentType}_${componentLaneSlug(item.name, item.maker || '')}_${key}_${slugify(val)}`,
                  value: val,
                  score: best.score ?? 0,
                  source_id: 'specdb',
                  source: `${best.source_host || 'SpecDb'} (${count} product${count !== 1 ? 's' : ''})`,
                  tier: best.source_tier ?? null,
                  method: best.source_method || 'specdb_lookup',
                  evidence: {
                    url: best.evidence_url || best.source_url || '',
                    snippet_id: best.snippet_id || '',
                    snippet_hash: best.snippet_hash || '',
                    quote: best.quote || '',
                    snippet_text: best.snippet_text || '',
                    source_id: 'specdb',
                  },
                });
              }
              prop.candidate_count = prop.candidates.length;
            }
          }

          // --- Variance evaluation ---
          for (const key of propertyColumns) {
            const prop = properties[key];
            if (!prop) continue;
            const policy = prop.variance_policy;
            if (!policy || policy === 'override_allowed') continue;
            const dbValue = prop.selected?.value;
            if (dbValue == null) continue;
            const fieldStates = specDb.getItemFieldStateForProducts(productIds, [key]);
            if (!fieldStates.length) continue;
            const entries = fieldStates.map(s => ({ product_id: s.product_id, value: s.value }));
            const batch = evaluateVarianceBatch(policy, dbValue, entries);
            if (batch.summary.violations > 0) {
              if (!prop.reason_codes.includes('variance_violation')) {
                prop.reason_codes.push('variance_violation');
              }
              prop.needs_review = true;
              prop.variance_violations = {
                count: batch.summary.violations,
                total_products: batch.summary.total,
                products: batch.results
                  .filter(r => !r.compliant)
                  .slice(0, 5)
                  .map(r => ({ product_id: r.product_id, value: r.value, reason: r.reason, details: r.details })),
              };
              itemFlags++;
            }
          }
        }
      } catch (_specDbErr) {
        // SpecDb enrichment is best-effort — don't break the drawer
      }
    }
    if (linkedProducts.length === 0 && itemReviewAttribution.productIds.length > 0) {
      linkedProducts = itemReviewAttribution.productIds.map((productId) => ({
        product_id: productId,
        field_key: componentType,
        match_type: 'pipeline_review',
        match_score: null,
      }));
    }

    ensureTrackedStateCandidateInvariant(name_tracked, {
      fallbackCandidateId: `component_${slugify(componentType)}_${componentLaneSlug(item.name, item.maker || '')}_name`,
      fallbackQuote: `Selected ${componentType} name retained for authoritative review`,
    });
    ensureTrackedStateCandidateInvariant(maker_tracked, {
      fallbackCandidateId: `component_${slugify(componentType)}_${componentLaneSlug(item.name, item.maker || '')}_maker`,
      fallbackQuote: `Selected ${componentType} maker retained for authoritative review`,
    });
    for (const key of propertyColumns) {
      const prop = properties[key];
      if (!prop) continue;
      ensureTrackedStateCandidateInvariant(prop, {
        fallbackCandidateId: `component_${slugify(componentType)}_${componentLaneSlug(item.name, item.maker || '')}_${slugify(key)}`,
        fallbackQuote: `Selected ${key} retained for authoritative review`,
      });
    }

    const confidenceValues = propertyColumns
      .map((key) => Number.parseFloat(String(properties[key]?.selected?.confidence ?? '')))
      .filter((value) => Number.isFinite(value));
    const avgConf = confidenceValues.length > 0
      ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
      : 0;
    const aliasOverride = override?.identity?.aliases;
    const effectiveAliases = aliasOverride ?? toArray(item.aliases);
    const aliasesOverridden = Boolean(aliasOverride);
    const resolvedName = nameVal || item.name || '';
    const resolvedMaker = makerVal || item.maker || '';
    const legacyIdentity = specDb
      ? specDb.getComponentIdentity(componentType, resolvedName, resolvedMaker)
      : null;
    const identitySource = String(legacyIdentity?.source || 'component_db').trim();

    items.push({
      component_identity_id: legacyIdentity?.id ?? null,
      name: resolvedName,
      maker: resolvedMaker,
      aliases: effectiveAliases,
      aliases_overridden: aliasesOverridden,
      links: effectiveLinks,
      name_tracked,
      maker_tracked,
      links_tracked,
      properties,
      linked_products: linkedProducts,
      review_status: override?.review_status || 'pending',
      discovery_source: identitySource,
      discovered: discoveredFromSource(identitySource),
      metrics: {
        confidence: Math.round(avgConf * 100) / 100,
        flags: itemFlags,
        property_count: itemPropCount,
      },
    });
  }

  const normalizedItems = enforceNonDiscoveredRows(items, category);
  const visibleItems = normalizedItems.filter((item) => {
    const linkedCount = Array.isArray(item.linked_products) ? item.linked_products.length : 0;
    if (isTestModeCategory(category) && item.discovered && linkedCount === 0) {
      return false;
    }
    const hasNamePending = Boolean(item.name_tracked?.needs_review) && hasActionableCandidate(item.name_tracked?.candidates);
    const hasMakerPending = Boolean(item.maker_tracked?.needs_review) && hasActionableCandidate(item.maker_tracked?.candidates);
    const hasPropertyPending = propertyColumns.some((key) => {
      const prop = item?.properties?.[key];
      return Boolean(prop?.needs_review) && hasActionableCandidate(prop?.candidates);
    });
    const hasCandidateEvidence = hasActionableCandidate(item?.name_tracked?.candidates)
      || hasActionableCandidate(item?.maker_tracked?.candidates)
      || propertyColumns.some((key) => hasActionableCandidate(item?.properties?.[key]?.candidates));
    const identitySources = [item?.name_tracked?.source, item?.maker_tracked?.source]
      .map((source) => String(source || '').trim().toLowerCase())
      .filter(Boolean);
    const hasStableIdentitySource = identitySources.some((source) => source !== 'pipeline' && source !== 'unknown');
    const hasStablePropertySource = propertyColumns.some((key) => {
      const source = String(item?.properties?.[key]?.source || '').trim().toLowerCase();
      const selectedValue = item?.properties?.[key]?.selected?.value;
      return source && source !== 'pipeline' && source !== 'unknown' && hasKnownValue(selectedValue);
    });
    return linkedCount > 0
      || hasNamePending
      || hasMakerPending
      || hasPropertyPending
      || hasCandidateEvidence
      || hasStableIdentitySource
      || hasStablePropertySource;
  });
  const finalItems = enforceNonDiscoveredRows(visibleItems, category);
  const visibleFlags = finalItems.reduce((sum, item) => sum + (item.metrics?.flags || 0), 0);
  const visibleAvgConfidence = finalItems.length > 0
    ? Math.round((finalItems.reduce((sum, item) => sum + (item.metrics?.confidence || 0), 0) / finalItems.length) * 100) / 100
    : 0;

  return {
    category,
    componentType,
    property_columns: propertyColumns,
    items: finalItems,
    metrics: {
      total: finalItems.length,
      avg_confidence: visibleAvgConfidence,
      flags: visibleFlags,
    },
  };
}

// ── Enum Payloads ───────────────────────────────────────────────────

export async function buildEnumReviewPayloads({ config = {}, category, specDb = null, fieldOrderOverride = null }) {
  let result;
  if (!specDb) {
    result = await buildEnumReviewPayloadsLegacy({ config, category, specDb });
  } else {
    result = await buildEnumReviewPayloadsSpecDb({ config, category, specDb });
  }
  if (Array.isArray(fieldOrderOverride) && fieldOrderOverride.length > 0 && Array.isArray(result?.fields)) {
    const orderIndex = new Map(fieldOrderOverride.map((k, i) => [k, i]));
    result.fields = [...result.fields].sort((a, b) => {
      const ai = orderIndex.has(a.field) ? orderIndex.get(a.field) : Number.MAX_SAFE_INTEGER;
      const bi = orderIndex.has(b.field) ? orderIndex.get(b.field) : Number.MAX_SAFE_INTEGER;
      return ai - bi;
    });
  }
  return result;
}

// ── SpecDb-primary enum payloads ─────────────────────────────────────

async function buildEnumReviewPayloadsSpecDb({ config = {}, category, specDb }) {
  const fieldKeys = specDb.getAllEnumFields();
  const fields = [];

  for (const field of fieldKeys) {
    const enumListRow = specDb.getEnumList(field);
    const listRows = specDb.getListValues(field);
    const valueMap = new Map();

    for (const row of listRows) {
      const normalized = String(row.value).trim().toLowerCase();
      if (!normalized) continue;

      const enumKeyState = specDb.getKeyReviewState({
        category,
        targetKind: 'enum_key',
        fieldKey: field,
        enumValueNorm: normalized,
        listValueId: row.id ?? null,
      });
      const basePending = Boolean(row.needs_review);
      const isPending = isSharedLanePending(enumKeyState, basePending);
      const source = row.source || 'known_values';
      const confidence = isPending ? 0.6 : 1.0;
      const color = isPending ? 'yellow' : 'green';

      // Build candidate based on source
      const candidates = [];
      if (source === 'pipeline') {
        candidates.push({
          candidate_id: buildPipelineEnumCandidateId({ fieldKey: field, value: row.value }),
          value: row.value,
          score: isPending ? 0.6 : 1.0,
          source_id: 'pipeline',
          source: 'Pipeline',
          tier: null,
          method: 'pipeline_extraction',
          evidence: {
            url: '', retrieved_at: row.source_timestamp || '',
            snippet_id: '', snippet_hash: '',
            quote: isPending ? 'Discovered by pipeline' : 'Discovered by pipeline, accepted by user',
            quote_span: null,
            snippet_text: isPending ? 'Discovered by pipeline' : 'Discovered by pipeline, accepted by user',
            source_id: 'pipeline',
          },
        });
      } else if (source !== 'manual') {
        candidates.push({
          candidate_id: buildReferenceEnumCandidateId({ fieldKey: field, value: row.value }),
          value: row.value,
          score: 1.0,
          source_id: 'reference',
          source: 'Reference',
          tier: null,
          method: 'reference_data',
          evidence: {
            url: '', retrieved_at: '',
            snippet_id: '', snippet_hash: '',
            quote: `From reference database`,
            quote_span: null,
            snippet_text: `From reference database`,
            source_id: 'reference',
          },
        });
      }

      const entry = {
        list_value_id: row.id ?? null,
        enum_list_id: row.list_id ?? null,
        value: row.value,
        source,
        source_timestamp: row.source_timestamp || null,
        confidence,
        color,
        needs_review: isPending,
        candidates,
        normalized_value: row.normalized_value || null,
        enum_policy: row.enum_policy || null,
        accepted_candidate_id: String(enumKeyState?.selected_candidate_id || '').trim()
          || row.accepted_candidate_id
          || null,
      };

      // SpecDb enrichment: linked products and additional candidates
      try {
        const productRows = specDb.getProductsByListValueId(row.id);
        if (productRows.length > 0) {
          entry.linked_products = productRows.map(r => ({
            product_id: r.product_id,
            field_key: r.field_key,
          }));
        }

        const candRows = specDb.getCandidatesByListValue(field, row.id);
        if (candRows.length > 0) {
          appendAllSpecDbCandidates(
            entry.candidates,
            candRows,
            `specdb_enum_${slugify(field)}_${slugify(row.value)}`
          );
        }
      } catch (_) {
        // Best-effort enrichment
      }

      ensureEnumValueCandidateInvariant(entry, {
        fieldKey: field,
        fallbackQuote: `Selected ${field} enum value retained for authoritative review`,
      });
      const listValueSlotId = Number(row?.id);
      const reviewRows = Number.isFinite(listValueSlotId) && listValueSlotId > 0
        ? (specDb.getReviewsForContext('list', String(listValueSlotId)) || [])
        : [];
      annotateCandidateSharedReviews(entry.candidates, reviewRows);

      valueMap.set(normalized, entry);
    }

    const values = [...valueMap.values()]
      .filter((entry) => shouldIncludeEnumValueEntry(entry, {
        requireLinkedPendingPipeline: true,
      }))
      .sort((a, b) => a.value.localeCompare(b.value));
    const flagCount = values.filter(v => (
      v.needs_review
      && hasActionableCandidate(v.candidates)
    )).length;

    fields.push({
      field,
      enum_list_id: enumListRow?.id ?? null,
      values,
      metrics: { total: values.length, flags: flagCount },
    });
  }

  return { category, fields };
}

async function buildEnumReviewPayloadsLegacy({ config = {}, category, specDb = null }) {
  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  const kvPath = path.join(helperRoot, category, '_generated', 'known_values.json');
  const suggestPath = path.join(helperRoot, category, '_suggestions', 'enums.json');
  const controlMapPath = path.join(helperRoot, category, '_control_plane', 'workbook_map.json');

  const kv = await safeReadJson(kvPath);
  const suggestions = await safeReadJson(suggestPath);
  const wbMap = await safeReadJson(controlMapPath);

  const kvFields = isObject(kv?.fields) ? kv.fields : {};
  const kvGeneratedAt = kv?.generated_at || '';

  // Build a lookup of manually added enum values (user-accepted or user-added)
  const manualEnumValues = isObject(wbMap?.manual_enum_values) ? wbMap.manual_enum_values : {};
  const manualEnumTimestamps = isObject(wbMap?.manual_enum_timestamps) ? wbMap.manual_enum_timestamps : {};
  const manualLookup = {};
  for (const [f, vals] of Object.entries(manualEnumValues)) {
    manualLookup[f] = new Set(toArray(vals).map(v => String(v).trim().toLowerCase()));
  }

  // Parse suggestions — handle both formats:
  // Old format: { fields: { fieldKey: [values] } }
  // Curation format: { suggestions: [{ field_key, value, ... }] }
  const sugByField = {};
  // Track ALL values that originally came from pipeline (including accepted ones)
  // so we can preserve their original source='pipeline' even after acceptance
  const pipelineOriginByField = {};
  if (isObject(suggestions?.fields)) {
    for (const [f, vals] of Object.entries(suggestions.fields)) {
      sugByField[f] = toArray(vals);
      if (!pipelineOriginByField[f]) pipelineOriginByField[f] = new Set();
      for (const v of toArray(vals)) {
        pipelineOriginByField[f].add(String(v).trim().toLowerCase());
      }
    }
  }
  if (Array.isArray(suggestions?.suggestions)) {
    for (const s of suggestions.suggestions) {
      const fk = String(s?.field_key || '').trim();
      const val = String(s?.value || '').trim();
      if (!fk || !val) continue;
      // Track pipeline origin for ALL suggestions (including accepted/dismissed)
      if (!pipelineOriginByField[fk]) pipelineOriginByField[fk] = new Set();
      pipelineOriginByField[fk].add(val.toLowerCase());
      // Only add pending suggestions to the active suggestions list
      if (s?.status && s.status !== 'pending') continue;
      if (!sugByField[fk]) sugByField[fk] = [];
      sugByField[fk].push(val);
    }
  }

  const allFields = new Set([...Object.keys(kvFields), ...Object.keys(sugByField)]);
  const fields = [];

  for (const field of [...allFields].sort()) {
    const knownValues = toArray(kvFields[field]);
    const suggestedValues = toArray(sugByField[field]);
    const manualSet = manualLookup[field] || new Set();

    const valueMap = new Map();

    // Add known values (high confidence)
    // Source reflects ORIGINAL provenance — never destroyed by user actions:
    //   'pipeline' = originally discovered by pipeline, user accepted it
    //   'manual'   = user added it fresh (not from pipeline)
    //   'reference' = from the reference database, untouched by user
    const pipelineOriginSet = pipelineOriginByField[field] || new Set();
    for (const v of knownValues) {
      const normalized = String(v).trim().toLowerCase();
      if (!normalized) continue;
      const isManual = manualSet.has(normalized);
      const wasPipeline = pipelineOriginSet.has(normalized);
      let valueSource;
      if (isManual && wasPipeline) {
        valueSource = 'pipeline'; // Originally from pipeline, user accepted it
      } else if (isManual) {
        valueSource = 'manual';   // User added it fresh
      } else {
        valueSource = 'reference'; // From reference database
      }
      // Build candidate for audit trail (manual overrides are NOT candidates per source hierarchy)
      const refCandidates = valueSource === 'manual' ? [] : [{
        candidate_id: valueSource === 'pipeline'
          ? buildPipelineEnumCandidateId({ fieldKey: field, value: v })
          : buildReferenceEnumCandidateId({ fieldKey: field, value: v }),
        value: String(v).trim(),
        score: 1.0,
        source_id: valueSource === 'pipeline' ? 'pipeline' : 'reference',
        source: valueSource === 'pipeline' ? 'Pipeline' : 'Reference',
        tier: null,
        method: valueSource === 'pipeline' ? 'pipeline_extraction' : 'reference_data',
        evidence: {
          url: '',
          retrieved_at: kvGeneratedAt,
          snippet_id: '',
          snippet_hash: '',
          quote: valueSource === 'pipeline' ? 'Discovered by pipeline, accepted by user' : 'From reference database',
          quote_span: null,
          snippet_text: valueSource === 'pipeline' ? 'Discovered by pipeline, accepted by user' : 'From reference database',
          source_id: valueSource === 'pipeline' ? 'pipeline' : 'reference',
        },
      }];
      valueMap.set(normalized, {
        value: String(v).trim(),
        source: valueSource,
        source_timestamp: manualEnumTimestamps[`${field}::${normalized}`] || null,
        confidence: 1.0,
        color: 'green',
        needs_review: false,
        candidates: refCandidates,
        accepted_candidate_id: null,
      });
    }

    // Add pipeline suggestions (lower confidence, needs review)
    for (const v of suggestedValues) {
      const normalized = String(v).trim().toLowerCase();
      if (!normalized || valueMap.has(normalized)) continue;
      valueMap.set(normalized, {
        value: String(v).trim(),
        source: 'pipeline',
        source_timestamp: null,
        confidence: 0.6,
        color: 'yellow',
        needs_review: true,
        accepted_candidate_id: null,
        candidates: [{
          candidate_id: buildPipelineEnumCandidateId({ fieldKey: field, value: v }),
          value: String(v).trim(),
          score: 0.6,
          source_id: 'pipeline',
          source: 'Pipeline',
          tier: null,
          method: 'pipeline_extraction',
          evidence: {
            url: '',
            retrieved_at: kvGeneratedAt,
            snippet_id: '',
            snippet_hash: '',
            quote: 'Discovered by pipeline',
            quote_span: null,
            snippet_text: 'Discovered by pipeline',
            source_id: 'pipeline',
          },
        }],
      });
    }

    // SpecDb enrichment: product-level candidates + linked products for each enum value
    if (specDb) {
      try {
        for (const [, entry] of valueMap) {
          const lvRow = specDb.getListValueByFieldAndValue(field, entry.value);
          if (!lvRow) continue;

          // Linked products for this enum value
          const productRows = specDb.getProductsByListValueId(lvRow.id);
          if (productRows.length > 0) {
            entry.linked_products = productRows.map(r => ({
              product_id: r.product_id,
              field_key: r.field_key,
            }));
            entry.list_value_id = lvRow.id ?? entry.list_value_id ?? null;
            entry.enum_list_id = lvRow.list_id ?? entry.enum_list_id ?? null;
            entry.normalized_value = lvRow.normalized_value || null;
            entry.enum_policy = lvRow.enum_policy || null;
            entry.accepted_candidate_id = lvRow.accepted_candidate_id || null;
          }

          const candRows = specDb.getCandidatesByListValue(field, lvRow.id);
          if (!candRows.length) continue;
          appendAllSpecDbCandidates(
            entry.candidates,
            candRows,
            `specdb_enum_${slugify(field)}_${slugify(entry.value)}`
          );
        }
      } catch (_specDbErr) {
        // Best-effort enrichment
      }
    }

    for (const [, entry] of valueMap) {
      ensureEnumValueCandidateInvariant(entry, {
        fieldKey: field,
        fallbackQuote: `Selected ${field} enum value retained for authoritative review`,
      });
    }

    const values = [...valueMap.values()]
      .filter((entry) => shouldIncludeEnumValueEntry(entry, {
        requireLinkedPendingPipeline: Boolean(specDb),
      }))
      .sort((a, b) => a.value.localeCompare(b.value));
    const flagCount = values.filter(v => (
      v.needs_review
      && hasActionableCandidate(v.candidates)
    )).length;

    fields.push({
      field,
      values,
      metrics: { total: values.length, flags: flagCount },
    });
  }

  return { category, fields };
}
