import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyIdentityGateToCandidates,
  isIdentityGatedField
} from '../src/pipeline/identityGateExtraction.js';

describe('applyIdentityGateToCandidates', () => {
  it('passes through candidates unchanged when identity matches', () => {
    const candidates = [
      { field: 'weight', value: '58g', confidence: 0.9, method: 'llm_extract' },
      { field: 'sensor', value: 'PAW3950', confidence: 0.85, method: 'html_table' }
    ];
    const identity = { match: true, score: 0.92, decision: 'ACCEPT' };

    const result = applyIdentityGateToCandidates(candidates, identity);
    assert.equal(result.length, 2);
    assert.equal(result[0].value, '58g');
    assert.equal(result[0].target_match_passed, true);
    assert.equal(result[0].target_match_score, 0.92);
    assert.equal(result[1].target_match_passed, true);
  });

  it('downgrades all candidates when identity does not match', () => {
    const candidates = [
      { field: 'weight', value: '58g', confidence: 0.9, method: 'llm_extract' },
      { field: 'dpi', value: '30000', confidence: 0.8, method: 'html_table' }
    ];
    const identity = { match: false, score: 0.35, decision: 'REJECT' };

    const result = applyIdentityGateToCandidates(candidates, identity);
    assert.equal(result.length, 2);
    assert.equal(result[0].target_match_passed, false);
    assert.equal(result[0].target_match_score, 0.35);
    assert.equal(result[0].identity_reject_reason, 'source_identity_mismatch');
    assert.ok(result[0].confidence < 0.9);
  });

  it('caps confidence at identity gate threshold when identity fails', () => {
    const candidates = [
      { field: 'weight', value: '58g', confidence: 0.95, method: 'llm_extract' }
    ];
    const identity = { match: false, score: 0.3, decision: 'REJECT' };

    const result = applyIdentityGateToCandidates(candidates, identity);
    assert.ok(result[0].confidence <= 0.3);
  });

  it('preserves original confidence in original_confidence field', () => {
    const candidates = [
      { field: 'weight', value: '58g', confidence: 0.9, method: 'llm_extract' }
    ];
    const identity = { match: false, score: 0.4, decision: 'REJECT' };

    const result = applyIdentityGateToCandidates(candidates, identity);
    assert.equal(result[0].original_confidence, 0.9);
    assert.ok(result[0].confidence < 0.9);
  });

  it('returns empty array for empty candidates', () => {
    const result = applyIdentityGateToCandidates([], { match: true, score: 0.9 });
    assert.deepEqual(result, []);
  });

  it('handles null/undefined identity gracefully', () => {
    const candidates = [
      { field: 'weight', value: '58g', confidence: 0.9, method: 'llm_extract' }
    ];
    const result = applyIdentityGateToCandidates(candidates, null);
    assert.equal(result.length, 1);
    assert.equal(result[0].target_match_passed, false);
    assert.equal(result[0].identity_reject_reason, 'no_identity_evaluation');
  });

  it('handles null/undefined candidates gracefully', () => {
    const result = applyIdentityGateToCandidates(null, { match: true, score: 0.9 });
    assert.deepEqual(result, []);
  });

  it('does not mutate original candidates', () => {
    const original = { field: 'weight', value: '58g', confidence: 0.9, method: 'llm_extract' };
    const candidates = [original];
    const identity = { match: false, score: 0.3, decision: 'REJECT' };

    applyIdentityGateToCandidates(candidates, identity);
    assert.equal(original.confidence, 0.9);
    assert.equal(original.target_match_passed, undefined);
  });

  it('applies stricter downgrade to identity-gated fields', () => {
    const candidates = [
      { field: 'brand', value: 'Razer', confidence: 0.95, method: 'html_table' },
      { field: 'weight', value: '58g', confidence: 0.95, method: 'html_table' }
    ];
    const identity = { match: false, score: 0.4, decision: 'REJECT' };

    const result = applyIdentityGateToCandidates(candidates, identity);
    const brandResult = result.find((r) => r.field === 'brand');
    const weightResult = result.find((r) => r.field === 'weight');
    assert.ok(brandResult.confidence <= weightResult.confidence);
  });
});

describe('isIdentityGatedField', () => {
  it('returns true for identity-level fields', () => {
    assert.equal(isIdentityGatedField('brand'), true);
    assert.equal(isIdentityGatedField('model'), true);
    assert.equal(isIdentityGatedField('variant'), true);
    assert.equal(isIdentityGatedField('sku'), true);
    assert.equal(isIdentityGatedField('base_model'), true);
  });

  it('returns false for regular fields', () => {
    assert.equal(isIdentityGatedField('weight'), false);
    assert.equal(isIdentityGatedField('dpi'), false);
    assert.equal(isIdentityGatedField('sensor'), false);
  });

  it('handles empty/null values', () => {
    assert.equal(isIdentityGatedField(''), false);
    assert.equal(isIdentityGatedField(null), false);
    assert.equal(isIdentityGatedField(undefined), false);
  });

  it('is case-insensitive', () => {
    assert.equal(isIdentityGatedField('Brand'), true);
    assert.equal(isIdentityGatedField('MODEL'), true);
  });
});
