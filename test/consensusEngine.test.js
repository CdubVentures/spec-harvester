import test from 'node:test';
import assert from 'node:assert/strict';
import { runConsensusEngine, applySelectionPolicyReducers } from '../src/scoring/consensusEngine.js';

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

test('consensus preserves snippet citation metadata from evidence refs', () => {
  const categoryConfig = {
    criticalFieldSet: new Set([])
  };
  const fieldOrder = ['id', 'brand', 'model', 'base_model', 'category', 'sku', 'dpi'];

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
        llmEvidencePack: {
          references: [
            { id: 't01', url: 'https://razer.com/specs', content: 'DPI: 32000', type: 'table' }
          ],
          snippets: [
            {
              id: 't01',
              source_id: 'razer_com',
              normalized_text: 'DPI: 32000',
              snippet_hash: 'sha256:abc123',
              retrieved_at: '2026-02-13T00:00:00.000Z',
              extraction_method: 'spec_table_match'
            }
          ]
        },
        fieldCandidates: [
          {
            field: 'dpi',
            value: '32000',
            method: 'llm_extract',
            keyPath: 'llm.extract',
            evidenceRefs: ['t01']
          }
        ]
      },
      {
        host: 'lab-a.com',
        rootDomain: 'lab-a.com',
        tier: 2,
        tierName: 'lab',
        role: 'review',
        approvedDomain: true,
        identity: { match: true },
        anchorCheck: { majorConflicts: [] },
        fieldCandidates: [
          { field: 'dpi', value: '32000', method: 'network_json', keyPath: 'payload.dpi' }
        ]
      },
      {
        host: 'lab-b.com',
        rootDomain: 'lab-b.com',
        tier: 2,
        tierName: 'lab',
        role: 'review',
        approvedDomain: true,
        identity: { match: true },
        anchorCheck: { majorConflicts: [] },
        fieldCandidates: [
          { field: 'dpi', value: '32000', method: 'network_json', keyPath: 'payload.dpi' }
        ]
      }
    ],
    categoryConfig,
    fieldOrder,
    anchors: {},
    identityLock: { brand: 'Razer', model: 'Viper V3 Pro' },
    productId: 'mouse-a',
    category: 'mouse'
  });

  assert.equal(result.fields.dpi, '32000');
  const citation = (result.provenance?.dpi?.evidence || []).find((row) => row.snippet_id === 't01');
  assert.equal(Boolean(citation), true);
  assert.equal(citation.snippet_hash, 'sha256:abc123');
  assert.equal(citation.source_id, 'razer_com');
  assert.equal(citation.extraction_method, 'spec_table_match');
});

// ===========================================================================
// selection_policy — helpers
// ===========================================================================

function mockFieldRulesEngine(fieldPolicies = {}) {
  const rules = {};
  for (const [field, policy] of Object.entries(fieldPolicies)) {
    rules[field] = typeof policy === 'string'
      ? { selection_policy: policy }
      : { selection_policy: policy };
  }
  return {
    getFieldRule(field) { return rules[field] || null; },
    getAllFieldKeys() { return Object.keys(rules); }
  };
}

/**
 * Build sources where 4 produce valueA (clear majority) and 2 produce valueB.
 * Cluster A: 4 approved tier2 network_json = score 3.2, approvedDomainCount 4
 * Cluster B: 2 approved tier2 network_json = score 1.6, approvedDomainCount 2
 * Result: Cluster A wins by majority (3.2 >= 1.6*1.1=1.76 ✓, and 4 >= 3 ✓)
 */
