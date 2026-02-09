import { normalizeWhitespace, parseNumber, splitListValue } from '../utils/common.js';

function hostMatches(source) {
  return source.host === 'rtings.com' || source.host.endsWith('.rtings.com');
}

function flatten(value, prefix = '', out = []) {
  if (value === null || value === undefined) {
    return out;
  }

  if (Array.isArray(value)) {
    if (value.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item))) {
      out.push({ path: prefix, value });
      return out;
    }
    value.forEach((item, index) => flatten(item, `${prefix}[${index}]`, out));
    return out;
  }

  if (typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      const next = prefix ? `${prefix}.${key}` : key;
      flatten(inner, next, out);
    }
    return out;
  }

  out.push({ path: prefix, value });
  return out;
}

function normalizeFieldValue(field, raw) {
  if (field === 'polling_rate') {
    const nums = splitListValue(raw)
      .map((item) => parseNumber(item))
      .filter((item) => item !== null)
      .map((item) => Math.round(item));
    const unique = [...new Set(nums)].sort((a, b) => b - a);
    return unique.length ? unique.join(', ') : 'unk';
  }

  if (['sensor_latency', 'click_latency', 'click_force', 'shift_latency', 'dpi', 'ips', 'acceleration', 'weight', 'lngth', 'width', 'height', 'side_buttons', 'middle_buttons'].includes(field)) {
    const num = parseNumber(raw);
    if (num === null) {
      return 'unk';
    }
    return Number.isInteger(num) ? String(num) : String(Number.parseFloat(num.toFixed(2)));
  }

  const text = normalizeWhitespace(raw);
  return text || 'unk';
}

const FIELD_PATTERNS = [
  { pattern: /brand$/i, field: 'brand', identity: true },
  { pattern: /model$|name$/i, field: 'model', identity: true },
  { pattern: /sensor\.?latency/i, field: 'sensor_latency' },
  { pattern: /click\.?latency/i, field: 'click_latency' },
  { pattern: /click\.?force/i, field: 'click_force' },
  { pattern: /shift\.?latency/i, field: 'shift_latency' },
  { pattern: /weight/i, field: 'weight' },
  { pattern: /length/i, field: 'lngth' },
  { pattern: /width/i, field: 'width' },
  { pattern: /height/i, field: 'height' },
  { pattern: /polling\.?rate/i, field: 'polling_rate' },
  { pattern: /sensor\.?brand/i, field: 'sensor_brand' },
  { pattern: /sensor/i, field: 'sensor' },
  { pattern: /dpi/i, field: 'dpi' },
  { pattern: /ips/i, field: 'ips' },
  { pattern: /acceleration/i, field: 'acceleration' },
  { pattern: /side\.?buttons/i, field: 'side_buttons' },
  { pattern: /middle\.?buttons/i, field: 'middle_buttons' }
];

function mapFlattenedEntries(entries, method) {
  const fieldCandidates = [];
  const identityCandidates = {};

  for (const entry of entries) {
    for (const mapping of FIELD_PATTERNS) {
      if (!mapping.pattern.test(entry.path)) {
        continue;
      }

      const value = normalizeFieldValue(mapping.field, entry.value);
      if (value === 'unk') {
        continue;
      }

      if (mapping.identity) {
        identityCandidates[mapping.field] = value;
      } else {
        fieldCandidates.push({
          field: mapping.field,
          value,
          method,
          keyPath: entry.path
        });
      }
      break;
    }
  }

  return { fieldCandidates, identityCandidates };
}

export const rtingsAdapter = {
  name: 'rtings',

  seedUrls({ job }) {
    const brand = encodeURIComponent(job.identityLock?.brand || '');
    const model = encodeURIComponent(job.identityLock?.model || '');
    if (!brand && !model) {
      return [];
    }
    return [`https://www.rtings.com/search?q=${brand}%20${model}`];
  },

  supportsHost({ source }) {
    return hostMatches(source);
  },

  async extractFromPage({ pageData }) {
    const payloads = [
      pageData.embeddedState?.nextData,
      pageData.embeddedState?.nuxtState,
      pageData.embeddedState?.apolloState,
      ...(pageData.networkResponses || []).map((row) => row.jsonFull ?? row.jsonPreview)
    ].filter(Boolean);

    const fieldCandidates = [];
    const identityCandidates = {};

    for (const payload of payloads) {
      const entries = flatten(payload);
      const mapped = mapFlattenedEntries(entries, 'instrumented_api');
      fieldCandidates.push(...mapped.fieldCandidates);
      Object.assign(identityCandidates, mapped.identityCandidates);
    }

    return {
      fieldCandidates,
      identityCandidates,
      additionalUrls: [],
      pdfDocs: []
    };
  }
};
