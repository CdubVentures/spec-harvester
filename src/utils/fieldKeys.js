import { normalizeWhitespace } from './common.js';

const IDENTITY_FIELDS = new Set([
  'id',
  'brand',
  'model',
  'base_model',
  'variant',
  'sku',
  'mpn',
  'gtin',
  'category'
]);

const FIELD_ALIASES = {
  switch_link: 'switches_link'
};

function cleanToken(value) {
  return String(value || '')
    .replace(/\[\d+\]/g, '')
    .replace(/[^a-zA-Z0-9_./-]+/g, ' ')
    .trim();
}

function canonicalFieldMap(fieldOrder = []) {
  const map = new Map();
  for (const field of fieldOrder || []) {
    const key = String(field || '').trim().toLowerCase();
    if (!key) {
      continue;
    }
    map.set(key, String(field));
  }
  return map;
}

function normalizeTail(raw) {
  const token = cleanToken(raw)
    .replace(/[./]+/g, '.')
    .replace(/-/g, '_')
    .replace(/\s+/g, '')
    .toLowerCase();
  const tail = token.includes('.') ? token.split('.').pop() : token;
  return FIELD_ALIASES[tail] || tail;
}

export function toRawFieldKey(value, options = {}) {
  const fieldMap = canonicalFieldMap(options.fieldOrder || []);
  const token = normalizeWhitespace(value);
  if (!token) {
    return '';
  }

  const lowered = token.toLowerCase();
  let tail = '';
  if (lowered.startsWith('fields.')) {
    tail = normalizeTail(token.slice('fields.'.length));
  } else if (lowered.startsWith('specs.')) {
    tail = normalizeTail(token.slice('specs.'.length));
  } else if (lowered.startsWith('identity.')) {
    tail = normalizeTail(token.slice('identity.'.length));
  } else {
    tail = normalizeTail(token);
  }
  if (!tail) {
    return '';
  }
  if (fieldMap.has(tail)) {
    return fieldMap.get(tail);
  }
  return tail;
}

export function normalizeFieldList(values, options = {}) {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    const field = toRawFieldKey(value, options);
    if (!field || seen.has(field)) {
      continue;
    }
    seen.add(field);
    out.push(field);
  }
  return out;
}

export function normalizeRequiredFieldPath(value, options = {}) {
  const token = normalizeWhitespace(value);
  if (!token) {
    return '';
  }
  const lowered = token.toLowerCase();

  if (lowered.startsWith('identity.')) {
    const tail = normalizeTail(token.slice('identity.'.length));
    if (!tail) {
      return '';
    }
    return `identity.${tail}`;
  }

  const field = toRawFieldKey(token, options);
  if (!field) {
    return '';
  }
  if (IDENTITY_FIELDS.has(field)) {
    return `identity.${field}`;
  }
  return `fields.${field}`;
}

export function normalizeRequiredFieldPaths(values, options = {}) {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    const path = normalizeRequiredFieldPath(value, options);
    if (!path || seen.has(path)) {
      continue;
    }
    seen.add(path);
    out.push(path);
  }
  return out;
}

export function isIdentityField(value) {
  return IDENTITY_FIELDS.has(String(value || '').trim().toLowerCase());
}
