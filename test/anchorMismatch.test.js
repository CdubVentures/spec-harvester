import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAnchorConflicts } from '../src/validator/anchors.js';

test('evaluateAnchorConflicts flags major and minor mismatches by rules', () => {
  const anchors = {
    weight: '54',
    lngth: '127',
    sensor: 'Focus Pro 35K',
    sensor_brand: 'Razer',
    side_buttons: '2'
  };

  const candidate = {
    weight: '55',
    lngth: '129',
    sensor: 'Hero 2',
    sensor_brand: 'Logitech',
    side_buttons: '3'
  };

  const check = evaluateAnchorConflicts(anchors, candidate);
  const byField = Object.fromEntries(check.conflicts.map((c) => [c.field, c]));

  assert.equal(byField.weight.severity, 'MINOR');
  assert.equal(byField.lngth.severity, 'MAJOR');
  assert.equal(byField.sensor.severity, 'MAJOR');
  assert.equal(byField.sensor_brand.severity, 'MAJOR');
  assert.equal(byField.side_buttons.severity, 'MAJOR');
});
