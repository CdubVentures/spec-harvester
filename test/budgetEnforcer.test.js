import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BudgetEnforcer,
  DEFAULT_BUDGETS
} from '../src/concurrency/budgetEnforcer.js';

// ---------------------------------------------------------------------------
// IP05-5E — Budget Enforcement Tests
// ---------------------------------------------------------------------------

test('budget: default budgets are defined', () => {
  assert.ok(DEFAULT_BUDGETS.max_urls_per_product > 0);
  assert.ok(DEFAULT_BUDGETS.max_queries_per_product > 0);
  assert.ok(DEFAULT_BUDGETS.max_time_per_product_ms > 0);
  assert.ok(DEFAULT_BUDGETS.max_llm_calls_per_product > 0);
  assert.ok(DEFAULT_BUDGETS.max_high_tier_calls_per_product > 0);
  assert.ok(DEFAULT_BUDGETS.max_cost_per_product_usd > 0);
});

test('budget: tracks URL count and enforces limit', () => {
  const b = new BudgetEnforcer({ max_urls_per_product: 3 });
  assert.equal(b.canFetchUrl(), true);
  b.recordUrl();
  b.recordUrl();
  b.recordUrl();
  assert.equal(b.canFetchUrl(), false);
});

test('budget: tracks query count and enforces limit', () => {
  const b = new BudgetEnforcer({ max_queries_per_product: 2 });
  assert.equal(b.canQuery(), true);
  b.recordQuery();
  b.recordQuery();
  assert.equal(b.canQuery(), false);
});

test('budget: tracks LLM calls and enforces limit', () => {
  const b = new BudgetEnforcer({ max_llm_calls_per_product: 5 });
  for (let i = 0; i < 5; i++) b.recordLlmCall({ highTier: false });
  assert.equal(b.canCallLlm(), false);
});

test('budget: tracks high-tier calls separately', () => {
  const b = new BudgetEnforcer({
    max_llm_calls_per_product: 100,
    max_high_tier_calls_per_product: 2
  });
  b.recordLlmCall({ highTier: true });
  b.recordLlmCall({ highTier: true });
  assert.equal(b.canCallHighTier(), false);
  assert.equal(b.canCallLlm(), true); // total LLM budget still fine
});

test('budget: tracks cost and enforces limit', () => {
  const b = new BudgetEnforcer({ max_cost_per_product_usd: 0.10 });
  b.recordCost(0.05);
  b.recordCost(0.04);
  assert.equal(b.isOverBudget(), false);
  b.recordCost(0.02);
  assert.equal(b.isOverBudget(), true);
});

test('budget: tracks time and enforces limit', () => {
  const b = new BudgetEnforcer({ max_time_per_product_ms: 100 });
  assert.equal(b.isTimeExceeded(), false);
  // Simulate time passing by setting startedAt in the past
  b._startedAt = Date.now() - 200;
  assert.equal(b.isTimeExceeded(), true);
});

test('budget: snapshot returns all counters', () => {
  const b = new BudgetEnforcer({ max_urls_per_product: 10 });
  b.recordUrl();
  b.recordUrl();
  b.recordQuery();
  b.recordLlmCall({ highTier: false });
  b.recordLlmCall({ highTier: true });
  b.recordCost(0.03);

  const snap = b.snapshot();
  assert.equal(snap.urls, 2);
  assert.equal(snap.queries, 1);
  assert.equal(snap.llm_calls, 2);
  assert.equal(snap.high_tier_calls, 1);
  assert.equal(snap.cost_usd, 0.03);
  assert.ok(snap.elapsed_ms >= 0);
  assert.ok(snap.budgets);
});

test('budget: reset clears all counters', () => {
  const b = new BudgetEnforcer();
  b.recordUrl();
  b.recordQuery();
  b.recordLlmCall({ highTier: true });
  b.recordCost(1.0);
  b.reset();

  const snap = b.snapshot();
  assert.equal(snap.urls, 0);
  assert.equal(snap.queries, 0);
  assert.equal(snap.llm_calls, 0);
  assert.equal(snap.high_tier_calls, 0);
  assert.equal(snap.cost_usd, 0);
});

test('budget: violations returns list of exceeded limits', () => {
  const b = new BudgetEnforcer({
    max_urls_per_product: 2,
    max_queries_per_product: 1,
    max_llm_calls_per_product: 100,
    max_high_tier_calls_per_product: 100,
    max_cost_per_product_usd: 10,
    max_time_per_product_ms: 999_999
  });
  b.recordUrl();
  b.recordUrl();
  b.recordUrl();
  b.recordQuery();
  b.recordQuery();

  const violations = b.violations();
  assert.ok(violations.some((v) => v.budget === 'max_urls_per_product'));
  assert.ok(violations.some((v) => v.budget === 'max_queries_per_product'));
  assert.ok(!violations.some((v) => v.budget === 'max_llm_calls_per_product'));
});

test('budget: custom budgets override defaults', () => {
  const b = new BudgetEnforcer({
    max_urls_per_product: 999,
    max_queries_per_product: 999
  });
  const snap = b.snapshot();
  assert.equal(snap.budgets.max_urls_per_product, 999);
  assert.equal(snap.budgets.max_queries_per_product, 999);
});

test('budget: highTierUtilization computes percentage', () => {
  const b = new BudgetEnforcer();
  b.recordLlmCall({ highTier: false });
  b.recordLlmCall({ highTier: false });
  b.recordLlmCall({ highTier: true });
  const pct = b.highTierUtilization();
  assert.ok(Math.abs(pct - 33.33) < 1);
});

test('budget: highTierUtilization returns 0 for no calls', () => {
  const b = new BudgetEnforcer();
  assert.equal(b.highTierUtilization(), 0);
});
