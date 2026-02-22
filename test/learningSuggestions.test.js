import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSearchHints,
  buildAnchorsSuggestions,
  buildKnownValuesSuggestions
} from '../src/learning/learningSuggestionEmitter.js';

test('buildSearchHints produces search_hints from accepted updates', () => {
  const updates = [
    {
      field: 'sensor',
      value: 'Focus Pro 35K',
      evidenceRefs: [{ url: 'https://razer.com/specs', tier: 1 }],
      acceptanceStats: { confidence: 0.97, refs: 3 },
      sourceRunId: 'run-001'
    }
  ];

  const hints = buildSearchHints(updates);
  assert.equal(hints.length, 1);
  assert.equal(hints[0].field, 'sensor');
  assert.equal(hints[0].value, 'Focus Pro 35K');
  assert.ok(Array.isArray(hints[0].evidence_refs));
  assert.ok(hints[0].source_run_id);
});

test('buildAnchorsSuggestions produces anchors from accepted updates', () => {
  const updates = [
    {
      field: 'sensor',
      value: 'Focus Pro 35K',
      evidenceRefs: [{ url: 'https://razer.com/specs', tier: 1 }],
      acceptanceStats: { confidence: 0.97, refs: 3 },
      sourceRunId: 'run-001'
    }
  ];

  const anchors = buildAnchorsSuggestions(updates);
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].field, 'sensor');
  assert.equal(anchors[0].value, 'Focus Pro 35K');
  assert.ok(anchors[0].acceptance_stats);
});

test('buildKnownValuesSuggestions produces known values from accepted updates', () => {
  const updates = [
    {
      field: 'sensor',
      value: 'Focus Pro 35K',
      evidenceRefs: [{ url: 'https://razer.com/specs', tier: 1 }],
      acceptanceStats: { confidence: 0.97, refs: 3 },
      sourceRunId: 'run-001'
    },
    {
      field: 'dpi',
      value: '35000',
      evidenceRefs: [{ url: 'https://razer.com/specs', tier: 1 }],
      acceptanceStats: { confidence: 0.95, refs: 2 },
      sourceRunId: 'run-001'
    }
  ];

  const known = buildKnownValuesSuggestions(updates);
  assert.equal(known.length, 2);
  assert.ok(known.every((item) => item.field && item.value && item.source_run_id));
});

test('each suggestion has required shape: field, value, evidence_refs, acceptance_stats, source_run_id', () => {
  const updates = [
    {
      field: 'weight',
      value: '55g',
      evidenceRefs: [{ url: 'https://a.com', tier: 2 }],
      acceptanceStats: { confidence: 0.9, refs: 2 },
      sourceRunId: 'run-002'
    }
  ];

  const hints = buildSearchHints(updates);
  const anchors = buildAnchorsSuggestions(updates);
  const known = buildKnownValuesSuggestions(updates);

  for (const item of [...hints, ...anchors, ...known]) {
    assert.ok(item.field, 'should have field');
    assert.ok(item.value, 'should have value');
    assert.ok(Array.isArray(item.evidence_refs), 'should have evidence_refs array');
    assert.ok(item.acceptance_stats, 'should have acceptance_stats');
    assert.ok(item.source_run_id, 'should have source_run_id');
  }
});

test('empty updates produce empty suggestions', () => {
  assert.deepStrictEqual(buildSearchHints([]), []);
  assert.deepStrictEqual(buildAnchorsSuggestions([]), []);
  assert.deepStrictEqual(buildKnownValuesSuggestions([]), []);
});
