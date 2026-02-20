import { normalizeWhitespace, parseNumber, splitListValue } from '../utils/common.js';
import { load as loadHtml } from 'cheerio';
import { createHash } from 'node:crypto';

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
    const normalizedKey = normalizeWhitespace(row?.normalized_key || key);
    const normalizedValue = normalizeWhitespace(row?.normalized_value || value);
    if (!key || !value) {
      continue;
    }

    const signature = `${normalizedKey.toLowerCase()}::${normalizedValue.toLowerCase()}`;
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    out.push({
      key,
      value,
      raw_key: normalizeWhitespace(row?.raw_key || key),
      raw_value: normalizeWhitespace(row?.raw_value || value),
      normalized_key: normalizedKey || key,
      normalized_value: normalizedValue || value,
      table_id: String(row?.table_id || '').trim() || null,
      row_id: String(row?.row_id || '').trim() || null,
      section_header: String(row?.section_header || '').trim() || null,
      column_header: String(row?.column_header || '').trim() || null,
      unit_hint: String(row?.unit_hint || '').trim() || null,
      surface: String(row?.surface || '').trim() || null,
      path: String(row?.path || '').trim() || null
    });
  }

  return out;
}

function extractPairsWithCheerioLegacy(html) {
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
          value: cells.slice(1).join(' | '),
          surface: 'static_table',
          path: `table[${_}].row[${__}]`
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
            value: text,
            surface: 'static_dl',
            path: `dl[${_}].pair[${rows.length}]`
          });
        }
      });
  });

  return dedupePairs(rows);
}

function parseCellSpan(value) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.max(1, parsed);
}

function expandTableRow($, trNode, spanMap) {
  const expandedRow = [];

  for (const [colIndex, carry] of spanMap.entries()) {
    expandedRow[colIndex] = {
      text: String(carry.text || ''),
      isHeader: Boolean(carry.isHeader),
      colIndex,
      fromRowspan: true
    };
  }

  const nextSpanMap = new Map();
  for (const [colIndex, carry] of spanMap.entries()) {
    const remaining = Number(carry.remaining || 0) - 1;
    if (remaining > 0) {
      nextSpanMap.set(colIndex, {
        text: String(carry.text || ''),
        isHeader: Boolean(carry.isHeader),
        remaining
      });
    }
  }

  let cursor = 0;
  $(trNode).children('th,td').each((cellIndex, cellNode) => {
    while (expandedRow[cursor]) {
      cursor += 1;
    }

    const text = normalizeWhitespace($(cellNode).text());
    const colspan = parseCellSpan($(cellNode).attr('colspan'));
    const rowspan = parseCellSpan($(cellNode).attr('rowspan'));
    if (!text) {
      cursor += colspan;
      return;
    }

    const tag = String(cellNode.tagName || '').toLowerCase();
    const isHeader = tag === 'th';
    for (let offset = 0; offset < colspan; offset += 1) {
      const colIndex = cursor + offset;
      expandedRow[colIndex] = {
        text,
        isHeader,
        colIndex,
        cellIndex,
        fromRowspan: false
      };
      if (rowspan > 1) {
        nextSpanMap.set(colIndex, {
          text,
          isHeader,
          remaining: rowspan - 1
        });
      }
    }
    cursor += colspan;
  });

  return {
    expandedRow,
    nextSpanMap
  };
}

