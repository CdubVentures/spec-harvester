import { normalizeWhitespace } from '../utils/common.js';
import {
  ruleAiMode,
  ruleAiReasoningNote,
  ruleAvailability,
  ruleDifficulty,
  ruleEffort,
  ruleEvidenceRequired,
  ruleListRules,
  ruleMinEvidenceRefs,
  ruleParseTemplate,
  ruleRange,
  ruleRequiredLevel,
  ruleShape,
  ruleType,
  ruleUnit
} from '../engine/ruleAccessors.js';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeFieldKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function clipText(value, maxChars = 320) {
  const text = normalizeWhitespace(String(value || ''));
  const cap = Math.max(80, Number.parseInt(String(maxChars || 320), 10) || 320);
  if (text.length <= cap) return text;
  return `${text.slice(0, cap)}...`;
}

function uniqueStrings(values = [], maxCount = 120) {
  const out = [];
  const seen = new Set();
  for (const raw of values || []) {
    const token = String(raw || '').trim();
    if (!token) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
    if (out.length >= Math.max(1, maxCount)) break;
  }
  return out;
}

function normalizeTierPreference(value) {
  const rows = [];
  for (const item of toArray(value)) {
    const token = String(item || '').trim().toLowerCase();
    if (!token) continue;
    if (token.startsWith('tier')) {
      const num = Number.parseInt(token.replace(/[^0-9]+/g, ''), 10);
      if (Number.isFinite(num) && num > 0) {
        rows.push(num);
        continue;
      }
    }
    const parsed = Number.parseInt(token, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      rows.push(parsed);
    }
  }
  return [...new Set(rows)];
}

function lookupUiByField(uiFieldCatalog = null) {
  const map = new Map();
  if (!uiFieldCatalog || !Array.isArray(uiFieldCatalog.fields)) {
    return map;
  }
  for (const row of uiFieldCatalog.fields) {
    if (!row || typeof row !== 'object') continue;
    const fieldKey = normalizeFieldKey(row.field_key || row.key || row.field || '');
    if (!fieldKey) continue;
    map.set(fieldKey, row);
  }
  return map;
}

function resolveTemplateLibrary(fieldRules = {}) {
  const library = isObject(fieldRules?.parse_templates)
    ? fieldRules.parse_templates
    : (isObject(fieldRules?.parseTemplates) ? fieldRules.parseTemplates : {});
  return isObject(library) ? library : {};
}

function buildParseTemplateIntent(rule = {}, templateLibrary = {}, maxExamples = 2) {
  const templateId = String(ruleParseTemplate(rule) || '').trim();
  if (!templateId) {
    return {
      template_id: null,
      description: '',
      examples: []
    };
  }
  const entry = isObject(templateLibrary?.[templateId]) ? templateLibrary[templateId] : {};
  const examples = [];
  for (const row of toArray(entry.tests).slice(0, Math.max(0, maxExamples))) {
    if (!row || typeof row !== 'object') continue;
    const raw = clipText(row.raw || row.input || '', 120);
    const expected = (() => {
      try {
        return clipText(JSON.stringify(row.expected), 160);
      } catch {
        return clipText(String(row.expected || ''), 160);
      }
    })();
    if (raw || expected) {
      examples.push({ raw, expected });
    }
  }
  return {
    template_id: templateId,
    description: clipText(entry.description || '', 220),
    examples
  };
}

function buildUnknownPolicy(rule = {}) {
  const contract = isObject(rule.contract) ? rule.contract : {};
  const token = String(contract.unknown_token || rule.unknown_token || 'unk').trim() || 'unk';
  const reasonRequired = contract.unknown_reason_required !== undefined
    ? Boolean(contract.unknown_reason_required)
    : Boolean(rule.unknown_reason_required);
  const reasonDefault = String(rule.unknown_reason_default || contract.unknown_reason_default || '').trim();
  return {
    unknown_token: token,
    unknown_reason_required: reasonRequired,
    unknown_reason_default: reasonDefault || null
  };
}

function buildEnumOptions(rule = {}, knownValuesMap = {}, field = '', maxCount = 80) {
  const enumValues = [
    ...toArray(rule?.enum),
    ...toArray(rule?.contract?.enum),
    ...toArray(rule?.validate?.enum)
  ].map((entry) => {
    if (entry && typeof entry === 'object') {
      return String(entry.canonical || entry.value || '').trim();
    }
    return String(entry || '').trim();
  }).filter(Boolean);
  for (const value of toArray(knownValuesMap?.[field])) {
    const token = String(value || '').trim();
    if (token) enumValues.push(token);
  }
  return uniqueStrings(enumValues, maxCount);
}

