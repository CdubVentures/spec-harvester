import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrafficLight } from '../src/validator/trafficLight.js';

test('buildTrafficLight maps tiers and unknowns to expected colors', () => {
  const traffic = buildTrafficLight({
    fieldOrder: ['weight', 'dpi', 'battery_hours'],
    provenance: {
      weight: {
        value: '60',
        confidence: 0.97,
        evidence: [
          {
            tier: 1,
            tierName: 'manufacturer',
            method: 'dom',
            url: 'https://logitechg.com/specs'
          }
        ]
      },
      dpi: {
        value: '32000',
        confidence: 0.9,
        evidence: [
          {
            tier: 2,
            tierName: 'lab',
            method: 'dom',
            url: 'https://rtings.com/review'
          }
        ]
      },
      battery_hours: {
        value: 'unk',
        confidence: 0.1,
        evidence: []
      }
    },
    fieldReasoning: {
      battery_hours: {
        unknown_reason: 'not_publicly_disclosed'
      }
    }
  });

  assert.equal(traffic.by_field.weight.color, 'green');
  assert.equal(traffic.by_field.dpi.color, 'yellow');
  assert.equal(traffic.by_field.battery_hours.color, 'red');
  assert.equal(traffic.by_field.battery_hours.reason, 'not_publicly_disclosed');
  assert.equal(traffic.counts.green, 1);
  assert.equal(traffic.counts.yellow, 1);
  assert.equal(traffic.counts.red, 1);
});
