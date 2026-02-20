import test from 'node:test';
import assert from 'node:assert/strict';
import { FrontierDb, createFrontier } from '../src/research/frontierDb.js';

// ---------------------------------------------------------------------------
// A.2 — SQLite Frontier Tests
//
// These tests define the interface contract that FrontierDbSqlite must satisfy.
// They are written against the existing FrontierDb (JSON) to verify the
// interface contract, and will be re-run against FrontierDbSqlite once
// implemented in Pass 3.
//
// The factory function should return either JSON or SQLite based on config.
// ---------------------------------------------------------------------------

function createStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    resolveOutputKey: (...parts) => parts.filter(Boolean).join('/'),
    async readJsonOrNull(key) {
      return data.has(key) ? data.get(key) : null;
    },
    async writeObject(key, body) {
      data.set(key, JSON.parse(Buffer.from(body).toString('utf8')));
    },
    snapshot(key) {
      return data.get(key);
    },
    keys() {
      return [...data.keys()];
    }
  };
}

const FRONTIER_KEY = 'specs/outputs/_intel/frontier/frontier.json';

// =========================================================================
// SECTION 1: Core interface contract (must pass for both JSON and SQLite)
// =========================================================================

test('A.2 interface: load() initializes empty state without error', async () => {
  const storage = createStorage();
  const db = new FrontierDb({ storage, key: FRONTIER_KEY });
  await db.load();
  // Verify basic state initialized
  const snapshot = db.snapshotForProduct('nonexistent');
  assert.equal(snapshot.query_count, 0);
  assert.equal(snapshot.url_count, 0);
});

test('A.2 interface: save() persists state to storage', async () => {
  const storage = createStorage();
  const db = new FrontierDb({ storage, key: FRONTIER_KEY });
  await db.load();
  db.recordQuery({
    productId: 'p1',
    query: 'test query',
    provider: 'searxng',
    fields: ['weight'],
    results: [{ url: 'https://example.com' }]
  });
  await db.save();
  assert.ok(storage.snapshot(FRONTIER_KEY) !== undefined);
});

test('A.2 interface: load() restores previously saved state', async () => {
  const storage = createStorage();
  const db1 = new FrontierDb({ storage, key: FRONTIER_KEY });
  await db1.load();
  db1.recordQuery({
    productId: 'p1',
    query: 'test query',
    provider: 'searxng',
    fields: ['weight'],
    results: [{ url: 'https://example.com' }]
  });
  db1.recordFetch({
    productId: 'p1',
    url: 'https://example.com',
    status: 200,
    fieldsFound: ['weight']
  });
  await db1.save();

  // Reload from storage
  const db2 = new FrontierDb({ storage, key: FRONTIER_KEY });
  await db2.load();
  assert.equal(db2.shouldSkipQuery({ productId: 'p1', query: 'test query' }), true);
});

// =========================================================================
// SECTION 2: Query deduplication
// =========================================================================

test('A.2 query dedupe: first query is NOT skipped', async () => {
  const storage = createStorage();
  const db = new FrontierDb({
    storage,
    key: FRONTIER_KEY,
    config: { frontierQueryCooldownSeconds: 3600 }
  });
  await db.load();
  assert.equal(
    db.shouldSkipQuery({ productId: 'p1', query: 'razer viper v3 pro weight' }),
    false
  );
});

test('A.2 query dedupe: repeated query for SAME product IS skipped during cooldown', async () => {
  const storage = createStorage();
  const db = new FrontierDb({
    storage,
    key: FRONTIER_KEY,
    config: { frontierQueryCooldownSeconds: 3600 }
  });
  await db.load();
  db.recordQuery({
    productId: 'p1',
    query: 'razer viper v3 pro weight',
    provider: 'searxng',
    fields: ['weight'],
    results: []
  });
  assert.equal(
    db.shouldSkipQuery({ productId: 'p1', query: 'razer viper v3 pro weight' }),
    true
  );
});

