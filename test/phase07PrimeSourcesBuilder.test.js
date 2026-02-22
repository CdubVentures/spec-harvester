import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPhase07PrimeSources } from '../src/retrieve/primeSourcesBuilder.js';
import { buildTierAwareFieldRetrieval } from '../src/retrieve/tierAwareRetriever.js';

test('phase07 builder enforces min refs + distinct source policy for critical field', () => {
  const payload = buildPhase07PrimeSources({
    runId: 'run-phase07-unit-001',
    category: 'mouse',
    productId: 'mouse-test',
    needSet: {
      needs: [
        {
          field_key: 'polling_rate',
          required_level: 'critical',
          need_score: 38.88,
          min_refs: 2,
          tier_preference: [1, 2, 3]
        }
      ]
    },
    provenance: {
      polling_rate: {
        value: 'unk',
        evidence: [
          {
            url: 'https://example-a.com/spec',
            host: 'example-a.com',
            tier: 1,
            method: 'table',
            quote: 'Polling Rate: 8000 Hz'
          },
          {
            url: 'https://example-b.com/manual.pdf',
            host: 'example-b.com',
            tier: 2,
            method: 'text',
            quote: 'Report rate up to 8000Hz wireless'
          }
        ]
      }
    },
    fieldRules: {
      fields: {
        polling_rate: {
          required_level: 'critical',
          evidence: {
            min_evidence_refs: 2,
            distinct_sources_required: true,
            tier_preference: ['tier1', 'tier2', 'tier3']
          },
          search_hints: {
            query_terms: ['polling rate', 'report rate', 'hz']
          },
          unit: 'Hz'
        }
      }
    },
    identity: {
      brand: 'TestBrand',
      model: 'X8K'
    }
  });

  assert.equal(Number(payload.summary?.fields_attempted || 0), 1);
  assert.equal(Number(payload.summary?.fields_satisfied_min_refs || 0), 1);
  assert.equal(Array.isArray(payload.fields), true);
  assert.equal(payload.fields.length, 1);
  const row = payload.fields[0];
  assert.equal(row.field_key, 'polling_rate');
  assert.equal(Number(row.refs_selected || 0) >= 2, true);
  assert.equal(Number(row.distinct_sources_selected || 0) >= 2, true);
  assert.equal(Boolean(row.min_refs_satisfied), true);
  assert.equal(Array.isArray(row.prime_sources), true);
  assert.equal(row.prime_sources.length >= 2, true);
});

test('phase07 retriever generates deterministic snippet ids when missing', () => {
  const payload = buildPhase07PrimeSources({
    runId: 'run-phase07-unit-002',
    category: 'mouse',
    productId: 'mouse-test',
    needSet: {
      needs: [
        {
          field_key: 'weight',
          required_level: 'required',
          need_score: 20,
          min_refs: 1
        }
      ]
    },
    provenance: {
      weight: {
        value: 'unk',
        evidence: [
          {
            url: 'https://example-c.com/spec',
            host: 'example-c.com',
            tier: 2,
            method: 'table',
            quote: 'Weight: 54 g'
          }
        ]
      }
    },
    fieldRules: {
      fields: {
        weight: {
          required_level: 'required',
          search_hints: {
            query_terms: ['weight', 'grams']
          },
          unit: 'g'
        }
      }
    }
  });

  assert.equal(payload.fields.length, 1);
  const row = payload.fields[0];
  assert.equal(Array.isArray(row.hits), true);
  assert.equal(row.hits.length > 0, true);
  assert.equal(String(row.hits[0].snippet_id || '').startsWith('sn_'), true);
});

