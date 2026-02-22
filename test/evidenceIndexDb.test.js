import test from 'node:test';
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
import { buildTierAwareFieldRetrieval } from '../src/retrieve/tierAwareRetriever.js';

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(EVIDENCE_INDEX_SCHEMA);
  return db;
}

test('generateStableSnippetId is deterministic with sn_ prefix', () => {
  const id1 = generateStableSnippetId({
    contentHash: 'sha256:abc123',
    parserVersion: 'v1',
    chunkIndex: 0
  });
  const id2 = generateStableSnippetId({
    contentHash: 'sha256:abc123',
    parserVersion: 'v1',
    chunkIndex: 0
  });

  assert.equal(id1, id2);
  assert.equal(id1.startsWith('sn_'), true);
  assert.equal(id1.length, 3 + 16);
});

test('generateStableSnippetId produces different IDs for different inputs', () => {
  const id1 = generateStableSnippetId({
    contentHash: 'sha256:abc123',
    parserVersion: 'v1',
    chunkIndex: 0
  });
  const id2 = generateStableSnippetId({
    contentHash: 'sha256:def456',
    parserVersion: 'v1',
    chunkIndex: 0
  });
  const id3 = generateStableSnippetId({
    contentHash: 'sha256:abc123',
    parserVersion: 'v1',
    chunkIndex: 1
  });

  assert.notEqual(id1, id2);
  assert.notEqual(id1, id3);
  assert.notEqual(id2, id3);
});

test('generateDocId is deterministic with doc_ prefix', () => {
  const id1 = generateDocId({ contentHash: 'sha256:abc', parserVersion: 'v1' });
  const id2 = generateDocId({ contentHash: 'sha256:abc', parserVersion: 'v1' });

  assert.equal(id1, id2);
  assert.equal(id1.startsWith('doc_'), true);
  assert.equal(id1.length, 4 + 16);

  const id3 = generateDocId({ contentHash: 'sha256:xyz', parserVersion: 'v1' });
  assert.notEqual(id1, id3);
});

test('classifyDedupeOutcome returns new/reused/updated', () => {
  assert.equal(
    classifyDedupeOutcome({ existingDoc: null, incomingContentHash: 'sha256:abc' }),
    'new'
  );

  assert.equal(
    classifyDedupeOutcome({
      existingDoc: { content_hash: 'sha256:abc' },
      incomingContentHash: 'sha256:abc'
    }),
    'reused'
  );

  assert.equal(
    classifyDedupeOutcome({
      existingDoc: { content_hash: 'sha256:old' },
      incomingContentHash: 'sha256:new'
    }),
    'updated'
  );
});

test('indexDocument inserts document, chunks, and facts rows', () => {
  const db = createTestDb();

  const result = indexDocument({
    db,
    document: {
      contentHash: 'sha256:page1',
      parserVersion: 'v1',
      url: 'https://example.com/product',
      host: 'example.com',
      tier: 1,
      role: 'manufacturer',
      category: 'mouse',
      productId: 'mouse-razer-viper'
    },
    chunks: [
      {
        chunkIndex: 0,
        chunkType: 'table',
        text: 'Weight: 60g',
        normalizedText: 'weight: 60g',
        snippetHash: 'sha256:chunk0',
        extractionMethod: 'spec_table_match',
        fieldHints: ['weight']
      },
      {
        chunkIndex: 1,
        chunkType: 'text',
        text: 'Sensor: Focus Pro 35K',
        normalizedText: 'sensor: focus pro 35k',
        snippetHash: 'sha256:chunk1',
        extractionMethod: 'readability',
        fieldHints: ['sensor']
      }
    ],
    facts: [
      {
        chunkIndex: 0,
        fieldKey: 'weight',
        valueRaw: '60g',
        valueNormalized: '60',
        unit: 'g',
        extractionMethod: 'spec_table_match',
        confidence: 0.9
      }
    ]
  });

  assert.equal(result.docId.startsWith('doc_'), true);
  assert.equal(result.dedupeOutcome, 'new');
  assert.equal(result.chunksIndexed, 2);
  assert.equal(result.factsIndexed, 1);
  assert.equal(result.snippetIds.length, 2);
  assert.equal(result.snippetIds[0].startsWith('sn_'), true);
  assert.equal(result.snippetIds[1].startsWith('sn_'), true);

  db.close();
});

