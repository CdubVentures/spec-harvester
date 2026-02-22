function brandResolverSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      official_domain: { type: 'string' },
      aliases: { type: 'array', items: { type: 'string' } },
      support_domain: { type: 'string' }
    },
    required: ['official_domain']
  };
}

function domainSafetySchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      classifications: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            domain: { type: 'string' },
            classification: { type: 'string' },
            reason: { type: 'string' }
          },
          required: ['domain', 'classification']
        }
      }
    },
    required: ['classifications']
  };
}

function urlPredictorSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      predictions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            url: { type: 'string' },
            source_host: { type: 'string' },
            predicted_tier: { type: 'number' },
            confidence: { type: 'number' }
          },
          required: ['url', 'source_host']
        }
      }
    },
    required: ['predictions']
  };
}

function escalationPlannerSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      queries: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            query: { type: 'string' },
            target_fields: { type: 'array', items: { type: 'string' } },
            expected_source_type: { type: 'string' }
          },
          required: ['query']
        }
      }
    },
    required: ['queries']
  };
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

export function createBrandResolverCallLlm({ callRoutedLlmFn, config }) {
  return async ({ brand, category }) => {
    const result = await callRoutedLlmFn({
      config,
      reason: 'brand_resolution',
      role: 'triage',
      modelOverride: String(config.llmModelTriage || config.llmModelFast || '').trim(),
      system: [
        'You resolve official brand website domains for product categories.',
        'Return the official domain (not social media or marketplace).',
        'Include domain aliases and the support subdomain if one exists.',
        'Return strict JSON only.'
      ].join('\n'),
      user: JSON.stringify({ brand, category }),
      jsonSchema: brandResolverSchema(),
      reasoningMode: false,
      timeoutMs: config.llmTimeoutMs || 15000
    });
    return result;
  };
}

export function createDomainSafetyCallLlm({ callRoutedLlmFn, config }) {
  return async ({ domains, category }) => {
    const result = await callRoutedLlmFn({
      config,
      reason: 'domain_safety_classification',
      role: 'triage',
      modelOverride: String(config.llmModelTriage || config.llmModelFast || '').trim(),
      system: [
        'You classify website domains for safety in the context of product specification research.',
        'Classifications: manufacturer, lab_review, spec_database, retail, forum, news, adult_content, malware, irrelevant, unknown.',
        'adult_content and malware domains must be flagged as unsafe.',
        'Return strict JSON only.'
      ].join('\n'),
      user: JSON.stringify({ domains, category }),
      jsonSchema: domainSafetySchema(),
      reasoningMode: false,
      timeoutMs: config.llmTimeoutMs || 15000
    });
    return toArray(result?.classifications || result);
  };
}

export function createUrlPredictorCallLlm({ callRoutedLlmFn, config }) {
  return async ({ product, sources }) => {
    const result = await callRoutedLlmFn({
      config,
      reason: 'url_prediction',
      role: 'triage',
      modelOverride: String(config.llmModelTriage || config.llmModelFast || '').trim(),
      system: [
        'You predict product review and specification URLs on known websites.',
        'Given a product and a list of known source websites, predict the most likely URL for each source.',
        'Only predict URLs for sites that are likely to have a page for this product.',
        'Return strict JSON only.'
      ].join('\n'),
      user: JSON.stringify({ product, sources }),
      jsonSchema: urlPredictorSchema(),
      reasoningMode: false,
      timeoutMs: config.llmTimeoutMs || 15000
    });
    return toArray(result?.predictions || result);
  };
}

export function createEscalationPlannerCallLlm({ callRoutedLlmFn, config }) {
  return async ({ missingFields, product, previousQueries }) => {
    const result = await callRoutedLlmFn({
      config,
      reason: 'escalation_planner',
      role: 'plan',
      modelOverride: String(config.llmModelPlan || '').trim(),
      system: [
        'You generate targeted search queries for missing product specification fields.',
        'Given fields that were NOT found in previous rounds, generate surgical queries targeting specific source types.',
        'Avoid repeating patterns from previousQueries.',
        'Focus on manufacturer datasheets, lab reviews, teardowns, and technical databases.',
        'Return strict JSON only.'
      ].join('\n'),
      user: JSON.stringify({ missingFields, product, previousQueries }),
      jsonSchema: escalationPlannerSchema(),
      reasoningMode: true,
      timeoutMs: config.llmTimeoutMs || 30000
    });
    return toArray(result?.queries || result);
  };
}
