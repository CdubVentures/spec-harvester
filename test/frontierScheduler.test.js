import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDeepeningTier, uberStopDecision } from '../src/research/frontierScheduler.js';

test('resolveDeepeningTier escalates in uber_aggressive mode when criticals remain', () => {
  const tier = resolveDeepeningTier({
    round: 3,
    mode: 'uber_aggressive',
    previousSummary: {
      missing_required_fields: ['dpi'],
      critical_fields_below_pass_target: ['dpi']
    },
    noProgressRounds: 2
  });
  assert.equal(tier, 'tier3');
});

test('uberStopDecision stops on diminishing returns and on required completion', () => {
  const diminishing = uberStopDecision({
    summary: {
      missing_required_fields: ['weight']
    },
    round: 4,
    noNewHighYieldRounds: 2,
    noNewFieldsRounds: 2
  });
  assert.equal(diminishing.stop, true);
  assert.equal(diminishing.reason, 'diminishing_returns');

  const complete = uberStopDecision({
    summary: {
      missing_required_fields: [],
      critical_fields_below_pass_target: []
    },
    round: 1
  });
  assert.equal(complete.stop, true);
  assert.equal(complete.reason, 'required_and_critical_satisfied');
});