test('phase07 builder falls back to sourceResults evidence packs when provenance evidence is empty', () => {
  const payload = buildPhase07PrimeSources({
    runId: 'run-phase07-unit-003',
    category: 'mouse',
    productId: 'mouse-test',
    needSet: {
      needs: [
        {
          field_key: 'polling_rate',
          required_level: 'critical',
          need_score: 38.88,
          min_refs: 1,
          tier_preference: [1, 2, 3]
        }
      ]
    },
    provenance: {
      polling_rate: {
        value: 'unk',
        evidence: []
      }
    },
    sourceResults: [
      {
        host: 'example-a.com',
        tier: 2,
        tierName: 'lab',
        finalUrl: 'https://example-a.com/review',
        llmEvidencePack: {
          snippets: [
            {
              id: 'w01',
              url: 'https://example-a.com/review',
              type: 'window',
              text: 'Polling Rate: 125/250/500/1000/2000/4000/8000 Hz',
              extraction_method: 'parse_template',
              field_hints: ['polling_rate'],
              snippet_hash: 'sha256:test'
            }
          ]
        }
      }
    ],
    fieldRules: {
      fields: {
        polling_rate: {
          required_level: 'critical',
          evidence: {
            min_evidence_refs: 1
          },
          search_hints: {
            query_terms: ['polling rate', 'hz']
          },
          unit: 'Hz'
        }
      }
    },
    identity: {
      brand: 'TestBrand',
      model: 'X8K'
    },
    options: {
      provenanceOnlyMinRows: 1
    }
  });

  assert.equal(Number(payload.summary?.evidence_pool_fallback_used ? 1 : 0), 1);
  assert.equal(Number(payload.summary?.fields_with_hits || 0) >= 1, true);
  assert.equal(payload.fields.length, 1);
  assert.equal(payload.fields[0].hits.length >= 1, true);
});

test('tier_preference [2] scores a tier-2 hit higher than a tier-1 hit', () => {
  const pool = [
    {
      origin_field: 'sensor',
      url: 'https://mfg.com/spec',
      host: 'mfg.com',
      tier: 1,
      method: 'table',
      quote: 'Sensor: Focus Pro 35K',
      snippet_id: 'sn_tier1'
    },
    {
      origin_field: 'sensor',
      url: 'https://rtings.com/review',
      host: 'rtings.com',
      tier: 2,
      method: 'table',
      quote: 'Sensor: Focus Pro 35K',
      snippet_id: 'sn_tier2'
    }
  ];

  const result = buildTierAwareFieldRetrieval({
    fieldKey: 'sensor',
    needRow: { field_key: 'sensor', tier_preference: [2], need_score: 10, required_level: 'required' },
    fieldRule: { search_hints: { query_terms: ['sensor'] } },
    evidencePool: pool,
    identity: { brand: 'Razer', model: 'Viper V3 Pro' }
  });

  assert.ok(result.hits.length >= 2);
  const tier2Hit = result.hits.find((h) => h.tier === 2);
  const tier1Hit = result.hits.find((h) => h.tier === 1);
  assert.ok(tier2Hit);
  assert.ok(tier1Hit);
  assert.ok(tier2Hit.score > tier1Hit.score, 'tier-2 hit should score higher when tier_preference is [2]');
});

test('default tier_preference [1,2,3] scores tier-1 highest', () => {
  const pool = [
    {
      origin_field: 'dpi',
      url: 'https://mfg.com/spec',
      host: 'mfg.com',
      tier: 1,
      method: 'table',
      quote: 'DPI: 30000',
      snippet_id: 'sn_t1'
    },
    {
      origin_field: 'dpi',
      url: 'https://rtings.com/review',
      host: 'rtings.com',
      tier: 2,
      method: 'table',
      quote: 'DPI: 30000',
      snippet_id: 'sn_t2'
    },
    {
      origin_field: 'dpi',
      url: 'https://amazon.com/product',
      host: 'amazon.com',
      tier: 3,
      method: 'table',
      quote: 'DPI: 30000',
      snippet_id: 'sn_t3'
    }
  ];

  const result = buildTierAwareFieldRetrieval({
    fieldKey: 'dpi',
    needRow: { field_key: 'dpi', need_score: 10, required_level: 'required' },
    fieldRule: { search_hints: { query_terms: ['dpi', 'cpi'] } },
    evidencePool: pool,
    identity: { brand: 'Razer', model: 'Test' }
  });

  assert.ok(result.hits.length >= 3);
  assert.equal(result.tier_preference[0], 1);
  assert.ok(result.hits[0].tier === 1, 'tier-1 hit should rank first with default preference');
});

