import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSearchLoopStop } from '../src/search/searchLoop.js';

test('search loop stops when no new urls and fields for configured rounds', () => {
  const decision = evaluateSearchLoopStop({
    noNewUrlsRounds: 2,
    noNewFieldsRounds: 2,
    budgetReached: false,
    repeatedLowQualityRounds: 0,
    maxNoProgressRounds: 2
  });
  assert.equal(decision.stop, true);
  assert.equal(decision.reason, 'no_new_urls_and_fields');
});

test('search loop stops immediately on budget reach', () => {
  const decision = evaluateSearchLoopStop({
    noNewUrlsRounds: 0,
    noNewFieldsRounds: 0,
    budgetReached: true,
    repeatedLowQualityRounds: 0
  });
  assert.equal(decision.stop, true);
  assert.equal(decision.reason, 'budget_reached');
});

test('search loop continues when progress signals are present', () => {
  const decision = evaluateSearchLoopStop({
    noNewUrlsRounds: 0,
    noNewFieldsRounds: 1,
    budgetReached: false,
    repeatedLowQualityRounds: 1,
    maxNoProgressRounds: 2
  });
  assert.equal(decision.stop, false);
  assert.equal(decision.reason, 'continue');
});
