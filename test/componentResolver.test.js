import test from 'node:test';
import assert from 'node:assert/strict';
import { ComponentResolver } from '../src/extract/componentResolver.js';

function buildEngineStub() {
  return {
    getAllRules() {
      return {
        sensor: { component_db_ref: 'sensors' },
        dpi: {},
        ips: {}
      };
    },
    fuzzyMatchComponent(dbName, query) {
      if (dbName !== 'sensors' || String(query).toLowerCase() !== 'paw3395') {
        return { match: null, score: 0 };
      }
      return {
        match: {
          canonical_name: 'PAW3395',
          properties: {
            max_dpi: 26000,
            max_ips: 650
          }
        },
        score: 0.98
      };
    }
  };
}

test('ComponentResolver infers related fields from matched component DB entity', () => {
  const resolver = new ComponentResolver(buildEngineStub());
  const rows = resolver.resolveFromCandidates([
    {
      field: 'sensor',
      value: 'PAW3395',
      method: 'spec_table_match',
      keyPath: 'table.sensor',
      evidenceRefs: ['s1']
    }
  ]);

  const byField = new Map(rows.map((row) => [row.field, row]));
  assert.equal(byField.get('sensor')?.value, 'PAW3395');
  assert.equal(byField.get('dpi')?.value, '26000');
  assert.equal(byField.get('ips')?.value, '650');
  assert.equal(byField.get('dpi')?.method, 'component_db_inference');
  assert.deepEqual(byField.get('dpi')?.evidenceRefs, ['s1']);
  assert.equal(byField.get('ips')?.keyPath, 'component_db.sensors.max_ips');
});

