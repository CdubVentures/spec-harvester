import { callLlmWithRouting, hasLlmRouteApiKey } from '../llm/routing.js';

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeQuery(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function dedupeQueries(rows = [], cap = 24) {
  const out = [];
  const seen = new Set();
  for (const row of rows || []) {
    const query = normalizeQuery(row);
    if (!query) {
      continue;
    }
    const token = query.toLowerCase();
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);
    out.push(query);
    if (out.length >= cap) {
      break;
    }
  }
  return out;
}

function plannerSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      queries: {
        type: 'array',
        items: { type: 'string' }
      },
      preferred_domains: {
        type: 'array',
        items: { type: 'string' }
      },
      negative_filters: {
        type: 'array',
        items: { type: 'string' }
      },
      max_queries: { type: 'integer' },
      max_new_domains: { type: 'integer' },
      sitemap_mode_recommended: { type: 'boolean' }
    },
    required: ['queries']
  };
}

export async function planUberQueries({
  config,
  logger,
  llmContext = {},
  identity = {},
  missingFields = [],
  baseQueries = [],
  frontierSummary = {},
  cap = 16
} = {}) {
  const fallbackQueries = dedupeQueries(baseQueries, Math.max(1, cap));
  if (!config?.llmEnabled || !hasLlmRouteApiKey(config, { role: 'plan' })) {
    return {
      source: 'deterministic',
      queries: fallbackQueries,
      preferred_domains: [],
      negative_filters: [],
      max_queries: Math.max(1, cap),
      max_new_domains: Math.max(1, Math.ceil(cap / 2)),
      sitemap_mode_recommended: false
    };
  }

  const payload = {
    identity_lock: {
      brand: String(identity.brand || ''),
      model: String(identity.model || ''),
      variant: String(identity.variant || ''),
      product_id: String(identity.productId || '')
    },
    missing_fields: toArray(missingFields).slice(0, 40),
    base_queries: fallbackQueries.slice(0, 24),
    frontier_summary: frontierSummary
  };

  try {
    const result = await callLlmWithRouting({
      config,
      reason: 'uber_query_planner',
      role: 'plan',
      modelOverride: String(config.cortexModelSearchFast || config.llmModelFast || config.llmModelPlan || '').trim(),
      system: [
        'You are a search planner for evidence-first hardware specification extraction.',
        'Return strict JSON only.',
        'Prioritize high-yield official/vendor/lab sources first.',
        'Avoid known dead or low-yield patterns and duplicate intents.'
      ].join('\n'),
      user: JSON.stringify(payload),
      jsonSchema: plannerSchema(),
      usageContext: {
        category: llmContext.category || '',
        productId: llmContext.productId || '',
        runId: llmContext.runId || '',
        round: llmContext.round || 0,
        reason: 'uber_query_planner',
        host: '',
        url_count: 0,
        evidence_chars: JSON.stringify(payload).length,
        trace_context: {
          purpose: 'search_planner',
          target_fields: toArray(missingFields).slice(0, 40)
        }
      },
      costRates: llmContext.costRates || config,
      onUsage: async (usageRow) => {
        if (typeof llmContext.recordUsage === 'function') {
          await llmContext.recordUsage(usageRow);
        }
      },
      reasoningMode: false,
      timeoutMs: config.llmTimeoutMs || config.openaiTimeoutMs,
      logger
    });

    const queries = dedupeQueries(result?.queries || [], Math.max(1, cap));
    if (!queries.length) {
      return {
        source: 'deterministic_fallback',
        queries: fallbackQueries,
        preferred_domains: [],
        negative_filters: [],
        max_queries: Math.max(1, cap),
        max_new_domains: Math.max(1, Math.ceil(cap / 2)),
        sitemap_mode_recommended: false
      };
    }
    return {
      source: 'llm',
      queries,
      preferred_domains: dedupeQueries(result?.preferred_domains || [], 20),
      negative_filters: dedupeQueries(result?.negative_filters || [], 40),
      max_queries: Math.max(1, Number.parseInt(String(result?.max_queries || cap), 10) || cap),
      max_new_domains: Math.max(1, Number.parseInt(String(result?.max_new_domains || Math.ceil(cap / 2)), 10) || Math.ceil(cap / 2)),
      sitemap_mode_recommended: Boolean(result?.sitemap_mode_recommended)
    };
  } catch (error) {
    logger?.warn?.('uber_query_planner_failed', {
      message: error.message
    });
    return {
      source: 'deterministic_fallback',
      queries: fallbackQueries,
      preferred_domains: [],
      negative_filters: [],
      max_queries: Math.max(1, cap),
      max_new_domains: Math.max(1, Math.ceil(cap / 2)),
      sitemap_mode_recommended: false
    };
  }
}
