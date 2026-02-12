import { callOpenAI } from './openaiClient.js';

const ROLE_KEYS = {
  plan: {
    model: 'llmModelPlan',
    provider: 'llmPlanProvider',
    baseUrl: 'llmPlanBaseUrl',
    apiKey: 'llmPlanApiKey',
    fallbackModel: 'llmPlanFallbackModel',
    fallbackProvider: 'llmPlanFallbackProvider',
    fallbackBaseUrl: 'llmPlanFallbackBaseUrl',
    fallbackApiKey: 'llmPlanFallbackApiKey'
  },
  extract: {
    model: 'llmModelExtract',
    provider: 'llmExtractProvider',
    baseUrl: 'llmExtractBaseUrl',
    apiKey: 'llmExtractApiKey',
    fallbackModel: 'llmExtractFallbackModel',
    fallbackProvider: 'llmExtractFallbackProvider',
    fallbackBaseUrl: 'llmExtractFallbackBaseUrl',
    fallbackApiKey: 'llmExtractFallbackApiKey'
  },
  validate: {
    model: 'llmModelValidate',
    provider: 'llmValidateProvider',
    baseUrl: 'llmValidateBaseUrl',
    apiKey: 'llmValidateApiKey',
    fallbackModel: 'llmValidateFallbackModel',
    fallbackProvider: 'llmValidateFallbackProvider',
    fallbackBaseUrl: 'llmValidateFallbackBaseUrl',
    fallbackApiKey: 'llmValidateFallbackApiKey'
  },
  write: {
    model: 'llmModelWrite',
    provider: 'llmWriteProvider',
    baseUrl: 'llmWriteBaseUrl',
    apiKey: 'llmWriteApiKey',
    fallbackModel: 'llmWriteFallbackModel',
    fallbackProvider: 'llmWriteFallbackProvider',
    fallbackBaseUrl: 'llmWriteFallbackBaseUrl',
    fallbackApiKey: 'llmWriteFallbackApiKey'
  }
};

function normalized(value) {
  return String(value || '').trim();
}

function routeRoleFromReason(reason = '') {
  const token = normalized(reason).toLowerCase();
  if (!token) {
    return 'extract';
  }
  if (
    token === 'plan' ||
    token.startsWith('plan_') ||
    token.startsWith('verify_extract_fast') ||
    token.includes('discovery_planner')
  ) {
    return 'plan';
  }
  if (
    token === 'write' ||
    token === 'summary' ||
    token.startsWith('write_') ||
    token.includes('summary')
  ) {
    return 'write';
  }
  if (
    token === 'validate' ||
    token.startsWith('validate_')
  ) {
    return 'validate';
  }
  return 'extract';
}

function normalizeProvider(value) {
  const token = normalized(value).toLowerCase();
  if (token === 'openai' || token === 'deepseek' || token === 'gemini') {
    return token;
  }
  return '';
}

function roleKeySet(role) {
  return ROLE_KEYS[role] || ROLE_KEYS.extract;
}

function baseRouteForRole(config = {}, role = 'extract') {
  const keys = roleKeySet(role);
  return {
    role,
    provider: normalizeProvider(config[keys.provider] || config.llmProvider || ''),
    model: normalized(config[keys.model] || config.llmModelExtract || ''),
    baseUrl: normalized(config[keys.baseUrl] || config.llmBaseUrl || config.openaiBaseUrl || ''),
    apiKey: normalized(config[keys.apiKey] || config.llmApiKey || config.openaiApiKey || '')
  };
}

function fallbackRouteForRole(config = {}, role = 'extract') {
  const keys = roleKeySet(role);
  const model = normalized(config[keys.fallbackModel] || '');
  if (!model) {
    return null;
  }
  return {
    role,
    provider: normalizeProvider(config[keys.fallbackProvider] || config[keys.provider] || config.llmProvider || ''),
    model,
    baseUrl: normalized(config[keys.fallbackBaseUrl] || config[keys.baseUrl] || config.llmBaseUrl || config.openaiBaseUrl || ''),
    apiKey: normalized(config[keys.fallbackApiKey] || config[keys.apiKey] || config.llmApiKey || config.openaiApiKey || '')
  };
}

function routeFingerprint(route = {}) {
  return [
    normalized(route.provider).toLowerCase(),
    normalized(route.baseUrl).toLowerCase(),
    normalized(route.model).toLowerCase()
  ].join('::');
}

