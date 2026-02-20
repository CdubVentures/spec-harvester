import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRoundContext,
  evaluateRoundProgress,
  evaluateStopConditions,
  orchestrateRound
} from '../src/pipeline/runOrchestrator.js';

describe('buildRoundContext', () => {
  it('returns a complete roundContext with defaults', () => {
    const ctx = buildRoundContext();
    assert.equal(ctx.round, 0);
    assert.equal(ctx.mode, 'balanced');
    assert.equal(ctx.force_verify_llm, false);
    assert.deepEqual(ctx.missing_required_fields, []);
    assert.deepEqual(ctx.missing_critical_fields, []);
    assert.deepEqual(ctx.availability, {});
    assert.deepEqual(ctx.contract_effort, {});
    assert.deepEqual(ctx.extra_queries, []);
    assert.deepEqual(ctx.llm_target_fields, []);
    assert.deepEqual(ctx.escalated_fields, []);
  });

  it('passes through all supplied values', () => {
    const ctx = buildRoundContext({
      round: 3,
      mode: 'aggressive',
      forceVerifyLlm: true,
      missingRequiredFields: ['weight', 'dpi'],
      missingCriticalFields: ['sensor'],
      availability: { expected_count: 2 },
      contractEffort: { total_effort: 5 },
      extraQueries: ['razer viper specs'],
      llmTargetFields: ['weight'],
      escalatedFields: ['dpi']
    });
    assert.equal(ctx.round, 3);
    assert.equal(ctx.mode, 'aggressive');
    assert.equal(ctx.force_verify_llm, true);
    assert.deepEqual(ctx.missing_required_fields, ['weight', 'dpi']);
    assert.deepEqual(ctx.missing_critical_fields, ['sensor']);
    assert.deepEqual(ctx.availability, { expected_count: 2 });
    assert.deepEqual(ctx.contract_effort, { total_effort: 5 });
    assert.deepEqual(ctx.extra_queries, ['razer viper specs']);
    assert.deepEqual(ctx.llm_target_fields, ['weight']);
    assert.deepEqual(ctx.escalated_fields, ['dpi']);
  });

  it('normalizes mode aliases', () => {
    assert.equal(buildRoundContext({ mode: 'uber' }).mode, 'uber_aggressive');
    assert.equal(buildRoundContext({ mode: 'uber_aggressive' }).mode, 'uber_aggressive');
    assert.equal(buildRoundContext({ mode: 'ultra' }).mode, 'uber_aggressive');
    assert.equal(buildRoundContext({ mode: 'AGGRESSIVE' }).mode, 'aggressive');
    assert.equal(buildRoundContext({ mode: 'balanced' }).mode, 'balanced');
    assert.equal(buildRoundContext({ mode: '' }).mode, 'balanced');
    assert.equal(buildRoundContext({ mode: 'garbage' }).mode, 'balanced');
  });

  it('clamps round to non-negative integer', () => {
    assert.equal(buildRoundContext({ round: -1 }).round, 0);
    assert.equal(buildRoundContext({ round: 2.7 }).round, 2);
    assert.equal(buildRoundContext({ round: null }).round, 0);
  });

  it('coerces forceVerifyLlm to boolean', () => {
    assert.equal(buildRoundContext({ forceVerifyLlm: 1 }).force_verify_llm, true);
    assert.equal(buildRoundContext({ forceVerifyLlm: 0 }).force_verify_llm, false);
    assert.equal(buildRoundContext({ forceVerifyLlm: null }).force_verify_llm, false);
  });
});

