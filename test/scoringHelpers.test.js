import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PASS_TARGET_EXEMPT_FIELDS,
  markSatisfiedLlmFields,
  refreshFieldsBelowPassTarget,
  isAnchorLocked,
  resolveTargets,
  resolveLlmTargetFields
} from '../src/pipeline/helpers/scoringHelpers.js';

// --- PASS_TARGET_EXEMPT_FIELDS ---

test('PASS_TARGET_EXEMPT_FIELDS contains expected identity fields', () => {
  assert.ok(PASS_TARGET_EXEMPT_FIELDS.has('id'));
  assert.ok(PASS_TARGET_EXEMPT_FIELDS.has('brand'));
  assert.ok(PASS_TARGET_EXEMPT_FIELDS.has('model'));
  assert.ok(PASS_TARGET_EXEMPT_FIELDS.has('base_model'));
  assert.ok(PASS_TARGET_EXEMPT_FIELDS.has('category'));
  assert.ok(PASS_TARGET_EXEMPT_FIELDS.has('sku'));
  assert.ok(!PASS_TARGET_EXEMPT_FIELDS.has('weight'));
});

// --- isAnchorLocked ---

test('isAnchorLocked returns true when anchor has value', () => {
  assert.equal(isAnchorLocked('sensor', { sensor: 'PAW3950' }), true);
});

test('isAnchorLocked returns false for empty or missing anchor', () => {
  assert.equal(isAnchorLocked('sensor', { sensor: '' }), false);
  assert.equal(isAnchorLocked('sensor', {}), false);
  assert.equal(isAnchorLocked('sensor', null), false);
});

test('isAnchorLocked returns false for whitespace-only anchor', () => {
  assert.equal(isAnchorLocked('sensor', { sensor: '   ' }), false);
});

// --- markSatisfiedLlmFields ---

test('markSatisfiedLlmFields adds non-identity non-anchor fields to set', () => {
  const fieldSet = new Set();
  markSatisfiedLlmFields(fieldSet, ['weight', 'dpi', 'sensor'], {});
  assert.ok(fieldSet.has('weight'));
  assert.ok(fieldSet.has('dpi'));
  assert.ok(fieldSet.has('sensor'));
});

test('markSatisfiedLlmFields skips identity-locked fields', () => {
  const fieldSet = new Set();
  markSatisfiedLlmFields(fieldSet, ['brand', 'model', 'weight'], {});
  assert.ok(!fieldSet.has('brand'));
  assert.ok(!fieldSet.has('model'));
  assert.ok(fieldSet.has('weight'));
});

test('markSatisfiedLlmFields skips anchor-locked fields', () => {
  const fieldSet = new Set();
  markSatisfiedLlmFields(fieldSet, ['sensor', 'weight'], { sensor: 'PAW3950' });
  assert.ok(!fieldSet.has('sensor'));
  assert.ok(fieldSet.has('weight'));
});

test('markSatisfiedLlmFields ignores non-Set input', () => {
  markSatisfiedLlmFields(null, ['weight']);
  markSatisfiedLlmFields('not-a-set', ['weight']);
});

test('markSatisfiedLlmFields skips empty field tokens', () => {
  const fieldSet = new Set();
  markSatisfiedLlmFields(fieldSet, ['', '  ', null, 'dpi'], {});
  assert.equal(fieldSet.size, 1);
  assert.ok(fieldSet.has('dpi'));
});

// --- refreshFieldsBelowPassTarget ---

test('refreshFieldsBelowPassTarget finds fields below pass target', () => {
  const result = refreshFieldsBelowPassTarget({
    fieldOrder: ['sensor', 'weight', 'dpi'],
    provenance: {
      sensor: { pass_target: 2, meets_pass_target: false },
      weight: { pass_target: 1, meets_pass_target: true },
      dpi: { pass_target: 1, meets_pass_target: false }
    },
    criticalFieldSet: new Set(['sensor'])
  });
  assert.deepEqual(result.fieldsBelowPassTarget, ['sensor', 'dpi']);
  assert.deepEqual(result.criticalFieldsBelowPassTarget, ['sensor']);
});

test('refreshFieldsBelowPassTarget skips exempt fields', () => {
  const result = refreshFieldsBelowPassTarget({
    fieldOrder: ['brand', 'model', 'weight'],
    provenance: {
      brand: { pass_target: 1, meets_pass_target: false },
      model: { pass_target: 1, meets_pass_target: false },
      weight: { pass_target: 1, meets_pass_target: false }
    }
  });
  assert.deepEqual(result.fieldsBelowPassTarget, ['weight']);
});

test('refreshFieldsBelowPassTarget skips fields with pass_target 0', () => {
  const result = refreshFieldsBelowPassTarget({
    fieldOrder: ['sensor'],
    provenance: { sensor: { pass_target: 0, meets_pass_target: false } }
  });
  assert.deepEqual(result.fieldsBelowPassTarget, []);
});

test('refreshFieldsBelowPassTarget handles empty input', () => {
  const result = refreshFieldsBelowPassTarget({});
  assert.deepEqual(result.fieldsBelowPassTarget, []);
  assert.deepEqual(result.criticalFieldsBelowPassTarget, []);
});

// --- resolveTargets ---

test('resolveTargets uses job requirements when available', () => {
  const result = resolveTargets(
    { requirements: { targetCompleteness: 0.95, targetConfidence: 0.85 } },
    { schema: { targets: { targetCompleteness: 0.9, targetConfidence: 0.8 } } }
  );
  assert.equal(result.targetCompleteness, 0.95);
  assert.equal(result.targetConfidence, 0.85);
});

test('resolveTargets falls back to category config', () => {
  const result = resolveTargets(
    { requirements: {} },
    { schema: { targets: { targetCompleteness: 0.92, targetConfidence: 0.82 } } }
  );
  assert.equal(result.targetCompleteness, 0.92);
  assert.equal(result.targetConfidence, 0.82);
});

test('resolveTargets uses defaults when neither source available', () => {
  const result = resolveTargets(
    { requirements: {} },
    { schema: { targets: {} } }
  );
  assert.equal(result.targetCompleteness, 0.9);
  assert.equal(result.targetConfidence, 0.8);
});

// --- resolveLlmTargetFields ---

test('resolveLlmTargetFields merges requirements and category fields', () => {
  const result = resolveLlmTargetFields(
    { requirements: { llmTargetFields: ['sensor'], requiredFields: ['weight'] } },
    { requiredFields: ['dpi'], schema: { critical_fields: ['brand'] }, fieldOrder: ['brand', 'sensor', 'weight', 'dpi'] }
  );
  assert.ok(result.includes('sensor'));
  assert.ok(result.includes('weight'));
  assert.ok(result.includes('dpi'));
  assert.ok(result.includes('brand'));
});

test('resolveLlmTargetFields deduplicates fields', () => {
  const result = resolveLlmTargetFields(
    { requirements: { llmTargetFields: ['sensor', 'weight'], requiredFields: ['sensor'] } },
    { requiredFields: ['sensor'], schema: { critical_fields: [] }, fieldOrder: ['sensor', 'weight'] }
  );
  const sensorCount = result.filter((f) => f === 'sensor').length;
  assert.equal(sensorCount, 1);
});

test('resolveLlmTargetFields handles empty requirements', () => {
  const result = resolveLlmTargetFields(
    { requirements: {} },
    { requiredFields: ['sensor'], schema: { critical_fields: ['brand'] }, fieldOrder: ['brand', 'sensor'] }
  );
  assert.ok(result.includes('sensor'));
  assert.ok(result.includes('brand'));
});
