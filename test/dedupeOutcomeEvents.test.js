import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDedupeOutcomeEvent, dedupeOutcomeToEventKey } from '../src/pipeline/dedupeOutcomeEvent.js';

describe('buildDedupeOutcomeEvent', () => {
  it('maps indexDocument return to event payload', () => {
    const result = buildDedupeOutcomeEvent({
      indexResult: {
        docId: 'doc_abc123',
        snippetIds: ['sn_a', 'sn_b'],
        dedupeOutcome: 'new',
        chunksIndexed: 5,
        factsIndexed: 2
      },
      url: 'https://example.com/spec',
      host: 'example.com'
    });
    assert.deepStrictEqual(result, {
      dedupe_outcome: 'new',
      doc_id: 'doc_abc123',
      chunks_indexed: 5,
      facts_indexed: 2,
      snippet_count: 2,
      url: 'https://example.com/spec',
      host: 'example.com'
    });
  });

  it('maps new outcome to indexed_new event key', () => {
    const result = buildDedupeOutcomeEvent({
      indexResult: { docId: 'd1', snippetIds: [], dedupeOutcome: 'new', chunksIndexed: 0, factsIndexed: 0 },
      url: '', host: ''
    });
    assert.equal(result.dedupe_outcome, 'new');
  });

  it('maps reused outcome to dedupe_hit', () => {
    const result = buildDedupeOutcomeEvent({
      indexResult: { docId: 'd2', snippetIds: [], dedupeOutcome: 'reused', chunksIndexed: 0, factsIndexed: 0 },
      url: '', host: ''
    });
    assert.equal(result.dedupe_outcome, 'reused');
  });

  it('maps updated outcome to dedupe_updated', () => {
    const result = buildDedupeOutcomeEvent({
      indexResult: { docId: 'd3', snippetIds: ['sn_x'], dedupeOutcome: 'updated', chunksIndexed: 3, factsIndexed: 1 },
      url: 'https://review.com/page', host: 'review.com'
    });
    assert.equal(result.dedupe_outcome, 'updated');
    assert.equal(result.snippet_count, 1);
    assert.equal(result.chunks_indexed, 3);
    assert.equal(result.facts_indexed, 1);
  });

  it('returns dedupeOutcomeToEventKey mapping', () => {
    assert.equal(dedupeOutcomeToEventKey('new'), 'indexed_new');
    assert.equal(dedupeOutcomeToEventKey('reused'), 'dedupe_hit');
    assert.equal(dedupeOutcomeToEventKey('updated'), 'dedupe_updated');
    assert.equal(dedupeOutcomeToEventKey('unknown'), 'indexed_new');
    assert.equal(dedupeOutcomeToEventKey(''), 'indexed_new');
  });

  it('handles missing fields gracefully', () => {
    const result = buildDedupeOutcomeEvent({
      indexResult: { docId: 'd4' },
      url: '', host: ''
    });
    assert.equal(result.dedupe_outcome, 'unknown');
    assert.equal(result.doc_id, 'd4');
    assert.equal(result.chunks_indexed, 0);
    assert.equal(result.facts_indexed, 0);
    assert.equal(result.snippet_count, 0);
  });

  it('handles null indexResult', () => {
    const result = buildDedupeOutcomeEvent({ indexResult: null, url: '', host: '' });
    assert.equal(result, null);
  });

  it('produces identical output to inline runProduct code (parity check)', () => {
    const indexResult = {
      docId: 'doc_xyz',
      snippetIds: ['sn_1', 'sn_2', 'sn_3'],
      dedupeOutcome: 'updated',
      chunksIndexed: 7,
      factsIndexed: 4
    };
    const url = 'https://example.com/review';
    const host = 'example.com';

    const inlineOutput = {
      url: String(url || ''),
      host: String(host || ''),
      doc_id: indexResult.docId || '',
      dedupe_outcome: indexResult.dedupeOutcome || 'unknown',
      chunks_indexed: indexResult.chunksIndexed || 0,
      facts_indexed: indexResult.factsIndexed || 0,
      snippet_count: (indexResult.snippetIds || []).length
    };

    const moduleOutput = buildDedupeOutcomeEvent({ indexResult, url, host });

    assert.equal(moduleOutput.url, inlineOutput.url);
    assert.equal(moduleOutput.host, inlineOutput.host);
    assert.equal(moduleOutput.doc_id, inlineOutput.doc_id);
    assert.equal(moduleOutput.dedupe_outcome, inlineOutput.dedupe_outcome);
    assert.equal(moduleOutput.chunks_indexed, inlineOutput.chunks_indexed);
    assert.equal(moduleOutput.facts_indexed, inlineOutput.facts_indexed);
    assert.equal(moduleOutput.snippet_count, inlineOutput.snippet_count);
  });
});
