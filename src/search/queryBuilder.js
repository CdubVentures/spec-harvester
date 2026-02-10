import { normalizeFieldList } from '../utils/fieldKeys.js';

function clean(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

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

function fieldSynonyms(field, lexicon) {
  const defaults = FIELD_SYNONYMS[field] || [field];
  const learned = Object.entries(lexicon?.fields?.[field]?.synonyms || {})
    .sort((a, b) => (b[1].count || 0) - (a[1].count || 0))
    .slice(0, 6)
    .map(([token]) => token)
    .filter(Boolean);
  return [...new Set([...defaults, ...learned])].slice(0, 8);
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

export function buildTargetedQueries({
  job,
  categoryConfig,
  missingFields = [],
  lexicon = {},
  learnedQueries = {},
  maxQueries = 24
}) {
  const brand = clean(job?.identityLock?.brand || '');
  const model = clean(job?.identityLock?.model || '');
  const variant = clean(job?.identityLock?.variant || '');
  const category = clean(job?.category || categoryConfig?.category || 'mouse');

  const baseTemplates = toArray(categoryConfig?.searchTemplates)
    .map((template) => fillTemplate(template, { brand, model, variant, category }))
    .filter(Boolean);

  const queries = new Set(baseTemplates);
  const focusFields = normalizeFieldList(toArray(missingFields), {
    fieldOrder: categoryConfig?.fieldOrder || []
  }).filter(Boolean);

  for (const field of focusFields) {
    for (const synonym of fieldSynonyms(field, lexicon)) {
      queries.add(clean(`${brand} ${model} ${variant} ${synonym} specification`));
      queries.add(clean(`${brand} ${model} ${synonym} manual pdf`));
      queries.add(clean(`site:${brand.toLowerCase().replace(/\s+/g, '')}.com ${model} ${synonym}`));
    }

    for (const row of toArray(learnedQueries?.templates_by_field?.[field]).slice(0, 4)) {
      queries.add(clean(row.query));
    }
  }

  const brandKey = brand.toLowerCase();
  for (const row of toArray(learnedQueries?.templates_by_brand?.[brandKey]).slice(0, 6)) {
    queries.add(clean(row.query));
  }

  if (!focusFields.length) {
    queries.add(clean(`${brand} ${model} ${variant} specifications`));
    queries.add(clean(`${brand} ${model} datasheet pdf`));
  }

  return [...queries]
    .filter(Boolean)
    .slice(0, Math.max(1, maxQueries));
}
