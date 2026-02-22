import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEvidencePoolFromSourceResults,
  buildTierAwareFieldRetrieval,
  filterByIdentityGate
} from '../src/retrieve/tierAwareRetriever.js';

function makeSource({ host, tier, identityMatch = true, identityScore = 0.95, fieldCandidates = [], snippets = [] } = {}) {
  return {
    host,
    rootDomain: host,
    tier,
    tierName: tier === 1 ? 'manufacturer' : 'lab',
    finalUrl: `https://${host}/page`,
    sourceId: host,
    identity: { match: identityMatch, score: identityScore },
    fieldCandidates,
    llmEvidencePack: { snippets }
  };
}

test('buildEvidencePoolFromSourceResults propagates source_identity_match and source_identity_score', () => {
  const sources = [
    makeSource({
      host: 'mfg.com',
      tier: 1,
      identityMatch: true,
      identityScore: 0.92,
      fieldCandidates: [
        {
          field: 'weight',
          value: '54g',
          evidence: [{ url: 'https://mfg.com/page', quote: 'Weight: 54g', method: 'table' }]
        }
      ]
    }),
    makeSource({
      host: 'wrong-product.com',
      tier: 2,
      identityMatch: false,
      identityScore: 0.15,
      fieldCandidates: [
        {
          field: 'weight',
          value: '80g',
          evidence: [{ url: 'https://wrong-product.com/page', quote: 'Weight: 80g', method: 'table' }]
        }
      ]
    })
  ];

  const pool = buildEvidencePoolFromSourceResults(sources);
  assert.ok(pool.length >= 2);

  const mfgRow = pool.find((r) => r.host === 'mfg.com');
  assert.ok(mfgRow);
  assert.equal(mfgRow.source_identity_match, true);
  assert.equal(mfgRow.source_identity_score, 0.92);

  const wrongRow = pool.find((r) => r.host === 'wrong-product.com');
  assert.ok(wrongRow);
  assert.equal(wrongRow.source_identity_match, false);
  assert.equal(wrongRow.source_identity_score, 0.15);
});

test('filterByIdentityGate suppresses identity_match=false hits for critical fields when enabled', () => {
  const hits = [
    { url: 'https://mfg.com/a', source_identity_match: true, source_identity_score: 0.9, score: 8 },
    { url: 'https://wrong.com/b', source_identity_match: false, source_identity_score: 0.1, score: 7 },
    { url: 'https://ok.com/c', source_identity_match: true, source_identity_score: 0.85, score: 6 }
  ];

  const result = filterByIdentityGate({
    hits,
    requiredLevel: 'critical',
    identityFilterEnabled: true
  });

  assert.equal(result.accepted.length, 2);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].url, 'https://wrong.com/b');
});

test('filterByIdentityGate with identityFilterEnabled=false does NOT suppress any hits', () => {
  const hits = [
    { url: 'https://mfg.com/a', source_identity_match: true, score: 8 },
    { url: 'https://wrong.com/b', source_identity_match: false, score: 7 }
  ];

  const result = filterByIdentityGate({
    hits,
    requiredLevel: 'critical',
    identityFilterEnabled: false
  });

  assert.equal(result.accepted.length, 2);
  assert.equal(result.rejected.length, 0);
});

test('filterByIdentityGate with requiredLevel=optional never identity-filters', () => {
  const hits = [
    { url: 'https://wrong.com/b', source_identity_match: false, score: 7 }
  ];

  const result = filterByIdentityGate({
    hits,
    requiredLevel: 'optional',
    identityFilterEnabled: true
  });

  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 0);
});

test('filterByIdentityGate with requiredLevel=identity filters when flag is true', () => {
  const hits = [
    { url: 'https://mfg.com/a', source_identity_match: true, score: 8 },
    { url: 'https://wrong.com/b', source_identity_match: false, score: 7 }
  ];

  const result = filterByIdentityGate({
    hits,
    requiredLevel: 'identity',
    identityFilterEnabled: true
  });

  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.accepted[0].url, 'https://mfg.com/a');
  assert.equal(result.rejected[0].url, 'https://wrong.com/b');
});
