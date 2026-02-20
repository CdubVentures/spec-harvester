import crypto from 'node:crypto';
import {
  failOpenEnvelope,
  normalizeErrorList
} from '../pipeline/pipelineSharedHelpers.js';

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampInt(value, min, max, fallback) {
  const parsed = toInt(value, fallback);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const token = String(value).trim().toLowerCase();
  return token === '1' || token === 'true' || token === 'yes' || token === 'on';
}

function sha256Text(value = '') {
  return `sha256:${crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex')}`;
}

function emptySurfaces() {
  return {
    json_ld: [],
    microdata: [],
    rdfa: [],
    microformats: [],
    opengraph: {},
    twitter: {}
  };
}

function emptyStats() {
  return {
    json_ld_count: 0,
    microdata_count: 0,
    rdfa_count: 0,
    microformats_count: 0,
    opengraph_count: 0,
    twitter_count: 0
  };
}

function emptyPayload({ url = '', html = '', reason = '' } = {}) {
  return failOpenEnvelope({
    url: String(url || ''),
    html_hash: sha256Text(html || ''),
    surfaces: emptySurfaces(),
    stats: emptyStats()
  }, { reason });
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizePayload(raw = {}, fallback = {}) {
  const payload = raw && typeof raw === 'object' ? raw : {};
  const surfacesIn = toObject(payload.surfaces);
  const statsIn = toObject(payload.stats);
  const fallbackStats = emptyStats();
  return {
    ok: Boolean(payload.ok),
    url: String(payload.url || fallback.url || ''),
    html_hash: String(payload.html_hash || fallback.html_hash || ''),
    surfaces: {
      json_ld: toArray(surfacesIn.json_ld),
      microdata: toArray(surfacesIn.microdata),
      rdfa: toArray(surfacesIn.rdfa),
      microformats: toArray(surfacesIn.microformats),
      opengraph: toObject(surfacesIn.opengraph),
      twitter: toObject(surfacesIn.twitter)
    },
    stats: {
      json_ld_count: toInt(statsIn.json_ld_count, fallbackStats.json_ld_count),
      microdata_count: toInt(statsIn.microdata_count, fallbackStats.microdata_count),
      rdfa_count: toInt(statsIn.rdfa_count, fallbackStats.rdfa_count),
      microformats_count: toInt(statsIn.microformats_count, fallbackStats.microformats_count),
      opengraph_count: toInt(statsIn.opengraph_count, fallbackStats.opengraph_count),
      twitter_count: toInt(statsIn.twitter_count, fallbackStats.twitter_count)
    },
    errors: normalizeErrorList(toArray(payload.errors))
  };
}

function buildTimeoutSignal(timeoutMs = 2000) {
  const safeTimeout = Math.max(250, toInt(timeoutMs, 2000));
  if (globalThis.AbortSignal?.timeout) {
    return globalThis.AbortSignal.timeout(safeTimeout);
  }
  return undefined;
}

function normalizeUrl(value = '') {
  return String(value || '').trim().replace(/\/+$/, '');
}

export class StructuredMetadataClient {
  constructor({
    config = {},
    logger = null,
    fetchImpl = null
  } = {}) {
    this.logger = logger || null;
    this.fetch = fetchImpl || globalThis.fetch;
    this.enabled = toBool(config.structuredMetadataExtructEnabled, false);
    this.url = normalizeUrl(config.structuredMetadataExtructUrl || 'http://127.0.0.1:8011/extract/structured');
    this.timeoutMs = clampInt(config.structuredMetadataExtructTimeoutMs, 250, 15_000, 2000);
    this.maxItemsPerSurface = clampInt(config.structuredMetadataExtructMaxItemsPerSurface, 1, 1000, 200);
    this.cacheEnabled = toBool(config.structuredMetadataExtructCacheEnabled, true);
    this.cacheLimit = clampInt(config.structuredMetadataExtructCacheLimit, 32, 2000, 400);
    this.cache = new Map();
  }

  isEnabled() {
    return this.enabled && Boolean(this.url) && typeof this.fetch === 'function';
  }

  maybeReadCache(cacheKey = '') {
    if (!this.cacheEnabled || !cacheKey) return null;
    const hit = this.cache.get(cacheKey);
    if (!hit) return null;
    hit.lastUsedAt = Date.now();
    return hit.payload;
  }

  writeCache(cacheKey = '', payload = null) {
    if (!this.cacheEnabled || !cacheKey || !payload) return;
    this.cache.set(cacheKey, {
      payload,
      lastUsedAt: Date.now()
    });
    if (this.cache.size <= this.cacheLimit) return;
    const sortedKeys = [...this.cache.entries()]
      .sort((a, b) => (a[1]?.lastUsedAt || 0) - (b[1]?.lastUsedAt || 0))
      .map(([key]) => key);
    while (this.cache.size > this.cacheLimit && sortedKeys.length > 0) {
      const next = sortedKeys.shift();
      if (next) this.cache.delete(next);
    }
  }

  async extract({
    url = '',
    html = '',
    contentType = 'text/html',
    maxItemsPerSurface = 0
  } = {}) {
    const normalizedUrl = String(url || '').trim();
    const htmlText = String(html || '');
    const htmlHash = sha256Text(htmlText);
    const failOpenBase = emptyPayload({
      url: normalizedUrl,
      html: htmlText
    });
    failOpenBase.html_hash = htmlHash;

    if (!this.isEnabled()) {
      return failOpenEnvelope(failOpenBase, {
        errors: ['structured_metadata_sidecar_disabled']
      });
    }
    if (!htmlText.trim()) {
      return failOpenEnvelope(failOpenBase, {
        errors: ['skip_empty_html']
      });
    }

    const maxSurfaceItems = clampInt(
      maxItemsPerSurface || this.maxItemsPerSurface,
      1,
      1000,
      this.maxItemsPerSurface
    );
    const cacheKey = `${normalizedUrl}|${htmlHash}|${maxSurfaceItems}`;
    const cacheHit = this.maybeReadCache(cacheKey);
    if (cacheHit) {
      return {
        ...cacheHit,
        cache_hit: true
      };
    }

    const requestBody = {
      url: normalizedUrl,
      html: htmlText,
      content_type: String(contentType || 'text/html'),
      max_items_per_surface: maxSurfaceItems
    };
    try {
      const response = await this.fetch(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: buildTimeoutSignal(this.timeoutMs)
      });
      if (!response?.ok) {
        const fail = failOpenEnvelope(failOpenBase, {
          errors: [`structured_metadata_sidecar_http_${response?.status || 'error'}`]
        });
        this.logger?.warn?.('structured_metadata_sidecar_failed', {
          url: normalizedUrl,
          status: Number(response?.status || 0),
          reason: fail.errors[0]
        });
        return fail;
      }
      const json = await response.json();
      const normalized = normalizePayload(json, failOpenBase);
      normalized.cache_hit = false;
      this.writeCache(cacheKey, normalized);
      return normalized;
    } catch (error) {
      const reason = `structured_metadata_sidecar_error:${String(error?.message || 'request_failed')}`;
      this.logger?.warn?.('structured_metadata_sidecar_failed', {
        url: normalizedUrl,
        reason
      });
      return failOpenEnvelope(failOpenBase, { errors: [reason] });
    }
  }
}

export function createStructuredMetadataClient({ config = {}, logger = null, fetchImpl = null } = {}) {
  return new StructuredMetadataClient({
    config,
    logger,
    fetchImpl
  });
}
