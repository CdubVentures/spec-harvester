import test from 'node:test';
import assert from 'node:assert/strict';
import { rankBatchWithBandit } from '../src/learning/banditScheduler.js';

test('bandit scheduler prioritizes high information-need cold-start items in balanced mode', () => {
  const ranked = rankBatchWithBandit({
    seed: 'test-seed-1',
    mode: 'balanced',
    brandRewardIndex: {
      razer: 0.2,
      acme: 0
    },
    metadataRows: [
      {
        key: 'k1',
        productId: 'mouse-razer-a',
        brand: 'razer',
        brandKey: 'razer',
        hasHistory: true,
        validated: true,
        confidence: 0.95,
        missingCriticalCount: 0,
        fieldsBelowPassCount: 0,
        contradictionCount: 0,
        hypothesisQueueCount: 0
      },
      {
        key: 'k2',
        productId: 'mouse-acme-b',
        brand: 'acme',
        brandKey: 'acme',
        hasHistory: false,
        validated: false,
        confidence: 0.2,
        missingCriticalCount: 7,
        fieldsBelowPassCount: 12,
        contradictionCount: 3,
        hypothesisQueueCount: 9
      }
    ]
  });

  assert.equal(ranked.orderedKeys[0], 'k2');
  assert.equal(ranked.scored[0].info_need >= ranked.scored[1].info_need, true);
});

test('bandit scheduler exploit mode favors high-confidence validated items', () => {
  const ranked = rankBatchWithBandit({
    seed: 'test-seed-2',
    mode: 'exploit',
    metadataRows: [
      {
        key: 'k-strong',
        productId: 'mouse-strong',
        brand: 'razer',
        brandKey: 'razer',
        hasHistory: true,
        validated: true,
        confidence: 0.98,
        missingCriticalCount: 0,
        fieldsBelowPassCount: 0,
        contradictionCount: 0,
        hypothesisQueueCount: 0
      },
      {
        key: 'k-weak',
        productId: 'mouse-weak',
        brand: 'acme',
        brandKey: 'acme',
        hasHistory: false,
        validated: false,
        confidence: 0.2,
        missingCriticalCount: 2,
        fieldsBelowPassCount: 5,
        contradictionCount: 2,
        hypothesisQueueCount: 4
      }
    ]
  });

  assert.equal(ranked.orderedKeys[0], 'k-strong');
  assert.equal(ranked.scored[0].bandit_score > ranked.scored[1].bandit_score, true);
});
