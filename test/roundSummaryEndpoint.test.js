import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoundSummaryFromEvents } from '../src/api/roundSummary.js';

describe('buildRoundSummaryFromEvents', () => {
  it('builds round summary from convergence events', () => {
    const events = [
      { event: 'convergence_round_completed', round: 0, needset_size: 42, missing_required_count: 10, critical_count: 3, confidence: 0.55, validated: false, improved: false, improvement_reasons: [], no_progress_streak: 0, low_quality_rounds: 0 },
      { event: 'convergence_round_completed', round: 1, needset_size: 30, missing_required_count: 5, critical_count: 1, confidence: 0.78, validated: false, improved: true, improvement_reasons: ['missing_required_decreased', 'confidence_increased'], no_progress_streak: 0, low_quality_rounds: 0 },
      { event: 'convergence_stop', stop_reason: 'complete', round_count: 2, complete: true, final_confidence: 0.95, final_needset_size: 10 }
    ];
    const result = buildRoundSummaryFromEvents(events);
    assert.equal(result.round_count, 2);
    assert.equal(result.stop_reason, 'complete');
    assert.equal(result.rounds.length, 2);
    assert.equal(result.rounds[0].round, 0);
    assert.equal(result.rounds[0].needset_size, 42);
    assert.equal(result.rounds[0].confidence, 0.55);
    assert.equal(result.rounds[1].round, 1);
    assert.equal(result.rounds[1].improved, true);
    assert.deepStrictEqual(result.rounds[1].improvement_reasons, ['missing_required_decreased', 'confidence_increased']);
  });

  it('falls back to run_completed for single-pass run', () => {
    const events = [
      { event: 'needset_computed', needset_size: 25, total_fields: 60 },
      { event: 'run_completed', confidence: 0.82, validated: true, missing_required_fields: ['weight', 'sensor'], critical_fields_below_pass_target: ['dpi'] }
    ];
    const result = buildRoundSummaryFromEvents(events);
    assert.equal(result.round_count, 1);
    assert.equal(result.stop_reason, null);
    assert.equal(result.rounds.length, 1);
    assert.equal(result.rounds[0].round, 0);
    assert.equal(result.rounds[0].confidence, 0.82);
    assert.equal(result.rounds[0].validated, true);
    assert.equal(result.rounds[0].needset_size, 25);
    assert.equal(result.rounds[0].missing_required_count, 2);
    assert.equal(result.rounds[0].critical_count, 1);
  });

  it('returns empty result for empty events', () => {
    const result = buildRoundSummaryFromEvents([]);
    assert.equal(result.round_count, 0);
    assert.equal(result.stop_reason, null);
    assert.deepStrictEqual(result.rounds, []);
  });

  it('returns empty result for null events', () => {
    const result = buildRoundSummaryFromEvents(null);
    assert.equal(result.round_count, 0);
    assert.equal(result.stop_reason, null);
    assert.deepStrictEqual(result.rounds, []);
  });

  it('handles max_rounds_reached stop reason', () => {
    const events = [
      { event: 'convergence_round_completed', round: 0, needset_size: 40, missing_required_count: 8, critical_count: 2, confidence: 0.6, validated: false, improved: false, improvement_reasons: [] },
      { event: 'convergence_stop', stop_reason: 'max_rounds_reached', round_count: 1, complete: false, final_confidence: 0.6, final_needset_size: 38 }
    ];
    const result = buildRoundSummaryFromEvents(events);
    assert.equal(result.stop_reason, 'max_rounds_reached');
    assert.equal(result.round_count, 1);
  });

  it('handles no_progress stop reason', () => {
    const events = [
      { event: 'convergence_round_completed', round: 0, needset_size: 35, missing_required_count: 6, critical_count: 2, confidence: 0.5, validated: false, improved: false, improvement_reasons: [] },
      { event: 'convergence_round_completed', round: 1, needset_size: 35, missing_required_count: 6, critical_count: 2, confidence: 0.5, validated: false, improved: false, improvement_reasons: [] },
      { event: 'convergence_stop', stop_reason: 'no_progress_streak', round_count: 2, complete: false, final_confidence: 0.5, final_needset_size: 35 }
    ];
    const result = buildRoundSummaryFromEvents(events);
    assert.equal(result.stop_reason, 'no_progress_streak');
    assert.equal(result.round_count, 2);
    assert.equal(result.rounds[1].improved, false);
  });

  it('handles run_completed without needset_computed', () => {
    const events = [
      { event: 'run_completed', confidence: 0.7, validated: false, missing_required_fields: [], critical_fields_below_pass_target: [] }
    ];
    const result = buildRoundSummaryFromEvents(events);
    assert.equal(result.round_count, 1);
    assert.equal(result.rounds[0].needset_size, 0);
    assert.equal(result.rounds[0].confidence, 0.7);
  });

  it('handles NDJSON-wrapped convergence events with payload envelope', () => {
    const events = [
      { event: 'convergence_round_completed', payload: { round: 0, needset_size: 38, missing_required_count: 7, critical_count: 2, confidence: 0.62, validated: false, improved: false, improvement_reasons: [], no_progress_streak: 0, low_quality_rounds: 0 } },
      { event: 'convergence_round_completed', payload: { round: 1, needset_size: 20, missing_required_count: 3, critical_count: 0, confidence: 0.88, validated: false, improved: true, improvement_reasons: ['confidence_increased'], no_progress_streak: 0, low_quality_rounds: 0 } },
      { event: 'convergence_stop', payload: { stop_reason: 'complete', round_count: 2, complete: true, final_confidence: 0.95, final_needset_size: 8 } }
    ];
    const result = buildRoundSummaryFromEvents(events);
    assert.equal(result.round_count, 2);
    assert.equal(result.stop_reason, 'complete');
    assert.equal(result.rounds[0].needset_size, 38);
    assert.equal(result.rounds[0].confidence, 0.62);
    assert.equal(result.rounds[1].round, 1);
    assert.equal(result.rounds[1].improved, true);
    assert.deepStrictEqual(result.rounds[1].improvement_reasons, ['confidence_increased']);
  });

  it('handles wrapped run_completed fallback with payload envelope', () => {
    const events = [
      { event: 'needset_computed', payload: { needset_size: 30, total_fields: 55 } },
      { event: 'run_completed', payload: { confidence: 0.85, validated: true, missing_required_fields: ['weight'], critical_fields_below_pass_target: [] } }
    ];
    const result = buildRoundSummaryFromEvents(events);
    assert.equal(result.round_count, 1);
    assert.equal(result.rounds[0].confidence, 0.85);
    assert.equal(result.rounds[0].validated, true);
    assert.equal(result.rounds[0].needset_size, 30);
    assert.equal(result.rounds[0].missing_required_count, 1);
  });
});
