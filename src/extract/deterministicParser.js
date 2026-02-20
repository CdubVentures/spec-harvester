import { normalizeWhitespace } from '../utils/common.js';

function normalizeText(value) {
  return normalizeWhitespace(String(value || '')).trim();
}

function normalizeToken(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeField(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function toSnippetRows(snippets = []) {
  if (Array.isArray(snippets)) {
    return snippets
      .map((row) => ({
        id: normalizeText(row?.id),
        ...row
      }))
      .filter((row) => row.id);
  }
  if (snippets && typeof snippets === 'object') {
    return Object.entries(snippets)
      .map(([id, row]) => ({
        id: normalizeText(id),
        ...row
      }))
      .filter((row) => row.id);
  }
  return [];
}

function stableDisplayValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableDisplayValue(item)).join(', ');
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }
  return normalizeText(value);
}

function simpleSimilarity(left, right) {
  const a = normalizeToken(left).replace(/[^a-z0-9]/g, '');
  const b = normalizeToken(right).replace(/[^a-z0-9]/g, '');
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }
  if (a.includes(b) || b.includes(a)) {
    return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  }
  const set = new Set(a.split(''));
  let matches = 0;
  for (const ch of b) {
    if (set.has(ch)) {
      matches += 1;
    }
  }
  return matches / Math.max(a.length, b.length);
}

function getByPath(value, rawPath = '') {
  const path = String(rawPath || '').trim();
  if (!path || !value || typeof value !== 'object') {
    return undefined;
  }
  const parts = path.split('.').map((item) => item.trim()).filter(Boolean);
  let cursor = value;
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object' || !Object.prototype.hasOwnProperty.call(cursor, part)) {
      return undefined;
    }
    cursor = cursor[part];
  }
  return cursor;
}

function buildCandidate({
  field,
  value,
  method,
  snippet,
  keyPath = '',
  quote = '',
  confidence = 0.9
}) {
  const snippetId = normalizeText(snippet?.id || '');
  const normalizedValue = stableDisplayValue(value);
  if (!snippetId || !normalizedValue || normalizeToken(normalizedValue) === 'unk') {
    return null;
  }
  return {
    field: normalizeField(field),
    value: normalizedValue,
    method,
    keyPath: keyPath || `deterministic.${normalizeField(field)}`,
    evidenceRefs: [snippetId],
    snippetId,
    snippetHash: normalizeText(snippet?.snippet_hash || ''),
    sourceId: normalizeText(snippet?.source_id || snippet?.source || ''),
    quote: normalizeText(quote || normalizedValue),
    confidence
  };
}

export class DeterministicParser {
  constructor(engine) {
    this.engine = engine;
    this.parseTemplates = typeof engine?.getAllParseTemplates === 'function'
      ? engine.getAllParseTemplates()
      : (engine?.parseTemplates || {});
  }

  contextMatch(text, template = {}) {
    const normalized = normalizeToken(text);
    const positives = Array.isArray(template.context_keywords) ? template.context_keywords : [];
    const negatives = Array.isArray(template.negative_keywords) ? template.negative_keywords : [];
    const hasPositive = positives.length === 0
      ? true
      : positives.some((kw) => normalized.includes(normalizeToken(kw)));
    const hasNegative = negatives.some((kw) => normalized.includes(normalizeToken(kw)));
    return hasPositive && !hasNegative;
  }

  normalizeValue(field, rawValue) {
    if (!this.engine || typeof this.engine.normalizeCandidate !== 'function') {
      return stableDisplayValue(rawValue);
    }
    const normalized = this.engine.normalizeCandidate(field, rawValue);
    if (!normalized?.ok) {
      return '';
    }
    return stableDisplayValue(normalized.normalized);
  }

  parseRegexPatterns(field, template, snippet) {
    const out = [];
    const text = normalizeText(snippet?.normalized_text || snippet?.text || '');
    if (!text || !Array.isArray(template?.patterns)) {
      return out;
    }

    for (const pattern of template.patterns) {
      const regexText = normalizeText(pattern?.regex || '');
      if (!regexText) {
        continue;
      }
      const group = Number.parseInt(String(pattern?.group || 1), 10) || 1;
      let regex;
      try {
        regex = new RegExp(regexText, 'i');
      } catch {
        continue;
      }
      const match = text.match(regex);
      if (!match || !match[group]) {
        continue;
      }
      if (!this.contextMatch(text, template)) {
        continue;
      }
      const value = this.normalizeValue(field, match[group]);
      if (!value) {
        continue;
      }
      const row = buildCandidate({
        field,
        value,
        method: 'parse_template',
        snippet,
        keyPath: `parse_template.${field}`,
        quote: match[0],
        confidence: 0.95
      });
      if (row) {
        out.push(row);
      }
    }
    return out;
  }

