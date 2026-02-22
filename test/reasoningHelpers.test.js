import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFieldReasoning, emitFieldDecisionEvents } from '../src/pipeline/helpers/reasoningHelpers.js';

test('buildFieldReasoning returns reasoning per field', () => {
  const result = buildFieldReasoning({
    fieldOrder: ['sensor', 'dpi'],
    provenance: {
      sensor: { value: 'Focus Pro', confidence: 0.95, meets_pass_target: true, approved_confirmations: 3, pass_target: 3, evidence: [] },
      dpi: { value: 'unk', confidence: 0, meets_pass_target: false, approved_confirmations: 0, pass_target: 3, evidence: [] }
    },
    fieldsBelowPassTarget: ['dpi'],
    criticalFieldsBelowPassTarget: [],
    missingRequiredFields: ['dpi'],
    constraintAnalysis: {},
    identityGateValidated: true,
    sourceResults: [],
    fieldAvailabilityModel: {},
    fieldYieldArtifact: {}
  });

  assert.equal(result.sensor.value, 'Focus Pro');
  assert.equal(result.sensor.unknown_reason, null);
  assert.equal(result.dpi.value, 'unk');
  assert.ok(result.dpi.reasons.includes('below_pass_target'));
  assert.ok(result.dpi.reasons.includes('missing_required_field'));
  assert.ok(result.dpi.unknown_reason);
});

test('buildFieldReasoning sets identity_ambiguous when gate not validated', () => {
  const result = buildFieldReasoning({
    fieldOrder: ['sensor'],
    provenance: { sensor: { value: 'unk', evidence: [] } },
    fieldsBelowPassTarget: [],
    criticalFieldsBelowPassTarget: [],
    missingRequiredFields: [],
    constraintAnalysis: {},
    identityGateValidated: false,
    sourceResults: [],
    fieldAvailabilityModel: {},
    fieldYieldArtifact: {}
  });

  assert.equal(result.sensor.unknown_reason, 'identity_ambiguous');
});

test('buildFieldReasoning sets blocked_by_robots_or_tos when 70%+ blocked', () => {
  const blockedSources = Array.from({ length: 8 }, (_, i) => ({
    status: 403,
    url: `https://blocked${i}.com`,
    finalUrl: `https://blocked${i}.com`
  }));
  const goodSources = [
    { status: 200, url: 'https://good.com', finalUrl: 'https://good.com' },
    { status: 200, url: 'https://good2.com', finalUrl: 'https://good2.com' }
  ];

  const result = buildFieldReasoning({
    fieldOrder: ['sensor'],
    provenance: { sensor: { value: 'unk', evidence: [] } },
    fieldsBelowPassTarget: [],
    criticalFieldsBelowPassTarget: [],
    missingRequiredFields: [],
    constraintAnalysis: {},
    identityGateValidated: true,
    sourceResults: [...blockedSources, ...goodSources],
    fieldAvailabilityModel: {},
    fieldYieldArtifact: {}
  });

  assert.equal(result.sensor.unknown_reason, 'blocked_by_robots_or_tos');
});

test('emitFieldDecisionEvents emits one event per field', () => {
  const events = [];
  const logger = { info: (type, data) => events.push({ type, ...data }) };

  emitFieldDecisionEvents({
    logger,
    fieldOrder: ['sensor', 'dpi'],
    normalized: { fields: { sensor: 'Focus Pro', dpi: 'unk' } },
    provenance: {
      sensor: { confidence: 0.9, evidence: [{ url: 'a' }] },
      dpi: { confidence: 0, evidence: [] }
    },
    fieldReasoning: {
      sensor: { unknown_reason: null, reasons: [] },
      dpi: { unknown_reason: 'not_found', reasons: ['missing'] }
    },
    trafficLight: { by_field: { sensor: { color: 'green' }, dpi: { color: 'red' } } }
  });

  assert.equal(events.length, 2);
  assert.equal(events[0].type, 'field_decision');
  assert.equal(events[0].field, 'sensor');
  assert.equal(events[0].decision, 'accepted');
  assert.equal(events[1].decision, 'unknown');
});
