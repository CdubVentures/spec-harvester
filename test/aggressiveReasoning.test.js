import test from 'node:test';
import assert from 'node:assert/strict';
import { AggressiveReasoningResolver } from '../src/extract/aggressiveReasoning.js';

test('AggressiveReasoningResolver resolves obvious winner by confidence margin', async () => {
  const resolver = new AggressiveReasoningResolver();
  const result = await resolver.resolve({
    conflictsByField: {
      weight: [
        { field: 'weight', value: '58', confidence: 0.9 },
        { field: 'weight', value: '59', confidence: 0.6 }
      ]
    },
    criticalFieldSet: new Set()
  });

  assert.equal(result.resolved_by_field.weight.value, '58');
  assert.equal(result.unresolved.length, 0);
  assert.equal(result.fast_fields.includes('weight'), true);
});

test('AggressiveReasoningResolver leaves close non-critical conflicts unresolved', async () => {
  const resolver = new AggressiveReasoningResolver();
  const result = await resolver.resolve({
    conflictsByField: {
      dpi: [
        { field: 'dpi', value: '26000', confidence: 0.72 },
        { field: 'dpi', value: '30000', confidence: 0.69 }
      ]
    },
    criticalFieldSet: new Set()
  });

  assert.equal(result.unresolved.length, 1);
  assert.equal(result.unresolved[0].field, 'dpi');
  assert.equal(result.resolved_by_field.dpi, undefined);
});

test('AggressiveReasoningResolver sends critical conflicts through deep sidecar path', async () => {
  let taskCount = 0;
  const resolver = new AggressiveReasoningResolver({
    cortexClient: {
      async runPass({ tasks }) {
        taskCount = tasks.length;
        return {
          mode: 'sidecar',
          fallback_to_non_sidecar: false,
          plan: {
            deep_task_count: tasks.length
          }
        };
      }
    }
  });
  const result = await resolver.resolve({
    conflictsByField: {
      sensor: [
        { field: 'sensor', value: 'PAW3395', confidence: 0.65 },
        { field: 'sensor', value: 'HERO 2', confidence: 0.64 }
      ]
    },
    criticalFieldSet: new Set(['sensor'])
  });

  assert.equal(taskCount, 1);
  assert.equal(result.deep_fields.includes('sensor'), true);
  assert.equal(result.sidecar.mode, 'sidecar');
});
