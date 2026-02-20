import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreProductRun,
  buildModeScorecard,
  compareModeScorecards,
  buildBenchmarkMatrix
} from '../src/benchmark/benchmarkMatrix.js';

// ---------------------------------------------------------------------------
// IP03-3C — Benchmark Matrix Tests
// ---------------------------------------------------------------------------

// =========================================================================
// SECTION 1: scoreProductRun
// =========================================================================

test('benchmark matrix: scoreProductRun with perfect match', () => {
  const score = scoreProductRun({
    fields: { weight: '54', sensor: 'PAW3395', dpi: '35000' },
    expectedFields: { weight: '54', sensor: 'PAW3395', dpi: '35000' }
  });
  assert.equal(score.total_fields, 3);
  assert.equal(score.correct, 3);
  assert.equal(score.incorrect, 0);
  assert.equal(score.unknown, 0);
  assert.equal(score.accuracy, 1.0);
  assert.equal(score.coverage, 1.0);
});

test('benchmark matrix: scoreProductRun with unknowns', () => {
  const score = scoreProductRun({
    fields: { weight: '54', sensor: 'unk', dpi: 'unk' },
    expectedFields: { weight: '54', sensor: 'PAW3395', dpi: '35000' }
  });
  assert.equal(score.correct, 1);
  assert.equal(score.unknown, 2);
  assert.ok(Math.abs(score.unknown_rate - 2 / 3) < 0.01);
  assert.ok(Math.abs(score.coverage - 1 / 3) < 0.01);
});

test('benchmark matrix: scoreProductRun with mismatches', () => {
  const score = scoreProductRun({
    fields: { weight: '60', sensor: 'HERO 2' },
    expectedFields: { weight: '54', sensor: 'HERO 2' }
  });
  assert.equal(score.correct, 1);
  assert.equal(score.incorrect, 1);
  assert.equal(score.mismatches.length, 1);
  assert.equal(score.mismatches[0].field, 'weight');
});

test('benchmark matrix: scoreProductRun case-insensitive comparison', () => {
  const score = scoreProductRun({
    fields: { sensor: 'paw3395' },
    expectedFields: { sensor: 'PAW3395' }
  });
  assert.equal(score.correct, 1);
});

test('benchmark matrix: scoreProductRun with summary metadata', () => {
  const score = scoreProductRun({
    fields: { weight: '54' },
    expectedFields: { weight: '54' },
    summary: { validated: true, confidence: 0.92, constraint_analysis: { contradiction_count: 2 } }
  });
  assert.equal(score.validated, true);
  assert.equal(score.confidence, 0.92);
  assert.equal(score.contradiction_count, 2);
});

// =========================================================================
// SECTION 2: buildModeScorecard
// =========================================================================

test('benchmark matrix: buildModeScorecard aggregates products', () => {
  const scores = [
    scoreProductRun({ fields: { w: '54', s: 'X' }, expectedFields: { w: '54', s: 'X' } }),
    scoreProductRun({ fields: { w: '60', s: 'unk' }, expectedFields: { w: '60', s: 'Y' } })
  ];
  const card = buildModeScorecard({ mode: 'aggressive', productScores: scores, runtimeMs: 5000, costUsd: 0.05 });
  assert.equal(card.mode, 'aggressive');
  assert.equal(card.product_count, 2);
  assert.ok(card.mean_accuracy > 0);
  assert.ok(card.mean_coverage > 0);
  assert.equal(card.runtime_ms, 5000);
  assert.equal(card.cost_usd, 0.05);
});

test('benchmark matrix: buildModeScorecard handles empty products', () => {
  const card = buildModeScorecard({ mode: 'balanced', productScores: [] });
  assert.equal(card.product_count, 0);
  assert.equal(card.mean_accuracy, 0);
});

