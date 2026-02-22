import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import {
  generateStableSnippetId,
  generateDocId,
  classifyDedupeOutcome,
  indexDocument,
  getDocumentByHash,
  getChunksForDocument,
  getFactsForField,
  getEvidenceInventory,
  searchEvidenceByField,
  ftsResultsToEvidencePool,
  EVIDENCE_INDEX_SCHEMA
} from '../src/index/evidenceIndexDb.js';

import { buildEvidenceSearchPayload } from '../src/api/evidenceSearch.js';
import { buildDedupeOutcomeEvent, dedupeOutcomeToEventKey } from '../src/pipeline/dedupeOutcomeEvent.js';

function freshDb() {
  const db = new Database(':memory:');
  db.exec(EVIDENCE_INDEX_SCHEMA);
  return db;
}

function makeDocument(overrides = {}) {
  return {
    contentHash: 'abc123hash',
    parserVersion: 'v2',
    url: 'https://example.com/specs',
    host: 'example.com',
    tier: 1,
    role: 'manufacturer',
    category: 'mouse',
    productId: 'mouse-razer-viper-v3-pro',
    ...overrides
  };
}

function makeChunks(count = 2) {
  return Array.from({ length: count }, (_, i) => ({
    chunkIndex: i,
    chunkType: 'paragraph',
    text: `Chunk ${i} text content about sensor and weight`,
    normalizedText: `chunk ${i} text content about sensor and weight`,
    snippetHash: `snhash_${i}`,
    extractionMethod: 'readability',
    fieldHints: ['sensor', 'weight']
  }));
}

function makeFacts(chunkCount = 2) {
  return [
    { chunkIndex: 0, fieldKey: 'weight', valueRaw: '58g', valueNormalized: '58', unit: 'g', extractionMethod: 'readability', confidence: 0.95 },
    { chunkIndex: Math.min(1, chunkCount - 1), fieldKey: 'sensor', valueRaw: 'PAW3950', valueNormalized: 'PAW3950', unit: '', extractionMethod: 'readability', confidence: 0.9 }
  ];
}

describe('Phase 06A — Snippet ID Stability', () => {
  it('generates deterministic snippet IDs from contentHash + parserVersion + chunkIndex', () => {
    const id1 = generateStableSnippetId({ contentHash: 'abc', parserVersion: 'v1', chunkIndex: 0 });
    const id2 = generateStableSnippetId({ contentHash: 'abc', parserVersion: 'v1', chunkIndex: 0 });
    console.log(`[06A] snippet ID stability: id1=${id1}, id2=${id2}, match=${id1 === id2}`);
    assert.equal(id1, id2);
    assert.ok(id1.startsWith('sn_'));
  });

  it('different chunkIndex produces different snippet ID', () => {
    const id0 = generateStableSnippetId({ contentHash: 'abc', parserVersion: 'v1', chunkIndex: 0 });
    const id1 = generateStableSnippetId({ contentHash: 'abc', parserVersion: 'v1', chunkIndex: 1 });
    console.log(`[06A] different chunk index: id0=${id0}, id1=${id1}`);
    assert.notEqual(id0, id1);
  });

  it('different contentHash produces different snippet ID', () => {
    const idA = generateStableSnippetId({ contentHash: 'hashA', parserVersion: 'v1', chunkIndex: 0 });
    const idB = generateStableSnippetId({ contentHash: 'hashB', parserVersion: 'v1', chunkIndex: 0 });
    console.log(`[06A] different content hash: idA=${idA}, idB=${idB}`);
    assert.notEqual(idA, idB);
  });

  it('different parserVersion produces different snippet ID', () => {
    const idV1 = generateStableSnippetId({ contentHash: 'abc', parserVersion: 'v1', chunkIndex: 0 });
    const idV2 = generateStableSnippetId({ contentHash: 'abc', parserVersion: 'v2', chunkIndex: 0 });
    console.log(`[06A] different parser version: idV1=${idV1}, idV2=${idV2}`);
    assert.notEqual(idV1, idV2);
  });

  it('handles missing/null inputs gracefully', () => {
    const id = generateStableSnippetId({ contentHash: null, parserVersion: '', chunkIndex: undefined });
    console.log(`[06A] null inputs snippet ID: ${id}`);
    assert.ok(id.startsWith('sn_'));
    assert.ok(id.length > 4);
  });
});

