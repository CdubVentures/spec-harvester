/**
 * Prompt/Model Eval Lab (IP03-3E).
 *
 * A/B testing framework for comparing prompt variations
 * and model performance on extraction tasks.
 *
 * Usage:
 *   const lab = new EvalLab();
 *   const run = lab.createRun({ label: 'prompt-v2' });
 *   run.addResult({ productId, extracted, expected, runtimeMs, costUsd });
 *   const scorecard = run.scorecard();
 *   const comparison = compareEvalRuns(baselineRun, candidateRun);
 */

let _runCounter = 0;

function normalizeValue(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'unk' || s === 'unknown' || s === '' || s === 'null' || s === 'undefined'
    ? null
    : s;
}

export class EvalRun {
  constructor({ runId, label, model, prompt, metadata } = {}) {
    this.runId = runId || `eval-${++_runCounter}-${Date.now()}`;
    this.label = String(label || 'unnamed');
    this.model = model || null;
    this.prompt = prompt || null;
    this.metadata = metadata || {};
    this.results = [];
    this.createdAt = new Date().toISOString();
  }

  addResult({ productId, extracted = {}, expected = {}, runtimeMs = 0, costUsd = 0, llmCalls = 0 } = {}) {
    const fields = Object.keys(expected);
    let correct = 0;
    const mismatches = [];

    for (const field of fields) {
      const exp = normalizeValue(expected[field]);
      const got = normalizeValue(extracted[field]);

      if (exp === null) continue; // skip fields with no expected value

      if (got === exp) {
        correct += 1;
      } else {
        mismatches.push({
          field,
          expected: String(expected[field] ?? ''),
          got: String(extracted[field] ?? '')
        });
      }
    }

    const total = fields.filter((f) => normalizeValue(expected[f]) !== null).length;
    const accuracy = total > 0 ? Number((correct / total).toFixed(4)) : 0;

    this.results.push({
      productId: String(productId || ''),
      correct,
      total,
      accuracy,
      mismatches,
      runtimeMs: Number(runtimeMs) || 0,
      costUsd: Number(costUsd) || 0,
      llmCalls: Number(llmCalls) || 0
    });
  }

  scorecard() {
    const totalCorrect = this.results.reduce((s, r) => s + r.correct, 0);
    const totalFields = this.results.reduce((s, r) => s + r.total, 0);
    const meanAccuracy = this.results.length > 0
      ? Number((this.results.reduce((s, r) => s + r.accuracy, 0) / this.results.length).toFixed(4))
      : 0;

    return {
      runId: this.runId,
      label: this.label,
      model: this.model,
      product_count: this.results.length,
      total_correct: totalCorrect,
      total_fields: totalFields,
      mean_accuracy: meanAccuracy,
      overall_accuracy: totalFields > 0 ? Number((totalCorrect / totalFields).toFixed(4)) : 0,
      total_runtime_ms: this.results.reduce((s, r) => s + r.runtimeMs, 0),
      total_cost_usd: Number(this.results.reduce((s, r) => s + r.costUsd, 0).toFixed(6)),
      total_llm_calls: this.results.reduce((s, r) => s + r.llmCalls, 0),
      total_mismatches: this.results.reduce((s, r) => s + r.mismatches.length, 0)
    };
  }
}

export class EvalLab {
  constructor() {
    this._runs = new Map();
  }

  createRun({ label, model, prompt, metadata } = {}) {
    const run = new EvalRun({ label, model, prompt, metadata });
    this._runs.set(run.runId, run);
    return run;
  }

  getRun(runId) {
    return this._runs.get(runId) || null;
  }

  listRuns() {
    return [...this._runs.values()].map((r) => ({
      runId: r.runId,
      label: r.label,
      model: r.model,
      resultCount: r.results.length,
      createdAt: r.createdAt
    }));
  }

  stats() {
    let totalResults = 0;
    for (const run of this._runs.values()) {
      totalResults += run.results.length;
    }
    return {
      total_runs: this._runs.size,
      total_results: totalResults
    };
  }
}

/**
 * Compare two eval runs and determine which is better.
 */
export function compareEvalRuns(baselineRun, candidateRun) {
  const baseScorecard = baselineRun.scorecard();
  const candScorecard = candidateRun.scorecard();

  const accuracyDelta = Number((candScorecard.mean_accuracy - baseScorecard.mean_accuracy).toFixed(4));
  const costDelta = Number((candScorecard.total_cost_usd - baseScorecard.total_cost_usd).toFixed(6));
  const runtimeDelta = candScorecard.total_runtime_ms - baseScorecard.total_runtime_ms;

  let winner;
  if (accuracyDelta > 0.001) {
    winner = candidateRun.label;
  } else if (accuracyDelta < -0.001) {
    winner = baselineRun.label;
  } else {
    winner = 'tie';
  }

  return {
    baseline: { runId: baselineRun.runId, label: baselineRun.label, ...baseScorecard },
    candidate: { runId: candidateRun.runId, label: candidateRun.label, ...candScorecard },
    accuracy_delta: accuracyDelta,
    cost_delta: costDelta,
    runtime_delta_ms: runtimeDelta,
    winner
  };
}
