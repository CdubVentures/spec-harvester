import { normalizeFieldList } from '../utils/fieldKeys.js';

function clean(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

const STOPWORDS = new Set([
  'according',
  'after',
  'before',
  'common',
  'contract',
  'define',
  'evidence',
  'field',
  'from',
  'list',
  'normalize',
  'output',
  'prefer',
  'proval',
  'provable',
  'reason',
  'required',
  'sorted',
  'value',
  'values',
  'when',
  'with'
]);

const FIELD_SYNONYMS = {
  polling_rate: ['polling rate', 'report rate', 'hz'],
  dpi: ['dpi', 'cpi'],
  sensor: ['sensor', 'optical sensor'],
  click_latency: ['click latency', 'response time'],
  battery_hours: ['battery life', 'battery hours'],
  weight: ['weight', 'mass', 'grams'],
  switch: ['switch type', 'microswitch'],
  connection: ['connectivity', 'wireless', 'wired'],
  lift: ['lift off distance', 'lod']
};

const BRAND_HOST_HINTS = {
  logitech: ['logitech', 'logitechg', 'logi'],
  razer: ['razer'],
  steelseries: ['steelseries'],
  zowie: ['zowie', 'benq'],
  benq: ['benq', 'zowie'],
  finalmouse: ['finalmouse'],
  lamzu: ['lamzu'],
  pulsar: ['pulsar'],
  corsair: ['corsair'],
  glorious: ['glorious'],
  endgame: ['endgamegear', 'endgame-gear']
};

const CONTENT_TYPE_SUFFIX = {
  manual: 'manual',
  manual_pdf: 'manual pdf',
  support: 'support',
  spec: 'specification',
  spec_sheet: 'specification sheet',
  spec_pdf: 'specification pdf',
  datasheet: 'datasheet',
  datasheet_pdf: 'datasheet pdf',
  product_page: 'product page',
  teardown: 'teardown',
  teardown_review: 'teardown review',
  lab_review: 'lab review',
  benchmark: 'benchmark'
};

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function tokenize(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function manufacturerHostHintsForBrand(brand) {
  const hints = new Set(tokenize(brand));
  const brandSlug = slug(brand);
  for (const [key, aliases] of Object.entries(BRAND_HOST_HINTS)) {
    if (brandSlug.includes(key) || hints.has(key)) {
      for (const alias of aliases) {
        hints.add(alias);
      }
    }
  }
  return [...hints];
}

function selectManufacturerHosts(categoryConfig, brand, extraHints = []) {
  const hints = manufacturerHostHintsForBrand(brand);
  for (const hint of toArray(extraHints)) {
    hints.push(...tokenize(hint));
  }
  const rows = toArray(categoryConfig?.sourceHosts)
    .filter((row) => String(row?.tierName || row?.role || '').toLowerCase() === 'manufacturer')
    .map((row) => String(row?.host || '').trim().toLowerCase())
    .filter(Boolean);
  if (!hints.length) {
    return rows.slice(0, 4);
  }
  return rows.filter((host) => hints.some((hint) => host.includes(hint))).slice(0, 6);
}

function normalizeSearchTerm(value) {
  return clean(String(value || '').replace(/_/g, ' '));
}

function splitAlphaDigit(value) {
  return clean(
    String(value || '')
      .replace(/([a-z])([0-9])/gi, '$1 $2')
      .replace(/([0-9])([a-z])/gi, '$1 $2')
  );
}

function sanitizeAlias(value) {
  return clean(String(value || '').toLowerCase());
}

function buildModelAliasCandidates(identity = {}) {
  const model = clean(identity.model || '');
  const variant = clean(identity.variant || '');
  const base = clean([model, variant].filter(Boolean).join(' '));
  if (!base) {
    return [];
  }

  const compact = sanitizeAlias(base).replace(/[^a-z0-9]+/g, '');
  const spaced = splitAlphaDigit(compact);
  const hyphen = spaced.replace(/\s+/g, '-');
  const raw = sanitizeAlias(base);
  const spacedRaw = splitAlphaDigit(raw);
  const hyphenRaw = sanitizeAlias(spacedRaw.replace(/\s+/g, '-'));

  return [...new Set([compact, spaced, hyphen, raw, spacedRaw, hyphenRaw].filter(Boolean))];
}

export function buildDeterministicAliases(identity = {}, maxAliases = 12) {
  const brand = clean(identity.brand || '');
  const model = clean(identity.model || '');
  const variant = clean(identity.variant || '');

  const out = [];
  const seen = new Set();
  const push = (alias, source = 'deterministic', weight = 1) => {
    const normalized = sanitizeAlias(alias);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    out.push({
      alias: normalized,
      source,
      weight
    });
  };

  if (brand) {
    push(brand, 'deterministic', 0.8);
  }
  const productFull = clean([brand, model, variant].filter(Boolean).join(' '));
  if (productFull) {
    push(productFull, 'deterministic', 1);
  }
  const brandModel = clean([brand, model].filter(Boolean).join(' '));
  if (brandModel) {
    push(brandModel, 'deterministic', 0.95);
  }
  for (const modelAlias of buildModelAliasCandidates({ model, variant })) {
    push(modelAlias, 'deterministic', 0.9);
    if (brand) {
      push(`${brand} ${modelAlias}`, 'deterministic', 1);
    }
  }

  return out.slice(0, Math.max(1, Math.min(12, Number(maxAliases) || 12)));
}

function extractTooltipTerms(value) {
  const text = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/_-]+/g, ' ');
  const tokens = text
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
  const phrases = [];
  for (let i = 0; i < tokens.length - 1 && phrases.length < 4; i += 1) {
    if (tokens[i] === tokens[i + 1]) {
      continue;
    }
    phrases.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return [...new Set(phrases.map((item) => normalizeSearchTerm(item)).filter(Boolean))].slice(0, 4);
}

function fieldSynonyms(field, lexicon, fieldRule = {}, tooltipHints = {}) {
  const defaults = FIELD_SYNONYMS[field] || [field];
  const learned = Object.entries(lexicon?.fields?.[field]?.synonyms || {})
    .sort((a, b) => (b[1].count || 0) - (a[1].count || 0))
    .slice(0, 6)
    .map(([token]) => token)
    .filter(Boolean);
  const fromRule = toArray(fieldRule?.search_hints?.query_terms)
    .map((value) => normalizeSearchTerm(value))
    .filter(Boolean);
  const fromTooltipHints = toArray(tooltipHints?.[field])
    .map((value) => normalizeSearchTerm(value))
    .filter(Boolean);
  const fromTooltipMd = extractTooltipTerms(fieldRule?.ui?.tooltip_md || fieldRule?.tooltip_md || '');
  return [...new Set([...fromRule, ...defaults, ...learned, ...fromTooltipHints, ...fromTooltipMd])]
    .filter(Boolean)
    .slice(0, 12);
}

function lookupFieldRule(categoryConfig, field) {
  return categoryConfig?.fieldRules?.fields?.[field] || {};
}

function contentTypeSuffixes(fieldRule = {}) {
  const values = toArray(fieldRule?.search_hints?.preferred_content_types)
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
  const out = [];
  for (const value of values) {
    out.push(CONTENT_TYPE_SUFFIX[value] || normalizeSearchTerm(value));
  }
  return [...new Set(out.filter(Boolean))].slice(0, 4);
}

function domainHintsForField(fieldRule = {}) {
  return toArray(fieldRule?.search_hints?.domain_hints)
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => value.includes('.'));
}

