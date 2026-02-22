import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLearningGate } from '../src/learning/learningUpdater.js';

test('rejects when confidence below threshold', () => {
  const result = evaluateLearningGate({
    field: 'sensor',
    confidence: 0.7,
    refsFound: 3,
    minRefs: 2,
    fieldStatus: 'accepted',
    tierHistory: [1, 2]
  });
  assert.deepStrictEqual(result, { accepted: false, reason: 'confidence_below_threshold' });
});

test('rejects when refs below min_refs', () => {
  const result = evaluateLearningGate({
    field: 'sensor',
    confidence: 0.95,
    refsFound: 1,
    minRefs: 2,
    fieldStatus: 'accepted',
    tierHistory: [1, 2]
  });
  assert.deepStrictEqual(result, { accepted: false, reason: 'evidence_refs_insufficient' });
});

test('rejects when fieldStatus is not accepted', () => {
  const result = evaluateLearningGate({
    field: 'sensor',
    confidence: 0.95,
    refsFound: 3,
    minRefs: 2,
    fieldStatus: 'pending',
    tierHistory: [1, 2]
  });
  assert.deepStrictEqual(result, { accepted: false, reason: 'field_not_accepted' });
});

test('rejects when no Tier 1/2 evidence', () => {
  const result = evaluateLearningGate({
    field: 'sensor',
    confidence: 0.95,
    refsFound: 3,
    minRefs: 2,
    fieldStatus: 'accepted',
    tierHistory: [3, 4]
  });
  assert.deepStrictEqual(result, { accepted: false, reason: 'tier_criteria_not_met' });
});

test('accepts when all gates pass', () => {
  const result = evaluateLearningGate({
    field: 'sensor',
    confidence: 0.95,
    refsFound: 3,
    minRefs: 2,
    fieldStatus: 'accepted',
    tierHistory: [1, 2, 3]
  });
  assert.deepStrictEqual(result, { accepted: true, reason: null });
});

test('rejects component update when component review not accepted', () => {
  const result = evaluateLearningGate({
    field: 'sensor',
    confidence: 0.95,
    refsFound: 3,
    minRefs: 2,
    fieldStatus: 'accepted',
    tierHistory: [1],
    componentRef: 'sensor_component',
    componentReviewStatus: 'pending'
  });
  assert.deepStrictEqual(result, { accepted: false, reason: 'component_not_accepted' });
});

test('accepts component update when component review is accepted', () => {
  const result = evaluateLearningGate({
    field: 'sensor',
    confidence: 0.95,
    refsFound: 3,
    minRefs: 2,
    fieldStatus: 'accepted',
    tierHistory: [1],
    componentRef: 'sensor_component',
    componentReviewStatus: 'accepted'
  });
  assert.deepStrictEqual(result, { accepted: true, reason: null });
});

test('uses custom confidence threshold from config', () => {
  const result = evaluateLearningGate({
    field: 'sensor',
    confidence: 0.8,
    refsFound: 3,
    minRefs: 2,
    fieldStatus: 'accepted',
    tierHistory: [1],
    config: { learningConfidenceThreshold: 0.75 }
  });
  assert.deepStrictEqual(result, { accepted: true, reason: null });
});

test('uses default minRefs of 2 when not specified', () => {
  const result = evaluateLearningGate({
    field: 'sensor',
    confidence: 0.95,
    refsFound: 1,
    fieldStatus: 'accepted',
    tierHistory: [1]
  });
  assert.deepStrictEqual(result, { accepted: false, reason: 'evidence_refs_insufficient' });
});
