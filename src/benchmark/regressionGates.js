/**
 * Regression Gates (IP03-3D).
 *
 * Enforces quality thresholds on benchmark scorecards to prevent
 * regressions. Each gate returns pass/fail with diagnostics.
 *
 * Default thresholds are conservative — projects can override via config.
 */

const DEFAULT_THRESHOLDS = {
  min_accuracy: 0.70,
  max_unknown_rate: 0.35,
  min_coverage: 0.60,
  max_contradiction_rate: 0.20,
  min_validation_rate: 0.50,
  max_runtime_ms: 600_000, // 10 minutes per product
  max_cost_usd_per_product: 0.50
};

function mergeThresholds(overrides = {}) {
  return {
    ...DEFAULT_THRESHOLDS,
    ...(overrides && typeof overrides === 'object' ? overrides : {})
  };
}

/**
 * Run all regression gate checks against a mode scorecard.
 *
 * @param {object} scorecard - Output from buildModeScorecard
 * @param {object} thresholds - Override threshold values
 * @returns {{ passed, gate_count, pass_count, fail_count, gates }}
 */
export function checkRegressionGates({ scorecard, thresholds = {} }) {
  if (!scorecard || scorecard.product_count === 0) {
    return {
      passed: false,
      gate_count: 0,
      pass_count: 0,
      fail_count: 0,
      gates: [],
      error: 'no_scorecard_data'
    };
  }

  const t = mergeThresholds(thresholds);
  const gates = [];

  // Gate 1: Minimum accuracy
  gates.push({
    gate: 'min_accuracy',
    threshold: t.min_accuracy,
    actual: scorecard.mean_accuracy,
    passed: scorecard.mean_accuracy >= t.min_accuracy,
    message: `Mean accuracy ${(scorecard.mean_accuracy * 100).toFixed(1)}% vs threshold ${(t.min_accuracy * 100).toFixed(1)}%`
  });

  // Gate 2: Maximum unknown rate
  gates.push({
    gate: 'max_unknown_rate',
    threshold: t.max_unknown_rate,
    actual: scorecard.mean_unknown_rate,
    passed: scorecard.mean_unknown_rate <= t.max_unknown_rate,
    message: `Unknown rate ${(scorecard.mean_unknown_rate * 100).toFixed(1)}% vs max ${(t.max_unknown_rate * 100).toFixed(1)}%`
  });

  // Gate 3: Minimum coverage
  gates.push({
    gate: 'min_coverage',
    threshold: t.min_coverage,
    actual: scorecard.mean_coverage,
    passed: scorecard.mean_coverage >= t.min_coverage,
    message: `Coverage ${(scorecard.mean_coverage * 100).toFixed(1)}% vs threshold ${(t.min_coverage * 100).toFixed(1)}%`
  });

  // Gate 4: Maximum contradiction rate
  const contradictionRate = scorecard.product_count > 0
    ? scorecard.total_contradictions / scorecard.product_count
    : 0;
  gates.push({
    gate: 'max_contradiction_rate',
    threshold: t.max_contradiction_rate,
    actual: contradictionRate,
    passed: contradictionRate <= t.max_contradiction_rate,
    message: `Contradiction rate ${contradictionRate.toFixed(2)} vs max ${t.max_contradiction_rate}`
  });

  // Gate 5: Minimum validation rate
  gates.push({
    gate: 'min_validation_rate',
    threshold: t.min_validation_rate,
    actual: scorecard.validation_rate,
    passed: scorecard.validation_rate >= t.min_validation_rate,
    message: `Validation rate ${(scorecard.validation_rate * 100).toFixed(1)}% vs threshold ${(t.min_validation_rate * 100).toFixed(1)}%`
  });

  // Gate 6: Runtime budget (per product)
  const runtimePerProduct = scorecard.product_count > 0
    ? scorecard.runtime_ms / scorecard.product_count
    : 0;
  gates.push({
    gate: 'max_runtime_per_product',
    threshold: t.max_runtime_ms,
    actual: runtimePerProduct,
    passed: runtimePerProduct <= t.max_runtime_ms,
    message: `Runtime per product ${(runtimePerProduct / 1000).toFixed(1)}s vs max ${(t.max_runtime_ms / 1000).toFixed(1)}s`
  });

  // Gate 7: Cost budget (per product)
  const costPerProduct = scorecard.product_count > 0
    ? scorecard.cost_usd / scorecard.product_count
    : 0;
  gates.push({
    gate: 'max_cost_per_product',
    threshold: t.max_cost_usd_per_product,
    actual: costPerProduct,
    passed: costPerProduct <= t.max_cost_usd_per_product,
    message: `Cost per product $${costPerProduct.toFixed(4)} vs max $${t.max_cost_usd_per_product.toFixed(2)}`
  });

  const passCount = gates.filter((g) => g.passed).length;
  const failCount = gates.filter((g) => !g.passed).length;

  return {
    passed: failCount === 0,
    gate_count: gates.length,
    pass_count: passCount,
    fail_count: failCount,
    gates
  };
}

/**
 * Compare current scorecard against a baseline scorecard for regression detection.
 *
 * @param {object} current - Current benchmark scorecard
 * @param {object} baseline - Previous/baseline scorecard
 * @param {object} tolerances - How much degradation is acceptable
 * @returns {{ regressed, checks }}
 */
export function checkRegressionVsBaseline({
  current,
  baseline,
  tolerances = {}
}) {
  if (!current || !baseline) {
    return { regressed: false, checks: [], error: 'missing_scorecard' };
  }

  const tol = {
    accuracy_drop: tolerances.accuracy_drop ?? 0.05,
    coverage_drop: tolerances.coverage_drop ?? 0.05,
    unknown_rate_increase: tolerances.unknown_rate_increase ?? 0.05,
    ...tolerances
  };

  const checks = [];

  // Check accuracy regression
  const accDrop = baseline.mean_accuracy - current.mean_accuracy;
  checks.push({
    metric: 'accuracy',
    baseline: baseline.mean_accuracy,
    current: current.mean_accuracy,
    delta: -accDrop,
    tolerance: tol.accuracy_drop,
    regressed: accDrop > tol.accuracy_drop
  });

  // Check coverage regression
  const covDrop = baseline.mean_coverage - current.mean_coverage;
  checks.push({
    metric: 'coverage',
    baseline: baseline.mean_coverage,
    current: current.mean_coverage,
    delta: -covDrop,
    tolerance: tol.coverage_drop,
    regressed: covDrop > tol.coverage_drop
  });

  // Check unknown rate increase
  const unkIncrease = current.mean_unknown_rate - baseline.mean_unknown_rate;
  checks.push({
    metric: 'unknown_rate',
    baseline: baseline.mean_unknown_rate,
    current: current.mean_unknown_rate,
    delta: unkIncrease,
    tolerance: tol.unknown_rate_increase,
    regressed: unkIncrease > tol.unknown_rate_increase
  });

  return {
    regressed: checks.some((c) => c.regressed),
    checks
  };
}
