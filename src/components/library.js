import { nowIso } from '../utils/common.js';

const COMPONENT_FILES = {
  sensor: '_components/sensors.jsonl',
  switch: '_components/switches.jsonl',
  encoder: '_components/encoders.jsonl',
  mcu: '_components/mcus.jsonl'
};

const COMPONENT_FIELD_MAP = {
  sensor: ['sensor', 'sensor_brand', 'sensor_type', 'dpi', 'ips', 'acceleration'],
  switch: ['switch', 'switch_brand', 'switch_type', 'click_force', 'debounce'],
  encoder: ['encoder', 'encoder_brand'],
  mcu: ['mcu']
};

function normalizeToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function hasValue(value) {
  const token = normalizeToken(value);
  return token !== '' && token !== 'unk' && token !== 'null' && token !== 'undefined' && token !== 'n/a';
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseJsonl(text = '') {
  const rows = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    try {
      rows.push(JSON.parse(line));
    } catch {
      // ignore malformed rows
    }
  }
  return rows;
}

function toJsonl(rows = []) {
  return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
}

function resolveComponentDescriptor(type, fields = {}) {
  if (type === 'sensor') {
    return {
      brand: String(fields.sensor_brand || '').trim(),
      model: String(fields.sensor || '').trim()
    };
  }
  if (type === 'switch') {
    return {
      brand: String(fields.switch_brand || '').trim(),
      model: String(fields.switch || '').trim()
    };
  }
  if (type === 'encoder') {
    return {
      brand: String(fields.encoder_brand || '').trim(),
      model: String(fields.encoder || '').trim()
    };
  }
  if (type === 'mcu') {
    return {
      brand: '',
      model: String(fields.mcu || '').trim()
    };
  }
  return {
    brand: '',
    model: ''
  };
}

function componentId(type, descriptor) {
  const brandSlug = slug(descriptor.brand || '');
  const modelSlug = slug(descriptor.model || '');
  if (!modelSlug) {
    return '';
  }
  return [type, brandSlug, modelSlug].filter(Boolean).join(':');
}

function aliasSetForDescriptor(descriptor) {
  const set = new Set();
  const modelToken = normalizeToken(descriptor.model);
  if (modelToken) {
    set.add(modelToken);
  }
  const combined = normalizeToken([descriptor.brand, descriptor.model].filter(Boolean).join(' '));
  if (combined) {
    set.add(combined);
  }
  return [...set];
}

function pickSpecFields(type, fields = {}) {
  const out = {};
  for (const field of COMPONENT_FIELD_MAP[type] || []) {
    if (!hasValue(fields[field])) {
      continue;
    }
    out[field] = String(fields[field]).trim();
  }
  return out;
}

function buildAliasIndex(rows = []) {
  const index = new Map();
  for (const row of rows) {
    const aliases = Array.isArray(row.aliases) ? row.aliases : [];
    for (const alias of aliases) {
      const token = normalizeToken(alias);
      if (!token) {
        continue;
      }
      if (!index.has(token)) {
        index.set(token, []);
      }
      index.get(token).push(row);
    }
  }
  return index;
}

async function readComponentRows(storage, type) {
  const key = COMPONENT_FILES[type];
  const text = await storage.readTextOrNull(key);
  return parseJsonl(text);
}

async function writeComponentRows(storage, type, rows) {
  const key = COMPONENT_FILES[type];
  await storage.writeObject(
    key,
    Buffer.from(toJsonl(rows), 'utf8'),
    { contentType: 'application/x-ndjson' }
  );
  return key;
}

export async function loadComponentLibrary({ storage }) {
  const [sensors, switches, encoders, mcus] = await Promise.all([
    readComponentRows(storage, 'sensor'),
    readComponentRows(storage, 'switch'),
    readComponentRows(storage, 'encoder'),
    readComponentRows(storage, 'mcu')
  ]);

  return {
    rows: {
      sensor: sensors,
      switch: switches,
      encoder: encoders,
      mcu: mcus
    },
    aliasIndex: {
      sensor: buildAliasIndex(sensors),
      switch: buildAliasIndex(switches),
      encoder: buildAliasIndex(encoders),
      mcu: buildAliasIndex(mcus)
    }
  };
}

function resolveSingleMatch(type, fields, library) {
  const descriptor = resolveComponentDescriptor(type, fields);
  const aliases = aliasSetForDescriptor(descriptor);
  const index = library.aliasIndex[type];
  const hits = [];

  for (const alias of aliases) {
    for (const row of index.get(alias) || []) {
      hits.push(row);
    }
  }
  const unique = [...new Map(hits.map((row) => [row.id, row])).values()];
  if (unique.length !== 1) {
    return null;
  }
  const row = unique[0];
  if (Number(row.confidence || 0) < 0.9) {
    return null;
  }
  return row;
}

