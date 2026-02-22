import { createHash } from 'node:crypto';

export const EVIDENCE_INDEX_SCHEMA = `
CREATE TABLE IF NOT EXISTS evidence_documents (
  doc_id TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  url TEXT NOT NULL,
  host TEXT NOT NULL DEFAULT '',
  tier INTEGER DEFAULT 99,
  role TEXT DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  product_id TEXT NOT NULL DEFAULT '',
  dedupe_outcome TEXT NOT NULL DEFAULT 'new',
  indexed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(content_hash, parser_version)
);

CREATE TABLE IF NOT EXISTS evidence_chunks (
  chunk_id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT NOT NULL REFERENCES evidence_documents(doc_id),
  snippet_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_type TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  normalized_text TEXT NOT NULL DEFAULT '',
  snippet_hash TEXT NOT NULL DEFAULT '',
  extraction_method TEXT NOT NULL DEFAULT '',
  field_hints TEXT NOT NULL DEFAULT '[]',
  UNIQUE(doc_id, snippet_id)
);

CREATE TABLE IF NOT EXISTS evidence_facts (
  fact_id INTEGER PRIMARY KEY AUTOINCREMENT,
  chunk_id INTEGER NOT NULL REFERENCES evidence_chunks(chunk_id),
  doc_id TEXT NOT NULL REFERENCES evidence_documents(doc_id),
  field_key TEXT NOT NULL,
  value_raw TEXT NOT NULL DEFAULT '',
  value_normalized TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  extraction_method TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ed_category_product ON evidence_documents(category, product_id);
CREATE INDEX IF NOT EXISTS idx_ed_content_hash ON evidence_documents(content_hash);
CREATE INDEX IF NOT EXISTS idx_ec_doc ON evidence_chunks(doc_id);
CREATE INDEX IF NOT EXISTS idx_ec_snippet ON evidence_chunks(snippet_id);
CREATE INDEX IF NOT EXISTS idx_ef_doc ON evidence_facts(doc_id);
CREATE INDEX IF NOT EXISTS idx_ef_field ON evidence_facts(field_key);
CREATE INDEX IF NOT EXISTS idx_ef_chunk ON evidence_facts(chunk_id);

CREATE VIRTUAL TABLE IF NOT EXISTS evidence_chunks_fts USING fts5(
  text,
  normalized_text,
  field_hints,
  content='evidence_chunks',
  content_rowid='chunk_id',
  tokenize='porter unicode61'
);
`;

