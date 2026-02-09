import test from 'node:test';
import assert from 'node:assert/strict';
import { callOpenAI } from '../src/llm/openaiClient.js';

test('callOpenAI redacts API key from logged and thrown errors', async () => {
  const secret = 'sk-test-secret';
  const originalFetch = global.fetch;
  const warnings = [];
  global.fetch = async () => ({
    ok: false,
    status: 500,
    async text() {
      return `upstream failure with key=${secret}`;
    }
  });

  try {
    await assert.rejects(
      () =>
        callOpenAI({
          model: 'test-model',
          system: 'system',
          user: 'user',
          jsonSchema: {
            type: 'object',
            properties: {},
            required: []
          },
          apiKey: secret,
          baseUrl: 'https://api.openai.com',
          logger: {
            warn(event, payload) {
              warnings.push({ event, payload });
            }
          }
        }),
      /redacted|OpenAI API error/
    );
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].event, 'openai_call_failed');
  assert.equal(String(warnings[0].payload.message).includes(secret), false);
});
