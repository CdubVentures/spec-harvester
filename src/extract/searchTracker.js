function normalizeQuery(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeUrl(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '');
}

function nowIso() {
  return new Date().toISOString();
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function defaultSearchTrackerState({ category = '', productId = '' } = {}) {
  return {
    version: 1,
    category: String(category || ''),
    product_id: String(productId || ''),
    created_at: nowIso(),
    updated_at: nowIso(),
    queries: [],
    visited_urls: [],
    field_yield: {},
    frontier: []
  };
}

export class SearchTracker {
  constructor({
    storage,
    key,
    category = '',
    productId = ''
  }) {
    this.storage = storage;
    this.key = String(key || '').trim();
    this.state = defaultSearchTrackerState({ category, productId });
    this.queryIndex = new Map();
    this.urlIndex = new Map();
    this.frontierIndex = new Map();
  }

  async load() {
    const loaded = await this.storage.readJsonOrNull(this.key);
    if (!loaded || typeof loaded !== 'object') {
      this._rebuildIndexes();
      return this.state;
    }
    this.state = {
      ...defaultSearchTrackerState({
        category: loaded.category || this.state.category,
        productId: loaded.product_id || this.state.product_id
      }),
      ...loaded
    };
    this.state.queries = ensureArray(this.state.queries);
    this.state.visited_urls = ensureArray(this.state.visited_urls);
    this.state.frontier = ensureArray(this.state.frontier);
    this.state.field_yield = ensureObject(this.state.field_yield);
    this._rebuildIndexes();
    return this.state;
  }

  _rebuildIndexes() {
    this.queryIndex = new Map();
    this.urlIndex = new Map();
    this.frontierIndex = new Map();
    for (const row of this.state.queries || []) {
      const token = normalizeQuery(row?.query);
      if (token) {
        this.queryIndex.set(token, row);
      }
    }
    for (const row of this.state.visited_urls || []) {
      const token = normalizeUrl(row?.url);
      if (token) {
        this.urlIndex.set(token, row);
      }
    }
    for (const row of this.state.frontier || []) {
      const token = normalizeUrl(row?.url);
      if (token) {
        this.frontierIndex.set(token, row);
      }
    }
  }

  shouldSkipQuery(query) {
    return this.queryIndex.has(normalizeQuery(query));
  }

  shouldSkipUrl(url) {
    return this.urlIndex.has(normalizeUrl(url));
  }

  recordQueries(queries = [], { source = 'unknown' } = {}) {
    const now = nowIso();
    for (const raw of queries) {
      const query = normalizeQuery(raw?.query ?? raw);
      if (!query) {
        continue;
      }
      const existing = this.queryIndex.get(query);
      if (existing) {
        existing.count = Number(existing.count || 1) + 1;
        existing.last_seen = now;
        continue;
      }
      const row = {
        query,
        source: String(raw?.source || source || 'unknown'),
        first_seen: now,
        last_seen: now,
        count: 1
      };
      this.state.queries.push(row);
      this.queryIndex.set(query, row);
    }
    this.state.updated_at = now;
  }

  recordVisitedUrls(urls = [], { source = 'crawl' } = {}) {
    const now = nowIso();
    for (const raw of urls) {
      const url = normalizeUrl(raw?.url ?? raw);
      if (!url) {
        continue;
      }
      const existing = this.urlIndex.get(url);
      if (existing) {
        existing.count = Number(existing.count || 1) + 1;
        existing.last_seen = now;
      } else {
        const row = {
          url,
          source: String(raw?.source || source || 'crawl'),
          first_seen: now,
          last_seen: now,
          count: 1
        };
        this.state.visited_urls.push(row);
        this.urlIndex.set(url, row);
      }

      const frontier = this.frontierIndex.get(url);
      if (frontier) {
        frontier.status = 'visited';
        frontier.visited_at = now;
      }
    }
    this.state.updated_at = now;
  }

  addFrontier(items = [], { reason = 'candidate' } = {}) {
    const now = nowIso();
    for (const raw of items) {
      const url = normalizeUrl(raw?.url ?? raw);
      if (!url || this.urlIndex.has(url)) {
        continue;
      }
      const existing = this.frontierIndex.get(url);
      if (existing) {
        existing.last_seen = now;
        continue;
      }
      const row = {
        url,
        reason: String(raw?.reason || reason || 'candidate'),
        status: 'pending',
        added_at: now,
        last_seen: now
      };
      this.state.frontier.push(row);
      this.frontierIndex.set(url, row);
    }
    this.state.updated_at = now;
  }

  recordFieldYield(entries = []) {
    const now = nowIso();
    for (const entry of entries || []) {
      const field = String(entry?.field || '').trim();
      if (!field) {
        continue;
      }
      const bucket = ensureObject(this.state.field_yield[field]);
      bucket.hits = Number(bucket.hits || 0) + 1;
      if (entry?.url) {
        bucket.last_url = normalizeUrl(entry.url);
      }
      bucket.last_seen = now;
      this.state.field_yield[field] = bucket;
    }
    this.state.updated_at = now;
  }

  pendingFrontier({ limit = 20 } = {}) {
    const max = Math.max(1, Number.parseInt(String(limit || 20), 10) || 20);
    return this.state.frontier
      .filter((row) => String(row?.status || 'pending') === 'pending')
      .slice(0, max);
  }

  summary() {
    const pending = this.state.frontier.filter((row) => row.status === 'pending').length;
    return {
      key: this.key,
      query_count: this.state.queries.length,
      visited_url_count: this.state.visited_urls.length,
      frontier_pending_count: pending,
      field_yield_count: Object.keys(this.state.field_yield || {}).length,
      updated_at: this.state.updated_at
    };
  }

  async save() {
    this.state.updated_at = nowIso();
    await this.storage.writeObject(
      this.key,
      Buffer.from(`${JSON.stringify(this.state, null, 2)}\n`, 'utf8'),
      { contentType: 'application/json' }
    );
    return this.summary();
  }
}
