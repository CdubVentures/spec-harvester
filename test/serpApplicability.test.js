import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeIdentityMatchLevel,
  detectVariantGuardHit,
  detectMultiModelHint
} from '../src/discovery/searchDiscovery.js';

test('computeIdentityMatchLevel returns strong when brand+model+variant all present', () => {
  const result = computeIdentityMatchLevel({
    url: 'https://razer.com/viper-v3-pro',
    title: 'Razer Viper V3 Pro Specs',
    snippet: 'The Razer Viper V3 Pro gaming mouse',
    identityLock: { brand: 'Razer', model: 'Viper V3', variant: 'Pro' }
  });
  assert.equal(result, 'strong');
});

test('computeIdentityMatchLevel returns partial, weak, none for decreasing matches', () => {
  const partial = computeIdentityMatchLevel({
    url: 'https://example.com/page',
    title: 'Razer Viper V3 Review',
    snippet: 'The Razer Viper V3 offers great performance',
    identityLock: { brand: 'Razer', model: 'Viper V3', variant: 'Pro' }
  });
  assert.equal(partial, 'partial');

  const weak = computeIdentityMatchLevel({
    url: 'https://example.com/page',
    title: 'Latest Razer Products',
    snippet: 'Razer gaming peripherals overview',
    identityLock: { brand: 'Razer', model: 'Viper V3', variant: 'Pro' }
  });
  assert.equal(weak, 'weak');

  const none = computeIdentityMatchLevel({
    url: 'https://example.com/page',
    title: 'Best Gaming Mice 2025',
    snippet: 'Top picks for gaming mice',
    identityLock: { brand: 'Razer', model: 'Viper V3', variant: 'Pro' }
  });
  assert.equal(none, 'none');
});

test('detectVariantGuardHit returns true when URL contains different variant guard term', () => {
  const result = detectVariantGuardHit({
    title: 'Razer Viper V3 Hyperspeed Review',
    snippet: 'The Hyperspeed variant offers wireless',
    url: 'https://example.com/viper-v3-hyperspeed',
    variantGuardTerms: ['hyperspeed', 'pro'],
    targetVariant: 'Pro'
  });
  assert.equal(result, true);
});

test('detectVariantGuardHit returns false when only target variant appears', () => {
  const result = detectVariantGuardHit({
    title: 'Razer Viper V3 Pro Review',
    snippet: 'The Pro variant',
    url: 'https://example.com/viper-v3-pro',
    variantGuardTerms: ['hyperspeed', 'pro'],
    targetVariant: 'Pro'
  });
  assert.equal(result, false);
});

test('detectMultiModelHint returns true for comparison pages', () => {
  assert.equal(
    detectMultiModelHint({
      title: 'Top 10 gaming mice',
      snippet: 'The best gaming mice for competitive play'
    }),
    true
  );
  assert.equal(
    detectMultiModelHint({
      title: 'Razer Viper V3 vs Logitech G Pro X',
      snippet: 'We compare these two mice head to head'
    }),
    true
  );
  assert.equal(
    detectMultiModelHint({
      title: 'Best wireless mice comparison',
      snippet: 'Comparing 5 top wireless mice'
    }),
    true
  );
});

test('detectMultiModelHint returns false for single product pages', () => {
  assert.equal(
    detectMultiModelHint({
      title: 'Razer Viper V3 Pro Specs',
      snippet: 'Detailed specifications for the Viper V3 Pro'
    }),
    false
  );
});