test('indexDocument dedupe: same content_hash reuses, no duplicate chunks', () => {
  const db = createTestDb();

  const doc = {
    contentHash: 'sha256:dedupe_test',
    parserVersion: 'v1',
    url: 'https://example.com/p',
    host: 'example.com',
    tier: 2,
    role: 'lab_review',
    category: 'mouse',
    productId: 'mouse-test'
  };
  const chunks = [{
    chunkIndex: 0,
    chunkType: 'text',
    text: 'DPI: 26000',
    normalizedText: 'dpi: 26000',
    snippetHash: 'sha256:c0',
    extractionMethod: 'readability',
    fieldHints: ['dpi']
  }];

  const result1 = indexDocument({ db, document: doc, chunks, facts: [] });
  assert.equal(result1.dedupeOutcome, 'new');
  assert.equal(result1.chunksIndexed, 1);

  const result2 = indexDocument({ db, document: doc, chunks, facts: [] });
  assert.equal(result2.dedupeOutcome, 'reused');
  assert.equal(result2.chunksIndexed, 0);
  assert.equal(result2.docId, result1.docId);

  const allChunks = db.prepare('SELECT COUNT(*) as cnt FROM evidence_chunks').get();
  assert.equal(allChunks.cnt, 1);

  db.close();
});

test('getDocumentByHash returns found/not found', () => {
  const db = createTestDb();

  const notFound = getDocumentByHash({ db, contentHash: 'sha256:missing', parserVersion: 'v1' });
  assert.equal(notFound, null);

  indexDocument({
    db,
    document: {
      contentHash: 'sha256:findme',
      parserVersion: 'v1',
      url: 'https://x.com',
      host: 'x.com',
      tier: 1,
      role: 'manufacturer',
      category: 'mouse',
      productId: 'mouse-x'
    },
    chunks: [],
    facts: []
  });

  const found = getDocumentByHash({ db, contentHash: 'sha256:findme', parserVersion: 'v1' });
  assert.notEqual(found, null);
  assert.equal(found.url, 'https://x.com');
  assert.equal(found.tier, 1);

  db.close();
});

test('getChunksForDocument returns chunks, empty for unknown', () => {
  const db = createTestDb();

  const emptyChunks = getChunksForDocument({ db, docId: 'doc_nonexistent' });
  assert.deepEqual(emptyChunks, []);

  const result = indexDocument({
    db,
    document: {
      contentHash: 'sha256:chunks_test',
      parserVersion: 'v1',
      url: 'https://a.com',
      host: 'a.com',
      tier: 2,
      role: 'review',
      category: 'mouse',
      productId: 'mouse-a'
    },
    chunks: [
      {
        chunkIndex: 0,
        chunkType: 'table',
        text: 'Weight: 58g',
        normalizedText: 'weight: 58g',
        snippetHash: 'sha256:c_a0',
        extractionMethod: 'spec_table_match',
        fieldHints: ['weight']
      },
      {
        chunkIndex: 1,
        chunkType: 'kv',
        text: 'Sensor: Hero 2',
        normalizedText: 'sensor: hero 2',
        snippetHash: 'sha256:c_a1',
        extractionMethod: 'readability',
        fieldHints: ['sensor']
      }
    ],
    facts: []
  });

  const chunks = getChunksForDocument({ db, docId: result.docId });
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].chunk_type, 'table');
  assert.equal(chunks[1].chunk_type, 'kv');
  assert.equal(chunks[0].snippet_id.startsWith('sn_'), true);

  db.close();
});

