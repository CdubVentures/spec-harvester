import test from 'node:test';
import assert from 'node:assert/strict';
import { callOpenAI } from '../src/llm/openaiClient.js';

test('callOpenAI deepseek mode avoids json_schema and parses fenced JSON', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          choices: [
            {
              message: {
                content: '```json\n{"queries":["q1","q2"]}\n```'
              }
            }
          ]
        });
      }
    };
  };

  try {
    const result = await callOpenAI({
      model: 'deepseek-reasoner',
      system: 'system',
      user: 'user',
      jsonSchema: {
        type: 'object',
        properties: {
          queries: {
            type: 'array',
            items: { type: 'string' }
          }
        },
        required: ['queries']
      },
      apiKey: 'ds-test',
      baseUrl: 'https://api.deepseek.com',
      reasoningMode: true,
      reasoningBudget: 1024
    });

    assert.deepEqual(result, { queries: ['q1', 'q2'] });
    assert.equal('response_format' in requests[0], false);
    assert.equal(requests[0].max_tokens >= 1024, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('callOpenAI retries without json_schema when provider rejects response_format', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  let callCount = 0;
  global.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    callCount += 1;

    if (callCount === 1) {
      return {
        ok: false,
        status: 400,
        async text() {
          return JSON.stringify({
            error: {
              message: 'response_format json_schema is unsupported'
            }
          });
        }
      };
    }

    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          choices: [
            {
              message: {
                content: '{"ok":true}'
              }
            }
          ]
        });
      }
    };
  };

  try {
    const result = await callOpenAI({
      model: 'test-model',
      system: 'system',
      user: 'user',
      jsonSchema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' }
        },
        required: ['ok']
      },
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com'
    });

    assert.deepEqual(result, { ok: true });
    assert.equal(callCount, 2);
    assert.equal('response_format' in requests[0], true);
    assert.equal('response_format' in requests[1], false);
  } finally {
    global.fetch = originalFetch;
  }
});