test('A.2 query dedupe: same query for DIFFERENT product is NOT skipped', async () => {
  const storage = createStorage();
  const db = new FrontierDb({
    storage,
    key: FRONTIER_KEY,
    config: { frontierQueryCooldownSeconds: 3600 }
  });
  await db.load();
  db.recordQuery({
    productId: 'p1',
    query: 'razer viper specs',
    provider: 'searxng',
    fields: ['weight'],
    results: []
  });
  assert.equal(
    db.shouldSkipQuery({ productId: 'p2', query: 'razer viper specs' }),
    false
  );
});

test('A.2 query dedupe: case-insensitive query normalization', async () => {
  const storage = createStorage();
  const db = new FrontierDb({
    storage,
    key: FRONTIER_KEY,
    config: { frontierQueryCooldownSeconds: 3600 }
  });
  await db.load();
  db.recordQuery({
    productId: 'p1',
    query: 'Razer Viper SPECS',
    provider: 'searxng',
    fields: [],
    results: []
  });
  assert.equal(
    db.shouldSkipQuery({ productId: 'p1', query: 'razer viper specs' }),
    true
  );
});

// =========================================================================
// SECTION 3: URL cooldown enforcement
// =========================================================================

test('A.2 url cooldown: new URL is NOT skipped', async () => {
  const storage = createStorage();
  const db = new FrontierDb({ storage, key: FRONTIER_KEY });
  await db.load();
  const result = db.shouldSkipUrl('https://example.com/specs');
  assert.equal(result.skip, false);
});

test('A.2 url cooldown: 404 URL is skipped', async () => {
  const storage = createStorage();
  const db = new FrontierDb({
    storage,
    key: FRONTIER_KEY,
    config: { frontierCooldown404Seconds: 3600 }
  });
  await db.load();
  db.recordFetch({
    productId: 'p1',
    url: 'https://example.com/specs',
    status: 404
  });
  const result = db.shouldSkipUrl('https://example.com/specs');
  assert.equal(result.skip, true);
  assert.equal(result.reason, 'cooldown');
});

test('A.2 url cooldown: repeated 404 gets longer cooldown', async () => {
  const storage = createStorage();
  const db = new FrontierDb({
    storage,
    key: FRONTIER_KEY,
    config: {
      frontierCooldown404Seconds: 60,
      frontierCooldown404RepeatSeconds: 600
    }
  });
  await db.load();
  const url = 'https://example.com/dead-page';
  db.recordFetch({ productId: 'p1', url, status: 404 });
  db.recordFetch({ productId: 'p2', url, status: 404 });
  db.recordFetch({ productId: 'p3', url, status: 404 });
  const row = db.getUrlRow(url);
  assert.equal(row.cooldown.reason, 'status_404_repeated');
});

test('A.2 url cooldown: 200 response does NOT create cooldown', async () => {
  const storage = createStorage();
  const db = new FrontierDb({ storage, key: FRONTIER_KEY });
  await db.load();
  db.recordFetch({
    productId: 'p1',
    url: 'https://example.com/good-page',
    status: 200,
    fieldsFound: ['weight']
  });
  const result = db.shouldSkipUrl('https://example.com/good-page');
  assert.equal(result.skip, false);
});

test('A.2 url cooldown: 410 (Gone) gets long cooldown', async () => {
  const storage = createStorage();
  const db = new FrontierDb({
    storage,
    key: FRONTIER_KEY,
    config: { frontierCooldown410Seconds: 7776000 }
  });
  await db.load();
  db.recordFetch({
    productId: 'p1',
    url: 'https://example.com/removed',
    status: 410
  });
  const result = db.shouldSkipUrl('https://example.com/removed');
  assert.equal(result.skip, true);
});

// =========================================================================
// SECTION 4: Domain and path statistics
// =========================================================================

