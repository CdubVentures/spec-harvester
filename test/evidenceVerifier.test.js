import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyCandidateEvidence } from '../src/llm/evidenceVerifier.js';

const evidencePack = {
  references: [
    { id: 's1', url: 'https://example.com/spec' }
  ],
  snippets: [
    {
      id: 's1',
      source_id: 'example_com',
      normalized_text: 'Weight: 60 g',
      snippet_hash: 'sha256:abc'
    }
  ]
};

test('verifyCandidateEvidence accepts valid citation and auto-repairs numeric quote', () => {
  const check = verifyCandidateEvidence({
    candidate: {
      field: 'weight',
      value: '60',
      evidenceRefs: ['s1'],
      snippetHash: 'sha256:abc'
    },
    evidencePack
  });

  assert.equal(check.ok, true);
  assert.equal(check.candidate.quote, '60');
  assert.deepEqual(check.candidate.quoteSpan, [8, 10]);
});

test('verifyCandidateEvidence rejects stale snippet_hash mismatch', () => {
  const check = verifyCandidateEvidence({
    candidate: {
      field: 'weight',
      value: '60',
      evidenceRefs: ['s1'],
      snippetHash: 'sha256:stale'
    },
    evidencePack
  });
  assert.equal(check.ok, false);
  assert.equal(check.reason, 'snippet_hash_mismatch');
});

test('verifyCandidateEvidence rejects non-numeric value not present in snippet text', () => {
  const check = verifyCandidateEvidence({
    candidate: {
      field: 'sensor',
      value: 'PAW3395',
      evidenceRefs: ['s1']
    },
    evidencePack
  });
  assert.equal(check.ok, false);
  assert.equal(check.reason, 'value_not_in_snippet');
});

