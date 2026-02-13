import { normalizeWhitespace } from '../utils/common.js';
import { normalizeFieldList } from '../utils/fieldKeys.js';
import { callOpenAI } from './openaiClient.js';
import { appendLlmVerificationReport } from './verificationReport.js';
import { buildFieldBatches, resolveBatchModel } from './fieldBatching.js';
import { LLMCache } from './llmCache.js';
import { verifyCandidateEvidence } from './evidenceVerifier.js';

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

function buildBatchEvidence(evidencePack = {}, batchFields = []) {
  const wanted = new Set((batchFields || []).map((field) => String(field || '').trim().toLowerCase()).filter(Boolean));
  const { snippetById, refById } = collectSnippetAndRefMaps(evidencePack);
  const selectedSnippets = [];
  const selectedRefs = [];
  const selectedIds = new Set();

  const allSnippets = [...snippetById.entries()].map(([id, row]) => ({
    id,
    ...row
  }));

  for (const snippet of allSnippets) {
    const hints = fieldHintSet(snippet);
    const text = String(snippet?.normalized_text || snippet?.text || '').toLowerCase();
    let relevant = false;
    if (hints.size > 0) {
      relevant = [...wanted].some((field) => hints.has(field));
    } else {
      relevant = [...wanted].some((field) => text.includes(field.replace(/_/g, ' ')));
    }
    if (!relevant) {
      continue;
    }
    selectedSnippets.push(snippet);
    selectedIds.add(snippet.id);
  }

  if (selectedSnippets.length === 0) {
    for (const snippet of allSnippets.slice(0, 12)) {
      selectedSnippets.push(snippet);
      selectedIds.add(snippet.id);
    }
  }

  for (const id of selectedIds) {
    if (refById.has(id)) {
      selectedRefs.push(refById.get(id));
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
      content: snippet?.normalized_text || snippet?.text || '',
      snippet_hash: snippet?.snippet_hash || ''
    });
  }

  if (selectedRefs.length === 0 && Array.isArray(evidencePack?.references)) {
    selectedRefs.push(...evidencePack.references);
  }
  if (selectedSnippets.length === 0 && selectedRefs.length > 0) {
    for (const row of selectedRefs) {
      const id = String(row?.id || '').trim();
      if (!id) {
        continue;
      }
      selectedSnippets.push({
        id,
        type: row?.type || 'text',
        normalized_text: row?.content || '',
        snippet_hash: row?.snippet_hash || ''
      });
    }
  }

  return {
    references: selectedRefs,
    snippets: selectedSnippets
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

function countRequiredFilled(fieldCandidates = [], requiredFieldSet = new Set()) {
  const filled = new Set();
  for (const row of fieldCandidates || []) {
    if (!requiredFieldSet.has(row.field) || !hasKnownValue(row.value)) {
      continue;
    }
    filled.add(row.field);
  }
  return filled.size;
}

function shouldRunVerifyExtraction(llmContext = {}) {
  return Boolean(llmContext?.verification?.enabled && !llmContext?.verification?.done);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildPromptFieldContracts(categoryConfig = {}, fields = []) {
  const ruleMap = categoryConfig?.fieldRules?.fields || {};
  const contracts = {};
  const enumOptions = {};
  const componentRefs = {};

  for (const field of fields || []) {
    const rule = ruleMap[field];
    if (!rule || typeof rule !== 'object') {
      continue;
    }
    contracts[field] = {
      description: rule.description || rule.tooltip_md || '',
      data_type: rule.data_type || rule?.contract?.type || 'string',
      output_shape: rule.output_shape || rule?.contract?.shape || 'scalar',
      required_level: rule.required_level || rule?.priority?.required_level || 'optional',
      unit: rule?.contract?.unit || rule.unit || '',
      unknown_reason: rule?.unknown_reason || null
    };

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
    if (enumValues.length > 0) {
      enumOptions[field] = [...new Set(enumValues)];
    }

    const componentDbRef = String(rule?.component_db_ref || '').trim();
    if (componentDbRef) {
      componentRefs[field] = componentDbRef;
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
  llmContext = {}
}) {
  if (!config.llmEnabled || !config.llmApiKey) {
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
      cacheDir: config.llmExtractionCacheDir || '.specfactory_tmp/llm_cache',
      defaultTtlMs: Number(config.llmExtractionCacheTtlMs || 7 * 24 * 60 * 60 * 1000)
    })
    : null;
  let cacheHits = 0;

  const invokeModel = async ({
    model,
    reasoningMode,
    reason,
    usageTracker,
    userPayload,
    fieldSet,
    validRefs,
    scopedEvidencePack
  }) => {
    const result = await callOpenAI({
      model,
      system: [
        'You extract structured hardware spec candidates from evidence snippets.',
        'Rules:',
        '- Focus only on targetFields when provided.',
        '- Only use provided evidence.',
        '- Every proposed field candidate must include evidenceRefs matching provided reference ids.',
        '- If uncertain, omit the candidate.',
        '- No prose; JSON only.'
      ].join('\n'),
      user: JSON.stringify(userPayload),
      jsonSchema: llmSchema(),
      apiKey: config.llmApiKey,
      baseUrl: config.llmBaseUrl,
      provider: config.llmProvider,
      usageContext: {
        category: job.category || categoryConfig.category || '',
        productId: job.productId || '',
        runId: llmContext.runId || '',
        round: llmContext.round || 0,
        reason,
        host: scopedEvidencePack?.meta?.host || evidencePack?.meta?.host || '',
        url_count: Math.max(0, Number(scopedEvidencePack?.references?.length || 0)),
        evidence_chars: Math.max(0, Number(scopedEvidencePack?.meta?.total_chars || evidencePack?.meta?.total_chars || 0))
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
      reasoningBudget: Number(config.llmReasoningBudget || 0),
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

      const scoped = buildBatchEvidence(evidencePack, batchFields);
      const validRefs = new Set((scoped.references || []).map((item) => String(item.id || '').trim()).filter(Boolean));
      const fieldSet = new Set(batchFields);
      const modelRoute = resolveBatchModel({
        batch,
        config
      });
      const model = modelRoute.model || config.llmModelExtract;
      const userPayload = {
        product: {
          productId: job.productId,
          brand: job.identityLock?.brand || '',
          model: job.identityLock?.model || '',
          variant: job.identityLock?.variant || '',
          category: job.category || 'mouse'
        },
        schemaFields: categoryConfig.fieldOrder || [],
        targetFields: batchFields,
        ...buildPromptFieldContracts(categoryConfig, batchFields),
        anchors: job.anchors || {},
        golden_examples: (goldenExamples || []).slice(0, 5),
        references: scoped.references || [],
        snippets: scoped.snippets || []
      };

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
          reasoningMode: Boolean(modelRoute.reasoningMode),
          reason: modelRoute.reason,
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
      const verifyBatch = usableBatches[0];
      const verifyFields = normalizeFieldList(verifyBatch.fields || [], {
        fieldOrder: effectiveFieldOrder
      });
      const verifyScoped = buildBatchEvidence(evidencePack, verifyFields);
      const verifyRefs = new Set((verifyScoped.references || []).map((item) => String(item.id || '').trim()).filter(Boolean));
      const verifyFieldSet = new Set(verifyFields);
      const verifyPayload = {
        product: {
          productId: job.productId,
          brand: job.identityLock?.brand || '',
          model: job.identityLock?.model || '',
          variant: job.identityLock?.variant || '',
          category: job.category || 'mouse'
        },
        schemaFields: categoryConfig.fieldOrder || [],
        targetFields: verifyFields,
        ...buildPromptFieldContracts(categoryConfig, verifyFields),
        anchors: job.anchors || {},
        golden_examples: (goldenExamples || []).slice(0, 5),
        references: verifyScoped.references || [],
        snippets: verifyScoped.snippets || []
      };

      const usageFast = { prompt_tokens: 0, completion_tokens: 0, cost_usd: 0 };
      const usageReason = { prompt_tokens: 0, completion_tokens: 0, cost_usd: 0 };
      const fastModel = String(config.llmModelFast || config.llmModelPlan || '').trim();
      const reasonModel = String(config.llmModelExtract || '').trim();

      try {
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

        if (fastResult || reasonResult) {
          const requiredSet = new Set(normalizeFieldList(categoryConfig.requiredFields || [], {
            fieldOrder: categoryConfig.fieldOrder || []
          }));
          const fastRequired = countRequiredFilled(fastResult?.fieldCandidates || [], requiredSet);
          const reasonRequired = countRequiredFilled(reasonResult?.fieldCandidates || [], requiredSet);
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
              fast_required_filled_count: fastRequired,
              reason_required_filled_count: reasonRequired,
              fast_conflict_count: (fastResult?.conflicts || []).length,
              reason_conflict_count: (reasonResult?.conflicts || []).length,
              fast_candidate_count: (fastResult?.fieldCandidates || []).length,
              reason_candidate_count: (reasonResult?.fieldCandidates || []).length,
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