describe('evaluateRoundProgress', () => {
  it('reports improvement on first round (no previous)', () => {
    const result = evaluateRoundProgress({
      previous: null,
      current: { missingRequiredCount: 5, criticalCount: 2, contradictionCount: 0, confidence: 0.3, validated: false }
    });
    assert.equal(result.improved, true);
    assert.ok(result.reasons.includes('first_round'));
  });

  it('reports improvement when missing required count decreases', () => {
    const result = evaluateRoundProgress({
      previous: { missingRequiredCount: 10, criticalCount: 3, contradictionCount: 1, confidence: 0.3, validated: false },
      current: { missingRequiredCount: 7, criticalCount: 3, contradictionCount: 1, confidence: 0.3, validated: false }
    });
    assert.equal(result.improved, true);
    assert.ok(result.reasons.includes('missing_required_reduced'));
  });

  it('reports improvement when critical count decreases', () => {
    const result = evaluateRoundProgress({
      previous: { missingRequiredCount: 5, criticalCount: 3, contradictionCount: 0, confidence: 0.5, validated: false },
      current: { missingRequiredCount: 5, criticalCount: 1, contradictionCount: 0, confidence: 0.5, validated: false }
    });
    assert.equal(result.improved, true);
    assert.ok(result.reasons.includes('critical_reduced'));
  });

  it('reports improvement when contradictions decrease', () => {
    const result = evaluateRoundProgress({
      previous: { missingRequiredCount: 5, criticalCount: 2, contradictionCount: 3, confidence: 0.5, validated: false },
      current: { missingRequiredCount: 5, criticalCount: 2, contradictionCount: 1, confidence: 0.5, validated: false }
    });
    assert.equal(result.improved, true);
    assert.ok(result.reasons.includes('contradictions_reduced'));
  });

  it('reports improvement when confidence rises by more than 0.01', () => {
    const result = evaluateRoundProgress({
      previous: { missingRequiredCount: 5, criticalCount: 2, contradictionCount: 0, confidence: 0.5, validated: false },
      current: { missingRequiredCount: 5, criticalCount: 2, contradictionCount: 0, confidence: 0.55, validated: false }
    });
    assert.equal(result.improved, true);
    assert.ok(result.reasons.includes('confidence_up'));
  });

  it('does not report improvement for negligible confidence change', () => {
    const result = evaluateRoundProgress({
      previous: { missingRequiredCount: 5, criticalCount: 2, contradictionCount: 0, confidence: 0.50, validated: false },
      current: { missingRequiredCount: 5, criticalCount: 2, contradictionCount: 0, confidence: 0.505, validated: false }
    });
    assert.equal(result.improved, false);
    assert.deepEqual(result.reasons, []);
  });

  it('reports improvement when validated transitions to true', () => {
    const result = evaluateRoundProgress({
      previous: { missingRequiredCount: 0, criticalCount: 0, contradictionCount: 0, confidence: 0.9, validated: false },
      current: { missingRequiredCount: 0, criticalCount: 0, contradictionCount: 0, confidence: 0.95, validated: true }
    });
    assert.equal(result.improved, true);
    assert.ok(result.reasons.includes('validated'));
  });

  it('can report multiple improvement reasons at once', () => {
    const result = evaluateRoundProgress({
      previous: { missingRequiredCount: 10, criticalCount: 5, contradictionCount: 3, confidence: 0.3, validated: false },
      current: { missingRequiredCount: 5, criticalCount: 2, contradictionCount: 1, confidence: 0.6, validated: false }
    });
    assert.equal(result.improved, true);
    assert.ok(result.reasons.includes('missing_required_reduced'));
    assert.ok(result.reasons.includes('critical_reduced'));
    assert.ok(result.reasons.includes('contradictions_reduced'));
    assert.ok(result.reasons.includes('confidence_up'));
  });

  it('reports no improvement when nothing changes', () => {
    const snapshot = { missingRequiredCount: 5, criticalCount: 2, contradictionCount: 1, confidence: 0.5, validated: false };
    const result = evaluateRoundProgress({
      previous: snapshot,
      current: { ...snapshot }
    });
    assert.equal(result.improved, false);
    assert.deepEqual(result.reasons, []);
  });
});

