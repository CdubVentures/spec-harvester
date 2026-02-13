import fs from 'node:fs/promises';
import path from 'node:path';
import { nowIso } from '../utils/common.js';

function normalizeFieldKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeCategory(value) {
  return normalizeFieldKey(value) || 'category';
}

function normalizeValueToken(value) {
  return String(value ?? '').trim();
}

function suggestionDocDefaults(category) {
  return {
    version: 1,
    category: normalizeCategory(category),
    suggestions: []
  };
}

async function readJsonOrNull(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function stableSortSuggestions(rows = []) {
  return [...rows].sort((a, b) => {
    const byField = String(a.field_key || '').localeCompare(String(b.field_key || ''));
    if (byField !== 0) {
      return byField;
    }
    const byValue = String(a.value || '').localeCompare(String(b.value || ''));
    if (byValue !== 0) {
      return byValue;
    }
    return String(a.first_seen_at || '').localeCompare(String(b.first_seen_at || ''));
  });
}

export function enumSuggestionPath({ config = {}, category }) {
  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  return path.join(helperRoot, normalizeCategory(category), '_suggestions', 'enums.json');
}

export async function appendEnumCurationSuggestions({
  config = {},
  category,
  productId,
  runId,
  suggestions = []
}) {
  const filePath = enumSuggestionPath({ config, category });
  const existing = await readJsonOrNull(filePath);
  const next = existing && typeof existing === 'object'
    ? existing
    : suggestionDocDefaults(category);
  const currentSuggestions = Array.isArray(next.suggestions) ? next.suggestions : [];
  const index = new Map();

  for (const row of currentSuggestions) {
    const fieldKey = normalizeFieldKey(row?.field_key);
    const value = normalizeValueToken(row?.value);
    if (!fieldKey || !value) {
      continue;
    }
    index.set(`${fieldKey}::${value.toLowerCase()}`, row);
  }

  let appended = 0;
  for (const row of suggestions) {
    const fieldKey = normalizeFieldKey(row?.field_key);
    const value = normalizeValueToken(row?.normalized_value ?? row?.value ?? row?.raw_value);
    if (!fieldKey || !value) {
      continue;
    }
    const key = `${fieldKey}::${value.toLowerCase()}`;
    if (index.has(key)) {
      continue;
    }
    const suggestion = {
      suggestion_id: `enum_${fieldKey}_${value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`,
      suggestion_type: 'enum_value',
      field_key: fieldKey,
      value,
      status: 'pending',
      source: 'runtime_field_rules_engine',
      product_id: String(productId || '').trim() || null,
      run_id: String(runId || '').trim() || null,
      first_seen_at: nowIso()
    };
    index.set(key, suggestion);
    currentSuggestions.push(suggestion);
    appended += 1;
  }

  next.version = 1;
  next.category = normalizeCategory(category);
  next.suggestions = stableSortSuggestions(currentSuggestions);
  next.updated_at = nowIso();

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');

  return {
    path: filePath,
    appended_count: appended,
    total_count: next.suggestions.length
  };
}
