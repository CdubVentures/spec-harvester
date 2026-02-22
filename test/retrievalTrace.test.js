import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTierAwareFieldRetrieval } from '../src/retrieve/tierAwareRetriever.js';

function makePool({ fieldKey = 'weight', count = 5, identityMatch = true } = {}) {
  return Array.from({ length: count }, (_, i) => ({
    origin_field: fieldKey,
    url: `https://source-${i}.com/page`,
    host: `source-${i}.com`,
    tier: (i % 3) + 1,
    method: 'table',
    quote: `${fieldKey}: value ${i}`,
    snippet_id: `sn_${i}`,
    source_identity_match: identityMatch,
    source_identity_score: identityMatch ? 0.9 : 0.1
  }));
}

test('traceEnabled=true returns trace with pool_size, scored_count, accepted_count, rejected_count', () => {
  const pool = makePool({ fieldKey: 'weight', count: 10 });

  const result = buildTierAwareFieldRetrieval({
    fieldKey: 'weight',
    needRow: { field_key: 'weight', need_score: 10, required_level: 'required', min_refs: 1 },
    fieldRule: { search_hints: { query_terms: ['weight', 'grams'] }, unit: 'g' },
    evidencePool: pool,
    identity: { brand: 'Test', model: 'Product' },
    traceEnabled: true
  });

  assert.ok(result.trace, 'trace should be present when traceEnabled=true');
  assert.ok(Number.isFinite(result.trace.pool_size));
  assert.ok(result.trace.pool_size > 0);
  assert.ok(Number.isFinite(result.trace.scored_count));
  assert.ok(Number.isFinite(result.trace.accepted_count));
  assert.ok(Number.isFinite(result.trace.rejected_count));
  assert.ok(result.trace.accepted_count > 0);
});

test('trace rejected_hits contains entries with rejection_reason field', () => {
  const pool = [
    ...makePool({ fieldKey: 'weight', count: 3 }),
    {
      origin_field: 'unrelated_field',
      url: 'https://unrelated.com/page',
      host: 'unrelated.com',
      tier: 3,
      method: 'text',
      quote: 'Some unrelated content without anchor terms',
      snippet_id: 'sn_unrelated'
    },
    {
      origin_field: 'weight',
      url: 'https://wrong-product.com/page',
      host: 'wrong-product.com',
      tier: 2,
      method: 'table',
      quote: 'Weight: 80 grams',
      snippet_id: 'sn_wrong',
      source_identity_match: false,
      source_identity_score: 0.1
    }
  ];

  const result = buildTierAwareFieldRetrieval({
    fieldKey: 'weight',
    needRow: { field_key: 'weight', need_score: 10, required_level: 'critical', min_refs: 1 },
    fieldRule: { search_hints: { query_terms: ['weight', 'grams'] }, unit: 'g' },
    evidencePool: pool,
    identity: { brand: 'Test', model: 'Product' },
    traceEnabled: true,
    identityFilterEnabled: true
  });

  assert.ok(result.trace);
  assert.ok(Array.isArray(result.trace.rejected_hits));
  const reasons = result.trace.rejected_hits.map((h) => h.rejection_reason);
  assert.ok(reasons.some((r) => r === 'no_anchor' || r === 'identity_mismatch'));
});

test('traceEnabled=false (default) does NOT include trace', () => {
  const pool = makePool({ fieldKey: 'weight', count: 3 });

  const result = buildTierAwareFieldRetrieval({
    fieldKey: 'weight',
    needRow: { field_key: 'weight', need_score: 10, required_level: 'required', min_refs: 1 },
    fieldRule: { search_hints: { query_terms: ['weight', 'grams'] }, unit: 'g' },
    evidencePool: pool,
    identity: { brand: 'Test', model: 'Product' }
  });

  assert.equal(result.trace, undefined);
});

test('trace rejected_hits capped at 20', () => {
  const pool = Array.from({ length: 50 }, (_, i) => ({
    origin_field: 'other_field',
    url: `https://unrelated-${i}.com/page`,
    host: `unrelated-${i}.com`,
    tier: 3,
    method: 'text',
    quote: `Completely unrelated content number ${i}`,
    snippet_id: `sn_unrelated_${i}`
  }));

  const result = buildTierAwareFieldRetrieval({
    fieldKey: 'weight',
    needRow: { field_key: 'weight', need_score: 10, required_level: 'required', min_refs: 1 },
    fieldRule: { search_hints: { query_terms: ['weight'] }, unit: 'g' },
    evidencePool: pool,
    identity: { brand: 'Test', model: 'Product' },
    traceEnabled: true
  });

  assert.ok(result.trace);
  assert.ok(result.trace.rejected_hits.length <= 20);
});
