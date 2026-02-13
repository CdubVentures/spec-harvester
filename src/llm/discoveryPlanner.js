import { callLlmWithRouting, hasLlmRouteApiKey } from './routing.js';

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

function dedupeQueries(rows = [], cap = 24) {
  const out = [];
  const seen = new Set();
  for (const row of rows || []) {
    const query = normalizeQuery(row);
    const normalized = query.toLowerCase();
    if (!query || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(query);
    if (out.length >= Math.max(1, Number(cap || 24))) {
      break;
    }
  }
  return out;
}

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
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
  if (!config.llmEnabled || !config.llmPlanDiscoveryQueries || !hasLlmRouteApiKey(config, { role: 'plan' })) {
    return [];
  }

  const aggressiveMode = String(llmContext?.mode || '').toLowerCase() === 'aggressive';
  const budgetGuard = llmContext?.budgetGuard;
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
  const payloadSize = JSON.stringify(payload).length;

  const baseSystem = [
    'You generate focused web research queries for hardware specification collection.',
    'Output 5-12 short search queries.',
    'Prioritize manufacturer docs, manuals, instrumented labs, and trusted databases.',
    'Do not include junk domains, login workflows, or irrelevant topics.'
  ];

  const passCap = Math.max(1, Math.min(4, toInt(config.aggressiveLlmDiscoveryPasses, 3)));
  const passSpecs = [
    {
      reason: 'discovery_planner_primary',
      modelOverride: String(config.llmModelPlan || '').trim(),
      role: 'plan',
      reasoningMode: false,
      systemSuffix: 'Keep queries compact and practical.'
    }
  ];

  if (aggressiveMode) {
    passSpecs.push({
      reason: 'discovery_planner_fast',
      modelOverride: String(config.llmModelFast || config.llmModelPlan || '').trim(),
      role: 'plan',
      reasoningMode: false,
      systemSuffix: 'Bias toward official manufacturer and support documents first.'
    });
    passSpecs.push({
      reason: 'discovery_planner_reason',
      modelOverride: String(config.llmModelReasoning || config.llmModelExtract || '').trim(),
      role: 'plan',
      reasoningMode: true,
      systemSuffix: 'Prioritize unresolved critical fields and avoid repeating weak query patterns.'
    });
    if ((missingCriticalFields || []).length > 0) {
      passSpecs.push({
        reason: 'discovery_planner_validate',
        modelOverride: String(config.llmModelValidate || config.llmModelReasoning || '').trim(),
        role: 'plan',
        reasoningMode: true,
        systemSuffix: 'Return only high-yield queries for critical field closure.'
      });
    }
  }

  const cappedPasses = passSpecs
    .filter((row) => row.modelOverride)
    .slice(0, passCap);
  if (!cappedPasses.length) {
    return [];
  }

  const allQueries = [];
  for (const pass of cappedPasses) {
    const budgetDecision = budgetGuard?.canCall({
      reason: pass.reason,
      essential: false
    }) || { allowed: true };
    if (!budgetDecision.allowed) {
      budgetGuard?.block?.(budgetDecision.reason);
      logger?.warn?.('llm_discovery_planner_skipped_budget', {
        reason: budgetDecision.reason,
        productId: job.productId,
        pass: pass.reason
      });
      break;
    }

    try {
      const result = await callLlmWithRouting({
        config,
        reason: pass.reason,
        role: pass.role,
        modelOverride: pass.modelOverride,
        system: [...baseSystem, pass.systemSuffix].join('\n'),
        user: JSON.stringify(payload),
        jsonSchema: querySchema(),
        usageContext: {
          category: job.category || categoryConfig.category || '',
          productId: job.productId || '',
          runId: llmContext.runId || '',
          round: llmContext.round || 0,
          reason: pass.reason,
          host: '',
          url_count: 0,
          evidence_chars: payloadSize
        },
        costRates: llmContext.costRates || config,
        onUsage: async (usageRow) => {
          budgetGuard?.recordCall({ costUsd: usageRow.cost_usd });
          if (typeof llmContext.recordUsage === 'function') {
            await llmContext.recordUsage(usageRow);
          }
        },
        reasoningMode: Boolean(pass.reasoningMode || config.llmReasoningMode),
        reasoningBudget: Number(config.llmReasoningBudget || 0),
        timeoutMs: config.llmTimeoutMs || config.openaiTimeoutMs,
        logger
      });
      allQueries.push(...(result?.queries || []));
    } catch (error) {
      logger?.warn?.('llm_discovery_planner_failed', {
        message: error.message,
        pass: pass.reason
      });
    }
  }

  const maxQueryCap = aggressiveMode
    ? Math.max(12, toInt(config.aggressiveLlmDiscoveryQueryCap, 24))
    : Math.max(8, toInt(config.discoveryMaxQueries, 8));
  return dedupeQueries(allQueries, maxQueryCap);
}
