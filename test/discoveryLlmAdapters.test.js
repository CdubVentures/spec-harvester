import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBrandResolverCallLlm,
  createDomainSafetyCallLlm,
  createUrlPredictorCallLlm,
  createEscalationPlannerCallLlm
} from '../src/llm/discoveryLlmAdapters.js';

function makeCallRoutedLlm(returnValue = {}) {
  const calls = [];
  return {
    get calls() { return calls; },
    fn: async (opts) => {
      calls.push(opts);
      return returnValue;
    }
  };
}

describe('discoveryLlmAdapters', () => {
  describe('createBrandResolverCallLlm', () => {
    it('formats prompt with brand and category and returns parsed result', async () => {
      const routed = makeCallRoutedLlm({
        official_domain: 'cougargaming.com',
        aliases: ['cougargaming.com'],
        support_domain: 'support.cougargaming.com'
      });
      const callLlm = createBrandResolverCallLlm({
        callRoutedLlmFn: routed.fn,
        config: { llmModelTriage: 'test-model' }
      });
      const result = await callLlm({ brand: 'Cougar', category: 'mouse', config: {} });
      assert.equal(result.official_domain, 'cougargaming.com');
      assert.ok(routed.calls.length === 1);
      assert.ok(routed.calls[0].reason === 'brand_resolution');
      assert.ok(routed.calls[0].user.includes('Cougar'));
      assert.ok(routed.calls[0].user.includes('mouse'));
    });

    it('includes JSON schema for structured output', async () => {
      const routed = makeCallRoutedLlm({ official_domain: 'test.com', aliases: [] });
      const callLlm = createBrandResolverCallLlm({
        callRoutedLlmFn: routed.fn,
        config: { llmModelTriage: 'test-model' }
      });
      await callLlm({ brand: 'Test', category: 'mouse', config: {} });
      const schema = routed.calls[0].jsonSchema;
      assert.ok(schema);
      assert.ok(schema.properties.official_domain);
      assert.ok(schema.properties.aliases);
    });
  });

  describe('createDomainSafetyCallLlm', () => {
    it('formats prompt with domains and category and returns classifications', async () => {
      const routed = makeCallRoutedLlm([
        { domain: 'cougar.com', classification: 'adult_content', reason: 'Adult site' },
        { domain: 'rtings.com', classification: 'lab_review', reason: 'Review site' }
      ]);
      const callLlm = createDomainSafetyCallLlm({
        callRoutedLlmFn: routed.fn,
        config: { llmModelTriage: 'test-model' }
      });
      const result = await callLlm({ domains: ['cougar.com', 'rtings.com'], category: 'mouse', config: {} });
      assert.ok(Array.isArray(result));
      assert.equal(result.length, 2);
      assert.equal(result[0].domain, 'cougar.com');
      assert.equal(result[0].classification, 'adult_content');
      assert.ok(routed.calls[0].user.includes('cougar.com'));
      assert.ok(routed.calls[0].user.includes('rtings.com'));
    });

    it('includes JSON schema for domain classifications', async () => {
      const routed = makeCallRoutedLlm([]);
      const callLlm = createDomainSafetyCallLlm({
        callRoutedLlmFn: routed.fn,
        config: { llmModelTriage: 'test-model' }
      });
      await callLlm({ domains: ['test.com'], category: 'mouse', config: {} });
      const schema = routed.calls[0].jsonSchema;
      assert.ok(schema);
      assert.ok(schema.properties.classifications);
    });
  });

  describe('createUrlPredictorCallLlm', () => {
    it('formats prompt with product and sources and returns URLs', async () => {
      const routed = makeCallRoutedLlm([
        { url: 'https://rtings.com/review/razer-viper', source_host: 'rtings.com', predicted_tier: 2 }
      ]);
      const callLlm = createUrlPredictorCallLlm({
        callRoutedLlmFn: routed.fn,
        config: { llmModelTriage: 'test-model' }
      });
      const result = await callLlm({
        product: { brand: 'Razer', model: 'Viper V3 Pro', category: 'mouse' },
        sources: [{ host: 'rtings.com', source_type: 'lab_review' }],
        config: {}
      });
      assert.ok(Array.isArray(result));
      assert.equal(result[0].url, 'https://rtings.com/review/razer-viper');
      assert.ok(routed.calls[0].user.includes('Razer'));
      assert.ok(routed.calls[0].user.includes('rtings.com'));
    });
  });

  describe('createEscalationPlannerCallLlm', () => {
    it('formats prompt with missing fields and product and returns queries', async () => {
      const routed = makeCallRoutedLlm([
        { query: 'Razer Viper V3 Pro click latency test', target_fields: ['click_latency'], expected_source_type: 'lab_review' }
      ]);
      const callLlm = createEscalationPlannerCallLlm({
        callRoutedLlmFn: routed.fn,
        config: { llmModelPlan: 'test-model' }
      });
      const result = await callLlm({
        missingFields: ['click_latency'],
        product: { brand: 'Razer', model: 'Viper V3 Pro', category: 'mouse' },
        previousQueries: ['Razer Viper V3 Pro specifications'],
        config: {}
      });
      assert.ok(Array.isArray(result));
      assert.equal(result[0].query, 'Razer Viper V3 Pro click latency test');
      assert.ok(routed.calls[0].reason === 'escalation_planner');
      assert.ok(routed.calls[0].user.includes('click_latency'));
    });

    it('uses plan model role instead of triage', async () => {
      const routed = makeCallRoutedLlm([]);
      const callLlm = createEscalationPlannerCallLlm({
        callRoutedLlmFn: routed.fn,
        config: { llmModelPlan: 'plan-model' }
      });
      await callLlm({
        missingFields: ['weight'],
        product: { brand: 'Razer', model: 'Viper', category: 'mouse' },
        previousQueries: [],
        config: {}
      });
      assert.equal(routed.calls[0].role, 'plan');
    });
  });
});
