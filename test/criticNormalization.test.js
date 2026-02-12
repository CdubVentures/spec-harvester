import test from 'node:test';
import assert from 'node:assert/strict';
import { runDeterministicCritic } from '../src/validator/critic.js';

test('deterministic critic converts common units to canonical schema units', () => {
  const normalized = {
    fields: {
      weight: '0.061 kg',
      width: '2.48 in',
      height: '11.8 cm',
      dpi: '26k'
    }
  };
  const provenance = {};
  runDeterministicCritic({
    normalized,
    provenance,
    fieldReasoning: {},
    categoryConfig: {
      fieldOrder: ['weight', 'width', 'height', 'dpi']
    },
    constraints: {
      fields: {
        weight: { type: 'number', range: { min: 10, max: 300 } },
        width: { type: 'number', range: { min: 20, max: 200 } },
        height: { type: 'number', range: { min: 20, max: 200 } },
        dpi: { type: 'number', range: { min: 100, max: 100000 } }
      }
    }
  });

  assert.equal(normalized.fields.weight, '61');
  assert.equal(normalized.fields.width, '63');
  assert.equal(normalized.fields.height, '118');
  assert.equal(normalized.fields.dpi, '26000');
});

test('deterministic critic preserves enum-list polling_rate values without forcing scalar conversion', () => {
  const normalized = {
    fields: {
      polling_rate: '1000 500 250 125'
    }
  };
  const provenance = {};
  const decisions = runDeterministicCritic({
    normalized,
    provenance,
    fieldReasoning: {},
    categoryConfig: {
      fieldOrder: ['polling_rate']
    },
    constraints: {
      fields: {
        polling_rate: {
          type: 'list',
          enum: ['1000 500 250 125']
        }
      }
    }
  });

  const rejected = (decisions.reject || []).find((row) => row.field === 'polling_rate');
  assert.equal(Boolean(rejected), false);
  assert.equal(normalized.fields.polling_rate, '1000 500 250 125');
});

test('deterministic critic canonicalizes component-like fields from helper component alias map', () => {
  const normalized = {
    fields: {
      sensor: 'pixart paw 3395'
    }
  };
  const provenance = {};
  runDeterministicCritic({
    normalized,
    provenance,
    fieldReasoning: {},
    categoryConfig: {
      fieldOrder: ['sensor'],
      helperContract: {
        components: {
          alias_map: {
            sensor: ['PixArt PAW3395']
          }
        }
      }
    },
    constraints: {
      fields: {
        sensor: { type: 'string' }
      }
    }
  });

  assert.equal(normalized.fields.sensor, 'PixArt PAW3395');
});

test('deterministic critic handles decimal-comma dimensions and converts inches to mm', () => {
  const normalized = {
    fields: {
      width: '3,75 in'
    }
  };
  const provenance = {};
  runDeterministicCritic({
    normalized,
    provenance,
    fieldReasoning: {},
    categoryConfig: {
      fieldOrder: ['width']
    },
    constraints: {
      fields: {
        width: { type: 'number', range: { min: 20, max: 200 } }
      }
    }
  });

  assert.equal(normalized.fields.width, '95');
});

test('deterministic critic rejects implausible width values as out_of_range', () => {
  const normalized = {
    fields: {
      width: '375 mm'
    }
  };
  const provenance = {};
  const decisions = runDeterministicCritic({
    normalized,
    provenance,
    fieldReasoning: {},
    categoryConfig: {
      fieldOrder: ['width']
    },
    constraints: {
      fields: {
        width: { type: 'number', range: { min: 20, max: 200 } }
      }
    }
  });

  assert.equal(normalized.fields.width, 'unk');
  const reject = (decisions.reject || []).find((row) => row.field === 'width');
  assert.equal(reject?.reason, 'out_of_range');
});
