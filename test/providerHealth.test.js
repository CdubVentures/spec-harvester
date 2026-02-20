import test from 'node:test';
import assert from 'node:assert/strict';
import { LlmProviderHealth, normalizeProviderBaseUrl } from '../src/llm/providerHealth.js';
import { getProviderHealth } from '../src/llm/openaiClient.js';

// ---------------------------------------------------------------------------
// Phase 01 — Foundation Hardening: Provider Health Tests
// ---------------------------------------------------------------------------

// =========================================================================
// SECTION 1: Circuit breaker behavior
// =========================================================================

test('P01 health: new provider starts in closed state', () => {
  const health = new LlmProviderHealth();
  assert.equal(health.canRequest('openai'), true);
  const snap = health.snapshot('openai');
  assert.equal(snap.state, 'closed');
});

test('P01 health: opens circuit after failure threshold', () => {
  const health = new LlmProviderHealth({ failureThreshold: 3 });
  health.recordFailure('openai', 'timeout');
  health.recordFailure('openai', 'timeout');
  assert.equal(health.canRequest('openai'), true);
  health.recordFailure('openai', 'timeout');
  assert.equal(health.canRequest('openai'), false);
  assert.equal(health.snapshot('openai').state, 'open');
});

test('P01 health: circuit resets on success', () => {
  const health = new LlmProviderHealth({ failureThreshold: 2 });
  health.recordFailure('openai', 'err');
  health.recordSuccess('openai');
  assert.equal(health.snapshot('openai').failure_count, 0);
  assert.equal(health.canRequest('openai'), true);
});

test('P01 health: half-open after openMs elapsed', () => {
  let now = 1000;
  const health = new LlmProviderHealth({
    failureThreshold: 1,
    openMs: 5000,
    now: () => now
  });
  health.recordFailure('deepseek', 'err');
  assert.equal(health.canRequest('deepseek'), false);
  now = 6001;
  assert.equal(health.canRequest('deepseek'), true);
  assert.equal(health.snapshot('deepseek').state, 'half_open');
});

test('P01 health: tracks multiple providers independently', () => {
  const health = new LlmProviderHealth({ failureThreshold: 2 });
  health.recordFailure('openai', 'err');
  health.recordFailure('openai', 'err');
  health.recordSuccess('deepseek');
  assert.equal(health.canRequest('openai'), false);
  assert.equal(health.canRequest('deepseek'), true);
});

test('P01 health: snapshot all providers', () => {
  const health = new LlmProviderHealth();
  health.recordSuccess('openai');
  health.recordSuccess('deepseek');
  const all = health.snapshot();
  assert.ok(all.openai);
  assert.ok(all.deepseek);
  assert.equal(all.openai.success_count, 1);
});

// =========================================================================
// SECTION 2: Base URL normalization
// =========================================================================

test('P01 url: appends /v1 to api.openai.com', () => {
  assert.equal(normalizeProviderBaseUrl('https://api.openai.com'), 'https://api.openai.com/v1');
});

test('P01 url: does not double-append /v1', () => {
  assert.equal(normalizeProviderBaseUrl('https://api.openai.com/v1'), 'https://api.openai.com/v1');
});

test('P01 url: strips trailing slashes', () => {
  assert.equal(normalizeProviderBaseUrl('https://api.openai.com///'), 'https://api.openai.com/v1');
});

test('P01 url: does not modify deepseek URLs', () => {
  assert.equal(normalizeProviderBaseUrl('https://api.deepseek.com'), 'https://api.deepseek.com');
});

test('P01 url: appends /v1 to localhost', () => {
  assert.equal(normalizeProviderBaseUrl('http://localhost:8000'), 'http://localhost:8000/v1');
});

test('P01 url: handles empty string', () => {
  assert.equal(normalizeProviderBaseUrl(''), '');
});

// =========================================================================
// SECTION 3: callOpenAI integration — getProviderHealth export
// =========================================================================

test('P01 integration: getProviderHealth returns LlmProviderHealth singleton', () => {
  const health = getProviderHealth();
  assert.ok(health instanceof LlmProviderHealth);
  assert.equal(typeof health.canRequest, 'function');
  assert.equal(typeof health.recordSuccess, 'function');
  assert.equal(typeof health.recordFailure, 'function');
});

test('P01 integration: getProviderHealth returns same instance on repeated calls', () => {
  const a = getProviderHealth();
  const b = getProviderHealth();
  assert.equal(a, b);
});
