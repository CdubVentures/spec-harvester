import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('config: parses DYNAMIC_FETCH_POLICY_MAP_JSON into normalized map', () => {
  const previous = process.env.DYNAMIC_FETCH_POLICY_MAP_JSON;
  const previousRetryBudget = process.env.DYNAMIC_FETCH_RETRY_BUDGET;
  const previousRetryBackoff = process.env.DYNAMIC_FETCH_RETRY_BACKOFF_MS;
  process.env.DYNAMIC_FETCH_POLICY_MAP_JSON = JSON.stringify({
    'WWW.Example.com': {
      pageGotoTimeoutMs: 9000,
      pageNetworkIdleTimeoutMs: 2500,
      perHostMinDelayMs: 200,
      graphqlReplayEnabled: false,
      retryBudget: 2,
      retryBackoffMs: 600
    }
  });
  process.env.DYNAMIC_FETCH_RETRY_BUDGET = '1';
  process.env.DYNAMIC_FETCH_RETRY_BACKOFF_MS = '350';

  try {
    const config = loadConfig({ runProfile: 'standard' });
    assert.equal(Boolean(config.dynamicFetchPolicyMap), true);
    assert.equal(Boolean(config.dynamicFetchPolicyMap['example.com']), true);
    assert.equal(config.dynamicFetchPolicyMap['example.com'].pageGotoTimeoutMs, 9000);
    assert.equal(config.dynamicFetchPolicyMap['example.com'].graphqlReplayEnabled, false);
    assert.equal(config.dynamicFetchPolicyMap['example.com'].retryBudget, 2);
    assert.equal(config.dynamicFetchPolicyMap['example.com'].retryBackoffMs, 600);
    assert.equal(config.dynamicFetchRetryBudget, 1);
    assert.equal(config.dynamicFetchRetryBackoffMs, 350);
  } finally {
    if (previous === undefined) {
      delete process.env.DYNAMIC_FETCH_POLICY_MAP_JSON;
    } else {
      process.env.DYNAMIC_FETCH_POLICY_MAP_JSON = previous;
    }
    if (previousRetryBudget === undefined) {
      delete process.env.DYNAMIC_FETCH_RETRY_BUDGET;
    } else {
      process.env.DYNAMIC_FETCH_RETRY_BUDGET = previousRetryBudget;
    }
    if (previousRetryBackoff === undefined) {
      delete process.env.DYNAMIC_FETCH_RETRY_BACKOFF_MS;
    } else {
      process.env.DYNAMIC_FETCH_RETRY_BACKOFF_MS = previousRetryBackoff;
    }
  }
});