function makeAsymmetricSources(fieldName, valueA, valueB) {
  const domainsA = ['a.com', 'b.com', 'c.com', 'd.com'];
  const domainsB = ['e.com', 'f.com'];
  return [
    ...domainsA.map((domain) => ({
      host: domain, rootDomain: domain, tier: 2, tierName: 'database',
      role: 'review', approvedDomain: true, identity: { match: true },
      anchorCheck: { majorConflicts: [] },
      fieldCandidates: [{ field: fieldName, value: valueA, method: 'network_json', keyPath: `payload.${fieldName}` }]
    })),
    ...domainsB.map((domain) => ({
      host: domain, rootDomain: domain, tier: 2, tierName: 'database',
      role: 'review', approvedDomain: true, identity: { match: true },
      anchorCheck: { majorConflicts: [] },
      fieldCandidates: [{ field: fieldName, value: valueB, method: 'network_json', keyPath: `payload.${fieldName}` }]
    }))
  ];
}

/**
 * Build 6 sources — 3 producing valueA, 3 producing valueB — all approved,
 * tier 2, network_json.  Both clusters: approvedDomainCount=3, score=2.4.
 * With equal scores, weightedMajority fails → result is 'unk' unless a
 * policy bonus tips the scale.
 */
function makeTiedSources(fieldName, valueA, valueB, overrides = {}) {
  const domains = ['a.com', 'b.com', 'c.com', 'd.com', 'e.com', 'f.com'];
  const values  = [valueA, valueA, valueA, valueB, valueB, valueB];
  return domains.map((domain, i) => ({
    host: domain,
    rootDomain: domain,
    tier: 2,
    tierName: 'database',
    role: 'review',
    approvedDomain: true,
    identity: { match: true },
    anchorCheck: { majorConflicts: [] },
    ...(overrides.ts?.[i] ? { ts: overrides.ts[i] } : {}),
    ...(overrides.llmEvidencePacks?.[i] ? { llmEvidencePack: overrides.llmEvidencePacks[i] } : {}),
    fieldCandidates: [{
      field: fieldName,
      value: values[i],
      method: overrides.methods?.[i] || 'network_json',
      keyPath: `payload.${fieldName}`,
      ...(overrides.evidenceRefs?.[i] ? { evidenceRefs: overrides.evidenceRefs[i] } : {})
    }]
  }));
}

const CONSENSUS_BASE = {
  categoryConfig: { criticalFieldSet: new Set([]) },
  fieldOrder: ['id', 'brand', 'model', 'base_model', 'category', 'sku', 'sensor'],
  anchors: {},
  identityLock: { brand: 'Test', model: 'Widget' },
  productId: 'test-1',
  category: 'mouse'
};

// ===========================================================================
// PART 1 — selection_policy string enum
// ===========================================================================

test('selection_policy: no engine — clear winner accepted, no crash', () => {
  // 4 vs 2 sources → A wins by majority.  No engine param.
  const sources = makeAsymmetricSources('sensor', 'Focus Pro', 'Other');
  const result = runConsensusEngine({
    ...CONSENSUS_BASE,
    sourceResults: sources
  });
  assert.equal(result.fields.sensor, 'Focus Pro');
});

test('selection_policy: best_confidence with clear winner — same as default', () => {
  const engine = mockFieldRulesEngine({ sensor: 'best_confidence' });
  const sources = makeAsymmetricSources('sensor', 'Focus Pro', 'Other');
  const result = runConsensusEngine({
    ...CONSENSUS_BASE,
    sourceResults: sources,
    fieldRulesEngine: engine
  });
  assert.equal(result.fields.sensor, 'Focus Pro');
});

test('selection_policy: tied clusters without policy → unk (no majority)', () => {
  // Baseline: 3 vs 3 tied sources, no engine → unk
  const sources = makeTiedSources('sensor', 'Aaa Value', 'Zzz Value');
  const result = runConsensusEngine({
    ...CONSENSUS_BASE,
    sourceResults: sources
  });
  assert.equal(result.fields.sensor, 'unk');
});

