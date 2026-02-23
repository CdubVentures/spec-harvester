import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  EVIDENCE_INDEX_SCHEMA,
  indexDocument,
  searchEvidenceByField,
  ftsResultsToEvidencePool
} from '../src/index/evidenceIndexDb.js';
import { createFtsQueryFn } from '../src/retrieve/ftsQueryAdapter.js';
import { buildTierAwareFieldRetrieval } from '../src/retrieve/tierAwareRetriever.js';

function makeDb() {
  const db = new Database(':memory:');
  db.exec(EVIDENCE_INDEX_SCHEMA);
  return db;
}

function seedEvidence(db) {
  indexDocument({
    db,
    document: {
      contentHash: 'hash-razer-spec',
      parserVersion: 'v1',
      url: 'https://razer.com/viper-v3-pro/specs',
      host: 'razer.com',
      tier: 1,
      role: 'manufacturer',
      category: 'mouse',
      productId: 'mouse-razer-viper-v3-pro'
    },
    chunks: [
      { chunkIndex: 0, chunkType: 'kv', text: 'Sensor: Focus Pro 35K optical sensor, 35000 DPI', normalizedText: 'sensor focus pro 35k optical sensor 35000 dpi', snippetHash: 'sh1', extractionMethod: 'kv', fieldHints: ['sensor', 'dpi'] },
      { chunkIndex: 1, chunkType: 'kv', text: 'Polling Rate: Up to 4000 Hz', normalizedText: 'polling rate up to 4000 hz', snippetHash: 'sh2', extractionMethod: 'kv', fieldHints: ['polling_rate'] },
      { chunkIndex: 2, chunkType: 'kv', text: 'Weight: 55g (without cable)', normalizedText: 'weight 55g without cable', snippetHash: 'sh3', extractionMethod: 'kv', fieldHints: ['weight'] }
    ],
    facts: [
      { chunkIndex: 0, fieldKey: 'sensor', valueRaw: 'Focus Pro 35K', valueNormalized: 'focus pro 35k', unit: '', extractionMethod: 'kv', confidence: 0.95 },
      { chunkIndex: 0, fieldKey: 'dpi', valueRaw: '35000', valueNormalized: '35000', unit: 'dpi', extractionMethod: 'kv', confidence: 0.92 },
      { chunkIndex: 1, fieldKey: 'polling_rate', valueRaw: '4000', valueNormalized: '4000', unit: 'hz', extractionMethod: 'kv', confidence: 0.90 },
      { chunkIndex: 2, fieldKey: 'weight', valueRaw: '55g', valueNormalized: '55', unit: 'g', extractionMethod: 'kv', confidence: 0.88 }
    ]
  });

  indexDocument({
    db,
    document: {
      contentHash: 'hash-rtings-review',
      parserVersion: 'v1',
      url: 'https://rtings.com/mouse/reviews/razer/viper-v3-pro',
      host: 'rtings.com',
      tier: 2,
      role: 'lab_review',
      category: 'mouse',
      productId: 'mouse-razer-viper-v3-pro'
    },
    chunks: [
      { chunkIndex: 0, chunkType: 'table', text: 'Sensor: Focus Pro 35K, Maximum DPI: 35000, Polling Rate: 4000 Hz', normalizedText: 'sensor focus pro 35k maximum dpi 35000 polling rate 4000 hz', snippetHash: 'sh4', extractionMethod: 'table', fieldHints: ['sensor', 'dpi', 'polling_rate'] },
      { chunkIndex: 1, chunkType: 'text', text: 'The Razer Viper V3 Pro weighs only 55 grams making it ultralight', normalizedText: 'razer viper v3 pro weighs only 55 grams making it ultralight', snippetHash: 'sh5', extractionMethod: 'llm_extract', fieldHints: ['weight'] }
    ],
    facts: [
      { chunkIndex: 0, fieldKey: 'sensor', valueRaw: 'Focus Pro 35K', valueNormalized: 'focus pro 35k', unit: '', extractionMethod: 'table', confidence: 0.93 },
      { chunkIndex: 0, fieldKey: 'dpi', valueRaw: '35000', valueNormalized: '35000', unit: 'dpi', extractionMethod: 'table', confidence: 0.91 },
      { chunkIndex: 1, fieldKey: 'weight', valueRaw: '55g', valueNormalized: '55', unit: 'g', extractionMethod: 'llm_extract', confidence: 0.87 }
    ]
  });
}

test('searchEvidenceByField returns FTS results for sensor field', () => {
  const db = makeDb();
  seedEvidence(db);

  const results = searchEvidenceByField({
    db,
    category: 'mouse',
    productId: 'mouse-razer-viper-v3-pro',
    fieldKey: 'sensor',
    queryTerms: ['Focus Pro', '35K'],
    maxResults: 10
  });

  assert.ok(results.length >= 1, `Expected >=1 FTS results for sensor, got ${results.length}`);
  assert.ok(results.some((r) => r.text.includes('Focus Pro 35K')), 'Expected FTS result containing sensor text');

  db.close();
});

