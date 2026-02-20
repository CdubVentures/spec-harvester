import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyEvidenceSpan } from '../src/evidence/verifyEvidenceSpan.js';

// ---------------------------------------------------------------------------
// Publish Gate — verifyEvidenceSpan Tests
// ---------------------------------------------------------------------------

const SNIPPET_TEXT = 'The mouse weighs 52 grams and has a PAW3395 sensor.';

function makeEvidencePack(snippets = {}) {
  return {
    snippets: {
      'snip-1': {
        id: 'snip-1',
        snippet_hash: 'abc123',
        normalized_text: SNIPPET_TEXT
      },
      ...snippets
    }
  };
}

function makeProvenance(field, overrides = {}) {
  return {
    [field]: {
      url: 'https://example.com/review',
      snippet_id: 'snip-1',
      snippet_hash: 'abc123',
      quote: '52 grams',
      quote_span: [20, 28],
      ...overrides
    }
  };
}

// =========================================================================
// SECTION 1: Happy path
// =========================================================================

test('publish gate: passes when all evidence fields valid', () => {
  const result = verifyEvidenceSpan({
    fields: { weight: '52' },
    provenance: makeProvenance('weight'),
    evidencePack: makeEvidencePack()
  });
  assert.equal(result.gate_passed, true);
  assert.equal(result.pass_count, 1);
  assert.equal(result.fail_count, 0);
});

test('publish gate: skips unk fields', () => {
  const result = verifyEvidenceSpan({
    fields: { weight: '52', sensor: 'unk' },
    provenance: makeProvenance('weight'),
    evidencePack: makeEvidencePack()
  });
  assert.equal(result.total_fields, 1);
  assert.equal(result.gate_passed, true);
});

test('publish gate: passes multiple fields', () => {
  const result = verifyEvidenceSpan({
    fields: { weight: '52', sensor: 'PAW3395' },
    provenance: {
      ...makeProvenance('weight'),
      sensor: {
        url: 'https://example.com/review',
        snippet_id: 'snip-1',
        snippet_hash: 'abc123',
        quote: 'PAW3395 sensor'
      }
    },
    evidencePack: makeEvidencePack()
  });
  assert.equal(result.gate_passed, true);
  assert.equal(result.pass_count, 2);
});

// =========================================================================
// SECTION 2: Failure cases
// =========================================================================

test('publish gate: fails when no provenance entry', () => {
  const result = verifyEvidenceSpan({
    fields: { weight: '52' },
    provenance: {},
    evidencePack: makeEvidencePack()
  });
  assert.equal(result.gate_passed, false);
  assert.deepEqual(result.results[0].issues, ['no_provenance']);
});

test('publish gate: fails when no source URL', () => {
  const result = verifyEvidenceSpan({
    fields: { weight: '52' },
    provenance: makeProvenance('weight', { url: '' }),
    evidencePack: makeEvidencePack()
  });
  assert.equal(result.gate_passed, false);
  assert.ok(result.results[0].issues.includes('no_source_url'));
});

test('publish gate: fails when snippet_id missing', () => {
  const result = verifyEvidenceSpan({
    fields: { weight: '52' },
    provenance: makeProvenance('weight', { snippet_id: '' }),
    evidencePack: makeEvidencePack()
  });
  assert.equal(result.gate_passed, false);
  assert.ok(result.results[0].issues.includes('no_snippet_id'));
});

test('publish gate: fails when snippet not found in pack', () => {
  const result = verifyEvidenceSpan({
    fields: { weight: '52' },
    provenance: makeProvenance('weight', { snippet_id: 'snip-999' }),
    evidencePack: makeEvidencePack()
  });
  assert.equal(result.gate_passed, false);
  assert.ok(result.results[0].issues.includes('snippet_not_found'));
});

test('publish gate: fails when snippet_hash mismatch', () => {
  const result = verifyEvidenceSpan({
    fields: { weight: '52' },
    provenance: makeProvenance('weight', { snippet_hash: 'wrong-hash' }),
    evidencePack: makeEvidencePack()
  });
  assert.equal(result.gate_passed, false);
  assert.ok(result.results[0].issues.includes('snippet_hash_mismatch'));
});

test('publish gate: fails when quote not in snippet text', () => {
  const result = verifyEvidenceSpan({
    fields: { weight: '52' },
    provenance: makeProvenance('weight', { quote: 'totally different text' }),
    evidencePack: makeEvidencePack()
  });
  assert.equal(result.gate_passed, false);
  assert.ok(result.results[0].issues.includes('quote_not_in_snippet'));
});

test('publish gate: fails when no quote provided', () => {
  const result = verifyEvidenceSpan({
    fields: { weight: '52' },
    provenance: makeProvenance('weight', { quote: '' }),
    evidencePack: makeEvidencePack()
  });
  assert.equal(result.gate_passed, false);
  assert.ok(result.results[0].issues.includes('no_quote'));
});

test('publish gate: fails when quote_span invalid', () => {
  const result = verifyEvidenceSpan({
    fields: { weight: '52' },
    provenance: makeProvenance('weight', { quote_span: [10, 5] }),
    evidencePack: makeEvidencePack()
  });
  assert.equal(result.gate_passed, false);
  assert.ok(result.results[0].issues.includes('quote_span_invalid'));
});

test('publish gate: fails when quote_span out of bounds', () => {
  const result = verifyEvidenceSpan({
    fields: { weight: '52' },
    provenance: makeProvenance('weight', { quote_span: [0, 9999] }),
    evidencePack: makeEvidencePack()
  });
  assert.equal(result.gate_passed, false);
  assert.ok(result.results[0].issues.includes('quote_span_out_of_bounds'));
});

// =========================================================================
// SECTION 3: requiredFields filter
// =========================================================================

test('publish gate: only checks requiredFields when provided', () => {
  const result = verifyEvidenceSpan({
    fields: { weight: '52', sensor: 'PAW3395' },
    provenance: makeProvenance('weight'),
    evidencePack: makeEvidencePack(),
    requiredFields: ['weight']
  });
  assert.equal(result.total_fields, 1);
  assert.equal(result.gate_passed, true);
});

// =========================================================================
// SECTION 4: Array-style snippets
// =========================================================================

test('publish gate: works with array-style snippets', () => {
  const pack = {
    snippets: [
      { id: 'snip-1', snippet_hash: 'abc123', normalized_text: SNIPPET_TEXT }
    ]
  };
  const result = verifyEvidenceSpan({
    fields: { weight: '52' },
    provenance: makeProvenance('weight'),
    evidencePack: pack
  });
  assert.equal(result.gate_passed, true);
});

// =========================================================================
// SECTION 5: No evidence pack (skip snippet-level checks)
// =========================================================================

test('publish gate: without evidencePack only checks provenance existence', () => {
  const result = verifyEvidenceSpan({
    fields: { weight: '52' },
    provenance: makeProvenance('weight'),
    evidencePack: null
  });
  assert.equal(result.gate_passed, true);
});