test('E2E: two fields with different tier_preferences produce different top hits', () => {
  const payload = buildPhase07PrimeSources({
    runId: 'run-phase07-tier-pref',
    category: 'mouse',
    productId: 'mouse-test',
    needSet: {
      needs: [
        {
          field_key: 'sensor',
          required_level: 'required',
          need_score: 10,
          min_refs: 1,
          tier_preference: [2]
        },
        {
          field_key: 'weight',
          required_level: 'required',
          need_score: 10,
          min_refs: 1,
          tier_preference: [1]
        }
      ]
    },
    provenance: {
      sensor: {
        value: 'unk',
        evidence: [
          { url: 'https://mfg.com/spec', host: 'mfg.com', tier: 1, method: 'table', quote: 'Sensor: Focus Pro 35K' },
          { url: 'https://rtings.com/review', host: 'rtings.com', tier: 2, method: 'table', quote: 'Sensor: Focus Pro 35K latency test' }
        ]
      },
      weight: {
        value: 'unk',
        evidence: [
          { url: 'https://mfg.com/spec', host: 'mfg.com', tier: 1, method: 'table', quote: 'Weight: 54 grams' },
          { url: 'https://rtings.com/review', host: 'rtings.com', tier: 2, method: 'table', quote: 'Weight: 54 g measured' }
        ]
      }
    },
    fieldRules: {
      fields: {
        sensor: { search_hints: { query_terms: ['sensor'] } },
        weight: { search_hints: { query_terms: ['weight', 'grams'] }, unit: 'g' }
      }
    },
    identity: { brand: 'Razer', model: 'Viper V3 Pro' }
  });

  assert.equal(payload.fields.length, 2);
  const sensorField = payload.fields.find((f) => f.field_key === 'sensor');
  const weightField = payload.fields.find((f) => f.field_key === 'weight');
  assert.ok(sensorField);
  assert.ok(weightField);
  assert.deepEqual(sensorField.tier_preference, [2]);
  assert.deepEqual(weightField.tier_preference, [1]);
  assert.ok(sensorField.hits.length > 0);
  assert.ok(weightField.hits.length > 0);
  assert.equal(sensorField.hits[0].tier, 2, 'sensor top hit should be tier-2 with preference [2]');
  assert.equal(weightField.hits[0].tier, 1, 'weight top hit should be tier-1 with preference [1]');
});

test('phase07 builder uses default maxHitsPerField=24 and maxPrimeSourcesPerField=8', () => {
  const evidence = Array.from({ length: 30 }, (_, i) => ({
    url: `https://source-${i}.com/specs`,
    host: `source-${i}.com`,
    tier: (i % 3) + 1,
    method: 'table',
    quote: `Weight is ${50 + i}g`
  }));
  const payload = buildPhase07PrimeSources({
    runId: 'run-defaults-test',
    category: 'mouse',
    productId: 'mouse-defaults',
    needSet: { needs: [{ field_key: 'weight', required_level: 'required', need_score: 20, min_refs: 1, tier_preference: [1, 2, 3] }] },
    provenance: { weight: { value: '50', evidence } },
    fieldRules: { fields: { weight: { required_level: 'required', unit: 'g' } } },
    identity: { brand: 'Test', model: 'Default' }
  });
  const field = payload.fields[0];
  assert.ok(field);
  assert.ok(field.hits.length <= 24, `hits should be capped at 24 (default), got ${field.hits.length}`);
  assert.ok(field.prime_sources.length <= 8, `prime_sources should be capped at 8 (default), got ${field.prime_sources.length}`);
});

test('phase07 builder respects custom maxHitsPerField and maxPrimeSourcesPerField options', () => {
  const evidence = Array.from({ length: 30 }, (_, i) => ({
    url: `https://source-${i}.com/specs`,
    host: `source-${i}.com`,
    tier: (i % 3) + 1,
    method: 'table',
    quote: `Weight is ${50 + i}g`
  }));
  const payload = buildPhase07PrimeSources({
    runId: 'run-custom-limits',
    category: 'mouse',
    productId: 'mouse-custom',
    needSet: { needs: [{ field_key: 'weight', required_level: 'required', need_score: 20, min_refs: 1, tier_preference: [1, 2, 3] }] },
    provenance: { weight: { value: '50', evidence } },
    fieldRules: { fields: { weight: { required_level: 'required', unit: 'g' } } },
    identity: { brand: 'Test', model: 'Custom' },
    options: { maxHitsPerField: 10, maxPrimeSourcesPerField: 4 }
  });
  const field = payload.fields[0];
  assert.ok(field);
  assert.ok(field.hits.length <= 10, `hits should be capped at 10, got ${field.hits.length}`);
  assert.ok(field.prime_sources.length <= 4, `prime_sources should be capped at 4, got ${field.prime_sources.length}`);
});