test('ftsResultsToEvidencePool converts FTS rows to evidence pool format', () => {
  const db = makeDb();
  seedEvidence(db);

  const ftsResults = searchEvidenceByField({
    db,
    category: 'mouse',
    productId: 'mouse-razer-viper-v3-pro',
    fieldKey: 'sensor',
    queryTerms: ['Focus Pro'],
    maxResults: 10
  });

  const pool = ftsResultsToEvidencePool({ ftsResults });

  assert.ok(pool.length >= 1, 'Expected non-empty evidence pool');
  const first = pool[0];
  assert.ok(first.url, 'Expected url in pool entry');
  assert.ok(first.host, 'Expected host in pool entry');
  assert.ok(first.quote, 'Expected quote in pool entry');
  assert.ok(first.snippet_id, 'Expected snippet_id in pool entry');

  db.close();
});

test('createFtsQueryFn returns a function that queries FTS and returns evidence pool', () => {
  const db = makeDb();
  seedEvidence(db);

  const ftsQueryFn = createFtsQueryFn({
    db,
    category: 'mouse',
    productId: 'mouse-razer-viper-v3-pro'
  });

  const results = ftsQueryFn({
    fieldKey: 'sensor',
    anchors: ['Focus Pro 35K'],
    unitHint: ''
  });

  assert.ok(Array.isArray(results), 'Expected array result from ftsQueryFn');
  assert.ok(results.length >= 1, `Expected >=1 results, got ${results.length}`);
  assert.ok(results[0].url, 'Expected url in result');
  assert.ok(results[0].quote, 'Expected quote in result');

  db.close();
});

test('createFtsQueryFn returns empty array when no matches', () => {
  const db = makeDb();
  seedEvidence(db);

  const ftsQueryFn = createFtsQueryFn({
    db,
    category: 'mouse',
    productId: 'mouse-razer-viper-v3-pro'
  });

  const results = ftsQueryFn({
    fieldKey: 'nonexistent_field',
    anchors: ['completely unrelated gibberish xyz123'],
    unitHint: ''
  });

  assert.ok(Array.isArray(results), 'Expected array result');
  db.close();
});

test('tierAwareRetriever uses ftsQueryFn when provided and results are non-empty', () => {
  const db = makeDb();
  seedEvidence(db);

  const ftsQueryFn = createFtsQueryFn({
    db,
    category: 'mouse',
    productId: 'mouse-razer-viper-v3-pro'
  });

  const retrieval = buildTierAwareFieldRetrieval({
    fieldKey: 'sensor',
    needRow: {
      need: 1.0,
      tier_preference: [1, 2],
      min_refs: 2,
      required_level: 'required'
    },
    fieldRule: {
      anchors: ['focus pro', '35k', 'optical sensor'],
      unit_hint: ''
    },
    evidencePool: [],
    identity: { brand: 'Razer', model: 'Viper V3 Pro' },
    maxHits: 10,
    ftsQueryFn,
    traceEnabled: true
  });

  assert.ok(retrieval.hits.length >= 1, `Expected >=1 hits from FTS-backed retrieval, got ${retrieval.hits.length}`);
  assert.ok(retrieval.hits.some((h) => h.url.includes('razer.com')), 'Expected razer.com hit');

  db.close();
});

test('tierAwareRetriever falls back to evidencePool when ftsQueryFn returns empty', () => {
  const db = makeDb();
  seedEvidence(db);

  const emptyFts = () => [];

  const fallbackPool = [
    {
      origin_field: 'sensor',
      value: 'Focus Pro 35K',
      url: 'https://manual-source.com/specs',
      host: 'manual-source.com',
      tier: 1,
      tier_name: 'manufacturer',
      method: 'kv',
      quote: 'Focus Pro 35K optical sensor specification',
      snippet_text: 'focus pro 35k optical sensor specification',
      snippet_id: 'sn_manual_01',
      content_hash: 'manual-hash'
    }
  ];

  const retrieval = buildTierAwareFieldRetrieval({
    fieldKey: 'sensor',
    needRow: {
      need: 1.0,
      tier_preference: [1, 2],
      min_refs: 1,
      required_level: 'required'
    },
    fieldRule: {
      anchors: ['focus pro', '35k'],
      unit_hint: ''
    },
    evidencePool: fallbackPool,
    identity: { brand: 'Razer', model: 'Viper V3 Pro' },
    maxHits: 10,
    ftsQueryFn: emptyFts
  });

  assert.ok(retrieval.hits.length >= 1, 'Expected >=1 hit from fallback pool');
  assert.ok(retrieval.hits[0].url.includes('manual-source.com'), 'Expected fallback pool source');

  db.close();
});
