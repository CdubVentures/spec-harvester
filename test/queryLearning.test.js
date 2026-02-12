import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultQueryLearning, updateQueryLearning } from '../src/learning/queryLearning.js';

test('updateQueryLearning normalizes required-field paths to raw non-identity keys', () => {
  const artifact = defaultQueryLearning();
  const next = updateQueryLearning({
    artifact,
    summary: {
      validated: false,
      confidence: 0.72,
      missing_required_fields: ['fields.weight', 'identity.brand'],
      critical_fields_below_pass_target: ['fields.dpi']
    },
    job: {
      identityLock: {
        brand: 'Logitech'
      },
      requirements: {
        llmTargetFields: ['fields.polling_rate', 'identity.model']
      }
    },
    discoveryResult: {
      queries: ['logitech g pro x superlight 2 weight specification'],
      candidates: [{ provider: 'google', url: 'https://example.com/specs' }]
    },
    seenAt: '2026-02-10T00:00:00.000Z'
  });

  assert.ok(next.templates_by_field.weight);
  assert.ok(next.templates_by_field.dpi);
  assert.ok(next.templates_by_field.polling_rate);
  assert.equal(Object.prototype.hasOwnProperty.call(next.templates_by_field, 'brand'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(next.templates_by_field, 'model'), false);
});
