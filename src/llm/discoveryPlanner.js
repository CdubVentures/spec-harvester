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
  logger
}) {
  if (!config.llmEnabled || !config.llmPlanDiscoveryQueries || !config.openaiApiKey) {
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
      model: config.openaiModelPlan,
      system,
      user: JSON.stringify(payload),
      jsonSchema: querySchema(),
      apiKey: config.openaiApiKey,
      baseUrl: config.openaiBaseUrl,
      timeoutMs: config.openaiTimeoutMs,
      logger
    });

    return [...new Set((result.queries || []).map((query) => normalizeQuery(query)).filter(Boolean))];
  } catch (error) {
    logger?.warn?.('llm_discovery_planner_failed', { message: error.message });
    return [];
  }
}
