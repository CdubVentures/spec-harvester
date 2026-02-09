import test from 'node:test';
import assert from 'node:assert/strict';
import { runConsensusEngine } from '../src/scoring/consensusEngine.js';

function makeSource({ host, rootDomain, approvedDomain, value }) {
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
      { field: 'sensor', value, method: 'network_json', keyPath: 'payload.sensor' }
    ]
  };
}

test('consensus requires 3 approved domains for non-anchor fields', () => {
  const categoryConfig = {
    criticalFieldSet: new Set(['sensor'])
  };

  const fieldOrder = ['id', 'brand', 'model', 'base_model', 'category', 'sku', 'sensor'];

  const result = runConsensusEngine({
    sourceResults: [
      makeSource({ host: 'a.com', rootDomain: 'a.com', approvedDomain: true, value: 'Focus Pro 35K' }),
      makeSource({ host: 'b.com', rootDomain: 'b.com', approvedDomain: true, value: 'Focus Pro 35K' }),
      makeSource({ host: 'c.com', rootDomain: 'c.com', approvedDomain: false, value: 'Focus Pro 35K' })
    ],
    categoryConfig,
    fieldOrder,
    anchors: {},
    identityLock: { brand: 'Razer', model: 'Viper V3 Pro' },
    productId: 'mouse-a',
    category: 'mouse'
  });

  assert.equal(result.fields.sensor, 'unk');

  const result2 = runConsensusEngine({
    sourceResults: [
      makeSource({ host: 'a.com', rootDomain: 'a.com', approvedDomain: true, value: 'Focus Pro 35K' }),
      makeSource({ host: 'b.com', rootDomain: 'b.com', approvedDomain: true, value: 'Focus Pro 35K' }),
      makeSource({ host: 'd.com', rootDomain: 'd.com', approvedDomain: true, value: 'Focus Pro 35K' })
    ],
    categoryConfig,
    fieldOrder,
    anchors: {},
    identityLock: { brand: 'Razer', model: 'Viper V3 Pro' },
    productId: 'mouse-a',
    category: 'mouse'
  });

  assert.equal(result2.fields.sensor, 'Focus Pro 35K');
});
