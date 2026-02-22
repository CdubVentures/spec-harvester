const COMPONENT_LEXICON_SCHEMA = `
CREATE TABLE IF NOT EXISTS component_lexicon (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  field TEXT NOT NULL,
  category TEXT NOT NULL,
  value TEXT NOT NULL,
  source_run_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(field, category, value)
);
`;

const FIELD_ANCHORS_SCHEMA = `
CREATE TABLE IF NOT EXISTS field_anchors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  field TEXT NOT NULL,
  category TEXT NOT NULL,
  phrase TEXT NOT NULL,
  source_url TEXT,
  source_run_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(field, category, phrase)
);
`;

const URL_MEMORY_SCHEMA = `
CREATE TABLE IF NOT EXISTS url_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  field TEXT NOT NULL,
  category TEXT NOT NULL,
  url TEXT NOT NULL,
  used_count INTEGER NOT NULL DEFAULT 1,
  source_run_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(field, category, url)
);
`;

const DOMAIN_FIELD_YIELD_SCHEMA = `
CREATE TABLE IF NOT EXISTS domain_field_yield (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL,
  field TEXT NOT NULL,
  category TEXT NOT NULL,
  seen_count INTEGER NOT NULL DEFAULT 0,
  used_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(domain, field, category)
);
`;

export class ComponentLexiconStore {
  constructor(db) {
    this._db = db;
    db.exec(COMPONENT_LEXICON_SCHEMA);
  }

  insert({ field, category, value, sourceRunId }) {
    this._db.prepare(
      `INSERT OR IGNORE INTO component_lexicon (field, category, value, source_run_id) VALUES (?, ?, ?, ?)`
    ).run(field, category, value, sourceRunId || null);
  }

  query({ field, category }) {
    return this._db.prepare(
      `SELECT * FROM component_lexicon WHERE field = ? AND category = ?`
    ).all(field, category);
  }

  queryWithDecay({ field, category, decayDays = 90, expireDays = 180 }) {
    const rows = this._db.prepare(
      `SELECT *,
        CASE
          WHEN julianday('now') - julianday(created_at) > ? THEN 'expired'
          WHEN julianday('now') - julianday(created_at) > ? THEN 'decayed'
          ELSE 'active'
        END AS decay_status
      FROM component_lexicon
      WHERE field = ? AND category = ?
        AND julianday('now') - julianday(created_at) <= ?`
    ).all(expireDays, decayDays, field, category, expireDays);
    return rows;
  }
}

export class FieldAnchorsStore {
  constructor(db) {
    this._db = db;
    db.exec(FIELD_ANCHORS_SCHEMA);
  }

  insert({ field, category, phrase, sourceUrl, sourceRunId }) {
    this._db.prepare(
      `INSERT OR IGNORE INTO field_anchors (field, category, phrase, source_url, source_run_id) VALUES (?, ?, ?, ?, ?)`
    ).run(field, category, phrase, sourceUrl || null, sourceRunId || null);
  }

  query({ field, category }) {
    return this._db.prepare(
      `SELECT * FROM field_anchors WHERE field = ? AND category = ?`
    ).all(field, category);
  }

  queryWithDecay({ field, category, decayDays = 60 }) {
    return this._db.prepare(
      `SELECT *,
        CASE
          WHEN julianday('now') - julianday(created_at) > ? THEN 'decayed'
          ELSE 'active'
        END AS decay_status
      FROM field_anchors
      WHERE field = ? AND category = ?`
    ).all(decayDays, field, category);
  }
}

export class UrlMemoryStore {
  constructor(db) {
    this._db = db;
    db.exec(URL_MEMORY_SCHEMA);
  }

  upsert({ field, category, url, sourceRunId }) {
    const existing = this._db.prepare(
      `SELECT id FROM url_memory WHERE field = ? AND category = ? AND url = ?`
    ).get(field, category, url);

    if (existing) {
      this._db.prepare(
        `UPDATE url_memory SET used_count = used_count + 1, updated_at = datetime('now'), source_run_id = ? WHERE id = ?`
      ).run(sourceRunId || null, existing.id);
    } else {
      this._db.prepare(
        `INSERT INTO url_memory (field, category, url, source_run_id) VALUES (?, ?, ?, ?)`
      ).run(field, category, url, sourceRunId || null);
    }
  }

  query({ field, category }) {
    return this._db.prepare(
      `SELECT * FROM url_memory WHERE field = ? AND category = ?`
    ).all(field, category);
  }

  queryWithDecay({ field, category, decayDays = 120 }) {
    return this._db.prepare(
      `SELECT *,
        CASE
          WHEN julianday('now') - julianday(updated_at) > ? THEN 'decayed'
          ELSE 'active'
        END AS decay_status
      FROM url_memory
      WHERE field = ? AND category = ?`
    ).all(decayDays, field, category);
  }
}

export class DomainFieldYieldStore {
  constructor(db) {
    this._db = db;
    db.exec(DOMAIN_FIELD_YIELD_SCHEMA);
  }

  _ensureRow({ domain, field, category }) {
    this._db.prepare(
      `INSERT OR IGNORE INTO domain_field_yield (domain, field, category) VALUES (?, ?, ?)`
    ).run(domain, field, category);
  }

  recordSeen({ domain, field, category }) {
    this._ensureRow({ domain, field, category });
    this._db.prepare(
      `UPDATE domain_field_yield SET seen_count = seen_count + 1, updated_at = datetime('now') WHERE domain = ? AND field = ? AND category = ?`
    ).run(domain, field, category);
  }

  recordUsed({ domain, field, category }) {
    this._ensureRow({ domain, field, category });
    this._db.prepare(
      `UPDATE domain_field_yield SET used_count = used_count + 1, updated_at = datetime('now') WHERE domain = ? AND field = ? AND category = ?`
    ).run(domain, field, category);
  }

  getYield({ domain, field, category }) {
    const row = this._db.prepare(
      `SELECT * FROM domain_field_yield WHERE domain = ? AND field = ? AND category = ?`
    ).get(domain, field, category);
    if (!row) return { seen_count: 0, used_count: 0, yield_ratio: 0 };
    return {
      ...row,
      yield_ratio: row.seen_count > 0 ? row.used_count / row.seen_count : 0
    };
  }

  getLowYieldDomains({ category, minSeen = 5, maxYield = 0.2 }) {
    return this._db.prepare(
      `SELECT *, CAST(used_count AS REAL) / MAX(seen_count, 1) AS yield_ratio
       FROM domain_field_yield
       WHERE category = ? AND seen_count >= ?
         AND CAST(used_count AS REAL) / MAX(seen_count, 1) <= ?`
    ).all(category, minSeen, maxYield);
  }
}
