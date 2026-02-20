import { normalizeWhitespace } from '../utils/common.js';
import { normalizeFieldList } from '../utils/fieldKeys.js';
import { appendLlmVerificationReport } from './verificationReport.js';
import { buildFieldBatches, resolveBatchModel } from './fieldBatching.js';
import { LLMCache } from './llmCache.js';
import { verifyCandidateEvidence } from './evidenceVerifier.js';
import { callLlmWithRouting, hasAnyLlmApiKey } from './routing.js';
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
  material: ['material', 'plastic', 'aluminum', 'aluminium', 'magnesium', 'shell', 'body']
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

function buildPromptEvidencePayload(scoped = {}, config = {}) {
  const maxCharsPerSnippet = Math.max(160, Number.parseInt(String(config.llmExtractMaxSnippetChars || 900), 10) || 900);
  const promptRefs = (scoped.references || []).map((row) => ({
    id: String(row?.id || '').trim(),
    source_id: row?.source_id || row?.source || '',
    url: row?.url || '',
    type: row?.type || 'text',
    snippet_hash: row?.snippet_hash || ''
  })).filter((row) => row.id);
  const promptSnippets = (scoped.snippets || []).map((row) => ({
    id: String(row?.id || '').trim(),
    source: row?.source || row?.source_id || '',
    source_id: row?.source_id || row?.source || '',
    type: row?.type || 'text',
    field_hints: Array.isArray(row?.field_hints) ? row.field_hints : [],
    text: clipText(row?.normalized_text || row?.text || '', maxCharsPerSnippet),
    snippet_hash: row?.snippet_hash || '',
    url: row?.url || ''
  })).filter((row) => row.id && row.text);
  return {
    references: promptRefs,
    snippets: promptSnippets
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
      snippets: []
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
        snippet_hash: row?.snippet_hash || ''
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
      snippet_hash: snippet?.snippet_hash || ''
    });
  }

  return {
    references: selectedRefs,
    snippets: selectedSnippets.map(({ _score, _length, ...row }) => row)
  };
}

function sanitizeExtractionResult({
  result,
  job,
  fieldSet,
  validRefs,
  evidencePack
}) {
  const identityCandidates = sanitizeIdentity(result?.identityCandidates, job.identityLock || {});
  const fieldCandidates = [];
  let droppedByEvidenceVerifier = 0;

  for (const row of result?.fieldCandidates || []) {
    const field = String(row.field || '').trim();
    const value = normalizeCandidateValue(row.value);
    const refs = filterEvidenceRefs(row.evidenceRefs, validRefs);

    if (!fieldSet.has(field)) {
      continue;
    }
    if (!hasKnownValue(value)) {
      continue;
    }
    if (!refs.length) {
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

  return {
    identityCandidates,
    fieldCandidates,
    conflicts,
    notes,
    droppedByEvidenceVerifier
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
      notes: ['LLM disabled']
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
      notes: ['LLM extraction skipped by budget guard']
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

    const invokeModel = async ({
      model,
      routeRole = 'extract',
      reasoningMode,
      reason,
      maxTokens = 0,
      usageTracker,
      userPayload,
      fieldSet,
      validRefs,
      scopedEvidencePack
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
      user: JSON.stringify(userPayload),
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
      evidencePack: scopedEvidencePack
    });
  };

  try {
    let aggregateIdentity = {};
    let aggregateCandidates = [];
    let aggregateConflicts = [];
    let aggregateNotes = [];

    for (const batch of usableBatches) {
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
        continue;
      }

      const scoped = buildBatchEvidence(evidencePack, batchFields, config);
      const validRefs = new Set((scoped.references || []).map((item) => String(item.id || '').trim()).filter(Boolean));
      const fieldSet = new Set(batchFields);
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
        sanitized = await invokeModel({
          model,
          routeRole: modelRoute.routeRole || 'extract',
          reasoningMode: Boolean(modelRoute.reasoningMode),
          reason: modelRoute.reason,
          maxTokens: modelRoute.maxTokens || 0,
          usageTracker: null,
          userPayload,
          fieldSet,
          validRefs,
          scopedEvidencePack: {
            ...evidencePack,
            references: scoped.references,
            snippets: scoped.snippets
          }
        });
        if (cache && cacheKey) {
          await cache.set(cacheKey, sanitized);
        }
      }

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
          const verifyPayload = {
            product: {
              productId: job.productId,
              brand: job.identityLock?.brand || '',
              model: job.identityLock?.model || '',
              variant: job.identityLock?.variant || '',
              category: job.category || 'mouse'
            },
            targetFields: verifyFields,
            ...buildPromptFieldContracts(categoryConfig, verifyFields),
            anchors: job.anchors || {},
            golden_examples: (goldenExamples || []).slice(0, 5),
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
                fieldSet: verifyFieldSet,
                validRefs: verifyRefs,
                scopedEvidencePack: {
                  ...evidencePack,
                  references: verifyScoped.references,
                  snippets: verifyScoped.snippets
                }
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
                fieldSet: verifyFieldSet,
                validRefs: verifyRefs,
                scopedEvidencePack: {
                  ...evidencePack,
                  references: verifyScoped.references,
                  snippets: verifyScoped.snippets
                }
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
      notes: ['LLM extraction failed']
    };
  }
}