describe('evaluateStopConditions', () => {
  it('stops when completed', () => {
    const result = evaluateStopConditions({
      completed: true,
      round: 1,
      roundsLimit: 4
    });
    assert.equal(result.stop, true);
    assert.equal(result.reason, 'complete');
  });

  it('stops when budget exhausted after round 0', () => {
    const result = evaluateStopConditions({
      budgetExceeded: true,
      round: 1,
      roundsLimit: 4
    });
    assert.equal(result.stop, true);
    assert.equal(result.reason, 'budget_exhausted');
  });

  it('does not stop on budget_exhausted in round 0', () => {
    const result = evaluateStopConditions({
      budgetExceeded: true,
      round: 0,
      roundsLimit: 4
    });
    assert.equal(result.stop, false);
  });

  it('stops when max rounds reached', () => {
    const result = evaluateStopConditions({
      round: 3,
      roundsLimit: 4,
      roundsCompleted: 4
    });
    assert.equal(result.stop, true);
    assert.equal(result.reason, 'max_rounds_reached');
  });

  it('stops on sustained no-progress streak', () => {
    const result = evaluateStopConditions({
      round: 3,
      roundsLimit: 8,
      noProgressStreak: 3,
      noProgressLimit: 3
    });
    assert.equal(result.stop, true);
    assert.equal(result.reason, 'no_progress_3_rounds');
  });

  it('does not stop when no-progress streak is below limit', () => {
    const result = evaluateStopConditions({
      round: 2,
      roundsLimit: 8,
      noProgressStreak: 1,
      noProgressLimit: 3
    });
    assert.equal(result.stop, false);
  });

  it('stops on repeated low quality rounds', () => {
    const result = evaluateStopConditions({
      round: 3,
      roundsLimit: 8,
      lowQualityRounds: 3,
      maxLowQualityRounds: 3
    });
    assert.equal(result.stop, true);
    assert.equal(result.reason, 'repeated_low_quality');
  });

  it('returns stop=false with no reason when nothing triggers', () => {
    const result = evaluateStopConditions({
      round: 1,
      roundsLimit: 4,
      noProgressStreak: 0,
      noProgressLimit: 3,
      lowQualityRounds: 0,
      maxLowQualityRounds: 3
    });
    assert.equal(result.stop, false);
    assert.equal(result.reason, null);
  });

  it('prioritizes completed over other conditions', () => {
    const result = evaluateStopConditions({
      completed: true,
      budgetExceeded: true,
      round: 5,
      roundsLimit: 4,
      roundsCompleted: 5,
      noProgressStreak: 10
    });
    assert.equal(result.stop, true);
    assert.equal(result.reason, 'complete');
  });
});

describe('orchestrateRound', () => {
  it('delegates to runProductFn with correct shape', async () => {
    let capturedArgs = null;
    const mockRunProduct = async (args) => {
      capturedArgs = args;
      return { runId: 'test-123', summary: { validated: true } };
    };

    const roundContext = buildRoundContext({ round: 0, mode: 'balanced' });
    const result = await orchestrateRound({
      runProductFn: mockRunProduct,
      storage: { fake: true },
      config: { key: 'val' },
      s3Key: 'specs/inputs/mouse/test.json',
      jobOverride: { requirements: {} },
      roundContext
    });

    assert.equal(result.runId, 'test-123');
    assert.deepEqual(capturedArgs.storage, { fake: true });
    assert.deepEqual(capturedArgs.config, { key: 'val' });
    assert.equal(capturedArgs.s3Key, 'specs/inputs/mouse/test.json');
    assert.deepEqual(capturedArgs.jobOverride, { requirements: {} });
    assert.deepEqual(capturedArgs.roundContext, roundContext);
  });

  it('propagates errors from runProductFn', async () => {
    const failing = async () => { throw new Error('boom'); };

    await assert.rejects(
      () => orchestrateRound({
        runProductFn: failing,
        storage: {},
        config: {},
        s3Key: 'test.json',
        roundContext: buildRoundContext()
      }),
      { message: 'boom' }
    );
  });

  it('returns the result unchanged', async () => {
    const expected = {
      runId: 'run-abc',
      summary: {
        validated: false,
        missing_required_fields: ['weight'],
        confidence: 0.7
      }
    };
    const mockFn = async () => expected;

    const result = await orchestrateRound({
      runProductFn: mockFn,
      storage: {},
      config: {},
      s3Key: 'test.json',
      roundContext: buildRoundContext()
    });
    assert.deepEqual(result, expected);
  });
});
