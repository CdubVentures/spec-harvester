import { normalizeWhitespace, parseNumber, splitListValue } from '../utils/common.js';
import { load as loadHtml } from 'cheerio';

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

function dedupePairs(rows) {
  const seen = new Set();
  const out = [];

  for (const row of rows || []) {
    const key = normalizeWhitespace(row?.key || '');
    const value = normalizeWhitespace(row?.value || '');
    if (!key || !value) {
      continue;
    }

    const signature = `${key.toLowerCase()}::${value.toLowerCase()}`;
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    out.push({ key, value });
  }

  return out;
}

function extractPairsWithCheerio(html) {
  const $ = loadHtml(String(html || ''));
  const rows = [];

  $('table').each((_, table) => {
    $(table)
      .find('tr')
      .each((__, tr) => {
        const cells = $(tr)
          .children('th,td')
          .map((___, cell) => normalizeWhitespace($(cell).text()))
          .get()
          .filter(Boolean);

        if (cells.length < 2) {
          return;
        }

        rows.push({
          key: cells[0],
          value: cells.slice(1).join(' | ')
        });
      });
  });

  $('dl').each((_, dl) => {
    let currentTerm = '';
    $(dl)
      .children('dt,dd')
      .each((__, node) => {
        const tag = String(node.tagName || '').toLowerCase();
        const text = normalizeWhitespace($(node).text());
        if (!text) {
          return;
        }

        if (tag === 'dt') {
          currentTerm = text;
          return;
        }

        if (tag === 'dd' && currentTerm) {
          rows.push({
            key: currentTerm,
            value: text
          });
        }
      });
  });

  return dedupePairs(rows);
}

function extractPairsWithRegex(html) {
  const rows = [];
  const tableRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  for (const match of html.matchAll(tableRegex)) {
    const row = match[1];
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => stripTags(cell[1]));
    if (cells.length < 2) {
      continue;
    }
    const key = cells[0];
    const value = cells.slice(1).join(' | ');
    if (key && value) {
      rows.push({ key, value });
    }
  }
  return dedupePairs(rows);
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
  const source = String(html || '');
  if (!source.trim()) {
    return [];
  }

  try {
    const domPairs = extractPairsWithCheerio(source);
    if (domPairs.length > 0) {
      return domPairs;
    }
  } catch {
    // fall through to regex fallback
  }

  return extractPairsWithRegex(source);
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
