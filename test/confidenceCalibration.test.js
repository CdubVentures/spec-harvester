import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCalibrationReport } from '../src/calibration/confidenceCalibrator.js';

// ---------------------------------------------------------------------------
// A.5 — Confidence Calibration Infrastructure Tests
//
// Tests for src/calibration/confidenceCalibrator.js. The calibrator takes
// golden ground-truth data + pipeline outputs and computes a calibration
// report (per-bucket accuracy, reliability diagram, Brier score).
// ---------------------------------------------------------------------------

// =========================================================================
// SECTION 1: Basic calibration report generation
// =========================================================================

test('A.5 calibration: generates report from predictions + ground truth', () => {
  const predictions = [
    { field: 'weight', value: '54', confidence: 0.95 },
    { field: 'dpi', value: '35000', confidence: 0.90 },
    { field: 'sensor', value: 'Focus Pro 4K', confidence: 0.85 },
    { field: 'polling_rate', value: '4000', confidence: 0.70 }
  ];
  const groundTruth = {
    weight: '54',
    dpi: '35000',
    sensor: 'Focus Pro 4K',
    polling_rate: '4000'
  };
  const report = computeCalibrationReport({ predictions, groundTruth });
  assert.equal(report.total_fields, 4);
  assert.ok(report.brier_score !== null);
  assert.ok(report.brier_score >= 0);
  assert.ok(report.buckets.length > 0);
});

test('A.5 calibration: perfect predictions give brier score of 0', () => {
  const predictions = [
    { field: 'weight', value: '54', confidence: 1.0 },
    { field: 'dpi', value: '35000', confidence: 1.0 }
  ];
  const groundTruth = { weight: '54', dpi: '35000' };
  const report = computeCalibrationReport({ predictions, groundTruth });
  assert.equal(report.brier_score, 0);
});

test('A.5 calibration: all wrong predictions with confidence 1.0 give worst brier', () => {
  const predictions = [
    { field: 'weight', value: 'WRONG', confidence: 1.0 },
    { field: 'dpi', value: 'WRONG', confidence: 1.0 }
  ];
  const groundTruth = { weight: '54', dpi: '35000' };
  const report = computeCalibrationReport({ predictions, groundTruth });
  assert.equal(report.brier_score, 1.0);
});

// =========================================================================
// SECTION 2: Bucket accuracy computation
// =========================================================================

test('A.5 buckets: predictions bucketed by confidence range', () => {
  const predictions = [
    { field: 'f1', value: 'correct', confidence: 0.55 },
    { field: 'f2', value: 'correct', confidence: 0.60 },
    { field: 'f3', value: 'wrong', confidence: 0.65 },
    { field: 'f4', value: 'correct', confidence: 0.90 },
    { field: 'f5', value: 'correct', confidence: 0.92 }
  ];
  const groundTruth = {
    f1: 'correct',
    f2: 'correct',
    f3: 'correct',
    f4: 'correct',
    f5: 'correct'
  };
  const report = computeCalibrationReport({ predictions, groundTruth });

  // 0.5-0.7 bucket: f1 (correct), f2 (correct), f3 (wrong) → accuracy 2/3
  const lowBucket = report.buckets.find((b) => b.label === '0.5-0.7');
  assert.ok(lowBucket);
  assert.equal(lowBucket.count, 3);
  assert.equal(lowBucket.correct, 2);
  assert.ok(Math.abs(lowBucket.actual_accuracy - 2 / 3) < 0.01);

  // 0.85-0.95 bucket: f4, f5 both correct → accuracy 1.0
  const highBucket = report.buckets.find((b) => b.label === '0.85-0.95');
  assert.ok(highBucket);
  assert.equal(highBucket.count, 2);
  assert.equal(highBucket.actual_accuracy, 1.0);
});

test('A.5 buckets: empty buckets are excluded from report', () => {
  const predictions = [
    { field: 'f1', value: 'a', confidence: 0.91 }
  ];
  const groundTruth = { f1: 'a' };
  const report = computeCalibrationReport({ predictions, groundTruth });
  // Only the 0.85-0.95 bucket should appear
  assert.equal(report.buckets.length, 1);
  assert.equal(report.buckets[0].label, '0.85-0.95');
});

// =========================================================================
// SECTION 3: Mean confidence per bucket
// =========================================================================

test('A.5 mean confidence: bucket records average predicted confidence', () => {
  const predictions = [
    { field: 'f1', value: 'a', confidence: 0.72 },
    { field: 'f2', value: 'b', confidence: 0.78 },
    { field: 'f3', value: 'c', confidence: 0.82 }
  ];
  const groundTruth = { f1: 'a', f2: 'b', f3: 'c' };
  const report = computeCalibrationReport({ predictions, groundTruth });
  const bucket = report.buckets.find((b) => b.label === '0.7-0.85');
  assert.ok(bucket);
  const expectedMean = (0.72 + 0.78 + 0.82) / 3;
  assert.ok(Math.abs(bucket.mean_confidence - expectedMean) < 0.001);
});

// =========================================================================
// SECTION 4: Edge cases
// =========================================================================

test('A.5 edge: empty predictions returns error', () => {
  const report = computeCalibrationReport({ predictions: [], groundTruth: {} });
  assert.equal(report.error, 'no_predictions');
  assert.equal(report.total_fields, 0);
});

