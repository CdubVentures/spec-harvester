/**
 * Content Hash Cache for Evidence Reuse (IP05-5B).
 *
 * Caches evidence packs keyed by URL + content hash.
 * When a page is re-fetched and the content hash matches,
 * the existing evidence pack is reused (skipping extraction).
 *
 * Supports ETag and Last-Modified for HTTP conditional requests.
 */

import { createHash } from 'node:crypto';

/**
 * Compute a SHA-256 content hash from raw page content.
 */
export function computeContentHash(content) {
  return createHash('sha256')
    .update(String(content ?? ''))
    .digest('hex');
}

export class ContentHashCache {
  constructor({ maxSize = 5000 } = {}) {
    this._maxSize = Math.max(1, Math.floor(maxSize) || 5000);
    this._map = new Map();
    this._hits = 0;
    this._misses = 0;
  }

  /**
   * Store evidence pack for a URL + content hash.
   */
  set(url, contentHash, evidence, { etag, lastModified } = {}) {
    const key = String(url || '');
    // Remove old entry so insertion order is updated
    this._map.delete(key);

    this._map.set(key, {
      contentHash: String(contentHash || ''),
      evidence,
      etag: etag || null,
      lastModified: lastModified || null,
      cachedAt: new Date().toISOString()
    });

    // Evict oldest entries if over capacity
    while (this._map.size > this._maxSize) {
      const oldest = this._map.keys().next().value;
      this._map.delete(oldest);
    }
  }

  /**
   * Get cached evidence for a URL if the content hash matches.
   * Returns null if URL is unknown or content has changed.
   */
  get(url, contentHash) {
    const key = String(url || '');
    const entry = this._map.get(key);
    if (!entry) {
      this._misses += 1;
      return null;
    }
    if (entry.contentHash !== String(contentHash || '')) {
      this._misses += 1;
      return null;
    }
    this._hits += 1;
    return entry;
  }

  /**
   * Get HTTP conditional headers for a URL (ETag, Last-Modified).
   */
  getConditionalHeaders(url) {
    const entry = this._map.get(String(url || ''));
    if (!entry) return null;
    const headers = {};
    if (entry.etag) headers['If-None-Match'] = entry.etag;
    if (entry.lastModified) headers['If-Modified-Since'] = entry.lastModified;
    return Object.keys(headers).length > 0 ? headers : null;
  }

  clear() {
    this._map.clear();
    this._hits = 0;
    this._misses = 0;
  }

  stats() {
    return {
      entries: this._map.size,
      maxSize: this._maxSize,
      hits: this._hits,
      misses: this._misses,
      hitRate: (this._hits + this._misses) > 0
        ? Number(((this._hits / (this._hits + this._misses)) * 100).toFixed(2))
        : 0
    };
  }
}

/**
 * Check if evidence can be reused for a URL given a content hash.
 */
export function shouldReuseEvidence({ cache, url, contentHash }) {
  if (!cache || !url || !contentHash) {
    return { reuse: false, evidence: null };
  }
  const entry = cache.get(url, contentHash);
  if (entry) {
    return { reuse: true, evidence: entry.evidence, cachedAt: entry.cachedAt };
  }
  return { reuse: false, evidence: null };
}
