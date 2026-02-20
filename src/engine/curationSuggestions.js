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
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/_+$/g, '') || 'category';
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

export function componentSuggestionPath({ config = {}, category }) {
  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  return path.join(helperRoot, normalizeCategory(category), '_suggestions', 'components.json');
}

export async function appendComponentCurationSuggestions({
  config = {},
  category,
  productId,
  runId,
  suggestions = [],
  specDb = null
}) {
  const filePath = componentSuggestionPath({ config, category });
  const existing = await readJsonOrNull(filePath);
  const next = existing && typeof existing === 'object'
    ? existing
    : suggestionDocDefaults(category);
  const currentSuggestions = Array.isArray(next.suggestions) ? next.suggestions : [];
  const index = new Map();

  for (const row of currentSuggestions) {
    const componentType = normalizeFieldKey(row?.component_type);
    const value = normalizeValueToken(row?.value);
    if (!componentType || !value) continue;
    index.set(`${componentType}::${value.toLowerCase()}`, row);
  }

  let appended = 0;
  for (const row of suggestions) {
    const componentType = normalizeFieldKey(row?.component_type);
    const value = normalizeValueToken(row?.normalized_value ?? row?.value ?? row?.raw_value);
    if (!componentType || !value) continue;
    const key = `${componentType}::${value.toLowerCase()}`;
    if (index.has(key)) continue;
    const suggestion = {
      suggestion_id: `comp_${componentType}_${value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`,
      suggestion_type: 'new_component',
      component_type: componentType,
      field_key: normalizeFieldKey(row?.field_key),
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

    // Dual-write to SpecDb
    if (specDb) {
      try {
        specDb.upsertCurationSuggestion({
          ...suggestion,
          last_seen_at: nowIso()
        });
      } catch { /* best-effort */ }
    }
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

export async function appendEnumCurationSuggestions({
  config = {},
  category,
  productId,
  runId,
  suggestions = [],
  specDb = null
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
    // Handle array values (e.g. list-type fields like connectivity: ['wired','wireless','bluetooth'])
    const rawValue = row?.normalized_value ?? row?.value ?? row?.raw_value;
    const valuesToProcess = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const singleValue of valuesToProcess) {
      const value = normalizeValueToken(singleValue);
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

      // Dual-write to SpecDb
      if (specDb) {
        try {
          specDb.upsertCurationSuggestion({
            ...suggestion,
            last_seen_at: nowIso()
          });
        } catch { /* best-effort */ }
      }
    }
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

// ── Component Review Items (flagged for AI review) ────────────────

export function componentReviewPath({ config = {}, category }) {
  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  return path.join(helperRoot, normalizeCategory(category), '_suggestions', 'component_review.json');
}

export async function appendComponentReviewItems({
  config = {},
  category,
  productId,
  runId,
  items = [],
  specDb = null
}) {
  const filePath = componentReviewPath({ config, category });
  const existing = await readJsonOrNull(filePath);
  const next = existing && typeof existing === 'object'
    ? existing
    : { version: 1, category: normalizeCategory(category), items: [] };
  const currentItems = Array.isArray(next.items) ? next.items : [];
  const index = new Map();

  for (const row of currentItems) {
    const componentType = normalizeFieldKey(row?.component_type);
    const rawQuery = normalizeValueToken(row?.raw_query);
    const pid = normalizeValueToken(row?.product_id);
    if (!componentType || !rawQuery) continue;
    index.set(`${componentType}::${rawQuery.toLowerCase()}::${pid}`, row);
  }

  let appended = 0;
  for (const row of items) {
    const componentType = normalizeFieldKey(row?.component_type);
    const rawQuery = normalizeValueToken(row?.raw_query);
    if (!componentType || !rawQuery) continue;
    const pid = String(productId || '').trim();
    const dedupKey = `${componentType}::${rawQuery.toLowerCase()}::${pid}`;

    if (index.has(dedupKey)) {
      const entry = index.get(dedupKey);
      entry.name_score = row.name_score ?? entry.name_score;
      entry.property_score = row.property_score ?? entry.property_score;
      entry.combined_score = row.combined_score ?? entry.combined_score;
      continue;
    }

    const item = {
      review_id: `cr_${componentType}_${rawQuery.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}_${pid.replace(/[^a-z0-9]+/gi, '_').substring(0, 30)}`,
      component_type: componentType,
      field_key: normalizeFieldKey(row?.field_key),
      raw_query: rawQuery,
      matched_component: row.matched_component || null,
      match_type: row.match_type || 'fuzzy_flagged',
      name_score: row.name_score ?? 0,
      property_score: row.property_score ?? 0,
      combined_score: row.combined_score ?? 0,
      alternatives: Array.isArray(row.alternatives) ? row.alternatives.slice(0, 5) : [],
      product_id: pid || null,
      run_id: String(runId || '').trim() || null,
      status: 'pending_ai',
      reasoning_note: typeof row.reasoning_note === 'string' ? row.reasoning_note : '',
      product_attributes: row.product_attributes && typeof row.product_attributes === 'object' ? row.product_attributes : {},
      created_at: nowIso(),
    };
    index.set(dedupKey, item);
    currentItems.push(item);
    appended += 1;

    // Dual-write to SpecDb
    if (specDb) {
      try {
        specDb.upsertComponentReviewItem(item);
      } catch { /* best-effort */ }
    }
  }

  next.version = 1;
  next.category = normalizeCategory(category);
  next.items = currentItems;
  next.updated_at = nowIso();

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');

  return {
    path: filePath,
    appended_count: appended,
    total_count: next.items.length
  };
}

// ── Component Identity Observations (successful matches) ──────────

export function componentIdentityPath({ config = {}, category }) {
  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  return path.join(helperRoot, normalizeCategory(category), '_suggestions', 'component_identity.json');
}

export async function appendComponentIdentityObservations({
  config = {},
  category,
  productId,
  runId,
  observations = [],
  specDb = null
}) {
  const filePath = componentIdentityPath({ config, category });
  const existing = await readJsonOrNull(filePath);
  const next = existing && typeof existing === 'object'
    ? existing
    : { version: 1, category: normalizeCategory(category), observations: [] };
  const currentObs = Array.isArray(next.observations) ? next.observations : [];
  const index = new Map();

  for (const row of currentObs) {
    const componentType = normalizeFieldKey(row?.component_type);
    const rawQuery = normalizeValueToken(row?.raw_query);
    const pid = normalizeValueToken(row?.product_id);
    if (!componentType || !rawQuery) continue;
    index.set(`${componentType}::${rawQuery.toLowerCase()}::${pid}`, row);
  }

  let appended = 0;
  for (const row of observations) {
    const componentType = normalizeFieldKey(row?.component_type);
    const rawQuery = normalizeValueToken(row?.raw_query);
    if (!componentType || !rawQuery) continue;
    const pid = String(productId || '').trim();
    const dedupKey = `${componentType}::${rawQuery.toLowerCase()}::${pid}`;

    if (index.has(dedupKey)) continue;

    const obs = {
      component_type: componentType,
      canonical_name: normalizeValueToken(row?.canonical_name),
      raw_query: rawQuery,
      match_type: row.match_type || 'exact_or_alias',
      score: row.score ?? 1.0,
      field_key: normalizeFieldKey(row?.field_key),
      product_id: pid || null,
      run_id: String(runId || '').trim() || null,
      observed_at: nowIso(),
    };
    index.set(dedupKey, obs);
    currentObs.push(obs);
    appended += 1;

    // Dual-write to SpecDb: update item_component_links
    if (specDb && obs.canonical_name && obs.product_id) {
      try {
        specDb.upsertItemComponentLink({
          productId: obs.product_id,
          fieldKey: obs.field_key || obs.component_type,
          componentType: obs.component_type,
          componentName: obs.canonical_name,
          componentMaker: '',
          matchType: obs.match_type || 'exact_or_alias',
          matchScore: obs.score ?? 1.0
        });
      } catch { /* best-effort */ }
    }
  }

  next.version = 1;
  next.category = normalizeCategory(category);
  next.observations = currentObs;
  next.updated_at = nowIso();

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');

  return {
    path: filePath,
    appended_count: appended,
    total_count: next.observations.length
  };
}
