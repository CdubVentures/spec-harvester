import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planEscalationQueries } from '../src/discovery/escalationPlanner.js';

function makeLlmFn({ queries = [], shouldFail = false } = {}) {
  let called = false;
  return {
    get called() { return called; },
    callLlm: async () => {
      called = true;
      if (shouldFail) throw new Error('LLM unavailable');
      return queries;
    }
  };
}

describe('escalationPlanner', () => {
  const product = {
    brand: 'Razer',
    model: 'Viper V3 Pro',
    variant: '',
    category: 'mouse'
  };

  it('escalated fields trigger LLM escalation planning', async () => {
    const llm = makeLlmFn({
      queries: [
        { query: 'Razer Viper V3 Pro click latency measurement', target_fields: ['click_latency'], expected_source_type: 'lab_review' },
        { query: 'Razer Viper V3 Pro sensor specs datasheet', target_fields: ['sensor'], expected_source_type: 'manufacturer' }
      ]
    });
    const result = await planEscalationQueries({
      missingFields: ['click_latency', 'sensor'],
      product,
      previousQueries: ['Razer Viper V3 Pro specifications'],
      config: { llmEnabled: true, llmModelPlan: 'test-model' },
      callLlmFn: llm.callLlm
    });
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 2);
    assert.ok(llm.called);
  });

  it('generated queries include target_fields and expected_source_type', async () => {
    const llm = makeLlmFn({
      queries: [
        { query: 'Razer Viper V3 Pro weight grams', target_fields: ['weight'], expected_source_type: 'spec_database' }
      ]
    });
    const result = await planEscalationQueries({
      missingFields: ['weight'],
      product,
      previousQueries: [],
      config: { llmEnabled: true, llmModelPlan: 'test-model' },
      callLlmFn: llm.callLlm
    });
    assert.equal(result.length, 1);
    assert.ok(Array.isArray(result[0].target_fields));
    assert.ok(result[0].target_fields.includes('weight'));
    assert.equal(result[0].expected_source_type, 'spec_database');
  });

  it('LLM failure falls back to empty array', async () => {
    const llm = makeLlmFn({ shouldFail: true });
    const result = await planEscalationQueries({
      missingFields: ['weight'],
      product,
      previousQueries: [],
      config: { llmEnabled: true, llmModelPlan: 'test-model' },
      callLlmFn: llm.callLlm
    });
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
    assert.ok(llm.called);
  });
});