test('selection_policy: best_evidence — policy bonus tips tied clusters, cited cluster wins', () => {
  // 3v3 tied. Without policy → unk. With best_evidence, the cluster with
  // evidence citations gets a bonus that creates weighted majority.
  const engine = mockFieldRulesEngine({ sensor: 'best_evidence' });
  const evidencePack = {
    references: [{ id: 'ref1', url: 'https://example.com', content: 'Zzz Value' }],
    snippets: [{
      id: 'ref1',
      source_id: 'example_com',
      normalized_text: 'Sensor: Zzz Value',
      snippet_hash: 'sha256:zzz'
    }]
  };
  const sources = makeTiedSources('sensor', 'Aaa Value', 'Zzz Value', {
    llmEvidencePacks: [null, null, null, evidencePack, evidencePack, evidencePack],
    evidenceRefs: [null, null, null, ['ref1'], ['ref1'], ['ref1']]
  });
  const result = runConsensusEngine({
    ...CONSENSUS_BASE,
    sourceResults: sources,
    fieldRulesEngine: engine
  });
  assert.equal(result.fields.sensor, 'Zzz Value');
});

test('selection_policy: prefer_deterministic — bonus tips tied clusters, deterministic cluster wins', () => {
  // 3v3 tied on approved score (2.4 each).
  // Cluster A ("Aaa Value") has 1 extra non-approved llm_extract evidence.
  // Cluster B ("Zzz Value") has 1 extra non-approved network_json evidence.
  // With prefer_deterministic, B gets a bigger bonus → B accepted.
  const engine = mockFieldRulesEngine({ sensor: 'prefer_deterministic' });
  const sources = makeTiedSources('sensor', 'Aaa Value', 'Zzz Value');
  sources.push({
    host: 'extra-a.com', rootDomain: 'extra-a.com', tier: 3, tierName: 'crawl',
    role: 'review', approvedDomain: false, identity: { match: true },
    anchorCheck: { majorConflicts: [] },
    fieldCandidates: [{ field: 'sensor', value: 'Aaa Value', method: 'llm_extract', keyPath: 'llm.sensor' }]
  });
  sources.push({
    host: 'extra-b.com', rootDomain: 'extra-b.com', tier: 3, tierName: 'crawl',
    role: 'review', approvedDomain: false, identity: { match: true },
    anchorCheck: { majorConflicts: [] },
    fieldCandidates: [{ field: 'sensor', value: 'Zzz Value', method: 'network_json', keyPath: 'payload.sensor' }]
  });
  const result = runConsensusEngine({
    ...CONSENSUS_BASE,
    sourceResults: sources,
    fieldRulesEngine: engine
  });
  assert.equal(result.fields.sensor, 'Zzz Value');
});

test('selection_policy: prefer_llm — bonus tips tied clusters, LLM cluster wins', () => {
  // Reverse of prefer_deterministic:
  // Cluster B ("Zzz Value") has LLM evidence → B wins with prefer_llm.
  const engine = mockFieldRulesEngine({ sensor: 'prefer_llm' });
  const sources = makeTiedSources('sensor', 'Aaa Value', 'Zzz Value');
  sources.push({
    host: 'extra-a.com', rootDomain: 'extra-a.com', tier: 3, tierName: 'crawl',
    role: 'review', approvedDomain: false, identity: { match: true },
    anchorCheck: { majorConflicts: [] },
    fieldCandidates: [{ field: 'sensor', value: 'Aaa Value', method: 'network_json', keyPath: 'payload.sensor' }]
  });
  sources.push({
    host: 'extra-b.com', rootDomain: 'extra-b.com', tier: 3, tierName: 'crawl',
    role: 'review', approvedDomain: false, identity: { match: true },
    anchorCheck: { majorConflicts: [] },
    fieldCandidates: [{ field: 'sensor', value: 'Zzz Value', method: 'llm_extract', keyPath: 'llm.sensor' }]
  });
  const result = runConsensusEngine({
    ...CONSENSUS_BASE,
    sourceResults: sources,
    fieldRulesEngine: engine
  });
  assert.equal(result.fields.sensor, 'Zzz Value');
});

