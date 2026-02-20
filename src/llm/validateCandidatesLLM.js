import { callLlmWithRouting, hasLlmRouteApiKey } from './routing.js';
import { normalizeFieldList } from '../utils/fieldKeys.js';

function hasKnownValue(value) {
  const token = String(value || '').trim().toLowerCase();
  return token !== '' && token !== 'unk' && token !== 'null' && token !== 'undefined' && token !== 'n/a';
}

function validatorSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      accept: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            field: { type: 'string' },
            value: { type: 'string' },
            reason: { type: 'string' },
            confidence: { type: 'number' },
            evidence_refs: {
              type: 'array',
              items: { type: 'string' }
            }
          },
          required: ['field', 'value', 'reason']
        }
      },
      reject: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            field: { type: 'string' },
            value: { type: 'string' },
            reason: { type: 'string' }
          },
          required: ['field', 'reason']
        }
      },
      unknown: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            field: { type: 'string' },
            unknown_reason: { type: 'string' },
            next_best_queries: {
              type: 'array',
              items: { type: 'string' }
            }
          },
          required: ['field', 'unknown_reason']
        }
      }
    },
    required: ['accept', 'reject', 'unknown']
  };
}

function sanitizeDecisions(result = {}, uncertainSet = new Set()) {
  const accept = [];
  for (const row of result.accept || []) {
    const field = String(row.field || '').trim();
    if (!field || !uncertainSet.has(field)) {
      continue;
    }
    if (!hasKnownValue(row.value)) {
      continue;
    }
    accept.push({
      field,
      value: String(row.value || '').trim(),
      reason: String(row.reason || '').trim() || 'llm_validator_accept',
      confidence: Number(row.confidence || 0),
      evidence_refs: Array.isArray(row.evidence_refs) ? row.evidence_refs.filter(Boolean).slice(0, 20) : []
    });
  }

  const reject = [];
  for (const row of result.reject || []) {
    const field = String(row.field || '').trim();
    if (!field || !uncertainSet.has(field)) {
      continue;
    }
    reject.push({
      field,
      value: String(row.value || '').trim(),
      reason: String(row.reason || '').trim() || 'llm_validator_reject'
    });
  }

  const unknown = [];
  for (const row of result.unknown || []) {
    const field = String(row.field || '').trim();
    if (!field || !uncertainSet.has(field)) {
      continue;
    }
    unknown.push({
      field,
      unknown_reason: String(row.unknown_reason || '').trim() || 'not_found_after_search',
      next_best_queries: Array.isArray(row.next_best_queries)
        ? row.next_best_queries.filter(Boolean).slice(0, 10)
        : []
    });
  }

  return {
    accept,
    reject,
    unknown
  };
}

export async function validateCandidatesLLM({
  job,
  normalized,
  provenance,
  categoryConfig,
  constraints = {},
  uncertainFields = [],
  config,
  logger,
  llmContext = {}
}) {
  const enabled = Boolean(config.llmEnabled && hasLlmRouteApiKey(config, { role: 'validate' }));
  if (!enabled) {
    return {
      enabled: false,
      accept: [],
      reject: [],
      unknown: []
    };
  }

  const fieldOrder = categoryConfig.fieldOrder || [];
  const normalizedUncertain = normalizeFieldList(uncertainFields, { fieldOrder });
  if (!normalizedUncertain.length) {
    return {
      enabled: false,
      accept: [],
      reject: [],
      unknown: []
    };
  }

  const budgetGuard = llmContext?.budgetGuard;
  const budgetDecision = budgetGuard?.canCall({
    reason: 'validate',
    essential: false
  }) || { allowed: true };
  if (!budgetDecision.allowed) {
    budgetGuard?.block?.(budgetDecision.reason);
    logger?.warn?.('llm_validate_skipped_budget', {
      reason: budgetDecision.reason,
      productId: job.productId
    });
    return {
      enabled: false,
      accept: [],
      reject: [],
      unknown: []
    };
  }

  const uncertainSet = new Set(normalizedUncertain);
  const payload = {
    product: {
      productId: job.productId,
      category: job.category || categoryConfig.category || '',
      brand: normalized?.identity?.brand || job.identityLock?.brand || '',
      model: normalized?.identity?.model || job.identityLock?.model || '',
      variant: normalized?.identity?.variant || job.identityLock?.variant || ''
    },
    uncertain_fields: normalizedUncertain,
    current_values: Object.fromEntries(
      normalizedUncertain.map((field) => [field, normalized?.fields?.[field] ?? 'unk'])
    ),
    provenance: Object.fromEntries(
      normalizedUncertain.map((field) => {
        const row = provenance?.[field] || {};
        return [field, {
          value: row.value || 'unk',
          confidence: Number(row.confidence || 0),
          evidence: (row.evidence || []).slice(0, 8).map((item) => ({
            url: item.url,
            tier: item.tier,
            tierName: item.tierName,
            method: item.method,
            keyPath: item.keyPath
          }))
        }];
      })
    ),
    constraints: constraints?.fields || {}
  };

  try {
    const result = await callLlmWithRouting({
      config,
      reason: 'validate',
      role: 'validate',
      system: [
        'You validate uncertain hardware fields against evidence and constraints.',
        'Return JSON only.',
        'Do not guess values without strong evidence.'
      ].join('\n'),
      user: JSON.stringify(payload),
      jsonSchema: validatorSchema(),
      usageContext: {
        category: job.category || categoryConfig.category || '',
        productId: job.productId || '',
        runId: llmContext.runId || '',
        round: llmContext.round || 0,
        reason: 'validate',
        host: '',
        url_count: 0,
        evidence_chars: JSON.stringify(payload).length,
        traceWriter: llmContext.traceWriter || null,
        trace_context: {
          purpose: 'validate_candidates',
          target_fields: normalizedUncertain
        }
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

    const decisions = sanitizeDecisions(result, uncertainSet);
    logger?.info?.('llm_validate_completed', {
      productId: job.productId,
      uncertain_field_count: normalizedUncertain.length,
      accept_count: decisions.accept.length,
      reject_count: decisions.reject.length,
      unknown_count: decisions.unknown.length
    });

    return {
      enabled: true,
      llm_validate_model: config.llmModelValidate || config.llmModelExtract || '',
      llm_validate_provider: config.llmProvider || '',
      ...decisions
    };
  } catch (error) {
    logger?.warn?.('llm_validate_failed', {
      productId: job.productId,
      message: error.message
    });
    return {
      enabled: false,
      accept: [],
      reject: [],
      unknown: []
    };
  }
}
