import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeRoundProgress,
  buildNeedSetDispatch,
  runConvergenceLoop
} from '../src/pipeline/runOrchestrator.js';
import { computeNeedSet } from '../src/indexlab/needsetEngine.js';

describe('summarizeRoundProgress', () => {
  it('extracts counts from a run summary', () => {
    const progress = summarizeRoundProgress({
      missing_required_fields: ['weight', 'sensor'],
      critical_fields_below_pass_target: ['dpi'],
      constraint_analysis: { contradiction_count: 2 },
      confidence: 0.75,
      validated: false
    });
    assert.equal(progress.missingRequiredCount, 2);
    assert.equal(progress.criticalCount, 1);
    assert.equal(progress.contradictionCount, 2);
    assert.equal(progress.confidence, 0.75);
    assert.equal(progress.validated, false);
  });

  it('handles empty or null summary', () => {
    const progress = summarizeRoundProgress({});
    assert.equal(progress.missingRequiredCount, 0);
    assert.equal(progress.criticalCount, 0);
    assert.equal(progress.contradictionCount, 0);
    assert.equal(progress.confidence, 0);
    assert.equal(progress.validated, false);
  });

  it('handles null input', () => {
    const progress = summarizeRoundProgress(null);
    assert.equal(progress.missingRequiredCount, 0);
    assert.equal(progress.validated, false);
  });

  it('detects validated state', () => {
    const progress = summarizeRoundProgress({
      validated: true,
      confidence: 0.95,
      missing_required_fields: [],
      critical_fields_below_pass_target: []
    });
    assert.equal(progress.validated, true);
    assert.equal(progress.confidence, 0.95);
  });
});

describe('buildNeedSetDispatch', () => {
  it('extracts target fields from NeedSet needs sorted by score', () => {
    const needSet = {
      needs: [
        { field_key: 'sensor_model', need_score: 8.0, reasons: ['missing'], required_level: 'required' },
        { field_key: 'weight', need_score: 4.0, reasons: ['low_conf'], required_level: 'required' },
        { field_key: 'cable_type', need_score: 1.0, reasons: ['low_conf'], required_level: 'optional' }
      ]
    };
    const dispatch = buildNeedSetDispatch({ needSet });
    assert.ok(dispatch.llmTargetFields.includes('sensor_model'));
    assert.ok(dispatch.llmTargetFields.includes('weight'));
    assert.ok(dispatch.llmTargetFields.length >= 2);
  });

  it('generates doc_hint queries for tier deficits', () => {
    const needSet = {
      needs: [
        { field_key: 'sensor_model', need_score: 8.0, reasons: ['missing', 'tier_pref_unmet'], required_level: 'required' }
      ]
    };
    const dispatch = buildNeedSetDispatch({
      needSet,
      identityLock: { brand: 'Razer', model: 'Viper V3 Pro' }
    });
    assert.ok(dispatch.extraQueries.length > 0);
    assert.ok(dispatch.extraQueries.some((q) => {
      const text = typeof q === 'object' ? q.query : q;
      return text.includes('spec') || text.includes('manual') || text.includes('datasheet');
    }));
  });

  it('generates teardown/review queries for conflicts', () => {
    const needSet = {
      needs: [
        { field_key: 'click_latency', need_score: 6.0, reasons: ['conflict'], required_level: 'critical' }
      ]
    };
    const dispatch = buildNeedSetDispatch({
      needSet,
      identityLock: { brand: 'Razer', model: 'Viper V3 Pro' }
    });
    assert.ok(dispatch.extraQueries.length > 0);
    assert.ok(dispatch.extraQueries.some((q) => {
      const text = typeof q === 'object' ? q.query : q;
      return text.includes('review') || text.includes('teardown') || text.includes('test');
    }));
  });

  it('respects max query budget', () => {
    const needs = Array.from({ length: 50 }, (_, i) => ({
      field_key: `field_${i}`,
      need_score: 10 - i * 0.1,
      reasons: ['missing', 'tier_pref_unmet'],
      required_level: 'required'
    }));
    const dispatch = buildNeedSetDispatch({
      needSet: { needs },
      identityLock: { brand: 'Test', model: 'Product' },
      maxQueries: 15
    });
    assert.ok(dispatch.extraQueries.length <= 15);
  });

  it('returns empty dispatch for empty NeedSet', () => {
    const dispatch = buildNeedSetDispatch({ needSet: { needs: [] } });
    assert.deepEqual(dispatch.llmTargetFields, []);
    assert.deepEqual(dispatch.extraQueries, []);
    assert.deepEqual(dispatch.escalatedFields, []);
  });

  it('marks fields as escalated when they persist from previous round', () => {
    const needSet = {
      needs: [
        { field_key: 'weight', need_score: 4.0, reasons: ['low_conf'], required_level: 'required' }
      ]
    };
    const dispatch = buildNeedSetDispatch({
      needSet,
      previousTargetFields: ['weight']
    });
    assert.ok(dispatch.escalatedFields.includes('weight'));
  });

  it('includes target_fields in extraQueries for tier deficit fields', () => {
    const needSet = {
      needs: [
        { field_key: 'sensor_model', need_score: 8.0, reasons: ['missing', 'tier_pref_unmet'], required_level: 'required' },
        { field_key: 'dpi', need_score: 6.0, reasons: ['tier_pref_unmet'], required_level: 'required' }
      ]
    };
    const dispatch = buildNeedSetDispatch({
      needSet,
      identityLock: { brand: 'Razer', model: 'Viper V3 Pro' }
    });
    assert.ok(dispatch.extraQueries.length > 0);
    const structured = dispatch.extraQueries.find((q) => typeof q === 'object' && q.query);
    assert.ok(structured, 'extraQueries should contain structured objects with query and target_fields');
    assert.ok(Array.isArray(structured.target_fields));
    const specQuery = dispatch.extraQueries.find((q) => q.query && q.query.includes('specification'));
    if (specQuery) {
      assert.ok(specQuery.target_fields.length > 0, 'field-specific queries should have target_fields');
    }
  });
});