describe('Phase 06A — Doc ID Generation', () => {
  it('generates deterministic doc IDs from contentHash + parserVersion', () => {
    const id1 = generateDocId({ contentHash: 'abc', parserVersion: 'v1' });
    const id2 = generateDocId({ contentHash: 'abc', parserVersion: 'v1' });
    console.log(`[06A] doc ID stability: id1=${id1}, id2=${id2}, match=${id1 === id2}`);
    assert.equal(id1, id2);
    assert.ok(id1.startsWith('doc_'));
  });

  it('different contentHash produces different doc ID', () => {
    const idA = generateDocId({ contentHash: 'hashA', parserVersion: 'v1' });
    const idB = generateDocId({ contentHash: 'hashB', parserVersion: 'v1' });
    assert.notEqual(idA, idB);
  });

  it('doc ID and snippet ID with same inputs are different (different seed format)', () => {
    const docId = generateDocId({ contentHash: 'abc', parserVersion: 'v1' });
    const snippetId = generateStableSnippetId({ contentHash: 'abc', parserVersion: 'v1', chunkIndex: 0 });
    console.log(`[06A] doc vs snippet: docId=${docId}, snippetId=${snippetId}`);
    assert.notEqual(docId.replace('doc_', ''), snippetId.replace('sn_', ''));
  });
});

describe('Phase 06A — Dedupe Outcome Classification', () => {
  it('returns "new" when no existing document', () => {
    const outcome = classifyDedupeOutcome({ existingDoc: null, incomingContentHash: 'abc' });
    console.log(`[06A] dedupe: no existing → ${outcome}`);
    assert.equal(outcome, 'new');
  });

  it('returns "reused" when existing doc has same content_hash', () => {
    const outcome = classifyDedupeOutcome({
      existingDoc: { content_hash: 'abc', doc_id: 'doc_123' },
      incomingContentHash: 'abc'
    });
    console.log(`[06A] dedupe: same hash → ${outcome}`);
    assert.equal(outcome, 'reused');
  });

  it('returns "updated" when existing doc has different content_hash', () => {
    const outcome = classifyDedupeOutcome({
      existingDoc: { content_hash: 'old_hash', doc_id: 'doc_123' },
      incomingContentHash: 'new_hash'
    });
    console.log(`[06A] dedupe: different hash → ${outcome}`);
    assert.equal(outcome, 'updated');
  });

  it('BUG 06A-a: "updated" is unreachable via indexDocument because getDocumentByHash queries by exact content_hash', () => {
    const db = freshDb();
    const doc = makeDocument();
    const chunks = makeChunks(1);

    const first = indexDocument({ db, document: doc, chunks, facts: [] });
    console.log(`[06A-BUG-a] first insert: outcome=${first.dedupeOutcome}`);
    assert.equal(first.dedupeOutcome, 'new');

    const second = indexDocument({ db, document: doc, chunks, facts: [] });
    console.log(`[06A-BUG-a] same hash re-insert: outcome=${second.dedupeOutcome}`);
    assert.equal(second.dedupeOutcome, 'reused');

    const differentContent = indexDocument({
      db,
      document: { ...doc, contentHash: 'different_hash_from_page_change' },
      chunks,
      facts: []
    });
    console.log(`[06A-BUG-a] different hash (page content changed): outcome=${differentContent.dedupeOutcome}`);
    assert.equal(differentContent.dedupeOutcome, 'new',
      'BUG: changing content_hash yields "new" not "updated" because getDocumentByHash finds no match for the new hash');
  });
});

