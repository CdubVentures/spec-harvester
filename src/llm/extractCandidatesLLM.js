import { normalizeWhitespace } from '../utils/common.js';
import { callOpenAI } from './openaiClient.js';

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
            value: { type: 'string' },
            keyPath: { type: 'string' },
            evidenceRefs: {
              type: 'array',
              items: { type: 'string' }
            }
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

export async function extractCandidatesLLM({
  job,
  categoryConfig,
  evidencePack,
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
  const fieldSet = new Set(effectiveFieldOrder);
  const validRefs = new Set((evidencePack.references || []).map((item) => item.id));
  const budgetGuard = llmContext?.budgetGuard;
  const budgetDecision = budgetGuard?.canCall({
    reason: 'extract',
    essential: false
  }) || { allowed: true };
  if (!budgetDecision.allowed) {
    budgetGuard?.block?.(budgetDecision.reason);
    logger?.warn?.('llm_extract_skipped_budget', {
      reason: budgetDecision.reason,
      productId: job.productId
    });
    return {
      identityCandidates: {},
      fieldCandidates: [],
      conflicts: [],
      notes: ['LLM extraction skipped by budget guard']
    };
  }

  const system = [
    'You extract structured hardware spec candidates from evidence snippets.',
    'Rules:',
    '- Focus only on targetFields when provided.',
    '- Only use provided evidence.',
    '- Every proposed field candidate must include evidenceRefs matching provided reference ids.',
    '- If uncertain, omit the candidate.',
    '- No prose; JSON only.'
  ].join('\n');

  const userPayload = {
    product: {
      productId: job.productId,
      brand: job.identityLock?.brand || '',
      model: job.identityLock?.model || '',
      variant: job.identityLock?.variant || '',
      category: job.category || 'mouse'
    },
    schemaFields: categoryConfig.fieldOrder || [],
    targetFields: effectiveFieldOrder,
    anchors: job.anchors || {},
    references: evidencePack.references || [],
    snippets: evidencePack.snippets || []
  };

  try {
    const result = await callOpenAI({
      model: config.llmModelExtract,
      system,
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
        reason: 'extract',
        host: evidencePack?.meta?.host || '',
        url_count: Math.max(0, Number(evidencePack?.references?.length || 0)),
        evidence_chars: Math.max(0, Number(evidencePack?.meta?.total_chars || 0))
      },
      costRates: llmContext.costRates || config,
      onUsage: async (usageRow) => {
        budgetGuard?.recordCall({ costUsd: usageRow.cost_usd });
        if (typeof llmContext.recordUsage === 'function') {
          await llmContext.recordUsage(usageRow);
        }
      },
      reasoningMode: Boolean(config.llmReasoningMode),
      reasoningBudget: Number(config.llmReasoningBudget || 0),
      timeoutMs: config.llmTimeoutMs || config.openaiTimeoutMs,
      logger
    });

    const identityCandidates = sanitizeIdentity(result.identityCandidates, job.identityLock || {});

    const fieldCandidates = [];
    for (const row of result.fieldCandidates || []) {
      const field = String(row.field || '').trim();
      const value = normalizeWhitespace(row.value);
      const refs = filterEvidenceRefs(row.evidenceRefs, validRefs);

      if (!fieldSet.has(field)) {
        continue;
      }
      if (!value || value.toLowerCase() === 'unk') {
        continue;
      }
      if (!refs.length) {
        continue;
      }

      fieldCandidates.push({
        field,
        value,
        method: 'llm_extract',
        keyPath: row.keyPath || 'llm.extract',
        evidenceRefs: refs
      });
    }

    const conflicts = [];
    for (const conflict of result.conflicts || []) {
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

    return {
      identityCandidates,
      fieldCandidates,
      conflicts,
      notes: (result.notes || []).map((note) => normalizeWhitespace(note)).filter(Boolean)
    };
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
