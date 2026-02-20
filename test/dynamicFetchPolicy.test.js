import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDynamicFetchPolicyMap,
  normalizeHostToken,
  resolveDynamicFetchPolicy
} from '../src/fetcher/dynamicFetchPolicy.js';

test('dynamic fetch policy: normalizes host tokens', () => {
  assert.equal(normalizeHostToken('HTTPS://www.Example.com/path?a=1'), 'example.com');
  assert.equal(normalizeHostToken('sub.vendor.com'), 'sub.vendor.com');
});

test('dynamic fetch policy: normalizes policy map values', () => {
  const map = normalizeDynamicFetchPolicyMap({
    'WWW.Example.com': {
      perHostMinDelayMs: '120',
      pageGotoTimeoutMs: '15000',
      graphqlReplayEnabled: 'false',
      maxGraphqlReplays: '3',
      retryBudget: '2',
      retryBackoffMs: '450'
    }
  });

  assert.equal(Boolean(map['example.com']), true);
  assert.equal(map['example.com'].perHostMinDelayMs, 120);
  assert.equal(map['example.com'].pageGotoTimeoutMs, 15000);
  assert.equal(map['example.com'].graphqlReplayEnabled, false);
  assert.equal(map['example.com'].maxGraphqlReplays, 3);
  assert.equal(map['example.com'].retryBudget, 2);
  assert.equal(map['example.com'].retryBackoffMs, 450);
});

test('dynamic fetch policy: resolves exact host override first', () => {
  const config = {
    perHostMinDelayMs: 900,
    pageGotoTimeoutMs: 30000,
    pageNetworkIdleTimeoutMs: 6000,
    postLoadWaitMs: 0,
    autoScrollEnabled: false,
    autoScrollPasses: 0,
    autoScrollDelayMs: 900,
    graphqlReplayEnabled: true,
    maxGraphqlReplays: 5,
    dynamicFetchRetryBudget: 0,
    dynamicFetchRetryBackoffMs: 350,
    dynamicFetchPolicyMap: normalizeDynamicFetchPolicyMap({
      'example.com': { pageGotoTimeoutMs: 8000, maxGraphqlReplays: 2 },
      'vendor.example.com': { pageGotoTimeoutMs: 25000, maxGraphqlReplays: 11, retryBudget: 3, retryBackoffMs: 500 }
    })
  };

  const policy = resolveDynamicFetchPolicy(config, {
    host: 'vendor.example.com',
    url: 'https://vendor.example.com/specs'
  });

  assert.equal(policy.overrideApplied, true);
  assert.equal(policy.matchedHost, 'vendor.example.com');
  assert.equal(policy.pageGotoTimeoutMs, 25000);
  assert.equal(policy.maxGraphqlReplays, 11);
  assert.equal(policy.retryBudget, 3);
  assert.equal(policy.retryBackoffMs, 500);
});

test('dynamic fetch policy: resolves parent-domain override when subdomain not explicit', () => {
  const config = {
    perHostMinDelayMs: 900,
    pageGotoTimeoutMs: 30000,
    pageNetworkIdleTimeoutMs: 6000,
    postLoadWaitMs: 0,
    autoScrollEnabled: false,
    autoScrollPasses: 0,
    autoScrollDelayMs: 900,
    graphqlReplayEnabled: true,
    maxGraphqlReplays: 5,
    dynamicFetchRetryBudget: 1,
    dynamicFetchRetryBackoffMs: 300,
    dynamicFetchPolicyMap: normalizeDynamicFetchPolicyMap({
      'example.com': { pageGotoTimeoutMs: 12000, perHostMinDelayMs: 250 }
    })
  };

  const policy = resolveDynamicFetchPolicy(config, {
    host: 'shop.example.com',
    url: 'https://shop.example.com/product'
  });

  assert.equal(policy.overrideApplied, true);
  assert.equal(policy.matchedHost, 'example.com');
  assert.equal(policy.pageGotoTimeoutMs, 12000);
  assert.equal(policy.perHostMinDelayMs, 250);
  assert.equal(policy.retryBudget, 1);
  assert.equal(policy.retryBackoffMs, 300);
});

test('dynamic fetch policy: falls back to global config when no policy matches', () => {
  const config = {
    perHostMinDelayMs: 900,
    pageGotoTimeoutMs: 30000,
    pageNetworkIdleTimeoutMs: 6000,
    postLoadWaitMs: 0,
    autoScrollEnabled: false,
    autoScrollPasses: 0,
    autoScrollDelayMs: 900,
    graphqlReplayEnabled: true,
    maxGraphqlReplays: 5,
    dynamicFetchRetryBudget: 2,
    dynamicFetchRetryBackoffMs: 333,
    dynamicFetchPolicyMap: {}
  };

  const policy = resolveDynamicFetchPolicy(config, {
    host: 'unknown.com',
    url: 'https://unknown.com'
  });

  assert.equal(policy.overrideApplied, false);
  assert.equal(policy.pageGotoTimeoutMs, 30000);
  assert.equal(policy.perHostMinDelayMs, 900);
  assert.equal(policy.graphqlReplayEnabled, true);
  assert.equal(policy.retryBudget, 2);
  assert.equal(policy.retryBackoffMs, 333);
});
