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

function selectManufacturerHosts(categoryConfig, brand) {
  const hints = manufacturerHostHintsForBrand(brand);
  const rows = toArray(categoryConfig?.sourceHosts)
    .filter((row) => String(row?.tierName || row?.role || '').toLowerCase() === 'manufacturer')
    .map((row) => String(row?.host || '').trim().toLowerCase())
    .filter(Boolean);
  if (!hints.length) {
    return rows.slice(0, 4);
  }
  return rows.filter((host) => hints.some((hint) => host.includes(hint))).slice(0, 4);
}

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
  tooltipHints = {},
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
    const tooltipTerms = toArray(tooltipHints?.[field]).map((value) => clean(value)).filter(Boolean);
    const synonyms = [...new Set([...fieldSynonyms(field, lexicon), ...tooltipTerms])];
    for (const synonym of synonyms) {
      queries.add(clean(`${brand} ${model} ${variant} ${synonym} specification`));
      queries.add(clean(`${brand} ${model} ${synonym} manual pdf`));
      for (const host of selectManufacturerHosts(categoryConfig, brand)) {
        queries.add(clean(`site:${host} ${model} ${synonym}`));
      }
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
