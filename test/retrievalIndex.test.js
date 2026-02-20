import test from 'node:test';
import assert from 'node:assert/strict';
import { RetrievalIndex } from '../src/intel/retrievalIndex.js';

// ---------------------------------------------------------------------------
// IP04-4C — Internal Retrieval Index Tests
// ---------------------------------------------------------------------------

test('index: stores and retrieves evidence by field', () => {
  const idx = new RetrievalIndex();
  idx.add({
    field: 'sensor',
    domain: 'rtings.com',
    snippet: 'HERO 25K sensor',
    productId: 'mouse-001'
  });
  const results = idx.query({ field: 'sensor' });
  assert.equal(results.length, 1);
  assert.equal(results[0].snippet, 'HERO 25K sensor');
});

test('index: retrieves evidence by field + domain', () => {
  const idx = new RetrievalIndex();
  idx.add({ field: 'weight', domain: 'rtings.com', snippet: '80g', productId: 'p1' });
  idx.add({ field: 'weight', domain: 'logitech.com', snippet: '85g', productId: 'p2' });
  const results = idx.query({ field: 'weight', domain: 'rtings.com' });
  assert.equal(results.length, 1);
  assert.equal(results[0].snippet, '80g');
});

test('index: returns empty for unknown field', () => {
  const idx = new RetrievalIndex();
  assert.equal(idx.query({ field: 'unknown_field' }).length, 0);
});

test('index: deduplicates by field + domain + productId', () => {
  const idx = new RetrievalIndex();
  idx.add({ field: 'sensor', domain: 'rtings.com', snippet: 'v1', productId: 'p1' });
  idx.add({ field: 'sensor', domain: 'rtings.com', snippet: 'v2', productId: 'p1' });
  const results = idx.query({ field: 'sensor' });
  assert.equal(results.length, 1);
  assert.equal(results[0].snippet, 'v2'); // updated
});

test('index: tracks multiple domains per field', () => {
  const idx = new RetrievalIndex();
  idx.add({ field: 'dpi', domain: 'a.com', snippet: '25600', productId: 'p1' });
  idx.add({ field: 'dpi', domain: 'b.com', snippet: '25600', productId: 'p2' });
  idx.add({ field: 'dpi', domain: 'c.com', snippet: '25600', productId: 'p3' });
  const results = idx.query({ field: 'dpi' });
  assert.equal(results.length, 3);
});

test('index: stats reports field count and entry count', () => {
  const idx = new RetrievalIndex();
  idx.add({ field: 'sensor', domain: 'a.com', snippet: 'x', productId: 'p1' });
  idx.add({ field: 'weight', domain: 'a.com', snippet: 'y', productId: 'p1' });
  idx.add({ field: 'sensor', domain: 'b.com', snippet: 'z', productId: 'p2' });
  const stats = idx.stats();
  assert.equal(stats.field_count, 2);
  assert.equal(stats.total_entries, 3);
});

test('index: fields returns list of all indexed fields', () => {
  const idx = new RetrievalIndex();
  idx.add({ field: 'weight', domain: 'a.com', snippet: 'x', productId: 'p1' });
  idx.add({ field: 'sensor', domain: 'a.com', snippet: 'y', productId: 'p1' });
  const fields = idx.fields();
  assert.ok(fields.includes('weight'));
  assert.ok(fields.includes('sensor'));
});

test('index: query by productId returns all entries for that product', () => {
  const idx = new RetrievalIndex();
  idx.add({ field: 'sensor', domain: 'a.com', snippet: 'x', productId: 'p1' });
  idx.add({ field: 'weight', domain: 'b.com', snippet: 'y', productId: 'p1' });
  idx.add({ field: 'sensor', domain: 'c.com', snippet: 'z', productId: 'p2' });
  const results = idx.queryByProduct('p1');
  assert.equal(results.length, 2);
});

test('index: clear empties the index', () => {
  const idx = new RetrievalIndex();
  idx.add({ field: 'sensor', domain: 'a.com', snippet: 'x', productId: 'p1' });
  idx.clear();
  assert.equal(idx.stats().total_entries, 0);
  assert.equal(idx.stats().field_count, 0);
});

test('index: respects maxEntriesPerField limit', () => {
  const idx = new RetrievalIndex({ maxEntriesPerField: 2 });
  idx.add({ field: 'sensor', domain: 'a.com', snippet: '1', productId: 'p1' });
  idx.add({ field: 'sensor', domain: 'b.com', snippet: '2', productId: 'p2' });
  idx.add({ field: 'sensor', domain: 'c.com', snippet: '3', productId: 'p3' });
  const results = idx.query({ field: 'sensor' });
  assert.equal(results.length, 2);
});
