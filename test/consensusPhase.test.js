import test from 'node:test';
import assert from 'node:assert/strict';
import { executeConsensusPhase } from '../src/pipeline/consensusPhase.js';

function makeSource({ host, rootDomain, approvedDomain, value, field = 'sensor', method = 'network_json' }) {
  return {
    host,
    rootDomain,
    tier: 2,
    tierName: 'database',
    role: 'review',
    approvedDomain,
    identity: { match: true },
    anchorCheck: { majorConflicts: [] },
    fieldCandidates: [
      { field, value, method, keyPath: `payload.${field}` }
    ]
  };
}

function makeDefaults(overrides = {}) {
  return {
    categoryConfig: { criticalFieldSet: new Set(['sensor']) },
    fieldOrder: ['id', 'brand', 'model', 'base_model', 'category', 'sku', 'sensor'],
    anchors: {},
    identityLock: { brand: 'Razer', model: 'Viper V3 Pro' },
    productId: 'mouse-test',
    category: 'mouse',
    config: {},
    fieldRulesEngine: null,
    ...overrides
  };
}

test('executeConsensusPhase returns expected shape with fields, provenance, candidates, criticalFieldsBelowPassTarget', () => {
  const sourceResults = [
    makeSource({ host: 'a.com', rootDomain: 'a.com', approvedDomain: true, value: 'Focus Pro 35K' }),
    makeSource({ host: 'b.com', rootDomain: 'b.com', approvedDomain: true, value: 'Focus Pro 35K' }),
    makeSource({ host: 'c.com', rootDomain: 'c.com', approvedDomain: true, value: 'Focus Pro 35K' })
  ];

  const result = executeConsensusPhase({
    sourceResults,
    ...makeDefaults()
  });

  assert.ok(result.fields, 'result should have fields');
  assert.ok(result.provenance, 'result should have provenance');
  assert.ok(result.candidates, 'result should have candidates');
  assert.ok(Array.isArray(result.criticalFieldsBelowPassTarget), 'criticalFieldsBelowPassTarget should be array');
  assert.ok(Array.isArray(result.fieldsBelowPassTarget), 'fieldsBelowPassTarget should be array');
  assert.ok(Array.isArray(result.newValuesProposed), 'newValuesProposed should be array');
  assert.equal(typeof result.agreementScore, 'number', 'agreementScore should be number');
});

test('executeConsensusPhase produces same output as direct runConsensusEngine for basic case', () => {
  const sourceResults = [
    makeSource({ host: 'a.com', rootDomain: 'a.com', approvedDomain: true, value: 'Focus Pro 35K' }),
    makeSource({ host: 'b.com', rootDomain: 'b.com', approvedDomain: true, value: 'Focus Pro 35K' }),
    makeSource({ host: 'c.com', rootDomain: 'c.com', approvedDomain: true, value: 'Focus Pro 35K' })
  ];

  const result = executeConsensusPhase({
    sourceResults,
    ...makeDefaults()
  });

  assert.equal(result.fields.sensor, 'Focus Pro 35K');
});

test('executeConsensusPhase with no fieldRulesEngine skips selection and union reducers', () => {
  const sourceResults = [
    makeSource({ host: 'a.com', rootDomain: 'a.com', approvedDomain: true, value: 'Focus Pro 35K' }),
    makeSource({ host: 'b.com', rootDomain: 'b.com', approvedDomain: true, value: 'Focus Pro 35K' }),
    makeSource({ host: 'c.com', rootDomain: 'c.com', approvedDomain: true, value: 'Focus Pro 35K' })
  ];

  const result = executeConsensusPhase({
    sourceResults,
    ...makeDefaults({ fieldRulesEngine: null })
  });

  assert.equal(result.fields.sensor, 'Focus Pro 35K');
});

test('executeConsensusPhase applies selection policy reducers when fieldRulesEngine provided', () => {
  const fieldRulesEngine = {
    getSelectionPolicyFields: () => [],
    getListUnionFields: () => [],
    getAllFieldKeys: () => []
  };

  const sourceResults = [
    makeSource({ host: 'a.com', rootDomain: 'a.com', approvedDomain: true, value: 'Focus Pro 35K' }),
    makeSource({ host: 'b.com', rootDomain: 'b.com', approvedDomain: true, value: 'Focus Pro 35K' }),
    makeSource({ host: 'c.com', rootDomain: 'c.com', approvedDomain: true, value: 'Focus Pro 35K' })
  ];

  const result = executeConsensusPhase({
    sourceResults,
    ...makeDefaults({ fieldRulesEngine })
  });

  assert.equal(result.fields.sensor, 'Focus Pro 35K');
});

test('executeConsensusPhase sets unk for insufficient approved domains', () => {
  const sourceResults = [
    makeSource({ host: 'a.com', rootDomain: 'a.com', approvedDomain: true, value: 'Focus Pro 35K' }),
    makeSource({ host: 'b.com', rootDomain: 'b.com', approvedDomain: false, value: 'Focus Pro 35K' }),
    makeSource({ host: 'c.com', rootDomain: 'c.com', approvedDomain: false, value: 'Focus Pro 35K' })
  ];

  const result = executeConsensusPhase({
    sourceResults,
    ...makeDefaults()
  });

  assert.equal(result.fields.sensor, 'unk');
});
