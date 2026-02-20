function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizePathToken(value, fallback = 'trace') {
  const token = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return token || fallback;
}

function sanitizeFilename(value, fallback = 'events.jsonl') {
  const token = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return token || fallback;
}

export class RuntimeTraceWriter {
  constructor({
    storage,
    runId,
    productId,
    rootKey = '_runtime/traces'
  } = {}) {
    this.storage = storage;
    this.runId = sanitizePathToken(runId, 'run');
    this.productId = sanitizePathToken(productId, 'product');
    this.rootKey = String(rootKey || '_runtime/traces').trim().replace(/\/+$/, '');
    this.counters = new Map();
  }

  baseRunKey() {
    return this.storage.resolveOutputKey(this.rootKey, 'runs', this.runId, this.productId);
  }

  nextRingSlot(counterKey, ringSize) {
    const size = Math.max(1, toInt(ringSize, 1));
    const prev = toInt(this.counters.get(counterKey), 0);
    const next = prev + 1;
    this.counters.set(counterKey, next);
    return (next - 1) % size;
  }

  async writeJson({
    section,
    prefix,
    payload,
    ringSize = 0
  } = {}) {
    const sectionToken = sanitizePathToken(section, 'misc');
    const prefixToken = sanitizePathToken(prefix, 'trace');
    const slot = ringSize > 0
      ? this.nextRingSlot(`${sectionToken}:${prefixToken}`, ringSize)
      : this.nextRingSlot(`${sectionToken}:${prefixToken}`, Number.MAX_SAFE_INTEGER);
    const suffix = String(slot).padStart(3, '0');
    const filename = `${prefixToken}_${suffix}.json`;
    const key = this.storage.resolveOutputKey(this.baseRunKey(), sectionToken, filename);
    await this.storage.writeObject(
      key,
      Buffer.from(`${JSON.stringify(payload ?? {}, null, 2)}\n`, 'utf8'),
      { contentType: 'application/json' }
    );
    return {
      trace_path: key
    };
  }

  async appendJsonl({
    section,
    filename,
    row
  } = {}) {
    const sectionToken = sanitizePathToken(section, 'misc');
    const fileToken = sanitizeFilename(filename, 'events.jsonl');
    const finalName = fileToken.endsWith('.jsonl') ? fileToken : `${fileToken}.jsonl`;
    const key = this.storage.resolveOutputKey(this.baseRunKey(), sectionToken, finalName);
    await this.storage.appendText(key, `${JSON.stringify(row ?? {})}\n`, {
      contentType: 'application/x-ndjson'
    });
    return {
      trace_path: key
    };
  }

  async writeText({
    section,
    prefix,
    text = '',
    extension = 'txt',
    ringSize = 0,
    contentType = 'text/plain; charset=utf-8'
  } = {}) {
    const sectionToken = sanitizePathToken(section, 'misc');
    const prefixToken = sanitizePathToken(prefix, 'trace');
    const ext = sanitizePathToken(extension, 'txt');
    const slot = ringSize > 0
      ? this.nextRingSlot(`${sectionToken}:${prefixToken}:${ext}`, ringSize)
      : this.nextRingSlot(`${sectionToken}:${prefixToken}:${ext}`, Number.MAX_SAFE_INTEGER);
    const suffix = String(slot).padStart(3, '0');
    const filename = `${prefixToken}_${suffix}.${ext}`;
    const key = this.storage.resolveOutputKey(this.baseRunKey(), sectionToken, filename);
    await this.storage.writeObject(
      key,
      Buffer.from(String(text || ''), 'utf8'),
      { contentType }
    );
    return {
      trace_path: key
    };
  }
}
