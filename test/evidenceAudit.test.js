import test from 'node:test';
import assert from 'node:assert/strict';
import { EvidenceAuditor } from '../src/extract/evidenceAudit.js';

const evidencePack = {
  references: [
    { id: 's1', url: 'https://example.com/spec' },
    { id: 's2', url: 'https://example.com/spec' }
  ],
  snippets: [
    {
      id: 's1',
      source_id: 'example',
      normalized_text: 'Weight: 60 g',
      snippet_hash: 'sha256:s1'
    },
    {
      id: 's2',
      source_id: 'example',
      normalized_text: 'Weight: 61 g',
      snippet_hash: 'sha256:s2'
    }
  ]
};

test('EvidenceAuditor accepts candidates with valid evidence and quote', () => {
  const auditor = new EvidenceAuditor();
  const result = auditor.auditCandidates({
    productId: 'mouse-1',
    candidatesByField: {
      weight: [{
        field: 'weight',
        value: '60',
        confidence: 0.8,
        evidenceRefs: ['s1'],
        snippetId: 's1',
        quote: '60'
      }]
    },
    evidencePack
  });

  assert.equal(result.accepted_fields, 1);
  assert.equal(result.rejected_fields, 0);
  assert.equal(result.audits[0].status, 'ACCEPT');
  assert.equal(result.accepted_by_field.weight[0].value, '60');
});

test('EvidenceAuditor rejects candidates with missing evidence references', () => {
  const auditor = new EvidenceAuditor();
  const result = auditor.auditCandidates({
    productId: 'mouse-2',
    candidatesByField: {
      weight: [{
        field: 'weight',
        value: '60',
        confidence: 0.9,
        evidenceRefs: [],
        quote: '60'
      }]
    },
    evidencePack
  });

  assert.equal(result.accepted_fields, 0);
  assert.equal(result.rejected_fields, 1);
  assert.equal(result.audits[0].status, 'REJECT');
  assert.equal(result.audits[0].reasons.includes('missing_evidence_refs'), true);
});

test('EvidenceAuditor marks conflicting supported values as CONFLICT', () => {
  const auditor = new EvidenceAuditor();
  const result = auditor.auditCandidates({
    productId: 'mouse-3',
    candidatesByField: {
      weight: [
        {
          field: 'weight',
          value: '60',
          confidence: 0.81,
          evidenceRefs: ['s1'],
          snippetId: 's1',
          quote: '60'
        },
        {
          field: 'weight',
          value: '61',
          confidence: 0.8,
          evidenceRefs: ['s2'],
          snippetId: 's2',
          quote: '61'
        }
      ]
    },
    evidencePack
  });

  assert.equal(result.accepted_fields, 0);
  assert.equal(result.conflicted_fields, 1);
  assert.equal(result.audits[0].status, 'CONFLICT');
  assert.equal(result.audits[0].reasons.includes('multiple_supported_values'), true);
});