test('selection_policy: prefer_latest — bonus tips tied clusters, newer cluster wins', () => {
  // 3v3 tied. Cluster A has Jan timestamps, Cluster B has Feb.
  // With prefer_latest, B gets a bonus → B accepted.
  const engine = mockFieldRulesEngine({ sensor: 'prefer_latest' });
  const sources = makeTiedSources('sensor', 'Aaa Value', 'Zzz Value', {
    ts: [
      '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', '2026-01-03T00:00:00Z',
      '2026-02-01T00:00:00Z', '2026-02-02T00:00:00Z', '2026-02-03T00:00:00Z'
    ]
  });
  const result = runConsensusEngine({
    ...CONSENSUS_BASE,
    sourceResults: sources,
    fieldRulesEngine: engine
  });
  assert.equal(result.fields.sensor, 'Zzz Value');
});

test('selection_policy: per-field — different fields use different policies', () => {
  const engine = mockFieldRulesEngine({
    sensor: 'best_evidence',
    dpi: 'prefer_latest'
  });
  const fieldOrder = ['id', 'brand', 'model', 'base_model', 'category', 'sku', 'sensor', 'dpi'];

  // Sensor: 3v3 tied. "Zzz Sensor" has citations → wins with best_evidence
  const sensorSources = makeTiedSources('sensor', 'Aaa Sensor', 'Zzz Sensor', {
    llmEvidencePacks: [null, null, null,
      { references: [{ id: 'r1', url: 'https://e.com' }], snippets: [{ id: 'r1', source_id: 'e', normalized_text: 'x', snippet_hash: 'sha256:x' }] },
      { references: [{ id: 'r1', url: 'https://e.com' }], snippets: [{ id: 'r1', source_id: 'e', normalized_text: 'x', snippet_hash: 'sha256:x' }] },
      { references: [{ id: 'r1', url: 'https://e.com' }], snippets: [{ id: 'r1', source_id: 'e', normalized_text: 'x', snippet_hash: 'sha256:x' }] }
    ],
    evidenceRefs: [null, null, null, ['r1'], ['r1'], ['r1']]
  });

  // DPI: 3v3 tied. "20000" has newer timestamps → wins with prefer_latest
  const dpiDomains = ['g.com', 'h.com', 'i.com', 'j.com', 'k.com', 'l.com'];
  const dpiSources = dpiDomains.map((domain, i) => ({
    host: domain, rootDomain: domain, tier: 2, tierName: 'database',
    role: 'review', approvedDomain: true, identity: { match: true },
    anchorCheck: { majorConflicts: [] },
    ts: i < 3 ? '2026-01-01T00:00:00Z' : '2026-02-01T00:00:00Z',
    fieldCandidates: [{
      field: 'dpi',
      value: i < 3 ? '10000' : '20000',
      method: 'network_json',
      keyPath: 'payload.dpi'
    }]
  }));

  const result = runConsensusEngine({
    categoryConfig: { criticalFieldSet: new Set([]) },
    fieldOrder,
    anchors: {},
    identityLock: { brand: 'Test', model: 'Widget' },
    productId: 'test-1',
    category: 'mouse',
    sourceResults: [...sensorSources, ...dpiSources],
    fieldRulesEngine: engine
  });

  assert.equal(result.fields.sensor, 'Zzz Sensor');
  assert.equal(result.fields.dpi, '20000');
});

test('selection_policy: engine with no policy for field → no bonus, tied clusters stay unk', () => {
  const engine = mockFieldRulesEngine({});
  const sources = makeTiedSources('sensor', 'Aaa Value', 'Zzz Value');
  const result = runConsensusEngine({
    ...CONSENSUS_BASE,
    sourceResults: sources,
    fieldRulesEngine: engine
  });
  // No policy → no bonus → tied → unk
  assert.equal(result.fields.sensor, 'unk');
});

// ===========================================================================
// PART 2 — selection_policy object reducer (list → scalar)
// ===========================================================================

