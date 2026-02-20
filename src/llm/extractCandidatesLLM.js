import { normalizeWhitespace } from '../utils/common.js';
import { normalizeFieldList } from '../utils/fieldKeys.js';
import { appendLlmVerificationReport } from './verificationReport.js';
import { buildFieldBatches, resolveBatchModel } from './fieldBatching.js';
import { LLMCache } from './llmCache.js';
import { verifyCandidateEvidence } from './evidenceVerifier.js';
import { callLlmWithRouting, hasAnyLlmApiKey } from './routing.js';
import { buildExtractionContextMatrix } from './extractionContext.js';
import { ruleType, ruleShape, ruleRequiredLevel, ruleUnit, ruleAiMode, ruleAiReasoningNote, autoGenerateExtractionGuidance } from '../engine/ruleAccessors.js';

const IDENTITY_KEYS = ['brand', 'model', 'sku', 'mpn', 'gtin', 'variant'];

function llmSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      identityCandidates: {
        type: 'object',
        additionalProperties: false,
        properties: {
          brand: { type: 'string' },
          model: { type: 'string' },
          sku: { type: 'string' },
          mpn: { type: 'string' },
          gtin: { type: 'string' },
          variant: { type: 'string' }
        },
        required: []
      },
      fieldCandidates: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            field: { type: 'string' },
            value: {
              anyOf: [
                { type: 'string' },
                { type: 'number' },
                { type: 'boolean' },
                { type: 'array' },
                { type: 'object' },
                { type: 'null' }
              ]
            },
            keyPath: { type: 'string' },
            evidenceRefs: {
              type: 'array',
              items: { type: 'string' }
            },
            snippetId: { type: 'string' },
            snippetHash: { type: 'string' },
            quote: { type: 'string' },
            quoteSpan: {
              type: 'array',
              items: { type: 'number' },
              minItems: 2,
              maxItems: 2
            },
            unknownReason: { type: 'string' },
            confidence: { type: 'number' }
          },
          required: ['field', 'value', 'evidenceRefs']
        }
      },
      conflicts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            field: { type: 'string' },
            values: {
              type: 'array',
              items: { type: 'string' }
            },
            evidenceRefs: {
              type: 'array',
              items: { type: 'string' }
            }
          },
          required: ['field', 'values', 'evidenceRefs']
        }
      },
      notes: {
        type: 'array',
        items: { type: 'string' }
      }
    },
    required: ['identityCandidates', 'fieldCandidates', 'conflicts', 'notes']
  };
}

function sanitizeIdentity(identity, identityLock) {
  const out = {};
  for (const key of IDENTITY_KEYS) {
    const value = normalizeWhitespace(identity?.[key] || '');
    if (!value || value.toLowerCase() === 'unk') {
      continue;
    }
    if (identityLock?.[key] && normalizeWhitespace(identityLock[key])) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

function filterEvidenceRefs(refs, validRefs) {
  return [...new Set((refs || []).filter((id) => validRefs.has(id)))];
}

function hasKnownValue(value) {
  const token = String(value || '').trim().toLowerCase();
  return token !== '' && token !== 'unk' && token !== 'null' && token !== 'undefined' && token !== 'n/a';
}

function normalizeCandidateValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeCandidateValue(item)).filter(Boolean).join(', ');
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : String(Number.parseFloat(value.toFixed(6)));
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return normalizeWhitespace(String(value));
}

function dedupeFieldCandidates(fieldCandidates = []) {
  const seen = new Set();
  const out = [];
  for (const row of fieldCandidates || []) {
    const refs = Array.isArray(row?.evidenceRefs)
      ? [...new Set(row.evidenceRefs.map((item) => String(item || '').trim()).filter(Boolean))]
      : [];
    const key = [
      String(row?.field || '').trim(),
      String(row?.value || '').trim(),
      String(row?.method || '').trim(),
      String(row?.keyPath || '').trim(),
      refs.sort((a, b) => a.localeCompare(b)).join(',')
    ].join('|');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({
      ...row,
      evidenceRefs: refs
    });
  }
  return out;
}

function collectSnippetAndRefMaps(evidencePack = {}) {
  const snippetById = new Map();
  for (const row of evidencePack?.snippets || []) {
    const id = String(row?.id || '').trim();
    if (id) {
      snippetById.set(id, row);
    }
  }
  if (
    snippetById.size === 0 &&
    evidencePack?.snippets &&
    typeof evidencePack.snippets === 'object' &&
    !Array.isArray(evidencePack.snippets)
  ) {
    for (const [id, row] of Object.entries(evidencePack.snippets || {})) {
      const key = String(id || '').trim();
      if (key) {
        snippetById.set(key, row);
      }
    }
  }

  const refById = new Map();
  for (const row of evidencePack?.references || []) {
    const id = String(row?.id || '').trim();
    if (id) {
      refById.set(id, row);
    }
  }
  return {
    snippetById,
    refById
  };
}

function fieldHintSet(snippet = {}) {
  const set = new Set();
  for (const hint of snippet?.field_hints || []) {
    const token = String(hint || '').trim().toLowerCase();
    if (token) {
      set.add(token);
    }
  }
  return set;
}

const FIELD_TERM_HINTS = {
  lngth: ['length', 'long', 'mm', 'cm', 'inch', 'inches'],
  width: ['width', 'wide', 'mm', 'cm', 'inch', 'inches'],
  height: ['height', 'tall', 'mm', 'cm', 'inch', 'inches'],
  weight: ['weight', 'gram', 'grams', 'g'],
  colors: ['color', 'colour', 'black', 'white', 'red', 'blue'],
  coating: ['coating', 'coat', 'finish', 'surface'],
  material: ['material', 'plastic', 'aluminum', 'aluminium', 'magnesium', 'shell', 'body'],
  connection: ['connection', 'connectivity', 'wired', 'wireless', 'usb', 'usb-c', 'hdmi', 'displayport', 'dp'],
  wireless_technology: ['wireless', 'bluetooth', '2.4ghz', 'wifi', 'rf'],
  cable_type: ['cable', 'usb', 'usb-c', 'micro-usb', 'lightning'],
  cable_length: ['cable length', 'length', 'meter', 'meters', 'm', 'mm', 'cm', 'ft', 'feet']
};

const IDENTITY_FIELDS = new Set(['brand', 'model', 'variant', 'sku', 'mpn', 'gtin', 'base_model']);

function uniqueTokens(tokens = []) {
  return [...new Set((tokens || []).map((item) => String(item || '').trim().toLowerCase()).filter(Boolean))];
}

function fieldTokens(field = '') {
  const key = String(field || '').trim().toLowerCase();
  return uniqueTokens([
    key.replace(/_/g, ' '),
    ...(FIELD_TERM_HINTS[key] || [])
  ]);
}

function countTokenHits(text = '', tokens = []) {
  const source = String(text || '').toLowerCase();
  let hits = 0;
  for (const token of uniqueTokens(tokens)) {
    if (token && source.includes(token)) {
      hits += 1;
    }
  }
  return hits;
}

function hasDimensionSignal(text = '') {
  return /\b\d+(?:\.\d+)?\s?(mm|cm|in|inch|inches|g|gram|grams)\b/i.test(String(text || ''));
}

function clipText(value, maxChars = 900) {
  const token = String(value || '');
  const cap = Math.max(160, Number.parseInt(String(maxChars || 900), 10) || 900);
  if (token.length <= cap) {
    return token;
  }
  return `${token.slice(0, cap)}...`;
}

