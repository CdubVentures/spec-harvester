import test from 'node:test';
import assert from 'node:assert/strict';
import { createBudgetGuard } from '../src/billing/budgetGuard.js';

test('budget guard blocks non-essential calls when monthly budget exceeded', () => {
  const guard = createBudgetGuard({
    config: {
      llmMonthlyBudgetUsd: 1,
      llmPerProductBudgetUsd: 0.5,
      llmMaxCallsPerProductTotal: 10,
      llmMaxCallsPerRound: 4
    },
    monthlySpentUsd: 1.2,
    productSpentUsd: 0.2,
    productCallsTotal: 2
  });

  const nonEssential = guard.canCall({
    reason: 'plan',
    essential: false
  });
  assert.equal(nonEssential.allowed, false);
  assert.equal(nonEssential.reason, 'budget_monthly_exhausted_nonessential_disabled');

  const essential = guard.canCall({
    reason: 'extract',
    essential: true
  });
  assert.equal(essential.allowed, true);
});

test('budget guard enforces per-round and per-product limits', () => {
  const guard = createBudgetGuard({
    config: {
      llmMonthlyBudgetUsd: 100,
      llmPerProductBudgetUsd: 1,
      llmMaxCallsPerProductTotal: 2,
      llmMaxCallsPerRound: 1
    },
    monthlySpentUsd: 0,
    productSpentUsd: 0,
    productCallsTotal: 0
  });

  const first = guard.canCall({ reason: 'extract' });
  assert.equal(first.allowed, true);
  guard.recordCall({ costUsd: 0.1 });

  const secondSameRound = guard.canCall({ reason: 'plan' });
  assert.equal(secondSameRound.allowed, false);
  assert.equal(secondSameRound.reason, 'budget_max_calls_per_round_reached');

  guard.startRound();
  const secondRound = guard.canCall({ reason: 'plan' });
  assert.equal(secondRound.allowed, true);
  guard.recordCall({ costUsd: 0.1 });

  guard.startRound();
  const overProductLimit = guard.canCall({ reason: 'extract' });
  assert.equal(overProductLimit.allowed, false);
  assert.equal(overProductLimit.reason, 'budget_max_calls_per_product_reached');
});
