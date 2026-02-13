import fs from 'node:fs/promises';
import path from 'node:path';
import { loadFieldRules } from '../field-rules/loader.js';
import { applyKeyMigrations as applyMigrationDoc } from '../field-rules/migrations.js';
import {
  NORMALIZATION_FUNCTIONS,
  asNumber,
  parseBoolean,
  parseDate,
  parseList,
  parseNumberAndUnit,
  convertUnit,
  canonicalUnitToken
} from './normalization-functions.js';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeToken(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeFieldKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function isUnknownToken(value) {
  if (isObject(value) && Object.prototype.hasOwnProperty.call(value, 'value')) {
    return isUnknownToken(value.value);
  }
  const token = normalizeToken(value);
  return token === '' || token === 'unk' || token === 'unknown' || token === 'n/a' || token === '-' || token === 'none';
}

function parseRange(rule = {}) {
  const contract = isObject(rule.contract) ? rule.contract : {};
  const validate = isObject(rule.validate) ? rule.validate : {};
  const min = asNumber(contract?.range?.min ?? validate?.min);
  const max = asNumber(contract?.range?.max ?? validate?.max);
  return { min, max };
}

function parseRuleType(rule = {}) {
  const contract = isObject(rule.contract) ? rule.contract : {};
  return normalizeToken(rule.data_type || contract.type || rule.type || 'string') || 'string';
}

function parseRuleShape(rule = {}) {
  const contract = isObject(rule.contract) ? rule.contract : {};
  return normalizeToken(rule.output_shape || contract.shape || rule.shape || 'scalar') || 'scalar';
}

function parseRuleUnit(rule = {}) {
  const contract = isObject(rule.contract) ? rule.contract : {};
  return canonicalUnitToken(contract.unit || rule.unit || '');
}

function parseRuleNormalizationFn(rule = {}) {
  const contract = isObject(rule.contract) ? rule.contract : {};
  const parseBlock = isObject(rule.parse) ? rule.parse : {};
  return normalizeToken(
    rule.normalization_fn ||
    contract.normalization_fn ||
    parseBlock.normalization_fn ||
    ''
  );
}

function requiredLevel(rule = {}) {
  return normalizeToken(
    rule.required_level ||
    (isObject(rule.priority) ? rule.priority.required_level : '') ||
    'optional'
  ) || 'optional';
}

function availabilityLevel(rule = {}) {
  return normalizeToken(
    rule.availability ||
    (isObject(rule.priority) ? rule.priority.availability : '') ||
    'sometimes'
  ) || 'sometimes';
}

function difficultyLevel(rule = {}) {
  return normalizeToken(
    rule.difficulty ||
    (isObject(rule.priority) ? rule.priority.difficulty : '') ||
    'medium'
  ) || 'medium';
}

function groupKey(rule = {}) {
  return normalizeFieldKey(rule.group || rule?.ui?.group || 'general') || 'general';
}

function buildUiGroupIndex(uiFieldCatalog = {}) {
  const out = new Map();
  const rows = Array.isArray(uiFieldCatalog?.fields) ? uiFieldCatalog.fields : [];
  for (const row of rows) {
    if (!isObject(row)) {
      continue;
    }
    const key = normalizeFieldKey(row.key || row.field_key || '');
    const group = normalizeFieldKey(row.group || row.group_key || '');
    if (!key || !group) {
      continue;
    }
    out.set(key, group);
  }
  return out;
}

function buildEnumIndex(knownValues = {}) {
  const out = new Map();
  const enums = isObject(knownValues.enums) ? knownValues.enums : {};
  for (const [rawField, row] of Object.entries(enums)) {
    const field = normalizeFieldKey(rawField);
    if (!field || !row) {
      continue;
    }
    const fieldMap = new Map();
    for (const entry of toArray(row.values)) {
      if (isObject(entry)) {
        const canonical = normalizeText(entry.canonical || entry.value || '');
        if (!canonical) {
          continue;
        }
        fieldMap.set(normalizeToken(canonical), canonical);
        for (const alias of toArray(entry.aliases)) {
          const token = normalizeToken(alias);
          if (token) {
            fieldMap.set(token, canonical);
          }
        }
      } else {
        const canonical = normalizeText(entry);
        if (!canonical) {
          continue;
        }
        fieldMap.set(normalizeToken(canonical), canonical);
      }
    }
    out.set(field, {
      policy: normalizeToken(row.policy || 'open') || 'open',
      index: fieldMap
    });
  }
  return out;
}

function buildRuleEnumSpec(rule = {}) {
  const out = new Map();
  const enumCandidates = [
    ...toArray(rule?.enum),
    ...toArray(rule?.contract?.enum),
    ...toArray(rule?.validate?.enum)
  ];

  for (const entry of enumCandidates) {
    if (isObject(entry)) {
      const canonical = normalizeText(entry.canonical || entry.value || '');
      if (!canonical) {
        continue;
      }
      out.set(normalizeToken(canonical), canonical);
      for (const alias of toArray(entry.aliases)) {
        const aliasToken = normalizeToken(alias);
        if (aliasToken) {
          out.set(aliasToken, canonical);
        }
      }
      continue;
    }
    const canonical = normalizeText(entry);
    if (!canonical) {
      continue;
    }
    out.set(normalizeToken(canonical), canonical);
  }

  const aliasCandidates = [rule?.aliases, rule?.enum?.aliases, rule?.contract?.aliases];
  for (const aliasMap of aliasCandidates) {
    if (!isObject(aliasMap)) {
      continue;
    }
    for (const [alias, canonicalRaw] of Object.entries(aliasMap)) {
      const aliasToken = normalizeToken(alias);
      const canonical = normalizeText(canonicalRaw);
      if (!aliasToken || !canonical) {
        continue;
      }
      out.set(aliasToken, canonical);
    }
  }

  return {
    policy: normalizeToken(rule.enum_policy || rule?.enum?.policy || 'open') || 'open',
    index: out
  };
}

function safeJsonParse(raw = '') {
  try {
    return JSON.parse(String(raw || ''));
  } catch {
    return null;
  }
}

function simpleSimilarity(left, right) {
  const a = normalizeToken(left);
  const b = normalizeToken(right);
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }
  const short = a.length < b.length ? a : b;
  const long = a.length < b.length ? b : a;
  if (long.includes(short)) {
    return short.length / long.length;
  }
  let matches = 0;
  const set = new Set(short.split(''));
  for (const ch of long) {
    if (set.has(ch)) {
      matches += 1;
    }
  }
  return matches / Math.max(short.length, long.length);
}