describe('Phase 06A — indexDocument Full Lifecycle', () => {
  it('indexes document with chunks and returns snippet IDs', () => {
    const db = freshDb();
    const result = indexDocument({
      db,
      document: makeDocument(),
      chunks: makeChunks(3),
      facts: []
    });
    console.log(`[06A] index: docId=${result.docId}, snippets=${result.snippetIds.length}, chunks=${result.chunksIndexed}`);
    assert.ok(result.docId.startsWith('doc_'));
    assert.equal(result.snippetIds.length, 3);
    assert.equal(result.chunksIndexed, 3);
    assert.equal(result.dedupeOutcome, 'new');
  });

  it('reused outcome returns existing docId and zero chunks', () => {
    const db = freshDb();
    const doc = makeDocument();
    const chunks = makeChunks(2);
    const first = indexDocument({ db, document: doc, chunks, facts: [] });
    const second = indexDocument({ db, document: doc, chunks, facts: [] });
    console.log(`[06A] reuse: firstDocId=${first.docId}, secondDocId=${second.docId}, outcome=${second.dedupeOutcome}`);
    assert.equal(second.dedupeOutcome, 'reused');
    assert.equal(second.docId, first.docId);
    assert.equal(second.chunksIndexed, 0);
    assert.deepStrictEqual(second.snippetIds, []);
  });

  it('indexes facts linked to chunks', () => {
    const db = freshDb();
    const chunks = makeChunks(2);
    const facts = makeFacts(2);
    const result = indexDocument({
      db,
      document: makeDocument(),
      chunks,
      facts
    });
    console.log(`[06A] facts indexed: ${result.factsIndexed}`);
    assert.equal(result.factsIndexed, 2);
  });

  it('facts with invalid chunkIndex are silently skipped', () => {
    const db = freshDb();
    const result = indexDocument({
      db,
      document: makeDocument(),
      chunks: makeChunks(1),
      facts: [{ chunkIndex: 99, fieldKey: 'weight', valueRaw: '58g', confidence: 0.9 }]
    });
    console.log(`[06A] facts with bad chunkIndex: factsIndexed=${result.factsIndexed}`);
    assert.equal(result.factsIndexed, 0);
  });
});

describe('Phase 06A — Query Functions', () => {
  it('getDocumentByHash finds existing document', () => {
    const db = freshDb();
    indexDocument({ db, document: makeDocument(), chunks: makeChunks(1), facts: [] });
    const found = getDocumentByHash({ db, contentHash: 'abc123hash', parserVersion: 'v2' });
    console.log(`[06A] getDocByHash: found=${!!found}, url=${found?.url}`);
    assert.ok(found);
    assert.equal(found.url, 'https://example.com/specs');
    assert.equal(found.tier, 1);
  });

  it('getDocumentByHash returns null for unknown hash', () => {
    const db = freshDb();
    const result = getDocumentByHash({ db, contentHash: 'unknown', parserVersion: 'v1' });
    assert.equal(result, null);
  });

  it('getChunksForDocument returns chunks in order', () => {
    const db = freshDb();
    const result = indexDocument({ db, document: makeDocument(), chunks: makeChunks(3), facts: [] });
    const chunks = getChunksForDocument({ db, docId: result.docId });
    console.log(`[06A] chunks retrieved: ${chunks.length}, indices=[${chunks.map(c => c.chunk_index)}]`);
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0].chunk_index, 0);
    assert.equal(chunks[1].chunk_index, 1);
    assert.equal(chunks[2].chunk_index, 2);
  });

  it('getFactsForField returns facts with joined chunk/doc data', () => {
    const db = freshDb();
    indexDocument({
      db,
      document: makeDocument(),
      chunks: makeChunks(2),
      facts: makeFacts(2)
    });
    const facts = getFactsForField({ db, category: 'mouse', productId: 'mouse-razer-viper-v3-pro', fieldKey: 'weight' });
    console.log(`[06A] facts for weight: ${facts.length}, value=${facts[0]?.value_raw}`);
    assert.equal(facts.length, 1);
    assert.equal(facts[0].value_raw, '58g');
    assert.equal(facts[0].url, 'https://example.com/specs');
    assert.ok(facts[0].snippet_id);
  });

  it('getFactsForField returns empty for unindexed field', () => {
    const db = freshDb();
    indexDocument({ db, document: makeDocument(), chunks: makeChunks(1), facts: [] });
    const facts = getFactsForField({ db, category: 'mouse', productId: 'mouse-razer-viper-v3-pro', fieldKey: 'weight' });
    assert.equal(facts.length, 0);
  });
});