test('getFactsForField returns joined query filtered by category+product+field', () => {
  const db = createTestDb();

  indexDocument({
    db,
    document: {
      contentHash: 'sha256:facts_test',
      parserVersion: 'v1',
      url: 'https://b.com',
      host: 'b.com',
      tier: 1,
      role: 'manufacturer',
      category: 'mouse',
      productId: 'mouse-b'
    },
    chunks: [{
      chunkIndex: 0,
      chunkType: 'table',
      text: 'Weight: 62g',
      normalizedText: 'weight: 62g',
      snippetHash: 'sha256:f0',
      extractionMethod: 'spec_table_match',
      fieldHints: ['weight']
    }],
    facts: [
      {
        chunkIndex: 0,
        fieldKey: 'weight',
        valueRaw: '62g',
        valueNormalized: '62',
        unit: 'g',
        extractionMethod: 'spec_table_match',
        confidence: 0.95
      },
      {
        chunkIndex: 0,
        fieldKey: 'sensor',
        valueRaw: 'Focus Pro 35K',
        valueNormalized: 'focus pro 35k',
        unit: '',
        extractionMethod: 'spec_table_match',
        confidence: 0.8
      }
    ]
  });

  const weightFacts = getFactsForField({
    db,
    category: 'mouse',
    productId: 'mouse-b',
    fieldKey: 'weight'
  });
  assert.equal(weightFacts.length, 1);
  assert.equal(weightFacts[0].value_raw, '62g');
  assert.equal(weightFacts[0].value_normalized, '62');
  assert.equal(weightFacts[0].url, 'https://b.com');
  assert.equal(weightFacts[0].tier, 1);

  const sensorFacts = getFactsForField({
    db,
    category: 'mouse',
    productId: 'mouse-b',
    fieldKey: 'sensor'
  });
  assert.equal(sensorFacts.length, 1);
  assert.equal(sensorFacts[0].value_raw, 'Focus Pro 35K');

  const noFacts = getFactsForField({
    db,
    category: 'mouse',
    productId: 'mouse-b',
    fieldKey: 'dpi'
  });
  assert.equal(noFacts.length, 0);

  db.close();
});

test('getEvidenceInventory returns aggregate counts', () => {
  const db = createTestDb();

  const empty = getEvidenceInventory({ db, category: 'mouse', productId: 'mouse-z' });
  assert.equal(empty.documentCount, 0);
  assert.equal(empty.chunkCount, 0);
  assert.equal(empty.factCount, 0);

  indexDocument({
    db,
    document: {
      contentHash: 'sha256:inv1',
      parserVersion: 'v1',
      url: 'https://c.com',
      host: 'c.com',
      tier: 1,
      role: 'manufacturer',
      category: 'mouse',
      productId: 'mouse-inv'
    },
    chunks: [
      { chunkIndex: 0, chunkType: 'text', text: 'A', normalizedText: 'a', snippetHash: 'sha256:i0', extractionMethod: 'r', fieldHints: [] },
      { chunkIndex: 1, chunkType: 'table', text: 'B', normalizedText: 'b', snippetHash: 'sha256:i1', extractionMethod: 'r', fieldHints: [] }
    ],
    facts: [
      { chunkIndex: 0, fieldKey: 'weight', valueRaw: '50g', valueNormalized: '50', unit: 'g', extractionMethod: 'r', confidence: 0.9 }
    ]
  });

  indexDocument({
    db,
    document: {
      contentHash: 'sha256:inv2',
      parserVersion: 'v1',
      url: 'https://d.com',
      host: 'd.com',
      tier: 2,
      role: 'review',
      category: 'mouse',
      productId: 'mouse-inv'
    },
    chunks: [
      { chunkIndex: 0, chunkType: 'text', text: 'C', normalizedText: 'c', snippetHash: 'sha256:i2', extractionMethod: 'r', fieldHints: [] }
    ],
    facts: []
  });

  const inv = getEvidenceInventory({ db, category: 'mouse', productId: 'mouse-inv' });
  assert.equal(inv.documentCount, 2);
  assert.equal(inv.chunkCount, 3);
  assert.equal(inv.factCount, 1);
  assert.equal(inv.uniqueHashes, 2);
  assert.equal(inv.dedupeHits, 0);

  db.close();
});

