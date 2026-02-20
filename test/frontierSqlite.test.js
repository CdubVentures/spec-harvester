import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FrontierDbSqlite } from '../src/research/frontierSqlite.js';

// ---------------------------------------------------------------------------
// Gap #2 — SQLite Frontier Backend Tests
// ---------------------------------------------------------------------------

function tmpDbPath() {
  return path.join(os.tmpdir(), `frontier-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanup(dbPath) {
  try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
}

test('sqlite frontier: creates database and tables', () => {
  const dbPath = tmpDbPath();
  try {
    const frontier = new FrontierDbSqlite({ dbPath });
    assert.ok(fs.existsSync(dbPath));
    frontier.close();
  } finally {
    cleanup(dbPath);
  }
});

test('sqlite frontier: recordQuery stores and retrieves query', () => {
  const dbPath = tmpDbPath();
  try {
    const frontier = new FrontierDbSqlite({ dbPath });
    const result = frontier.recordQuery({
      productId: 'mouse-001',
      query: 'Razer Viper V3 Pro specs',
      provider: 'google',
      fields: ['weight', 'sensor'],
      results: [{ rank: 1, url: 'https://example.com/viper', title: 'Viper Specs', host: 'example.com', snippet: 'The Viper V3 Pro...' }]
    });
    assert.ok(result);
    assert.ok(result.query_hash);
    frontier.close();
  } finally {
    cleanup(dbPath);
  }
});

test('sqlite frontier: shouldSkipQuery respects cooldown', () => {
  const dbPath = tmpDbPath();
  try {
    const frontier = new FrontierDbSqlite({ dbPath, config: { frontierQueryCooldownSeconds: 3600 } });
    frontier.recordQuery({ productId: 'p1', query: 'test query', provider: 'google' });
    assert.equal(frontier.shouldSkipQuery({ productId: 'p1', query: 'test query' }), true);
    assert.equal(frontier.shouldSkipQuery({ productId: 'p1', query: 'different query' }), false);
    frontier.close();
  } finally {
    cleanup(dbPath);
  }
});

test('sqlite frontier: shouldSkipQuery force overrides cooldown', () => {
  const dbPath = tmpDbPath();
  try {
    const frontier = new FrontierDbSqlite({ dbPath });
    frontier.recordQuery({ productId: 'p1', query: 'test', provider: 'google' });
    assert.equal(frontier.shouldSkipQuery({ productId: 'p1', query: 'test', force: true }), false);
    frontier.close();
  } finally {
    cleanup(dbPath);
  }
});

test('sqlite frontier: recordFetch stores URL data', () => {
  const dbPath = tmpDbPath();
  try {
    const frontier = new FrontierDbSqlite({ dbPath });
    const result = frontier.recordFetch({
      productId: 'p1',
      url: 'https://example.com/mouse',
      status: 200,
      contentType: 'text/html',
      bytes: 5000,
      elapsedMs: 300
    });
    assert.ok(result);
    assert.equal(result.last_status, 200);
    assert.equal(result.fetch_count, 1);
    frontier.close();
  } finally {
    cleanup(dbPath);
  }
});

test('sqlite frontier: recordFetch increments fetch count', () => {
  const dbPath = tmpDbPath();
  try {
    const frontier = new FrontierDbSqlite({ dbPath });
    frontier.recordFetch({ productId: 'p1', url: 'https://example.com', status: 200 });
    const result = frontier.recordFetch({ productId: 'p1', url: 'https://example.com', status: 200 });
    assert.equal(result.fetch_count, 2);
    frontier.close();
  } finally {
    cleanup(dbPath);
  }
});

test('sqlite frontier: 404 triggers cooldown', () => {
  const dbPath = tmpDbPath();
  try {
    const frontier = new FrontierDbSqlite({ dbPath });
    frontier.recordFetch({ productId: 'p1', url: 'https://example.com/missing', status: 404 });
    const skip = frontier.shouldSkipUrl('https://example.com/missing');
    assert.equal(skip.skip, true);
    assert.equal(skip.reason, 'cooldown');
    frontier.close();
  } finally {
    cleanup(dbPath);
  }
});

test('sqlite frontier: 403 triggers cooldown', () => {
  const dbPath = tmpDbPath();
  try {
    const frontier = new FrontierDbSqlite({ dbPath, config: { frontierCooldown403BaseSeconds: 60 } });
    frontier.recordFetch({ productId: 'p1', url: 'https://example.com/forbidden', status: 403 });
    const skip = frontier.shouldSkipUrl('https://example.com/forbidden');
    assert.equal(skip.skip, true);
    const row = frontier.getUrlRow('https://example.com/forbidden');
    assert.equal(row?.cooldown?.reason, '403_forbidden_backoff');
    frontier.close();
  } finally {
    cleanup(dbPath);
  }
});

test('sqlite frontier: path dead pattern skips sibling URLs', () => {
  const dbPath = tmpDbPath();
  try {
    const frontier = new FrontierDbSqlite({ dbPath, config: { frontierPathPenaltyNotfoundThreshold: 2 } });
    frontier.recordFetch({ productId: 'p1', url: 'https://example.com/support/123', status: 404 });
    frontier.recordFetch({ productId: 'p1', url: 'https://example.com/support/456', status: 404 });
    const skip = frontier.shouldSkipUrl('https://example.com/support/789');
    assert.equal(skip.skip, true);
    assert.equal(skip.reason, 'path_dead_pattern');
    frontier.close();
  } finally {
    cleanup(dbPath);
  }
});

test('sqlite frontier: shouldSkipUrl returns false for unknown URLs', () => {
  const dbPath = tmpDbPath();
  try {
    const frontier = new FrontierDbSqlite({ dbPath });
    const skip = frontier.shouldSkipUrl('https://unknown.com');
    assert.equal(skip.skip, false);
    frontier.close();
  } finally {
    cleanup(dbPath);
  }
});

test('sqlite frontier: getUrlRow returns stored data', () => {
  const dbPath = tmpDbPath();
  try {
    const frontier = new FrontierDbSqlite({ dbPath });
    frontier.recordFetch({ productId: 'p1', url: 'https://example.com', status: 200, bytes: 1234 });
    const row = frontier.getUrlRow('https://example.com');
    assert.ok(row);
    assert.equal(row.last_status, 200);
    assert.equal(row.bytes, 1234);
    frontier.close();
  } finally {
    cleanup(dbPath);
  }
});

test('sqlite frontier: getUrlRow returns null for unknown URL', () => {
  const dbPath = tmpDbPath();
  try {
    const frontier = new FrontierDbSqlite({ dbPath });
    assert.equal(frontier.getUrlRow('https://unknown.com'), null);
    frontier.close();
  } finally {
    cleanup(dbPath);
  }
});

test('sqlite frontier: snapshotForProduct returns product data', () => {
  const dbPath = tmpDbPath();
  try {
    const frontier = new FrontierDbSqlite({ dbPath });
    frontier.recordQuery({ productId: 'p1', query: 'test', provider: 'google' });
    frontier.recordFetch({ productId: 'p1', url: 'https://a.com', status: 200, fieldsFound: ['weight'] });
    const snap = frontier.snapshotForProduct('p1');
    assert.equal(snap.product_id, 'p1');
    assert.equal(snap.query_count, 1);
    assert.equal(snap.url_count, 1);
    frontier.close();
  } finally {
    cleanup(dbPath);
  }
});

test('sqlite frontier: frontierSnapshot returns recent URLs', () => {
  const dbPath = tmpDbPath();
  try {
    const frontier = new FrontierDbSqlite({ dbPath });
    frontier.recordFetch({ productId: 'p1', url: 'https://a.com', status: 200 });
    frontier.recordFetch({ productId: 'p1', url: 'https://b.com', status: 200 });
    const snap = frontier.frontierSnapshot({ limit: 10 });
    assert.equal(snap.urls.length, 2);
    frontier.close();
  } finally {
    cleanup(dbPath);
  }
});

test('sqlite frontier: recordYield tracks field extractions', () => {
  const dbPath = tmpDbPath();
  try {
    const frontier = new FrontierDbSqlite({ dbPath });
    frontier.recordFetch({ productId: 'p1', url: 'https://a.com', status: 200 });
    const result = frontier.recordYield({
      url: 'https://a.com',
      fieldKey: 'weight',
      valueHash: 'abc',
      confidence: 0.95
    });
    assert.ok(result);
    assert.equal(result.field_key, 'weight');
    frontier.close();
  } finally {
    cleanup(dbPath);
  }
});
