import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCompletenessRequired,
  computeCoverageOverall
} from '../src/scoring/qualityScoring.js';
import { evaluateValidationGate } from '../src/validator/qualityGate.js';

test('computeCompletenessRequired treats unk as missing and reports missing fields', () => {
  const normalized = {
    identity: { brand: 'Razer', model: 'Viper V3 Pro' },
    fields: {
      connection: 'wireless',
      weight: 'unk',
      sensor: 'Focus Pro 35K'
    }
  };

  const stats = computeCompletenessRequired(normalized, [
    'identity.brand',
    'identity.model',
    'fields.connection',
    'fields.weight',
    'fields.sensor'
  ]);

  assert.equal(stats.total, 5);
  assert.equal(stats.filled, 4);
  assert.equal(stats.completenessRequired, 0.8);
  assert.deepEqual(stats.missingRequiredFields, ['fields.weight']);
});

test('computeCoverageOverall excludes editorial fields and counts unknown as missing', () => {
  const stats = computeCoverageOverall({
    fields: {
      id: 'mouse-a',
      brand: 'Razer',
      cardTags: 'unk',
      featured: 'unk',
      weight: '54',
      sensor: 'unk'
    },
    fieldOrder: ['id', 'brand', 'cardTags', 'featured', 'weight', 'sensor'],
    editorialFields: ['cardTags', 'featured']
  });

  assert.equal(stats.total, 4);
  assert.equal(stats.filled, 3);
  assert.equal(stats.coverageOverall, 0.75);
});

test('evaluateValidationGate requires all strict checks', () => {
  const gate = evaluateValidationGate({
    identityGateValidated: true,
    identityConfidence: 1,
    anchorMajorConflictsCount: 0,
    completenessRequired: 0.85,
    targetCompleteness: 0.8,
    confidence: 0.7,
    targetConfidence: 0.8,
    criticalFieldsBelowPassTarget: []
  });

  assert.equal(gate.validated, false);
  assert.equal(gate.validatedReason, 'BELOW_CONFIDENCE_THRESHOLD');
});

test('evaluateValidationGate fails when identity gate is not validated', () => {
  const gate = evaluateValidationGate({
    identityGateValidated: false,
    identityConfidence: 1,
    anchorMajorConflictsCount: 0,
    completenessRequired: 1,
    targetCompleteness: 0.8,
    confidence: 0.95,
    targetConfidence: 0.8,
    criticalFieldsBelowPassTarget: []
  });

  assert.equal(gate.validated, false);
  assert.equal(gate.validatedReason, 'MODEL_AMBIGUITY_ALERT');
});
