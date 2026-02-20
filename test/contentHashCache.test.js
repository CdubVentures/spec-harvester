import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeContentHash,
  ContentHashCache,
  shouldReuseEvidence
} from '../src/cache/contentHashCache.js';

// ---------------------------------------------------------------------------
// IP05-5B — Content Hash + Evidence Reuse Tests
// ---------------------------------------------------------------------------

test('hash: computes stable hash for same content', () => {
  const h1 = computeContentHash('<html>hello</html>');
  const h2 = computeContentHash('<html>hello</html>');
  assert.equal(h1, h2);
  assert.ok(h1.length > 16);
});

test('hash: different content yields different hash', () => {
  const h1 = computeContentHash('<html>page A</html>');
  const h2 = computeContentHash('<html>page B</html>');
  assert.notEqual(h1, h2);
});

test('hash: empty content returns consistent hash', () => {
  const h1 = computeContentHash('');
  const h2 = computeContentHash('');
  assert.equal(h1, h2);
});

test('cache: stores and retrieves by URL + hash', () => {
  const cache = new ContentHashCache();
  cache.set('https://example.com/mouse', 'abc123', { sensor: 'hero 25k' });
  const entry = cache.get('https://example.com/mouse', 'abc123');
  assert.ok(entry);
  assert.deepEqual(entry.evidence, { sensor: 'hero 25k' });
});

test('cache: returns null for unknown URL', () => {
  const cache = new ContentHashCache();
  assert.equal(cache.get('https://unknown.com', 'hash'), null);
});

test('cache: returns null for different hash (content changed)', () => {
  const cache = new ContentHashCache();
  cache.set('https://example.com', 'hash1', { weight: '80g' });
  const entry = cache.get('https://example.com', 'hash2');
  assert.equal(entry, null);
});

test('cache: updates entry when hash changes', () => {
  const cache = new ContentHashCache();
  cache.set('https://example.com', 'old_hash', { weight: '80g' });
  cache.set('https://example.com', 'new_hash', { weight: '85g' });
  assert.equal(cache.get('https://example.com', 'old_hash'), null);
  assert.deepEqual(cache.get('https://example.com', 'new_hash').evidence, { weight: '85g' });
});

test('cache: stores ETag and Last-Modified', () => {
  const cache = new ContentHashCache();
  cache.set('https://example.com', 'hash1', { data: 1 }, {
    etag: '"abc"',
    lastModified: 'Thu, 01 Jan 2026 00:00:00 GMT'
  });
  const entry = cache.get('https://example.com', 'hash1');
  assert.equal(entry.etag, '"abc"');
  assert.equal(entry.lastModified, 'Thu, 01 Jan 2026 00:00:00 GMT');
});

test('cache: stats reports entry count and hit/miss', () => {
  const cache = new ContentHashCache();
  cache.set('https://a.com', 'h1', {});
  cache.set('https://b.com', 'h2', {});
  cache.get('https://a.com', 'h1'); // hit
  cache.get('https://c.com', 'h3'); // miss
  const stats = cache.stats();
  assert.equal(stats.entries, 2);
  assert.equal(stats.hits, 1);
  assert.equal(stats.misses, 1);
});

test('cache: evicts oldest entries when maxSize exceeded', () => {
  const cache = new ContentHashCache({ maxSize: 3 });
  cache.set('https://a.com', 'h1', { a: 1 });
  cache.set('https://b.com', 'h2', { b: 2 });
  cache.set('https://c.com', 'h3', { c: 3 });
  cache.set('https://d.com', 'h4', { d: 4 });
  // 'a' should be evicted
  assert.equal(cache.get('https://a.com', 'h1'), null);
  assert.ok(cache.get('https://d.com', 'h4'));
  assert.equal(cache.stats().entries, 3);
});

test('reuse: shouldReuseEvidence returns true for matching hash', () => {
  const cache = new ContentHashCache();
  cache.set('https://example.com', 'myhash', { sensor: 'hero' });
  const result = shouldReuseEvidence({ cache, url: 'https://example.com', contentHash: 'myhash' });
  assert.equal(result.reuse, true);
  assert.deepEqual(result.evidence, { sensor: 'hero' });
});

test('reuse: shouldReuseEvidence returns false for changed content', () => {
  const cache = new ContentHashCache();
  cache.set('https://example.com', 'old', { sensor: 'hero' });
  const result = shouldReuseEvidence({ cache, url: 'https://example.com', contentHash: 'new' });
  assert.equal(result.reuse, false);
  assert.equal(result.evidence, null);
});

test('reuse: shouldReuseEvidence returns false for unknown URL', () => {
  const cache = new ContentHashCache();
  const result = shouldReuseEvidence({ cache, url: 'https://new.com', contentHash: 'hash' });
  assert.equal(result.reuse, false);
});

test('cache: clear removes all entries and resets stats', () => {
  const cache = new ContentHashCache();
  cache.set('https://a.com', 'h1', {});
  cache.get('https://a.com', 'h1');
  cache.clear();
  assert.equal(cache.stats().entries, 0);
  assert.equal(cache.stats().hits, 0);
  assert.equal(cache.stats().misses, 0);
});
