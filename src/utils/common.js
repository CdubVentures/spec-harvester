import crypto from 'node:crypto';
import zlib from 'node:zlib';

export function nowIso() {
  return new Date().toISOString();
}

export function buildRunId(date = new Date()) {
  const stamp = date.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${stamp}-${suffix}`;
}

export function gzipBuffer(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return zlib.gzipSync(buffer);
}

export function toNdjson(rows) {
  return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
}

export function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeToken(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function extractRootDomain(hostname) {
  const host = (hostname || '').toLowerCase();
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) {
    return host;
  }
  return parts.slice(-2).join('.');
}

export function parseNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const match = String(value).replace(/,/g, '.').match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function splitListValue(value) {
  if (Array.isArray(value)) {
    return value.map((v) => normalizeWhitespace(v)).filter(Boolean);
  }
  return String(value || '')
    .split(/[,;|\/]+/)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);
}

export function normalizeBooleanValue(value) {
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }
  const token = normalizeToken(value);
  if (!token) {
    return 'unk';
  }
  if (['yes', 'true', 'supported', 'y', '1', 'enabled'].includes(token)) {
    return 'yes';
  }
  if (['no', 'false', 'n', '0', 'disabled'].includes(token)) {
    return 'no';
  }
  return 'unk';
}

export function formatDateMmDdYyyy(input) {
  if (!input) {
    return 'unk';
  }
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
      return trimmed;
    }
    const yearMonth = trimmed.match(/^(\d{4})[-/](\d{1,2})$/);
    if (yearMonth) {
      const year = yearMonth[1];
      const month = yearMonth[2].padStart(2, '0');
      return `${month}/01/${year}`;
    }
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return 'unk';
  }
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const yyyy = String(date.getUTCFullYear());
  return `${mm}/${dd}/${yyyy}`;
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

export function getByPath(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') {
      return undefined;
    }
    cur = cur[part];
  }
  return cur;
}