test('benchmark matrix: buildModeScorecard normalizes mode name', () => {
  const card = buildModeScorecard({ mode: 'uber-aggressive', productScores: [] });
  assert.equal(card.mode, 'uber_aggressive');
});

// =========================================================================
// SECTION 3: compareModeScorecards
// =========================================================================

test('benchmark matrix: compareModeScorecards picks winner by accuracy', () => {
  const balanced = buildModeScorecard({
    mode: 'balanced',
    productScores: [scoreProductRun({ fields: { w: '54' }, expectedFields: { w: '54' } })]
  });
  const aggressive = buildModeScorecard({
    mode: 'aggressive',
    productScores: [scoreProductRun({ fields: { w: 'unk' }, expectedFields: { w: '54' } })]
  });
  const result = compareModeScorecards([balanced, aggressive]);
  assert.equal(result.winner, 'balanced');
  assert.equal(result.comparison.length, 2);
});

test('benchmark matrix: compareModeScorecards handles single mode', () => {
  const card = buildModeScorecard({ mode: 'balanced', productScores: [] });
  const result = compareModeScorecards([card]);
  assert.equal(result.winner, 'balanced');
});

test('benchmark matrix: compareModeScorecards delta calculations', () => {
  const card1 = buildModeScorecard({
    mode: 'balanced',
    productScores: [scoreProductRun({ fields: { w: '54', s: 'X' }, expectedFields: { w: '54', s: 'X' } })],
    runtimeMs: 1000,
    costUsd: 0.01
  });
  const card2 = buildModeScorecard({
    mode: 'uber_aggressive',
    productScores: [scoreProductRun({ fields: { w: '54', s: 'X' }, expectedFields: { w: '54', s: 'X' } })],
    runtimeMs: 3000,
    costUsd: 0.05
  });
  const result = compareModeScorecards([card1, card2]);
  // Both have same accuracy, so baseline is whichever sorts first
  assert.ok(result.comparison.length === 2);
  // Runtime ratio should be >1 for the more expensive mode
  const uber = result.comparison.find((c) => c.mode === 'uber_aggressive');
  assert.ok(uber);
});

// =========================================================================
// SECTION 4: buildBenchmarkMatrix
// =========================================================================

test('benchmark matrix: full matrix report', () => {
  const scores1 = [scoreProductRun({ fields: { w: '54' }, expectedFields: { w: '54' } })];
  const scores2 = [scoreProductRun({ fields: { w: 'unk' }, expectedFields: { w: '54' } })];
  const card1 = buildModeScorecard({ mode: 'balanced', productScores: scores1, runtimeMs: 1000 });
  const card2 = buildModeScorecard({ mode: 'aggressive', productScores: scores2, runtimeMs: 2000 });
  const matrix = buildBenchmarkMatrix({
    scorecards: [card1, card2],
    category: 'mouse',
    date: '2026-02-13'
  });
  assert.equal(matrix.category, 'mouse');
  assert.equal(matrix.date, '2026-02-13');
  assert.equal(matrix.modes.length, 2);
  assert.equal(matrix.scorecards.length, 2);
  assert.ok(matrix.winner);
  assert.ok(matrix.comparison.length > 0);
});

test('benchmark matrix: auto-generates date if not provided', () => {
  const matrix = buildBenchmarkMatrix({ scorecards: [], category: 'mouse' });
  assert.ok(matrix.date.match(/^\d{4}-\d{2}-\d{2}$/));
});

// =========================================================================
// SECTION 5: Edge cases
// =========================================================================

test('benchmark matrix: scoreProductRun with empty fields', () => {
  const score = scoreProductRun({ fields: {}, expectedFields: {} });
  assert.equal(score.total_fields, 0);
  assert.equal(score.accuracy, 0);
});

test('benchmark matrix: scoreProductRun with N/A values', () => {
  const score = scoreProductRun({
    fields: { weight: 'N/A' },
    expectedFields: { weight: '54' }
  });
  assert.equal(score.unknown, 1);
});