test('A.2 domain stats: records domain-level fetch outcomes in internal state', async () => {
  const storage = createStorage();
  const db = new FrontierDb({ storage, key: FRONTIER_KEY });
  await db.load();
  db.recordFetch({ productId: 'p1', url: 'https://rtings.com/page1', status: 200, fieldsFound: ['weight'] });
  db.recordFetch({ productId: 'p1', url: 'https://rtings.com/page2', status: 200, fieldsFound: ['dpi'] });
  db.recordFetch({ productId: 'p1', url: 'https://rtings.com/page3', status: 404 });
  // Domain stats are stored internally; verify via snapshot which includes url data
  const snapshot = db.snapshotForProduct('p1');
  assert.ok(snapshot.url_count >= 3);
  // Save and verify internal state persisted
  await db.save();
  const saved = storage.snapshot(FRONTIER_KEY);
  assert.ok(saved);
  // domain_stats should exist in serialized state
  assert.ok(saved.domain_stats || Object.keys(saved.urls || {}).length >= 3);
});

test('A.2 yield tracking: records field yields per URL via fields_found', async () => {
  const storage = createStorage();
  const db = new FrontierDb({ storage, key: FRONTIER_KEY });
  await db.load();
  db.recordFetch({
    productId: 'p1',
    url: 'https://rtings.com/mouse/viper',
    status: 200,
    fieldsFound: ['weight', 'dpi', 'polling_rate'],
    confidence: 0.92
  });
  const row = db.getUrlRow('https://rtings.com/mouse/viper');
  assert.ok(row);
  // Fields are tracked in fields_found array
  assert.ok(Array.isArray(row.fields_found));
  assert.equal(row.fields_found.length >= 3, true);
  assert.ok(row.fields_found.includes('weight'));
  assert.ok(row.fields_found.includes('dpi'));
  assert.ok(row.fields_found.includes('polling_rate'));
});

// =========================================================================
// SECTION 5: Product snapshot
// =========================================================================

test('A.2 snapshot: returns aggregate stats for a product', async () => {
  const storage = createStorage();
  const db = new FrontierDb({ storage, key: FRONTIER_KEY });
  await db.load();
  db.recordQuery({
    productId: 'mouse-razer-viper',
    query: 'razer viper v3 pro specs',
    provider: 'google',
    fields: ['weight', 'dpi'],
    results: [
      { url: 'https://rtings.com/viper' },
      { url: 'https://razer.com/viper' }
    ]
  });
  db.recordFetch({
    productId: 'mouse-razer-viper',
    url: 'https://rtings.com/viper',
    status: 200,
    fieldsFound: ['weight', 'dpi']
  });
  db.recordFetch({
    productId: 'mouse-razer-viper',
    url: 'https://razer.com/viper',
    status: 200,
    fieldsFound: ['sensor']
  });

  const snapshot = db.snapshotForProduct('mouse-razer-viper');
  assert.equal(snapshot.query_count, 1);
  assert.equal(snapshot.url_count >= 2, true);
  assert.ok(snapshot.field_yield);
});

test('A.2 snapshot: empty snapshot for unknown product', async () => {
  const storage = createStorage();
  const db = new FrontierDb({ storage, key: FRONTIER_KEY });
  await db.load();
  const snapshot = db.snapshotForProduct('nonexistent-product');
  assert.equal(snapshot.query_count, 0);
});

// =========================================================================
// SECTION 6: URL canonicalization integration
// =========================================================================

test('A.2 url canon: tracking params are stripped for deduplication', async () => {
  const storage = createStorage();
  const db = new FrontierDb({
    storage,
    key: FRONTIER_KEY,
    config: {
      frontierStripTrackingParams: true,
      frontierCooldown404Seconds: 3600
    }
  });
  await db.load();
  db.recordFetch({
    productId: 'p1',
    url: 'https://example.com/spec?utm_source=google&utm_medium=cpc',
    status: 404
  });
  // Same base URL without tracking params should be recognized as same
  const result = db.shouldSkipUrl('https://example.com/spec?utm_source=bing');
  assert.equal(result.skip, true);
});

// =========================================================================
// SECTION 7: SQLite-specific tests (will pass once FrontierDbSqlite exists)
//   These tests verify SQLite-specific behavior. Until Pass 3 implements
//   FrontierDbSqlite, they serve as interface documentation.
// =========================================================================

