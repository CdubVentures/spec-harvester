import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBrandDomain } from '../src/discovery/brandResolver.js';

function makeMockStorage() {
  const rows = new Map();
  return {
    getBrandDomain(brand, category) {
      return rows.get(`${brand}::${category}`) || null;
    },
    upsertBrandDomain(row) {
      rows.set(`${row.brand}::${row.category}`, row);
    },
    _rows: rows
  };
}

function makeLlmContext({ result = null, shouldFail = false } = {}) {
  let called = false;
  return {
    get called() { return called; },
    callLlm: async () => {
      called = true;
      if (shouldFail) throw new Error('LLM unavailable');
      return result || {
        official_domain: 'cougargaming.com',
        aliases: ['cougargaming.com', 'cougar-gaming.com'],
        support_domain: 'support.cougargaming.com'
      };
    }
  };
}

describe('brandResolver', () => {
  it('returns structured result from LLM', async () => {
    const storage = makeMockStorage();
    const llm = makeLlmContext();
    const result = await resolveBrandDomain({
      brand: 'Cougar',
      category: 'mouse',
      config: { llmEnabled: true, llmModelPlan: 'test-model' },
      callLlmFn: llm.callLlm,
      storage
    });
    assert.equal(result.officialDomain, 'cougargaming.com');
    assert.ok(Array.isArray(result.aliases));
    assert.ok(result.aliases.includes('cougargaming.com'));
    assert.equal(result.supportDomain, 'support.cougargaming.com');
    assert.ok(llm.called);
  });

  it('cache hit returns stored result without LLM call', async () => {
    const storage = makeMockStorage();
    storage.upsertBrandDomain({
      brand: 'Razer',
      category: 'mouse',
      official_domain: 'razer.com',
      aliases: JSON.stringify(['razer.com']),
      support_domain: 'support.razer.com',
      confidence: 0.95
    });
    const llm = makeLlmContext();
    const result = await resolveBrandDomain({
      brand: 'Razer',
      category: 'mouse',
      config: { llmEnabled: true, llmModelPlan: 'test-model' },
      callLlmFn: llm.callLlm,
      storage
    });
    assert.equal(result.officialDomain, 'razer.com');
    assert.equal(llm.called, false);
  });

  it('LLM failure falls back gracefully', async () => {
    const storage = makeMockStorage();
    const llm = makeLlmContext({ shouldFail: true });
    const result = await resolveBrandDomain({
      brand: 'Unknown',
      category: 'mouse',
      config: { llmEnabled: true, llmModelPlan: 'test-model' },
      callLlmFn: llm.callLlm,
      storage
    });
    assert.equal(result.officialDomain, '');
    assert.deepEqual(result.aliases, []);
    assert.ok(llm.called);
  });

  it('resolved aliases flow through selectManufacturerHosts', async () => {
    const { buildSearchProfile } = await import('../src/search/queryBuilder.js');
    const profile = buildSearchProfile({
      job: {
        identityLock: { brand: 'Cougar', model: 'AirBlader Tournament', variant: '' },
        category: 'mouse'
      },
      categoryConfig: {
        category: 'mouse',
        sourceHosts: [
          { host: 'cougargaming.com', role: 'manufacturer' },
          { host: 'cougar.com', role: 'manufacturer' },
          { host: 'razer.com', role: 'manufacturer' }
        ]
      },
      missingFields: ['weight'],
      brandResolution: {
        officialDomain: 'cougargaming.com',
        aliases: ['cougargaming.com', 'cougar-gaming.com'],
        supportDomain: 'support.cougargaming.com'
      }
    });
    const siteQueries = profile.queries.filter(q => q.includes('site:'));
    const hasCougarGaming = siteQueries.some(q => q.includes('cougargaming.com'));
    assert.ok(hasCougarGaming, `Expected site:cougargaming.com in queries: ${JSON.stringify(siteQueries)}`);
  });
});
