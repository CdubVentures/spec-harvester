import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCortexTaskPlan,
  shouldEscalateToDeep
} from '../src/llm/cortex_router.js';

test('shouldEscalateToDeep defaults to false for healthy non-conflict context', () => {
  const decision = shouldEscalateToDeep({
    context: {
      confidence: 0.95,
      critical_conflicts_remain: false,
      critical_gaps_remain: false,
      evidence_audit_failed_on_critical: false
    },
    config: {}
  });
  assert.equal(decision.escalate, false);
});

test('buildCortexTaskPlan keeps default pass on fast tier and sends vision to deep tier', () => {
  const plan = buildCortexTaskPlan({
    tasks: [
      { id: 'audit-1', type: 'evidence_audit', critical: true },
      { id: 'vision-1', type: 'vision_extract', critical: true }
    ],
    context: {
      confidence: 0.96,
      critical_conflicts_remain: false,
      critical_gaps_remain: false
    },
    config: {
      cortexModelFast: 'gpt-5-low',
      cortexModelVision: 'gpt-5-high',
      cortexModelReasoningDeep: 'gpt-5-high'
    }
  });

  const fast = plan.assignments.find((row) => row.id === 'audit-1');
  const deep = plan.assignments.find((row) => row.id === 'vision-1');
  assert.equal(fast.model, 'gpt-5-low');
  assert.equal(fast.tier, 'fast');
  assert.equal(deep.model, 'gpt-5-high');
  assert.equal(deep.tier, 'deep');
  assert.equal(deep.transport, 'async');
});

test('buildCortexTaskPlan escalates deep work on critical conflicts and caps deep task volume', () => {
  const plan = buildCortexTaskPlan({
    tasks: [
      { id: 'conflict-1', type: 'conflict_resolution', critical: true },
      { id: 'conflict-2', type: 'conflict_resolution', critical: true },
      { id: 'conflict-3', type: 'conflict_resolution', critical: true }
    ],
    context: {
      confidence: 0.7,
      critical_conflicts_remain: true,
      critical_gaps_remain: false
    },
    config: {
      cortexEscalateConfidenceLt: 0.85,
      cortexEscalateIfConflict: true,
      cortexEscalateCriticalOnly: true,
      cortexMaxDeepFieldsPerProduct: 2,
      cortexModelFast: 'gpt-5-low',
      cortexModelReasoningDeep: 'gpt-5-high'
    }
  });

  assert.equal(plan.deep_task_count, 2);
  assert.equal(plan.deep_task_ids.includes('conflict-3'), false);
  assert.equal(plan.escalated, true);
});

test('buildCortexTaskPlan does not escalate non-critical tasks when critical-only mode is enabled', () => {
  const plan = buildCortexTaskPlan({
    tasks: [
      { id: 'triage-1', type: 'conflict_resolution', critical: false }
    ],
    context: {
      confidence: 0.72,
      critical_conflicts_remain: false,
      critical_gaps_remain: false
    },
    config: {
      cortexEscalateConfidenceLt: 0.85,
      cortexEscalateCriticalOnly: true,
      cortexModelFast: 'gpt-5-low',
      cortexModelReasoningDeep: 'gpt-5-high'
    }
  });

  const triage = plan.assignments[0];
  assert.equal(triage.model, 'gpt-5-low');
  assert.equal(triage.tier, 'fast');
  assert.equal(plan.deep_task_count, 0);
});
