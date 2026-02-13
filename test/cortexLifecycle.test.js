import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CortexLifecycle,
  stripTrailingV1
} from '../src/llm/cortex_lifecycle.js';

function okResponse(payload = {}) {
  return {
    ok: true,
    async json() {
      return payload;
    }
  };
}

test('stripTrailingV1 removes trailing /v1 variants', () => {
  assert.equal(stripTrailingV1('http://localhost:8000/v1'), 'http://localhost:8000');
  assert.equal(stripTrailingV1('http://localhost:8000/v1/'), 'http://localhost:8000');
  assert.equal(stripTrailingV1('http://localhost:8000'), 'http://localhost:8000');
});

test('status reports ready=true and model ids when compose is running and /v1/models is healthy', async () => {
  const calls = [];
  const lifecycle = new CortexLifecycle(
    {
      CHATMOCK_COMPOSE_FILE: 'C:\\ChatMock\\docker-compose.yml',
      CORTEX_BASE_URL: 'http://localhost:8000/v1'
    },
    {
      execFile: async (_cmd, args) => {
        calls.push(args.join(' '));
        if (args.includes('ps')) {
          return { stdout: 'chatmock  running', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      },
      fetch: async () => okResponse({ data: [{ id: 'gpt-5-low' }, { id: 'gpt-5-high' }] }),
      sleep: async () => {}
    }
  );

  const status = await lifecycle.status();
  assert.equal(status.running, true);
  assert.equal(status.ready, true);
  assert.deepEqual(status.models, ['gpt-5-low', 'gpt-5-high']);
  assert.equal(calls.some((row) => row.includes('ps')), true);
});

test('start returns docker desktop error when compose version check fails', async () => {
  const lifecycle = new CortexLifecycle(
    {
      CHATMOCK_COMPOSE_FILE: 'C:\\ChatMock\\docker-compose.yml',
      CORTEX_BASE_URL: 'http://localhost:8000/v1'
    },
    {
      execFile: async () => {
        const error = new Error('docker unavailable');
        error.stderr = 'Cannot connect to Docker';
        throw error;
      },
      fetch: async () => okResponse({ data: [] }),
      sleep: async () => {}
    }
  );

  const result = await lifecycle.start();
  assert.equal(result.ok, false);
  assert.equal(String(result.error).toLowerCase().includes('docker desktop'), true);
});

test('ensureRunning auto-starts when service is down and auto-start is enabled', async () => {
  const lifecycle = new CortexLifecycle(
    {
      CHATMOCK_COMPOSE_FILE: 'C:\\ChatMock\\docker-compose.yml',
      CORTEX_BASE_URL: 'http://localhost:8000/v1',
      CORTEX_AUTO_START: 'true'
    },
    {
      execFile: async (_cmd, args) => {
        if (args.includes('version')) {
          return { stdout: 'Docker version', stderr: '' };
        }
        if (args.includes('up')) {
          return { stdout: 'started', stderr: '' };
        }
        if (args.includes('ps')) {
          return { stdout: 'chatmock running', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      },
      fetch: async () => okResponse({ data: [{ id: 'gpt-5-low' }] }),
      sleep: async () => {}
    }
  );

  let first = true;
  const originalStatus = lifecycle.status.bind(lifecycle);
  lifecycle.status = async () => {
    if (first) {
      first = false;
      return { running: false, ready: false, models: [] };
    }
    return originalStatus();
  };

  const result = await lifecycle.ensureRunning();
  assert.equal(result.ok, true);
  assert.equal(result.status.ready, true);
});
