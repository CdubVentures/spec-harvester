import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildFieldLabelsMap } from '../src/review/reviewGridData.js';

describe('buildFieldLabelsMap', () => {
  it('uses ui.label when present', () => {
    const config = {
      fieldOrder: ['max_acceleration', 'dpi_max'],
      fieldRules: {
        fields: {
          max_acceleration: { ui: { label: 'Max Acceleration (G)' } },
          dpi_max: { ui: { label: 'Maximum DPI' } },
        },
      },
    };
    const labels = buildFieldLabelsMap(config);
    assert.equal(labels.max_acceleration, 'Max Acceleration (G)');
    assert.equal(labels.dpi_max, 'Maximum DPI');
  });

  it('falls back to rule.label when ui.label is missing', () => {
    const config = {
      fieldOrder: ['polling_rate'],
      fieldRules: {
        fields: {
          polling_rate: { label: 'Polling Rate (Hz)' },
        },
      },
    };
    const labels = buildFieldLabelsMap(config);
    assert.equal(labels.polling_rate, 'Polling Rate (Hz)');
  });

  it('falls back to raw field key when no labels exist', () => {
    const config = {
      fieldOrder: ['weight_grams'],
      fieldRules: {
        fields: {
          weight_grams: {},
        },
      },
    };
    const labels = buildFieldLabelsMap(config);
    assert.equal(labels.weight_grams, 'weight_grams');
  });

  it('handles missing fieldRules gracefully', () => {
    const labels = buildFieldLabelsMap({});
    assert.deepEqual(labels, {});
  });

  it('handles null/undefined config gracefully', () => {
    assert.deepEqual(buildFieldLabelsMap(null), {});
    assert.deepEqual(buildFieldLabelsMap(undefined), {});
  });

  it('derives fieldOrder from fields keys when fieldOrder is absent', () => {
    const config = {
      fieldRules: {
        fields: {
          sensor: { ui: { label: 'Sensor Model' } },
          weight: { label: 'Weight' },
          length: {},
        },
      },
    };
    const labels = buildFieldLabelsMap(config);
    assert.equal(labels.sensor, 'Sensor Model');
    assert.equal(labels.weight, 'Weight');
    assert.equal(labels.length, 'length');
  });

  it('prefers ui.label over rule.label', () => {
    const config = {
      fieldOrder: ['sensor'],
      fieldRules: {
        fields: {
          sensor: { label: 'Sensor (rule)', ui: { label: 'Sensor (ui)' } },
        },
      },
    };
    const labels = buildFieldLabelsMap(config);
    assert.equal(labels.sensor, 'Sensor (ui)');
  });

  it('handles non-object field entries gracefully', () => {
    const config = {
      fieldOrder: ['bad_field', 'good_field'],
      fieldRules: {
        fields: {
          bad_field: 'not_an_object',
          good_field: { ui: { label: 'Good' } },
        },
      },
    };
    const labels = buildFieldLabelsMap(config);
    assert.equal(labels.bad_field, 'bad_field');
    assert.equal(labels.good_field, 'Good');
  });
});