function buildComponentRef(rule = {}, componentDBs = {}, maxEntities = 120) {
  const componentDbRef = String(rule?.component_db_ref || rule?.component?.type || '').trim();
  if (!componentDbRef) {
    return null;
  }
  const dbKey = normalizeFieldKey(componentDbRef);
  const db = isObject(componentDBs?.[dbKey]) ? componentDBs[dbKey] : null;
  const entityNames = db?.entries
    ? Object.values(db.entries)
      .map((entry) => String(entry?.canonical_name || '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
    : [];
  return {
    type: componentDbRef,
    known_entities: entityNames.slice(0, Math.max(1, maxEntities))
  };
}

function fieldTokenSet(field = '') {
  const normalized = normalizeFieldKey(field);
  if (!normalized) return [];
  const spaced = normalized.replace(/_/g, ' ');
  const compact = normalized.replace(/_/g, '');
  return uniqueStrings([normalized, spaced, compact], 3).map((item) => item.toLowerCase());
}

function snippetMatchesField(snippet = {}, field = '') {
  const fieldKey = normalizeFieldKey(field);
  if (!fieldKey) return false;
  const hints = toArray(snippet?.field_hints).map((item) => normalizeFieldKey(item));
  if (hints.includes(fieldKey)) {
    return true;
  }
  const text = String(snippet?.normalized_text || snippet?.text || '').toLowerCase();
  for (const token of fieldTokenSet(fieldKey)) {
    if (token && text.includes(token)) {
      return true;
    }
  }
  return false;
}

function collectReferenceMaps(evidencePack = {}) {
  const byId = new Map();
  for (const row of toArray(evidencePack.references)) {
    const id = String(row?.id || '').trim();
    if (!id) continue;
    byId.set(id, row);
  }
  return byId;
}

export function buildPrimeSourcesFromEvidencePack({
  fields = [],
  evidencePack = {},
  maxPerField = 3,
  maxRows = 24,
  quoteChars = 300
} = {}) {
  const normalizedFields = uniqueStrings((fields || []).map((field) => normalizeFieldKey(field)).filter(Boolean), 300);
  const snippets = toArray(evidencePack?.snippets)
    .map((row) => ({ ...row, id: String(row?.id || '').trim() }))
    .filter((row) => row.id);
  const refs = collectReferenceMaps(evidencePack);
  const byField = {};
  const rows = [];

  for (const field of normalizedFields) {
    const matched = snippets
      .filter((snippet) => snippetMatchesField(snippet, field))
      .slice(0, Math.max(1, maxPerField));

    byField[field] = matched.map((snippet, idx) => {
      const ref = refs.get(snippet.id) || {};
      const row = {
        rank: idx + 1,
        field_key: field,
        snippet_id: snippet.id,
        snippet_hash: String(snippet?.snippet_hash || ref?.snippet_hash || '').trim() || null,
        source_id: String(snippet?.source_id || snippet?.source || ref?.source_id || '').trim() || null,
        url: String(snippet?.url || ref?.url || '').trim(),
        type: String(snippet?.type || ref?.type || 'text').trim(),
        quote_preview: clipText(snippet?.normalized_text || snippet?.text || '', quoteChars),
        file_uri: String(snippet?.file_uri || ref?.file_uri || '').trim() || null,
        mime_type: String(snippet?.mime_type || ref?.mime_type || '').trim() || null,
        content_hash: String(snippet?.content_hash || ref?.content_hash || '').trim() || null,
        surface: String(snippet?.surface || ref?.surface || '').trim() || null
      };
      return row;
    });
    rows.push(...byField[field]);
    if (rows.length >= Math.max(1, maxRows)) {
      break;
    }
  }

  return {
    by_field: byField,
    rows: rows.slice(0, Math.max(1, maxRows))
  };
}

export function buildPrimeSourcesFromProvenance({
  uncertainFields = [],
  provenance = {},
  maxPerField = 4,
  maxRows = 40,
  quoteChars = 320
} = {}) {
  const fields = uniqueStrings((uncertainFields || []).map((field) => normalizeFieldKey(field)).filter(Boolean), 300);
  const byField = {};
  const rows = [];
  for (const field of fields) {
    const evidenceRows = toArray(provenance?.[field]?.evidence)
      .filter((row) => row && typeof row === 'object')
      .sort((a, b) => {
        const aTier = Number.parseInt(String(a?.tier || 99), 10);
        const bTier = Number.parseInt(String(b?.tier || 99), 10);
        if (aTier !== bTier) return aTier - bTier;
        const aUrl = String(a?.url || '');
        const bUrl = String(b?.url || '');
        return aUrl.localeCompare(bUrl);
      })
      .slice(0, Math.max(1, maxPerField));
    byField[field] = evidenceRows.map((row, idx) => ({
      rank: idx + 1,
      field_key: field,
      snippet_id: String(row?.snippet_id || '').trim(),
      snippet_hash: String(row?.snippet_hash || '').trim() || null,
      source_id: String(row?.source_id || '').trim() || null,
      url: String(row?.url || '').trim(),
      host: String(row?.host || row?.rootDomain || '').trim() || null,
      tier: Number.isFinite(Number(row?.tier)) ? Number(row.tier) : null,
      tier_name: String(row?.tierName || '').trim() || null,
      method: String(row?.method || '').trim() || null,
      key_path: String(row?.keyPath || '').trim() || null,
      quote_preview: clipText(row?.quote || '', quoteChars),
      file_uri: String(row?.file_uri || '').trim() || null,
      mime_type: String(row?.mime_type || '').trim() || null,
      content_hash: String(row?.content_hash || '').trim() || null,
      surface: String(row?.surface || '').trim() || null,
      evidence_refs: toArray(row?.evidence_refs).map((item) => String(item || '').trim()).filter(Boolean).slice(0, 12)
    }));
    rows.push(...byField[field]);
    if (rows.length >= Math.max(1, maxRows)) {
      break;
    }
  }
  return {
    by_field: byField,
    rows: rows.slice(0, Math.max(1, maxRows))
  };
}

export function buildExtractionContextMatrix({
  category = '',
  categoryConfig = null,
  fields = [],
  componentDBs = {},
  knownValuesMap = {},
  evidencePack = null,
  primeSources = null,
  options = {}
} = {}) {
  const fieldRules = isObject(categoryConfig?.fieldRules?.fields)
    ? categoryConfig.fieldRules.fields
    : (isObject(categoryConfig?.fieldRules) ? categoryConfig.fieldRules : {});
  const parseTemplates = resolveTemplateLibrary(categoryConfig?.fieldRules || {});
  const uiByField = lookupUiByField(categoryConfig?.uiFieldCatalog || null);
  const normalizedFields = uniqueStrings((fields || []).map((field) => normalizeFieldKey(field)).filter(Boolean), 300);

  const fieldContexts = {};
  let evidenceRequiredCount = 0;
  let distinctSourceRequiredCount = 0;
  let minRefsTotal = 0;

  for (const field of normalizedFields) {
    const rule = isObject(fieldRules?.[field]) ? fieldRules[field] : {};
    const uiRow = uiByField.get(field) || {};
    const evidence = isObject(rule?.evidence) ? rule.evidence : {};
    const tierPreference = normalizeTierPreference(evidence.tier_preference || []);
    const minRefs = ruleMinEvidenceRefs(rule);
    const evidenceRequired = ruleEvidenceRequired(rule);
    const distinctSourcesRequired = Boolean(evidence.distinct_sources_required);

    if (evidenceRequired) evidenceRequiredCount += 1;
    if (distinctSourcesRequired) distinctSourceRequiredCount += 1;
    minRefsTotal += Math.max(0, Number(minRefs || 0));

    fieldContexts[field] = {
      field_key: field,
      required_level: ruleRequiredLevel(rule),
      availability: ruleAvailability(rule),
      difficulty: ruleDifficulty(rule),
      effort: Number(ruleEffort(rule) || 0),
      ai_mode: ruleAiMode(rule),
      ai_reasoning_note: clipText(ruleAiReasoningNote(rule) || '', 220),
      ui: {
        label: String(uiRow?.label || rule?.display_name || field).trim(),
        tooltip_md: clipText(uiRow?.tooltip_md || rule?.ui?.tooltip_md || rule?.tooltip_md || '', 240)
      },
      contract: {
        data_type: ruleType(rule),
        output_shape: ruleShape(rule),
        unit: ruleUnit(rule),
        range: ruleRange(rule),
        list_rules: ruleListRules(rule) || null,
        ...buildUnknownPolicy(rule)
      },
      evidence_policy: {
        required: evidenceRequired,
        min_evidence_refs: minRefs,
        tier_preference: tierPreference,
        distinct_sources_required: distinctSourcesRequired,
        conflict_policy: String(evidence.conflict_policy || '').trim() || null
      },
      parse_template_intent: buildParseTemplateIntent(rule, parseTemplates, Math.max(1, Number(options.maxParseExamples || 2))),
      enum_options: buildEnumOptions(rule, knownValuesMap, field, Math.max(8, Number(options.maxEnumOptions || 80))),
      component_ref: buildComponentRef(rule, componentDBs, Math.max(20, Number(options.maxComponentEntities || 120)))
    };
  }

  const prime = primeSources && typeof primeSources === 'object'
    ? primeSources
    : buildPrimeSourcesFromEvidencePack({
      fields: normalizedFields,
      evidencePack: evidencePack || {},
      maxPerField: Math.max(1, Number(options.maxPrimePerField || 3)),
      maxRows: Math.max(1, Number(options.maxPrimeRows || 24)),
      quoteChars: Math.max(120, Number(options.quoteChars || 300))
    });

  return {
    generated_at: new Date().toISOString(),
    category: String(category || categoryConfig?.category || '').trim() || null,
    field_count: normalizedFields.length,
    summary: {
      evidence_required_fields: evidenceRequiredCount,
      distinct_source_required_fields: distinctSourceRequiredCount,
      min_refs_total: minRefsTotal,
      prime_source_rows: Array.isArray(prime.rows) ? prime.rows.length : 0
    },
    fields: fieldContexts,
    prime_sources: {
      by_field: prime.by_field || {},
      rows: Array.isArray(prime.rows) ? prime.rows : []
    }
  };
}
