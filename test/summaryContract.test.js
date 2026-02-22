import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateRoundSummary } from '../src/pipeline/summaryContract.js';

describe('validateRoundSummary', () => {
  it('returns valid for a fully populated summary', () => {
    const result = validateRoundSummary({
      missing_required_fields: ['weight'],
      critical_fields_below_pass_target: [],
      confidence: 0.85,
      validated: true,
      sources_identity_matched: 5,
      provenance: { weight: {} },
      fieldRules: {},
      fieldOrder: ['weight'],
      fieldReasoning: {},
      constraint_analysis: { contradiction_count: 0 },
      identityContext: {}
    });
    assert.equal(result.valid, true);
    assert.deepEqual(result.warnings, []);
  });

  it('returns valid with defaults for empty summary', () => {
    const result = validateRoundSummary({});
    assert.equal(result.valid, true);
    assert.deepEqual(result.warnings, []);
  });

  it('returns warning for missing confidence field type', () => {
    const result = validateRoundSummary({ confidence: 'bad' });
    assert.equal(result.valid, true);
    assert.ok(result.warnings.length > 0);
    assert.ok(result.warnings.some((w) => w.includes('confidence')));
  });

  it('returns warning for confidence out of range', () => {
    const result = validateRoundSummary({ confidence: 5.0 });
    assert.equal(result.valid, true);
    assert.ok(result.warnings.length > 0);
  });

  it('returns warning for wrong type on missing_required_fields', () => {
    const result = validateRoundSummary({ missing_required_fields: 'not_array' });
    assert.equal(result.valid, true);
    assert.ok(result.warnings.length > 0);
    assert.ok(result.warnings.some((w) => w.includes('missing_required_fields')));
  });

  it('returns warning for wrong type on validated', () => {
    const result = validateRoundSummary({ validated: 'yes' });
    assert.equal(result.valid, true);
    assert.ok(result.warnings.length > 0);
  });

  it('never throws for null/undefined/garbage input', () => {
    const nullResult = validateRoundSummary(null);
    assert.equal(nullResult.valid, false);
    assert.ok(nullResult.warnings.length > 0);

    const undefinedResult = validateRoundSummary(undefined);
    assert.equal(undefinedResult.valid, false);
    assert.ok(undefinedResult.warnings.length > 0);

    const numberResult = validateRoundSummary(42);
    assert.equal(numberResult.valid, false);
    assert.ok(numberResult.warnings.length > 0);

    const stringResult = validateRoundSummary('garbage');
    assert.equal(stringResult.valid, false);
    assert.ok(stringResult.warnings.length > 0);
  });

  it('returns valid for summary with only default-able fields', () => {
    const result = validateRoundSummary({ provenance: {}, fieldOrder: [] });
    assert.equal(result.valid, true);
  });
});
