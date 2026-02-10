import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCandidatesLLM } from '../src/llm/extractCandidatesLLM.js';

function mockChatCompletionPayload(contentJson) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify(contentJson)
        }
      }
    ]
  };
}

test('extractCandidatesLLM keeps only candidates with valid evidenceRefs', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(
        mockChatCompletionPayload({
          identityCandidates: { brand: 'Razer' },
          fieldCandidates: [
            {
              field: 'connection',
              value: 'wireless',
              evidenceRefs: ['ref-1'],
              keyPath: 'llm.connection'
            },
            {
              field: 'sensor',
              value: 'Focus Pro 35K',
              evidenceRefs: ['missing-ref'],
              keyPath: 'llm.sensor'
            }
          ],
          conflicts: [],
          notes: ['ok']
        })
      );
    }
  });

  try {
    const result = await extractCandidatesLLM({
      job: {
        productId: 'mouse-a',
        category: 'mouse',
        identityLock: { brand: 'Razer', model: 'Viper V3 Pro' },
        anchors: {}
      },
      categoryConfig: {
        fieldOrder: ['connection', 'sensor']
      },
      evidencePack: {
        references: [
          { id: 'ref-1', url: 'https://example.com', host: 'example.com', evidenceKey: 'network:1' }
        ],
        snippets: [
          { type: 'network', text: '{"connection":"wireless"}' }
        ]
      },
      config: {
        llmEnabled: true,
        llmApiKey: 'sk-test',
        llmBaseUrl: 'https://api.openai.com',
        llmProvider: 'openai',
        llmModelExtract: 'test-model',
        llmTimeoutMs: 5_000
      }
    });

    assert.equal(result.fieldCandidates.length, 1);
    assert.equal(result.fieldCandidates[0].field, 'connection');
    assert.equal(result.fieldCandidates[0].method, 'llm_extract');
    assert.deepEqual(result.fieldCandidates[0].evidenceRefs, ['ref-1']);
    assert.equal(result.identityCandidates.brand, undefined);
  } finally {
    global.fetch = originalFetch;
  }
});
