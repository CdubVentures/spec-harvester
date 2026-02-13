import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

function stableStringify(value) {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
  const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${entries.join(',')}}`;
}

function sha256(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

export class LLMCache {
  constructor({
    cacheDir = '',
    defaultTtlMs = 7 * 24 * 60 * 60 * 1000
  } = {}) {
    this.cacheDir = String(cacheDir || '').trim();
    this.defaultTtlMs = Math.max(1, Number(defaultTtlMs || 0) || (7 * 24 * 60 * 60 * 1000));
  }

  getCacheKey({
    model,
    prompt,
    evidence,
    extra = {}
  }) {
    const payload = stableStringify({
      model: String(model || '').trim(),
      prompt,
      evidence,
      extra
    });
    return sha256(payload);
  }

  filePathForKey(key) {
    return path.join(this.cacheDir, `${String(key || '').trim()}.json`);
  }

  async get(key) {
    if (!this.cacheDir || !key) {
      return null;
    }
    const filePath = this.filePathForKey(key);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const timestamp = Number(parsed?.timestamp || 0);
      const ttl = Number(parsed?.ttl || this.defaultTtlMs);
      if (!Number.isFinite(timestamp) || !Number.isFinite(ttl) || timestamp <= 0 || ttl <= 0) {
        return null;
      }
      if ((Date.now() - timestamp) > ttl) {
        return null;
      }
      return parsed.response ?? null;
    } catch {
      return null;
    }
  }

  async set(key, response, ttlMs = this.defaultTtlMs) {
    if (!this.cacheDir || !key) {
      return;
    }
    const filePath = this.filePathForKey(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const payload = {
      response,
      timestamp: Date.now(),
      ttl: Math.max(1, Number(ttlMs || this.defaultTtlMs) || this.defaultTtlMs)
    };
    await fs.writeFile(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
  }
}

