import { extractTablePairs, extractIdentityFromPairs, mapPairsToFieldCandidates } from './tableParsing.js';
import { normalizeWhitespace, parseNumber, splitListValue } from '../utils/common.js';

function hostMatches(source) {
  return source.host === 'techpowerup.com' || source.host.endsWith('.techpowerup.com');
}

function flatten(value, prefix = '', out = []) {
  if (value === null || value === undefined) {
    return out;
  }
  if (Array.isArray(value)) {
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
    return [...new Set(nums)].sort((a, b) => b - a).join(', ') || 'unk';
  }

  if (['weight', 'lngth', 'width', 'height', 'dpi', 'ips', 'acceleration', 'side_buttons', 'middle_buttons'].includes(field)) {
    const num = parseNumber(raw);
    if (num === null) {
      return 'unk';
    }
    return Number.isInteger(num) ? String(num) : String(Number.parseFloat(num.toFixed(2)));
  }

  return normalizeWhitespace(raw) || 'unk';
}

const FIELD_PATTERNS = [
  { regex: /brand$/i, field: 'brand', identity: true },
  { regex: /model$|name$/i, field: 'model', identity: true },
  { regex: /sku|part/i, field: 'sku', identity: true },
  { regex: /weight/i, field: 'weight' },
  { regex: /length/i, field: 'lngth' },
  { regex: /width/i, field: 'width' },
  { regex: /height/i, field: 'height' },
  { regex: /sensor\.?brand/i, field: 'sensor_brand' },
  { regex: /sensor/i, field: 'sensor' },
  { regex: /polling\.?rate/i, field: 'polling_rate' },
  { regex: /dpi/i, field: 'dpi' },
  { regex: /ips/i, field: 'ips' },
  { regex: /acceleration/i, field: 'acceleration' },
  { regex: /switch\.?brand/i, field: 'switch_brand' },
  { regex: /switch/i, field: 'switch' },
  { regex: /side\.?buttons/i, field: 'side_buttons' },
  { regex: /middle\.?buttons/i, field: 'middle_buttons' }
];

function extractFromJsonPayloads(networkResponses) {
  const fieldCandidates = [];
  const identityCandidates = {};

  for (const row of networkResponses || []) {
    const payload = row.jsonFull ?? row.jsonPreview;
    if (!payload || typeof payload !== 'object') {
      continue;
    }

    const flat = flatten(payload);
    for (const entry of flat) {
      const mapping = FIELD_PATTERNS.find((item) => item.regex.test(entry.path));
      if (!mapping) {
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
          method: 'adapter_api',
          keyPath: `techpowerup.${entry.path}`
        });
      }
    }
  }

  return { fieldCandidates, identityCandidates };
}

export const techPowerUpAdapter = {
  name: 'techpowerup',

  seedUrls({ job }) {
    const query = encodeURIComponent(
      [job.identityLock?.brand || '', job.identityLock?.model || ''].join(' ').trim()
    );
    if (!query) {
      return [];
    }
    return [`https://www.techpowerup.com/search/?q=${query}`];
  },

  supportsHost({ source }) {
    return hostMatches(source);
  },

  async extractFromPage({ pageData }) {
    const jsonExtraction = extractFromJsonPayloads(pageData.networkResponses || []);

    const tablePairs = extractTablePairs(pageData.html || '');
    const tableFields = mapPairsToFieldCandidates(tablePairs, 'html_table');
    const tableIdentity = extractIdentityFromPairs(tablePairs);

    return {
      fieldCandidates: [...jsonExtraction.fieldCandidates, ...tableFields],
      identityCandidates: {
        ...jsonExtraction.identityCandidates,
        ...tableIdentity
      },
      additionalUrls: [],
      pdfDocs: []
    };
  }
};