test('selection_policy object: applySelectionPolicyReducers reduces to median within tolerance', () => {
  const engine = mockFieldRulesEngine({
    click_latency: {
      source_field: 'click_latency_list',
      tolerance_ms: 0.5,
      mode_preference: ['wireless'],
      rule: 'reduce'
    }
  });

  const fields = { click_latency: 'unk', click_latency_list: '1.2, 1.3, 1.4' };
  const candidates = {
    click_latency_list: [
      { value: '1.2', score: 0.8, host: 'a.com', approvedDomain: true },
      { value: '1.3', score: 0.8, host: 'b.com', approvedDomain: true },
      { value: '1.4', score: 0.8, host: 'c.com', approvedDomain: true }
    ]
  };

  const result = applySelectionPolicyReducers({ fields, candidates, fieldRulesEngine: engine });
  assert.equal(result.fields.click_latency, '1.3');
  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0].field, 'click_latency');
  assert.equal(result.applied[0].reason, 'median_within_tolerance');
});

test('selection_policy object: returns unk when values exceed tolerance', () => {
  const engine = mockFieldRulesEngine({
    click_latency: {
      source_field: 'click_latency_list',
      tolerance_ms: 0.25,
      mode_preference: ['wireless'],
      rule: 'reduce'
    }
  });

  const fields = { click_latency: 'unk', click_latency_list: '1.2, 5.0, 1.3' };
  const candidates = {
    click_latency_list: [
      { value: '1.2', score: 0.8, host: 'a.com', approvedDomain: true },
      { value: '5.0', score: 0.8, host: 'b.com', approvedDomain: true },
      { value: '1.3', score: 0.8, host: 'c.com', approvedDomain: true }
    ]
  };

  const result = applySelectionPolicyReducers({ fields, candidates, fieldRulesEngine: engine });
  assert.equal(result.fields.click_latency, 'unk');
  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0].reason, 'exceeds_tolerance');
});

test('selection_policy object: single candidate within tolerance → use that value', () => {
  const engine = mockFieldRulesEngine({
    sensor_latency: {
      source_field: 'sensor_latency_list',
      tolerance_ms: 0.25,
      mode_preference: ['wireless'],
      rule: 'reduce'
    }
  });

  const fields = { sensor_latency: 'unk', sensor_latency_list: '0.95' };
  const candidates = {
    sensor_latency_list: [
      { value: '0.95', score: 0.8, host: 'rtings.com', approvedDomain: true }
    ]
  };

  const result = applySelectionPolicyReducers({ fields, candidates, fieldRulesEngine: engine });
  assert.equal(result.fields.sensor_latency, '0.95');
  assert.equal(result.applied[0].reason, 'single_value');
});

test('selection_policy object: no-op when policy is a string (not object)', () => {
  const engine = mockFieldRulesEngine({ sensor: 'best_evidence' });
  const fields = { sensor: 'Focus Pro 35K' };
  const candidates = {};

  const result = applySelectionPolicyReducers({ fields, candidates, fieldRulesEngine: engine });
  // String policies are handled by consensus, not the reducer
  assert.equal(result.fields.sensor, 'Focus Pro 35K');
  assert.equal(result.applied.length, 0);
});

test('selection_policy object: no-op when source_field has no candidates', () => {
  const engine = mockFieldRulesEngine({
    click_latency: {
      source_field: 'click_latency_list',
      tolerance_ms: 0.25,
      mode_preference: ['wireless'],
      rule: 'reduce'
    }
  });

  const fields = { click_latency: 'unk' };
  const candidates = {};

  const result = applySelectionPolicyReducers({ fields, candidates, fieldRulesEngine: engine });
  assert.equal(result.fields.click_latency, 'unk');
  assert.equal(result.applied.length, 0);
});

test('selection_policy object: no-op when no engine provided', () => {
  const fields = { click_latency: '1.5' };
  const candidates = {};

  const result = applySelectionPolicyReducers({ fields, candidates, fieldRulesEngine: null });
  assert.equal(result.fields.click_latency, '1.5');
  assert.equal(result.applied.length, 0);
});
