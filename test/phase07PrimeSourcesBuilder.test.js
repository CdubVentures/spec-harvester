import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPhase07PrimeSources } from '../src/retrieve/primeSourcesBuilder.js';

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
