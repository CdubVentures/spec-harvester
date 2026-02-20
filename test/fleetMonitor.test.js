import test from 'node:test';
import assert from 'node:assert/strict';
import { FleetMonitor } from '../src/runtime/fleetMonitor.js';

// ---------------------------------------------------------------------------
// Phase 14 — Fleet Monitor Tests
// ---------------------------------------------------------------------------

test('fleet: registers a product run', () => {
  const fm = new FleetMonitor();
  fm.registerProduct({ productId: 'mouse-001', category: 'mouse' });
  assert.equal(fm.stats().total_products, 1);
  assert.equal(fm.stats().active, 1);
});

test('fleet: tracks product completion', () => {
  const fm = new FleetMonitor();
  fm.registerProduct({ productId: 'p1', category: 'mouse' });
  fm.completeProduct({ productId: 'p1', fieldsExtracted: 8, costUsd: 0.05, runtimeMs: 5000 });
  const stats = fm.stats();
  assert.equal(stats.active, 0);
  assert.equal(stats.completed, 1);
  assert.equal(stats.total_cost_usd, 0.05);
});

test('fleet: tracks product failure', () => {
  const fm = new FleetMonitor();
  fm.registerProduct({ productId: 'p1', category: 'mouse' });
  fm.failProduct({ productId: 'p1', error: 'timeout' });
  assert.equal(fm.stats().failed, 1);
  assert.equal(fm.stats().active, 0);
});

test('fleet: computes throughput (products/hour)', () => {
  const fm = new FleetMonitor();
  fm.registerProduct({ productId: 'p1', category: 'mouse' });
  fm.completeProduct({ productId: 'p1', fieldsExtracted: 8, costUsd: 0.03, runtimeMs: 2000 });
  fm.registerProduct({ productId: 'p2', category: 'mouse' });
  fm.completeProduct({ productId: 'p2', fieldsExtracted: 6, costUsd: 0.04, runtimeMs: 3000 });
  // Force the start time to be 1 hour ago for predictable throughput calc
  fm._startedAt = Date.now() - 3_600_000;
  const stats = fm.stats();
  assert.ok(stats.throughput_per_hour >= 1.5);
});

test('fleet: tracks mean cost per product', () => {
  const fm = new FleetMonitor();
  fm.registerProduct({ productId: 'p1', category: 'mouse' });
  fm.completeProduct({ productId: 'p1', fieldsExtracted: 8, costUsd: 0.10, runtimeMs: 2000 });
  fm.registerProduct({ productId: 'p2', category: 'mouse' });
  fm.completeProduct({ productId: 'p2', fieldsExtracted: 6, costUsd: 0.06, runtimeMs: 3000 });
  const stats = fm.stats();
  assert.equal(stats.mean_cost_per_product, 0.08);
});

test('fleet: tracks mean fields per product', () => {
  const fm = new FleetMonitor();
  fm.registerProduct({ productId: 'p1', category: 'mouse' });
  fm.completeProduct({ productId: 'p1', fieldsExtracted: 10, costUsd: 0, runtimeMs: 0 });
  fm.registerProduct({ productId: 'p2', category: 'mouse' });
  fm.completeProduct({ productId: 'p2', fieldsExtracted: 6, costUsd: 0, runtimeMs: 0 });
  assert.equal(fm.stats().mean_fields_per_product, 8);
});

test('fleet: tracks mean runtime per product', () => {
  const fm = new FleetMonitor();
  fm.registerProduct({ productId: 'p1', category: 'mouse' });
  fm.completeProduct({ productId: 'p1', fieldsExtracted: 8, costUsd: 0, runtimeMs: 4000 });
  fm.registerProduct({ productId: 'p2', category: 'mouse' });
  fm.completeProduct({ productId: 'p2', fieldsExtracted: 8, costUsd: 0, runtimeMs: 6000 });
  assert.equal(fm.stats().mean_runtime_ms, 5000);
});

test('fleet: records URL and LLM call counts', () => {
  const fm = new FleetMonitor();
  fm.recordUrlFetched();
  fm.recordUrlFetched();
  fm.recordLlmCall({ highTier: false });
  fm.recordLlmCall({ highTier: true });
  fm.recordLlmCall({ highTier: false });
  const stats = fm.stats();
  assert.equal(stats.total_urls_fetched, 2);
  assert.equal(stats.total_llm_calls, 3);
  assert.equal(stats.total_high_tier_calls, 1);
});

test('fleet: computes high tier utilization percentage', () => {
  const fm = new FleetMonitor();
  fm.recordLlmCall({ highTier: false });
  fm.recordLlmCall({ highTier: false });
  fm.recordLlmCall({ highTier: true });
  assert.ok(Math.abs(fm.stats().high_tier_utilization_pct - 33.33) < 1);
});

test('fleet: getProduct returns individual product status', () => {
  const fm = new FleetMonitor();
  fm.registerProduct({ productId: 'p1', category: 'mouse' });
  const p = fm.getProduct('p1');
  assert.equal(p.productId, 'p1');
  assert.equal(p.status, 'active');
});

test('fleet: listProducts returns all products', () => {
  const fm = new FleetMonitor();
  fm.registerProduct({ productId: 'p1', category: 'mouse' });
  fm.registerProduct({ productId: 'p2', category: 'keyboard' });
  const list = fm.listProducts();
  assert.equal(list.length, 2);
});

test('fleet: handles empty state', () => {
  const fm = new FleetMonitor();
  const stats = fm.stats();
  assert.equal(stats.total_products, 0);
  assert.equal(stats.throughput_per_hour, 0);
  assert.equal(stats.mean_cost_per_product, 0);
});

test('fleet: snapshot returns full fleet view', () => {
  const fm = new FleetMonitor();
  fm.registerProduct({ productId: 'p1', category: 'mouse' });
  fm.completeProduct({ productId: 'p1', fieldsExtracted: 8, costUsd: 0.05, runtimeMs: 3000 });
  const snap = fm.snapshot();
  assert.ok(snap.stats);
  assert.ok(snap.products);
  assert.ok(snap.generated_at);
});