function toFieldTargetMap(rows = []) {
  const out = {};
  for (const row of rows) {
    for (const field of toArray(row.target_fields)) {
      if (!field) continue;
      out[field] = out[field] || [];
      if (out[field].length >= 3) continue;
      if (!out[field].includes(row.query)) {
        out[field].push(row.query);
      }
    }
  }
  return out;
}

function toDocHintRows(rows = []) {
  const byHint = new Map();
  for (const row of rows) {
    const docHint = clean(row.doc_hint || '');
    if (!docHint) continue;
    if (!byHint.has(docHint)) {
      byHint.set(docHint, []);
    }
    const list = byHint.get(docHint);
    if (list.length >= 3) continue;
    if (!list.includes(row.query)) {
      list.push(row.query);
    }
  }
  return [...byHint.entries()].map(([doc_hint, queries]) => ({
    doc_hint,
    queries
  }));
}

function buildQueryRows({
  job,
  categoryConfig,
  focusFields = [],
  tooltipHints = {},
  lexicon = {},
  learnedQueries = {},
  identityAliases = [],
  maxRows = 72
}) {
  const brand = clean(job?.identityLock?.brand || '');
  const model = clean(job?.identityLock?.model || '');
  const variant = clean(job?.identityLock?.variant || '');
  const product = clean([brand, model, variant].filter(Boolean).join(' '));
  const rows = [];
  const seen = new Map();
  const addRow = ({
    query,
    hintSource = 'deterministic',
    targetFields = [],
    docHint = '',
    alias = '',
    domainHint = ''
  }) => {
    const normalizedQuery = clean(query);
    if (!normalizedQuery || !brand) {
      return;
    }
    const token = normalizedQuery.toLowerCase();
    if (seen.has(token)) {
      const index = seen.get(token);
      const existing = rows[index];
      existing.target_fields = [...new Set([
        ...toArray(existing.target_fields),
        ...toArray(targetFields)
      ])];
      existing.hint_source = existing.hint_source || hintSource;
      if (!existing.doc_hint && docHint) existing.doc_hint = docHint;
      return;
    }
    rows.push({
      query: normalizedQuery,
      hint_source: hintSource,
      target_fields: [...new Set(toArray(targetFields).filter(Boolean))],
      doc_hint: clean(docHint),
      alias: clean(alias),
      domain_hint: clean(domainHint)
    });
    seen.set(token, rows.length - 1);
  };

  const aliasRows = toArray(identityAliases)
    .map((row) => clean(row?.alias || ''))
    .filter(Boolean)
    .slice(0, 8);
  const queryAliasRows = aliasRows.filter((alias) => {
    const token = alias.toLowerCase();
    return (
      (token.includes(model.toLowerCase()) || token.includes(variant.toLowerCase())) &&
      !token.includes(brand.toLowerCase())
    );
  });

  for (const field of focusFields) {
    const fieldRule = lookupFieldRule(categoryConfig, field);
    const searchHintTerms = toArray(fieldRule?.search_hints?.query_terms)
      .map((value) => normalizeSearchTerm(value))
      .filter(Boolean);
    const fallbackSynonyms = fieldSynonyms(field, lexicon, fieldRule, tooltipHints)
      .map((value) => normalizeSearchTerm(value))
      .filter(Boolean);
    const terms = [...new Set([
      ...searchHintTerms,
      ...fallbackSynonyms
    ])].slice(0, 12);
    const preferredContent = contentTypeSuffixes(fieldRule);
    const ruleDomainHints = domainHintsForField(fieldRule);
    const manufacturerHosts = selectManufacturerHosts(categoryConfig, brand, ruleDomainHints);
    const hosts = [...new Set([...manufacturerHosts, ...ruleDomainHints])].slice(0, 8);

    for (const term of terms) {
      const hintSource = searchHintTerms.includes(term)
        ? 'field_rules.search_hints'
        : 'deterministic';
      addRow({
        query: `${product} ${term} specification`,
        hintSource,
        targetFields: [field],
        docHint: 'spec',
        alias: product
      });
      addRow({
        query: `${product} ${term} manual pdf`,
        hintSource,
        targetFields: [field],
        docHint: 'manual_pdf',
        alias: product
      });
      for (const suffix of preferredContent) {
        addRow({
          query: `${product} ${term} ${suffix}`,
          hintSource: 'field_rules.search_hints',
          targetFields: [field],
          docHint: suffix,
          alias: product
        });
      }
      for (const host of hosts) {
        addRow({
          query: `site:${host} ${brand} ${model} ${term}`,
          hintSource: 'field_rules.search_hints',
          targetFields: [field],
          domainHint: host
        });
      }
      for (const alias of queryAliasRows.slice(0, 4)) {
        addRow({
          query: `${brand} ${alias} ${term} specification`,
          hintSource,
          targetFields: [field],
          alias
        });
      }
    }

    for (const row of toArray(learnedQueries?.templates_by_field?.[field]).slice(0, 4)) {
      addRow({
        query: clean(row?.query || ''),
        hintSource: 'learned',
        targetFields: [field]
      });
    }
  }

  const brandKey = brand.toLowerCase();
  for (const row of toArray(learnedQueries?.templates_by_brand?.[brandKey]).slice(0, 6)) {
    addRow({
      query: clean(row?.query || ''),
      hintSource: 'learned',
      targetFields: focusFields
    });
  }

  if (!focusFields.length) {
    addRow({
      query: `${product} specifications`,
      hintSource: 'deterministic',
      docHint: 'spec'
    });
    addRow({
      query: `${product} datasheet pdf`,
      hintSource: 'deterministic',
      docHint: 'datasheet_pdf'
    });
  }

  return rows.slice(0, Math.max(1, maxRows));
}