export function resolveLlmRoute(config = {}, { reason = '', role = '', modelOverride = '' } = {}) {
  const resolvedRole = role || routeRoleFromReason(reason);
  const route = baseRouteForRole(config, resolvedRole);
  if (modelOverride) {
    route.model = normalized(modelOverride);
  }
  return route;
}

export function resolveLlmFallbackRoute(config = {}, { reason = '', role = '', modelOverride = '' } = {}) {
  const resolvedRole = role || routeRoleFromReason(reason);
  const fallback = fallbackRouteForRole(config, resolvedRole);
  if (!fallback) {
    return null;
  }
  if (modelOverride && normalized(modelOverride) === normalized(fallback.model)) {
    return null;
  }
  const primary = resolveLlmRoute(config, {
    reason,
    role: resolvedRole,
    modelOverride
  });
  if (routeFingerprint(primary) === routeFingerprint(fallback)) {
    return null;
  }
  return fallback;
}

export function hasLlmRouteApiKey(config = {}, { reason = '', role = '' } = {}) {
  const route = resolveLlmRoute(config, { reason, role });
  if (route.apiKey) {
    return true;
  }
  const fallback = resolveLlmFallbackRoute(config, { reason, role });
  return Boolean(fallback?.apiKey);
}

export function hasAnyLlmApiKey(config = {}) {
  if (normalized(config.llmApiKey || config.openaiApiKey)) {
    return true;
  }
  for (const role of Object.keys(ROLE_KEYS)) {
    if (hasLlmRouteApiKey(config, { role })) {
      return true;
    }
  }
  return false;
}

function publicRouteView(route = {}) {
  return {
    provider: route.provider || null,
    base_url: route.baseUrl || null,
    model: route.model || null,
    api_key_present: Boolean(route.apiKey)
  };
}

export function llmRoutingSnapshot(config = {}) {
  const roles = ['plan', 'extract', 'validate', 'write'];
  const snapshot = {};
  for (const role of roles) {
    const primary = baseRouteForRole(config, role);
    const fallback = fallbackRouteForRole(config, role);
    snapshot[role] = {
      primary: publicRouteView(primary),
      fallback: fallback ? publicRouteView(fallback) : null
    };
  }
  return snapshot;
}

export async function callLlmWithRouting({
  config,
  reason = '',
  role = '',
  modelOverride = '',
  system,
  user,
  jsonSchema,
  usageContext = {},
  costRates,
  onUsage,
  reasoningMode = false,
  reasoningBudget = 0,
  timeoutMs = 40_000,
  logger
}) {
  const resolvedRole = role || routeRoleFromReason(reason);
  const primary = resolveLlmRoute(config, {
    reason,
    role: resolvedRole,
    modelOverride
  });
  const fallback = resolveLlmFallbackRoute(config, {
    reason,
    role: resolvedRole,
    modelOverride
  });

  logger?.info?.('llm_route_selected', {
    reason,
    role: resolvedRole,
    provider: primary.provider || null,
    model: primary.model || null,
    fallback_configured: Boolean(fallback)
  });

  const sharedParams = {
    system,
    user,
    jsonSchema,
    usageContext: {
      ...usageContext,
      reason,
      route_role: resolvedRole
    },
    costRates,
    onUsage,
    reasoningMode: Boolean(reasoningMode),
    reasoningBudget: Number(reasoningBudget || 0),
    timeoutMs,
    logger
  };

  try {
    return await callOpenAI({
      ...sharedParams,
      model: primary.model,
      apiKey: primary.apiKey,
      baseUrl: primary.baseUrl,
      provider: primary.provider
    });
  } catch (error) {
    if (!fallback) {
      throw error;
    }
    logger?.warn?.('llm_route_fallback', {
      reason,
      role: resolvedRole,
      primary_provider: primary.provider || null,
      primary_model: primary.model || null,
      fallback_provider: fallback.provider || null,
      fallback_model: fallback.model || null,
      message: error.message
    });
    return callOpenAI({
      ...sharedParams,
      model: fallback.model,
      apiKey: fallback.apiKey,
      baseUrl: fallback.baseUrl,
      provider: fallback.provider,
      usageContext: {
        ...sharedParams.usageContext,
        fallback_attempt: true,
        fallback_from_model: primary.model || null
      }
    });
  }
}
