import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDomains } from '../src/discovery/domainSafetyGate.js';

function makeMockStorage() {
  const rows = new Map();
  return {
    getDomainClassification(domain) {
      return rows.get(domain) || null;
    },
    upsertDomainClassification(row) {
      rows.set(row.domain, row);
    },
    _rows: rows
  };
}

function makeLlmFn({ results = {} } = {}) {
  let called = false;
  return {
    get called() { return called; },
    callLlm: async ({ domains }) => {
      called = true;
      return domains.map(d => results[d] || {
        domain: d,
        classification: 'retail',
        safe: true,
        reason: 'General retail site'
      });
    }
  };
}

describe('domainSafetyGate', () => {
  it('known domains return cached classification without LLM call', async () => {
    const storage = makeMockStorage();
    storage.upsertDomainClassification({
      domain: 'rtings.com',
      classification: 'lab_review',
      safe: 1,
      reason: 'Lab review site'
    });
    const llm = makeLlmFn();
    const result = await classifyDomains({
      domains: ['rtings.com'],
      category: 'mouse',
      config: { llmEnabled: true, llmModelPlan: 'test-model' },
      callLlmFn: llm.callLlm,
      storage
    });
    assert.equal(result.get('rtings.com').safe, true);
    assert.equal(result.get('rtings.com').classification, 'lab_review');
    assert.equal(llm.called, false);
  });

  it('unknown domains get classified and cached', async () => {
    const storage = makeMockStorage();
    const llm = makeLlmFn({
      results: {
        'techpowerup.com': {
          domain: 'techpowerup.com',
          classification: 'lab_review',
          safe: true,
          reason: 'Hardware review site'
        }
      }
    });
    const result = await classifyDomains({
      domains: ['techpowerup.com'],
      category: 'mouse',
      config: { llmEnabled: true, llmModelPlan: 'test-model' },
      callLlmFn: llm.callLlm,
      storage
    });
    assert.equal(result.get('techpowerup.com').classification, 'lab_review');
    assert.ok(llm.called);
    assert.ok(storage._rows.has('techpowerup.com'));
  });

  it('adult_content domains are blocked (safe: false)', async () => {
    const storage = makeMockStorage();
    const llm = makeLlmFn({
      results: {
        'cougar.com': {
          domain: 'cougar.com',
          classification: 'adult_content',
          safe: false,
          reason: 'Adult content site'
        }
      }
    });
    const result = await classifyDomains({
      domains: ['cougar.com'],
      category: 'mouse',
      config: { llmEnabled: true, llmModelPlan: 'test-model' },
      callLlmFn: llm.callLlm,
      storage
    });
    assert.equal(result.get('cougar.com').safe, false);
    assert.equal(result.get('cougar.com').classification, 'adult_content');
    const cached = storage._rows.get('cougar.com');
    assert.equal(cached.safe, 0);
  });
});