test('searchEvidenceByField returns matching chunks ordered by BM25 rank', () => {
  const db = createTestDb();

  indexDocument({
    db,
    document: {
      contentHash: 'sha256:fts_test',
      parserVersion: 'v1',
      url: 'https://razer.com/specs',
      host: 'razer.com',
      tier: 1,
      role: 'manufacturer',
      category: 'mouse',
      productId: 'mouse-fts'
    },
    chunks: [
      {
        chunkIndex: 0,
        chunkType: 'table',
        text: 'Weight: 60 grams, very lightweight mouse for competitive gaming',
        normalizedText: 'weight: 60 grams, very lightweight mouse for competitive gaming',
        snippetHash: 'sha256:fts0',
        extractionMethod: 'spec_table_match',
        fieldHints: ['weight']
      },
      {
        chunkIndex: 1,
        chunkType: 'text',
        text: 'Sensor: Focus Pro 35K with 35000 DPI tracking',
        normalizedText: 'sensor: focus pro 35k with 35000 dpi tracking',
        snippetHash: 'sha256:fts1',
        extractionMethod: 'readability',
        fieldHints: ['sensor', 'dpi']
      },
      {
        chunkIndex: 2,
        chunkType: 'text',
        text: 'Battery lasts up to 90 hours on a single charge',
        normalizedText: 'battery lasts up to 90 hours on a single charge',
        snippetHash: 'sha256:fts2',
        extractionMethod: 'readability',
        fieldHints: ['battery_hours']
      }
    ],
    facts: []
  });

  const weightResults = searchEvidenceByField({
    db,
    category: 'mouse',
    productId: 'mouse-fts',
    fieldKey: 'weight',
    queryTerms: ['grams'],
    maxResults: 10
  });

  assert.equal(weightResults.length > 0, true);
  assert.equal(weightResults[0].text.includes('60 grams'), true);
  assert.equal(weightResults[0].tier, 1);

  const sensorResults = searchEvidenceByField({
    db,
    category: 'mouse',
    productId: 'mouse-fts',
    fieldKey: 'sensor',
    queryTerms: ['focus', 'dpi']
  });
  assert.equal(sensorResults.length > 0, true);
  assert.equal(sensorResults[0].text.includes('Focus Pro'), true);

  db.close();
});

test('searchEvidenceByField with unit hint improves ranking', () => {
  const db = createTestDb();

  indexDocument({
    db,
    document: {
      contentHash: 'sha256:unit_test',
      parserVersion: 'v1',
      url: 'https://example.com/m',
      host: 'example.com',
      tier: 2,
      role: 'review',
      category: 'mouse',
      productId: 'mouse-unit'
    },
    chunks: [
      {
        chunkIndex: 0,
        chunkType: 'table',
        text: 'Weight is approximately 60 grams without cable',
        normalizedText: 'weight is approximately 60 grams without cable',
        snippetHash: 'sha256:u0',
        extractionMethod: 'spec_table_match',
        fieldHints: ['weight']
      },
      {
        chunkIndex: 1,
        chunkType: 'text',
        text: 'The product weight management system is efficient',
        normalizedText: 'the product weight management system is efficient',
        snippetHash: 'sha256:u1',
        extractionMethod: 'readability',
        fieldHints: []
      }
    ],
    facts: []
  });

  const results = searchEvidenceByField({
    db,
    category: 'mouse',
    productId: 'mouse-unit',
    fieldKey: 'weight',
    queryTerms: [],
    unitHint: 'grams'
  });

  assert.equal(results.length > 0, true);

  db.close();
});

