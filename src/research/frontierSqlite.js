/**
 * SQLite-backed Frontier DB (Gap #2).
 *
 * Drop-in replacement for the JSON-based FrontierDb.
 * Uses better-sqlite3 for synchronous, fast, single-file storage.
 * Same API contract as FrontierDb.
 */

import Database from 'better-sqlite3';
import { canonicalizeUrl } from './urlNormalize.js';

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nowMs() {
  return Date.now();
}

function nowIso() {
  return new Date().toISOString();
}

function stableHash(value) {
  const text = String(value || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function normalizeQuery(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function makeQueryHash(productId, query) {
  return stableHash(`${String(productId || '').trim().toLowerCase()}::${normalizeQuery(query)}`);
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS queries (
    query_hash TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    query_text TEXT NOT NULL,
    provider TEXT DEFAULT '',
    fields TEXT DEFAULT '[]',
    attempts INTEGER DEFAULT 1,
    first_ts TEXT NOT NULL,
    last_ts TEXT NOT NULL,
    results TEXT DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS urls (
    canonical_url TEXT PRIMARY KEY,
    original_url TEXT DEFAULT '',
    domain TEXT DEFAULT '',
    path_sig TEXT DEFAULT '',
    product_id TEXT DEFAULT '',
    first_seen_ts TEXT NOT NULL,
    last_seen_ts TEXT NOT NULL,
    last_status INTEGER DEFAULT 0,
    last_final_url TEXT DEFAULT '',
    content_type TEXT DEFAULT '',
    content_hash TEXT DEFAULT '',
    bytes INTEGER DEFAULT 0,
    elapsed_ms INTEGER DEFAULT 0,
    fetch_count INTEGER DEFAULT 0,
    ok_count INTEGER DEFAULT 0,
    redirect_count INTEGER DEFAULT 0,
    notfound_count INTEGER DEFAULT 0,
    gone_count INTEGER DEFAULT 0,
    blocked_count INTEGER DEFAULT 0,
    server_error_count INTEGER DEFAULT 0,
    timeout_count INTEGER DEFAULT 0,
    fields_found TEXT DEFAULT '[]',
    avg_confidence REAL DEFAULT 0,
    conflict_count INTEGER DEFAULT 0,
    cooldown_next_retry_ts TEXT DEFAULT '',
    cooldown_reason TEXT DEFAULT '',
    cooldown_seconds INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS yields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_url TEXT NOT NULL,
    field_key TEXT NOT NULL,
    value_hash TEXT DEFAULT '',
    confidence REAL DEFAULT 0,
    conflict_flag INTEGER DEFAULT 0,
    ts TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_queries_product ON queries(product_id);
  CREATE INDEX IF NOT EXISTS idx_urls_domain ON urls(domain);
  CREATE INDEX IF NOT EXISTS idx_urls_product ON urls(product_id);
  CREATE INDEX IF NOT EXISTS idx_urls_last_seen ON urls(last_seen_ts);
  CREATE INDEX IF NOT EXISTS idx_yields_url ON yields(canonical_url);
`;

export class FrontierDbSqlite {
  constructor({ dbPath, config = {} } = {}) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(SCHEMA);

    this._queryCooldownMs = toInt(config.frontierQueryCooldownSeconds, 21600) * 1000;
    this._cooldown404Ms = toInt(config.frontierCooldown404Seconds, 259200) * 1000;
    this._cooldown404RepeatMs = toInt(config.frontierCooldown404RepeatSeconds, 1209600) * 1000;
    this._cooldown410Ms = toInt(config.frontierCooldown410Seconds, 7776000) * 1000;
    this._cooldownTimeoutMs = toInt(config.frontierCooldownTimeoutSeconds, 21600) * 1000;
    this._cooldown403BaseMs = Math.max(60000, toInt(config.frontierCooldown403BaseSeconds, 1800) * 1000);
    this._cooldown429BaseMs = Math.max(60000, toInt(config.frontierCooldown429BaseSeconds, 900) * 1000);
    this._pathPenaltyThreshold = Math.max(2, toInt(config.frontierPathPenaltyNotfoundThreshold, 3));
  }

  canonicalize(url) {
    return canonicalizeUrl(url);
  }

  // --- Queries ---

  shouldSkipQuery({ productId, query, force = false, now = nowMs() } = {}) {
    if (force) return false;
    const hash = makeQueryHash(productId, query);
    const row = this.db.prepare('SELECT last_ts FROM queries WHERE query_hash = ?').get(hash);
    if (!row) return false;
    const lastMs = Date.parse(row.last_ts);
    return Number.isFinite(lastMs) && (now - lastMs) < this._queryCooldownMs;
  }

  recordQuery({ productId, query, provider = '', fields = [], results = [], ts = nowIso() } = {}) {
    const text = normalizeQuery(query);
    if (!text) return null;
    const hash = makeQueryHash(productId, text);
    const fieldsJson = JSON.stringify([...new Set(fields.filter(Boolean))]);
    const resultsJson = JSON.stringify((results || []).slice(0, 25).map((r) => ({
      rank: r.rank || 0,
      url: String(r.url || ''),
      title: String(r.title || ''),
      host: String(r.host || ''),
      snippet: String(r.snippet || '').slice(0, 400)
    })));

    const existing = this.db.prepare('SELECT attempts FROM queries WHERE query_hash = ?').get(hash);
    if (existing) {
      this.db.prepare(
        'UPDATE queries SET attempts = attempts + 1, last_ts = ?, provider = ?, fields = ?, results = ? WHERE query_hash = ?'
      ).run(ts, provider, fieldsJson, resultsJson, hash);
    } else {
      this.db.prepare(
        'INSERT INTO queries (query_hash, product_id, query_text, provider, fields, attempts, first_ts, last_ts, results) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)'
      ).run(hash, String(productId || ''), text, provider, fieldsJson, ts, ts, resultsJson);
    }

    return { query_hash: hash, query_text: text };
  }

  // --- URLs ---

  getUrlRow(url) {
    const normalized = this.canonicalize(url);
    if (!normalized.canonical_url) return null;
    const row = this.db.prepare('SELECT * FROM urls WHERE canonical_url = ?').get(normalized.canonical_url);
    if (!row) return null;
    return {
      ...row,
      fields_found: JSON.parse(row.fields_found || '[]'),
      cooldown: {
        next_retry_ts: row.cooldown_next_retry_ts || '',
        reason: row.cooldown_reason || '',
        seconds: row.cooldown_seconds || 0
      }
    };
  }

  shouldSkipUrl(url, { force = false, now = nowMs() } = {}) {
    if (force) return { skip: false, reason: null, next_retry_ts: null };
    const normalized = this.canonicalize(url);
    if (!normalized.canonical_url) return { skip: false, reason: null, next_retry_ts: null };

    const row = this.db.prepare(
      'SELECT cooldown_next_retry_ts, cooldown_reason FROM urls WHERE canonical_url = ?'
    ).get(normalized.canonical_url);

    if (row && row.cooldown_next_retry_ts) {
      const retryMs = Date.parse(row.cooldown_next_retry_ts);
      if (Number.isFinite(retryMs) && now < retryMs) {
        return {
          skip: true,
          reason: 'cooldown',
          next_retry_ts: row.cooldown_next_retry_ts
        };
      }
    }

    if (normalized.domain && normalized.path_sig) {
      const pathStats = this.db.prepare(
        'SELECT SUM(notfound_count) AS notfound_total, SUM(ok_count) AS ok_total FROM urls WHERE domain = ? AND path_sig = ?'
      ).get(normalized.domain, normalized.path_sig);
      const notfoundTotal = toInt(pathStats?.notfound_total, 0);
      const okTotal = toInt(pathStats?.ok_total, 0);
      if (notfoundTotal >= this._pathPenaltyThreshold && okTotal === 0) {
        return { skip: true, reason: 'path_dead_pattern', next_retry_ts: null };
      }
    }

    return { skip: false, reason: null, next_retry_ts: null };
  }

  recordFetch({
    productId = '', url, status = 0, finalUrl = '', contentType = '',
    contentHash = '', bytes = 0, elapsedMs = 0, error = '',
    fieldsFound = [], confidence = 0, conflictFlag = false, ts = nowIso()
  } = {}) {
    const normalized = this.canonicalize(url);
    if (!normalized.canonical_url) return null;

    const canonicalUrl = normalized.canonical_url;
    const statusCode = toInt(status, 0);
    const fieldsJson = JSON.stringify([...new Set(fieldsFound.filter(Boolean))]);

    const existing = this.db.prepare('SELECT * FROM urls WHERE canonical_url = ?').get(canonicalUrl);

    // Compute cooldown
    const fetchCount = existing ? existing.fetch_count + 1 : 1;
    let cooldownReason = '';
    let cooldownSeconds = 0;
    let cooldownNextRetryTs = '';

    if (statusCode === 404) {
      cooldownSeconds = fetchCount >= this._pathPenaltyThreshold
        ? Math.round(this._cooldown404RepeatMs / 1000)
        : Math.round(this._cooldown404Ms / 1000);
      cooldownReason = '404_not_found';
      cooldownNextRetryTs = new Date(Date.parse(ts) + cooldownSeconds * 1000).toISOString();
    } else if (statusCode === 410) {
      cooldownSeconds = Math.round(this._cooldown410Ms / 1000);
      cooldownReason = '410_gone';
      cooldownNextRetryTs = new Date(Date.parse(ts) + cooldownSeconds * 1000).toISOString();
    } else if (statusCode === 403) {
      cooldownSeconds = Math.round(this._cooldown403BaseMs * Math.pow(2, Math.min(fetchCount - 1, 8)) / 1000);
      cooldownReason = '403_forbidden_backoff';
      cooldownNextRetryTs = new Date(Date.parse(ts) + cooldownSeconds * 1000).toISOString();
    } else if (statusCode === 429) {
      cooldownSeconds = Math.round(this._cooldown429BaseMs * Math.pow(2, Math.min(fetchCount - 1, 8)) / 1000);
      cooldownReason = '429_rate_limited';
      cooldownNextRetryTs = new Date(Date.parse(ts) + cooldownSeconds * 1000).toISOString();
    } else if (statusCode === 0 && error) {
      cooldownSeconds = Math.round(this._cooldownTimeoutMs / 1000);
      cooldownReason = 'network_timeout';
      cooldownNextRetryTs = new Date(Date.parse(ts) + cooldownSeconds * 1000).toISOString();
    }

    // Merge fields_found
    let mergedFields = fieldsFound.filter(Boolean);
    if (existing) {
      const prev = JSON.parse(existing.fields_found || '[]');
      mergedFields = [...new Set([...prev, ...mergedFields])];
    }

    if (existing) {
      const okDelta = (statusCode >= 200 && statusCode < 300) ? 1 : 0;
      const redirectDelta = (statusCode >= 300 && statusCode < 400) ? 1 : 0;
      const notfoundDelta = statusCode === 404 ? 1 : 0;
      const goneDelta = statusCode === 410 ? 1 : 0;
      const blockedDelta = statusCode === 403 || statusCode === 429 ? 1 : 0;
      const serverErrDelta = statusCode >= 500 ? 1 : 0;
      const timeoutDelta = (statusCode === 0 && error) ? 1 : 0;
      const conflictDelta = conflictFlag ? 1 : 0;

      this.db.prepare(`
        UPDATE urls SET
          last_seen_ts = ?, last_status = ?, last_final_url = ?,
          content_type = ?, content_hash = ?, bytes = ?, elapsed_ms = ?,
          fetch_count = fetch_count + 1,
          ok_count = ok_count + ?, redirect_count = redirect_count + ?,
          notfound_count = notfound_count + ?, gone_count = gone_count + ?,
          blocked_count = blocked_count + ?, server_error_count = server_error_count + ?,
          timeout_count = timeout_count + ?,
          fields_found = ?, conflict_count = conflict_count + ?,
          cooldown_next_retry_ts = ?, cooldown_reason = ?, cooldown_seconds = ?
        WHERE canonical_url = ?
      `).run(
        ts, statusCode, finalUrl || '', contentType, contentHash, bytes, elapsedMs,
        okDelta, redirectDelta, notfoundDelta, goneDelta, blockedDelta, serverErrDelta, timeoutDelta,
        JSON.stringify(mergedFields), conflictDelta,
        cooldownNextRetryTs, cooldownReason, cooldownSeconds,
        canonicalUrl
      );
    } else {
      this.db.prepare(`
        INSERT INTO urls (
          canonical_url, original_url, domain, path_sig, product_id,
          first_seen_ts, last_seen_ts, last_status, last_final_url,
          content_type, content_hash, bytes, elapsed_ms,
          fetch_count, ok_count, redirect_count, notfound_count, gone_count,
          blocked_count, server_error_count, timeout_count,
          fields_found, avg_confidence, conflict_count,
          cooldown_next_retry_ts, cooldown_reason, cooldown_seconds
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        canonicalUrl, url, normalized.domain || '', normalized.path_sig || '', productId,
        ts, ts, statusCode, finalUrl || '',
        contentType, contentHash, bytes, elapsedMs,
        (statusCode >= 200 && statusCode < 300) ? 1 : 0,
        (statusCode >= 300 && statusCode < 400) ? 1 : 0,
        statusCode === 404 ? 1 : 0,
        statusCode === 410 ? 1 : 0,
        (statusCode === 403 || statusCode === 429) ? 1 : 0,
        statusCode >= 500 ? 1 : 0,
        (statusCode === 0 && error) ? 1 : 0,
        JSON.stringify(mergedFields), confidence, conflictFlag ? 1 : 0,
        cooldownNextRetryTs, cooldownReason, cooldownSeconds
      );
    }

    return {
      canonical_url: canonicalUrl,
      original_url: url,
      domain: normalized.domain || '',
      path_sig: normalized.path_sig || '',
      first_seen_ts: existing ? existing.first_seen_ts : ts,
      last_seen_ts: ts,
      last_status: statusCode,
      last_final_url: finalUrl || '',
      content_type: contentType,
      content_hash: contentHash,
      fetch_count: fetchCount,
      fields_found: mergedFields,
      avg_confidence: confidence,
      conflict_count: existing ? existing.conflict_count + (conflictFlag ? 1 : 0) : (conflictFlag ? 1 : 0),
      cooldown: {
        next_retry_ts: cooldownNextRetryTs,
        reason: cooldownReason,
        seconds: cooldownSeconds
      }
    };
  }

  recordYield({ url, fieldKey, valueHash = '', confidence = 0, conflictFlag = false } = {}) {
    const normalized = this.canonicalize(url);
    if (!normalized.canonical_url || !fieldKey) return null;
    const ts = nowIso();

    this.db.prepare(
      'INSERT INTO yields (canonical_url, field_key, value_hash, confidence, conflict_flag, ts) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(normalized.canonical_url, fieldKey, valueHash, confidence, conflictFlag ? 1 : 0, ts);

    return {
      field_key: fieldKey,
      value_hash: valueHash,
      confidence,
      conflict_flag: Boolean(conflictFlag),
      ts
    };
  }

  snapshotForProduct(productId) {
    const product = String(productId || '').trim();
    const queries = this.db.prepare('SELECT * FROM queries WHERE product_id = ?').all(product);
    const urls = this.db.prepare('SELECT * FROM urls WHERE product_id = ?').all(product);

    const fieldYield = {};
    for (const row of urls) {
      for (const field of JSON.parse(row.fields_found || '[]')) {
        fieldYield[field] = (fieldYield[field] || 0) + 1;
      }
    }

    return {
      product_id: product,
      query_count: queries.length,
      url_count: urls.length,
      recent_fetch_count: urls.length,
      field_yield: fieldYield,
      cooldowns: urls
        .filter((r) => r.cooldown_next_retry_ts)
        .map((r) => ({
          canonical_url: r.canonical_url,
          reason: r.cooldown_reason || '',
          next_retry_ts: r.cooldown_next_retry_ts || ''
        }))
        .slice(0, 200)
    };
  }

  frontierSnapshot({ limit = 120 } = {}) {
    const rows = this.db.prepare(
      'SELECT * FROM urls ORDER BY last_seen_ts DESC LIMIT ?'
    ).all(Math.max(1, toInt(limit, 120)));

    return {
      updated_at: nowIso(),
      urls: rows.map((r) => ({
        ...r,
        fields_found: JSON.parse(r.fields_found || '[]'),
        cooldown: {
          next_retry_ts: r.cooldown_next_retry_ts || '',
          reason: r.cooldown_reason || '',
          seconds: r.cooldown_seconds || 0
        }
      })),
      domain_stats_count: 0,
      path_stats_count: 0
    };
  }

  close() {
    this.db.close();
  }
}
