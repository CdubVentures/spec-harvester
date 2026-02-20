import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalizeUrl,
  isTrackingParam,
  pathSignature
} from '../src/research/urlNormalize.js';

test('isTrackingParam detects common tracker keys', () => {
  assert.equal(isTrackingParam('utm_source'), true);
  assert.equal(isTrackingParam('gclid'), true);
  assert.equal(isTrackingParam('fbclid'), true);
  assert.equal(isTrackingParam('ref'), false);
});

test('canonicalizeUrl strips tracking params and normalizes host/scheme/trailing slash', () => {
  const out = canonicalizeUrl('HTTPS://WWW.Example.com/product/spec/?utm_source=x&utm_medium=y&b=2&a=1#frag');
  assert.equal(out.canonical_url, 'https://example.com/product/spec?a=1&b=2');
  assert.equal(out.domain, 'example.com');
  assert.equal(out.path_sig, '/product/spec');
});

test('canonicalizeUrl keeps non-tracking params and normalizes AMP/share paths', () => {
  const amp = canonicalizeUrl('https://example.com/amp/product/spec/?id=123&fbclid=abc');
  assert.equal(amp.canonical_url, 'https://example.com/product/spec?id=123');

  const share = canonicalizeUrl('https://example.com/share/product/spec/?id=123');
  assert.equal(share.canonical_url, 'https://example.com/product/spec?id=123');
});

test('pathSignature buckets numeric and uuid-like segments', () => {
  assert.equal(pathSignature('/products/12345/specs'), '/products/:num/specs');
  assert.equal(
    pathSignature('/api/v1/item/550e8400-e29b-41d4-a716-446655440000'),
    '/api/v1/item/:id'
  );
});
