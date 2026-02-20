/**
 * Benchmark Matrix (IP03-3C).
 *
 * Compares pipeline output across modes: balanced, aggressive, uber_aggressive.
 * Generates a scorecard per mode with coverage, conflicts, runtime, cost metrics.
 * Results are comparable for regression tracking.
 */

const MODES = ['balanced', 'aggressive', 'uber_aggressive'];

function normalizeMode(value) {
  const token = String(value || '').trim().toLowerCase().replace(/-/g, '_');
  if (MODES.includes(token)) return token;
  return 'balanced';
}

function normalizeFieldValue(value) {
  const token = String(value ?? '').trim().toLowerCase();
  return token === '' || token === 'unk' || token === 'unknown' || token === 'n/a' ? 'unk' : String(value ?? '').trim();
}

/**
 * Score a single product run result against golden expected fields.
 */
export function scoreProductRun({ fields = {}, expectedFields = {}, summary = {} }) {
  const fieldNames = Object.keys(expectedFields);
  let totalFields = fieldNames.length;
  let correct = 0;
  let incorrect = 0;
  let unknown = 0;
  const mismatches = [];

  for (const field of fieldNames) {
    const actual = normalizeFieldValue(fields[field]);
    const expected = normalizeFieldValue(expectedFields[field]);

    if (actual === 'unk') {
      unknown += 1;
    } else if (actual.toLowerCase() === expected.toLowerCase()) {
      correct += 1;
    } else {
      incorrect += 1;
      mismatches.push({ field, expected, actual });
    }
  }

  return {
    total_fields: totalFields,
    correct,
    incorrect,
    unknown,
    accuracy: totalFields > 0 ? correct / totalFields : 0,
    coverage: totalFields > 0 ? (totalFields - unknown) / totalFields : 0,
    unknown_rate: totalFields > 0 ? unknown / totalFields : 0,
    mismatches,
    validated: Boolean(summary.validated),
    confidence: Number(summary.confidence || 0) || 0,
    contradiction_count: Number(summary.constraint_analysis?.contradiction_count || 0) || 0
  };
}

/**
 * Build a scorecard for a single mode across multiple products.
 */
export function buildModeScorecard({ mode, productScores = [], runtimeMs = 0, costUsd = 0, urlsFetched = 0, llmCalls = 0 }) {
  const normalizedMode = normalizeMode(mode);
  const productCount = productScores.length;

  if (productCount === 0) {
    return {
      mode: normalizedMode,
      product_count: 0,
      mean_accuracy: 0,
      mean_coverage: 0,
      mean_unknown_rate: 0,
      mean_confidence: 0,
      total_contradictions: 0,
      validated_count: 0,
      validation_rate: 0,
      total_mismatches: 0,
      runtime_ms: runtimeMs,
      cost_usd: costUsd,
      urls_fetched: urlsFetched,
      llm_calls: llmCalls,
      products: []
    };
  }

  const sumAccuracy = productScores.reduce((s, p) => s + p.accuracy, 0);
  const sumCoverage = productScores.reduce((s, p) => s + p.coverage, 0);
  const sumUnknownRate = productScores.reduce((s, p) => s + p.unknown_rate, 0);
  const sumConfidence = productScores.reduce((s, p) => s + p.confidence, 0);
  const totalContradictions = productScores.reduce((s, p) => s + p.contradiction_count, 0);
  const validatedCount = productScores.filter((p) => p.validated).length;
  const totalMismatches = productScores.reduce((s, p) => s + p.mismatches.length, 0);

  return {
    mode: normalizedMode,
    product_count: productCount,
    mean_accuracy: sumAccuracy / productCount,
    mean_coverage: sumCoverage / productCount,
    mean_unknown_rate: sumUnknownRate / productCount,
    mean_confidence: sumConfidence / productCount,
    total_contradictions: totalContradictions,
    validated_count: validatedCount,
    validation_rate: validatedCount / productCount,
    total_mismatches: totalMismatches,
    runtime_ms: runtimeMs,
    cost_usd: costUsd,
    urls_fetched: urlsFetched,
    llm_calls: llmCalls,
    products: productScores
  };
}

/**
 * Compare scorecards across modes and produce a delta matrix.
 */
export function compareModeScorecards(scorecards = []) {
  if (scorecards.length < 2) {
    return { comparison: [], winner: scorecards[0]?.mode || null };
  }

  const sorted = [...scorecards].sort((a, b) => {
    const accDelta = b.mean_accuracy - a.mean_accuracy;
    if (Math.abs(accDelta) > 0.01) return accDelta;
    const covDelta = b.mean_coverage - a.mean_coverage;
    if (Math.abs(covDelta) > 0.01) return covDelta;
    return a.mean_unknown_rate - b.mean_unknown_rate;
  });

  const baseline = sorted[0];
  const comparison = sorted.map((card) => ({
    mode: card.mode,
    accuracy_delta: Number((card.mean_accuracy - baseline.mean_accuracy).toFixed(4)),
    coverage_delta: Number((card.mean_coverage - baseline.mean_coverage).toFixed(4)),
    unknown_rate_delta: Number((card.mean_unknown_rate - baseline.mean_unknown_rate).toFixed(4)),
    contradiction_delta: card.total_contradictions - baseline.total_contradictions,
    runtime_ratio: baseline.runtime_ms > 0 ? Number((card.runtime_ms / baseline.runtime_ms).toFixed(2)) : 0,
    cost_ratio: baseline.cost_usd > 0 ? Number((card.cost_usd / baseline.cost_usd).toFixed(2)) : 0
  }));

  return {
    comparison,
    winner: sorted[0].mode,
    baseline_mode: baseline.mode
  };
}

/**
 * Generate a full benchmark matrix report.
 */
export function buildBenchmarkMatrix({ scorecards = [], category = '', date = '' }) {
  const comparison = compareModeScorecards(scorecards);
  return {
    category,
    date: date || new Date().toISOString().slice(0, 10),
    modes: scorecards.map((c) => c.mode),
    scorecards,
    ...comparison
  };
}