function normalizeSourceToken(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function hostFromUrl(value = '') {
  try {
    return String(new URL(String(value || '')).host || '').trim().toLowerCase();
  } catch {
    return '';
  }
}

function inferImageMimeFromUri(value = '') {
  const token = String(value || '').trim().toLowerCase();
  if (token.endsWith('.png')) return 'image/png';
  if (token.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function buildPromptEvidencePayload(scoped = {}, config = {}) {
  const maxCharsPerSnippet = Math.max(160, Number.parseInt(String(config.llmExtractMaxSnippetChars || 900), 10) || 900);
  const promptRefs = (scoped.references || []).map((row) => ({
    id: String(row?.id || '').trim(),
    source_id: row?.source_id || row?.source || '',
    url: row?.url || '',
    type: row?.type || 'text',
    snippet_hash: row?.snippet_hash || '',
    file_uri: row?.file_uri || '',
    mime_type: row?.mime_type || '',
    content_hash: row?.content_hash || '',
    surface: row?.surface || ''
  })).filter((row) => row.id);
  const promptSnippets = (scoped.snippets || []).map((row) => ({
    id: String(row?.id || '').trim(),
    source: row?.source || row?.source_id || '',
    source_id: row?.source_id || row?.source || '',
    type: row?.type || 'text',
    field_hints: Array.isArray(row?.field_hints) ? row.field_hints : [],
    text: clipText(row?.normalized_text || row?.text || '', maxCharsPerSnippet),
    snippet_hash: row?.snippet_hash || '',
    url: row?.url || '',
    file_uri: row?.file_uri || '',
    mime_type: row?.mime_type || '',
    content_hash: row?.content_hash || '',
    surface: row?.surface || ''
  })).filter((row) => row.id && row.text);
  return {
    references: promptRefs,
    snippets: promptSnippets
  };
}

function normalizeVisualAssetsFromEvidencePack(evidencePack = {}) {
  const fromPack = Array.isArray(evidencePack?.visual_assets)
    ? evidencePack.visual_assets
    : [];
  const fromRefs = Array.isArray(evidencePack?.references)
    ? evidencePack.references
        .filter((row) => String(row?.file_uri || '').trim())
        .map((row) => ({
          id: String(row?.id || '').trim(),
          kind: String(row?.type || '').trim() || 'visual_asset',
          source_id: String(row?.source_id || '').trim(),
          source_url: String(row?.url || '').trim(),
          file_uri: String(row?.file_uri || '').trim(),
          mime_type: String(row?.mime_type || '').trim(),
          content_hash: String(row?.content_hash || '').trim(),
          width: Number(row?.width || 0) || null,
          height: Number(row?.height || 0) || null,
          size_bytes: Number(row?.size_bytes || 0) || null,
          surface: String(row?.surface || '').trim()
        }))
    : [];
  const dedupe = new Map();
  for (const row of [...fromPack, ...fromRefs]) {
    const uri = String(row?.file_uri || '').trim();
    if (!uri) continue;
    const key = `${uri}|${String(row?.content_hash || '').trim()}`;
    if (!dedupe.has(key)) {
      dedupe.set(key, {
        id: String(row?.id || '').trim() || '',
        kind: String(row?.kind || row?.type || '').trim() || 'visual_asset',
        source_id: String(row?.source_id || '').trim() || '',
        source_url: String(row?.source_url || row?.url || '').trim() || '',
        file_uri: uri,
        mime_type: String(row?.mime_type || '').trim() || '',
        content_hash: String(row?.content_hash || '').trim() || '',
        width: Number(row?.width || 0) || null,
        height: Number(row?.height || 0) || null,
        size_bytes: Number(row?.size_bytes || 0) || null,
        surface: String(row?.surface || '').trim() || ''
      });
    }
  }
  return [...dedupe.values()];
}

function shouldSendPrimeSourceVisuals({
  routeMatrixPolicy = null
} = {}) {
  const componentSend = String(routeMatrixPolicy?.component_values_send || '').trim().toLowerCase();
  const scalarSend = String(routeMatrixPolicy?.scalar_linked_send || '').trim().toLowerCase();
  const listSend = String(routeMatrixPolicy?.list_values_send || '').trim().toLowerCase();
  const explicit = routeMatrixPolicy?.table_linked_send ?? routeMatrixPolicy?.prime_sources_visual_send ?? null;
  if (explicit !== null && explicit !== undefined && String(explicit).trim() !== '') {
    if (typeof explicit === 'boolean') {
      return explicit;
    }
    const token = String(explicit).trim().toLowerCase();
    if (token === 'true' || token === '1' || token === 'yes' || token === 'on') return true;
    if (token === 'false' || token === '0' || token === 'no' || token === 'off') return false;
    return token.includes('prime');
  }
  if (componentSend.includes('prime')) {
    return true;
  }
  if (scalarSend.includes('prime')) {
    return true;
  }
  if (listSend.includes('prime')) {
    return true;
  }
  return false;
}

function buildMultimodalUserInput({
  userPayload = {},
  promptEvidence = {},
  scopedEvidencePack = {},
  routeMatrixPolicy = null,
  maxImages = 6
} = {}) {
  const text = JSON.stringify(userPayload);
  const allowImages = shouldSendPrimeSourceVisuals({ routeMatrixPolicy });
  if (!allowImages) {
    return {
      text,
      images: []
    };
  }
  const visuals = normalizeVisualAssetsFromEvidencePack(scopedEvidencePack);
  const rankedVisuals = visuals
    .map((row) => ({
      ...row,
      ref_match: (promptEvidence.references || []).some((ref) => String(ref?.file_uri || '').trim() === row.file_uri) ? 1 : 0
    }))
    .sort((a, b) => {
      if (b.ref_match !== a.ref_match) return b.ref_match - a.ref_match;
      const aSize = Number(a.size_bytes || 0);
      const bSize = Number(b.size_bytes || 0);
      return bSize - aSize;
    })
    .slice(0, Math.max(1, Number(maxImages || 6)));

  const images = rankedVisuals.map((row) => ({
    id: row.id || '',
    file_uri: row.file_uri,
    mime_type: row.mime_type || '',
    content_hash: row.content_hash || '',
    kind: row.kind || '',
    source_id: row.source_id || '',
    source_url: row.source_url || '',
    caption: [
      row.kind ? `kind=${row.kind}` : '',
      row.surface ? `surface=${row.surface}` : '',
      row.width && row.height ? `size=${row.width}x${row.height}` : ''
    ].filter(Boolean).join(' | ')
  }));
  if (images.length === 0) {
    const fallbackScreenshotUri = String(scopedEvidencePack?.meta?.visual_artifacts?.screenshot_uri || '').trim();
    if (fallbackScreenshotUri) {
      images.push({
        id: `img_fallback_${sha256(fallbackScreenshotUri).slice(7, 19)}`,
        file_uri: fallbackScreenshotUri,
        mime_type: inferImageMimeFromUri(fallbackScreenshotUri),
        content_hash: String(scopedEvidencePack?.meta?.visual_artifacts?.screenshot_content_hash || '').trim(),
        kind: 'screenshot_capture',
        source_id: String(scopedEvidencePack?.meta?.source_id || '').trim(),
        source_url: String(scopedEvidencePack?.meta?.url || '').trim(),
        caption: 'kind=screenshot_capture | source=meta_fallback'
      });
    }
  }

  return {
    text,
    images
  };
}

function buildBatchEvidence(evidencePack = {}, batchFields = [], config = {}) {
  const wantedFields = uniqueTokens((batchFields || []).map((field) => String(field || '').trim().toLowerCase()));
  const wanted = new Set(wantedFields);
  const wantsOnlyIdentity = wantedFields.length > 0 && wantedFields.every((field) => IDENTITY_FIELDS.has(field));
  const { snippetById, refById } = collectSnippetAndRefMaps(evidencePack);
  const selectedSnippets = [];
  const selectedRefs = [];
  const selectedIds = new Set();
  const scoredSnippets = [];

  const allSnippets = [...snippetById.entries()].map(([id, row]) => ({
    id,
    ...row
  }));

  for (const snippet of allSnippets) {
    const snippetType = String(snippet?.type || '').toLowerCase();
    const normalizedText = String(snippet?.normalized_text || snippet?.text || '');
    const text = normalizedText.toLowerCase();
    const hints = fieldHintSet(snippet);
    const hintHits = wantedFields.filter((field) => hints.has(field)).length;
    const lexicalHits = wantedFields.reduce((acc, field) => acc + countTokenHits(text, fieldTokens(field)), 0);
    const dimensionSignal = hasDimensionSignal(text);
    const relevant = hintHits > 0 || lexicalHits > 0;
    if (!relevant) {
      continue;
    }
    if (!wantsOnlyIdentity && snippetType.includes('json_ld') && lexicalHits === 0) {
      // JSON-LD is useful for identity/commerce; for strict spec extraction it often adds noisy dimensions.
      continue;
    }
    if (config.llmExtractSkipLowSignal !== false && lexicalHits === 0 && hintHits === 0) {
      continue;
    }
    const score =
      (hintHits * 5) +
      (lexicalHits * 3) +
      (dimensionSignal ? 2 : 0) +
      (snippetType === 'text' || snippetType === 'window' ? 1 : 0);
    scoredSnippets.push({
      ...snippet,
      _score: score,
      _length: normalizedText.length
    });
  }

  const maxSnippets = Math.max(1, Number.parseInt(String(config.llmExtractMaxSnippetsPerBatch || 6), 10) || 6);
  scoredSnippets
    .sort((a, b) => (b._score - a._score) || (a._length - b._length))
    .slice(0, maxSnippets)
    .forEach((snippet) => {
      selectedSnippets.push(snippet);
      selectedIds.add(snippet.id);
    });

  if (selectedSnippets.length === 0) {
    return {
      references: [],
      snippets: [],
      visual_assets: []
    };
  }

  for (const id of selectedIds) {
    if (refById.has(id)) {
      const row = refById.get(id);
      selectedRefs.push({
        id: String(row?.id || id).trim(),
        source_id: row?.source_id || row?.source || '',
        url: row?.url || '',
        type: row?.type || 'text',
        snippet_hash: row?.snippet_hash || '',
        file_uri: row?.file_uri || '',
        mime_type: row?.mime_type || '',
        content_hash: row?.content_hash || '',
        width: Number(row?.width || 0) || null,
        height: Number(row?.height || 0) || null,
        size_bytes: Number(row?.size_bytes || 0) || null,
        surface: row?.surface || ''
      });
      continue;
    }
    const snippet = snippetById.get(id);
    if (!snippet) {
      continue;
    }
    selectedRefs.push({
      id,
      url: snippet?.url || evidencePack?.meta?.url || '',
      type: snippet?.type || 'text',
      source_id: snippet?.source_id || snippet?.source || '',
      snippet_hash: snippet?.snippet_hash || '',
      file_uri: snippet?.file_uri || '',
      mime_type: snippet?.mime_type || '',
      content_hash: snippet?.content_hash || '',
      width: Number(snippet?.width || 0) || null,
      height: Number(snippet?.height || 0) || null,
      size_bytes: Number(snippet?.size_bytes || 0) || null,
      surface: snippet?.surface || ''
    });
  }

  const selectedRefUris = new Set(
    selectedRefs
      .map((row) => String(row?.file_uri || '').trim())
      .filter(Boolean)
  );
  const selectedSourceIds = new Set(
    selectedRefs
      .map((row) => String(row?.source_id || '').trim())
      .filter(Boolean)
  );
  const selectedSourceTokens = new Set(
    [...selectedSourceIds]
      .map((token) => normalizeSourceToken(token))
      .filter(Boolean)
  );
  const selectedHosts = new Set(
    selectedRefs
      .map((row) => hostFromUrl(row?.url || ''))
      .filter(Boolean)
  );
  const selectedVisualAssets = normalizeVisualAssetsFromEvidencePack(evidencePack).filter((row) => {
    const uri = String(row?.file_uri || '').trim();
    const sourceId = String(row?.source_id || '').trim();
    const sourceToken = normalizeSourceToken(sourceId);
    const sourceHost = hostFromUrl(row?.source_url || '');
    if (uri && selectedRefUris.has(uri)) {
      return true;
    }
    if (sourceId && selectedSourceIds.has(sourceId)) {
      return true;
    }
    if (sourceToken && selectedSourceTokens.has(sourceToken)) {
      return true;
    }
    if (sourceHost && selectedHosts.has(sourceHost)) {
      return true;
    }
    return false;
  });

  return {
    references: selectedRefs,
    snippets: selectedSnippets.map(({ _score, _length, ...row }) => row),
    visual_assets: selectedVisualAssets
  };
}

function sanitizeExtractionResult({
  result,
  job,
  fieldSet,
  validRefs,
  evidencePack,
  minEvidenceRefsByField = {}
}) {
  const identityCandidates = sanitizeIdentity(result?.identityCandidates, job.identityLock || {});
  const fieldCandidates = [];
  let droppedByEvidenceVerifier = 0;
  let droppedUnknownField = 0;
  let droppedUnknownValue = 0;
  let droppedMissingRefs = 0;
  let droppedInsufficientRefs = 0;
  let droppedInvalidRefs = 0;
  const rawFieldCandidates = Array.isArray(result?.fieldCandidates) ? result.fieldCandidates : [];

  for (const row of rawFieldCandidates) {
    const field = String(row.field || '').trim();
    const value = normalizeCandidateValue(row.value);
    const originalRefs = Array.isArray(row?.evidenceRefs)
      ? row.evidenceRefs.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    const refs = filterEvidenceRefs(row.evidenceRefs, validRefs);

    if (!fieldSet.has(field)) {
      droppedUnknownField += 1;
      continue;
    }
    if (!hasKnownValue(value)) {
      droppedUnknownValue += 1;
      continue;
    }
    if (!refs.length) {
      droppedMissingRefs += 1;
      if (originalRefs.length > 0) {
        droppedInvalidRefs += 1;
      }
      continue;
    }
    const requiredMinRefs = Math.max(
      1,
      Number.parseInt(String(minEvidenceRefsByField?.[field] ?? 1), 10) || 1
    );
    if (refs.length < requiredMinRefs) {
      droppedInsufficientRefs += 1;
      continue;
    }

    const candidate = {
      field,
      value,
      method: 'llm_extract',
      keyPath: row.keyPath || 'llm.extract',
      evidenceRefs: refs,
      snippetId: row.snippetId || refs[0] || '',
      snippetHash: row.snippetHash || '',
      quote: row.quote || '',
      quoteSpan: Array.isArray(row.quoteSpan) ? row.quoteSpan : null
    };

    const evidenceCheck = verifyCandidateEvidence({
      candidate,
      evidencePack
    });
    if (!evidenceCheck.ok) {
      droppedByEvidenceVerifier += 1;
      continue;
    }

    fieldCandidates.push({
      field: evidenceCheck.candidate.field,
      value: evidenceCheck.candidate.value,
      method: 'llm_extract',
      keyPath: evidenceCheck.candidate.keyPath || 'llm.extract',
      evidenceRefs: evidenceCheck.candidate.evidenceRefs,
      snippetId: evidenceCheck.candidate.snippetId || '',
      snippetHash: evidenceCheck.candidate.snippetHash || '',
      quote: evidenceCheck.candidate.quote || '',
      quoteSpan: Array.isArray(evidenceCheck.candidate.quoteSpan)
        ? evidenceCheck.candidate.quoteSpan
        : null
    });
  }

  const conflicts = [];
  for (const conflict of result?.conflicts || []) {
    const refs = filterEvidenceRefs(conflict.evidenceRefs, validRefs);
    if (!refs.length) {
      continue;
    }
    conflicts.push({
      field: String(conflict.field || ''),
      values: (conflict.values || []).map((value) => normalizeWhitespace(value)).filter(Boolean),
      evidenceRefs: refs
    });
  }

  const notes = (result?.notes || []).map((note) => normalizeWhitespace(note)).filter(Boolean);
  if (droppedByEvidenceVerifier > 0) {
    notes.push(`Dropped ${droppedByEvidenceVerifier} candidates by evidence verifier.`);
  }
  if (droppedInsufficientRefs > 0) {
    notes.push(`Dropped ${droppedInsufficientRefs} candidates below min_evidence_refs.`);
  }

  return {
    identityCandidates,
    fieldCandidates,
    conflicts,
    notes,
    droppedByEvidenceVerifier,
    metrics: {
      raw_candidate_count: rawFieldCandidates.length,
      accepted_candidate_count: fieldCandidates.length,
      dropped_unknown_field: droppedUnknownField,
      dropped_unknown_value: droppedUnknownValue,
      dropped_missing_refs: droppedMissingRefs,
      dropped_insufficient_refs: droppedInsufficientRefs,
      dropped_invalid_refs: droppedInvalidRefs,
      dropped_evidence_verifier: droppedByEvidenceVerifier
    }
  };
}

function collectRequiredFilled(fieldCandidates = [], requiredFieldSet = new Set()) {
  const filled = new Set();
  for (const row of fieldCandidates || []) {
    const field = String(row?.field || '').trim();
    if (!field || !requiredFieldSet.has(field) || !hasKnownValue(row?.value)) {
      continue;
    }
    filled.add(field);
  }
  return filled;
}

function shouldRunVerifyExtraction(llmContext = {}) {
  return Boolean(llmContext?.verification?.enabled && !llmContext?.verification?.done);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function createEmptyPhase08() {
  return {
    generated_at: new Date().toISOString(),
    summary: {
      batch_count: 0,
      batch_error_count: 0,
      schema_fail_rate: 0,
      raw_candidate_count: 0,
      accepted_candidate_count: 0,
      dangling_snippet_ref_count: 0,
      dangling_snippet_ref_rate: 0,
      evidence_policy_violation_count: 0,
      evidence_policy_violation_rate: 0,
      min_refs_satisfied_count: 0,
      min_refs_total: 0,
      min_refs_satisfied_rate: 0
    },
    batches: [],
    field_contexts: {},
    prime_sources: {
      rows: []
    }
  };
}

function mergePhase08FieldContexts(target = {}, source = {}) {
  const out = { ...(target || {}) };
  for (const [field, context] of Object.entries(source || {})) {
    const key = String(field || '').trim();
    if (!key || out[key]) continue;
    out[key] = context;
  }
  return out;
}

function mergePhase08PrimeRows(target = [], source = []) {
  const out = [...(target || [])];
  const seen = new Set(out.map((row) => `${row?.field_key || ''}|${row?.snippet_id || ''}|${row?.url || ''}`));
  for (const row of source || []) {
    const key = `${row?.field_key || ''}|${row?.snippet_id || ''}|${row?.url || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function buildPromptFieldContracts(categoryConfig = {}, fields = [], componentDBs = {}, knownValuesMap = {}) {
  const ruleMap = categoryConfig?.fieldRules?.fields || {};
  const contracts = {};
  const enumOptions = {};
  const componentRefs = {};

  for (const field of fields || []) {
    const rule = ruleMap[field];
    if (!rule || typeof rule !== 'object') {
      continue;
    }
    const guidance = autoGenerateExtractionGuidance(rule, field);
    const compactGuidance = guidance
      ? String(guidance)
        .split('.')
        .slice(0, 2)
        .map((chunk) => chunk.trim())
        .filter(Boolean)
        .join('. ')
      : '';
    contracts[field] = {
      description: rule.description || rule.tooltip_md || '',
      data_type: ruleType(rule),
      output_shape: ruleShape(rule),
      required_level: ruleRequiredLevel(rule),
      unit: ruleUnit(rule),
      unknown_reason: rule?.unknown_reason || null,
      ...(compactGuidance ? { extraction_guidance: compactGuidance } : {})
    };

    // Merge inline enum values with known_values for this field
    const enumValues = [
      ...toArray(rule?.enum),
      ...toArray(rule?.contract?.enum),
      ...toArray(rule?.validate?.enum)
    ]
      .map((entry) => {
        if (entry && typeof entry === 'object') {
          return String(entry.canonical || entry.value || '').trim();
        }
        return String(entry || '').trim();
      })
      .filter(Boolean);
    // Include known_values for this field (from known_values.json)
    const kvValues = toArray(knownValuesMap[field]);
    for (const v of kvValues) {
      const s = String(v || '').trim();
      if (s) enumValues.push(s);
    }
    if (enumValues.length > 0) {
      enumOptions[field] = [...new Set(enumValues)];
    }

    const componentDbRef = String(rule?.component_db_ref || rule?.component?.type || '').trim();
    if (componentDbRef) {
      // Include entity names from the component DB so the LLM can constrain guesses
      const dbKey = componentDbRef.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      const db = componentDBs[dbKey];
      const entityNames = db?.entries ? Object.values(db.entries).map(e => e.canonical_name).filter(Boolean).sort() : [];
      componentRefs[field] = {
        type: componentDbRef,
        known_entities: entityNames.slice(0, 200) // Cap to avoid prompt bloat
      };
    }
  }

  return {
    contracts,
    enumOptions,
    componentRefs
  };
}

export async function extractCandidatesLLM({
  job,
  categoryConfig,
  evidencePack,
  goldenExamples = [],
  targetFields = null,
  config,
  logger,
  llmContext = {},
  componentDBs = {},
  knownValues = {},
  specDb = null
}) {
  if (!config.llmEnabled || !hasAnyLlmApiKey(config)) {
    return {
      identityCandidates: {},
      fieldCandidates: [],
      conflicts: [],
      notes: ['LLM disabled'],
      phase08: createEmptyPhase08()
    };
  }

  const effectiveFieldOrder = Array.isArray(targetFields) && targetFields.length
    ? targetFields
    : (categoryConfig.fieldOrder || []);
  const fieldRules = categoryConfig?.fieldRules?.fields || {};

  // Flatten knownValues { enums: { field: { values: [...] } } } into { field: [...] }
  const kvEnums = (knownValues && typeof knownValues === 'object' && knownValues.enums) ? knownValues.enums : {};
  const knownValuesFlat = {};
  for (const [k, v] of Object.entries(kvEnums)) {
    if (v && Array.isArray(v.values)) knownValuesFlat[k] = v.values;
  }
  const maxBatchCount = Math.max(1, Number.parseInt(String(config.llmMaxBatchesPerProduct || 7), 10) || 7);
  const batches = buildFieldBatches({
    targetFields: effectiveFieldOrder,
    fieldRules,
    maxBatches: maxBatchCount
  });
  const usableBatches = batches.length > 0
    ? batches.slice(0, maxBatchCount)
    : [{
      id: 'misc',
      fields: effectiveFieldOrder,
      difficulty: { easy: 0, medium: effectiveFieldOrder.length, hard: 0, instrumented: 0 }
    }];

  const budgetGuard = llmContext?.budgetGuard;
  const startDecision = budgetGuard?.canCall({
    reason: 'extract',
    essential: false
  }) || { allowed: true };
  if (!startDecision.allowed) {
    budgetGuard?.block?.(startDecision.reason);
    logger?.warn?.('llm_extract_skipped_budget', {
      reason: startDecision.reason,
      productId: job.productId
    });
    return {
      identityCandidates: {},
      fieldCandidates: [],
      conflicts: [],
      notes: ['LLM extraction skipped by budget guard'],
      phase08: createEmptyPhase08()
    };
  }

  const cacheEnabled = Boolean(config.llmExtractionCacheEnabled);
  const cache = cacheEnabled
    ? new LLMCache({
      specDb,
      cacheDir: config.llmExtractionCacheDir || '.specfactory_tmp/llm_cache',
      defaultTtlMs: Number(config.llmExtractionCacheTtlMs || 7 * 24 * 60 * 60 * 1000),
      cacheJsonWrite: Boolean(config.cacheJsonWrite)
    })
    : null;
  let cacheHits = 0;
  const routeMatrixPolicy = llmContext?.route_matrix_policy || llmContext?.routeMatrixPolicy || null;

    const invokeModel = async ({
      model,
      routeRole = 'extract',
      reasoningMode,
      reason,
      maxTokens = 0,
      usageTracker,
      userPayload,
      promptEvidence,
      fieldSet,
      validRefs,
      minEvidenceRefsByField = {},
      scopedEvidencePack,
      routeMatrixPolicy = null
    }) => {
    const defaultExtractMaxTokens = Math.max(
      256,
      Number.parseInt(
        String(config.llmExtractMaxTokens || config.llmMaxTokens || 1200),
        10
      ) || 1200
    );
    const defaultReasoningBudget = Math.max(
      256,
      Number.parseInt(
        String(config.llmExtractReasoningBudget || config.llmReasoningBudget || 4096),
        10
      ) || 4096
    );
    const multimodalUserInput = buildMultimodalUserInput({
      userPayload,
      promptEvidence,
      scopedEvidencePack,
      routeMatrixPolicy,
      maxImages: Math.max(1, Number.parseInt(String(config.llmExtractMaxImagesPerBatch || 6), 10) || 6)
    });
    const result = await callLlmWithRouting({
      config,
      reason,
      role: routeRole,
      modelOverride: model,
      system: [
        'You extract structured hardware spec candidates from evidence snippets.',
        'Rules:',
        '- Focus only on targetFields when provided.',
        '- Only use provided evidence.',
        '- Every proposed field candidate must include evidenceRefs matching provided reference ids.',
        '- If uncertain, omit the candidate.',
        '- Always return object keys: identityCandidates, fieldCandidates, conflicts, notes.',
        '- No prose; JSON only.'
      ].join('\n'),
      user: multimodalUserInput,
      jsonSchema: llmSchema(),
      usageContext: {
        category: job.category || categoryConfig.category || '',
        productId: job.productId || '',
        runId: llmContext.runId || '',
        round: llmContext.round || 0,
        reason,
        host: scopedEvidencePack?.meta?.host || evidencePack?.meta?.host || '',
        url_count: Math.max(0, Number(scopedEvidencePack?.references?.length || 0)),
        evidence_chars: Math.max(0, Number(scopedEvidencePack?.meta?.total_chars || evidencePack?.meta?.total_chars || 0)),
        multimodal_image_count: Array.isArray(multimodalUserInput?.images) ? multimodalUserInput.images.length : 0,
        traceWriter: llmContext.traceWriter || null,
        trace_context: {
          purpose: 'extract_candidates',
          target_fields: [...fieldSet]
        }
      },
      costRates: llmContext.costRates || config,
      onUsage: async (usageRow) => {
        budgetGuard?.recordCall({ costUsd: usageRow.cost_usd });
        if (typeof llmContext.recordUsage === 'function') {
          await llmContext.recordUsage(usageRow);
        }
        if (usageTracker && typeof usageTracker === 'object') {
          usageTracker.prompt_tokens += Number(usageRow.prompt_tokens || 0);
          usageTracker.completion_tokens += Number(usageRow.completion_tokens || 0);
          usageTracker.cost_usd += Number(usageRow.cost_usd || 0);
        }
      },
      reasoningMode: Boolean(reasoningMode),
      reasoningBudget: Number(defaultReasoningBudget),
      maxTokens: Number(maxTokens || defaultExtractMaxTokens),
      timeoutMs: config.llmTimeoutMs || config.openaiTimeoutMs,
      logger
    });

    return sanitizeExtractionResult({
      result,
      job,
      fieldSet,
      validRefs,
      evidencePack: scopedEvidencePack,
      minEvidenceRefsByField
    });
  };

  try {
    let aggregateIdentity = {};
    let aggregateCandidates = [];
    let aggregateConflicts = [];
    let aggregateNotes = [];
    let phase08FieldContexts = {};
    let phase08PrimeRows = [];
    const phase08BatchRows = [];
    let phase08BatchErrorCount = 0;

    for (const batch of usableBatches) {
      const batchStartedAt = Date.now();
      const batchFields = normalizeFieldList(batch.fields || [], {
        fieldOrder: effectiveFieldOrder
      });
      if (!batchFields.length) {
        continue;
      }

      const canCall = budgetGuard?.canCall({
        reason: `extract_batch:${batch.id}`,
        essential: false
      }) || { allowed: true };
      if (!canCall.allowed) {
        budgetGuard?.block?.(canCall.reason);
        logger?.warn?.('llm_extract_batch_skipped_budget', {
          productId: job.productId,
          batch: batch.id,
          reason: canCall.reason
        });
        aggregateNotes.push(`Batch ${batch.id} skipped by budget guard.`);
        phase08BatchRows.push({
          batch_id: String(batch.id || ''),
          status: 'skipped_budget',
          route_reason: 'budget_guard',
          model: '',
          target_field_count: batchFields.length,
          snippet_count: 0,
          reference_count: 0,
          raw_candidate_count: 0,
          accepted_candidate_count: 0,
          dropped_missing_refs: 0,
          dropped_invalid_refs: 0,
          dropped_evidence_verifier: 0,
          min_refs_satisfied_count: 0,
          min_refs_total: 0,
          elapsed_ms: Math.max(0, Date.now() - batchStartedAt)
        });
        continue;
      }

      const scoped = buildBatchEvidence(evidencePack, batchFields, config);
      const validRefs = new Set((scoped.references || []).map((item) => String(item.id || '').trim()).filter(Boolean));
      const fieldSet = new Set(batchFields);
      const contextMatrix = buildExtractionContextMatrix({
        category: job.category || categoryConfig.category || '',
        categoryConfig,
        fields: batchFields,
        componentDBs,
        knownValuesMap: knownValuesFlat,
        evidencePack: scoped,
        options: {
          maxPrimePerField: 3,
          maxPrimeRows: 24,
          maxParseExamples: 2,
          maxComponentEntities: 120,
          maxEnumOptions: 80
        }
      });
      phase08FieldContexts = mergePhase08FieldContexts(phase08FieldContexts, contextMatrix.fields || {});
      phase08PrimeRows = mergePhase08PrimeRows(phase08PrimeRows, contextMatrix?.prime_sources?.rows || []);
      const routeMinRefsFloor = Math.max(
        1,
        Number.parseInt(
          String(
            routeMatrixPolicy?.min_evidence_refs_effective
            ?? routeMatrixPolicy?.llm_output_min_evidence_refs_required
            ?? 1
          ),
          10
        ) || 1
      );
      const minEvidenceRefsByField = {};
      for (const field of batchFields) {
        const fieldMinRefs = Number(contextMatrix?.fields?.[field]?.evidence_policy?.min_evidence_refs || 1);
        minEvidenceRefsByField[field] = Math.max(1, fieldMinRefs, routeMinRefsFloor);
      }
      const modelRoute = resolveBatchModel({
        batch,
        config,
        forcedHighFields: llmContext?.forcedHighFields || [],
        fieldRules
      });
      const model = modelRoute.model || config.llmModelExtract;
      if (!Array.isArray(scoped.snippets) || scoped.snippets.length === 0) {
        logger?.info?.('llm_extract_batch_skipped_no_signal', {
          productId: job.productId,
          batch: batch.id,
          field_count: batchFields.length
        });
        aggregateNotes.push(`Batch ${batch.id} skipped: no relevant evidence snippets.`);
        phase08BatchRows.push({
          batch_id: String(batch.id || ''),
          status: 'skipped_no_signal',
          route_reason: String(modelRoute.reason || ''),
          model: String(model || ''),
          target_field_count: batchFields.length,
          snippet_count: 0,
          reference_count: 0,
          raw_candidate_count: 0,
          accepted_candidate_count: 0,
          dropped_missing_refs: 0,
          dropped_invalid_refs: 0,
          dropped_evidence_verifier: 0,
          min_refs_satisfied_count: 0,
          min_refs_total: 0,
          elapsed_ms: Math.max(0, Date.now() - batchStartedAt)
        });
        continue;
      }
      const promptEvidence = buildPromptEvidencePayload(scoped, config);
      const userPayload = {
        product: {
          productId: job.productId,
          brand: job.identityLock?.brand || '',
          model: job.identityLock?.model || '',
          variant: job.identityLock?.variant || '',
          category: job.category || 'mouse'
        },
        targetFields: batchFields,
        ...buildPromptFieldContracts(categoryConfig, batchFields, componentDBs, knownValuesFlat),
        anchors: job.anchors || {},
        golden_examples: (goldenExamples || []).slice(0, 5),
        extraction_context: {
          summary: contextMatrix.summary || {},
          fields: contextMatrix.fields || {},
          prime_sources: contextMatrix?.prime_sources || { by_field: {}, rows: [] }
        },
        references: promptEvidence.references,
        snippets: promptEvidence.snippets
      };
      logger?.info?.('llm_extract_batch_prompt_profile', {
        productId: job.productId,
        batch: batch.id,
        model,
        route_reason: modelRoute.reason,
        target_field_count: batchFields.length,
        reference_count: promptEvidence.references.length,
        snippet_count: promptEvidence.snippets.length,
        snippet_chars_total: promptEvidence.snippets.reduce(
          (sum, row) => sum + String(row?.text || '').length,
          0
        ),
        visual_asset_count: Array.isArray(scoped?.visual_assets) ? scoped.visual_assets.length : 0,
        prime_source_rows: Number(contextMatrix?.prime_sources?.rows?.length || 0),
        payload_chars: JSON.stringify(userPayload).length
      });

      const cacheKey = cache?.getCacheKey({
        model,
        prompt: {
          batch: batch.id,
          reason: modelRoute.reason
        },
        evidence: {
          fields: batchFields,
          snippets: (scoped.snippets || []).map((row) => ({
            id: row.id,
            snippet_hash: row.snippet_hash || ''
          }))
        },
        extra: {
          productId: job.productId || '',
          runId: llmContext.runId || ''
        }
      });

      let sanitized = null;
      if (cache && cacheKey) {
        const cached = await cache.get(cacheKey);
        if (cached && typeof cached === 'object') {
          sanitized = cached;
          cacheHits += 1;
        }
      }

      if (!sanitized) {
        try {
          sanitized = await invokeModel({
            model,
            routeRole: modelRoute.routeRole || 'extract',
            reasoningMode: Boolean(modelRoute.reasoningMode),
            reason: modelRoute.reason,
            maxTokens: modelRoute.maxTokens || 0,
            usageTracker: null,
            userPayload,
            promptEvidence,
            fieldSet,
            validRefs,
            minEvidenceRefsByField,
            scopedEvidencePack: {
              ...evidencePack,
              references: Array.isArray(evidencePack?.references)
                ? evidencePack.references
                : scoped.references,
              snippets: Array.isArray(evidencePack?.snippets)
                ? evidencePack.snippets
                : scoped.snippets,
              visual_assets: (Array.isArray(scoped.visual_assets) && scoped.visual_assets.length > 0)
                ? scoped.visual_assets
                : (Array.isArray(evidencePack?.visual_assets) ? evidencePack.visual_assets : [])
            },
            routeMatrixPolicy
          });
        } catch (error) {
          phase08BatchErrorCount += 1;
          phase08BatchRows.push({
            batch_id: String(batch.id || ''),
            status: 'failed',
            route_reason: String(modelRoute.reason || ''),
            model: String(model || ''),
            target_field_count: batchFields.length,
            snippet_count: Number(promptEvidence.snippets.length || 0),
            reference_count: Number(promptEvidence.references.length || 0),
            raw_candidate_count: 0,
            accepted_candidate_count: 0,
            dropped_missing_refs: 0,
            dropped_invalid_refs: 0,
            dropped_evidence_verifier: 0,
            min_refs_satisfied_count: 0,
            min_refs_total: 0,
            elapsed_ms: Math.max(0, Date.now() - batchStartedAt),
            error: String(error?.message || 'llm_extract_batch_failed')
          });
          aggregateNotes.push(`Batch ${batch.id} failed: ${error?.message || 'unknown error'}.`);
          logger?.warn?.('llm_extract_batch_failed', {
            productId: job.productId,
            batch: batch.id,
            model,
            reason: modelRoute.reason,
            message: error?.message || 'unknown_error'
          });
          continue;
        }
        if (cache && cacheKey) {
          await cache.set(cacheKey, sanitized);
        }
      }

      const batchMetrics = sanitized?.metrics && typeof sanitized.metrics === 'object'
        ? sanitized.metrics
        : {
          raw_candidate_count: Number(sanitized?.fieldCandidates?.length || 0),
          accepted_candidate_count: Number(sanitized?.fieldCandidates?.length || 0),
          dropped_missing_refs: 0,
          dropped_insufficient_refs: 0,
          dropped_invalid_refs: 0,
          dropped_evidence_verifier: 0
        };
      let minRefsSatisfiedCount = 0;
      let minRefsTotal = 0;
      for (const row of sanitized?.fieldCandidates || []) {
        const field = String(row?.field || '').trim();
        const refsCount = Array.isArray(row?.evidenceRefs) ? row.evidenceRefs.length : 0;
        const minRefs = Number(minEvidenceRefsByField?.[field] || 1);
        minRefsTotal += 1;
        if (refsCount >= Math.max(1, minRefs)) {
          minRefsSatisfiedCount += 1;
        }
      }
      const batchElapsedMs = Math.max(0, Date.now() - batchStartedAt);
      phase08BatchRows.push({
        batch_id: String(batch.id || ''),
        status: 'completed',
        route_reason: String(modelRoute.reason || ''),
        model: String(model || ''),
        target_field_count: batchFields.length,
        snippet_count: Number(promptEvidence.snippets.length || 0),
        reference_count: Number(promptEvidence.references.length || 0),
        raw_candidate_count: Number(batchMetrics.raw_candidate_count || 0),
        accepted_candidate_count: Number(batchMetrics.accepted_candidate_count || 0),
        dropped_missing_refs: Number(batchMetrics.dropped_missing_refs || 0),
        dropped_invalid_refs: Number(batchMetrics.dropped_invalid_refs || 0),
        dropped_evidence_verifier: Number(batchMetrics.dropped_evidence_verifier || 0),
        min_refs_satisfied_count: Number(minRefsSatisfiedCount || 0),
        min_refs_total: Number(minRefsTotal || 0),
        elapsed_ms: batchElapsedMs
      });
      logger?.info?.('llm_extract_batch_outcome', {
        productId: job.productId,
        batch: batch.id,
        model,
        status: 'completed',
        raw_candidate_count: Number(batchMetrics.raw_candidate_count || 0),
        accepted_candidate_count: Number(batchMetrics.accepted_candidate_count || 0),
        dropped_missing_refs: Number(batchMetrics.dropped_missing_refs || 0),
        dropped_invalid_refs: Number(batchMetrics.dropped_invalid_refs || 0),
        dropped_evidence_verifier: Number(batchMetrics.dropped_evidence_verifier || 0),
        min_refs_satisfied_count: Number(minRefsSatisfiedCount || 0),
        min_refs_total: Number(minRefsTotal || 0),
        elapsed_ms: batchElapsedMs
      });

      // Stamp model attribution on each candidate
      for (const cand of sanitized.fieldCandidates || []) {
        cand.llm_extract_model = model || config.llmModelExtract || '';
        cand.llm_extract_provider = config.llmProvider || '';
      }

      aggregateIdentity = {
        ...aggregateIdentity,
        ...sanitized.identityCandidates
      };
      aggregateCandidates.push(...(sanitized.fieldCandidates || []));
      aggregateConflicts.push(...(sanitized.conflicts || []));
      aggregateNotes.push(...(sanitized.notes || []));
    }

    const primary = {
      identityCandidates: aggregateIdentity,
      fieldCandidates: dedupeFieldCandidates(aggregateCandidates),
      conflicts: aggregateConflicts,
      notes: aggregateNotes
    };
    const phase08RawCandidateCount = phase08BatchRows.reduce((sum, row) => sum + Number(row?.raw_candidate_count || 0), 0);
    const phase08AcceptedCandidateCount = phase08BatchRows.reduce((sum, row) => sum + Number(row?.accepted_candidate_count || 0), 0);
    const phase08DanglingRefCount = phase08BatchRows.reduce((sum, row) => sum + Number(row?.dropped_invalid_refs || 0), 0);
    const phase08PolicyViolationCount = phase08BatchRows.reduce(
      (sum, row) => sum
        + Number(row?.dropped_missing_refs || 0)
        + Number(row?.dropped_invalid_refs || 0)
        + Number(row?.dropped_evidence_verifier || 0),
      0
    );
    const phase08MinRefsSatisfiedCount = phase08BatchRows.reduce((sum, row) => sum + Number(row?.min_refs_satisfied_count || 0), 0);
    const phase08MinRefsTotal = phase08BatchRows.reduce((sum, row) => sum + Number(row?.min_refs_total || 0), 0);
    const phase08BatchCount = phase08BatchRows.length;
    primary.phase08 = {
      generated_at: new Date().toISOString(),
      summary: {
        batch_count: phase08BatchCount,
        batch_error_count: phase08BatchErrorCount,
        schema_fail_rate: phase08BatchCount > 0
          ? Number((phase08BatchErrorCount / phase08BatchCount).toFixed(6))
          : 0,
        raw_candidate_count: phase08RawCandidateCount,
        accepted_candidate_count: phase08AcceptedCandidateCount,
        dangling_snippet_ref_count: phase08DanglingRefCount,
        dangling_snippet_ref_rate: phase08RawCandidateCount > 0
          ? Number((phase08DanglingRefCount / phase08RawCandidateCount).toFixed(6))
          : 0,
        evidence_policy_violation_count: phase08PolicyViolationCount,
        evidence_policy_violation_rate: phase08RawCandidateCount > 0
          ? Number((phase08PolicyViolationCount / phase08RawCandidateCount).toFixed(6))
          : 0,
        min_refs_satisfied_count: phase08MinRefsSatisfiedCount,
        min_refs_total: phase08MinRefsTotal,
        min_refs_satisfied_rate: phase08MinRefsTotal > 0
          ? Number((phase08MinRefsSatisfiedCount / phase08MinRefsTotal).toFixed(6))
          : 0
      },
      batches: phase08BatchRows,
      field_contexts: phase08FieldContexts,
      prime_sources: {
        rows: phase08PrimeRows.slice(0, 120)
      }
    };
    if (cacheHits > 0) {
      primary.notes.push(`LLM cache hits: ${cacheHits}.`);
    }

    if (shouldRunVerifyExtraction(llmContext) && usableBatches.length > 0) {
      llmContext.verification.done = true;
      const aggressiveVerifyMode =
        String(llmContext?.mode || '').toLowerCase() === 'aggressive' &&
        String(llmContext?.verification?.trigger || '').toLowerCase() === 'aggressive_always';
      const verifyBatchLimit = aggressiveVerifyMode
        ? Math.max(1, Number.parseInt(String(config.llmVerifyAggressiveBatchCount || 3), 10) || 3)
        : 1;
      // Mode-aware verification: prioritize batches with judge fields, skip all-advisory batches
      const verifyBatches = usableBatches
        .filter((batch) => {
          const fields = batch.fields || [];
          const allAdvisory = fields.length > 0 && fields.every((f) => {
            const rule = fieldRules[f];
            return rule && typeof rule === 'object' && ruleAiMode(rule) === 'advisory';
          });
          return !allAdvisory;
        })
        .sort((a, b) => {
          // Prioritize batches containing judge fields
          const aHasJudge = (a.fields || []).some((f) => {
            const rule = fieldRules[f];
            return rule && typeof rule === 'object' && ruleAiMode(rule) === 'judge';
          });
          const bHasJudge = (b.fields || []).some((f) => {
            const rule = fieldRules[f];
            return rule && typeof rule === 'object' && ruleAiMode(rule) === 'judge';
          });
          if (aHasJudge !== bHasJudge) return aHasJudge ? -1 : 1;
          return 0;
        })
        .slice(0, verifyBatchLimit);
      const usageFast = { prompt_tokens: 0, completion_tokens: 0, cost_usd: 0 };
      const usageReason = { prompt_tokens: 0, completion_tokens: 0, cost_usd: 0 };
      const fastModel = String(config.llmModelFast || config.llmModelPlan || '').trim();
      const reasonModel = String(config.llmModelExtract || '').trim();
      const requiredSet = new Set(normalizeFieldList(categoryConfig.requiredFields || [], {
        fieldOrder: categoryConfig.fieldOrder || []
      }));
      const fastRequiredFields = new Set();
      const reasonRequiredFields = new Set();
      const verifyBatchStats = [];
      let fastConflictCount = 0;
      let reasonConflictCount = 0;
      let fastCandidateCount = 0;
      let reasonCandidateCount = 0;

      try {
        for (const verifyBatch of verifyBatches) {
          const verifyFields = normalizeFieldList(verifyBatch.fields || [], {
            fieldOrder: effectiveFieldOrder
          });
          if (!verifyFields.length) {
            continue;
          }
          const verifyScoped = buildBatchEvidence(evidencePack, verifyFields, config);
          const verifyRefs = new Set((verifyScoped.references || []).map((item) => String(item.id || '').trim()).filter(Boolean));
          const verifyFieldSet = new Set(verifyFields);
          const verifyPromptEvidence = buildPromptEvidencePayload(verifyScoped, config);
          const verifyContextMatrix = buildExtractionContextMatrix({
            category: job.category || categoryConfig.category || '',
            categoryConfig,
            fields: verifyFields,
            componentDBs,
            knownValuesMap: knownValuesFlat,
            evidencePack: verifyScoped,
            options: {
              maxPrimePerField: 2,
              maxPrimeRows: 16,
              maxParseExamples: 2,
              maxComponentEntities: 80,
              maxEnumOptions: 60
            }
          });
          const verifyPayload = {
            product: {
              productId: job.productId,
              brand: job.identityLock?.brand || '',
              model: job.identityLock?.model || '',
              variant: job.identityLock?.variant || '',
              category: job.category || 'mouse'
            },
            targetFields: verifyFields,
            ...buildPromptFieldContracts(categoryConfig, verifyFields, componentDBs, knownValuesFlat),
            anchors: job.anchors || {},
            golden_examples: (goldenExamples || []).slice(0, 5),
            extraction_context: {
              summary: verifyContextMatrix.summary || {},
              fields: verifyContextMatrix.fields || {},
              prime_sources: verifyContextMatrix?.prime_sources || { by_field: {}, rows: [] }
            },
            references: verifyPromptEvidence.references,
            snippets: verifyPromptEvidence.snippets
          };

          let fastResult = null;
          let reasonResult = null;

          if (fastModel) {
            const canFastCall = budgetGuard?.canCall({
              reason: 'verify_extract_fast',
              essential: false
            }) || { allowed: true };
            if (canFastCall.allowed) {
              fastResult = await invokeModel({
                model: fastModel,
                routeRole: 'plan',
                reasoningMode: false,
                reason: 'verify_extract_fast',
                usageTracker: usageFast,
                userPayload: verifyPayload,
                promptEvidence: verifyPromptEvidence,
                fieldSet: verifyFieldSet,
                validRefs: verifyRefs,
                scopedEvidencePack: {
                  ...evidencePack,
                  references: Array.isArray(evidencePack?.references)
                    ? evidencePack.references
                    : verifyScoped.references,
                  snippets: Array.isArray(evidencePack?.snippets)
                    ? evidencePack.snippets
                    : verifyScoped.snippets,
                  visual_assets: (Array.isArray(verifyScoped.visual_assets) && verifyScoped.visual_assets.length > 0)
                    ? verifyScoped.visual_assets
                    : (Array.isArray(evidencePack?.visual_assets) ? evidencePack.visual_assets : [])
                },
                routeMatrixPolicy
              });
            }
          }

          if (reasonModel) {
            const canReasonCall = budgetGuard?.canCall({
              reason: 'verify_extract_reason',
              essential: false
            }) || { allowed: true };
            if (canReasonCall.allowed) {
              reasonResult = await invokeModel({
                model: reasonModel,
                routeRole: 'extract',
                reasoningMode: true,
                reason: 'verify_extract_reason',
                usageTracker: usageReason,
                userPayload: verifyPayload,
                promptEvidence: verifyPromptEvidence,
                fieldSet: verifyFieldSet,
                validRefs: verifyRefs,
                scopedEvidencePack: {
                  ...evidencePack,
                  references: Array.isArray(evidencePack?.references)
                    ? evidencePack.references
                    : verifyScoped.references,
                  snippets: Array.isArray(evidencePack?.snippets)
                    ? evidencePack.snippets
                    : verifyScoped.snippets,
                  visual_assets: (Array.isArray(verifyScoped.visual_assets) && verifyScoped.visual_assets.length > 0)
                    ? verifyScoped.visual_assets
                    : (Array.isArray(evidencePack?.visual_assets) ? evidencePack.visual_assets : [])
                },
                routeMatrixPolicy
              });
            }
          }

          const fastSet = collectRequiredFilled(fastResult?.fieldCandidates || [], requiredSet);
          for (const field of fastSet) {
            fastRequiredFields.add(field);
          }
          const reasonSet = collectRequiredFilled(reasonResult?.fieldCandidates || [], requiredSet);
          for (const field of reasonSet) {
            reasonRequiredFields.add(field);
          }
          fastConflictCount += (fastResult?.conflicts || []).length;
          reasonConflictCount += (reasonResult?.conflicts || []).length;
          fastCandidateCount += (fastResult?.fieldCandidates || []).length;
          reasonCandidateCount += (reasonResult?.fieldCandidates || []).length;

          verifyBatchStats.push({
            batch_id: String(verifyBatch.id || ''),
            field_count: verifyFields.length,
            fast_required_filled_count: fastSet.size,
            reason_required_filled_count: reasonSet.size
          });
        }

        if (verifyBatchStats.length > 0) {
          const fastRequired = fastRequiredFields.size;
          const reasonRequired = reasonRequiredFields.size;
          const reportKey = await appendLlmVerificationReport({
            storage: llmContext.storage,
            category: job.category || categoryConfig.category || '',
            entry: {
              ts: new Date().toISOString(),
              category: job.category || categoryConfig.category || '',
              productId: job.productId || '',
              runId: llmContext.runId || '',
              round: llmContext.round || 0,
              source_url: evidencePack?.meta?.url || '',
              trigger: llmContext.verification.trigger || 'sampling',
              fast_model: fastModel || null,
              reason_model: reasonModel || null,
              verify_batch_count: verifyBatchStats.length,
              verify_batches: verifyBatchStats,
              fast_required_filled_count: fastRequired,
              reason_required_filled_count: reasonRequired,
              fast_conflict_count: fastConflictCount,
              reason_conflict_count: reasonConflictCount,
              fast_candidate_count: fastCandidateCount,
              reason_candidate_count: reasonCandidateCount,
              fast_cost_usd: Number(usageFast.cost_usd || 0),
              reason_cost_usd: Number(usageReason.cost_usd || 0),
              better_model: reasonRequired > fastRequired
                ? 'reason_model'
                : fastRequired > reasonRequired
                  ? 'fast_model'
                  : 'tie'
            }
          });
          llmContext.verification.report_key = reportKey;
          logger?.info?.('llm_verify_report_written', {
            productId: job.productId,
            runId: llmContext.runId,
            report_key: reportKey,
            fast_model: fastModel,
            reason_model: reasonModel,
            verify_batch_count: verifyBatchStats.length,
            fast_required_filled_count: fastRequired,
            reason_required_filled_count: reasonRequired
          });
        }
      } catch (verifyError) {
        logger?.warn?.('llm_verify_failed', {
          productId: job.productId,
          message: verifyError.message
        });
      }
    }

    logger?.info?.('llm_extract_completed', {
      model: config.llmModelExtract,
      candidate_count: primary.fieldCandidates.length,
      conflict_count: primary.conflicts.length,
      batch_count: usableBatches.length,
      cache_hits: cacheHits
    });

    return primary;
  } catch (error) {
    logger?.warn?.('llm_extract_failed', { message: error.message });
    return {
      identityCandidates: {},
      fieldCandidates: [],
      conflicts: [],
      notes: ['LLM extraction failed'],
      phase08: createEmptyPhase08()
    };
  }
}