function ensureProvenanceBucket(provenance, field) {
  if (!provenance[field]) {
    provenance[field] = {
      value: 'unk',
      confirmations: 0,
      approved_confirmations: 0,
      pass_target: 1,
      meets_pass_target: false,
      confidence: 0,
      evidence: []
    };
  }
  return provenance[field];
}

export function applyComponentLibraryPriors({
  normalized,
  provenance,
  library,
  fieldOrder = [],
  logger = null
}) {
  const fields = normalized?.fields || {};
  const filledFields = [];
  const matchedComponents = [];
  const fieldSet = new Set(fieldOrder || Object.keys(fields || {}));

  for (const type of Object.keys(COMPONENT_FILES)) {
    const match = resolveSingleMatch(type, fields, library);
    if (!match) {
      continue;
    }
    matchedComponents.push({
      type,
      id: match.id
    });
    for (const [field, value] of Object.entries(match.specs || {})) {
      if (!fieldSet.has(field)) {
        continue;
      }
      if (!hasValue(value)) {
        continue;
      }
      if (hasValue(fields[field])) {
        continue;
      }

      fields[field] = value;
      const bucket = ensureProvenanceBucket(provenance, field);
      bucket.value = value;
      bucket.confirmations = Math.max(1, Number.parseInt(String(bucket.confirmations || 0), 10) || 0);
      bucket.approved_confirmations = Math.max(1, Number.parseInt(String(bucket.approved_confirmations || 0), 10) || 0);
      bucket.pass_target = Math.max(1, Number.parseInt(String(bucket.pass_target || 1), 10) || 1);
      bucket.meets_pass_target = true;
      bucket.confidence = Math.max(0.93, Number.parseFloat(String(bucket.confidence || 0)) || 0.93);
      bucket.evidence = [
        ...(Array.isArray(bucket.evidence) ? bucket.evidence : []),
        {
          url: `component_db://${type}/${match.id}`,
          host: 'component-library.local',
          rootDomain: 'component-library.local',
          tier: 1,
          tierName: 'manufacturer',
          method: 'component_db',
          keyPath: `component_db.${type}.${field}`,
          approvedDomain: true
        }
      ];
      filledFields.push(field);
      logger?.info?.('component_db_field_filled', {
        field,
        value,
        component_type: type,
        component_id: match.id
      });
    }
  }

  return {
    filled_fields: [...new Set(filledFields)],
    matched_components: matchedComponents
  };
}

function upsertComponentRow(rows, type, descriptor, specs, context = {}) {
  const id = componentId(type, descriptor);
  if (!id) {
    return null;
  }
  const aliases = aliasSetForDescriptor(descriptor);
  const now = nowIso();
  const existingIndex = rows.findIndex((row) => row.id === id);
  const next = existingIndex >= 0
    ? {
      ...rows[existingIndex]
    }
    : {
      id,
      type,
      brand: descriptor.brand || '',
      model: descriptor.model || '',
      aliases: [],
      specs: {},
      evidence_refs: [],
      confidence: 0,
      updated_at: now
    };

  next.brand = next.brand || descriptor.brand || '';
  next.model = next.model || descriptor.model || '';
  next.aliases = [...new Set([...(next.aliases || []), ...aliases])];
  next.specs = {
    ...(next.specs || {}),
    ...specs
  };
  next.updated_at = now;
  next.confidence = Math.max(
    Number(next.confidence || 0),
    Number(context.confidence || 0)
  );
  if (context.evidenceRef) {
    next.evidence_refs = [...new Set([...(next.evidence_refs || []), context.evidenceRef])];
  }

  if (existingIndex >= 0) {
    rows[existingIndex] = next;
  } else {
    rows.push(next);
  }
  return next;
}

export async function updateComponentLibrary({
  storage,
  normalized,
  summary,
  provenance
}) {
  if (!summary?.validated) {
    return {
      updated: false,
      updated_types: []
    };
  }

  const fields = normalized?.fields || {};
  const confidence = Number(summary?.confidence || 0);
  const library = await loadComponentLibrary({ storage });
  const updatedTypes = [];

  for (const type of Object.keys(COMPONENT_FILES)) {
    const descriptor = resolveComponentDescriptor(type, fields);
    if (!hasValue(descriptor.model)) {
      continue;
    }
    const specs = pickSpecFields(type, fields);
    if (!Object.keys(specs).length) {
      continue;
    }
    const evidenceRef = provenance?.[Object.keys(specs)[0]]?.evidence?.[0]?.url || '';
    const rows = library.rows[type];
    const upserted = upsertComponentRow(rows, type, descriptor, specs, {
      confidence,
      evidenceRef
    });
    if (upserted) {
      updatedTypes.push(type);
    }
  }

  const writes = [];
  for (const type of [...new Set(updatedTypes)]) {
    writes.push(writeComponentRows(storage, type, library.rows[type]));
  }
  await Promise.all(writes);

  return {
    updated: writes.length > 0,
    updated_types: [...new Set(updatedTypes)],
    keys: writes
  };
}