describe('Phase 06A — Evidence Inventory', () => {
  it('counts documents, chunks, facts, and unique hashes', () => {
    const db = freshDb();
    indexDocument({ db, document: makeDocument(), chunks: makeChunks(2), facts: makeFacts(2) });
    indexDocument({
      db,
      document: makeDocument({ contentHash: 'different_hash', url: 'https://review.com/mouse' }),
      chunks: makeChunks(3),
      facts: []
    });
    const inv = getEvidenceInventory({ db, category: 'mouse', productId: 'mouse-razer-viper-v3-pro' });
    console.log(`[06A] inventory: docs=${inv.documentCount}, chunks=${inv.chunkCount}, facts=${inv.factCount}, uniqueHashes=${inv.uniqueHashes}`);
    assert.equal(inv.documentCount, 2);
    assert.equal(inv.chunkCount, 5);
    assert.equal(inv.factCount, 2);
    assert.equal(inv.uniqueHashes, 2);
  });

  it('BUG 06A-b: dedupeHits always 0 because reused docs are never written to DB', () => {
    const db = freshDb();
    const doc = makeDocument();
    indexDocument({ db, document: doc, chunks: makeChunks(1), facts: [] });

    const reusedResult = indexDocument({ db, document: doc, chunks: makeChunks(1), facts: [] });
    assert.equal(reusedResult.dedupeOutcome, 'reused');

    const inv = getEvidenceInventory({ db, category: 'mouse', productId: 'mouse-razer-viper-v3-pro' });
    console.log(`[06A-BUG-b] dedupeHits after reuse: ${inv.dedupeHits} (expected 0 due to bug — reused docs skip DB write)`);
    assert.equal(inv.dedupeHits, 0,
      'BUG: getEvidenceInventory queries dedupe_outcome="reused" but indexDocument skips DB write for reused docs');
  });

  it('returns zeros for unknown category/product', () => {
    const db = freshDb();
    const inv = getEvidenceInventory({ db, category: 'keyboard', productId: 'unknown' });
    assert.equal(inv.documentCount, 0);
    assert.equal(inv.chunkCount, 0);
    assert.equal(inv.factCount, 0);
  });
});

describe('Phase 06A — FTS Search', () => {
  it('finds chunks by field key terms', () => {
    const db = freshDb();
    indexDocument({
      db,
      document: makeDocument(),
      chunks: [
        { chunkIndex: 0, chunkType: 'paragraph', text: 'The sensor is PAW3950 optical', normalizedText: 'sensor paw3950 optical', snippetHash: 'h0', extractionMethod: 'readability', fieldHints: ['sensor'] },
        { chunkIndex: 1, chunkType: 'paragraph', text: 'Weight is 58 grams lightweight', normalizedText: 'weight 58 grams lightweight', snippetHash: 'h1', extractionMethod: 'readability', fieldHints: ['weight'] }
      ],
      facts: []
    });
    const results = searchEvidenceByField({
      db,
      category: 'mouse',
      productId: 'mouse-razer-viper-v3-pro',
      fieldKey: 'sensor',
      queryTerms: ['PAW3950']
    });
    console.log(`[06A] FTS sensor search: ${results.length} results, first snippet=${results[0]?.snippet_id}`);
    assert.ok(results.length >= 1);
    assert.ok(results[0].text.includes('PAW3950'));
  });

  it('returns empty for no-match query', () => {
    const db = freshDb();
    indexDocument({ db, document: makeDocument(), chunks: makeChunks(1), facts: [] });
    const results = searchEvidenceByField({
      db,
      category: 'mouse',
      productId: 'mouse-razer-viper-v3-pro',
      fieldKey: 'nonexistent_field',
      queryTerms: ['zzzzzznotfound']
    });
    assert.equal(results.length, 0);
  });

  it('respects maxResults cap', () => {
    const db = freshDb();
    const manyChunks = Array.from({ length: 10 }, (_, i) => ({
      chunkIndex: i,
      chunkType: 'paragraph',
      text: `sensor data chunk ${i} PAW3950`,
      normalizedText: `sensor data chunk ${i} paw3950`,
      snippetHash: `h${i}`,
      extractionMethod: 'readability',
      fieldHints: ['sensor']
    }));
    indexDocument({ db, document: makeDocument(), chunks: manyChunks, facts: [] });
    const results = searchEvidenceByField({
      db,
      category: 'mouse',
      productId: 'mouse-razer-viper-v3-pro',
      fieldKey: 'sensor',
      queryTerms: ['PAW3950'],
      maxResults: 3
    });
    console.log(`[06A] FTS maxResults=3: got ${results.length}`);
    assert.ok(results.length <= 3);
  });

  it('returns empty when all query terms are too short (< 2 chars)', () => {
    const db = freshDb();
    indexDocument({ db, document: makeDocument(), chunks: makeChunks(1), facts: [] });
    const results = searchEvidenceByField({
      db,
      category: 'mouse',
      productId: 'mouse-razer-viper-v3-pro',
      fieldKey: '',
      queryTerms: ['a']
    });
    assert.equal(results.length, 0);
  });
});

