import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasAnyLlmApiKey,
  hasLlmRouteApiKey,
  llmRoutingSnapshot,
  resolveLlmFallbackRoute,
  resolveLlmRoute
} from '../src/llm/routing.js';

test('resolveLlmRoute selects per-role provider/base/model with reason mapping', () => {
  const config = {
    llmProvider: 'openai',
    llmApiKey: 'global-key',
    llmBaseUrl: 'https://api.openai.com',
    llmModelExtract: 'gpt-4.1-mini',
    llmModelPlan: 'gpt-4.1-mini',
    llmModelValidate: 'gpt-4.1-mini',
    llmPlanProvider: 'gemini',
    llmPlanApiKey: 'gem-key',
    llmPlanBaseUrl: 'https://generativelanguage.googleapis.com',
    llmModelPlan: 'gemini-2.5-flash',
    llmExtractProvider: 'deepseek',
    llmExtractApiKey: 'ds-key',
    llmExtractBaseUrl: 'https://api.deepseek.com',
    llmModelExtract: 'deepseek-reasoner'
  };

  const planRoute = resolveLlmRoute(config, { reason: 'plan' });
  assert.equal(planRoute.provider, 'gemini');
  assert.equal(planRoute.apiKey, 'gem-key');
  assert.equal(planRoute.model, 'gemini-2.5-flash');

  const verifyFastRoute = resolveLlmRoute(config, { reason: 'verify_extract_fast' });
  assert.equal(verifyFastRoute.provider, 'gemini');
  assert.equal(verifyFastRoute.model, 'gemini-2.5-flash');

  const extractRoute = resolveLlmRoute(config, { reason: 'extract' });
  assert.equal(extractRoute.provider, 'deepseek');
  assert.equal(extractRoute.apiKey, 'ds-key');
  assert.equal(extractRoute.model, 'deepseek-reasoner');
});

test('resolveLlmFallbackRoute returns null when fallback matches primary fingerprint', () => {
  const config = {
    llmProvider: 'deepseek',
    llmApiKey: 'ds-key',
    llmBaseUrl: 'https://api.deepseek.com',
    llmModelExtract: 'deepseek-chat',
    llmExtractFallbackProvider: 'deepseek',
    llmExtractFallbackApiKey: 'ds-key',
    llmExtractFallbackBaseUrl: 'https://api.deepseek.com',
    llmExtractFallbackModel: 'deepseek-chat'
  };

  const fallback = resolveLlmFallbackRoute(config, { reason: 'extract' });
  assert.equal(fallback, null);
});

test('route key helpers detect role-only keys and snapshot masks secrets', () => {
  const config = {
    llmProvider: 'openai',
    llmApiKey: '',
    llmBaseUrl: 'https://api.openai.com',
    llmModelExtract: 'gpt-4.1-mini',
    llmModelPlan: 'gpt-4.1-mini',
    llmModelValidate: 'gpt-4.1-mini',
    llmModelWrite: 'gpt-4.1-mini',
    llmPlanProvider: 'gemini',
    llmPlanApiKey: 'gem-key',
    llmPlanBaseUrl: 'https://generativelanguage.googleapis.com',
    llmModelPlan: 'gemini-2.5-flash'
  };

  assert.equal(hasLlmRouteApiKey(config, { reason: 'plan' }), true);
  assert.equal(hasLlmRouteApiKey(config, { reason: 'extract' }), false);
  assert.equal(hasAnyLlmApiKey(config), true);

  const snapshot = llmRoutingSnapshot(config);
  assert.equal(snapshot.plan.primary.api_key_present, true);
  assert.equal(snapshot.extract.primary.api_key_present, false);
  assert.equal(Object.hasOwn(snapshot.plan.primary, 'apiKey'), false);
});

test('model override switches route provider and credentials by model family', () => {
  const config = {
    llmProvider: 'openai',
    llmApiKey: 'openai-key',
    llmBaseUrl: 'http://localhost:5001',
    llmModelPlan: 'gpt-5.1-low',
    llmPlanProvider: 'openai',
    llmPlanApiKey: 'openai-key',
    llmPlanBaseUrl: 'http://localhost:5001',
    llmWriteProvider: 'gemini',
    llmWriteApiKey: 'gem-key',
    llmWriteBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    llmPlanFallbackProvider: 'deepseek',
    llmPlanFallbackApiKey: 'ds-key',
    llmPlanFallbackBaseUrl: 'https://api.deepseek.com',
    llmPlanFallbackModel: 'deepseek-chat'
  };

  const geminiRoute = resolveLlmRoute(config, {
    role: 'plan',
    modelOverride: 'gemini-2.5-flash-lite'
  });
  assert.equal(geminiRoute.provider, 'gemini');
  assert.equal(geminiRoute.baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.equal(geminiRoute.apiKey, 'gem-key');
  assert.equal(geminiRoute.model, 'gemini-2.5-flash-lite');

  const deepseekRoute = resolveLlmRoute(config, {
    role: 'plan',
    modelOverride: 'deepseek-chat'
  });
  assert.equal(deepseekRoute.provider, 'deepseek');
  assert.equal(deepseekRoute.baseUrl, 'https://api.deepseek.com');
  assert.equal(deepseekRoute.apiKey, 'ds-key');
  assert.equal(deepseekRoute.model, 'deepseek-chat');
});
