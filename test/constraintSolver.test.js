import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateConstraintGraph } from '../src/scoring/constraintSolver.js';

test('constraint solver reports contradictions and uncertainty for inconsistent fields', () => {
  const result = evaluateConstraintGraph({
    fields: {
      connection: 'wireless',
      battery_hours: 'unk',
      bluetooth: 'yes',
      connectivity: '2.4ghz',
      sensor_brand: 'PixArt',
      sensor: 'unk',
      dpi: '120000'
    },
    provenance: {
      sensor: { confidence: 0.1, meets_pass_target: false, value: 'unk' },
      dpi: { confidence: 0.2, meets_pass_target: false, value: '120000' }
    },
    criticalFieldSet: new Set(['sensor', 'dpi'])
  });

  assert.equal(result.contradiction_count >= 3, true);
  assert.equal(result.contradictions.some((row) => row.code === 'wireless_missing_battery_hours'), true);
  assert.equal(result.contradictions.some((row) => row.code === 'sensor_brand_without_sensor'), true);
  assert.equal(result.field_uncertainty.sensor > 0.9, true);
  assert.equal(result.global_uncertainty > 0.5, true);
});

test('constraint solver keeps uncertainty bounded to [0,1]', () => {
  const result = evaluateConstraintGraph({
    fields: {
      connection: 'wired',
      battery_hours: '10',
      width: '400'
    },
    provenance: {
      width: { confidence: 0.99, meets_pass_target: true, value: '400' }
    },
    criticalFieldSet: new Set(['width'])
  });

  for (const value of Object.values(result.field_uncertainty)) {
    assert.equal(value >= 0 && value <= 1, true);
  }
  assert.equal(result.global_uncertainty >= 0 && result.global_uncertainty <= 1, true);
});
