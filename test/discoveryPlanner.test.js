import test from 'node:test';
import assert from 'node:assert/strict';
import { planDiscoveryQueriesLLM, normalizeQueryRows } from '../src/llm/discoveryPlanner.js';

function makeChatCompletionResponse(payload) {
  return {
    ok: true,
    async text() {
      return JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify(payload)
            }
          }
        ]
      });
    }
  };
}

test('planDiscoveryQueriesLLM runs single planning pass outside aggressive mode', async () => {
  const originalFetch = global.fetch;
  const seenModels = [];
  global.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || '{}'));
    const model = String(body?.model || '');
    seenModels.push(model);
    return makeChatCompletionResponse({
      queries: ['razer viper v3 pro specs', 'razer viper v3 pro manual pdf']
    });
  };

  try {
    const queries = await planDiscoveryQueriesLLM({
      job: {
        productId: 'mouse-razer-viper-v3-pro',
        category: 'mouse',
        identityLock: { brand: 'Razer', model: 'Viper V3 Pro', variant: '' }
      },
      categoryConfig: {
        category: 'mouse',
        schema: { critical_fields: ['weight'] }
      },
      baseQueries: ['razer viper v3 pro specs'],
      missingCriticalFields: ['weight'],
      config: {
        llmEnabled: true,
        llmPlanDiscoveryQueries: true,
        llmApiKey: 'sk-test',
        llmBaseUrl: 'https://api.openai.com',
        llmProvider: 'openai',
        llmModelPlan: 'gpt-5-low',
        llmModelFast: 'gpt-5-low',
        llmModelReasoning: 'gpt-5.1-high',
        llmTimeoutMs: 5_000
      },
      llmContext: {
        mode: 'balanced',
        budgetGuard: {
          canCall: () => ({ allowed: true }),
          recordCall: () => {}
        }
      }
    });

    assert.equal(seenModels.length, 1);
    const queryStrings = queries.map((r) => typeof r === 'object' ? r.query : r);
    assert.deepEqual(queryStrings, ['razer viper v3 pro specs', 'razer viper v3 pro manual pdf']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('planDiscoveryQueriesLLM runs multi-pass planning in aggressive mode and dedupes output', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || '{}'));
    const model = String(body?.model || '');
    calls.push(model);
    if (model === 'gpt-5-low') {
      return makeChatCompletionResponse({
        queries: ['logitech g pro x superlight 2 specs', 'logitech g pro x superlight 2 support']
      });
    }
    if (model === 'gpt-5.1-high') {
      return makeChatCompletionResponse({
        queries: ['logitech g pro x superlight 2 latency test', 'logitech g pro x superlight 2 support']
      });
    }
    return makeChatCompletionResponse({
      queries: ['site:logitechg.com g pro x superlight 2 manual pdf']
    });
  };

  try {
    const queries = await planDiscoveryQueriesLLM({
      job: {
        productId: 'mouse-logitech-g-pro-x-superlight-2',
        category: 'mouse',
        identityLock: { brand: 'Logitech', model: 'G Pro X Superlight 2', variant: '' }
      },
      categoryConfig: {
        category: 'mouse',
        schema: { critical_fields: ['click_latency', 'sensor_latency'] }
      },
      baseQueries: ['logitech g pro x superlight 2 specs'],
      missingCriticalFields: ['click_latency'],
      config: {
        llmEnabled: true,
        llmPlanDiscoveryQueries: true,
        llmApiKey: 'sk-test',
        llmBaseUrl: 'https://api.openai.com',
        llmProvider: 'openai',
        llmModelPlan: 'gpt-5-low',
        llmModelFast: 'gpt-5-low',
        llmModelReasoning: 'gpt-5.1-high',
        llmModelValidate: 'gpt-5.2-high',
        aggressiveLlmDiscoveryPasses: 3,
        aggressiveLlmDiscoveryQueryCap: 10,
        llmTimeoutMs: 5_000
      },
      llmContext: {
        mode: 'aggressive',
        budgetGuard: {
          canCall: () => ({ allowed: true }),
          recordCall: () => {}
        }
      }
    });

    assert.equal(calls.length, 3);
    const queryStrings = queries.map((r) => typeof r === 'object' ? r.query : r);
    assert.equal(queryStrings.includes('logitech g pro x superlight 2 support'), true);
    assert.equal(queryStrings.includes('logitech g pro x superlight 2 latency test'), true);
    assert.equal(
      queryStrings.filter((query) => query === 'logitech g pro x superlight 2 support').length,
      1
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('normalizeQueryRows converts flat string array to structured rows with empty target_fields', () => {
  const result = normalizeQueryRows(['q1', 'q2']);
  assert.deepEqual(result, [
    { query: 'q1', target_fields: [] },
    { query: 'q2', target_fields: [] }
  ]);
});

test('normalizeQueryRows preserves structured rows with target_fields', () => {
  const result = normalizeQueryRows([
    { query: 'q1', target_fields: ['dpi', 'sensor'] },
    { query: 'q2', target_fields: [] }
  ]);
  assert.deepEqual(result, [
    { query: 'q1', target_fields: ['dpi', 'sensor'] },
    { query: 'q2', target_fields: [] }
  ]);
});

test('normalizeQueryRows handles mixed array of strings and objects', () => {
  const result = normalizeQueryRows([
    'plain query',
    { query: 'structured query', target_fields: ['weight'] }
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].query, 'plain query');
  assert.deepEqual(result[0].target_fields, []);
  assert.equal(result[1].query, 'structured query');
  assert.deepEqual(result[1].target_fields, ['weight']);
});

test('planDiscoveryQueriesLLM returns structured rows with query and target_fields', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => makeChatCompletionResponse({
    queries: [
      { query: 'razer viper v3 pro weight specs', target_fields: ['weight'] },
      'razer viper v3 pro manual'
    ]
  });

  try {
    const queries = await planDiscoveryQueriesLLM({
      job: {
        productId: 'mouse-razer-viper-v3-pro',
        category: 'mouse',
        identityLock: { brand: 'Razer', model: 'Viper V3 Pro', variant: '' }
      },
      categoryConfig: { category: 'mouse', schema: { critical_fields: ['weight'] } },
      baseQueries: [],
      missingCriticalFields: ['weight'],
      config: {
        llmEnabled: true,
        llmPlanDiscoveryQueries: true,
        llmApiKey: 'sk-test',
        llmBaseUrl: 'https://api.openai.com',
        llmProvider: 'openai',
        llmModelPlan: 'gpt-5-low',
        llmTimeoutMs: 5_000
      },
      llmContext: {
        mode: 'balanced',
        budgetGuard: { canCall: () => ({ allowed: true }), recordCall: () => {} }
      }
    });

    assert.ok(queries.length >= 2);
    assert.ok(queries.every((r) => typeof r === 'object' && typeof r.query === 'string'));
    const structured = queries.find((r) => r.query.includes('weight'));
    assert.ok(structured);
    assert.ok(Array.isArray(structured.target_fields));
    assert.ok(structured.target_fields.includes('weight'));
  } finally {
    global.fetch = originalFetch;
  }
});
