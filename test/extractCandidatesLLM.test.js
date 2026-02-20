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
          { id: 'ref-1', type: 'network', normalized_text: 'Connection: wireless mode' }
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

test('extractCandidatesLLM returns known-answer candidates with evidence refs', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(
        mockChatCompletionPayload({
          identityCandidates: {},
          fieldCandidates: [
            {
              field: 'weight',
              value: '60 g',
              evidenceRefs: ['s01'],
              keyPath: 'llm.weight'
            },
            {
              field: 'polling_rate',
              value: '8000',
              evidenceRefs: ['t01'],
              keyPath: 'llm.polling'
            }
          ],
          conflicts: [],
          notes: ['fixture-ok']
        })
      );
    }
  });

  try {
    const result = await extractCandidatesLLM({
      job: {
        productId: 'mouse-logitech-g-pro-x-superlight-2',
        category: 'mouse',
        identityLock: { brand: 'Logitech', model: 'G Pro X Superlight 2' },
        anchors: {}
      },
      categoryConfig: {
        category: 'mouse',
        fieldOrder: ['weight', 'polling_rate', 'dpi'],
        requiredFields: ['weight', 'polling_rate']
      },
      evidencePack: {
        meta: {
          host: 'logitechg.com',
          total_chars: 1200
        },
        references: [
          { id: 's01', url: 'https://logitechg.com/specs' },
          { id: 't01', url: 'https://logitechg.com/specs' }
        ],
        snippets: [
          { id: 's01', text: 'Weight: 60 g' },
          { id: 't01', text: 'Polling rate: up to 8000 Hz' }
        ]
      },
      config: {
        llmEnabled: true,
        llmApiKey: 'sk-test',
        llmBaseUrl: 'https://api.deepseek.com',
        llmProvider: 'deepseek',
        llmModelExtract: 'deepseek-reasoner',
        llmReasoningMode: true,
        llmReasoningBudget: 1024,
        llmTimeoutMs: 5_000
      }
    });

    assert.equal(result.fieldCandidates.length >= 2, true);
    const byField = Object.fromEntries(result.fieldCandidates.map((row) => [row.field, row]));
    assert.equal(byField.weight.value, '60 g');
    assert.equal(byField.polling_rate.value, '8000');
    assert.equal(byField.weight.evidenceRefs.length > 0, true);
    assert.equal(byField.polling_rate.evidenceRefs.length > 0, true);
  } finally {
    global.fetch = originalFetch;
  }
});