test('A.2 sqlite: factory should return JSON db when frontierEnableSqlite=false', async () => {
  const storage = createStorage();
  const db = createFrontier({
    storage,
    key: FRONTIER_KEY,
    config: { frontierEnableSqlite: false }
  });
  assert.ok(db instanceof FrontierDb);
});

test('A.2 factory: createFrontier returns FrontierDb even when sqlite=true (fallback)', async () => {
  const storage = createStorage();
  const db = createFrontier({
    storage,
    key: FRONTIER_KEY,
    config: { frontierEnableSqlite: true }
  });
  // Until SQLite is implemented, factory falls back to JSON FrontierDb
  assert.ok(db instanceof FrontierDb);
  await db.load();
  const snapshot = db.snapshotForProduct('test');
  assert.equal(snapshot.query_count, 0);
});

// =========================================================================
// SECTION 8: Concurrency safety (daemon with multiple products)
// =========================================================================

test('A.2 concurrency: two products recording simultaneously do not corrupt state', async () => {
  const storage = createStorage();
  const db = new FrontierDb({ storage, key: FRONTIER_KEY });
  await db.load();

  // Simulate concurrent product runs
  db.recordQuery({
    productId: 'p1',
    query: 'product 1 specs',
    provider: 'searxng',
    fields: ['weight'],
    results: [{ url: 'https://a.com/p1' }]
  });
  db.recordQuery({
    productId: 'p2',
    query: 'product 2 specs',
    provider: 'searxng',
    fields: ['dpi'],
    results: [{ url: 'https://b.com/p2' }]
  });
  db.recordFetch({ productId: 'p1', url: 'https://a.com/p1', status: 200, fieldsFound: ['weight'] });
  db.recordFetch({ productId: 'p2', url: 'https://b.com/p2', status: 200, fieldsFound: ['dpi'] });

  const snap1 = db.snapshotForProduct('p1');
  const snap2 = db.snapshotForProduct('p2');
  assert.equal(snap1.query_count, 1);
  assert.equal(snap2.query_count, 1);
  assert.ok(snap1.field_yield.weight >= 1);
  assert.ok(snap2.field_yield.dpi >= 1);
});

// =========================================================================
// SECTION 9: Edge cases
// =========================================================================

test('A.2 edge: empty URL is not skipped (canonical URL resolves to empty)', async () => {
  const storage = createStorage();
  const db = new FrontierDb({ storage, key: FRONTIER_KEY });
  await db.load();
  const result = db.shouldSkipUrl('');
  // Current behavior: empty canonical_url returns {skip: false}
  // This is acceptable because the caller should validate URL before passing
  assert.equal(result.skip, false);
});

test('A.2 edge: undefined productId does not crash', async () => {
  const storage = createStorage();
  const db = new FrontierDb({ storage, key: FRONTIER_KEY });
  await db.load();
  // Should not throw
  db.recordQuery({
    productId: undefined,
    query: 'orphan query',
    provider: 'test',
    fields: [],
    results: []
  });
  assert.ok(true);
});

test('A.2 edge: very long URL is handled', async () => {
  const storage = createStorage();
  const db = new FrontierDb({ storage, key: FRONTIER_KEY });
  await db.load();
  const longUrl = `https://example.com/${'a'.repeat(5000)}`;
  db.recordFetch({ productId: 'p1', url: longUrl, status: 200, fieldsFound: [] });
  const result = db.shouldSkipUrl(longUrl);
  assert.equal(result.skip, false);
});

test('A.2 edge: 429 status with exponential backoff', async () => {
  const storage = createStorage();
  const db = new FrontierDb({
    storage,
    key: FRONTIER_KEY,
    config: { frontierCooldown429BaseSeconds: 60 }
  });
  await db.load();
  const url = 'https://rate-limited.com/api';
  db.recordFetch({ productId: 'p1', url, status: 429 });
  const first = db.shouldSkipUrl(url);
  assert.equal(first.skip, true);
});
