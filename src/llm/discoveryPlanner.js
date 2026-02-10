import { callOpenAI } from './openaiClient.js';

function querySchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      queries: {
        type: 'array',
        items: { type: 'string' }
      }
    },
    required: ['queries']
  };
}

function normalizeQuery(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function planDiscoveryQueriesLLM({
  job,
  categoryConfig,
  baseQueries,
  missingCriticalFields = [],
  config,
  logger,
  llmContext = {}
}) {
  if (!config.llmEnabled || !config.llmPlanDiscoveryQueries || !config.llmApiKey) {
    return [];
  }

  const budgetGuard = llmContext?.budgetGuard;
  const budgetDecision = budgetGuard?.canCall({
    reason: 'plan',
    essential: false
  }) || { allowed: true };
  if (!budgetDecision.allowed) {
    budgetGuard?.block?.(budgetDecision.reason);
    logger?.warn?.('llm_discovery_planner_skipped_budget', {
      reason: budgetDecision.reason,
      productId: job.productId
    });
    return [];
  }

  const payload = {
    product: {
      category: job.category || categoryConfig.category,
      brand: job.identityLock?.brand || '',
      model: job.identityLock?.model || '',
      variant: job.identityLock?.variant || ''
    },
    criticalFields: categoryConfig.schema?.critical_fields || [],
    missingCriticalFields,
    existingQueries: baseQueries.slice(0, 20)
  };

  const system = [
    'You generate focused web research queries for hardware specification collection.',
    'Output 5-12 short search queries.',
    'Prioritize manufacturer docs, manuals, instrumented labs, and trusted databases.',
    'Do not include junk domains, login workflows, or irrelevant topics.'
  ].join('\n');

  try {
    const result = await callOpenAI({
      model: config.llmModelPlan,
      system,
      user: JSON.stringify(payload),
      jsonSchema: querySchema(),
      apiKey: config.llmApiKey,
      baseUrl: config.llmBaseUrl,
      provider: config.llmProvider,
      usageContext: {
        category: job.category || categoryConfig.category || '',
        productId: job.productId || '',
        runId: llmContext.runId || '',
        round: llmContext.round || 0,
        reason: 'plan',
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

    return [...new Set((result.queries || []).map((query) => normalizeQuery(query)).filter(Boolean))];
  } catch (error) {
    logger?.warn?.('llm_discovery_planner_failed', { message: error.message });
    return [];
  }
}
