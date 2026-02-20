import fs from 'node:fs/promises';
import path from 'node:path';
import { nowIso } from '../utils/common.js';

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase();
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeField(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^fields\./, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeType(value) {
  const token = normalizeToken(value);
  if (token === 'enum' || token === 'enum_value' || token === 'new_enum') {
    return 'enum';
  }
  if (token === 'component' || token === 'new_component') {
    return 'component';
  }
  if (token === 'alias' || token === 'new_alias') {
    return 'alias';
  }
  throw new Error(`Unsupported suggestion type '${value}'`);
}

function fileNameForType(type) {
  // Consolidated: use the same files as the runtime curation system
  if (type === 'enum') {
    return 'enums.json';
  }
  if (type === 'component') {
    return 'components.json';
  }
  return 'aliases.json';
}

function dedupeKeyForType(type, item = {}) {
  if (type === 'alias') {
    return [
      normalizeField(item.field),
      normalizeToken(item.value),
      normalizeToken(item.canonical)
    ].join('|');
  }
  return [
    normalizeField(item.field),
    normalizeToken(item.value)
  ].join('|');
}

function normalizePayload(type, payload = {}) {
  if (!isObject(payload)) {
    throw new Error('appendReviewSuggestion requires payload object');
  }
  const field = normalizeField(payload.field);
  const value = String(payload.value || '').trim();
  const evidence = isObject(payload.evidence) ? payload.evidence : {};
  const evidenceUrl = String(evidence.url || '').trim();
  const evidenceQuote = String(evidence.quote || '').trim();
  if (!field) {
    throw new Error('appendReviewSuggestion requires payload.field');
  }
  if (!value) {
    throw new Error('appendReviewSuggestion requires payload.value');
  }
  if (!evidenceUrl || !evidenceQuote) {
    throw new Error('appendReviewSuggestion requires evidence.url and evidence.quote');
  }
  const item = {
    type,
    category: String(payload.category || '').trim(),
    product_id: String(payload.product_id || '').trim(),
    field,
    value,
    canonical: String(payload.canonical || '').trim(),
    reason: String(payload.reason || '').trim() || null,
    reviewer: String(payload.reviewer || '').trim() || null,
    evidence: {
      url: evidenceUrl,
      quote: evidenceQuote,
      quote_span: Array.isArray(evidence.quote_span) ? evidence.quote_span : null,
      snippet_id: String(evidence.snippet_id || '').trim() || null,
      snippet_hash: String(evidence.snippet_hash || '').trim() || null
    },
    created_at: nowIso()
  };
  return item;
}

async function readSuggestionFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (isObject(parsed)) {
      return parsed;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
  return null;
}

async function writeSuggestionFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function suggestionFilePath({ config = {}, category, type }) {
  const normalizedType = normalizeType(type);
  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  const normalizedCategory = String(category || '').trim() || 'unknown';
  return path.join(
    helperRoot,
    normalizedCategory,
    '_suggestions',
    fileNameForType(normalizedType)
  );
}

export async function appendReviewSuggestion({
  config = {},
  category,
  type,
  payload
}) {
  const normalizedType = normalizeType(type);
  const suggestionPath = suggestionFilePath({ config, category, type: normalizedType });
  const normalizedPayload = normalizePayload(normalizedType, {
    ...payload,
    category
  });
  const existing = await readSuggestionFile(suggestionPath);
  const current = isObject(existing) ? existing : {
    version: 1,
    category,
    type: normalizedType,
    generated_at: nowIso(),
    updated_at: nowIso(),
    count: 0,
    items: []
  };
  const items = Array.isArray(current.items) ? [...current.items] : [];
  const dedupeKey = dedupeKeyForType(normalizedType, normalizedPayload);
  const found = items.some((row) => dedupeKeyForType(normalizedType, row) === dedupeKey);
  if (!found) {
    items.push(normalizedPayload);
  }

  const next = {
    ...current,
    version: 1,
    category,
    type: normalizedType,
    updated_at: nowIso(),
    count: items.length,
    items
  };
  await writeSuggestionFile(suggestionPath, next);

  return {
    category,
    type: normalizedType,
    path: suggestionPath,
    appended: !found,
    total_count: items.length
  };
}
