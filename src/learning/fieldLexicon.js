import { nowIso, normalizeToken } from '../utils/common.js';

const STOP_TOKENS = new Set([
  'html',
  'json',
  'dom',
  'spec',
  'specs',
  'field',
  'value',
  'data',
  'product',
  'mouse',
  'table',
  'list',
  'item',
  'node',
  'unk'
]);

function createFieldRow() {
  return {
    synonyms: {},
    units: {}
  };
}

function ensureField(artifact, field) {
  if (!artifact.fields[field]) {
    artifact.fields[field] = createFieldRow();
  }
  return artifact.fields[field];
}

function bumpSynonym(fieldRow, token, host, seenAt) {
  if (!token || token.length < 2 || STOP_TOKENS.has(token)) {
    return;
  }
  if (!fieldRow.synonyms[token]) {
    fieldRow.synonyms[token] = {
      count: 0,
      hosts: {},
      last_seen_at: seenAt
    };
  }
  fieldRow.synonyms[token].count += 1;
  if (host) {
    fieldRow.synonyms[token].hosts[host] = (fieldRow.synonyms[token].hosts[host] || 0) + 1;
  }
  fieldRow.synonyms[token].last_seen_at = seenAt;
}

function bumpUnit(fieldRow, value, seenAt) {
  const match = String(value || '').toLowerCase().match(/\b(hz|ghz|dpi|cpi|mm|cm|in|inch|g|grams|ms|mah|v)\b/g);
  if (!match?.length) {
    return;
  }
  for (const unit of match) {
    if (!fieldRow.units[unit]) {
      fieldRow.units[unit] = {
        count: 0,
        last_seen_at: seenAt
      };
    }
    fieldRow.units[unit].count += 1;
    fieldRow.units[unit].last_seen_at = seenAt;
  }
}

function trimFieldRow(fieldRow, maxSynonyms = 120, maxUnits = 50) {
  const sortedSynonyms = Object.entries(fieldRow.synonyms || {})
    .sort((a, b) => (b[1].count || 0) - (a[1].count || 0) || a[0].localeCompare(b[0]))
    .slice(0, maxSynonyms);
  fieldRow.synonyms = Object.fromEntries(sortedSynonyms);

  const sortedUnits = Object.entries(fieldRow.units || {})
    .sort((a, b) => (b[1].count || 0) - (a[1].count || 0) || a[0].localeCompare(b[0]))
    .slice(0, maxUnits);
  fieldRow.units = Object.fromEntries(sortedUnits);
}

function tokenizeKeyPath(keyPath) {
  return String(keyPath || '')
    .split(/[^a-zA-Z0-9]+/g)
    .map((token) => normalizeToken(token))
    .filter(Boolean);
}

export function defaultFieldLexicon() {
  return {
    version: 1,
    updated_at: nowIso(),
    fields: {},
    stats: {
      updates_total: 0
    }
  };
}

export function updateFieldLexicon({
  artifact,
  provenance = {},
  seenAt = nowIso()
}) {
  const next = artifact && typeof artifact === 'object'
    ? artifact
    : defaultFieldLexicon();

  for (const [field, row] of Object.entries(provenance || {})) {
    const value = String(row?.value || '').trim();
    if (!value || value.toLowerCase() === 'unk') {
      continue;
    }
    const fieldRow = ensureField(next, field);
    bumpSynonym(fieldRow, normalizeToken(field), '', seenAt);
    bumpUnit(fieldRow, value, seenAt);

    for (const evidence of row?.evidence || []) {
      const host = String(evidence.host || evidence.rootDomain || '').toLowerCase();
      for (const token of tokenizeKeyPath(evidence.keyPath)) {
        bumpSynonym(fieldRow, token, host, seenAt);
      }
      bumpSynonym(fieldRow, normalizeToken(evidence.method), host, seenAt);
    }
    trimFieldRow(fieldRow);
  }

  next.updated_at = seenAt;
  next.stats = next.stats || {};
  next.stats.updates_total = (next.stats.updates_total || 0) + 1;
  return next;
}
