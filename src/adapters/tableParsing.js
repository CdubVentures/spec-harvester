import { normalizeWhitespace, parseNumber, splitListValue } from '../utils/common.js';

const KEY_TO_FIELD = [
  { pattern: /weight/i, field: 'weight' },
  { pattern: /length/i, field: 'lngth' },
  { pattern: /width/i, field: 'width' },
  { pattern: /height/i, field: 'height' },
  { pattern: /sensor\s*brand/i, field: 'sensor_brand' },
  { pattern: /sensor/i, field: 'sensor' },
  { pattern: /dpi|resolution/i, field: 'dpi' },
  { pattern: /polling/i, field: 'polling_rate' },
  { pattern: /ips/i, field: 'ips' },
  { pattern: /acceleration/i, field: 'acceleration' },
  { pattern: /switch\s*brand/i, field: 'switch_brand' },
  { pattern: /switch/i, field: 'switch' },
  { pattern: /side\s*buttons/i, field: 'side_buttons' },
  { pattern: /middle\s*buttons/i, field: 'middle_buttons' },
  { pattern: /connectivity/i, field: 'connectivity' },
  { pattern: /connection/i, field: 'connection' },
  { pattern: /battery/i, field: 'battery_hours' },
  { pattern: /hot\s*swappable/i, field: 'hot_swappable' },
  { pattern: /bluetooth/i, field: 'bluetooth' }
];

function stripTags(html) {
  return normalizeWhitespace(String(html || '').replace(/<[^>]+>/g, ' '));
}

function normalizeFieldValue(field, raw) {
  const text = normalizeWhitespace(raw);
  if (!text) {
    return 'unk';
  }

  if (field === 'polling_rate') {
    const nums = splitListValue(text)
      .map((item) => parseNumber(item))
      .filter((item) => item !== null)
      .map((item) => Math.round(item));
    const unique = [...new Set(nums)].sort((a, b) => b - a);
    return unique.length ? unique.join(', ') : 'unk';
  }

  if (['weight', 'lngth', 'width', 'height', 'dpi', 'ips', 'acceleration', 'battery_hours', 'side_buttons', 'middle_buttons'].includes(field)) {
    const num = parseNumber(text);
    if (num === null) {
      return 'unk';
    }
    return Number.isInteger(num) ? String(num) : String(Number.parseFloat(num.toFixed(2)));
  }

  if (['hot_swappable', 'bluetooth'].includes(field)) {
    const token = text.toLowerCase();
    if (['yes', 'true', '1', 'supported'].some((item) => token.includes(item))) {
      return 'yes';
    }
    if (['no', 'false', '0', 'not'].some((item) => token.includes(item))) {
      return 'no';
    }
    return 'unk';
  }

  return text;
}

export function extractTablePairs(html) {
  const rows = [];
  const tableRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  for (const match of html.matchAll(tableRegex)) {
    const row = match[1];
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => stripTags(cell[1]));
    if (cells.length < 2) {
      continue;
    }
    const key = cells[0];
    const value = cells[1];
    if (key && value) {
      rows.push({ key, value });
    }
  }
  return rows;
}

export function mapPairsToFieldCandidates(pairs, method = 'html_table') {
  const candidates = [];
  for (const pair of pairs || []) {
    const mapping = KEY_TO_FIELD.find((item) => item.pattern.test(pair.key));
    if (!mapping) {
      continue;
    }

    const value = normalizeFieldValue(mapping.field, pair.value);
    if (value === 'unk') {
      continue;
    }

    candidates.push({
      field: mapping.field,
      value,
      method,
      keyPath: `table.${pair.key}`
    });
  }

  return candidates;
}

export function extractIdentityFromPairs(pairs) {
  const identity = {};
  for (const pair of pairs || []) {
    const key = pair.key.toLowerCase();
    const value = normalizeWhitespace(pair.value);
    if (!value) {
      continue;
    }
    if (key.includes('brand') || key.includes('manufacturer')) {
      identity.brand = value;
    } else if (key.includes('model') || key.includes('product')) {
      identity.model = value;
    } else if (key.includes('sku') || key.includes('part number')) {
      identity.sku = value;
    }
  }
  return identity;
}