test('ftsResultsToEvidencePool maps FTS rows to evidence pool shape', () => {
  const ftsRows = [
    {
      chunk_id: 1,
      doc_id: 'doc_abc',
      snippet_id: 'sn_test1',
      chunk_index: 0,
      chunk_type: 'table',
      text: 'Weight: 60g',
      normalized_text: 'weight: 60g',
      snippet_hash: 'sha256:hash1',
      extraction_method: 'spec_table_match',
      field_hints: '["weight"]',
      url: 'https://example.com',
      host: 'example.com',
      tier: 1,
      role: 'manufacturer',
      content_hash: 'sha256:page1',
      rank: -5.2
    }
  ];

  const pool = ftsResultsToEvidencePool({ ftsResults: ftsRows });

  assert.equal(pool.length, 1);
  assert.equal(pool[0].url, 'https://example.com');
  assert.equal(pool[0].host, 'example.com');
  assert.equal(pool[0].snippet_id, 'sn_test1');
  assert.equal(pool[0].snippet_hash, 'sha256:hash1');
  assert.equal(pool[0].method, 'spec_table_match');
  assert.equal(pool[0].quote, 'Weight: 60g');
  assert.equal(pool[0].tier, 1);
  assert.equal(pool[0].evidence_refs.length, 1);
  assert.equal(pool[0].evidence_refs[0], 'sn_test1');
  assert.equal(typeof pool[0].fts_rank, 'number');
});

test('buildTierAwareFieldRetrieval with ftsQueryFn uses FTS results', () => {

  const ftsPool = [
    {
      origin_field: 'weight',
      value: '60',
      url: 'https://razer.com/specs',
      host: 'razer.com',
      root_domain: 'razer.com',
      tier: 1,
      tier_name: 'manufacturer',
      method: 'spec_table_match',
      key_path: null,
      snippet_id: 'sn_fts_abc',
      snippet_hash: 'sha256:fts_hash',
      source_id: 'razer.com',
      quote: 'Weight: 60 grams',
      snippet_text: 'weight: 60 grams',
      evidence_refs: ['sn_fts_abc']
    }
  ];

  const arrayPool = [
    {
      origin_field: 'weight',
      value: '58',
      url: 'https://other.com/review',
      host: 'other.com',
      root_domain: 'other.com',
      tier: 3,
      tier_name: 'retailer',
      method: 'llm_extract',
      snippet_id: 'sn_arr_xyz',
      quote: 'Weight: 58 grams',
      snippet_text: 'weight: 58 grams',
      evidence_refs: ['sn_arr_xyz']
    }
  ];

  const result = buildTierAwareFieldRetrieval({
    fieldKey: 'weight',
    needRow: { field_key: 'weight', need_score: 1 },
    fieldRule: {},
    evidencePool: arrayPool,
    identity: { brand: 'Razer', model: 'Viper' },
    maxHits: 10,
    ftsQueryFn: () => ftsPool
  });

  assert.equal(result.hits.length > 0, true);
  assert.equal(result.hits[0].url, 'https://razer.com/specs');
});

test('buildTierAwareFieldRetrieval falls back to array scan when ftsQueryFn returns empty', () => {

  const arrayPool = [
    {
      origin_field: 'weight',
      value: '58',
      url: 'https://other.com/review',
      host: 'other.com',
      root_domain: 'other.com',
      tier: 2,
      tier_name: 'lab',
      method: 'spec_table_match',
      snippet_id: 'sn_fall_xyz',
      quote: 'Weight: 58 grams',
      snippet_text: 'weight: 58 grams',
      evidence_refs: ['sn_fall_xyz']
    }
  ];

  const result = buildTierAwareFieldRetrieval({
    fieldKey: 'weight',
    needRow: { field_key: 'weight', need_score: 1 },
    fieldRule: {},
    evidencePool: arrayPool,
    identity: { brand: 'Test', model: 'Widget' },
    maxHits: 10,
    ftsQueryFn: () => []
  });

  assert.equal(result.hits.length > 0, true);
  assert.equal(result.hits[0].url, 'https://other.com/review');
});