function evaluateInCondition(condition = '', fields = {}) {
  const text = String(condition || '').trim();
  const match = text.match(/^([a-zA-Z0-9_]+)\s+IN\s+\[(.+)\]$/i);
  if (!match) {
    return false;
  }
  const fieldKey = normalizeFieldKey(match[1]);
  const rawValues = String(match[2] || '')
    .split(',')
    .map((item) => normalizeToken(item.replace(/['"]/g, '').trim()))
    .filter(Boolean);
  const current = normalizeToken(fields[fieldKey]);
  return rawValues.includes(current);
}

function canonicalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isValidIsoDateTime(value) {
  if (!value) {
    return false;
  }
  const text = String(value).trim();
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) && text.includes('T');
}

export class FieldRulesEngine {
  constructor({
    category,
    loaded,
    keyMigrations = {},
    options = {}
  }) {
    this.category = normalizeFieldKey(category);
    this.loaded = loaded || {};
    this.rules = isObject(loaded?.rules?.fields) ? loaded.rules.fields : {};
    this.knownValues = loaded?.knownValues || {};
    this.parseTemplates = isObject(loaded?.parseTemplates?.templates) ? loaded.parseTemplates.templates : {};
    this.crossValidationRules = toArray(loaded?.crossValidation);
    this.componentDBs = isObject(loaded?.componentDBs) ? loaded.componentDBs : {};
    this.uiFieldCatalog = loaded?.uiFieldCatalog || { fields: [] };
    this.uiGroupByField = buildUiGroupIndex(this.uiFieldCatalog);
    this.keyMigrations = isObject(keyMigrations) ? keyMigrations : {};
    this.options = options || {};
    this.enumIndex = buildEnumIndex(this.knownValues);
  }

  static async create(category, options = {}) {
    const loaded = await loadFieldRules(category, options);
    const generatedRoot = loaded?.generatedRoot || '';
    const keyMigrationsPath = generatedRoot
      ? path.join(generatedRoot, 'key_migrations.json')
      : '';
    let keyMigrations = {};
    if (keyMigrationsPath) {
      try {
        const raw = await fs.readFile(keyMigrationsPath, 'utf8');
        keyMigrations = safeJsonParse(raw) || {};
      } catch {
        keyMigrations = {};
      }
    }
    return new FieldRulesEngine({
      category,
      loaded,
      keyMigrations,
      options
    });
  }

  getAllFieldKeys() {
    return Object.keys(this.rules)
      .map((field) => normalizeFieldKey(field))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }

  getRequiredFields() {
    return this.getAllFieldKeys()
      .filter((field) => ['required', 'identity'].includes(requiredLevel(this.rules[field])))
      .map((field) => ({ key: field, rule: this.rules[field] }));
  }

  getCriticalFields() {
    return this.getAllFieldKeys()
      .filter((field) => requiredLevel(this.rules[field]) === 'critical')
      .map((field) => ({ key: field, rule: this.rules[field] }));
  }

  resolveFieldGroup(fieldKey) {
    const key = normalizeFieldKey(fieldKey);
    if (!key) {
      return 'general';
    }
    if (this.uiGroupByField.has(key)) {
      return this.uiGroupByField.get(key);
    }
    return groupKey(this.rules[key]);
  }

  getFieldsByGroup(group) {
    const wanted = normalizeFieldKey(group);
    return this.getAllFieldKeys()
      .filter((field) => this.resolveFieldGroup(field) === wanted)
      .map((field) => ({ key: field, rule: this.rules[field] }));
  }

  getFieldsByRequiredLevel(level) {
    const wanted = normalizeToken(level);
    return this.getAllFieldKeys()
      .filter((field) => requiredLevel(this.rules[field]) === wanted)
      .map((field) => ({ key: field, rule: this.rules[field] }));
  }

  getFieldsByAvailability(availability) {
    const wanted = normalizeToken(availability);
    return this.getAllFieldKeys()
      .filter((field) => availabilityLevel(this.rules[field]) === wanted)
      .map((field) => ({ key: field, rule: this.rules[field] }));
  }

  getFieldsForRound(roundNumber = 1) {
    const round = Math.max(1, Number.parseInt(String(roundNumber || 1), 10) || 1);
    const required = this.getAllFieldKeys().filter((field) => {
      const level = requiredLevel(this.rules[field]);
      if (round === 1) {
        return level === 'required' || level === 'critical' || level === 'identity';
      }
      if (round === 2) {
        return level === 'expected' && difficultyLevel(this.rules[field]) === 'easy';
      }
      return level === 'expected' || level === 'optional';
    });
    return {
      targetFields: required,
      maxEffort: round === 1 ? 4 : (round === 2 ? 7 : 10)
    };
  }

  getParseTemplate(fieldKey) {
    const key = normalizeFieldKey(fieldKey);
    return isObject(this.parseTemplates[key]) ? this.parseTemplates[key] : null;
  }

  applyParseTemplate(fieldKey, text) {
    const template = this.getParseTemplate(fieldKey);
    if (!template) {
      return { matched: false };
    }
    for (const pattern of toArray(template.patterns)) {
      const regex = normalizeText(pattern?.regex || '');
      if (!regex) {
        continue;
      }
      const groupIndex = Number.parseInt(String(pattern?.group || pattern?.group_index || 1), 10) || 1;
      try {
        const match = String(text ?? '').match(new RegExp(regex, 'i'));
        if (!match) {
          continue;
        }
        return {
          matched: true,
          value: match[groupIndex] ?? match[0],
          pattern_used: regex
        };
      } catch {
        continue;
      }
    }
    return { matched: false };
  }

  lookupComponent(dbName, query) {
    const dbKey = normalizeFieldKey(dbName);
    if (!dbKey || !isObject(this.componentDBs[dbKey])) {
      return null;
    }
    const token = normalizeToken(query);
    if (!token) {
      return null;
    }
    const db = this.componentDBs[dbKey];
    return db.__index?.get(token) || db.__index?.get(token.replace(/\s+/g, '')) || null;
  }

  fuzzyMatchComponent(dbName, query, threshold = 0.75) {
    const dbKey = normalizeFieldKey(dbName);
    if (!dbKey || !isObject(this.componentDBs[dbKey])) {
      return { match: null, score: 0, alternatives: [] };
    }
    const entries = Object.values(this.componentDBs[dbKey].entries || {});
    let best = null;
    let bestScore = 0;
    const alternatives = [];
    for (const entry of entries) {
      const score = simpleSimilarity(query, entry.canonical_name);
      alternatives.push({
        canonical_name: entry.canonical_name,
        score
      });
      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
    }
    alternatives.sort((a, b) => b.score - a.score || a.canonical_name.localeCompare(b.canonical_name));
    return {
      match: bestScore >= threshold ? best : null,
      score: bestScore,
      alternatives: alternatives.slice(0, 5)
    };
  }

  validateRange(fieldKey, numericValue) {
    const key = normalizeFieldKey(fieldKey);
    const rule = this.rules[key];
    if (!rule) {
      return { ok: true };
    }
    const value = asNumber(numericValue);
    if (value === null) {
      return { ok: false, reason_code: 'number_required' };
    }
    const range = parseRange(rule);
    if (range.min !== null && value < range.min) {
      return {
        ok: false,
        reason_code: 'out_of_range',
        range_min: range.min,
        range_max: range.max,
        actual: value
      };
    }
    if (range.max !== null && value > range.max) {
      return {
        ok: false,
        reason_code: 'out_of_range',
        range_min: range.min,
        range_max: range.max,
        actual: value
      };
    }
    return { ok: true };
  }

  validateShapeAndUnits(fieldKey, normalized) {
    const key = normalizeFieldKey(fieldKey);
    const rule = this.rules[key];
    if (!rule) {
      return { ok: true };
    }
    const shape = parseRuleShape(rule);
    const type = parseRuleType(rule);
    if (shape === 'list' && !Array.isArray(normalized)) {
      return { ok: false, reason_code: 'shape_mismatch', expected_shape: 'list', actual_shape: 'scalar' };
    }
    if (shape === 'scalar' && Array.isArray(normalized)) {
      return { ok: false, reason_code: 'shape_mismatch', expected_shape: 'scalar', actual_shape: 'list' };
    }
    if ((type === 'number' || type === 'integer') && shape === 'list') {
      const values = Array.isArray(normalized) ? normalized : [];
      if (values.some((item) => asNumber(item) === null)) {
        return { ok: false, reason_code: 'number_required', expected_shape: shape, actual_shape: typeof normalized };
      }
      return { ok: true };
    }
    if ((type === 'number' || type === 'integer') && asNumber(normalized) === null) {
      return { ok: false, reason_code: 'number_required', expected_shape: shape, actual_shape: typeof normalized };
    }
    return { ok: true };
  }

  enforceEnumPolicy(fieldKey, normalized) {
    const key = normalizeFieldKey(fieldKey);
    const rule = this.rules[key] || {};
    const fromRule = normalizeToken(rule.enum_policy || rule?.enum?.policy || '');
    const enumSpec = this.enumIndex.get(key) || buildRuleEnumSpec(rule);
    const policy = fromRule || normalizeToken(enumSpec?.policy || 'open') || 'open';
    if (!enumSpec || enumSpec.index.size === 0) {
      if (policy === 'closed') {
        return {
          ok: false,
          reason_code: 'enum_value_not_allowed',
          needs_curation: false
        };
      }
      return {
        ok: true,
        canonical_value: normalized,
        was_aliased: false,
        needs_curation: false
      };
    }

    const values = Array.isArray(normalized) ? normalized : [normalized];
    const canonicalized = [];
    let wasAliased = false;
    let needsCuration = false;

    for (const rawValue of values) {
      const token = normalizeToken(rawValue);
      if (enumSpec.index.has(token)) {
        const canonical = enumSpec.index.get(token);
        canonicalized.push(canonical);
        wasAliased = wasAliased || normalizeToken(canonical) !== token;
        continue;
      }
      if (policy === 'closed') {
        return {
          ok: false,
          reason_code: 'enum_value_not_allowed',
          needs_curation: false
        };
      }
      canonicalized.push(rawValue);
      needsCuration = true;
    }

    return {
      ok: true,
      canonical_value: Array.isArray(normalized) ? canonicalized : canonicalized[0],
      was_aliased: wasAliased,
      needs_curation: needsCuration
    };
  }

  auditEvidence(fieldKey, value, provenance = {}, context = {}) {
    if (isUnknownToken(value)) {
      return { ok: true };
    }
    const missing = [];
    const url = normalizeText(provenance.url);
    const sourceId = normalizeText(provenance.source_id);
    const snippetId = normalizeText(provenance.snippet_id);
    const snippetHash = normalizeText(provenance.snippet_hash);
    const quote = normalizeText(provenance.quote);
    const quoteSpan = Array.isArray(provenance.quote_span) ? provenance.quote_span : null;
    const retrievedAt = normalizeText(provenance.retrieved_at);
    const extractionMethod = normalizeToken(provenance.extraction_method);
    const strictEvidence = Boolean(context?.strictEvidence);
    if (!url) missing.push('url');
    if (!snippetId) missing.push('snippet_id');
    if (!quote) missing.push('quote');
    if (strictEvidence && !sourceId) missing.push('source_id');
    if (strictEvidence && !snippetHash) missing.push('snippet_hash');
    if (strictEvidence && !retrievedAt) missing.push('retrieved_at');
    if (strictEvidence && !extractionMethod) missing.push('extraction_method');
    try {
      if (url) {
        // URL constructor throws on invalid URL text.
        // eslint-disable-next-line no-new
        new URL(url);
      }
    } catch {
      missing.push('url_invalid');
    }

    const snippetRows = context?.evidencePack?.snippets;
    const snippets = new Map();
    if (Array.isArray(snippetRows)) {
      for (const row of snippetRows) {
        const id = normalizeText(row?.id || '');
        if (!id) {
          continue;
        }
        snippets.set(id, row);
      }
    } else if (isObject(snippetRows)) {
      for (const [id, row] of Object.entries(snippetRows)) {
        snippets.set(normalizeText(id), row);
      }
    }

    let reasonCode = 'evidence_missing';

    if (snippetId) {
      const snippet = snippets.get(snippetId);
      if (!isObject(snippet)) {
        missing.push('snippet_id_not_found');
      } else {
        const snippetText = normalizeText(snippet.normalized_text || snippet.text || '');
        if (strictEvidence && !snippetText) {
          missing.push('snippet_text_missing');
        }

        const provenanceHash = normalizeText(snippetHash);
        const snippetRowHash = normalizeText(snippet.snippet_hash || '');
        if (strictEvidence && provenanceHash && snippetRowHash && provenanceHash !== snippetRowHash) {
          missing.push('snippet_hash_mismatch');
          reasonCode = 'evidence_stale';
        }

        if (quoteSpan && snippetText) {
          const start = Number.parseInt(String(quoteSpan[0]), 10);
          const end = Number.parseInt(String(quoteSpan[1]), 10);
          if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > snippetText.length) {
            missing.push('quote_span_invalid');
          } else {
            const spanned = snippetText.slice(start, end);
            if (canonicalizeWhitespace(spanned) !== canonicalizeWhitespace(quote)) {
              missing.push('quote_span_mismatch');
            }
          }
        } else if (quote && snippetText && !canonicalizeWhitespace(snippetText).includes(canonicalizeWhitespace(quote))) {
          missing.push('quote_not_in_snippet');
        }
      }
    }

    if (strictEvidence) {
      if (retrievedAt && !isValidIsoDateTime(retrievedAt)) {
        missing.push('retrieved_at_invalid');
      }
      const allowedExtractionMethods = new Set([
        'spec_table_match',
        'parse_template',
        'json_ld',
        'llm_extract',
        'api_fetch',
        'component_db_inference'
      ]);
      if (extractionMethod && !allowedExtractionMethods.has(extractionMethod)) {
        missing.push('extraction_method_invalid');
      }

      const sourceRows = context?.evidencePack?.sources;
      if (sourceId && sourceRows && Array.isArray(sourceRows) && sourceRows.length > 0) {
        const foundSource = sourceRows.some((row) => normalizeText(row?.id) === sourceId);
        if (!foundSource) {
          missing.push('source_id_not_found');
        }
      } else if (sourceId && sourceRows && isObject(sourceRows) && Object.keys(sourceRows).length > 0) {
        const foundSource = Object.prototype.hasOwnProperty.call(sourceRows, sourceId);
        if (!foundSource) {
          missing.push('source_id_not_found');
        }
      }
    }

    if (missing.length > 0) {
      return {
        ok: false,
        reason_code: reasonCode,
        missing
      };
    }
    return { ok: true };
  }

  buildUnknown(fieldKey, unknownReason = 'not_found_after_search', attemptTrace = null) {
    const key = normalizeFieldKey(fieldKey);
    const rule = this.rules[key] || {};
    return {
      value: 'unk',
      unknown_reason: normalizeToken(unknownReason) || 'not_found_after_search',
      field_key: key,
      required_level: requiredLevel(rule),
      difficulty: difficultyLevel(rule),
      attempt_trace: attemptTrace || null,
      field_metadata: {
        data_type: parseRuleType(rule),
        output_shape: parseRuleShape(rule),
        group: this.resolveFieldGroup(key)
      }
    };
  }

  applyKeyMigrations(record = {}) {
    return applyMigrationDoc(record, this.keyMigrations);
  }

  normalizeCandidate(fieldKey, rawCandidate, context = {}) {
    const key = normalizeFieldKey(fieldKey);
    const rule = this.rules[key];
    if (!rule) {
      return {
        ok: false,
        reason_code: 'field_not_found',
        raw_input: rawCandidate,
        attempted_normalizations: []
      };
    }
    const attempts = [];
    if (rawCandidate === null || rawCandidate === undefined || isUnknownToken(rawCandidate)) {
      return {
        ok: false,
        reason_code: 'empty_value',
        raw_input: rawCandidate,
        attempted_normalizations: attempts
      };
    }

    const type = parseRuleType(rule);
    const shape = parseRuleShape(rule);
    const unit = parseRuleUnit(rule);
    const normalizationFnName = parseRuleNormalizationFn(rule);
    let value = rawCandidate;

    if (shape === 'list') {
      value = parseList(rawCandidate);
      attempts.push('shape:list');
    } else if (Array.isArray(value)) {
      value = value[0];
      attempts.push('shape:scalar_from_array');
    }

    if (normalizationFnName) {
      const fn = NORMALIZATION_FUNCTIONS[normalizationFnName];
      if (typeof fn === 'function') {
        try {
          const normalizedValue = fn(value, {
            field_key: key,
            rule,
            shape,
            type,
            unit
          });
          if (normalizedValue === null || normalizedValue === undefined) {
            return {
              ok: false,
              reason_code: 'normalization_fn_failed',
              raw_input: rawCandidate,
              attempted_normalizations: attempts
            };
          }
          value = normalizedValue;
          attempts.push(`fn:${normalizationFnName}`);
        } catch {
          return {
            ok: false,
            reason_code: 'normalization_fn_failed',
            raw_input: rawCandidate,
            attempted_normalizations: attempts
          };
        }
      }
    }

    if (type === 'number' || type === 'integer') {
      if (Array.isArray(value)) {
        const normalizedList = [];
        for (const entry of value) {
          const parsed = parseNumberAndUnit(entry);
          if (parsed.value === null) {
            return {
              ok: false,
              reason_code: 'number_required',
              raw_input: rawCandidate,
              attempted_normalizations: attempts
            };
          }
          let numeric = parsed.value;
          const fromUnit = canonicalUnitToken(parsed.unit);
          if (unit && fromUnit && fromUnit !== unit) {
            numeric = convertUnit(numeric, fromUnit, unit);
            attempts.push(`unit:${fromUnit}->${unit}`);
          }
          if (type === 'integer') {
            numeric = Math.round(numeric);
            attempts.push('round:integer');
          }
          normalizedList.push(Number.parseFloat(numeric.toFixed(6)));
        }
        value = normalizedList;
      } else {
        const parsed = parseNumberAndUnit(value);
        if (parsed.value === null) {
          return {
            ok: false,
            reason_code: 'number_required',
            raw_input: rawCandidate,
            attempted_normalizations: attempts
          };
        }
        let numeric = parsed.value;
        const fromUnit = canonicalUnitToken(parsed.unit);
        if (unit && fromUnit && fromUnit !== unit) {
          numeric = convertUnit(numeric, fromUnit, unit);
          attempts.push(`unit:${fromUnit}->${unit}`);
        }
        if (type === 'integer') {
          numeric = Math.round(numeric);
          attempts.push('round:integer');
        }
        value = Number.parseFloat(numeric.toFixed(6));
      }
    } else if (type === 'boolean') {
      const boolValue = parseBoolean(value);
      if (boolValue === null) {
        return {
          ok: false,
          reason_code: 'boolean_required',
          raw_input: rawCandidate,
          attempted_normalizations: attempts
        };
      }
      value = boolValue;
    } else if (type === 'date') {
      const dateValue = parseDate(value);
      if (!dateValue) {
        return {
          ok: false,
          reason_code: 'date_required',
          raw_input: rawCandidate,
          attempted_normalizations: attempts
        };
      }
      value = dateValue;
    } else if (type === 'url') {
      const urlValue = normalizeText(value);
      if (!urlValue) {
        return {
          ok: false,
          reason_code: 'url_required',
          raw_input: rawCandidate,
          attempted_normalizations: attempts
        };
      }
      try {
        // URL constructor throws on invalid URL text.
        // eslint-disable-next-line no-new
        new URL(urlValue);
      } catch {
        return {
          ok: false,
          reason_code: 'url_required',
          raw_input: rawCandidate,
          attempted_normalizations: attempts
        };
      }
      value = urlValue;
    } else if (type === 'component_ref' || normalizeText(rule?.component_db_ref)) {
      const dbName = normalizeText(rule?.component_db_ref);
      if (!dbName) {
        return {
          ok: false,
          reason_code: 'component_db_missing',
          raw_input: rawCandidate,
          attempted_normalizations: attempts
        };
      }
      const query = normalizeText(Array.isArray(value) ? value[0] : value);
      const exact = this.lookupComponent(dbName, query);
      if (exact) {
        value = exact.canonical_name;
        attempts.push('component:exact_or_alias');
      } else {
        const fuzzy = this.fuzzyMatchComponent(dbName, query, 0.75);
        if (fuzzy.match) {
          value = fuzzy.match.canonical_name;
          attempts.push(`component:fuzzy:${Number.parseFloat(String(fuzzy.score)).toFixed(2)}`);
        } else {
          return {
            ok: false,
            reason_code: 'component_not_found',
            raw_input: rawCandidate,
            attempted_normalizations: attempts
          };
        }
      }
    } else {
      value = normalizeText(value);
    }

    const shapeCheck = this.validateShapeAndUnits(key, value);
    if (!shapeCheck.ok) {
      return {
        ok: false,
        reason_code: shapeCheck.reason_code || 'shape_mismatch',
        raw_input: rawCandidate,
        attempted_normalizations: attempts
      };
    }

    if (type === 'number' || type === 'integer') {
      const numericValues = Array.isArray(value) ? value : [value];
      for (const numericValue of numericValues) {
        const range = this.validateRange(key, numericValue);
        if (!range.ok) {
          return {
            ok: false,
            reason_code: range.reason_code || 'out_of_range',
            raw_input: rawCandidate,
            attempted_normalizations: attempts
          };
        }
      }
    }

    const enumCheck = this.enforceEnumPolicy(key, value);
    if (!enumCheck.ok) {
      return {
        ok: false,
        reason_code: enumCheck.reason_code || 'enum_value_not_allowed',
        raw_input: rawCandidate,
        attempted_normalizations: attempts
      };
    }

    if (enumCheck.needs_curation && Array.isArray(context?.curationQueue)) {
      context.curationQueue.push({
        field_key: key,
        raw_value: rawCandidate,
        normalized_value: enumCheck.canonical_value
      });
    }

    return {
      ok: true,
      normalized: enumCheck.canonical_value,
      applied_rules: attempts
    };
  }

  crossValidate(fieldKey, value, allFields = {}) {
    const key = normalizeFieldKey(fieldKey);
    if (!key || isUnknownToken(value)) {
      return { ok: true, checks_passed: [] };
    }
    const violations = [];
    const passed = [];

    for (const rule of this.crossValidationRules) {
      const trigger = normalizeFieldKey(rule?.trigger_field || '');
      if (trigger !== key) {
        continue;
      }

      const checkType = normalizeToken(rule?.check?.type || '');
      if (checkType === 'range') {
        const min = asNumber(rule?.check?.min);
        const max = asNumber(rule?.check?.max);
        const numeric = asNumber(value);
        if (numeric === null) {
          continue;
        }
        if ((min !== null && numeric < min) || (max !== null && numeric > max)) {
          violations.push({
            rule: rule.rule_id || 'range',
            severity: 'error',
            message: 'range violation'
          });
          continue;
        }
        passed.push(rule.rule_id || 'range');
        continue;
      }

      if (checkType === 'component_db_lookup') {
        const dbName = normalizeText(rule?.check?.db || '');
        const lookupField = normalizeFieldKey(rule?.check?.lookup_field || '');
        const compareField = normalizeFieldKey(rule?.check?.compare_field || '');
        const tolerancePercent = asNumber(rule?.check?.tolerance_percent) ?? 0;
        const triggerNumeric = asNumber(value);
        const lookupValue = lookupField ? allFields[lookupField] : null;
        if (!dbName || !lookupField || !compareField || triggerNumeric === null || isUnknownToken(lookupValue)) {
          continue;
        }
        const component = this.lookupComponent(dbName, lookupValue);
        if (!component) {
          continue;
        }
        const compareValue = asNumber(component?.properties?.[compareField] ?? component?.[compareField]);
        if (compareValue === null) {
          continue;
        }
        const maxAllowed = compareValue * (1 + (tolerancePercent / 100));
        if (triggerNumeric > maxAllowed) {
          violations.push({
            rule: rule.rule_id || 'component_db_lookup',
            severity: 'error',
            message: `${key} exceeds ${lookupField} ${compareField}`
          });
          continue;
        }
        passed.push(rule.rule_id || 'component_db_lookup');
        continue;
      }

      if (checkType === 'group_completeness') {
        const relatedFields = toArray(rule?.related_fields).map((item) => normalizeFieldKey(item)).filter(Boolean);
        const minPresent = Number.parseInt(String(rule?.check?.minimum_present ?? relatedFields.length), 10);
        if (relatedFields.length === 0) {
          continue;
        }
        const presentCount = relatedFields.reduce((count, relatedField) => {
          return count + (isUnknownToken(allFields[relatedField]) ? 0 : 1);
        }, 0);
        if (Number.isFinite(minPresent) && presentCount < minPresent) {
          violations.push({
            rule: rule.rule_id || 'group_completeness',
            severity: 'warning',
            message: `expected at least ${minPresent} fields in group`
          });
          continue;
        }
        passed.push(rule.rule_id || 'group_completeness');
        continue;
      }

      if (checkType === 'mutual_exclusion') {
        const relatedFields = toArray(rule?.related_fields).map((item) => normalizeFieldKey(item)).filter(Boolean);
        const hasCondition = Boolean(normalizeText(rule?.condition));
        if (hasCondition && !evaluateInCondition(rule.condition, allFields)) {
          continue;
        }
        const presentConflicts = relatedFields.filter((relatedField) => !isUnknownToken(allFields[relatedField]));
        if (presentConflicts.length > 0) {
          violations.push({
            rule: rule.rule_id || 'mutual_exclusion',
            severity: 'error',
            message: `${key} conflicts with ${presentConflicts.join(', ')}`
          });
          continue;
        }
        passed.push(rule.rule_id || 'mutual_exclusion');
        continue;
      }

      if (normalizeText(rule?.condition) && normalizeText(rule?.requires_field)) {
        const conditionMet = evaluateInCondition(rule.condition, allFields);
        if (!conditionMet) {
          continue;
        }
        const requiresField = normalizeFieldKey(rule.requires_field);
        if (!requiresField || isUnknownToken(allFields[requiresField])) {
          violations.push({
            rule: rule.rule_id || 'conditional_require',
            severity: 'warning',
            message: `${requiresField} missing`
          });
          continue;
        }
        passed.push(rule.rule_id || 'conditional_require');
      }
    }

    if (violations.length > 0) {
      return {
        ok: false,
        violations,
        severity: violations.some((row) => row.severity === 'error') ? 'error' : 'warning'
      };
    }
    return {
      ok: true,
      checks_passed: passed
    };
  }

  validateFullRecord(record = {}) {
    const normalized = this.applyKeyMigrations(record);
    const errors = [];
    const warnings = [];
    for (const field of this.getAllFieldKeys()) {
      const value = normalized[field];
      if (value === undefined || isUnknownToken(value)) {
        continue;
      }
      const shapeCheck = this.validateShapeAndUnits(field, value);
      if (!shapeCheck.ok) {
        errors.push(`${field}:${shapeCheck.reason_code}`);
      }
      const enumCheck = this.enforceEnumPolicy(field, value);
      if (!enumCheck.ok) {
        errors.push(`${field}:${enumCheck.reason_code}`);
      }
      const type = parseRuleType(this.rules[field]);
      if (type === 'number' || type === 'integer') {
        const range = this.validateRange(field, value);
        if (!range.ok) {
          errors.push(`${field}:${range.reason_code}`);
        }
      }
      const cross = this.crossValidate(field, value, normalized);
      if (!cross.ok) {
        for (const violation of cross.violations) {
          (violation.severity === 'error' ? errors : warnings).push(`${field}:${violation.rule}`);
        }
      }
    }
    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  normalizeFullRecord(rawRecord = {}, context = {}) {
    const input = this.applyKeyMigrations(rawRecord);
    const normalized = {};
    const failures = [];
    const unknowns = [];
    const provenanceByField = isObject(context.provenanceByField) ? context.provenanceByField : {};

    for (const field of this.getAllFieldKeys()) {
      const rawValue = input[field];
      const candidate = this.normalizeCandidate(field, rawValue, context);
      if (!candidate.ok) {
        const unknown = this.buildUnknown(field, candidate.reason_code || 'not_found_after_search');
        normalized[field] = unknown;
        unknowns.push(unknown);
        failures.push({
          field_key: field,
          reason_code: candidate.reason_code || 'normalize_failed'
        });
        continue;
      }

      const evidence = this.auditEvidence(field, candidate.normalized, provenanceByField[field], context);
      if (!evidence.ok) {
        const unknown = this.buildUnknown(field, 'evidence_missing');
        normalized[field] = unknown;
        unknowns.push(unknown);
        failures.push({
          field_key: field,
          reason_code: 'evidence_missing'
        });
        continue;
      }

      normalized[field] = candidate.normalized;
    }

    for (const field of Object.keys(normalized)) {
      const value = normalized[field];
      if (isObject(value) && value.value === 'unk') {
        continue;
      }
      const cross = this.crossValidate(field, value, normalized);
      if (!cross.ok) {
        for (const violation of cross.violations) {
          if (violation.severity === 'error') {
            const unknown = this.buildUnknown(field, 'cross_validation_failed');
            normalized[field] = unknown;
            unknowns.push(unknown);
            failures.push({
              field_key: field,
              reason_code: 'cross_validation_failed',
              rule: violation.rule
            });
          } else {
            failures.push({
              field_key: field,
              reason_code: 'cross_validation_warning',
              rule: violation.rule
            });
          }
        }
      }
    }

    return {
      normalized,
      failures,
      unknowns
    };
  }
}

export async function createFieldRulesEngine(category, options = {}) {
  return FieldRulesEngine.create(category, options);
}
