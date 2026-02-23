import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCompoundRange, evaluateCompoundRange } from '../src/engine/compoundBoundary.js';
import { confidenceColor } from '../src/review/confidenceColor.js';
import { evaluateConstraintGraph } from '../src/scoring/constraintSolver.js';

describe('computeCompoundRange', () => {
  test('both field-rule range + component bound → effective range is intersection', () => {
    const result = computeCompoundRange({ ruleMin: 100, ruleMax: 50000, componentMin: null, componentMax: 26000 });
    assert.equal(result.min, 100);
    assert.equal(result.max, 26000);
    assert.deepEqual(result.sources, ['field_rule', 'component_db']);
  });

  test('only field-rule range → passes through unchanged', () => {
    const result = computeCompoundRange({ ruleMin: 100, ruleMax: 50000, componentMin: null, componentMax: null });
    assert.equal(result.min, 100);
    assert.equal(result.max, 50000);
    assert.deepEqual(result.sources, ['field_rule']);
  });

  test('only component bound → passes through unchanged', () => {
    const result = computeCompoundRange({ ruleMin: null, ruleMax: null, componentMin: null, componentMax: 26000 });
    assert.equal(result.min, null);
    assert.equal(result.max, 26000);
    assert.deepEqual(result.sources, ['component_db']);
  });

  test('neither → all nulls', () => {
    const result = computeCompoundRange({ ruleMin: null, ruleMax: null, componentMin: null, componentMax: null });
    assert.equal(result.min, null);
    assert.equal(result.max, null);
    assert.deepEqual(result.sources, []);
  });

  test('component provides lower bound → effective min is tighter', () => {
    const result = computeCompoundRange({ ruleMin: 50, ruleMax: 30000, componentMin: 200, componentMax: null });
    assert.equal(result.min, 200);
    assert.equal(result.max, 30000);
    assert.deepEqual(result.sources, ['field_rule', 'component_db']);
  });

  test('component provides both min and max (range policy) → full intersection', () => {
    const result = computeCompoundRange({ ruleMin: 100, ruleMax: 50000, componentMin: 400, componentMax: 26000 });
    assert.equal(result.min, 400);
    assert.equal(result.max, 26000);
    assert.deepEqual(result.sources, ['field_rule', 'component_db']);
  });
});

describe('evaluateCompoundRange', () => {
  test('value within compound range → ok: true', () => {
    const range = computeCompoundRange({ ruleMin: 100, ruleMax: 50000, componentMin: null, componentMax: 26000 });
    const result = evaluateCompoundRange(25000, range);
    assert.equal(result.ok, true);
  });

  test('value exceeds compound max → compound_range_conflict', () => {
    const range = computeCompoundRange({ ruleMin: 100, ruleMax: 50000, componentMin: null, componentMax: 26000 });
    const result = evaluateCompoundRange(28000, range);
    assert.equal(result.ok, false);
    assert.equal(result.reason_code, 'compound_range_conflict');
    assert.equal(result.effective_max, 26000);
    assert.equal(result.actual, 28000);
    assert.equal(result.violated_bound, 'max');
    assert.deepEqual(result.sources, ['field_rule', 'component_db']);
  });

  test('value below compound min → compound_range_conflict', () => {
    const range = computeCompoundRange({ ruleMin: 100, ruleMax: 50000, componentMin: 400, componentMax: 26000 });
    const result = evaluateCompoundRange(200, range);
    assert.equal(result.ok, false);
    assert.equal(result.reason_code, 'compound_range_conflict');
    assert.equal(result.effective_min, 400);
    assert.equal(result.actual, 200);
    assert.equal(result.violated_bound, 'min');
  });

  test('value exceeds single-source max (field rule only) → out_of_range, NOT compound', () => {
    const range = computeCompoundRange({ ruleMin: 100, ruleMax: 50000, componentMin: null, componentMax: null });
    const result = evaluateCompoundRange(60000, range);
    assert.equal(result.ok, false);
    assert.equal(result.reason_code, 'out_of_range');
    assert.deepEqual(result.sources, ['field_rule']);
  });
});

describe('propagation: confidenceColor', () => {
  test('compound_range_conflict forces red even with high confidence', () => {
    assert.equal(confidenceColor(0.95, ['compound_range_conflict']), 'red');
  });

  test('constraint_conflict still forces red (no regression)', () => {
    assert.equal(confidenceColor(0.95, ['constraint_conflict']), 'red');
  });
});

describe('propagation: constraintSolver', () => {
  test('evaluateConstraintGraph emits compound contradictions from crossValidationFailures', () => {
    const result = evaluateConstraintGraph({
      fields: { dpi: 28000, sensor: 'PAW3395' },
      crossValidationFailures: [
        {
          field_key: 'dpi',
          reason_code: 'compound_range_conflict',
          effective_min: 100,
          effective_max: 26000,
          actual: 28000,
          sources: ['field_rule', 'component_db']
        }
      ]
    });
    const compound = result.contradictions.find(c => c.code === 'compound_range_conflict');
    assert.ok(compound, 'should have compound_range_conflict contradiction');
    assert.equal(compound.severity, 'error');
    assert.deepEqual(compound.fields, ['dpi']);
  });

  test('evaluateConstraintGraph without crossValidationFailures still works (no regression)', () => {
    const result = evaluateConstraintGraph({
      fields: { dpi: 26000, sensor: 'PAW3395', connection: 'wireless' }
    });
    assert.equal(typeof result.contradiction_count, 'number');
    assert.ok(Array.isArray(result.contradictions));
  });
});
