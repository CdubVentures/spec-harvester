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

  assert.ok(warnings.length >= 1);
  assert.ok(warnings.some((row) => row.event === 'llm_call_failed'));
  for (const warning of warnings) {
    assert.equal(String(warning.payload.message).includes(secret), false);
  }
});