function inferUnitHint(value = '', key = '') {
  const token = `${String(key || '')} ${String(value || '')}`.toLowerCase();
  if (/\b(?:dpi|cpi)\b/.test(token)) return 'dpi';
  if (/\b(?:hz|khz)\b/.test(token)) return 'hz';
  if (/\b(?:mm|cm|inch|inches|in)\b|"/.test(token)) return 'mm';
  if (/\b(?:g|gram|grams|kg|lb|lbs|pound|pounds|oz)\b/.test(token)) return 'g';
  if (/\b(?:mah)\b/.test(token)) return 'mah';
  if (/\b(?:hour|hours|hr|hrs|min|mins|minute|minutes)\b/.test(token)) return 'h';
  return '';
}

function isSectionHeaderRow(expandedRow, textCells) {
  if (!Array.isArray(textCells) || textCells.length < 1) {
    return false;
  }
  const uniqueTexts = [...new Set(
    textCells
      .map((row) => normalizeWhitespace(row?.text || '').toLowerCase())
      .filter(Boolean)
  )];
  if (uniqueTexts.length === 1 && (expandedRow.length >= 2 || textCells.length >= 2)) {
    return true;
  }
  if (textCells.length !== 1) {
    return false;
  }
  const hasMultiColShape = expandedRow.length >= 2;
  return hasMultiColShape || Boolean(textCells[0]?.isHeader);
}

function buildTablePairsFromExpandedRow({
  expandedRow = [],
  tableIndex = 0,
  rowIndex = 0,
  sectionHeader = '',
  tableHeader = []
} = {}) {
  const textCells = expandedRow
    .map((cell, colIndex) => ({
      ...cell,
      colIndex,
      text: normalizeWhitespace(cell?.text || '')
    }))
    .filter((cell) => Boolean(cell.text));
  if (textCells.length < 2) {
    return [];
  }

  let rowSection = normalizeWhitespace(sectionHeader);
  let keyCell = textCells[0];
  let valueCells = textCells.slice(1);

  if (
    textCells.length >= 3
    && (
      Boolean(textCells[0].fromRowspan)
      || (Boolean(textCells[0].isHeader) && Boolean(textCells[1].isHeader))
    )
  ) {
    rowSection = normalizeWhitespace([rowSection, textCells[0].text].filter(Boolean).join(' '));
    keyCell = textCells[1];
    valueCells = textCells.slice(2);
  }

  if (!valueCells.length) {
    return [];
  }

  const hasHeaderRow = Array.isArray(tableHeader) && tableHeader.some(Boolean);
  const selectedValueCells = hasHeaderRow ? valueCells : [valueCells[0]];
  const keyText = normalizeWhitespace(keyCell.text);
  if (!keyText) {
    return [];
  }

  const tableId = `table_${String(tableIndex + 1).padStart(2, '0')}`;
  const rows = [];
  for (const valueCell of selectedValueCells) {
    const valueText = normalizeWhitespace(valueCell?.text || '');
    if (!valueText) {
      continue;
    }
    const columnHeader = normalizeWhitespace(tableHeader[valueCell.colIndex] || '');
    const normalizedKey = normalizeWhitespace([rowSection, keyText, columnHeader].filter(Boolean).join(' '));
    const rowId = `${tableId}.row_${String(rowIndex + 1).padStart(3, '0')}${selectedValueCells.length > 1 ? `.col_${String(valueCell.colIndex + 1).padStart(2, '0')}` : ''}`;
    rows.push({
      key: keyText,
      value: valueText,
      raw_key: keyText,
      raw_value: valueText,
      normalized_key: normalizedKey || keyText,
      normalized_value: valueText,
      table_id: tableId,
      row_id: rowId,
      section_header: rowSection || null,
      column_header: columnHeader || null,
      unit_hint: inferUnitHint(valueText, normalizedKey || keyText),
      surface: 'static_table',
      path: `table[${tableIndex}].row[${rowIndex}].col[${valueCell.colIndex}]`
    });
  }
  return rows;
}

function extractPairsWithCheerioV2(html) {
  const $ = loadHtml(String(html || ''));
  const rows = [];

  $('table').each((tableIndex, table) => {
    let spanMap = new Map();
    let sectionHeader = '';
    let tableHeader = [];

    $(table).find('tr').each((rowIndex, tr) => {
      const { expandedRow, nextSpanMap } = expandTableRow($, tr, spanMap);
      spanMap = nextSpanMap;

      const textCells = expandedRow
        .map((cell, colIndex) => ({
          ...cell,
          colIndex,
          text: normalizeWhitespace(cell?.text || '')
        }))
        .filter((cell) => Boolean(cell.text));
      if (!textCells.length) {
        return;
      }

      if (isSectionHeaderRow(expandedRow, textCells)) {
        sectionHeader = normalizeWhitespace(textCells[0].text);
        return;
      }

      const isHeaderRow = (
        rowIndex === 0
        && textCells.length >= 3
        && textCells.every((cell) => Boolean(cell.isHeader))
      );
      if (isHeaderRow) {
        tableHeader = expandedRow.map((cell) => normalizeWhitespace(cell?.text || ''));
        return;
      }

      rows.push(...buildTablePairsFromExpandedRow({
        expandedRow,
        tableIndex,
        rowIndex,
        sectionHeader,
        tableHeader
      }));
    });
  });

  $('dl').each((dlIndex, dl) => {
    let currentTerm = '';
    let pairIndex = 0;
    $(dl)
      .children('dt,dd')
      .each((_, node) => {
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
          pairIndex += 1;
          rows.push({
            key: currentTerm,
            value: text,
            raw_key: currentTerm,
            raw_value: text,
            normalized_key: currentTerm,
            normalized_value: text,
            table_id: `dl_${String(dlIndex + 1).padStart(2, '0')}`,
            row_id: `dl_${String(dlIndex + 1).padStart(2, '0')}.pair_${String(pairIndex).padStart(3, '0')}`,
            section_header: null,
            column_header: null,
            unit_hint: inferUnitHint(text, currentTerm),
            surface: 'static_dl',
            path: `dl[${dlIndex}].pair[${pairIndex - 1}]`
          });
        }
      });
  });

  return dedupePairs(rows);
}

