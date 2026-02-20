import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EvalRun,
  EvalLab,
  compareEvalRuns
} from '../src/benchmark/evalLab.js';

// ---------------------------------------------------------------------------
// IP03-3E — Prompt/Model Eval Lab Tests
// ---------------------------------------------------------------------------

const GOLDEN = {
  weight: '80',
  sensor: 'HERO 25K',
  max_dpi: '25600',
  polling_rate: '1000'
};

test('evalRun: records extraction results for a product', () => {
  const run = new EvalRun({ runId: 'run-1', label: 'baseline-prompt' });
  run.addResult({
    productId: 'mouse-001',
    extracted: { weight: '80', sensor: 'HERO 25K', max_dpi: '25600', polling_rate: '1000' },
    expected: GOLDEN
  });
  assert.equal(run.results.length, 1);
  assert.equal(run.results[0].accuracy, 1.0);
});

test('evalRun: computes per-product accuracy', () => {
  const run = new EvalRun({ runId: 'run-1', label: 'test' });
  run.addResult({
    productId: 'p1',
    extracted: { weight: '80', sensor: 'HERO 25K', max_dpi: '25600', polling_rate: 'unk' },
    expected: GOLDEN
  });
  assert.equal(run.results[0].correct, 3);
  assert.equal(run.results[0].total, 4);
  assert.equal(run.results[0].accuracy, 0.75);
});

test('evalRun: tracks mismatches', () => {
  const run = new EvalRun({ runId: 'run-1', label: 'test' });
  run.addResult({
    productId: 'p1',
    extracted: { weight: '85', sensor: 'HERO 25K' },
    expected: { weight: '80', sensor: 'HERO 25K' }
  });
  const mismatches = run.results[0].mismatches;
  assert.equal(mismatches.length, 1);
  assert.equal(mismatches[0].field, 'weight');
  assert.equal(mismatches[0].expected, '80');
  assert.equal(mismatches[0].got, '85');
});

test('evalRun: scorecard aggregates across products', () => {
  const run = new EvalRun({ runId: 'run-1', label: 'test' });
  run.addResult({
    productId: 'p1',
    extracted: { weight: '80', sensor: 'HERO 25K' },
    expected: { weight: '80', sensor: 'HERO 25K' }
  });
  run.addResult({
    productId: 'p2',
    extracted: { weight: '60', sensor: 'wrong' },
    expected: { weight: '60', sensor: 'HERO 2' }
  });
  const scorecard = run.scorecard();
  assert.equal(scorecard.product_count, 2);
  assert.equal(scorecard.mean_accuracy, 0.75);
  assert.equal(scorecard.total_correct, 3);
  assert.equal(scorecard.total_fields, 4);
});

test('evalRun: records timing and cost metadata', () => {
  const run = new EvalRun({ runId: 'run-1', label: 'test' });
  run.addResult({
    productId: 'p1',
    extracted: GOLDEN,
    expected: GOLDEN,
    runtimeMs: 1500,
    costUsd: 0.02,
    llmCalls: 3
  });
  const scorecard = run.scorecard();
  assert.equal(scorecard.total_runtime_ms, 1500);
  assert.equal(scorecard.total_cost_usd, 0.02);
  assert.equal(scorecard.total_llm_calls, 3);
});

test('evalRun: handles missing fields in extracted as wrong', () => {
  const run = new EvalRun({ runId: 'run-1', label: 'test' });
  run.addResult({
    productId: 'p1',
    extracted: { weight: '80' },
    expected: { weight: '80', sensor: 'HERO 25K' }
  });
  assert.equal(run.results[0].correct, 1);
  assert.equal(run.results[0].total, 2);
  assert.equal(run.results[0].accuracy, 0.5);
});

// --- EvalLab ---

test('lab: registers and retrieves runs', () => {
  const lab = new EvalLab();
  const run = lab.createRun({ label: 'prompt-v1' });
  assert.ok(run.runId);
  assert.equal(lab.getRun(run.runId).label, 'prompt-v1');
});

test('lab: lists all runs', () => {
  const lab = new EvalLab();
  lab.createRun({ label: 'a' });
  lab.createRun({ label: 'b' });
  assert.equal(lab.listRuns().length, 2);
});

// --- Compare ---

test('compare: compares two eval runs', () => {
  const runA = new EvalRun({ runId: 'a', label: 'baseline' });
  runA.addResult({ productId: 'p1', extracted: GOLDEN, expected: GOLDEN });

  const runB = new EvalRun({ runId: 'b', label: 'new-prompt' });
  runB.addResult({
    productId: 'p1',
    extracted: { weight: '80', sensor: 'wrong', max_dpi: '25600', polling_rate: '1000' },
    expected: GOLDEN
  });

  const comparison = compareEvalRuns(runA, runB);
  assert.equal(comparison.baseline.label, 'baseline');
  assert.equal(comparison.candidate.label, 'new-prompt');
  assert.ok(comparison.accuracy_delta < 0); // candidate worse
  assert.equal(comparison.winner, 'baseline');
});

test('compare: candidate wins when more accurate', () => {
  const runA = new EvalRun({ runId: 'a', label: 'old' });
  runA.addResult({
    productId: 'p1',
    extracted: { weight: 'wrong' },
    expected: { weight: '80' }
  });

  const runB = new EvalRun({ runId: 'b', label: 'new' });
  runB.addResult({
    productId: 'p1',
    extracted: { weight: '80' },
    expected: { weight: '80' }
  });

  const comparison = compareEvalRuns(runA, runB);
  assert.equal(comparison.winner, 'new');
  assert.ok(comparison.accuracy_delta > 0);
});

test('compare: tie when equal accuracy', () => {
  const runA = new EvalRun({ runId: 'a', label: 'x' });
  runA.addResult({ productId: 'p1', extracted: GOLDEN, expected: GOLDEN });

  const runB = new EvalRun({ runId: 'b', label: 'y' });
  runB.addResult({ productId: 'p1', extracted: GOLDEN, expected: GOLDEN });

  const comparison = compareEvalRuns(runA, runB);
  assert.equal(comparison.winner, 'tie');
});

test('lab: stats returns summary', () => {
  const lab = new EvalLab();
  const run = lab.createRun({ label: 'test' });
  run.addResult({ productId: 'p1', extracted: GOLDEN, expected: GOLDEN });
  const stats = lab.stats();
  assert.equal(stats.total_runs, 1);
  assert.equal(stats.total_results, 1);
});
