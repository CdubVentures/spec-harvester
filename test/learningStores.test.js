import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  ComponentLexiconStore,
  FieldAnchorsStore,
  UrlMemoryStore,
  DomainFieldYieldStore
} from '../src/learning/learningStores.js';

function makeDb() {
  return new Database(':memory:');
}

test('ComponentLexiconStore: insert and query by field+category', () => {
  const db = makeDb();
  const store = new ComponentLexiconStore(db);
  store.insert({ field: 'sensor', category: 'mouse', value: 'Focus Pro 35K', sourceRunId: 'run-1' });
  store.insert({ field: 'sensor', category: 'mouse', value: 'PMW 3950', sourceRunId: 'run-2' });
  store.insert({ field: 'dpi', category: 'mouse', value: '35000', sourceRunId: 'run-1' });

  const results = store.query({ field: 'sensor', category: 'mouse' });
  assert.equal(results.length, 2);
  assert.ok(results.some((r) => r.value === 'Focus Pro 35K'));
  db.close();
});

test('ComponentLexiconStore: decay after 90 days, expire after 180', () => {
  const db = makeDb();
  const store = new ComponentLexiconStore(db);
  const now = Date.now();
  const days91Ago = new Date(now - 91 * 24 * 60 * 60 * 1000).toISOString();
  const days181Ago = new Date(now - 181 * 24 * 60 * 60 * 1000).toISOString();

  store.insert({ field: 'sensor', category: 'mouse', value: 'Fresh', sourceRunId: 'r1' });
  db.prepare('UPDATE component_lexicon SET created_at = ? WHERE value = ?').run(days91Ago, 'Fresh');
  store.insert({ field: 'sensor', category: 'mouse', value: 'Expired', sourceRunId: 'r2' });
  db.prepare('UPDATE component_lexicon SET created_at = ? WHERE value = ?').run(days181Ago, 'Expired');
  store.insert({ field: 'sensor', category: 'mouse', value: 'Current', sourceRunId: 'r3' });

  const results = store.queryWithDecay({ field: 'sensor', category: 'mouse' });
  assert.ok(results.some((r) => r.value === 'Current' && r.decay_status === 'active'));
  assert.ok(results.some((r) => r.value === 'Fresh' && r.decay_status === 'decayed'));
  assert.ok(!results.some((r) => r.value === 'Expired'));
  db.close();
});

test('FieldAnchorsStore: insert and query with source URL ref', () => {
  const db = makeDb();
  const store = new FieldAnchorsStore(db);
  store.insert({ field: 'sensor', category: 'mouse', phrase: 'Focus Pro 35K sensor', sourceUrl: 'https://razer.com/specs', sourceRunId: 'r1' });

  const results = store.query({ field: 'sensor', category: 'mouse' });
  assert.equal(results.length, 1);
  assert.equal(results[0].phrase, 'Focus Pro 35K sensor');
  assert.equal(results[0].source_url, 'https://razer.com/specs');
  db.close();
});

test('FieldAnchorsStore: decay after 60 days', () => {
  const db = makeDb();
  const store = new FieldAnchorsStore(db);
  const now = Date.now();
  const days61Ago = new Date(now - 61 * 24 * 60 * 60 * 1000).toISOString();

  store.insert({ field: 'sensor', category: 'mouse', phrase: 'Old anchor', sourceUrl: 'u1', sourceRunId: 'r1' });
  db.prepare('UPDATE field_anchors SET created_at = ? WHERE phrase = ?').run(days61Ago, 'Old anchor');
  store.insert({ field: 'sensor', category: 'mouse', phrase: 'New anchor', sourceUrl: 'u2', sourceRunId: 'r2' });

  const results = store.queryWithDecay({ field: 'sensor', category: 'mouse' });
  assert.ok(results.some((r) => r.phrase === 'New anchor' && r.decay_status === 'active'));
  assert.ok(results.some((r) => r.phrase === 'Old anchor' && r.decay_status === 'decayed'));
  db.close();
});

test('UrlMemoryStore: insert and upsert increments used_count', () => {
  const db = makeDb();
  const store = new UrlMemoryStore(db);
  store.upsert({ field: 'sensor', category: 'mouse', url: 'https://razer.com/specs', sourceRunId: 'r1' });
  store.upsert({ field: 'sensor', category: 'mouse', url: 'https://razer.com/specs', sourceRunId: 'r2' });

  const results = store.query({ field: 'sensor', category: 'mouse' });
  assert.equal(results.length, 1);
  assert.equal(results[0].used_count, 2);
  db.close();
});

test('UrlMemoryStore: decay after 120 days', () => {
  const db = makeDb();
  const store = new UrlMemoryStore(db);
  const now = Date.now();
  const days121Ago = new Date(now - 121 * 24 * 60 * 60 * 1000).toISOString();

  store.upsert({ field: 'sensor', category: 'mouse', url: 'https://old.com', sourceRunId: 'r1' });
  db.prepare('UPDATE url_memory SET created_at = ?, updated_at = ? WHERE url = ?').run(days121Ago, days121Ago, 'https://old.com');
  store.upsert({ field: 'sensor', category: 'mouse', url: 'https://new.com', sourceRunId: 'r2' });

  const results = store.queryWithDecay({ field: 'sensor', category: 'mouse' });
  assert.ok(results.some((r) => r.url === 'https://new.com' && r.decay_status === 'active'));
  assert.ok(results.some((r) => r.url === 'https://old.com' && r.decay_status === 'decayed'));
  db.close();
});

test('DomainFieldYieldStore: increment seen/used and compute yield ratio', () => {
  const db = makeDb();
  const store = new DomainFieldYieldStore(db);
  store.recordSeen({ domain: 'razer.com', field: 'sensor', category: 'mouse' });
  store.recordSeen({ domain: 'razer.com', field: 'sensor', category: 'mouse' });
  store.recordUsed({ domain: 'razer.com', field: 'sensor', category: 'mouse' });

  const result = store.getYield({ domain: 'razer.com', field: 'sensor', category: 'mouse' });
  assert.equal(result.seen_count, 2);
  assert.equal(result.used_count, 1);
  assert.ok(Math.abs(result.yield_ratio - 0.5) < 0.001);
  db.close();
});

test('DomainFieldYieldStore: flag low-yield domains', () => {
  const db = makeDb();
  const store = new DomainFieldYieldStore(db);
  for (let i = 0; i < 10; i++) {
    store.recordSeen({ domain: 'low-yield.com', field: 'sensor', category: 'mouse' });
  }
  store.recordUsed({ domain: 'low-yield.com', field: 'sensor', category: 'mouse' });

  const lowYield = store.getLowYieldDomains({ category: 'mouse', minSeen: 5, maxYield: 0.2 });
  assert.ok(lowYield.some((r) => r.domain === 'low-yield.com'));
  db.close();
});