function fillTemplate(template, values) {
  return clean(
    String(template || '')
      .replaceAll('{brand}', values.brand || '')
      .replaceAll('{model}', values.model || '')
      .replaceAll('{variant}', values.variant || '')
      .replaceAll('{category}', values.category || '')
  );
}

export function buildSearchProfile({
  job,
  categoryConfig,
  missingFields = [],
  tooltipHints = {},
  lexicon = {},
  learnedQueries = {},
  maxQueries = 24
}) {
  const brand = clean(job?.identityLock?.brand || '');
  const model = clean(job?.identityLock?.model || '');
  const variant = clean(job?.identityLock?.variant || '');
  const category = clean(job?.category || categoryConfig?.category || 'mouse');
  const identity = { brand, model, variant, category };
  const identityAliases = buildDeterministicAliases(identity, 12);

  const baseTemplates = toArray(categoryConfig?.searchTemplates)
    .map((template) => fillTemplate(template, { brand, model, variant, category }))
    .filter(Boolean);
  const focusFields = normalizeFieldList(toArray(missingFields), {
    fieldOrder: categoryConfig?.fieldOrder || []
  }).filter(Boolean);
  const queryRows = buildQueryRows({
    job,
    categoryConfig,
    focusFields,
    tooltipHints,
    lexicon,
    learnedQueries,
    identityAliases,
    maxRows: Math.max(24, Number(maxQueries || 24) * 3)
  });

  const querySet = new Set();
  const selectedQueries = [];
  const addQuery = (query) => {
    const normalized = clean(query).toLowerCase();
    if (!normalized || querySet.has(normalized)) {
      return;
    }
    querySet.add(normalized);
    selectedQueries.push(clean(query));
  };
  for (const query of baseTemplates) {
    addQuery(query);
  }
  for (const row of queryRows) {
    addQuery(row.query);
  }
  if (!selectedQueries.length && brand && model) {
    addQuery(`${brand} ${model} ${variant} specifications`);
    addQuery(`${brand} ${model} datasheet pdf`);
  }

  const boundedQueries = selectedQueries.slice(0, Math.max(1, maxQueries));
  const boundedRows = queryRows.filter((row) => boundedQueries.includes(row.query));
  const hintSourceCounts = {};
  for (const row of boundedRows) {
    const token = clean(row.hint_source || 'deterministic');
    hintSourceCounts[token] = (hintSourceCounts[token] || 0) + 1;
  }

  return {
    category,
    identity,
    identity_aliases: identityAliases,
    negative_terms: [],
    focus_fields: focusFields,
    base_templates: baseTemplates,
    query_rows: boundedRows,
    queries: boundedQueries,
    targeted_queries: boundedRows.map((row) => row.query),
    field_target_queries: toFieldTargetMap(boundedRows),
    doc_hint_queries: toDocHintRows(boundedRows),
    hint_source_counts: hintSourceCounts
  };
}

export function buildTargetedQueries(options = {}) {
  const profile = buildSearchProfile(options);
  return toArray(profile?.queries).slice(0, Math.max(1, Number(options?.maxQueries || 24)));
}
