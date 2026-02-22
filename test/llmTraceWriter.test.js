import test from 'node:test';
import assert from 'node:assert/strict';
import { callOpenAI } from '../src/llm/openaiClient.js';

function makeTraceWriter() {
  const traces = [];
  return {
    traces,
    writeJson: async ({ section, prefix, payload, ringSize }) => {
      traces.push({ section, prefix, payload, ringSize });
      return { trace_path: `traces/${section}/${prefix}.json` };
    }
  };
}

function makeMockFetch(responsePayload, { failFirst = false } = {}) {
  let callCount = 0;
  return async (_url, init) => {
    callCount += 1;
    if (failFirst && callCount === 1) {
      throw new Error('simulated LLM error');
    }
    return {
      ok: true,
      async json() {
        return {
          choices: [{ message: { content: JSON.stringify(responsePayload) } }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
          model: 'test-model'
        };
      },
      async text() {
        return JSON.stringify({
          choices: [{ message: { content: JSON.stringify(responsePayload) } }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
          model: 'test-model'
        });
      }
    };
  };
}

test('developer_mode true: trace contains full prompt system, user, and response text', async () => {
  const originalFetch = global.fetch;
  global.fetch = makeMockFetch({ queries: ['test query'] });
  const traceWriter = makeTraceWriter();

  try {
    await callOpenAI({
      model: 'test-model',
      system: 'You are a test assistant.',
      user: 'What is the weight?',
      jsonSchema: { type: 'object', properties: { queries: { type: 'array', items: { type: 'string' } } }, required: ['queries'] },
      apiKey: 'sk-test-key',
      baseUrl: 'https://api.openai.com',
      usageContext: {
        reason: 'test_trace',
        traceWriter,
        developer_mode: true,
        trace_context: { target_fields: ['weight'] }
      },
      timeoutMs: 5000
    });

    assert.ok(traceWriter.traces.length >= 1);
    const trace = traceWriter.traces.find((t) => t.section === 'llm');
    assert.ok(trace, 'should have an llm trace entry');
    const payload = trace.payload;
    assert.equal(payload.status, 'ok');
    assert.ok(payload.prompt.system.includes('test assistant'));
    assert.ok(payload.prompt.user.includes('weight'));
    assert.ok(payload.response.text.includes('test query'));
    assert.ok(Array.isArray(payload.target_fields));
    assert.ok(payload.target_fields.includes('weight'));
  } finally {
    global.fetch = originalFetch;
  }
});

test('developer_mode false: trace contains redacted prompt with char counts only', async () => {
  const originalFetch = global.fetch;
  global.fetch = makeMockFetch({ result: 'ok' });
  const traceWriter = makeTraceWriter();

  try {
    await callOpenAI({
      model: 'test-model',
      system: 'System prompt content that should be redacted.',
      user: 'User content that should be redacted.',
      jsonSchema: { type: 'object', properties: { result: { type: 'string' } }, required: ['result'] },
      apiKey: 'sk-test-key',
      baseUrl: 'https://api.openai.com',
      usageContext: {
        reason: 'test_redacted',
        traceWriter,
        developer_mode: false,
        trace_context: {}
      },
      timeoutMs: 5000
    });

    assert.ok(traceWriter.traces.length >= 1);
    const trace = traceWriter.traces.find((t) => t.section === 'llm');
    assert.ok(trace);
    const payload = trace.payload;
    assert.equal(payload.prompt.redacted, true);
    assert.ok(Number.isFinite(payload.prompt.system_chars));
    assert.ok(payload.prompt.system_chars > 0);
    assert.ok(Number.isFinite(payload.prompt.user_chars));
    assert.ok(payload.prompt.user_chars > 0);
    assert.equal(payload.response.redacted, true);
    assert.ok(Number.isFinite(payload.response.chars));
  } finally {
    global.fetch = originalFetch;
  }
});

test('error path: trace is written with error details and status error', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('simulated network failure');
  };
  const traceWriter = makeTraceWriter();

  try {
    await callOpenAI({
      model: 'test-model',
      system: 'System prompt.',
      user: 'User prompt.',
      apiKey: 'sk-test-key',
      baseUrl: 'https://api.openai.com',
      usageContext: {
        reason: 'test_error',
        traceWriter,
        developer_mode: true,
        trace_context: {}
      },
      timeoutMs: 5000
    });
    assert.fail('should have thrown');
  } catch (error) {
    assert.ok(error.message.includes('simulated network failure'));
  } finally {
    global.fetch = originalFetch;
  }

  assert.ok(traceWriter.traces.length >= 1);
  const trace = traceWriter.traces.find((t) => t.section === 'llm');
  assert.ok(trace, 'error path should still write a trace');
  const payload = trace.payload;
  assert.equal(payload.status, 'error');
  assert.ok(payload.error.includes('simulated network failure'));
});
