import test from 'node:test';
import assert from 'node:assert/strict';
import { CortexClient } from '../src/llm/cortex_client.js';

function mockJsonResponse(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    }
  };
}

test('CortexClient falls back to non-sidecar execution when sidecar is unavailable', async () => {
  const client = new CortexClient({
    config: {
      cortexEnabled: true
    },
    lifecycle: {
      async ensureRunning() {
        return {
          ok: false,
          status: { running: false, ready: false, models: [] }
        };
      }
    },
    fetch: async () => {
      throw new Error('fetch should not be called');
    }
  });

  const result = await client.runPass({
    tasks: [{ id: 'audit-1', type: 'evidence_audit', critical: true }],
    context: { confidence: 0.9 }
  });

  assert.equal(result.ok, true);
  assert.equal(result.fallback_to_non_sidecar, true);
  assert.equal(result.mode, 'fallback');
  assert.equal(result.results[0].status, 'fallback_non_sidecar');
});

test('CortexClient executes fast-tier sync tasks when sidecar is ready', async () => {
  const calls = [];
  const client = new CortexClient({
    config: {
      cortexEnabled: true,
      cortexModelFast: 'gpt-5-low',
      cortexBaseUrl: 'http://localhost:8000/v1',
      cortexSyncTimeoutMs: 2000
    },
    lifecycle: {
      async ensureRunning() {
        return {
          ok: true,
          status: { running: true, ready: true, models: ['gpt-5-low'] }
        };
      }
    },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return mockJsonResponse({
        choices: [{ message: { content: 'ok' } }],
        model: 'gpt-5-low'
      });
    }
  });

  const result = await client.runPass({
    tasks: [{ id: 'audit-1', type: 'evidence_audit', critical: true }],
    context: { confidence: 0.98 }
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'sidecar');
  assert.equal(result.fallback_to_non_sidecar, false);
  assert.equal(result.results[0].status, 'ok');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.endsWith('/chat/completions'), true);
});

test('CortexClient opens circuit breaker after repeated failures and avoids further sidecar calls', async () => {
  let fetchCalls = 0;
  const client = new CortexClient({
    config: {
      cortexEnabled: true,
      cortexFailureThreshold: 2,
      cortexCircuitOpenMs: 60_000,
      cortexBaseUrl: 'http://localhost:8000/v1'
    },
    lifecycle: {
      async ensureRunning() {
        return {
          ok: true,
          status: { running: true, ready: true, models: ['gpt-5-low'] }
        };
      }
    },
    fetch: async () => {
      fetchCalls += 1;
      throw new Error('network down');
    }
  });

  await client.runPass({
    tasks: [{ id: 'task-1', type: 'evidence_audit', critical: true }],
    context: { confidence: 0.9 }
  });
  await client.runPass({
    tasks: [{ id: 'task-2', type: 'evidence_audit', critical: true }],
    context: { confidence: 0.9 }
  });
  const blocked = await client.runPass({
    tasks: [{ id: 'task-3', type: 'evidence_audit', critical: true }],
    context: { confidence: 0.9 }
  });

  assert.equal(fetchCalls, 2);
  assert.equal(blocked.fallback_to_non_sidecar, true);
  assert.equal(blocked.fallback_reason, 'circuit_open');
});
