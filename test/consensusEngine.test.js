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

test('consensus can fill below pass target only with manufacturer+tier2 when enabled', () => {
  const categoryConfig = {
    criticalFieldSet: new Set(['sensor'])
  };

  const fieldOrder = ['id', 'brand', 'model', 'base_model', 'category', 'sku', 'sensor'];

  const result = runConsensusEngine({
    sourceResults: [
      {
        host: 'razer.com',
        rootDomain: 'razer.com',
        tier: 1,
        tierName: 'manufacturer',
        role: 'manufacturer',
        approvedDomain: true,
        identity: { match: true },
        anchorCheck: { majorConflicts: [] },
        fieldCandidates: [
          { field: 'sensor', value: 'Focus Pro 35K', method: 'network_json', keyPath: 'payload.sensor' }
        ]
      },
      {
        host: 'techpowerup.com',
        rootDomain: 'techpowerup.com',
        tier: 2,
        tierName: 'database',
        role: 'review',
        approvedDomain: true,
        identity: { match: true },
        anchorCheck: { majorConflicts: [] },
        fieldCandidates: [
          { field: 'sensor', value: 'Focus Pro 35K', method: 'network_json', keyPath: 'payload.sensor' }
        ]
      }
    ],
    categoryConfig,
    fieldOrder,
    anchors: {},
    identityLock: { brand: 'Razer', model: 'Viper V3 Pro' },
    productId: 'mouse-a',
    category: 'mouse',
    config: { allowBelowPassTargetFill: true }
  });

  assert.equal(result.fields.sensor, 'Focus Pro 35K');
  assert.equal(result.provenance.sensor.meets_pass_target, false);
  assert.equal(result.provenance.sensor.accepted_below_pass_target, true);
});

test('consensus never uses below-pass mode for instrumented fields', () => {
  const categoryConfig = {
    criticalFieldSet: new Set(['sensor_latency'])
  };

  const fieldOrder = ['id', 'brand', 'model', 'base_model', 'category', 'sku', 'sensor_latency'];

  const result = runConsensusEngine({
    sourceResults: [
      {
        host: 'rtings.com',
        rootDomain: 'rtings.com',
        tier: 1,
        tierName: 'lab',
        role: 'review',
        approvedDomain: true,
        identity: { match: true },
        anchorCheck: { majorConflicts: [] },
        fieldCandidates: [
          { field: 'sensor_latency', value: '1.2', method: 'instrumented_api', keyPath: 'payload.latency' }
        ]
      },
      {
        host: 'techpowerup.com',
        rootDomain: 'techpowerup.com',
        tier: 2,
        tierName: 'database',
        role: 'review',
        approvedDomain: true,
        identity: { match: true },
        anchorCheck: { majorConflicts: [] },
        fieldCandidates: [
          { field: 'sensor_latency', value: '1.2', method: 'instrumented_api', keyPath: 'payload.latency' }
        ]
      }
    ],
    categoryConfig,
    fieldOrder,
    anchors: {},
    identityLock: { brand: 'Razer', model: 'Viper V3 Pro' },
    productId: 'mouse-a',
    category: 'mouse',
    config: { allowBelowPassTargetFill: true }
  });

  assert.equal(result.fields.sensor_latency, 'unk');
});

test('consensus instrumented fields require true instrumented domains, not generic review domains', () => {
  const categoryConfig = {
    criticalFieldSet: new Set(['sensor_latency'])
  };

  const fieldOrder = ['id', 'brand', 'model', 'base_model', 'category', 'sku', 'sensor_latency'];

  const result = runConsensusEngine({
    sourceResults: [
      {
        host: 'rtings.com',
        rootDomain: 'rtings.com',
        tier: 1,
        tierName: 'lab',
        role: 'review',
        approvedDomain: true,
        identity: { match: true },
        anchorCheck: { majorConflicts: [] },
        fieldCandidates: [
          { field: 'sensor_latency', value: '1.2', method: 'instrumented_api', keyPath: 'payload.latency' }
        ]
      },
      {
        host: 'db-one.com',
        rootDomain: 'db-one.com',
        tier: 2,
        tierName: 'database',
        role: 'review',
        approvedDomain: true,
        identity: { match: true },
        anchorCheck: { majorConflicts: [] },
        fieldCandidates: [
          { field: 'sensor_latency', value: '1.2', method: 'instrumented_api', keyPath: 'payload.latency' }
        ]
      },
      {
        host: 'db-two.com',
        rootDomain: 'db-two.com',
        tier: 2,
        tierName: 'database',
        role: 'review',
        approvedDomain: true,
        identity: { match: true },
        anchorCheck: { majorConflicts: [] },
        fieldCandidates: [
          { field: 'sensor_latency', value: '1.2', method: 'instrumented_api', keyPath: 'payload.latency' }
        ]
      }
    ],
    categoryConfig,
    fieldOrder,
    anchors: {},
    identityLock: { brand: 'Razer', model: 'Viper V3 Pro' },
    productId: 'mouse-a',
    category: 'mouse',
    config: { allowBelowPassTargetFill: true }
  });

  assert.equal(result.fields.sensor_latency, 'unk');
  assert.equal(result.provenance.sensor_latency.instrumented_confirmations, 1);
});