describe('Phase 06A — FTS to Evidence Pool Mapping', () => {
  it('maps FTS results to evidence pool shape', () => {
    const ftsResults = [
      { snippet_id: 'sn_abc', url: 'https://example.com', host: 'example.com', tier: 1, role: 'manufacturer', extraction_method: 'readability', snippet_hash: 'hash1', content_hash: 'chash1', text: 'sensor PAW3950', normalized_text: 'sensor paw3950', rank: -5.2 }
    ];
    const pool = ftsResultsToEvidencePool({ ftsResults });
    console.log(`[06A] FTS→pool: ${pool.length} items, url=${pool[0]?.url}, tier=${pool[0]?.tier}`);
    assert.equal(pool.length, 1);
    assert.equal(pool[0].url, 'https://example.com');
    assert.equal(pool[0].tier, 1);
    assert.equal(pool[0].snippet_id, 'sn_abc');
    assert.equal(pool[0].content_hash, 'chash1');
    assert.deepStrictEqual(pool[0].evidence_refs, ['sn_abc']);
    assert.ok(pool[0].quote.length > 0);
  });

  it('returns empty array for empty FTS results', () => {
    const pool = ftsResultsToEvidencePool({ ftsResults: [] });
    assert.equal(pool.length, 0);
  });

  it('handles missing fields in FTS rows gracefully', () => {
    const pool = ftsResultsToEvidencePool({ ftsResults: [{ snippet_id: '', url: '' }] });
    assert.equal(pool.length, 1);
    assert.equal(pool[0].url, '');
    assert.equal(pool[0].tier, null);
  });
});

describe('Phase 06A — Evidence Search Payload Builder (unwrapPayload)', () => {
  it('handles flat events (no payload wrapper)', () => {
    const result = buildEvidenceSearchPayload({
      dedupeEvents: [
        { dedupe_outcome: 'new', chunks_indexed: 5 },
        { dedupe_outcome: 'reused', chunks_indexed: 0 }
      ]
    });
    console.log(`[06A] flat events: new=${result.dedupe_stream.new_count}, reused=${result.dedupe_stream.reused_count}`);
    assert.equal(result.dedupe_stream.new_count, 1);
    assert.equal(result.dedupe_stream.reused_count, 1);
    assert.equal(result.dedupe_stream.total_chunks_indexed, 5);
  });

  it('handles wrapped events (payload nesting — production format)', () => {
    const result = buildEvidenceSearchPayload({
      dedupeEvents: [
        { event: 'indexed_new', payload: { dedupe_outcome: 'new', chunks_indexed: 8, scope: 'evidence_index' } },
        { event: 'dedupe_hit', payload: { dedupe_outcome: 'reused', chunks_indexed: 0, scope: 'evidence_index' } },
        { event: 'dedupe_updated', payload: { dedupe_outcome: 'updated', chunks_indexed: 3, scope: 'evidence_index' } }
      ]
    });
    console.log(`[06A] wrapped events: new=${result.dedupe_stream.new_count}, reused=${result.dedupe_stream.reused_count}, updated=${result.dedupe_stream.updated_count}, chunks=${result.dedupe_stream.total_chunks_indexed}`);
    assert.equal(result.dedupe_stream.total, 3);
    assert.equal(result.dedupe_stream.new_count, 1);
    assert.equal(result.dedupe_stream.reused_count, 1);
    assert.equal(result.dedupe_stream.updated_count, 1);
    assert.equal(result.dedupe_stream.total_chunks_indexed, 11);
  });

  it('unknown dedupe_outcome in wrapped event is uncounted but included in total', () => {
    const result = buildEvidenceSearchPayload({
      dedupeEvents: [
        { event: 'indexed_new', payload: { dedupe_outcome: 'unknown', chunks_indexed: 2 } }
      ]
    });
    console.log(`[06A] unknown outcome: total=${result.dedupe_stream.total}, new=${result.dedupe_stream.new_count}`);
    assert.equal(result.dedupe_stream.total, 1);
    assert.equal(result.dedupe_stream.new_count, 0);
    assert.equal(result.dedupe_stream.reused_count, 0);
    assert.equal(result.dedupe_stream.updated_count, 0);
  });
});