test('A.5 edge: null ground truth returns error', () => {
  const report = computeCalibrationReport({
    predictions: [{ field: 'f1', value: 'a', confidence: 0.9 }],
    groundTruth: null
  });
  assert.equal(report.error, 'no_ground_truth');
});

test('A.5 edge: predictions for fields not in ground truth are skipped', () => {
  const predictions = [
    { field: 'weight', value: '54', confidence: 0.95 },
    { field: 'not_in_golden', value: 'x', confidence: 0.80 }
  ];
  const groundTruth = { weight: '54' };
  const report = computeCalibrationReport({ predictions, groundTruth });
  assert.equal(report.total_fields, 1);
});

test('A.5 edge: case-insensitive value comparison', () => {
  const predictions = [
    { field: 'sensor', value: 'Focus PRO 4K', confidence: 0.90 }
  ];
  const groundTruth = { sensor: 'focus pro 4k' };
  const report = computeCalibrationReport({ predictions, groundTruth });
  assert.equal(report.total_fields, 1);
  assert.equal(report.brier_score < 0.1, true);
});

test('A.5 edge: whitespace-normalized comparison', () => {
  const predictions = [
    { field: 'sensor', value: ' Focus  Pro   4K ', confidence: 0.90 }
  ];
  const groundTruth = { sensor: 'Focus Pro 4K' };
  const report = computeCalibrationReport({ predictions, groundTruth });
  const bucket = report.buckets[0];
  assert.equal(bucket.correct, 1);
});

test('A.5 edge: confidence exactly at bucket boundary', () => {
  const predictions = [
    { field: 'f1', value: 'a', confidence: 0.5 },
    { field: 'f2', value: 'b', confidence: 0.7 },
    { field: 'f3', value: 'c', confidence: 0.85 },
    { field: 'f4', value: 'd', confidence: 0.95 }
  ];
  const groundTruth = { f1: 'a', f2: 'b', f3: 'c', f4: 'd' };
  const report = computeCalibrationReport({ predictions, groundTruth });
  // Each boundary value should fall into its own bucket (min inclusive)
  assert.equal(report.buckets.length, 4);
});

test('A.5 edge: confidence of 0.0 falls into lowest bucket', () => {
  const predictions = [
    { field: 'f1', value: 'a', confidence: 0.0 }
  ];
  const groundTruth = { f1: 'a' };
  const report = computeCalibrationReport({ predictions, groundTruth });
  assert.equal(report.buckets[0].label, '0.0-0.5');
});

// =========================================================================
// SECTION 5: Multi-product calibration (aggregated)
// =========================================================================

test('A.5 multi-product: aggregates predictions from multiple products', () => {
  // Simulates collecting predictions from multiple product runs
  const product1Preds = [
    { field: 'weight', value: '54', confidence: 0.95 },
    { field: 'dpi', value: '35000', confidence: 0.88 }
  ];
  const product2Preds = [
    { field: 'weight', value: '62', confidence: 0.90 },
    { field: 'dpi', value: '30000', confidence: 0.75 }
  ];
  const product1Truth = { weight: '54', dpi: '35000' };
  const product2Truth = { weight: '62', dpi: '30000' };

  // Combine predictions for aggregate calibration
  const allPredictions = [...product1Preds, ...product2Preds];
  const allGroundTruth = {};
  // Re-key with product prefix for uniqueness in real implementation,
  // but for this test we just merge since fields are the same
  for (const [key, val] of Object.entries(product1Truth)) {
    allGroundTruth[`p1_${key}`] = val;
  }
  for (const [key, val] of Object.entries(product2Truth)) {
    allGroundTruth[`p2_${key}`] = val;
  }
  const allPredsKeyed = [
    ...product1Preds.map((p) => ({ ...p, field: `p1_${p.field}` })),
    ...product2Preds.map((p) => ({ ...p, field: `p2_${p.field}` }))
  ];

  const report = computeCalibrationReport({
    predictions: allPredsKeyed,
    groundTruth: allGroundTruth
  });
  assert.equal(report.total_fields, 4);
  assert.ok(report.brier_score !== null);
  // All predictions are correct, so brier should be low
  assert.ok(report.brier_score < 0.15);
});

// =========================================================================
// SECTION 6: Reliability diagram data structure
// =========================================================================

test('A.5 reliability diagram: bucket data suitable for plotting', () => {
  const predictions = [];
  const groundTruth = {};
  // Generate 50 predictions across confidence range
  for (let i = 0; i < 50; i += 1) {
    const confidence = 0.5 + (i / 50) * 0.5;
    const isCorrect = Math.random() < confidence;
    const field = `f${i}`;
    predictions.push({
      field,
      value: isCorrect ? 'correct' : 'wrong',
      confidence
    });
    groundTruth[field] = 'correct';
  }
  const report = computeCalibrationReport({ predictions, groundTruth });
  assert.ok(report.total_fields > 0);
  for (const bucket of report.buckets) {
    assert.ok(typeof bucket.mean_confidence === 'number');
    assert.ok(typeof bucket.actual_accuracy === 'number');
    assert.ok(typeof bucket.count === 'number');
    assert.ok(bucket.actual_accuracy >= 0 && bucket.actual_accuracy <= 1);
    assert.ok(bucket.mean_confidence >= 0 && bucket.mean_confidence <= 1);
  }
});
