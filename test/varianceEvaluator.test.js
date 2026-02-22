// ── Variance Evaluator Tests ─────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateVariance, evaluateVarianceBatch } from '../src/review/varianceEvaluator.js';

// ── null / missing policy → always compliant ─────────────────────────

test('null policy → compliant', () => {
  const r = evaluateVariance(null, '100', '200');
  assert.equal(r.compliant, true);
});

test('undefined policy → compliant', () => {
  const r = evaluateVariance(undefined, '100', '200');
  assert.equal(r.compliant, true);
});

test('empty string policy → compliant', () => {
  const r = evaluateVariance('', '50', '999');
  assert.equal(r.compliant, true);
});

// ── override_allowed → always compliant ──────────────────────────────

test('override_allowed → compliant regardless of values', () => {
  const r = evaluateVariance('override_allowed', '100', '999');
  assert.equal(r.compliant, true);
});

// ── authoritative ────────────────────────────────────────────────────

test('authoritative exact string match (case-insensitive)', () => {
  const r = evaluateVariance('authoritative', 'PixArt', 'pixart');
  assert.equal(r.compliant, true);
});

test('authoritative numeric match with comma formatting ("26,000" vs 26000)', () => {
  const r = evaluateVariance('authoritative', '26,000', '26000');
  assert.equal(r.compliant, true);
});

test('authoritative numeric match with identical values', () => {
  const r = evaluateVariance('authoritative', '35000', '35000');
  assert.equal(r.compliant, true);
});

test('authoritative mismatch → violation with details', () => {
  const r = evaluateVariance('authoritative', 'PAW3950', 'PMW3360');
  assert.equal(r.compliant, false);
  assert.equal(r.reason, 'authoritative_mismatch');
  assert.equal(r.details.expected, 'PAW3950');
  assert.equal(r.details.actual, 'PMW3360');
});

test('authoritative numeric mismatch → violation', () => {
  const r = evaluateVariance('authoritative', '26000', '35000');
  assert.equal(r.compliant, false);
  assert.equal(r.reason, 'authoritative_mismatch');
  assert.equal(r.details.expected_numeric, 26000);
  assert.equal(r.details.actual_numeric, 35000);
});

// ── upper_bound ──────────────────────────────────────────────────────

test('upper_bound: at bound → compliant', () => {
  const r = evaluateVariance('upper_bound', '100', '100');
  assert.equal(r.compliant, true);
});

test('upper_bound: below bound → compliant', () => {
  const r = evaluateVariance('upper_bound', '100', '50');
  assert.equal(r.compliant, true);
});

test('upper_bound: above bound → violation', () => {
  const r = evaluateVariance('upper_bound', '100', '101');
  assert.equal(r.compliant, false);
  assert.equal(r.reason, 'exceeds_upper_bound');
  assert.equal(r.details.bound, 100);
  assert.equal(r.details.actual, 101);
});

test('upper_bound: comma-formatted → parsed correctly', () => {
  const r = evaluateVariance('upper_bound', '26,000', '25000');
  assert.equal(r.compliant, true);
});

// ── lower_bound ──────────────────────────────────────────────────────

test('lower_bound: at bound → compliant', () => {
  const r = evaluateVariance('lower_bound', '50', '50');
  assert.equal(r.compliant, true);
});

test('lower_bound: above bound → compliant', () => {
  const r = evaluateVariance('lower_bound', '50', '100');
  assert.equal(r.compliant, true);
});

test('lower_bound: below bound → violation', () => {
  const r = evaluateVariance('lower_bound', '50', '49');
  assert.equal(r.compliant, false);
  assert.equal(r.reason, 'below_lower_bound');
  assert.equal(r.details.bound, 50);
  assert.equal(r.details.actual, 49);
});

// ── range ────────────────────────────────────────────────────────────

test('range: within 10% (default) → compliant', () => {
  const r = evaluateVariance('range', '100', '105');
  assert.equal(r.compliant, true);
});

test('range: exactly at boundary → compliant', () => {
  const r = evaluateVariance('range', '100', '110');
  assert.equal(r.compliant, true);
});

test('range: outside 10% → violation', () => {
  const r = evaluateVariance('range', '100', '111');
  assert.equal(r.compliant, false);
  assert.equal(r.reason, 'outside_range');
  assert.equal(r.details.expected, 100);
  assert.equal(r.details.actual, 111);
  assert.equal(r.details.tolerance, 0.10);
});

test('range: below range → violation', () => {
  const r = evaluateVariance('range', '100', '89');
  assert.equal(r.compliant, false);
  assert.equal(r.reason, 'outside_range');
});

test('range: custom tolerance', () => {
  // 20% tolerance: 100 ± 20 → [80, 120]
  const r1 = evaluateVariance('range', '100', '119', { tolerance: 0.20 });
  assert.equal(r1.compliant, true);
  const r2 = evaluateVariance('range', '100', '121', { tolerance: 0.20 });
  assert.equal(r2.compliant, false);
});

// ── Edge cases: non-numeric with numeric policies ────────────────────

test('upper_bound with non-numeric values → skip (compliant)', () => {
  const r = evaluateVariance('upper_bound', 'fast', 'faster');
  assert.equal(r.compliant, true);
  assert.equal(r.reason, 'skipped_non_numeric');
});