function sha256Hex(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

export function generateStableSnippetId({ contentHash, parserVersion, chunkIndex }) {
  const seed = `${String(contentHash || '')}|${String(parserVersion || '')}|${Number(chunkIndex || 0)}`;
  const hash = sha256Hex(seed).slice(0, 16);
  return `sn_${hash}`;
}

export function generateDocId({ contentHash, parserVersion }) {
  const seed = `${String(contentHash || '')}|${String(parserVersion || '')}`;
  const hash = sha256Hex(seed).slice(0, 16);
  return `doc_${hash}`;
}

export function classifyDedupeOutcome({ existingDoc, incomingContentHash }) {
  if (!existingDoc) return 'new';
  if (existingDoc.content_hash === incomingContentHash) return 'reused';
  return 'updated';
}

export function indexDocument({ db, document, chunks = [], facts = [] }) {
  const contentHash = String(document.contentHash || '');
  const parserVersion = String(document.parserVersion || 'v1');
  const docId = generateDocId({ contentHash, parserVersion });

  const existing = getDocumentByHash({ db, contentHash, parserVersion });
  const dedupeOutcome = classifyDedupeOutcome({
    existingDoc: existing,
    incomingContentHash: contentHash
  });

  if (dedupeOutcome === 'reused') {
    return {
      docId: existing.doc_id,
      snippetIds: [],
      dedupeOutcome,
      chunksIndexed: 0,
      factsIndexed: 0
    };
  }

  const insertDoc = db.prepare(`
    INSERT OR REPLACE INTO evidence_documents
      (doc_id, content_hash, parser_version, url, host, tier, role, category, product_id, dedupe_outcome)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertDoc.run(
    docId,
    contentHash,
    parserVersion,
    String(document.url || ''),
    String(document.host || ''),
    Number(document.tier || 99),
    String(document.role || ''),
    String(document.category || ''),
    String(document.productId || ''),
    dedupeOutcome
  );

  const insertChunk = db.prepare(`
    INSERT OR IGNORE INTO evidence_chunks
      (doc_id, snippet_id, chunk_index, chunk_type, text, normalized_text, snippet_hash, extraction_method, field_hints)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const snippetIds = [];
  const chunkIdByIndex = new Map();

  for (const chunk of chunks) {
    const snippetId = generateStableSnippetId({
      contentHash,
      parserVersion,
      chunkIndex: chunk.chunkIndex
    });
    snippetIds.push(snippetId);

    const fieldHintsJson = JSON.stringify(Array.isArray(chunk.fieldHints) ? chunk.fieldHints : []);

    const info = insertChunk.run(
      docId,
      snippetId,
      Number(chunk.chunkIndex || 0),
      String(chunk.chunkType || ''),
      String(chunk.text || ''),
      String(chunk.normalizedText || ''),
      String(chunk.snippetHash || ''),
      String(chunk.extractionMethod || ''),
      fieldHintsJson
    );

    if (info.changes > 0) {
      const rowid = info.lastInsertRowid;
      chunkIdByIndex.set(chunk.chunkIndex, rowid);
      try {
        db.prepare(
          `INSERT INTO evidence_chunks_fts(rowid, text, normalized_text, field_hints)
           VALUES (?, ?, ?, ?)`
        ).run(rowid, String(chunk.text || ''), String(chunk.normalizedText || ''), fieldHintsJson);
      } catch {
        // FTS sync best-effort
      }
    } else {
      const existing = db.prepare(
        'SELECT chunk_id FROM evidence_chunks WHERE doc_id = ? AND snippet_id = ?'
      ).get(docId, snippetId);
      if (existing) {
        chunkIdByIndex.set(chunk.chunkIndex, existing.chunk_id);
      }
    }
  }

  const insertFact = db.prepare(`
    INSERT INTO evidence_facts
      (chunk_id, doc_id, field_key, value_raw, value_normalized, unit, extraction_method, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let factsIndexed = 0;
  for (const fact of facts) {
    const chunkId = chunkIdByIndex.get(fact.chunkIndex);
    if (!chunkId) continue;

    insertFact.run(
      chunkId,
      docId,
      String(fact.fieldKey || ''),
      String(fact.valueRaw || ''),
      String(fact.valueNormalized || ''),
      String(fact.unit || ''),
      String(fact.extractionMethod || ''),
      Number(fact.confidence || 0)
    );
    factsIndexed += 1;
  }

  return {
    docId,
    snippetIds,
    dedupeOutcome,
    chunksIndexed: chunks.length,
    factsIndexed
  };
}

export function getDocumentByHash({ db, contentHash, parserVersion }) {
  const row = db.prepare(
    'SELECT * FROM evidence_documents WHERE content_hash = ? AND parser_version = ?'
  ).get(String(contentHash || ''), String(parserVersion || ''));
  return row || null;
}

export function getChunksForDocument({ db, docId }) {
  return db.prepare(
    'SELECT * FROM evidence_chunks WHERE doc_id = ? ORDER BY chunk_index ASC'
  ).all(String(docId || ''));
}

export function getFactsForField({ db, category, productId, fieldKey }) {
  return db.prepare(`
    SELECT
      f.fact_id,
      f.chunk_id,
      f.doc_id,
      f.field_key,
      f.value_raw,
      f.value_normalized,
      f.unit,
      f.extraction_method,
      f.confidence,
      c.snippet_id,
      c.chunk_type,
      c.text AS chunk_text,
      c.snippet_hash,
      d.url,
      d.host,
      d.tier,
      d.role,
      d.content_hash
    FROM evidence_facts f
    JOIN evidence_chunks c ON c.chunk_id = f.chunk_id
    JOIN evidence_documents d ON d.doc_id = f.doc_id
    WHERE d.category = ? AND d.product_id = ? AND f.field_key = ?
    ORDER BY f.confidence DESC
  `).all(
    String(category || ''),
    String(productId || ''),
    String(fieldKey || '')
  );
}

export function getEvidenceInventory({ db, category, productId }) {
  const docCount = db.prepare(
    'SELECT COUNT(*) as cnt FROM evidence_documents WHERE category = ? AND product_id = ?'
  ).get(String(category || ''), String(productId || ''));

  const chunkCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM evidence_chunks c
    JOIN evidence_documents d ON d.doc_id = c.doc_id
    WHERE d.category = ? AND d.product_id = ?
  `).get(String(category || ''), String(productId || ''));

  const factCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM evidence_facts f
    JOIN evidence_documents d ON d.doc_id = f.doc_id
    WHERE d.category = ? AND d.product_id = ?
  `).get(String(category || ''), String(productId || ''));

  const uniqueHashes = db.prepare(`
    SELECT COUNT(DISTINCT content_hash) as cnt FROM evidence_documents
    WHERE category = ? AND product_id = ?
  `).get(String(category || ''), String(productId || ''));

  const dedupeHits = db.prepare(`
    SELECT COUNT(*) as cnt FROM evidence_documents
    WHERE category = ? AND product_id = ? AND dedupe_outcome = 'reused'
  `).get(String(category || ''), String(productId || ''));

  return {
    documentCount: docCount.cnt,
    chunkCount: chunkCount.cnt,
    factCount: factCount.cnt,
    uniqueHashes: uniqueHashes.cnt,
    dedupeHits: dedupeHits.cnt
  };
}

function escapeFtsQuery(terms) {
  return terms
    .map((t) => String(t || '').replace(/['"]/g, '').trim())
    .filter((t) => t.length >= 2)
    .map((t) => `"${t}"`)
    .join(' OR ');
}

export function searchEvidenceByField({
  db,
  category,
  productId,
  fieldKey,
  queryTerms = [],
  unitHint = '',
  maxResults = 30
}) {
  const cap = Math.max(1, Math.min(200, Number(maxResults || 30)));
  const terms = [...queryTerms];
  if (fieldKey) {
    const spaced = String(fieldKey).replace(/_/g, ' ').trim();
    terms.push(fieldKey, spaced);
  }
  if (unitHint) terms.push(unitHint);

  const ftsQuery = escapeFtsQuery(terms);
  if (!ftsQuery) return [];

  return db.prepare(`
    SELECT
      c.chunk_id,
      c.doc_id,
      c.snippet_id,
      c.chunk_index,
      c.chunk_type,
      c.text,
      c.normalized_text,
      c.snippet_hash,
      c.extraction_method,
      c.field_hints,
      d.url,
      d.host,
      d.tier,
      d.role,
      d.content_hash,
      rank
    FROM evidence_chunks_fts fts
    JOIN evidence_chunks c ON c.chunk_id = fts.rowid
    JOIN evidence_documents d ON d.doc_id = c.doc_id
    WHERE evidence_chunks_fts MATCH ?
      AND d.category = ?
      AND d.product_id = ?
    ORDER BY rank
    LIMIT ?
  `).all(ftsQuery, String(category || ''), String(productId || ''), cap);
}

export function ftsResultsToEvidencePool({ ftsResults = [] }) {
  return ftsResults.map((row) => ({
    origin_field: '',
    value: null,
    url: String(row.url || ''),
    host: String(row.host || ''),
    root_domain: String(row.host || ''),
    tier: row.tier ?? null,
    tier_name: String(row.role || ''),
    method: String(row.extraction_method || ''),
    key_path: null,
    snippet_id: String(row.snippet_id || ''),
    snippet_hash: String(row.snippet_hash || ''),
    source_id: String(row.host || ''),
    file_uri: null,
    mime_type: null,
    content_hash: String(row.content_hash || ''),
    surface: null,
    quote: String(row.text || ''),
    snippet_text: String(row.normalized_text || row.text || ''),
    retrieved_at: null,
    evidence_refs: row.snippet_id ? [String(row.snippet_id)] : [],
    fts_rank: row.rank
  }));
}
