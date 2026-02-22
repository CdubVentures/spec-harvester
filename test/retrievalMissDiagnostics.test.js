import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTierAwareFieldRetrieval } from '../src/retrieve/tierAwareRetriever.js';

test('miss_diagnostics status=miss when no hits survive filtering', () => {
  const pool = [
    {
      origin_field: 'weight',
      url: 'https://wrong.com/page',
      host: 'wrong.com',
      tier: 2,
      method: 'table',
      quote: 'Weight: 80g',
      snippet_id: 'sn_wrong',
      source_identity_match: false,
      source_identity_score: 0.1
    }
  ];

  const result = buildTierAwareFieldRetrieval({
    fieldKey: 'weight',
    needRow: { field_key: 'weight', need_score: 10, required_level: 'critical', min_refs: 2 },
    fieldRule: { search_hints: { query_terms: ['weight', 'grams'] }, unit: 'g' },
    evidencePool: pool,
    identity: { brand: 'Test', model: 'Product' },
    identityFilterEnabled: true
  });

  assert.ok(result.miss_diagnostics);
  assert.equal(result.miss_diagnostics.status, 'miss');
});

test('miss_diagnostics reasons includes pool_empty when pool is empty', () => {
  const result = buildTierAwareFieldRetrieval({
    fieldKey: 'weight',
    needRow: { field_key: 'weight', need_score: 10, required_level: 'required', min_refs: 1 },
    fieldRule: { search_hints: { query_terms: ['weight'] }, unit: 'g' },
    evidencePool: [],
    identity: { brand: 'Test', model: 'Product' }
  });

  assert.ok(result.miss_diagnostics);
  assert.ok(result.miss_diagnostics.reasons.includes('pool_empty'));
  assert.equal(result.miss_diagnostics.pool_rows_scanned, 0);
  assert.equal(result.miss_diagnostics.status, 'miss');
});

test('miss_diagnostics reasons includes no_anchor when pool non-empty but no anchor matches', () => {
  const pool = [
    {
      origin_field: 'totally_different',
      url: 'https://random.com/xyz',
      host: 'random.com',
      tier: 2,
      method: 'text',
      quote: 'Screen ratio 16:9 panel type VA',
      snippet_id: 'sn_random'
    }
  ];

  const result = buildTierAwareFieldRetrieval({
    fieldKey: 'click_latency_ms',
    needRow: { field_key: 'click_latency_ms', need_score: 10, required_level: 'required', min_refs: 1 },
    fieldRule: { search_hints: { query_terms: ['click latency'] } },
    evidencePool: pool,
    identity: { brand: 'Test', model: 'Product' }
  });

  assert.ok(result.miss_diagnostics);
  assert.ok(result.miss_diagnostics.reasons.includes('no_anchor'));
  assert.ok(result.miss_diagnostics.pool_rows_scanned > 0);
  assert.equal(result.miss_diagnostics.anchor_match_count, 0);
});

test('miss_diagnostics reasons includes tier_deficit when all hits are from non-preferred tiers', () => {
  const pool = [
    {
      origin_field: 'weight',
      url: 'https://retailer.com/page',
      host: 'retailer.com',
      tier: 4,
      method: 'table',
      quote: 'Weight: 54 grams',
      snippet_id: 'sn_retail'
    }
  ];

  const result = buildTierAwareFieldRetrieval({
    fieldKey: 'weight',
    needRow: { field_key: 'weight', need_score: 10, required_level: 'required', min_refs: 1, tier_preference: [1, 2] },
    fieldRule: { search_hints: { query_terms: ['weight', 'grams'] }, unit: 'g' },
    evidencePool: pool,
    identity: { brand: 'Test', model: 'Product' }
  });

  assert.ok(result.miss_diagnostics);
  assert.ok(result.miss_diagnostics.reasons.includes('tier_deficit'));
  assert.equal(result.miss_diagnostics.preferred_tier_hit_count, 0);
});

test('miss_diagnostics status=satisfied when min_refs met with preferred tier hits', () => {
  const pool = [
    {
      origin_field: 'weight',
      url: 'https://mfg.com/spec',
      host: 'mfg.com',
      tier: 1,
      method: 'table',
      quote: 'Weight: 54 grams',
      snippet_id: 'sn_mfg'
    },
    {
      origin_field: 'weight',
      url: 'https://rtings.com/review',
      host: 'rtings.com',
      tier: 2,
      method: 'table',
      quote: 'Weight: 54 g measured',
      snippet_id: 'sn_rtings'
    }
  ];

  const result = buildTierAwareFieldRetrieval({
    fieldKey: 'weight',
    needRow: { field_key: 'weight', need_score: 10, required_level: 'required', min_refs: 2, tier_preference: [1, 2] },
    fieldRule: { search_hints: { query_terms: ['weight', 'grams'] }, unit: 'g' },
    evidencePool: pool,
    identity: { brand: 'Test', model: 'Product' }
  });

  assert.ok(result.miss_diagnostics);
  assert.equal(result.miss_diagnostics.status, 'satisfied');
  assert.ok(result.miss_diagnostics.preferred_tier_hit_count >= 2);
  assert.equal(result.miss_diagnostics.min_refs_gap, 0);
  assert.deepEqual(result.miss_diagnostics.reasons, []);
});