describe('runConvergenceLoop', () => {
  function makeMockRunProduct(roundResults) {
    let callIndex = 0;
    return async ({ roundContext }) => {
      const result = roundResults[callIndex] || roundResults[roundResults.length - 1];
      callIndex += 1;
      return {
        runId: `run-${roundContext.round}`,
        summary: result
      };
    };
  }

  function makeMockNeedSet(roundNeedSets) {
    let callIndex = 0;
    return (args) => {
      const result = roundNeedSets[callIndex] || roundNeedSets[roundNeedSets.length - 1];
      callIndex += 1;
      return result;
    };
  }

  it('executes round 0 with round=0 in context', async () => {
    let capturedContexts = [];
    const mockRunProduct = async ({ roundContext }) => {
      capturedContexts.push(roundContext);
      return {
        runId: 'run-0',
        summary: { validated: true, missing_required_fields: [], critical_fields_below_pass_target: [], confidence: 0.95 }
      };
    };

    await runConvergenceLoop({
      runProductFn: mockRunProduct,
      computeNeedSetFn: () => ({ needs: [] }),
      storage: {},
      config: {},
      s3Key: 'test.json',
      job: { category: 'mouse', productId: 'test-product', identityLock: {} },
      maxRounds: 4,
      mode: 'balanced'
    });

    assert.equal(capturedContexts[0].round, 0);
    assert.equal(capturedContexts[0].mode, 'balanced');
  });

  it('stops after round 0 when product is validated', async () => {
    const result = await runConvergenceLoop({
      runProductFn: makeMockRunProduct([
        { validated: true, missing_required_fields: [], critical_fields_below_pass_target: [], confidence: 0.95 }
      ]),
      computeNeedSetFn: () => ({ needs: [] }),
      storage: {},
      config: {},
      s3Key: 'test.json',
      job: { category: 'mouse', productId: 'test', identityLock: {} },
      maxRounds: 4,
      mode: 'balanced'
    });

    assert.equal(result.round_count, 1);
    assert.equal(result.complete, true);
    assert.equal(result.stop_reason, 'complete');
  });

  it('continues to round 1 when round 0 has missing fields', async () => {
    let roundsSeen = [];
    const mockRunProduct = async ({ roundContext }) => {
      roundsSeen.push(roundContext.round);
      if (roundContext.round === 0) {
        return {
          runId: 'run-0',
          summary: {
            validated: false,
            missing_required_fields: ['weight', 'sensor_model'],
            critical_fields_below_pass_target: ['dpi'],
            confidence: 0.6
          }
        };
      }
      return {
        runId: 'run-1',
        summary: {
          validated: true,
          missing_required_fields: [],
          critical_fields_below_pass_target: [],
          confidence: 0.95
        }
      };
    };

    const result = await runConvergenceLoop({
      runProductFn: mockRunProduct,
      computeNeedSetFn: () => ({
        needs: [
          { field_key: 'weight', need_score: 4, reasons: ['missing'], required_level: 'required' },
          { field_key: 'sensor_model', need_score: 8, reasons: ['missing'], required_level: 'required' }
        ]
      }),
      storage: {},
      config: {},
      s3Key: 'test.json',
      job: { category: 'mouse', productId: 'test', identityLock: { brand: 'Razer', model: 'Test' } },
      maxRounds: 4,
      mode: 'balanced'
    });

    assert.ok(roundsSeen.includes(0));
    assert.ok(roundsSeen.includes(1));
    assert.equal(result.round_count, 2);
    assert.equal(result.complete, true);
  });

  it('stops at max_rounds', async () => {
    const result = await runConvergenceLoop({
      runProductFn: makeMockRunProduct([
        { validated: false, missing_required_fields: ['weight'], critical_fields_below_pass_target: [], confidence: 0.6 }
      ]),
      computeNeedSetFn: () => ({
        needs: [{ field_key: 'weight', need_score: 4, reasons: ['missing'], required_level: 'required' }]
      }),
      storage: {},
      config: {},
      s3Key: 'test.json',
      job: { category: 'mouse', productId: 'test', identityLock: {} },
      maxRounds: 3,
      mode: 'balanced'
    });

    assert.equal(result.round_count, 3);
    assert.equal(result.complete, false);
    assert.equal(result.stop_reason, 'max_rounds_reached');
  });

  it('stops on no_progress streak', async () => {
    const staleResult = {
      validated: false,
      missing_required_fields: ['weight'],
      critical_fields_below_pass_target: [],
      constraint_analysis: { contradiction_count: 0 },
      confidence: 0.6,
      sources_identity_matched: 1
    };

    const result = await runConvergenceLoop({
      runProductFn: makeMockRunProduct([staleResult]),
      computeNeedSetFn: () => ({
        needs: [{ field_key: 'weight', need_score: 4, reasons: ['missing'], required_level: 'required' }]
      }),
      storage: {},
      config: {},
      s3Key: 'test.json',
      job: { category: 'mouse', productId: 'test', identityLock: {} },
      maxRounds: 10,
      mode: 'balanced'
    });

    assert.equal(result.complete, false);
    assert.ok(result.stop_reason.includes('no_progress'));
    assert.ok(result.round_count < 10);
  });

  it('stops on repeated low quality rounds', async () => {
    let callIndex = 0;
    const mockRunProduct = async ({ roundContext }) => {
      const idx = callIndex;
      callIndex += 1;
      return {
        runId: `run-${roundContext.round}`,
        summary: {
          validated: false,
          missing_required_fields: ['weight'],
          critical_fields_below_pass_target: [],
          confidence: 0.05 + idx * 0.02,
          sources_identity_matched: 0
        }
      };
    };

    const result = await runConvergenceLoop({
      runProductFn: mockRunProduct,
      computeNeedSetFn: () => ({
        needs: [{ field_key: 'weight', need_score: 4, reasons: ['missing'], required_level: 'required' }]
      }),
      storage: {},
      config: {},
      s3Key: 'test.json',
      job: { category: 'mouse', productId: 'test', identityLock: {} },
      maxRounds: 10,
      mode: 'balanced'
    });

    assert.equal(result.complete, false);
    assert.equal(result.stop_reason, 'repeated_low_quality');
    assert.ok(result.round_count <= 5);
  });

  it('passes NeedSet-derived target fields to subsequent rounds', async () => {
    let capturedContexts = [];
    const mockRunProduct = async ({ roundContext }) => {
      capturedContexts.push(roundContext);
      if (roundContext.round === 0) {
        return {
          runId: 'run-0',
          summary: {
            validated: false,
            missing_required_fields: ['sensor_model'],
            critical_fields_below_pass_target: [],
            confidence: 0.7
          }
        };
      }
      return {
        runId: 'run-1',
        summary: {
          validated: true,
          missing_required_fields: [],
          critical_fields_below_pass_target: [],
          confidence: 0.95
        }
      };
    };

    await runConvergenceLoop({
      runProductFn: mockRunProduct,
      computeNeedSetFn: () => ({
        needs: [
          { field_key: 'sensor_model', need_score: 8, reasons: ['missing', 'tier_pref_unmet'], required_level: 'required' }
        ]
      }),
      storage: {},
      config: {},
      s3Key: 'test.json',
      job: { category: 'mouse', productId: 'test', identityLock: { brand: 'Razer', model: 'Viper' } },
      maxRounds: 4,
      mode: 'balanced'
    });

    assert.ok(capturedContexts.length >= 2);
    const round1Context = capturedContexts[1];
    assert.ok(round1Context.llm_target_fields.includes('sensor_model'));
  });

  it('returns rounds array with per-round metadata', async () => {
    const result = await runConvergenceLoop({
      runProductFn: makeMockRunProduct([
        { validated: false, missing_required_fields: ['weight'], critical_fields_below_pass_target: [], confidence: 0.6 },
        { validated: true, missing_required_fields: [], critical_fields_below_pass_target: [], confidence: 0.95 }
      ]),
      computeNeedSetFn: () => ({
        needs: [{ field_key: 'weight', need_score: 4, reasons: ['missing'], required_level: 'required' }]
      }),
      storage: {},
      config: {},
      s3Key: 'test.json',
      job: { category: 'mouse', productId: 'test', identityLock: {} },
      maxRounds: 4,
      mode: 'balanced'
    });

    assert.ok(Array.isArray(result.rounds));
    assert.ok(result.rounds.length >= 1);
    const round0 = result.rounds[0];
    assert.equal(round0.round, 0);
    assert.ok('missing_required_count' in round0);
    assert.ok('confidence' in round0);
    assert.ok('improved' in round0);
  });

  it('returns final_summary from the last round', async () => {
    const finalSummary = {
      validated: true,
      missing_required_fields: [],
      critical_fields_below_pass_target: [],
      confidence: 0.98
    };

    const result = await runConvergenceLoop({
      runProductFn: makeMockRunProduct([finalSummary]),
      computeNeedSetFn: () => ({ needs: [] }),
      storage: {},
      config: {},
      s3Key: 'test.json',
      job: { category: 'mouse', productId: 'test', identityLock: {} },
      maxRounds: 4,
      mode: 'balanced'
    });

    assert.deepEqual(result.final_summary, finalSummary);
  });

  it('propagates mode to all round contexts', async () => {
    let capturedModes = [];
    const mockRunProduct = async ({ roundContext }) => {
      capturedModes.push(roundContext.mode);
      return {
        runId: `run-${roundContext.round}`,
        summary: { validated: true, missing_required_fields: [], critical_fields_below_pass_target: [], confidence: 0.95 }
      };
    };

    await runConvergenceLoop({
      runProductFn: mockRunProduct,
      computeNeedSetFn: () => ({ needs: [] }),
      storage: {},
      config: {},
      s3Key: 'test.json',
      job: { category: 'mouse', productId: 'test', identityLock: {} },
      maxRounds: 4,
      mode: 'aggressive'
    });

    assert.ok(capturedModes.every((m) => m === 'aggressive'));
  });

  it('emits round_started and round_completed events when logger is provided', async () => {
    const events = [];
    const mockLogger = {
      info: (event, data) => events.push({ event, ...data })
    };

    await runConvergenceLoop({
      runProductFn: makeMockRunProduct([
        { validated: false, missing_required_fields: ['weight'], critical_fields_below_pass_target: [], confidence: 0.6 },
        { validated: true, missing_required_fields: [], critical_fields_below_pass_target: [], confidence: 0.95 }
      ]),
      computeNeedSetFn: () => ({
        needs: [{ field_key: 'weight', need_score: 4, reasons: ['missing'], required_level: 'required' }]
      }),
      storage: {},
      config: {},
      s3Key: 'test.json',
      job: { category: 'mouse', productId: 'test', identityLock: {} },
      maxRounds: 4,
      mode: 'balanced',
      logger: mockLogger
    });

    const roundStarted = events.filter((e) => e.event === 'convergence_round_started');
    const roundCompleted = events.filter((e) => e.event === 'convergence_round_completed');
    assert.ok(roundStarted.length >= 1);
    assert.ok(roundCompleted.length >= 1);
    assert.equal(roundStarted[0].round, 0);
    assert.ok('needset_size' in roundCompleted[0]);
    assert.ok('confidence' in roundCompleted[0]);
  });

  it('emits convergence_stop event with stop reason', async () => {
    const events = [];
    const mockLogger = {
      info: (event, data) => events.push({ event, ...data })
    };

    await runConvergenceLoop({
      runProductFn: makeMockRunProduct([
        { validated: true, missing_required_fields: [], critical_fields_below_pass_target: [], confidence: 0.95 }
      ]),
      computeNeedSetFn: () => ({ needs: [] }),
      storage: {},
      config: {},
      s3Key: 'test.json',
      job: { category: 'mouse', productId: 'test', identityLock: {} },
      maxRounds: 4,
      mode: 'balanced',
      logger: mockLogger
    });

    const stopEvents = events.filter((e) => e.event === 'convergence_stop');
    assert.equal(stopEvents.length, 1);
    assert.equal(stopEvents[0].stop_reason, 'complete');
    assert.ok('round_count' in stopEvents[0]);
  });

  it('does not fail when no logger is provided', async () => {
    const result = await runConvergenceLoop({
      runProductFn: makeMockRunProduct([
        { validated: true, missing_required_fields: [], critical_fields_below_pass_target: [], confidence: 0.95 }
      ]),
      computeNeedSetFn: () => ({ needs: [] }),
      storage: {},
      config: {},
      s3Key: 'test.json',
      job: { category: 'mouse', productId: 'test', identityLock: {} },
      maxRounds: 4,
      mode: 'balanced'
    });
    assert.equal(result.complete, true);
  });

  it('respects config.convergenceNoProgressLimit override', async () => {
    const staleResult = {
      validated: false,
      missing_required_fields: ['weight'],
      critical_fields_below_pass_target: [],
      constraint_analysis: { contradiction_count: 0 },
      confidence: 0.6
    };

    const result = await runConvergenceLoop({
      runProductFn: makeMockRunProduct([staleResult]),
      computeNeedSetFn: () => ({
        needs: [{ field_key: 'weight', need_score: 4, reasons: ['missing'], required_level: 'required' }]
      }),
      storage: {},
      config: { convergenceNoProgressLimit: 1 },
      s3Key: 'test.json',
      job: { category: 'mouse', productId: 'test', identityLock: {} },
      maxRounds: 10,
      mode: 'balanced'
    });

    assert.equal(result.complete, false);
    assert.ok(result.stop_reason.includes('no_progress'));
    assert.equal(result.round_count, 2, 'noProgressLimit=1 should stop after round 0 (ok) + round 1 (streak=1)');
  });

  it('respects config.convergenceMaxDispatchQueries override', async () => {
    let capturedExtraQueryCounts = [];
    const mockRunProduct = async ({ roundContext }) => {
      capturedExtraQueryCounts.push(roundContext.extra_queries.length);
      if (roundContext.round === 0) {
        return {
          runId: 'run-0',
          summary: {
            validated: false,
            missing_required_fields: Array.from({ length: 20 }, (_, i) => `field_${i}`),
            critical_fields_below_pass_target: [],
            confidence: 0.5
          }
        };
      }
      return {
        runId: 'run-1',
        summary: { validated: true, missing_required_fields: [], critical_fields_below_pass_target: [], confidence: 0.95 }
      };
    };

    const manyNeeds = Array.from({ length: 30 }, (_, i) => ({
      field_key: `field_${i}`,
      need_score: 10 - i * 0.1,
      reasons: ['missing', 'tier_pref_unmet'],
      required_level: 'required'
    }));

    await runConvergenceLoop({
      runProductFn: mockRunProduct,
      computeNeedSetFn: () => ({ needs: manyNeeds }),
      storage: {},
      config: { convergenceMaxDispatchQueries: 5 },
      s3Key: 'test.json',
      job: { category: 'mouse', productId: 'test', identityLock: { brand: 'Test', model: 'Product' } },
      maxRounds: 4,
      mode: 'balanced'
    });

    assert.ok(capturedExtraQueryCounts.length >= 2);
    assert.ok(capturedExtraQueryCounts[1] <= 5);
  });

  it('respects config.convergenceLowQualityConfidence override', async () => {
    let callIndex = 0;
    const mockRunProduct = async ({ roundContext }) => {
      const idx = callIndex;
      callIndex += 1;
      return {
        runId: `run-${roundContext.round}`,
        summary: {
          validated: false,
          missing_required_fields: ['weight'],
          critical_fields_below_pass_target: [],
          confidence: 0.3 + idx * 0.02,
          sources_identity_matched: 1
        }
      };
    };

    const result = await runConvergenceLoop({
      runProductFn: mockRunProduct,
      computeNeedSetFn: () => ({
        needs: [{ field_key: 'weight', need_score: 4, reasons: ['missing'], required_level: 'required' }]
      }),
      storage: {},
      config: { convergenceLowQualityConfidence: 0.5, convergenceMaxLowQualityRounds: 2 },
      s3Key: 'test.json',
      job: { category: 'mouse', productId: 'test', identityLock: {} },
      maxRounds: 10,
      mode: 'balanced'
    });

    assert.equal(result.complete, false);
    assert.equal(result.stop_reason, 'repeated_low_quality');
  });

  it('respects config.convergenceMaxLowQualityRounds override', async () => {
    let callIndex = 0;
    const mockRunProduct = async ({ roundContext }) => {
      const idx = callIndex;
      callIndex += 1;
      return {
        runId: `run-${roundContext.round}`,
        summary: {
          validated: false,
          missing_required_fields: ['weight'],
          critical_fields_below_pass_target: [],
          confidence: 0.05 + idx * 0.02,
          sources_identity_matched: 0
        }
      };
    };

    const result = await runConvergenceLoop({
      runProductFn: mockRunProduct,
      computeNeedSetFn: () => ({
        needs: [{ field_key: 'weight', need_score: 4, reasons: ['missing'], required_level: 'required' }]
      }),
      storage: {},
      config: { convergenceMaxLowQualityRounds: 1 },
      s3Key: 'test.json',
      job: { category: 'mouse', productId: 'test', identityLock: {} },
      maxRounds: 10,
      mode: 'balanced'
    });

    assert.equal(result.complete, false);
    assert.equal(result.stop_reason, 'repeated_low_quality');
    assert.ok(result.round_count <= 2);
  });

  it('computeNeedSet caps confidence with identityCaps override', () => {
    const result = computeNeedSet({
      fieldOrder: ['weight'],
      provenance: {
        weight: {
          value: '75g',
          confidence: 0.9,
          pass_target: 0.8,
          meets_pass_target: false,
          evidence: [{ url: 'https://a.com', tier: 2, quote: 'weighs 75g', snippet_id: 'sn1' }]
        }
      },
      fieldRules: { weight: { required_level: 'required' } },
      identityContext: { status: 'provisional', confidence: 0.91 },
      identityCaps: { provisional: 0.5 }
    });
    const weightRow = result.needs.find((n) => n.field_key === 'weight');
    assert.ok(weightRow, 'weight should appear in needset when capped below pass target');
    assert.ok(weightRow.effective_confidence <= 0.5, 'effective_confidence should be capped at 0.5');
  });

  it('computeNeedSet uses default caps when identityCaps not provided (regression)', () => {
    const result = computeNeedSet({
      fieldOrder: ['weight'],
      provenance: {
        weight: {
          value: '75g',
          confidence: 0.9,
          pass_target: 0.8,
          meets_pass_target: false,
          evidence: [{ url: 'https://a.com', tier: 2, quote: 'weighs 75g', snippet_id: 'sn1' }]
        }
      },
      fieldRules: { weight: { required_level: 'required' } },
      identityContext: { status: 'provisional', confidence: 0.91 }
    });
    const weightRow = result.needs.find((n) => n.field_key === 'weight');
    if (weightRow) {
      assert.ok(weightRow.effective_confidence <= 0.74, 'default provisional cap is 0.74');
    }
  });

  it('deduplicates queries across rounds', async () => {
    let capturedContexts = [];
    const mockRunProduct = async ({ roundContext }) => {
      capturedContexts.push(roundContext);
      if (roundContext.round < 2) {
        return {
          runId: `run-${roundContext.round}`,
          summary: {
            validated: false,
            missing_required_fields: ['weight'],
            critical_fields_below_pass_target: [],
            confidence: 0.5 + roundContext.round * 0.1,
            sources_identity_matched: 1,
            provenance: {},
            fieldRules: { weight: { required_level: 'required' } },
            fieldOrder: ['weight']
          }
        };
      }
      return {
        runId: 'run-2',
        summary: { validated: true, missing_required_fields: [], critical_fields_below_pass_target: [], confidence: 0.95 }
      };
    };

    await runConvergenceLoop({
      runProductFn: mockRunProduct,
      computeNeedSetFn: () => ({
        needs: [
          { field_key: 'weight', need_score: 8, reasons: ['missing', 'tier_pref_unmet'], required_level: 'required' }
        ]
      }),
      storage: {},
      config: {},
      s3Key: 'test.json',
      job: { category: 'mouse', productId: 'test', identityLock: { brand: 'Razer', model: 'Viper V3 Pro' } },
      maxRounds: 4,
      mode: 'balanced'
    });

    assert.ok(capturedContexts.length >= 3);
    const round1Queries = capturedContexts[1].extra_queries.map((q) => (typeof q === 'object' ? q.query : q).toLowerCase());
    const round2Queries = capturedContexts[2].extra_queries.map((q) => (typeof q === 'object' ? q.query : q).toLowerCase());
    const overlap = round2Queries.filter((q) => round1Queries.includes(q));
    assert.equal(overlap.length, 0, 'round 2 should not contain queries from round 1');
  });

  it('logs queries_deduped_count in convergence_round_started event', async () => {
    const events = [];
    const mockLogger = {
      info: (event, data) => events.push({ event, ...data })
    };

    const mockRunProduct = async ({ roundContext }) => {
      if (roundContext.round === 0) {
        return {
          runId: 'run-0',
          summary: {
            validated: false,
            missing_required_fields: ['weight'],
            critical_fields_below_pass_target: [],
            confidence: 0.5,
            sources_identity_matched: 1,
            provenance: {},
            fieldRules: { weight: { required_level: 'required' } },
            fieldOrder: ['weight']
          }
        };
      }
      return {
        runId: 'run-1',
        summary: { validated: true, missing_required_fields: [], critical_fields_below_pass_target: [], confidence: 0.95 }
      };
    };

    await runConvergenceLoop({
      runProductFn: mockRunProduct,
      computeNeedSetFn: () => ({
        needs: [
          { field_key: 'weight', need_score: 8, reasons: ['missing', 'tier_pref_unmet'], required_level: 'required' }
        ]
      }),
      storage: {},
      config: {},
      s3Key: 'test.json',
      job: { category: 'mouse', productId: 'test', identityLock: { brand: 'Razer', model: 'Viper V3 Pro' } },
      maxRounds: 4,
      mode: 'balanced',
      logger: mockLogger
    });

    const roundStartedEvents = events.filter((e) => e.event === 'convergence_round_started' && e.round > 0);
    assert.ok(roundStartedEvents.length >= 1);
    assert.ok('queries_deduped_count' in roundStartedEvents[0], 'should include queries_deduped_count');
  });

  it('does not filter unique queries across rounds', async () => {
    let capturedContexts = [];
    let callIndex = 0;
    const mockRunProduct = async ({ roundContext }) => {
      capturedContexts.push(roundContext);
      const idx = callIndex;
      callIndex += 1;
      if (idx < 2) {
        return {
          runId: `run-${roundContext.round}`,
          summary: {
            validated: false,
            missing_required_fields: idx === 0 ? ['weight'] : ['sensor_model'],
            critical_fields_below_pass_target: [],
            confidence: 0.5 + idx * 0.1,
            sources_identity_matched: 1,
            provenance: {},
            fieldRules: {
              weight: { required_level: 'required' },
              sensor_model: { required_level: 'required' }
            },
            fieldOrder: ['weight', 'sensor_model']
          }
        };
      }
      return {
        runId: 'run-2',
        summary: { validated: true, missing_required_fields: [], critical_fields_below_pass_target: [], confidence: 0.95 }
      };
    };

    let needCallIndex = 0;
    const computeNeedSetFn = () => {
      const idx = needCallIndex;
      needCallIndex += 1;
      if (idx === 0) {
        return {
          needs: [
            { field_key: 'weight', need_score: 8, reasons: ['missing', 'tier_pref_unmet'], required_level: 'required' }
          ]
        };
      }
      return {
        needs: [
          { field_key: 'sensor_model', need_score: 8, reasons: ['missing', 'tier_pref_unmet'], required_level: 'required' }
        ]
      };
    };

    await runConvergenceLoop({
      runProductFn: mockRunProduct,
      computeNeedSetFn,
      storage: {},
      config: {},
      s3Key: 'test.json',
      job: { category: 'mouse', productId: 'test', identityLock: { brand: 'Razer', model: 'Viper V3 Pro' } },
      maxRounds: 4,
      mode: 'balanced'
    });

    assert.ok(capturedContexts.length >= 3);
    const round2Queries = capturedContexts[2].extra_queries;
    assert.ok(round2Queries.length > 0, 'unique queries from round 2 should not be filtered');
  });

  it('respects config.convergenceMaxRounds as default when maxRounds not specified', async () => {
    const result = await runConvergenceLoop({
      runProductFn: makeMockRunProduct([
        { validated: false, missing_required_fields: ['weight'], critical_fields_below_pass_target: [], confidence: 0.6, sources_identity_matched: 5 }
      ]),
      computeNeedSetFn: () => ({
        needs: [{ field_key: 'weight', need_score: 4, reasons: ['missing'], required_level: 'required' }]
      }),
      storage: {},
      config: { convergenceMaxRounds: 2, convergenceNoProgressLimit: 10 },
      s3Key: 'test.json',
      job: { category: 'mouse', productId: 'test', identityLock: {} },
      mode: 'balanced'
    });

    assert.equal(result.round_count, 2);
    assert.equal(result.stop_reason, 'max_rounds_reached');
  });

  it('reads provenance from roundResult top-level, not summary', async () => {
    let capturedNeedSetArgs = [];
    const mockRunProduct = async ({ roundContext }) => {
      if (roundContext.round === 0) {
        return {
          runId: 'run-0',
          provenance: {
            weight: { value: '75g', confidence: 0.4, pass_target: 0.8, meets_pass_target: false, evidence: [] }
          },
          summary: {
            validated: false,
            missing_required_fields: ['weight'],
            critical_fields_below_pass_target: [],
            confidence: 0.5,
            field_reasoning: { weight: 'extracted from spec sheet' },
            sources_identity_matched: 1
          }
        };
      }
      return {
        runId: 'run-1',
        provenance: {},
        summary: { validated: true, missing_required_fields: [], critical_fields_below_pass_target: [], confidence: 0.95 }
      };
    };

    const mockNeedSet = (args) => {
      capturedNeedSetArgs.push(args);
      return {
        needs: [{ field_key: 'weight', need_score: 6, reasons: ['low_conf'], required_level: 'required' }]
      };
    };

    await runConvergenceLoop({
      runProductFn: mockRunProduct,
      computeNeedSetFn: mockNeedSet,
      storage: {},
      config: {},
      s3Key: 'test.json',
      job: {
        category: 'mouse',
        productId: 'test',
        identityLock: { brand: 'Test', model: 'Mouse' },
        fieldRules: { weight: { required_level: 'required' } },
        fieldOrder: ['weight']
      },
      maxRounds: 4,
      mode: 'balanced'
    });

    assert.ok(capturedNeedSetArgs.length >= 1, 'computeNeedSet should be called for round 1+');
    const round1Args = capturedNeedSetArgs[0];
    assert.ok(round1Args.provenance.weight, 'provenance.weight should be passed from roundResult top-level');
    assert.equal(round1Args.provenance.weight.value, '75g');
    assert.equal(round1Args.fieldReasoning.weight, 'extracted from spec sheet');
    assert.deepEqual(round1Args.fieldOrder, ['weight']);
    assert.ok(round1Args.fieldRules.weight, 'fieldRules should fall back to job.fieldRules');
  });

  it('exposes final_result in convergence loop return', async () => {
    const result = await runConvergenceLoop({
      runProductFn: async ({ roundContext }) => ({
        runId: 'run-0',
        productId: 'test-product',
        exportInfo: { runBase: '/out/run-0', latestBase: '/out/latest' },
        summary: { validated: true, missing_required_fields: [], critical_fields_below_pass_target: [], confidence: 0.95 }
      }),
      computeNeedSetFn: () => ({ needs: [] }),
      storage: {},
      config: {},
      s3Key: 'test.json',
      job: { category: 'mouse', productId: 'test', identityLock: {} },
      maxRounds: 4,
      mode: 'balanced'
    });

    assert.ok(result.final_result, 'should expose final_result');
    assert.equal(result.final_result.runId, 'run-0');
    assert.equal(result.final_result.productId, 'test-product');
    assert.ok(result.final_result.exportInfo);
  });

  it('works with bridgeAsLogger adapter', async () => {
    const receivedEvents = [];
    const mockBridge = {
      runId: 'run-0',
      onRuntimeEvent(row) {
        receivedEvents.push(row);
      }
    };

    const { bridgeAsLogger } = await import('../src/pipeline/runOrchestrator.js');
    const logger = bridgeAsLogger(mockBridge);

    await runConvergenceLoop({
      runProductFn: async () => ({
        runId: 'run-0',
        summary: { validated: true, missing_required_fields: [], critical_fields_below_pass_target: [], confidence: 0.95 }
      }),
      computeNeedSetFn: () => ({ needs: [] }),
      storage: {},
      config: {},
      s3Key: 'test.json',
      job: { category: 'mouse', productId: 'test', identityLock: {} },
      maxRounds: 4,
      mode: 'balanced',
      logger
    });

    const roundStarted = receivedEvents.filter((e) => e.event === 'convergence_round_started');
    const stopEvents = receivedEvents.filter((e) => e.event === 'convergence_stop');
    assert.ok(roundStarted.length >= 1, 'bridgeAsLogger should forward convergence_round_started');
    assert.ok(stopEvents.length === 1, 'bridgeAsLogger should forward convergence_stop');
    assert.ok(stopEvents[0].ts, 'events should include ts');
    assert.ok(stopEvents[0].runId, 'events should include runId from bridge');
  });

  it('bridgeAsLogger injects runId into all convergence events', async () => {
    const receivedEvents = [];
    const mockBridge = {
      runId: 'existing-run-id',
      onRuntimeEvent(row) {
        receivedEvents.push(row);
      }
    };

    const { bridgeAsLogger } = await import('../src/pipeline/runOrchestrator.js');
    const logger = bridgeAsLogger(mockBridge);

    logger.info('convergence_round_started', { round: 0, mode: 'balanced' });
    logger.info('convergence_round_completed', { round: 0, run_id: 'run-0' });
    logger.info('convergence_stop', { stop_reason: 'complete', round_count: 1 });

    assert.equal(receivedEvents.length, 3);
    assert.equal(receivedEvents[0].runId, 'existing-run-id', 'round_started should get bridge runId');
    assert.equal(receivedEvents[2].runId, 'existing-run-id', 'convergence_stop should get bridge runId');
  });

  it('runtimeBridge accepts multi-round convergence events', async () => {
    const os = await import('node:os');
    const path = await import('node:path');
    const fs = await import('node:fs/promises');
    const { IndexLabRuntimeBridge } = await import('../src/indexlab/runtimeBridge.js');
    const { bridgeAsLogger } = await import('../src/pipeline/runOrchestrator.js');

    const tmpDir = path.join(os.tmpdir(), `indexlab-test-${Date.now()}`);

    const bridge = new IndexLabRuntimeBridge({ outRoot: tmpDir, context: { category: 'mouse' } });

    bridge.onRuntimeEvent({
      event: 'run_started',
      runId: 'round0-run',
      ts: new Date().toISOString(),
      category: 'mouse',
      productId: 'test-product'
    });

    await bridge.queue;

    const logger = bridgeAsLogger(bridge);

    logger.info('convergence_round_started', { round: 0, mode: 'balanced', needset_size: 0 });
    logger.info('convergence_round_completed', {
      round: 0, run_id: 'round0-run', needset_size: 5,
      missing_required_count: 2, critical_count: 0,
      confidence: 0.6, validated: false, improved: true,
      improvement_reasons: ['first_round'], no_progress_streak: 0, low_quality_rounds: 0
    });
    logger.info('convergence_stop', { stop_reason: 'complete', round_count: 1, complete: true, final_confidence: 0.95 });

    await bridge.queue;

    const eventsRaw = await fs.readFile(path.join(tmpDir, 'round0-run', 'run_events.ndjson'), 'utf8');
    const events = eventsRaw.trim().split('\n').map(JSON.parse);

    const convergenceEvents = events.filter((e) =>
      e.event === 'convergence_round_started'
      || e.event === 'convergence_round_completed'
      || e.event === 'convergence_stop'
    );

    assert.ok(convergenceEvents.length >= 3, `expected 3 convergence events, got ${convergenceEvents.length}: ${convergenceEvents.map(e => e.event).join(', ')}`);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('runtimeBridge accepts events from multiple runProduct rounds', async () => {
    const os = await import('node:os');
    const path = await import('node:path');
    const fs = await import('node:fs/promises');
    const { IndexLabRuntimeBridge } = await import('../src/indexlab/runtimeBridge.js');

    const tmpDir = path.join(os.tmpdir(), `indexlab-multiround-${Date.now()}`);
    const bridge = new IndexLabRuntimeBridge({ outRoot: tmpDir, context: { category: 'mouse' } });

    bridge.onRuntimeEvent({
      event: 'run_started', runId: 'round0-run', ts: new Date().toISOString(),
      category: 'mouse', productId: 'test-product'
    });
    await bridge.queue;

    bridge.onRuntimeEvent({
      event: 'run_started', runId: 'round1-run', ts: new Date().toISOString(),
      category: 'mouse', productId: 'test-product'
    });
    bridge.onRuntimeEvent({
      event: 'source_processed', runId: 'round1-run', ts: new Date().toISOString(),
      url: 'https://example.com/round1'
    });
    await bridge.queue;

    const eventsRaw = await fs.readFile(path.join(tmpDir, 'round0-run', 'run_events.ndjson'), 'utf8');
    const events = eventsRaw.trim().split('\n').map(JSON.parse);

    const round1Events = events.filter((e) => {
      const payload = e.payload || {};
      return payload.url === 'https://example.com/round1'
        || (e.event === 'run_started' && events.filter(x => x.event === 'run_started').length > 1);
    });

    assert.ok(round1Events.length >= 1, `round 1 events should be written to bridge (got ${round1Events.length})`);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
