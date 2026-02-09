import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdapterManager } from '../src/adapters/index.js';
import { eloShapesAdapter } from '../src/adapters/eloShapesAdapter.js';

test('eloshapes adapter host selection is scoped to eloshapes domains', () => {
  assert.equal(eloShapesAdapter.supportsHost({ source: { host: 'eloshapes.com' } }), true);
  assert.equal(eloShapesAdapter.supportsHost({ source: { host: 'api.eloshapes.com' } }), true);
  assert.equal(eloShapesAdapter.supportsHost({ source: { host: 'example.com' } }), false);
});

test('adapter manager redacts eloshapes key from error logs', async () => {
  const secret = 'SECRET_ELO_TOKEN_123';
  const config = {
    eloSupabaseAnonKey: secret,
    eloSupabaseEndpoint: 'https://example.com/rest/v1/mouse',
    bingSearchKey: '',
    googleCseKey: ''
  };

  const warnings = [];
  const logger = {
    warn(event, payload) {
      warnings.push({ event, payload });
    }
  };

  const manager = createAdapterManager(config, logger);
  const original = eloShapesAdapter.runDedicatedFetch;

  eloShapesAdapter.runDedicatedFetch = async () => {
    throw new Error(`dedicated adapter failed for key=${secret}`);
  };

  try {
    await manager.runDedicatedAdapters({
      job: { identityLock: {} },
      runId: 'test-run',
      storage: {
        writeObject: async () => {}
      }
    });
  } finally {
    eloShapesAdapter.runDedicatedFetch = original;
  }

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].event, 'adapter_dedicated_failed');
  assert.equal(warnings[0].payload.message.includes(secret), false);
  assert.equal(warnings[0].payload.message.includes('[redacted]'), true);
});
