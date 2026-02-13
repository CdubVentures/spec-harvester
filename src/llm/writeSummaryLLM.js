import { callLlmWithRouting, hasLlmRouteApiKey } from './routing.js';

function summarySchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      markdown: { type: 'string' }
    },
    required: ['markdown']
  };
}

function validatedFieldSnapshot(normalized, provenance) {
  const fields = {};
  for (const [field, value] of Object.entries(normalized.fields || {})) {
    const text = String(value || '').trim().toLowerCase();
    if (!text || text === 'unk') {
      continue;
    }
    fields[field] = {
      value,
      confirmations: provenance?.[field]?.approved_confirmations || 0,
      evidence_count: (provenance?.[field]?.evidence || []).length
    };
  }
  return fields;
}

export async function writeSummaryMarkdownLLM({
  normalized,
  provenance,
  summary,
  config,
  logger,
  llmContext = {}
}) {
  if (!config.llmEnabled || !config.llmWriteSummary || !hasLlmRouteApiKey(config, { role: 'write' })) {
    return null;
  }

  const budgetGuard = llmContext?.budgetGuard;
  const budgetDecision = budgetGuard?.canCall({
    reason: 'write',
    essential: false
  }) || { allowed: true };
  if (!budgetDecision.allowed) {
    budgetGuard?.block?.(budgetDecision.reason);
    logger?.warn?.('llm_summary_skipped_budget', {
      reason: budgetDecision.reason,
      productId: normalized.productId
    });
    return null;
  }

  const payload = {
    productId: normalized.productId,
    runId: normalized.runId,
    quality: normalized.quality,
    summary: {
      validated: summary.validated,
      validated_reason: summary.validated_reason,
      confidence: summary.confidence,
      completeness_required_percent: summary.completeness_required_percent,
      coverage_overall_percent: summary.coverage_overall_percent
    },
    identity: normalized.identity,
    fields: validatedFieldSnapshot(normalized, provenance)
  };

  const system = [
    'Write concise markdown summary of provided hardware evidence results.',
    'Rules:',
    '- Use only provided values.',
    '- Do not invent or infer missing facts.',
    '- Mention unknowns as unknown where relevant.',
    '- No opinions or recommendations.'
  ].join('\n');

  try {
    const result = await callLlmWithRouting({
      config,
      reason: 'write',
      role: 'write',
      system,
      user: JSON.stringify(payload),
      jsonSchema: summarySchema(),
      usageContext: {
        category: summary.category || '',
        productId: normalized.productId || '',
        runId: normalized.runId || '',
        round: llmContext.round || 0,
        reason: 'write',
        host: '',
        url_count: 0,
        evidence_chars: JSON.stringify(payload).length
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

    const markdown = String(result.markdown || '').trim();
    return markdown ? `${markdown}\n` : null;
  } catch (error) {
    logger?.warn?.('llm_summary_failed', { message: error.message });
    return null;
  }
}
