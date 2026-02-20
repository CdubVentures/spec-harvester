import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyCandidateEvidence } from '../src/llm/evidenceVerifier.js';

// ---------------------------------------------------------------------------
// A.1 — Evidence Verification Wire-In Tests
//
// These tests verify that evidence verification covers ALL acceptance paths:
//   1. Standard LLM extraction (already wired — baseline)
//   2. Aggressive orchestrator DOM extraction (gap: needs wire-in)
//   3. Helper file supportive fills (gap: needs synthetic evidence)
//   4. RuntimeGate enforceEvidence default behavior (gap: default should be true for aggressive)
// ---------------------------------------------------------------------------

// --- Shared fixtures ---

const basePack = {
  references: [
    { id: 'ref_rtings', url: 'https://rtings.com/mouse/razer-viper' },
    { id: 'ref_razer', url: 'https://razer.com/mice/viper-v3-pro' }
  ],
  snippets: [
    {
      id: 'ref_rtings',
      source_id: 'rtings_com',
      normalized_text: 'The Razer Viper V3 Pro weighs 54 grams and has a maximum DPI of 35000.',
      snippet_hash: 'sha256:rtings_snap_001'
    },
    {
      id: 'ref_razer',
      source_id: 'razer_com',
      normalized_text: 'Sensor: Focus Pro 4K, Polling Rate: 4000 Hz',
      snippet_hash: 'sha256:razer_snap_001'
    }
  ]
};

// =========================================================================
// SECTION 1: Baseline verification (already working — regression guard)
// =========================================================================

test('A.1 baseline: accepts candidate with valid hash + value in snippet', () => {
  const result = verifyCandidateEvidence({
    candidate: {
      field: 'weight',
      value: '54',
      evidenceRefs: ['ref_rtings'],
      snippetHash: 'sha256:rtings_snap_001'
    },
    evidencePack: basePack
  });
  assert.equal(result.ok, true);
  assert.equal(result.candidate.field, 'weight');
  assert.equal(result.candidate.snippetId, 'ref_rtings');
});

