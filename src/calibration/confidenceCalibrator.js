function normalizeForComparison(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function computeCalibrationReport({ predictions, groundTruth }) {
  if (!Array.isArray(predictions) || predictions.length === 0) {
    return {
      total_fields: 0,
      buckets: [],
      brier_score: null,
      error: 'no_predictions'
    };
  }
  if (!groundTruth || typeof groundTruth !== 'object') {
    return {
      total_fields: 0,
      buckets: [],
      brier_score: null,
      error: 'no_ground_truth'
    };
  }

  const bucketDefs = [
    { label: '0.0-0.5', min: 0, max: 0.5 },
    { label: '0.5-0.7', min: 0.5, max: 0.7 },
    { label: '0.7-0.85', min: 0.7, max: 0.85 },
    { label: '0.85-0.95', min: 0.85, max: 0.95 },
    { label: '0.95-1.0', min: 0.95, max: 1.01 }
  ];

  const buckets = bucketDefs.map((def) => ({
    ...def,
    count: 0,
    correct: 0,
    mean_confidence: 0,
    actual_accuracy: 0,
    sum_confidence: 0
  }));

  let totalBrier = 0;
  let totalMatched = 0;

  for (const pred of predictions) {
    const { field, value, confidence } = pred;
    const truth = groundTruth[field];
    if (truth === undefined) continue;

    totalMatched += 1;
    const isCorrect = normalizeForComparison(value) === normalizeForComparison(truth);
    const brierTerm = Math.pow((isCorrect ? 1 : 0) - confidence, 2);
    totalBrier += brierTerm;

    const bucket = buckets.find((b) => confidence >= b.min && confidence < b.max);
    if (bucket) {
      bucket.count += 1;
      bucket.sum_confidence += confidence;
      if (isCorrect) bucket.correct += 1;
    }
  }

  for (const bucket of buckets) {
    bucket.mean_confidence = bucket.count > 0 ? bucket.sum_confidence / bucket.count : 0;
    bucket.actual_accuracy = bucket.count > 0 ? bucket.correct / bucket.count : 0;
    delete bucket.sum_confidence;
  }

  return {
    total_fields: totalMatched,
    buckets: buckets.filter((b) => b.count > 0),
    brier_score: totalMatched > 0 ? totalBrier / totalMatched : null
  };
}
