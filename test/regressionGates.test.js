import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRegressionGates, checkRegressionVsBaseline } from '../src/benchmark/regressionGates.js';
import { scoreProductRun, buildModeScorecard } from '../src/benchmark/benchmarkMatrix.js';

// ---------------------------------------------------------------------------
// IP03-3D — Regression Gates Tests
// ---------------------------------------------------------------------------

function makeScorecard(overrides = {}) {
  const defaults = {
    mode: 'balanced',
    product_count: 5,
    mean_accuracy: 0.85,
    mean_coverage: 0.80,
    mean_unknown_rate: 0.20,
    mean_confidence: 0.82,
    total_contradictions: 1,
    validated_count: 4,
    validation_rate: 0.80,
    total_mismatches: 2,
    runtime_ms: 50000,
    cost_usd: 0.10,
    urls_fetched: 100,
    llm_calls: 20,
    products: []
  };
  return { ...defaults, ...overrides };
}

// =========================================================================
// SECTION 1: Gate passes
// =========================================================================

test('regression gates: all gates pass for healthy scorecard', () => {
  const result = checkRegressionGates({ scorecard: makeScorecard() });
  assert.equal(result.passed, true);
  assert.equal(result.fail_count, 0);
  assert.equal(result.gate_count, 7);
  assert.equal(result.pass_count, 7);
});

// =========================================================================
// SECTION 2: Individual gate failures
// =========================================================================

test('regression gates: fails on low accuracy', () => {
  const result = checkRegressionGates({
    scorecard: makeScorecard({ mean_accuracy: 0.50 })
  });
  assert.equal(result.passed, false);
  const gate = result.gates.find((g) => g.gate === 'min_accuracy');
  assert.equal(gate.passed, false);
});

test('regression gates: fails on high unknown rate', () => {
  const result = checkRegressionGates({
    scorecard: makeScorecard({ mean_unknown_rate: 0.60 })
  });
  assert.equal(result.passed, false);
  const gate = result.gates.find((g) => g.gate === 'max_unknown_rate');
  assert.equal(gate.passed, false);
});

test('regression gates: fails on low coverage', () => {
  const result = checkRegressionGates({
    scorecard: makeScorecard({ mean_coverage: 0.40 })
  });
  assert.equal(result.passed, false);
  const gate = result.gates.find((g) => g.gate === 'min_coverage');
  assert.equal(gate.passed, false);
});

test('regression gates: fails on low validation rate', () => {
  const result = checkRegressionGates({
    scorecard: makeScorecard({ validation_rate: 0.30 })
  });
  assert.equal(result.passed, false);
  const gate = result.gates.find((g) => g.gate === 'min_validation_rate');
  assert.equal(gate.passed, false);
});

test('regression gates: fails on excessive runtime', () => {
  const result = checkRegressionGates({
    scorecard: makeScorecard({ runtime_ms: 5000000 }) // 5M ms = way over budget
  });
  assert.equal(result.passed, false);
  const gate = result.gates.find((g) => g.gate === 'max_runtime_per_product');
  assert.equal(gate.passed, false);
});

test('regression gates: fails on excessive cost', () => {
  const result = checkRegressionGates({
    scorecard: makeScorecard({ cost_usd: 10.0 })
  });
  assert.equal(result.passed, false);
  const gate = result.gates.find((g) => g.gate === 'max_cost_per_product');
  assert.equal(gate.passed, false);
});

test('regression gates: fails on high contradiction rate', () => {
  const result = checkRegressionGates({
    scorecard: makeScorecard({ total_contradictions: 5, product_count: 5 })
  });
  assert.equal(result.passed, false);
  const gate = result.gates.find((g) => g.gate === 'max_contradiction_rate');
  assert.equal(gate.passed, false);
});

// =========================================================================
// SECTION 3: Custom thresholds
// =========================================================================

test('regression gates: custom thresholds override defaults', () => {
  const result = checkRegressionGates({
    scorecard: makeScorecard({ mean_accuracy: 0.50 }),
    thresholds: { min_accuracy: 0.40 }
  });
  const gate = result.gates.find((g) => g.gate === 'min_accuracy');
  assert.equal(gate.passed, true);
});

// =========================================================================
// SECTION 4: Baseline regression checks
// =========================================================================

test('regression gates: no regression when current matches baseline', () => {
  const result = checkRegressionVsBaseline({
    current: makeScorecard(),
    baseline: makeScorecard()
  });
  assert.equal(result.regressed, false);
  assert.equal(result.checks.length, 3);
});

test('regression gates: detects accuracy regression', () => {
  const result = checkRegressionVsBaseline({
    current: makeScorecard({ mean_accuracy: 0.70 }),
    baseline: makeScorecard({ mean_accuracy: 0.85 })
  });
  assert.equal(result.regressed, true);
  const acc = result.checks.find((c) => c.metric === 'accuracy');
  assert.equal(acc.regressed, true);
});

test('regression gates: detects coverage regression', () => {
  const result = checkRegressionVsBaseline({
    current: makeScorecard({ mean_coverage: 0.60 }),
    baseline: makeScorecard({ mean_coverage: 0.80 })
  });
  assert.equal(result.regressed, true);
});

test('regression gates: detects unknown rate increase', () => {
  const result = checkRegressionVsBaseline({
    current: makeScorecard({ mean_unknown_rate: 0.40 }),
    baseline: makeScorecard({ mean_unknown_rate: 0.20 })
  });
  assert.equal(result.regressed, true);
});

test('regression gates: allows minor degradation within tolerance', () => {
  const result = checkRegressionVsBaseline({
    current: makeScorecard({ mean_accuracy: 0.82 }),
    baseline: makeScorecard({ mean_accuracy: 0.85 }),
    tolerances: { accuracy_drop: 0.05 }
  });
  assert.equal(result.regressed, false);
});

// =========================================================================
// SECTION 5: Edge cases
// =========================================================================

test('regression gates: empty scorecard returns error', () => {
  const result = checkRegressionGates({ scorecard: makeScorecard({ product_count: 0 }) });
  assert.equal(result.passed, false);
  assert.equal(result.error, 'no_scorecard_data');
});

test('regression gates: null scorecard returns error', () => {
  const result = checkRegressionGates({ scorecard: null });
  assert.equal(result.passed, false);
});

test('regression gates: baseline check with null returns no regression', () => {
  const result = checkRegressionVsBaseline({ current: null, baseline: null });
  assert.equal(result.regressed, false);
  assert.equal(result.error, 'missing_scorecard');
});

// =========================================================================
// SECTION 6: Integration with real scorecards
// =========================================================================

test('regression gates: works with actual scoreProductRun + buildModeScorecard', () => {
  const scores = [
    scoreProductRun({
      fields: { weight: '54', sensor: 'PAW3395', dpi: '35000', polling: '4000' },
      expectedFields: { weight: '54', sensor: 'PAW3395', dpi: '35000', polling: '4000' },
      summary: { validated: true, confidence: 0.95 }
    }),
    scoreProductRun({
      fields: { weight: '60', sensor: 'HERO 2', dpi: '44000', polling: '2000' },
      expectedFields: { weight: '60', sensor: 'HERO 2', dpi: '44000', polling: '2000' },
      summary: { validated: true, confidence: 0.90 }
    })
  ];
  const card = buildModeScorecard({
    mode: 'balanced',
    productScores: scores,
    runtimeMs: 30000,
    costUsd: 0.02
  });
  const result = checkRegressionGates({ scorecard: card });
  assert.equal(result.passed, true);
  assert.equal(result.gate_count, 7);
});
