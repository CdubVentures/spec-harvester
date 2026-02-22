import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { predictSourceUrls } from '../src/discovery/urlPredictor.js';

function makeLlmFn({ urls = [], shouldFail = false } = {}) {
  let called = false;
  return {
    get called() { return called; },
    callLlm: async () => {
      called = true;
      if (shouldFail) throw new Error('LLM unavailable');
      return urls;
    }
  };
}

function makeHeadFn(statusByUrl = {}) {
  return async (url) => {
    const status = statusByUrl[url];
    if (status === undefined) return { status: 200 };
    return { status };
  };
}

describe('urlPredictor', () => {
  const product = {
    brand: 'Razer',
    model: 'Viper V3 Pro',
    variant: '',
    category: 'mouse'
  };

  it('predictSourceUrls returns predicted URLs from LLM mock', async () => {
    const llm = makeLlmFn({
      urls: [
        { url: 'https://rtings.com/mouse/reviews/razer/viper-v3-pro', source_host: 'rtings.com', predicted_tier: 2 },
        { url: 'https://techpowerup.com/review/razer-viper-v3-pro', source_host: 'techpowerup.com', predicted_tier: 2 }
      ]
    });
    const result = await predictSourceUrls({
      product,
      knownSources: [
        { host: 'rtings.com', source_type: 'lab_review' },
        { host: 'techpowerup.com', source_type: 'lab_review' }
      ],
      config: { llmEnabled: true, llmModelPlan: 'test-model' },
      callLlmFn: llm.callLlm,
      headFn: makeHeadFn({})
    });
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 2);
    assert.ok(result[0].url.includes('rtings.com'));
    assert.equal(result[0].source_host, 'rtings.com');
    assert.ok(llm.called);
  });

  it('HEAD check filters out 404 predictions', async () => {
    const llm = makeLlmFn({
      urls: [
        { url: 'https://rtings.com/mouse/reviews/razer/viper-v3-pro', source_host: 'rtings.com', predicted_tier: 2 },
        { url: 'https://dead-link.com/review/razer-viper', source_host: 'dead-link.com', predicted_tier: 3 }
      ]
    });
    const headFn = makeHeadFn({
      'https://dead-link.com/review/razer-viper': 404
    });
    const result = await predictSourceUrls({
      product,
      knownSources: [
        { host: 'rtings.com', source_type: 'lab_review' },
        { host: 'dead-link.com', source_type: 'lab_review' }
      ],
      config: { llmEnabled: true, llmModelPlan: 'test-model' },
      callLlmFn: llm.callLlm,
      headFn
    });
    assert.equal(result.length, 1);
    assert.ok(result[0].url.includes('rtings.com'));
  });

  it('LLM failure returns empty array (graceful degradation)', async () => {
    const llm = makeLlmFn({ shouldFail: true });
    const result = await predictSourceUrls({
      product,
      knownSources: [{ host: 'rtings.com', source_type: 'lab_review' }],
      config: { llmEnabled: true, llmModelPlan: 'test-model' },
      callLlmFn: llm.callLlm,
      headFn: makeHeadFn({})
    });
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
    assert.ok(llm.called);
  });

  it('predicted URLs include source_host and predicted_tier', async () => {
    const llm = makeLlmFn({
      urls: [
        { url: 'https://rtings.com/mouse/reviews/razer/viper-v3-pro', source_host: 'rtings.com', predicted_tier: 2, confidence: 0.9 }
      ]
    });
    const result = await predictSourceUrls({
      product,
      knownSources: [{ host: 'rtings.com', source_type: 'lab_review' }],
      config: { llmEnabled: true, llmModelPlan: 'test-model' },
      callLlmFn: llm.callLlm,
      headFn: makeHeadFn({})
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].source_host, 'rtings.com');
    assert.equal(result[0].predicted_tier, 2);
    assert.ok('confidence' in result[0]);
  });
});
