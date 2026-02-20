import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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

function buildEvidencePackForFields(fields) {
  return {
    meta: { host: 'example.com', total_chars: 1200 },
    references: fields.map((field) => ({
      id: `ref-${field}`,
      url: 'https://example.com/spec'
    })),
    snippets: fields.map((field) => ({
      id: `ref-${field}`,
      normalized_text: `${field} value for this product`,
      snippet_hash: `sha256:${field}`
    }))
  };
}

function parseTargetFieldsFromFetchInit(init = {}) {
  const body = JSON.parse(String(init.body || '{}'));
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const userMessage = messages.find((row) => row?.role === 'user');
  const payload = JSON.parse(String(userMessage?.content || '{}'));
  return Array.isArray(payload.targetFields) ? payload.targetFields : [];
}

test('extractCandidatesLLM batches extraction into <=7 calls and reuses cache on rerun', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'phase5-llm-cache-'));
  const fields = [
    'brand', 'model', 'sku', 'weight', 'lngth', 'sensor',
    'dpi', 'switch', 'connection', 'sensor_latency', 'rgb'
  ];
  const evidencePack = buildEvidencePackForFields(fields);
  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async (_url, init) => {
    callCount += 1;
    const targetFields = parseTargetFieldsFromFetchInit(init);
    const fieldCandidates = targetFields.map((field) => ({
      field,
      value: `${field} value`,
      evidenceRefs: [`ref-${field}`],
      keyPath: `llm.${field}`
    }));
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify(
          mockChatCompletionPayload({
            identityCandidates: {},
            fieldCandidates,
            conflicts: [],
            notes: []
          })
        );
      }
    };
  };

  try {
    const baseArgs = {
      job: {
        productId: 'mouse-phase5-cache',
        category: 'mouse',
        identityLock: { brand: 'Razer', model: 'Viper V3 Pro' },
        anchors: {}
      },
      categoryConfig: {
        category: 'mouse',
        fieldOrder: fields,
        requiredFields: ['weight', 'sensor'],
        fieldRules: {
          fields: {
            sensor_latency: { difficulty: 'instrumented' },
            sensor: { difficulty: 'easy' }
          }
        }
      },
      evidencePack,
      config: {
        llmEnabled: true,
        llmApiKey: 'sk-test',
        llmBaseUrl: 'https://api.openai.com',
        llmProvider: 'openai',
        llmModelExtract: 'deepseek-reasoner',
        llmModelPlan: 'gemini-2.0-flash',
        llmModelFast: 'gemini-2.0-flash',
        llmTimeoutMs: 5_000,
        llmMaxBatchesPerProduct: 7,
        llmExtractionCacheEnabled: true,
        llmExtractionCacheDir: tmp
      }
    };

    const first = await extractCandidatesLLM(baseArgs);
    const callsAfterFirstRun = callCount;
    assert.equal(callsAfterFirstRun <= 7, true);
    assert.equal(first.fieldCandidates.length > 0, true);
    assert.equal(first.fieldCandidates.every((row) => (row.evidenceRefs || []).length > 0), true);

    const second = await extractCandidatesLLM(baseArgs);
    assert.equal(callCount, callsAfterFirstRun);
    assert.deepEqual(second.fieldCandidates, first.fieldCandidates);
  } finally {
    global.fetch = originalFetch;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('extractCandidatesLLM drops non-auditable candidates when evidence verifier fails', async () => {
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
              field: 'sensor',
              value: 'PAW3395',
              evidenceRefs: ['ref-sensor'],
              keyPath: 'llm.sensor'
            }
          ],
          conflicts: [],
          notes: []
        })
      );
    }
  });

  try {
    const result = await extractCandidatesLLM({
      job: {
        productId: 'mouse-phase5-verify',
        category: 'mouse',
        identityLock: {},
        anchors: {}
      },
      categoryConfig: {
        category: 'mouse',
        fieldOrder: ['sensor']
      },
      evidencePack: {
        references: [{ id: 'ref-sensor', url: 'https://example.com/spec' }],
        snippets: [{ id: 'ref-sensor', normalized_text: 'Sensor type: optical tracking module' }]
      },
      config: {
        llmEnabled: true,
        llmApiKey: 'sk-test',
        llmBaseUrl: 'https://api.openai.com',
        llmProvider: 'openai',
        llmModelExtract: 'test-model',
        llmModelPlan: 'test-model-fast',
        llmModelFast: 'test-model-fast',
        llmTimeoutMs: 5_000
      }
    });

    assert.equal(result.fieldCandidates.length, 0);
    assert.equal((result.notes || []).some((row) => String(row).includes('evidence verifier')), true);
  } finally {
    global.fetch = originalFetch;
  }
});