function extractPairsWithRegex(html) {
  const rows = [];
  const tableRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowIndex = 0;
  for (const match of html.matchAll(tableRegex)) {
    const row = match[1];
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => stripTags(cell[1]));
    if (cells.length < 2) {
      continue;
    }
    const key = cells[0];
    const value = cells.slice(1).join(' | ');
    if (key && value) {
      rows.push({
        key,
        value,
        raw_key: key,
        raw_value: value,
        normalized_key: key,
        normalized_value: value,
        table_id: 'table_regex_01',
        row_id: `table_regex_01.row_${String(rowIndex + 1).padStart(3, '0')}`,
        section_header: null,
        column_header: null,
        unit_hint: inferUnitHint(value, key),
        surface: 'static_table',
        path: `table_regex.row[${rowIndex}]`
      });
      rowIndex += 1;
    }
  }
  return dedupePairs(rows);
}

function normalizeFieldValue(field, raw) {
  const text = normalizeWhitespace(raw);
  if (!text) {
    return 'unk';
  }

  const parseFirstNumber = (value) => {
    const source = String(value || '').trim();
    if (!source) return null;
    const match = source.match(/-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?/);
    if (!match?.[0]) return null;
    const parsed = Number.parseFloat(String(match[0]).replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  };

  const formatNumeric = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return 'unk';
    if (Math.abs(n - Math.round(n)) < 0.0001) {
      return String(Math.round(n));
    }
    return String(Number.parseFloat(n.toFixed(2)));
  };

  const dimensionToMm = (value) => {
    let out = Number(value);
    if (!Number.isFinite(out)) return null;
    const token = text.toLowerCase();
    if (/\bcm\b/.test(token)) out *= 10;
    else if (/\b(?:inch|inches|in)\b|"/.test(token)) out *= 25.4;
    else if (/\bm\b/.test(token) && !/\bmm\b/.test(token) && !/\bcm\b/.test(token)) out *= 1000;
    return out;
  };

  const weightToGram = (value) => {
    let out = Number(value);
    if (!Number.isFinite(out)) return null;
    const token = text.toLowerCase();
    if (/\bkg\b/.test(token)) out *= 1000;
    else if (/\bmg\b/.test(token)) out /= 1000;
    else if (/\b(?:lb|lbs|pound|pounds)\b/.test(token)) out *= 453.592;
    else if (/\boz\b/.test(token)) out *= 28.3495;
    return out;
  };

  if (field === 'polling_rate') {
    const nums = splitListValue(text)
      .map((item) => {
        let parsed = parseFirstNumber(item);
        if (parsed === null) {
          parsed = parseNumber(item);
        }
        if (parsed === null) {
          return null;
        }
        if (/\bkhz\b/i.test(item)) {
          parsed *= 1000;
        }
        return parsed;
      })
      .filter((item) => item !== null)
      .map((item) => Math.round(item));
    const unique = [...new Set(nums)].sort((a, b) => b - a);
    return unique.length ? unique.join(', ') : 'unk';
  }

  if (field === 'dpi') {
    let num = parseFirstNumber(text);
    if (num === null) {
      num = parseNumber(text);
    }
    if (num === null) return 'unk';
    if (/\b\d+(?:\.\d+)?\s*k\b/i.test(text) && !/\bkhz\b/i.test(text)) {
      num *= 1000;
    }
    return formatNumeric(num);
  }

  if (['lngth', 'width', 'height'].includes(field)) {
    let num = parseFirstNumber(text);
    if (num === null) {
      num = parseNumber(text);
    }
    if (num === null) return 'unk';
    const converted = dimensionToMm(num);
    return formatNumeric(converted);
  }

  if (field === 'weight') {
    let num = parseFirstNumber(text);
    if (num === null) {
      num = parseNumber(text);
    }
    if (num === null) return 'unk';
    const converted = weightToGram(num);
    return formatNumeric(converted);
  }

  if (field === 'battery_hours') {
    let num = parseFirstNumber(text);
    if (num === null) {
      num = parseNumber(text);
    }
    if (num === null) return 'unk';
    if (/\b(?:min|mins|minute|minutes)\b/i.test(text)) {
      num /= 60;
    }
    return formatNumeric(num);
  }

  if (['ips', 'acceleration', 'side_buttons', 'middle_buttons'].includes(field)) {
    const num = parseFirstNumber(text);
    if (num === null) {
      return 'unk';
    }
    return formatNumeric(num);
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

function normalizeStaticDomMode(mode = '') {
  const token = String(mode || '').trim().toLowerCase();
  return token === 'regex_fallback' ? 'regex_fallback' : 'cheerio';
}

export function extractTablePairs(html, options = {}) {
  const source = String(html || '');
  if (!source.trim()) {
    return [];
  }
  const mode = normalizeStaticDomMode(options?.mode || '');
  const useV2 = options?.useV2 !== false;

  if (mode === 'regex_fallback') {
    return extractPairsWithRegex(source);
  }

  try {
    const domPairs = useV2
      ? extractPairsWithCheerioV2(source)
      : extractPairsWithCheerioLegacy(source);
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
    const keyForMatch = normalizeWhitespace(
      `${String(pair?.normalized_key || '')} ${String(pair?.key || '')}`
    );
    const mapping = KEY_TO_FIELD.find((item) => item.pattern.test(keyForMatch));
    if (!mapping) {
      continue;
    }

    const value = normalizeFieldValue(mapping.field, pair.normalized_value || pair.value);
    if (value === 'unk') {
      continue;
    }

    candidates.push({
      field: mapping.field,
      value,
      method,
      keyPath: String(pair?.path || `table.${pair.key}`).trim(),
      surface: String(pair?.surface || '').trim() || 'static_table',
      evidence: buildPairEvidence(pair, mapping.field)
    });
  }

  return candidates;
}

function buildPairEvidence(pair, field) {
  const key = normalizeWhitespace(String(pair?.key || ''));
  const value = normalizeWhitespace(String(pair?.value || ''));
  const path = String(pair?.path || '').trim();
  const surface = String(pair?.surface || '').trim() || 'static_dom';
  const quote = `${key}: ${value}`.trim();
  const normalizedQuote = normalizeWhitespace(quote).toLowerCase();
  const snippetSeed = [field, key, value, path, surface].join('|');
  const snippetId = `sn_${createHash('sha256').update(snippetSeed, 'utf8').digest('hex').slice(0, 12)}`;
  const snippetHash = `sha256:${createHash('sha256').update(normalizedQuote, 'utf8').digest('hex')}`;
  return {
    snippet_id: snippetId,
    snippet_hash: snippetHash,
    quote,
    surface,
    key_path: path || null
  };
}

export function extractIdentityFromPairs(pairs) {
  const identity = {};
  for (const pair of pairs || []) {
    const key = normalizeWhitespace(pair?.normalized_key || pair?.key || '').toLowerCase();
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
