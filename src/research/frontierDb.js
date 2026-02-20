import { canonicalizeUrl } from './urlNormalize.js';

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toFloat(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ''));
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
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function makeQueryHash(productId, query) {
  return stableHash(`${String(productId || '').trim().toLowerCase()}::${normalizeQuery(query)}`);
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function initialState() {
  return {
    version: 1,
    created_at: nowIso(),
    updated_at: nowIso(),
    queries: {},
    urls: {},
    recent_fetches: [],
    domain_stats: {},
    path_stats: {},
    product_index: {}
  };
}

function statusBucket(status) {
  const code = toInt(status, 0);
  if (code >= 200 && code < 300) return 'ok_count';
  if (code >= 300 && code < 400) return 'redirect_count';
  if (code === 404) return 'notfound_count';
  if (code === 410) return 'gone_count';
  if (code === 429) return 'blocked_count';
  if (code >= 400 && code < 500) return 'blocked_count';
  if (code >= 500) return 'server_error_count';
  return 'other_count';
}

export class FrontierDb {
  constructor({
    storage,
    key,
    config = {}
  } = {}) {
    this.storage = storage;
    this.key = String(key || '').trim() || '_intel/frontier/frontier.json';
    this.config = config || {};
    this.state = initialState();
    this.queryCooldownSeconds = Math.max(0, toInt(config.frontierQueryCooldownSeconds, 6 * 60 * 60));
    this.cooldown404Seconds = Math.max(0, toInt(config.frontierCooldown404Seconds, 72 * 60 * 60));
    this.cooldown404RepeatSeconds = Math.max(0, toInt(config.frontierCooldown404RepeatSeconds, 14 * 24 * 60 * 60));
    this.cooldown410Seconds = Math.max(0, toInt(config.frontierCooldown410Seconds, 90 * 24 * 60 * 60));
    this.cooldownTimeoutSeconds = Math.max(0, toInt(config.frontierCooldownTimeoutSeconds, 6 * 60 * 60));
    this.cooldown429BaseSeconds = Math.max(60, toInt(config.frontierCooldown429BaseSeconds, 15 * 60));
    this.pathPenaltyNotfoundThreshold = Math.max(2, toInt(config.frontierPathPenaltyNotfoundThreshold, 3));
  }

  async load() {
    const loaded = await this.storage.readJsonOrNull(this.key);
    if (!loaded || typeof loaded !== 'object') {
      this.state = initialState();
      return this.state;
    }
    this.state = {
      ...initialState(),
      ...loaded
    };
    this.state.queries = ensureObject(this.state.queries);
    this.state.urls = ensureObject(this.state.urls);
    this.state.recent_fetches = ensureArray(this.state.recent_fetches);
    this.state.domain_stats = ensureObject(this.state.domain_stats);
    this.state.path_stats = ensureObject(this.state.path_stats);
    this.state.product_index = ensureObject(this.state.product_index);
    return this.state;
  }

  async save() {
    this.state.updated_at = nowIso();
    await this.storage.writeObject(
      this.key,
      Buffer.from(`${JSON.stringify(this.state, null, 2)}\n`, 'utf8'),
      { contentType: 'application/json' }
    );
    return {
      key: this.key,
      query_count: Object.keys(this.state.queries || {}).length,
      url_count: Object.keys(this.state.urls || {}).length,
      updated_at: this.state.updated_at
    };
  }

  canonicalize(url) {
    return canonicalizeUrl(url, {
      stripTrackingParams: this.config.frontierStripTrackingParams !== false
    });
  }

  _queryRow(productId, query) {
    const queryHash = makeQueryHash(productId, query);
    const row = this.state.queries[queryHash];
    return {
      queryHash,
      row: row && typeof row === 'object' ? row : null
    };
  }

  shouldSkipQuery({ productId, query, force = false, now = nowMs() } = {}) {
    if (force) {
      return false;
    }
    const { row } = this._queryRow(productId, query);
    if (!row) {
      return false;
    }
    const cooldownMs = this.queryCooldownSeconds * 1000;
    if (cooldownMs <= 0) {
      return false;
    }
    const lastSeenMs = Date.parse(String(row.last_ts || ''));
    if (!Number.isFinite(lastSeenMs)) {
      return false;
    }
    return now - lastSeenMs < cooldownMs;
  }

  recordQuery({
    productId,
    query,
    provider,
    fields = [],
    results = [],
    ts = nowIso()
  } = {}) {
    const normalized = normalizeQuery(query);
    if (!normalized) {
      return null;
    }
    const queryHash = makeQueryHash(productId, normalized);
    const existing = ensureObject(this.state.queries[queryHash]);
    const next = {
      query_hash: queryHash,
      product_id: String(productId || ''),
      query_text: normalized,
      provider: String(provider || ''),
      fields: [...new Set((fields || []).map((field) => String(field || '').trim()).filter(Boolean))],
      attempts: toInt(existing.attempts, 0) + 1,
      first_ts: existing.first_ts || ts,
      last_ts: ts,
      results: ensureArray(results).slice(0, 25).map((row, idx) => ({
        rank: toInt(row?.rank, idx + 1),
        url: String(row?.url || '').trim(),
        title: String(row?.title || '').trim(),
        host: String(row?.host || '').trim(),
        snippet: String(row?.snippet || '').slice(0, 400)
      }))
    };
    this.state.queries[queryHash] = next;
    const productIndex = ensureObject(this.state.product_index[next.product_id]);
    productIndex.last_query_hash = queryHash;
    productIndex.last_query_ts = ts;
    this.state.product_index[next.product_id] = productIndex;
    this.state.updated_at = nowIso();
    return {
      query_hash: queryHash,
      query_text: normalized
    };
  }

  getUrlRow(url) {
    const normalized = this.canonicalize(url);
    if (!normalized.canonical_url) {
      return null;
    }
    return ensureObject(this.state.urls[normalized.canonical_url]);
  }

  shouldSkipUrl(url, { force = false, now = nowMs() } = {}) {
    if (force) {
      return { skip: false, reason: null };
    }
    const normalized = this.canonicalize(url);
    if (!normalized.canonical_url) {
      return { skip: false, reason: null };
    }
    const row = ensureObject(this.state.urls[normalized.canonical_url]);
    const cooldown = ensureObject(row.cooldown);
    const nextRetryTs = String(cooldown.next_retry_ts || '').trim();
    if (nextRetryTs) {
      const nextMs = Date.parse(nextRetryTs);
      if (Number.isFinite(nextMs) && now < nextMs) {
        return {
          skip: true,
          reason: 'cooldown',
          next_retry_ts: nextRetryTs
        };
      }
    }

    const pathKey = `${normalized.domain}|${normalized.path_sig}`;
    const pathStats = ensureObject(this.state.path_stats[pathKey]);
    const notfoundCount = toInt(pathStats.notfound_count, 0);
    const okCount = toInt(pathStats.ok_count, 0);
    if (notfoundCount >= this.pathPenaltyNotfoundThreshold && okCount === 0) {
      return {
        skip: true,
        reason: 'path_dead_pattern',
        next_retry_ts: nextRetryTs || null
      };
    }

    return { skip: false, reason: null };
  }

  _applyCooldownForStatus(existingCooldown, status, fetchCount = 1) {
    const next = {
      ...ensureObject(existingCooldown)
    };
    const code = toInt(status, 0);
    let seconds = 0;
    let reason = '';
    if (code === 404) {
      if (fetchCount >= 3) {
        seconds = this.cooldown404RepeatSeconds;
        reason = 'status_404_repeated';
      } else {
        seconds = this.cooldown404Seconds;
        reason = 'status_404';
      }
    } else if (code === 410) {
      seconds = this.cooldown410Seconds;
      reason = 'status_410';
    } else if (code === 429) {
      const exponent = Math.max(0, Math.min(4, fetchCount - 1));
      seconds = this.cooldown429BaseSeconds * (2 ** exponent);
      reason = 'status_429_backoff';
    } else if (code === 0) {
      seconds = this.cooldownTimeoutSeconds;
      reason = 'network_timeout';
    } else {
      seconds = 0;
      reason = '';
    }

    if (seconds > 0) {
      next.next_retry_ts = new Date(nowMs() + (seconds * 1000)).toISOString();
      next.reason = reason;
      next.seconds = seconds;
    } else {
      next.next_retry_ts = '';
      next.reason = '';
      next.seconds = 0;
    }
    return next;
  }

  recordFetch({
    productId,
    url,
    status = 0,
    finalUrl = '',
    contentType = '',
    contentHash = '',
    bytes = 0,
    elapsedMs = 0,
    error = '',
    fieldsFound = [],
    confidence = 0,
    conflictFlag = false,
    ts = nowIso()
  } = {}) {
    const normalized = this.canonicalize(url || finalUrl);
    if (!normalized.canonical_url) {
      return null;
    }
    const key = normalized.canonical_url;
    const existing = ensureObject(this.state.urls[key]);
    const fetchCount = toInt(existing.fetch_count, 0) + 1;
    const cooldown = this._applyCooldownForStatus(existing.cooldown, status, fetchCount);
    const row = {
      canonical_url: key,
      original_url: String(url || ''),
      domain: normalized.domain,
      path_sig: normalized.path_sig,
      first_seen_ts: existing.first_seen_ts || ts,
      last_seen_ts: ts,
      last_status: toInt(status, 0),
      last_final_url: String(finalUrl || ''),
      content_type: String(contentType || ''),
      content_hash: String(contentHash || ''),
      fetch_count: fetchCount,
      retries_count: toInt(existing.retries_count, 0) + (toInt(status, 0) >= 400 || toInt(status, 0) === 0 ? 1 : 0),
      fields_found: [...new Set([...(existing.fields_found || []), ...(fieldsFound || [])])],
      avg_confidence: Number.parseFloat((
        (
          toFloat(existing.avg_confidence, 0) * Math.max(0, fetchCount - 1) +
          toFloat(confidence, 0)
        ) / Math.max(1, fetchCount)
      ).toFixed(6)),
      conflict_count: toInt(existing.conflict_count, 0) + (conflictFlag ? 1 : 0),
      cooldown
    };
    this.state.urls[key] = row;

    const fetchRow = {
      ts,
      product_id: String(productId || ''),
      canonical_url: key,
      status: toInt(status, 0),
      final_url: String(finalUrl || ''),
      bytes: toInt(bytes, 0),
      elapsed_ms: toInt(elapsedMs, 0),
      error: String(error || '').slice(0, 500)
    };
    this.state.recent_fetches.push(fetchRow);
    if (this.state.recent_fetches.length > 2000) {
      this.state.recent_fetches = this.state.recent_fetches.slice(-2000);
    }

    this._updateYieldStats({
      domain: normalized.domain,
      pathSig: normalized.path_sig,
      status: toInt(status, 0),
      fieldsFound,
      confidence,
      conflictFlag,
      ts
    });
    this.state.updated_at = nowIso();
    return row;
  }

  _updateYieldStats({
    domain,
    pathSig,
    status,
    fieldsFound = [],
    confidence = 0,
    conflictFlag = false,
    ts = nowIso()
  } = {}) {
    const fieldList = [...new Set((fieldsFound || []).map((field) => String(field || '').trim()).filter(Boolean))];
    const domainKeys = fieldList.length ? fieldList : ['__all__'];
    for (const fieldKey of domainKeys) {
      const domainStatKey = `${domain}|${fieldKey}`;
      const stat = ensureObject(this.state.domain_stats[domainStatKey]);
      stat.domain = domain;
      stat.field_key = fieldKey;
      const bucket = statusBucket(status);
      stat[bucket] = toInt(stat[bucket], 0) + 1;
      stat.success_count = toInt(stat.success_count, 0) + (status >= 200 && status < 400 ? 1 : 0);
      stat.conflict_count = toInt(stat.conflict_count, 0) + (conflictFlag ? 1 : 0);
      const seen = toInt(stat.sample_count, 0) + 1;
      stat.sample_count = seen;
      stat.avg_confidence = Number.parseFloat((
        ((toFloat(stat.avg_confidence, 0) * (seen - 1)) + toFloat(confidence, 0)) / Math.max(1, seen)
      ).toFixed(6));
      stat.last_seen_ts = ts;
      this.state.domain_stats[domainStatKey] = stat;
    }

    const pathKey = `${domain}|${pathSig}`;
    const path = ensureObject(this.state.path_stats[pathKey]);
    path.domain = domain;
    path.path_sig = pathSig;
    const bucket = statusBucket(status);
    path[bucket] = toInt(path[bucket], 0) + 1;
    path.last_seen_ts = ts;
    this.state.path_stats[pathKey] = path;
  }

  recordYield({ url, fieldKey, valueHash = '', confidence = 0, conflictFlag = false } = {}) {
    const normalized = this.canonicalize(url);
    if (!normalized.canonical_url || !fieldKey) {
      return null;
    }
    const row = ensureObject(this.state.urls[normalized.canonical_url]);
    const existing = ensureArray(row.yields);
    existing.push({
      field_key: String(fieldKey || ''),
      value_hash: String(valueHash || ''),
      confidence: toFloat(confidence, 0),
      conflict_flag: Boolean(conflictFlag),
      ts: nowIso()
    });
    row.yields = existing.slice(-120);
    this.state.urls[normalized.canonical_url] = row;
    return row.yields[row.yields.length - 1];
  }

  rankPenaltyForUrl(url) {
    const normalized = this.canonicalize(url);
    if (!normalized.canonical_url) {
      return 0;
    }
    const row = ensureObject(this.state.urls[normalized.canonical_url]);
    const lastStatus = toInt(row.last_status, 0);
    if (lastStatus === 404 || lastStatus === 410) {
      return -1.5;
    }
    if (lastStatus === 429) {
      return -0.8;
    }
    const conflictCount = toInt(row.conflict_count, 0);
    if (conflictCount > 0) {
      return Math.max(-1.2, -0.2 * conflictCount);
    }
    const domainKey = `${normalized.domain}|__all__`;
    const domainStat = ensureObject(this.state.domain_stats[domainKey]);
    const avgConfidence = toFloat(domainStat.avg_confidence, 0);
    return Math.max(-0.5, Math.min(0.5, (avgConfidence - 0.6) * 0.6));
  }

  snapshotForProduct(productId) {
    const product = String(productId || '').trim();
    const queries = Object.values(this.state.queries || {}).filter(
      (row) => String(row?.product_id || '').trim() === product
    );
    const recentFetches = this.state.recent_fetches
      .filter((row) => String(row?.product_id || '').trim() === product)
      .slice(-200);
    const urlSet = new Set(recentFetches.map((row) => row.canonical_url).filter(Boolean));
    for (const query of queries) {
      for (const result of query.results || []) {
        const normalized = this.canonicalize(result.url);
        if (normalized.canonical_url) {
          urlSet.add(normalized.canonical_url);
        }
      }
    }

    const fieldYield = {};
    for (const urlKey of urlSet) {
      const row = ensureObject(this.state.urls[urlKey]);
      for (const field of row.fields_found || []) {
        fieldYield[field] = toInt(fieldYield[field], 0) + 1;
      }
    }

    const cooldowns = [];
    for (const urlKey of urlSet) {
      const row = ensureObject(this.state.urls[urlKey]);
      const cooldown = ensureObject(row.cooldown);
      if (!cooldown.next_retry_ts) {
        continue;
      }
      cooldowns.push({
        canonical_url: urlKey,
        reason: String(cooldown.reason || ''),
        next_retry_ts: String(cooldown.next_retry_ts || '')
      });
    }

    return {
      product_id: product,
      query_count: queries.length,
      url_count: urlSet.size,
      recent_fetch_count: recentFetches.length,
      field_yield: fieldYield,
      cooldowns: cooldowns.slice(0, 200)
    };
  }

  frontierSnapshot({ limit = 120 } = {}) {
    const rows = Object.values(this.state.urls || [])
      .sort((a, b) => Date.parse(String(b?.last_seen_ts || '')) - Date.parse(String(a?.last_seen_ts || '')))
      .slice(0, Math.max(1, toInt(limit, 120)));
    return {
      updated_at: this.state.updated_at,
      urls: rows,
      domain_stats_count: Object.keys(this.state.domain_stats || {}).length,
      path_stats_count: Object.keys(this.state.path_stats || {}).length
    };
  }
}

let _FrontierDbSqlite = null;
try {
  const mod = await import('./frontierSqlite.js');
  _FrontierDbSqlite = mod.FrontierDbSqlite;
} catch {
  // better-sqlite3 not installed — SQLite backend unavailable
}

export function createFrontier({ storage, key, config = {} } = {}) {
  if (config.frontierEnableSqlite && _FrontierDbSqlite) {
    try {
      const dbPath = String(config.frontierSqlitePath || key || '_intel/frontier/frontier.db')
        .replace(/\.json$/, '.db');
      if (typeof config._logger?.info === 'function') {
        config._logger.info('frontier_sqlite_enabled', { dbPath });
      }
      return new _FrontierDbSqlite({ dbPath, config });
    } catch (err) {
      if (typeof config._logger?.info === 'function') {
        config._logger.info('frontier_sqlite_fallback', {
          message: `SQLite init failed (${err.message}), falling back to JSON`
        });
      }
    }
  }
  return new FrontierDb({ storage, key, config });
}