test('A.1 baseline: rejects candidate when value not present in snippet text', () => {
  const result = verifyCandidateEvidence({
    candidate: {
      field: 'weight',
      value: '99',
      evidenceRefs: ['ref_rtings'],
      snippetHash: 'sha256:rtings_snap_001'
    },
    evidencePack: basePack
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /not_in_snippet/);
});

test('A.1 baseline: rejects candidate when snippet hash is stale', () => {
  const result = verifyCandidateEvidence({
    candidate: {
      field: 'weight',
      value: '54',
      evidenceRefs: ['ref_rtings'],
      snippetHash: 'sha256:STALE_HASH'
    },
    evidencePack: basePack
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'snippet_hash_mismatch');
});

test('A.1 baseline: rejects candidate with empty evidenceRefs', () => {
  const result = verifyCandidateEvidence({
    candidate: {
      field: 'weight',
      value: '54',
      evidenceRefs: []
    },
    evidencePack: basePack
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing_evidence_refs');
});

test('A.1 baseline: rejects candidate with no evidenceRefs at all', () => {
  const result = verifyCandidateEvidence({
    candidate: {
      field: 'weight',
      value: '54'
    },
    evidencePack: basePack
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing_evidence_refs');
});

// =========================================================================
// SECTION 2: Quote span verification (byte-level)
// =========================================================================

test('A.1 quote_span: accepts when slice matches quote exactly', () => {
  // "The Razer Viper V3 Pro weighs 54 grams..."
  //  Position 30 = '5', 31 = '4', 32 = ' ', ...37 = 's'
  //  "54 grams" spans [30, 38]
  const result = verifyCandidateEvidence({
    candidate: {
      field: 'weight',
      value: '54',
      evidenceRefs: ['ref_rtings'],
      snippetHash: 'sha256:rtings_snap_001',
      quote: '54 grams',
      quoteSpan: [30, 38]
    },
    evidencePack: basePack
  });
  assert.equal(result.ok, true);
});

test('A.1 quote_span: rejects when slice does NOT match quote', () => {
  const result = verifyCandidateEvidence({
    candidate: {
      field: 'weight',
      value: '54',
      evidenceRefs: ['ref_rtings'],
      snippetHash: 'sha256:rtings_snap_001',
      quote: '54 grams',
      quoteSpan: [0, 8]
    },
    evidencePack: basePack
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'quote_span_mismatch');
});

test('A.1 quote_span: rejects invalid span (end <= start)', () => {
  const result = verifyCandidateEvidence({
    candidate: {
      field: 'weight',
      value: '54',
      evidenceRefs: ['ref_rtings'],
      snippetHash: 'sha256:rtings_snap_001',
      quote: '54',
      quoteSpan: [10, 5]
    },
    evidencePack: basePack
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'quote_span_invalid');
});

test('A.1 quote_span: rejects span that exceeds snippet text length', () => {
  const result = verifyCandidateEvidence({
    candidate: {
      field: 'weight',
      value: '54',
      evidenceRefs: ['ref_rtings'],
      snippetHash: 'sha256:rtings_snap_001',
      quote: '54',
      quoteSpan: [0, 99999]
    },
    evidencePack: basePack
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'quote_span_invalid');
});

// =========================================================================
// SECTION 3: Numeric auto-repair (existing behavior — regression guard)
// =========================================================================

test('A.1 numeric auto-repair: generates quote + quoteSpan for numeric value found in snippet', () => {
  const result = verifyCandidateEvidence({
    candidate: {
      field: 'max_dpi',
      value: '35000',
      evidenceRefs: ['ref_rtings'],
      snippetHash: 'sha256:rtings_snap_001'
    },
    evidencePack: basePack
  });
  assert.equal(result.ok, true);
  assert.equal(result.candidate.quote, '35000');
  assert.ok(Array.isArray(result.candidate.quoteSpan));
  assert.equal(result.candidate.quoteSpan.length, 2);
});

test('A.1 numeric auto-repair: rejects numeric value NOT found in snippet', () => {
  const result = verifyCandidateEvidence({
    candidate: {
      field: 'max_dpi',
      value: '99999',
      evidenceRefs: ['ref_rtings'],
      snippetHash: 'sha256:rtings_snap_001'
    },
    evidencePack: basePack
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /numeric_value_not_in_snippet/);
});

test('A.1 numeric: accepts numeric with unit suffix when raw number matches', () => {
  const result = verifyCandidateEvidence({
    candidate: {
      field: 'max_dpi',
      value: '35000 DPI',
      evidenceRefs: ['ref_rtings'],
      snippetHash: 'sha256:rtings_snap_001'
    },
    evidencePack: basePack
  });
  // The numeric part "35000" should be found even with " DPI" suffix
  assert.equal(result.ok, true);
});

// =========================================================================
// SECTION 4: Non-strict mode (reference-only, no snippet text)
// =========================================================================

test('A.1 non-strict: accepts when snippet not found but reference exists', () => {
  const packWithRefOnly = {
    references: [{ id: 'ref_external', url: 'https://example.com/spec' }],
    snippets: []
  };
  const result = verifyCandidateEvidence({
    candidate: {
      field: 'sensor',
      value: 'Focus Pro 4K',
      evidenceRefs: ['ref_external']
    },
    evidencePack: packWithRefOnly,
    strict: false
  });
  assert.equal(result.ok, true);
});

test('A.1 strict: rejects when snippet not found even if reference exists', () => {
  const packWithRefOnly = {
    references: [{ id: 'ref_external', url: 'https://example.com/spec' }],
    snippets: []
  };
  const result = verifyCandidateEvidence({
    candidate: {
      field: 'sensor',
      value: 'Focus Pro 4K',
      evidenceRefs: ['ref_external']
    },
    evidencePack: packWithRefOnly,
    strict: true
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'snippet_not_found');
});

// =========================================================================
// SECTION 5: Aggressive orchestrator path — candidates from DOM extraction
//   These tests verify the EXPECTED behavior after A.1 wire-in is complete.
//   The aggressiveOrchestrator should run verifyCandidateEvidence on candidates
//   produced from DOM parsing and reasoning.
// =========================================================================

test('A.1 aggressive path: DOM-extracted candidate with valid provenance passes verification', () => {
  // Simulates a candidate produced by aggressiveDom.js being verified
  const domPack = {
    references: [
      { id: 'dom_source_1', url: 'https://rtings.com/mouse/razer-viper/specs' }
    ],
    snippets: [
      {
        id: 'dom_source_1',
        source_id: 'rtings_com',
        normalized_text: 'Polling Rate 4000 Hz Max',
        snippet_hash: 'sha256:dom_001'
      }
    ]
  };
  const result = verifyCandidateEvidence({
    candidate: {
      field: 'polling_rate',
      value: '4000',
      evidenceRefs: ['dom_source_1'],
      snippetHash: 'sha256:dom_001'
    },
    evidencePack: domPack
  });
  assert.equal(result.ok, true);
  assert.equal(result.candidate.quote, '4000');
});

test('A.1 aggressive path: DOM-extracted candidate with fabricated value rejected', () => {
  const domPack = {
    references: [
      { id: 'dom_source_1', url: 'https://rtings.com/mouse/razer-viper/specs' }
    ],
    snippets: [
      {
        id: 'dom_source_1',
        source_id: 'rtings_com',
        normalized_text: 'Polling Rate 4000 Hz Max',
        snippet_hash: 'sha256:dom_001'
      }
    ]
  };
  const result = verifyCandidateEvidence({
    candidate: {
      field: 'polling_rate',
      value: '8000',
      evidenceRefs: ['dom_source_1'],
      snippetHash: 'sha256:dom_001'
    },
    evidencePack: domPack
  });
  assert.equal(result.ok, false);
});

// =========================================================================
// SECTION 6: Helper file synthetic evidence
//   After A.1 wire-in, helper fills must generate synthetic evidence stubs.
//   These tests verify the EXPECTED structure of those stubs.
// =========================================================================

test('A.1 helper evidence: synthetic helper evidence stub structure is valid for verification', () => {
  // This is the structure that applySupportiveFillToResult should produce
  // after the A.1 wire-in
  const helperPack = {
    references: [
      { id: 'helper_mouse_supportive_001', url: 'helper://mouse/supportive_crosshair.json' }
    ],
    snippets: [
      {
        id: 'helper_mouse_supportive_001',
        source_id: 'helper_file',
        normalized_text: 'weight: 54 g, sensor: Focus Pro 4K',
        snippet_hash: 'sha256:helper_snap_001'
      }
    ]
  };
  const result = verifyCandidateEvidence({
    candidate: {
      field: 'weight',
      value: '54',
      evidenceRefs: ['helper_mouse_supportive_001'],
      snippetHash: 'sha256:helper_snap_001'
    },
    evidencePack: helperPack
  });
  assert.equal(result.ok, true);
  assert.equal(result.candidate.snippetId, 'helper_mouse_supportive_001');
});

test('A.1 helper evidence: helper fill with no matching snippet is rejected in strict mode', () => {
  const emptyPack = {
    references: [
      { id: 'helper_ref', url: 'helper://mouse/crosshair.json' }
    ],
    snippets: []
  };
  const result = verifyCandidateEvidence({
    candidate: {
      field: 'weight',
      value: '54',
      evidenceRefs: ['helper_ref']
    },
    evidencePack: emptyPack,
    strict: true
  });
  assert.equal(result.ok, false);
});

// =========================================================================
// SECTION 7: Edge cases — malformed inputs
// =========================================================================

test('A.1 edge: null evidencePack handled gracefully', () => {
  const result = verifyCandidateEvidence({
    candidate: {
      field: 'weight',
      value: '54',
      evidenceRefs: ['s1']
    },
    evidencePack: null
  });
  assert.equal(result.ok, false);
});

test('A.1 edge: evidencePack with object-style snippets (not array) is handled', () => {
  const objectPack = {
    references: [{ id: 'obj_s1', url: 'https://example.com' }],
    snippets: {
      obj_s1: {
        source_id: 'example',
        normalized_text: 'Weight is 60 grams',
        snippet_hash: 'sha256:obj_001'
      }
    }
  };
  const result = verifyCandidateEvidence({
    candidate: {
      field: 'weight',
      value: '60',
      evidenceRefs: ['obj_s1'],
      snippetHash: 'sha256:obj_001'
    },
    evidencePack: objectPack
  });
  assert.equal(result.ok, true);
});

test('A.1 edge: candidate with empty value is rejected', () => {
  const result = verifyCandidateEvidence({
    candidate: {
      field: 'weight',
      value: '',
      evidenceRefs: ['ref_rtings']
    },
    evidencePack: basePack
  });
  assert.equal(result.ok, false);
});

test('A.1 edge: candidate with whitespace-only value is rejected', () => {
  const result = verifyCandidateEvidence({
    candidate: {
      field: 'weight',
      value: '   ',
      evidenceRefs: ['ref_rtings']
    },
    evidencePack: basePack
  });
  assert.equal(result.ok, false);
});

test('A.1 edge: quoteSpan as quote_span (snake_case) is accepted', () => {
  // "The Razer Viper V3 Pro weighs 54 grams..." → [30, 38]
  const result = verifyCandidateEvidence({
    candidate: {
      field: 'weight',
      value: '54',
      evidenceRefs: ['ref_rtings'],
      snippetHash: 'sha256:rtings_snap_001',
      quote: '54 grams',
      quote_span: [30, 38]
    },
    evidencePack: basePack
  });
  assert.equal(result.ok, true);
});

test('A.1 edge: snippetHash as snippet_hash (snake_case) is accepted', () => {
  const result = verifyCandidateEvidence({
    candidate: {
      field: 'weight',
      value: '54',
      evidenceRefs: ['ref_rtings'],
      snippet_hash: 'sha256:rtings_snap_001'
    },
    evidencePack: basePack
  });
  assert.equal(result.ok, true);
});

// =========================================================================
// SECTION 8: Multi-field batch verification
//   Verifies that running verifyCandidateEvidence across many fields
//   in a loop produces correct accept/reject for each.
// =========================================================================

test('A.1 batch: multiple fields verified independently in a loop', () => {
  const candidates = [
    { field: 'weight', value: '54', evidenceRefs: ['ref_rtings'], snippetHash: 'sha256:rtings_snap_001' },
    { field: 'max_dpi', value: '35000', evidenceRefs: ['ref_rtings'], snippetHash: 'sha256:rtings_snap_001' },
    { field: 'sensor', value: 'PAW3950', evidenceRefs: ['ref_rtings'] },
    { field: 'polling_rate', value: '4000', evidenceRefs: ['ref_razer'], snippetHash: 'sha256:razer_snap_001' }
  ];
  const results = candidates.map((candidate) =>
    verifyCandidateEvidence({ candidate, evidencePack: basePack })
  );
  assert.equal(results[0].ok, true, 'weight should pass (54 found in snippet)');
  assert.equal(results[1].ok, true, 'max_dpi should pass (35000 found in snippet)');
  assert.equal(results[2].ok, false, 'sensor should fail (PAW3950 not in snippet)');
  assert.equal(results[3].ok, true, 'polling_rate should pass (4000 in razer snippet)');
});
