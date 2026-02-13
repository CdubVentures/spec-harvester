import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

function withEnv(pairs, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(pairs)) {
    previous.set(key, process.env[key]);
    if (value === null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('loadConfig reads Phase 11 cortex environment settings', () => {
  withEnv({
    CORTEX_ENABLED: 'true',
    CHATMOCK_DIR: 'C:\\Users\\Chris\\Desktop\\ChatMock',
    CHATMOCK_COMPOSE_FILE: 'C:\\Users\\Chris\\Desktop\\ChatMock\\docker-compose.yml',
    CORTEX_BASE_URL: 'http://localhost:8000/v1',
    CORTEX_MODEL_FAST: 'gpt-5-low',
    CORTEX_MODEL_REASONING_DEEP: 'gpt-5-high',
    CORTEX_MAX_DEEP_FIELDS_PER_PRODUCT: '9'
  }, () => {
    const config = loadConfig();
    assert.equal(config.cortexEnabled, true);
    assert.equal(config.chatmockDir.endsWith('ChatMock'), true);
    assert.equal(config.cortexBaseUrl, 'http://localhost:8000/v1');
    assert.equal(config.cortexModelFast, 'gpt-5-low');
    assert.equal(config.cortexModelReasoningDeep, 'gpt-5-high');
    assert.equal(config.cortexMaxDeepFieldsPerProduct, 9);
  });
});

test('loadConfig reads Phase 12 aggressive extraction environment settings', () => {
  withEnv({
    AGGRESSIVE_MODE_ENABLED: 'true',
    AGGRESSIVE_CONFIDENCE_THRESHOLD: '0.91',
    AGGRESSIVE_MAX_SEARCH_QUERIES: '7',
    AGGRESSIVE_EVIDENCE_AUDIT_ENABLED: 'true',
    AGGRESSIVE_EVIDENCE_AUDIT_BATCH_SIZE: '88',
    AGGRESSIVE_MAX_TIME_PER_PRODUCT_MS: '120000'
  }, () => {
    const config = loadConfig();
    assert.equal(config.aggressiveModeEnabled, true);
    assert.equal(config.aggressiveConfidenceThreshold, 0.91);
    assert.equal(config.aggressiveMaxSearchQueries, 7);
    assert.equal(config.aggressiveEvidenceAuditEnabled, true);
    assert.equal(config.aggressiveEvidenceAuditBatchSize, 88);
    assert.equal(config.aggressiveMaxTimePerProductMs, 120000);
  });
});