describe('Phase 06A — Dedupe Outcome Event Key Mapping Consistency', () => {
  it('dedupeOutcomeToEventKey matches runtimeBridge inline mapping', () => {
    const runtimeBridgeMapping = (outcome) => {
      const o = String(outcome || 'unknown').trim();
      return o === 'reused' ? 'dedupe_hit'
        : o === 'updated' ? 'dedupe_updated'
        : 'indexed_new';
    };

    const outcomes = ['new', 'reused', 'updated', 'unknown', '', null];
    for (const outcome of outcomes) {
      const fromModule = dedupeOutcomeToEventKey(outcome);
      const fromBridge = runtimeBridgeMapping(outcome);
      console.log(`[06A] mapping consistency: outcome="${outcome}" → module=${fromModule}, bridge=${fromBridge}, match=${fromModule === fromBridge}`);
      assert.equal(fromModule, fromBridge, `Mapping divergence for outcome="${outcome}"`);
    }
  });

  it('buildDedupeOutcomeEvent produces correct payload shape', () => {
    const event = buildDedupeOutcomeEvent({
      indexResult: { dedupeOutcome: 'new', docId: 'doc_abc', chunksIndexed: 5, factsIndexed: 2, snippetIds: ['sn_1', 'sn_2'] },
      url: 'https://example.com',
      host: 'example.com'
    });
    console.log(`[06A] dedupe event shape: outcome=${event.dedupe_outcome}, docId=${event.doc_id}, snippets=${event.snippet_count}`);
    assert.equal(event.dedupe_outcome, 'new');
    assert.equal(event.doc_id, 'doc_abc');
    assert.equal(event.chunks_indexed, 5);
    assert.equal(event.facts_indexed, 2);
    assert.equal(event.snippet_count, 2);
    assert.equal(event.url, 'https://example.com');
  });

  it('buildDedupeOutcomeEvent returns null for null indexResult', () => {
    const event = buildDedupeOutcomeEvent({ indexResult: null, url: '', host: '' });
    assert.equal(event, null);
  });
});

describe('Phase 06A — Production Integration: facts always empty', () => {
  it('BUG 06A-c: production always passes facts=[] so evidence_facts stays empty', () => {
    const db = freshDb();
    const result = indexDocument({
      db,
      document: makeDocument(),
      chunks: makeChunks(2),
      facts: []
    });
    console.log(`[06A-BUG-c] factsIndexed with empty facts: ${result.factsIndexed}`);
    assert.equal(result.factsIndexed, 0);

    const factRows = getFactsForField({ db, category: 'mouse', productId: 'mouse-razer-viper-v3-pro', fieldKey: 'weight' });
    console.log(`[06A-BUG-c] fact rows after indexing with facts=[]: ${factRows.length}`);
    assert.equal(factRows.length, 0, 'facts=[] means evidence_facts table is never populated in production');
  });

  it('facts layer works correctly when facts are actually provided', () => {
    const db = freshDb();
    const result = indexDocument({
      db,
      document: makeDocument(),
      chunks: makeChunks(2),
      facts: makeFacts(2)
    });
    console.log(`[06A] factsIndexed with real facts: ${result.factsIndexed}`);
    assert.equal(result.factsIndexed, 2);

    const weightFacts = getFactsForField({ db, category: 'mouse', productId: 'mouse-razer-viper-v3-pro', fieldKey: 'weight' });
    assert.equal(weightFacts.length, 1);
    assert.equal(weightFacts[0].value_raw, '58g');

    const sensorFacts = getFactsForField({ db, category: 'mouse', productId: 'mouse-razer-viper-v3-pro', fieldKey: 'sensor' });
    assert.equal(sensorFacts.length, 1);
    assert.equal(sensorFacts[0].value_raw, 'PAW3950');
  });
});