test('lower_bound with non-numeric values → skip (compliant)', () => {
  const r = evaluateVariance('lower_bound', 'low', 'lower');
  assert.equal(r.compliant, true);
  assert.equal(r.reason, 'skipped_non_numeric');
});

test('range with non-numeric values → skip (compliant)', () => {
  const r = evaluateVariance('range', 'abc', 'def');
  assert.equal(r.compliant, true);
  assert.equal(r.reason, 'skipped_non_numeric');
});

// ── Edge cases: missing/unk values ───────────────────────────────────

test('null dbValue → skip (compliant)', () => {
  const r = evaluateVariance('authoritative', null, '100');
  assert.equal(r.compliant, true);
  assert.equal(r.reason, 'skipped_missing_value');
});

test('null productValue → skip (compliant)', () => {
  const r = evaluateVariance('authoritative', '100', null);
  assert.equal(r.compliant, true);
  assert.equal(r.reason, 'skipped_missing_value');
});

test('"unk" dbValue → skip (compliant)', () => {
  const r = evaluateVariance('authoritative', 'unk', '100');
  assert.equal(r.compliant, true);
  assert.equal(r.reason, 'skipped_missing_value');
});

test('"n/a" productValue → skip (compliant)', () => {
  const r = evaluateVariance('upper_bound', '100', 'n/a');
  assert.equal(r.compliant, true);
  assert.equal(r.reason, 'skipped_missing_value');
});

test('empty string productValue → skip (compliant)', () => {
  const r = evaluateVariance('authoritative', 'foo', '');
  assert.equal(r.compliant, true);
  assert.equal(r.reason, 'skipped_missing_value');
});

test('"unknown" value → skip (compliant)', () => {
  const r = evaluateVariance('range', '100', 'unknown');
  assert.equal(r.compliant, true);
  assert.equal(r.reason, 'skipped_missing_value');
});

// ── Unknown policy → skip ────────────────────────────────────────────

test('unknown policy string → compliant', () => {
  const r = evaluateVariance('some_future_policy', '100', '200');
  assert.equal(r.compliant, true);
  assert.equal(r.reason, 'unknown_policy');
});

// ── evaluateVarianceBatch ────────────────────────────────────────────

test('batch with mixed results', () => {
  const entries = [
    { product_id: 'mouse-a', value: '35000' },  // matches
    { product_id: 'mouse-b', value: '26000' },   // mismatch
    { product_id: 'mouse-c', value: '35,000' },  // matches (comma)
    { product_id: 'mouse-d', value: null },       // skipped
  ];
  const result = evaluateVarianceBatch('authoritative', '35000', entries);
  assert.equal(result.summary.total, 4);
  assert.equal(result.summary.compliant, 3); // mouse-a, mouse-c match; mouse-d skipped
  assert.equal(result.summary.violations, 1); // mouse-b
  assert.equal(result.results.length, 4);
  // Check specific results
  assert.equal(result.results[0].compliant, true);
  assert.equal(result.results[1].compliant, false);
  assert.equal(result.results[1].product_id, 'mouse-b');
  assert.equal(result.results[2].compliant, true);
  assert.equal(result.results[3].compliant, true); // null → skipped
});

test('batch with upper_bound policy', () => {
  const entries = [
    { product_id: 'p1', value: '90' },
    { product_id: 'p2', value: '100' },
    { product_id: 'p3', value: '110' },
  ];
  const result = evaluateVarianceBatch('upper_bound', '100', entries);
  assert.equal(result.summary.compliant, 2);
  assert.equal(result.summary.violations, 1);
});

test('batch with override_allowed → all compliant regardless of values', () => {
  const entries = [
    { product_id: 'p1', value: '50' },
    { product_id: 'p2', value: '999' },
    { product_id: 'p3', value: '0' },
  ];
  const result = evaluateVarianceBatch('override_allowed', '100', entries);
  assert.equal(result.summary.total, 3);
  assert.equal(result.summary.compliant, 3);
  assert.equal(result.summary.violations, 0);
  for (const r of result.results) {
    assert.equal(r.compliant, true);
  }
});

test('batch with null policy → all compliant', () => {
  const entries = [
    { product_id: 'p1', value: '50' },
    { product_id: 'p2', value: '999' },
  ];
  const result = evaluateVarianceBatch(null, '100', entries);
  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.compliant, 2);
  assert.equal(result.summary.violations, 0);
});

test('batch with empty entries → zero counts', () => {
  const result = evaluateVarianceBatch('authoritative', '100', []);
  assert.equal(result.summary.total, 0);
  assert.equal(result.summary.compliant, 0);
  assert.equal(result.summary.violations, 0);
  assert.deepEqual(result.results, []);
});

// ── Numeric edge cases ───────────────────────────────────────────────

test('authoritative: trailing unit stripped ("26000dpi" vs "26000")', () => {
  const r = evaluateVariance('authoritative', '26000dpi', '26000');
  assert.equal(r.compliant, true);
});

test('range with zero dbValue', () => {
  // 0 ± 10% = [0, 0], so only 0 is compliant
  const r1 = evaluateVariance('range', '0', '0');
  assert.equal(r1.compliant, true);
  const r2 = evaluateVariance('range', '0', '1');
  assert.equal(r2.compliant, false);
});