  parseSpecRows(field, template, snippet) {
    const out = [];
    const text = normalizeText(snippet?.normalized_text || snippet?.text || '');
    if (!text) {
      return out;
    }
    const rows = text.split('|').map((item) => normalizeText(item)).filter(Boolean);
    const keyHints = [
      field.replace(/_/g, ' '),
      ...(Array.isArray(template?.context_keywords) ? template.context_keywords : [])
    ]
      .map((item) => normalizeText(item))
      .filter(Boolean);

    for (const row of rows) {
      const kv = row.match(/^([^:]{2,64}):\s*(.{1,200})$/);
      if (!kv) {
        continue;
      }
      const key = normalizeText(kv[1]);
      const rawValue = normalizeText(kv[2]);
      if (!key || !rawValue) {
        continue;
      }
      const matchScore = Math.max(...keyHints.map((hint) => simpleSimilarity(key, hint)), 0);
      if (matchScore < 0.78) {
        continue;
      }
      const value = this.normalizeValue(field, rawValue);
      if (!value) {
        continue;
      }
      const candidate = buildCandidate({
        field,
        value,
        method: 'spec_table_match',
        snippet,
        keyPath: `spec_table.${field}`,
        quote: row,
        confidence: Math.max(0.8, Math.min(0.98, matchScore))
      });
      if (candidate) {
        out.push(candidate);
      }
    }
    return out;
  }

  parseJsonLd(field, template, snippet) {
    const snippetType = normalizeToken(snippet?.type);
    const methodByType = {
      json_ld_product: 'json_ld',
      microdata_product: 'microdata',
      opengraph_product: 'opengraph',
      microformat_product: 'microformat',
      rdfa_product: 'rdfa',
      twitter_card_product: 'twitter_card'
    };
    const method = methodByType[snippetType];
    if (!method) {
      return [];
    }
    const text = normalizeText(snippet?.text || snippet?.normalized_text || '');
    if (!text) {
      return [];
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return [];
    }

    const explicitPath = normalizeText(template?.json_ld_path || template?.json_path || '');
    const candidatePaths = [
      explicitPath,
      field,
      field.replace(/_/g, ''),
      `additionalProperty.${field}`,
      `additionalProperty.${field.replace(/_/g, '')}`
    ].filter(Boolean);

    for (const pathToken of candidatePaths) {
      const value = getByPath(parsed, pathToken);
      if (value === undefined || value === null || value === '') {
        continue;
      }
      const normalized = this.normalizeValue(field, value);
      if (!normalized) {
        continue;
      }
      const row = buildCandidate({
        field,
        value: normalized,
        method,
        snippet,
        keyPath: `${method}.${pathToken}`,
        quote: normalizeText(typeof value === 'string' ? value : JSON.stringify(value)),
        confidence: 0.9
      });
      if (row) {
        return [row];
      }
    }
    return [];
  }

  extractFromEvidencePack(evidencePack = {}, { targetFields = [] } = {}) {
    const rows = [];
    const snippets = toSnippetRows(evidencePack?.snippets);
    if (!snippets.length) {
      return rows;
    }

    const allowed = new Set((targetFields || []).map((field) => normalizeField(field)).filter(Boolean));
    const parseTemplates = this.parseTemplates && typeof this.parseTemplates === 'object'
      ? this.parseTemplates
      : {};
    const fields = Object.keys(parseTemplates)
      .map((field) => normalizeField(field))
      .filter((field) => field && (allowed.size === 0 || allowed.has(field)));

    const seen = new Set();
    for (const field of fields) {
      const template = parseTemplates[field] || {};
      for (const snippet of snippets) {
        const candidates = [
          ...this.parseRegexPatterns(field, template, snippet),
          ...this.parseSpecRows(field, template, snippet),
          ...this.parseJsonLd(field, template, snippet)
        ];
        for (const candidate of candidates) {
          const key = `${candidate.field}|${candidate.value}|${candidate.method}|${candidate.evidenceRefs?.[0] || ''}`;
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          rows.push(candidate);
        }
      }
    }

    return rows;
  }
}
