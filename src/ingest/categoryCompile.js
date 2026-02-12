import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
import { XMLParser } from 'fast-xml-parser';
import { nowIso } from '../utils/common.js';

const DETERMINISTIC_TIMESTAMP = '1970-01-01T00:00:00.000Z';
const DEFAULT_REQUIRED_FIELDS = new Set([
  'weight',
  'lngth',
  'width',
  'height',
  'connection',
  'connectivity',
  'polling_rate',
  'dpi',
  'sensor',
  'sensor_brand',
  'switch',
  'switch_brand',
  'side_buttons',
  'middle_buttons'
]);
const INSTRUMENTED_HARD_FIELDS = new Set([
  'click_latency',
  'click_latency_list',
  'sensor_latency',
  'sensor_latency_list',
  'shift_latency',
  'click_force'
]);

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asNumber(value) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeToken(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeFieldKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function titleFromKey(value) {
  return String(value || '')
    .split('_')
    .filter(Boolean)
    .map((token) => token.slice(0, 1).toUpperCase() + token.slice(1))
    .join(' ');
}

function stableSortStrings(values = []) {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function orderedUniqueStrings(values = []) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const token = normalizeText(value);
    if (!token) {
      continue;
    }
    const key = token.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(token);
  }
  return out;
}

function sortDeep(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortDeep(item));
  }
  if (!isObject(value)) {
    return value;
  }
  const out = {};
  for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
    out[key] = sortDeep(value[key]);
  }
  return out;
}

function stableStringify(value) {
  return JSON.stringify(sortDeep(value), null, 2);
}

function hashBuffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function hashJson(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseRange(value) {
  const match = String(value || '').trim().match(/^([A-Za-z]+)(\d+)\s*:\s*([A-Za-z]+)(\d+)$/);
  if (!match) {
    return null;
  }
  const startColumn = String(match[1]).toUpperCase();
  const startRow = asInt(match[2], 0);
  const endColumn = String(match[3]).toUpperCase();
  const endRow = asInt(match[4], 0);
  if (startRow <= 0 || endRow <= 0) {
    return null;
  }
  return {
    startColumn,
    startRow,
    endColumn,
    endRow
  };
}

function parseWorkbookRangeRef(value) {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }
  const noAbs = text.replace(/\$/g, '');
  const match = noAbs.match(/^'?([^']+)'?!([A-Za-z]+)(\d+)\s*:\s*([A-Za-z]+)(\d+)$/);
  if (!match) {
    return null;
  }
  const sheet = normalizeText(match[1]);
  const startColumn = String(match[2]).toUpperCase();
  const startRow = asInt(match[3], 0);
  const endColumn = String(match[4]).toUpperCase();
  const endRow = asInt(match[5], 0);
  if (!sheet || startRow <= 0 || endRow <= 0) {
    return null;
  }
  return {
    sheet,
    startColumn,
    startRow,
    endColumn,
    endRow
  };
}

function colToIndex(column) {
  const text = String(column || '').trim().toUpperCase();
  if (!text) {
    return null;
  }
  let total = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) {
      return null;
    }
    total = (total * 26) + (code - 64);
  }
  return total > 0 ? total : null;
}

function indexToCol(index) {
  let value = asInt(index, 0);
  if (value <= 0) {
    return '';
  }
  let out = '';
  while (value > 0) {
    const rem = (value - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    value = Math.floor((value - 1) / 26);
  }
  return out;
}

function splitCellRef(ref) {
  const match = String(ref || '').trim().match(/^([A-Za-z]+)(\d+)$/);
  if (!match) {
    return null;
  }
  return {
    column: String(match[1]).toUpperCase(),
    row: asInt(match[2], 0)
  };
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === null || value === undefined) {
    return [];
  }
  return [value];
}

function xmlText(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => xmlText(entry)).join('');
  }
  if (typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, '#text')) {
      return String(value['#text'] ?? '');
    }
    if (Object.prototype.hasOwnProperty.call(value, 't')) {
      return xmlText(value.t);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'r')) {
      return asArray(value.r)
        .map((entry) => xmlText(entry?.t ?? entry?.['#text'] ?? ''))
        .join('');
    }
  }
  return '';
}

function findEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - (0xffff + 22));
  for (let index = buffer.length - 22; index >= minOffset; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      return index;
    }
  }
  return -1;
}

function readZipEntries(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) {
    throw new Error('zip_eocd_not_found');
  }
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map();
  let cursor = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error(`zip_central_directory_invalid:${cursor}`);
    }
    const compressionMethod = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const fileName = buffer.toString('utf8', cursor + 46, cursor + 46 + fileNameLength);
    entries.set(fileName, {
      fileName,
      compressionMethod,
      compressedSize,
      localHeaderOffset
    });
    cursor += (46 + fileNameLength + extraLength + commentLength);
  }
  return entries;
}

function readZipEntryBuffer(workbookBuffer, zipEntry) {
  const localHeaderOffset = zipEntry.localHeaderOffset;
  if (workbookBuffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
    throw new Error(`zip_local_header_invalid:${zipEntry.fileName}`);
  }
  const fileNameLength = workbookBuffer.readUInt16LE(localHeaderOffset + 26);
  const extraLength = workbookBuffer.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + fileNameLength + extraLength;
  const compressedBuffer = workbookBuffer.subarray(dataStart, dataStart + zipEntry.compressedSize);
  if (zipEntry.compressionMethod === 0) {
    return compressedBuffer;
  }
  if (zipEntry.compressionMethod === 8) {
    return zlib.inflateRawSync(compressedBuffer);
  }
  throw new Error(`zip_compression_unsupported:${zipEntry.compressionMethod}`);
}

function readZipEntryText(workbookBuffer, entries, entryName) {
  const entry = entries.get(entryName);
  if (!entry) {
    return null;
  }
  return readZipEntryBuffer(workbookBuffer, entry).toString('utf8');
}

function parseXml(text) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    removeNSPrefix: true,
    textNodeName: '#text',
    trimValues: false,
    parseTagValue: false
  });
  return parser.parse(String(text || ''));
}

function normalizeSheetTarget(value) {
  let token = String(value || '').trim().replace(/\\/g, '/');
  if (!token) {
    return '';
  }
  if (token.startsWith('/')) {
    token = token.slice(1);
  }
  if (!token.startsWith('xl/')) {
    token = `xl/${token}`;
  }
  return token;
}

function loadSheetDescriptors({ workbookBuffer, entries }) {
  const workbookXml = readZipEntryText(workbookBuffer, entries, 'xl/workbook.xml');
  if (!workbookXml) {
    throw new Error('workbook_xml_missing');
  }
  const relsXml = readZipEntryText(workbookBuffer, entries, 'xl/_rels/workbook.xml.rels');
  if (!relsXml) {
    throw new Error('workbook_rels_missing');
  }
  const workbookDoc = parseXml(workbookXml);
  const relsDoc = parseXml(relsXml);

  const relationships = new Map();
  for (const rel of asArray(relsDoc?.Relationships?.Relationship)) {
    const relId = normalizeText(rel?.Id);
    const target = normalizeSheetTarget(rel?.Target || '');
    if (!relId || !target) {
      continue;
    }
    relationships.set(relId, target);
  }

  const out = [];
  for (const sheet of asArray(workbookDoc?.workbook?.sheets?.sheet)) {
    const name = normalizeText(sheet?.name);
    const relId = normalizeText(sheet?.id);
    if (!name || !relId) {
      continue;
    }
    const sheetPath = relationships.get(relId);
    if (!sheetPath) {
      continue;
    }
    out.push({
      name,
      relId,
      sheetPath
    });
  }
  return out;
}

function loadDefinedNames({ workbookBuffer, entries }) {
  const workbookXml = readZipEntryText(workbookBuffer, entries, 'xl/workbook.xml');
  if (!workbookXml) {
    return [];
  }
  const workbookDoc = parseXml(workbookXml);
  const names = [];
  for (const row of asArray(workbookDoc?.workbook?.definedNames?.definedName)) {
    const name = normalizeText(row?.name);
    const rangeText = normalizeText(
      row?.['#text'] ??
      row?.text ??
      (typeof row === 'string' ? row : '')
    );
    if (!name || !rangeText) {
      continue;
    }
    const parsed = parseWorkbookRangeRef(rangeText);
    names.push({
      name,
      range: rangeText,
      parsed
    });
  }
  return names;
}

function loadSharedStrings({ workbookBuffer, entries }) {
  const sharedXml = readZipEntryText(workbookBuffer, entries, 'xl/sharedStrings.xml');
  if (!sharedXml) {
    return [];
  }
  const sharedDoc = parseXml(sharedXml);
  return asArray(sharedDoc?.sst?.si).map((entry) => xmlText(entry).trim());
}

function loadSheetCellMap({ workbookBuffer, entries, sheetPath, sharedStrings }) {
  const sheetXml = readZipEntryText(workbookBuffer, entries, sheetPath);
  if (!sheetXml) {
    throw new Error(`sheet_xml_missing:${sheetPath}`);
  }
  const sheetDoc = parseXml(sheetXml);
  const cells = new Map();
  let maxRow = 0;
  let maxCol = 0;
  for (const row of asArray(sheetDoc?.worksheet?.sheetData?.row)) {
    for (const cell of asArray(row?.c)) {
      const ref = normalizeText(cell?.r).toUpperCase();
      if (!ref) {
        continue;
      }
      const split = splitCellRef(ref);
      if (!split || split.row <= 0) {
        continue;
      }
      let value = '';
      if (cell?.is !== undefined) {
        value = xmlText(cell.is);
      } else if (cell?.v !== undefined) {
        const rawValue = xmlText(cell.v);
        if (String(cell?.t || '').trim() === 's') {
          const idx = asInt(rawValue, -1);
          if (idx >= 0 && idx < sharedStrings.length) {
            value = sharedStrings[idx];
          } else {
            value = rawValue;
          }
        } else {
          value = rawValue;
        }
      }
      const normalized = normalizeText(value);
      if (!normalized) {
        continue;
      }
      const colIdx = colToIndex(split.column);
      cells.set(ref, normalized);
      maxRow = Math.max(maxRow, split.row);
      maxCol = Math.max(maxCol, colIdx || 0);
    }
  }
  return {
    cells,
    maxRow,
    maxCol
  };
}

function getCell(sheet, column, row) {
  return normalizeText(sheet?.cells?.get(`${String(column).toUpperCase()}${asInt(row, 0)}`) || '');
}

function detectSheetRoleHints(sheetName, sheetData) {
  const nameToken = normalizeToken(sheetName);
  const roles = [];
  const lowerName = nameToken.replace(/[^a-z0-9]+/g, ' ');
  if (/\b(sensor|switch|encoder|mcu|material|component)\b/.test(lowerName)) {
    roles.push('component_db');
  }
  if (/\b(enum|values?|list|options?)\b/.test(lowerName)) {
    roles.push('enum_list');
  }
  if (/\b(data|products?|catalog|entry)\b/.test(lowerName)) {
    roles.push('product_table');
  }

  const nonEmpty = sheetData.non_empty_cells;
  const rows = sheetData.max_row;
  const cols = sheetData.max_col;
  if (rows >= 20 && cols >= 3 && nonEmpty > 60 && !roles.includes('product_table')) {
    roles.push('product_table');
  }

  const dominantColumnCount = sheetData.dominant_column_count;
  if (dominantColumnCount >= 20 && !roles.includes('field_key_list')) {
    roles.push('field_key_list');
  }

  if (!roles.length) {
    roles.push('notes');
  }

  return roles;
}

function guessComponentType(sheetName) {
  const token = normalizeToken(sheetName);
  if (token.includes('sensor')) return 'sensor';
  if (token.includes('switch')) return 'switch';
  if (token.includes('encoder')) return 'encoder';
  if (token.includes('mcu')) return 'mcu';
  if (token.includes('material')) return 'material';
  return 'component';
}

function pickDominantColumn(sheet) {
  const colCounts = new Map();
  for (const ref of sheet.cells.keys()) {
    const split = splitCellRef(ref);
    if (!split) {
      continue;
    }
    const col = split.column;
    colCounts.set(col, (colCounts.get(col) || 0) + 1);
  }
  let topColumn = 'A';
  let topCount = 0;
  for (const [col, count] of colCounts.entries()) {
    if (count > topCount) {
      topColumn = col;
      topCount = count;
    }
  }
  return {
    column: topColumn,
    count: topCount
  };
}

function buildSheetPreview(sheet, { previewRows = 20, previewCols = 8 } = {}) {
  const rowIndexes = [...new Set(
    [...sheet.cells.keys()]
      .map((ref) => splitCellRef(ref)?.row || 0)
      .filter((value) => value > 0)
  )].sort((a, b) => a - b);
  if (!rowIndexes.length) {
    return {
      columns: [],
      rows: []
    };
  }

  const firstRow = rowIndexes[0];
  const selectedRows = [];
  for (let row = firstRow; row < firstRow + Math.max(1, previewRows); row += 1) {
    selectedRows.push(row);
  }

  const colCounts = new Map();
  for (const row of selectedRows) {
    for (let col = 1; col <= Math.max(1, sheet.maxCol); col += 1) {
      const colLabel = indexToCol(col);
      if (getCell(sheet, colLabel, row)) {
        colCounts.set(colLabel, (colCounts.get(colLabel) || 0) + 1);
      }
    }
  }
  const columns = [...colCounts.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, Math.max(1, previewCols))
    .map(([col]) => col)
    .sort((a, b) => (colToIndex(a) || 0) - (colToIndex(b) || 0));

  const rows = [];
  for (const row of selectedRows) {
    const cells = {};
    let nonEmpty = 0;
    for (const col of columns) {
      const value = getCell(sheet, col, row);
      if (value) {
        nonEmpty += 1;
      }
      cells[col] = value;
    }
    if (nonEmpty > 0) {
      rows.push({
        row,
        cells
      });
    }
  }

  return {
    columns,
    rows
  };
}

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function tooltipHtmlToMarkdown(rawHtml) {
  const raw = decodeHtmlEntities(rawHtml);
  if (!normalizeText(raw)) {
    return '';
  }
  const withBreaks = raw
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li)\s*>/gi, '\n')
    .replace(/<\s*strong[^>]*>/gi, '**')
    .replace(/<\/\s*strong\s*>/gi, '**')
    .replace(/<[^>]+>/g, ' ');
  return withBreaks
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

async function loadTooltipLibrary({ categoryRoot }) {
  const entries = {};
  const files = [];
  let dirEntries = [];
  try {
    dirEntries = await fs.readdir(categoryRoot, { withFileTypes: true });
  } catch {
    return {
      entries,
      files
    };
  }
  const tooltipFiles = dirEntries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /^hbs_tooltips.*\.js$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
  const entryPattern = /([A-Za-z0-9_]+)\s*:\s*`([\s\S]*?)`\s*(?:,|$)/g;
  for (const fileName of tooltipFiles) {
    const fullPath = path.join(categoryRoot, fileName);
    let raw = '';
    try {
      raw = await fs.readFile(fullPath, 'utf8');
    } catch {
      continue;
    }
    files.push(fileName);
    const bodyMatch = raw.match(/export\s+const\s+TOOLTIPS\s*=\s*{([\s\S]*?)}\s*;/i);
    const body = bodyMatch ? bodyMatch[1] : raw;
    entryPattern.lastIndex = 0;
    let match = null;
    while ((match = entryPattern.exec(body)) !== null) {
      const key = normalizeFieldKey(match[1]);
      const html = normalizeText(match[2]);
      if (!key || !html) {
        continue;
      }
      entries[key] = {
        key,
        source: fileName,
        html,
        markdown: tooltipHtmlToMarkdown(html)
      };
    }
  }
  return {
    entries: sortDeep(entries),
    files
  };
}

export async function introspectWorkbook({
  workbookPath,
  previewRows = 20,
  previewCols = 8
}) {
  const resolvedWorkbook = path.resolve(String(workbookPath || '').trim());
  if (!resolvedWorkbook) {
    throw new Error('workbook_path_required');
  }
  const buffer = await fs.readFile(resolvedWorkbook);
  const workbookHash = hashBuffer(buffer);
  const entries = readZipEntries(buffer);
  const descriptors = loadSheetDescriptors({ workbookBuffer: buffer, entries });
  const sharedStrings = loadSharedStrings({ workbookBuffer: buffer, entries });
  const definedNames = loadDefinedNames({ workbookBuffer: buffer, entries });

  const sheets = [];
  const sheetDataByName = new Map();
  for (const descriptor of descriptors) {
    const loaded = loadSheetCellMap({
      workbookBuffer: buffer,
      entries,
      sheetPath: descriptor.sheetPath,
      sharedStrings
    });
    const dominant = pickDominantColumn(loaded);
    const sheet = {
      ...descriptor,
      ...loaded,
      non_empty_cells: loaded.cells.size,
      max_row: loaded.maxRow,
      max_col: loaded.maxCol,
      dominant_column: dominant.column,
      dominant_column_count: dominant.count
    };
    sheetDataByName.set(descriptor.name, sheet);
    const preview = buildSheetPreview(sheet, { previewRows, previewCols });
    const detectedRoles = detectSheetRoleHints(descriptor.name, sheet);
    sheets.push({
      name: descriptor.name,
      sheet_path: descriptor.sheetPath,
      non_empty_cells: sheet.non_empty_cells,
      max_row: sheet.max_row,
      max_col: sheet.max_col,
      dominant_column: sheet.dominant_column,
      dominant_column_count: sheet.dominant_column_count,
      detected_roles: detectedRoles,
      preview
    });
  }

  let keyListCandidate = null;
  let productTableCandidate = null;
  let bestKeyScore = -1;
  let bestProductScore = -1;
  for (const sheet of sheets) {
    const keyScore = (sheet.dominant_column_count * 1.4) + (sheet.max_row * 0.15) - (sheet.max_col * 0.6);
    if (keyScore > bestKeyScore) {
      bestKeyScore = keyScore;
      keyListCandidate = sheet;
    }
    const productScore = (sheet.max_col * 2.2) + (sheet.max_row * 0.2) + (sheet.non_empty_cells * 0.01);
    if (productScore > bestProductScore) {
      bestProductScore = productScore;
      productTableCandidate = sheet;
    }
  }

  const suggestedMap = {
    version: 1,
    workbook_path: resolvedWorkbook,
    sheet_roles: sheets.map((sheet) => ({
      sheet: sheet.name,
      role: (sheet.detected_roles || [])[0] || 'ignore'
    })),
    key_list: keyListCandidate
      ? {
        sheet: keyListCandidate.name,
        source: 'column_range',
        column: keyListCandidate.dominant_column || 'A',
        row_start: 1,
        row_end: Math.max(1, Math.min(2000, asInt(keyListCandidate.max_row, 1)))
      }
      : null,
    product_table: productTableCandidate
      ? {
        sheet: productTableCandidate.name,
        layout: 'matrix',
        brand_row: 3,
        model_row: 4,
        variant_row: 5,
        value_col_start: 'C',
        value_col_end: ''
      }
      : null,
    enum_lists: [],
    component_sheets: sheets
      .filter((sheet) => toArray(sheet.detected_roles).includes('component_db'))
      .map((sheet) => ({
        sheet: sheet.name,
        component_type: guessComponentType(sheet.name),
        name_column: 'A',
        alias_columns: ['B'],
        brand_column: '',
        link_columns: ['C'],
        property_columns: [],
        row_start: 2,
        row_end: ''
      })),
    expectations: {
      required_fields: [],
      critical_fields: [],
      expected_easy_fields: [],
      expected_sometimes_fields: [],
      deep_fields: []
    },
    selected_keys: [],
    field_overrides: {}
  };

  const sheetToken = (name) => normalizeToken(name).replace(/[^a-z0-9]+/g, '');
  const findSheet = (matcher) => {
    for (const sheet of sheetDataByName.values()) {
      if (matcher(sheetToken(sheet.name))) {
        return sheet;
      }
    }
    return null;
  };
  const dataEntrySheet = findSheet((token) => token === 'dataentry');
  const dataListsSheet = findSheet((token) => token === 'datalists' || token === 'datalist' || token === 'datalistvalues');
  if (dataEntrySheet) {
    const keyListRows = [];
    for (let row = 9; row <= 83; row += 1) {
      const label = normalizeText(getCell(dataEntrySheet, 'B', row));
      const key = normalizeFieldKey(label);
      if (key) {
        keyListRows.push(key);
      }
    }
    const selectedKeys = stableSortStrings(keyListRows);
    const roleRows = [
      { sheet: dataEntrySheet.name, role: 'field_key_list' },
      { sheet: dataEntrySheet.name, role: 'product_table' }
    ];
    const enumRows = [];
    if (dataListsSheet) {
      for (let col = 1; col <= Math.max(1, asInt(dataListsSheet.max_col, 0)); col += 1) {
        const colLabel = indexToCol(col);
        const header = normalizeText(getCell(dataListsSheet, colLabel, 1));
        const bucket = normalizeFieldKey(header);
        if (!bucket) {
          continue;
        }
        enumRows.push({
          sheet: dataListsSheet.name,
          field: bucket,
          value_column: colLabel,
          row_start: 2,
          row_end: 0,
          delimiter: '',
          normalize: 'lower_trim',
          header_row: 1
        });
      }
      roleRows.push({ sheet: dataListsSheet.name, role: 'enum_list' });
    }

    const componentRows = [];
    for (const componentName of ['sensors', 'switches', 'encoder', 'material']) {
      const componentSheet = findSheet((token) => token === componentName || token === `${componentName}s`);
      if (!componentSheet) {
        continue;
      }
      const headerColumns = [];
      const columnLimit = Math.max(1, Math.min(asInt(componentSheet.max_col, 0), 32));
      for (let col = 1; col <= columnLimit; col += 1) {
        const colLabel = indexToCol(col);
        const header = normalizeToken(getCell(componentSheet, colLabel, 1));
        if (header) {
          headerColumns.push({ col: colLabel, header });
        }
      }
      let nameColumn = 'A';
      let brandColumn = '';
      const aliasColumns = [];
      const linkColumns = [];
      const propertyColumns = [];
      for (const colInfo of headerColumns) {
        const header = colInfo.header;
        if (!nameColumn || nameColumn === 'A') {
          if (header.includes('name') || header.includes('model') || header.includes('component')) {
            nameColumn = colInfo.col;
            continue;
          }
        }
        if (!brandColumn && (header.includes('brand') || header.includes('maker') || header.includes('manufacturer'))) {
          brandColumn = colInfo.col;
          continue;
        }
        if (header.includes('alias')) {
          aliasColumns.push(colInfo.col);
          continue;
        }
        if (header.includes('link') || header.includes('url')) {
          linkColumns.push(colInfo.col);
          continue;
        }
        if (!['id', 'sku'].includes(header)) {
          propertyColumns.push(colInfo.col);
        }
      }
      componentRows.push({
        sheet: componentSheet.name,
        component_type: guessComponentType(componentSheet.name),
        name_column: nameColumn || 'A',
        alias_columns: stableSortStrings(aliasColumns),
        brand_column: brandColumn,
        link_columns: stableSortStrings(linkColumns),
        property_columns: stableSortStrings(propertyColumns),
        row_start: 2,
        row_end: 0
      });
      roleRows.push({ sheet: componentSheet.name, role: 'component_db' });
    }

    suggestedMap.sheet_roles = roleRows;
    suggestedMap.key_list = {
      sheet: dataEntrySheet.name,
      source: 'range',
      range: 'B9:B83',
      column: 'B',
      row_start: 9,
      row_end: 83
    };
    suggestedMap.product_table = {
      sheet: dataEntrySheet.name,
      layout: 'matrix',
      key_column: 'B',
      header_row: 1,
      data_row_start: 9,
      brand_row: 3,
      model_row: 4,
      variant_row: 5,
      value_col_start: 'C',
      value_col_end: '',
      sample_columns: 24
    };
    suggestedMap.enum_lists = enumRows;
    suggestedMap.component_sheets = componentRows;
    suggestedMap.selected_keys = selectedKeys;
    suggestedMap.expectations = {
      required_fields: stableSortStrings([
        'weight',
        'lngth',
        'width',
        'height',
        'connection',
        'connectivity',
        'polling_rate',
        'dpi',
        'sensor',
        'sensor_brand',
        'switch',
        'switch_brand',
        'side_buttons',
        'middle_buttons'
      ].filter((field) => selectedKeys.includes(field))),
      critical_fields: stableSortStrings([
        'sensor',
        'sensor_brand',
        'switch',
        'switch_brand',
        'polling_rate',
        'dpi'
      ].filter((field) => selectedKeys.includes(field))),
      expected_easy_fields: stableSortStrings([
        'weight',
        'lngth',
        'width',
        'height',
        'connection',
        'connectivity',
        'polling_rate',
        'dpi',
        'side_buttons',
        'middle_buttons'
      ].filter((field) => selectedKeys.includes(field))),
      expected_sometimes_fields: stableSortStrings([
        'sensor',
        'sensor_brand',
        'switch',
        'switch_brand'
      ].filter((field) => selectedKeys.includes(field))),
      deep_fields: stableSortStrings(selectedKeys.filter((field) => ![
        'weight',
        'lngth',
        'width',
        'height',
        'connection',
        'connectivity',
        'polling_rate',
        'dpi',
        'sensor',
        'sensor_brand',
        'switch',
        'switch_brand',
        'side_buttons',
        'middle_buttons'
      ].includes(field)))
    };
  }

  const simpleNamedRanges = definedNames
    .filter((row) => row?.parsed)
    .map((row) => ({
      name: row.name,
      sheet: row.parsed.sheet,
      start_column: row.parsed.startColumn,
      end_column: row.parsed.endColumn,
      row_start: row.parsed.startRow,
      row_end: row.parsed.endRow
    }));
  if (simpleNamedRanges.length > 0 && !suggestedMap.key_list) {
    suggestedMap.key_list = {
      sheet: simpleNamedRanges[0].sheet,
      source: 'named_range',
      named_range: simpleNamedRanges[0].name
    };
  }

  return {
    version: 1,
    generated_at: nowIso(),
    workbook_path: resolvedWorkbook,
    workbook_hash: workbookHash,
    sheet_count: sheets.length,
    named_ranges: simpleNamedRanges,
    sheets,
    suggested_map: suggestedMap
  };
}

function normalizeSheetRoleRow(row = {}) {
  return {
    sheet: normalizeText(row.sheet),
    role: normalizeToken(row.role || 'ignore')
  };
}

function normalizeWorkbookMap(map = {}) {
  const sheetRoles = toArray(map.sheet_roles).map((row) => normalizeSheetRoleRow(row));
  const keySourceRaw = isObject(map.key_source) ? map.key_source : {};
  const keyListRaw = isObject(map.key_list) ? map.key_list : {};
  const keyRange = normalizeText(keyListRaw.range || keySourceRaw.range);
  const parsedKeyRange = parseRange(keyRange);
  const keySourceToken = normalizeToken(
    keyListRaw.source
    || keySourceRaw.source
    || (keyRange ? 'range' : (normalizeText(keyListRaw.named_range || keySourceRaw.named_range) ? 'named_range' : 'column_range'))
  ) || 'column_range';
  const keyColumnFallback = parsedKeyRange?.startColumn || normalizeText(keyListRaw.column || keySourceRaw.column || 'A').toUpperCase();
  const keyRowStartFallback = parsedKeyRange?.startRow || asInt(keyListRaw.row_start || keySourceRaw.row_start || keySourceRaw.start_row, 1);
  const keyRowEndFallback = parsedKeyRange?.endRow || asInt(keyListRaw.row_end || keySourceRaw.row_end || keySourceRaw.end_row, 0);
  const keyList = {
    sheet: normalizeText(keyListRaw.sheet || keySourceRaw.sheet),
    source: keySourceToken === 'table_column' ? 'column_range' : keySourceToken,
    named_range: normalizeText(keyListRaw.named_range || keySourceRaw.named_range),
    range: keyRange,
    column: keyColumnFallback,
    row_start: keyRowStartFallback,
    row_end: keyRowEndFallback
  };
  const hasKeyList = Boolean(keyList.sheet);

  const samplingRaw = isObject(map.sampling) ? map.sampling : {};
  const productRaw = isObject(map.product_table) ? map.product_table : {};
  const productTable = (productRaw.sheet || samplingRaw.sheet)
    ? {
      sheet: normalizeText(productRaw.sheet || samplingRaw.sheet),
      layout: normalizeToken(productRaw.layout || samplingRaw.layout || 'matrix'),
      key_column: normalizeText(productRaw.key_column || samplingRaw.key_column || keyList.column || 'A').toUpperCase(),
      header_row: asInt(productRaw.header_row || samplingRaw.header_row, 1),
      data_row_start: asInt(productRaw.data_row_start || samplingRaw.data_row_start || samplingRaw.first_key_row, 2),
      brand_row: asInt(productRaw.brand_row || samplingRaw.brand_row, 3),
      model_row: asInt(productRaw.model_row || samplingRaw.model_row, 4),
      variant_row: asInt(productRaw.variant_row || samplingRaw.variant_row, 5),
      value_col_start: normalizeText(productRaw.value_col_start || samplingRaw.value_col_start || samplingRaw.value_start_column || 'C').toUpperCase(),
      value_col_end: normalizeText(productRaw.value_col_end || samplingRaw.value_col_end || '').toUpperCase(),
      sample_columns: asInt(productRaw.sample_columns || samplingRaw.sample_columns || samplingRaw.sample_count, 24)
    }
    : null;

  const enumRowsRaw = toArray(map.enum_lists).length > 0 ? toArray(map.enum_lists) : toArray(map.enum_sources);
  const enumLists = [];
  for (const row of enumRowsRaw) {
    if (!isObject(row)) {
      continue;
    }
    const rowSheet = normalizeText(row.sheet);
    const rowStart = asInt(row.row_start || row.start_row, 2);
    const rowEnd = asInt(row.row_end || row.end_row, 0);
    const normalizeMode = normalizeToken(row.normalize || 'lower_trim');
    const delimiter = normalizeText(row.delimiter || '');
    const rowHeader = asInt(row.header_row, 0);
    const pushEnumRow = (bucket, columnRef) => {
      const field = normalizeFieldKey(bucket);
      const valueColumn = normalizeText(columnRef).toUpperCase();
      if (!rowSheet || !field || !valueColumn) {
        return;
      }
      enumLists.push({
        sheet: rowSheet,
        field,
        value_column: valueColumn,
        row_start: rowStart,
        row_end: rowEnd,
        delimiter,
        normalize: normalizeMode,
        header_row: rowHeader
      });
    };
    const columns = toArray(row.columns);
    if (columns.length > 0) {
      for (const item of columns) {
        if (isObject(item)) {
          pushEnumRow(item.bucket || item.field || item.name || item.column, item.column || item.value_column);
        } else {
          const valueColumn = normalizeText(item).toUpperCase();
          pushEnumRow(valueColumn.toLowerCase(), valueColumn);
        }
      }
      continue;
    }
    const bucketMap = isObject(row.buckets) ? row.buckets : {};
    const bucketEntries = Object.entries(bucketMap);
    if (bucketEntries.length > 0) {
      for (const [bucketName, columnRef] of bucketEntries) {
        pushEnumRow(bucketName, columnRef);
      }
      continue;
    }
    pushEnumRow(row.field || row.bucket, row.value_column || row.column || 'A');
  }

  const componentRowsRaw = toArray(map.component_sheets).length > 0 ? toArray(map.component_sheets) : toArray(map.component_sources);
  const componentSheets = componentRowsRaw.map((row) => ({
    sheet: normalizeText(row.sheet),
    component_type: normalizeToken(row.component_type || row.type || guessComponentType(row.sheet)),
    name_column: normalizeText(row.name_column || row.canonical_name_column || row.canonical_column || 'A').toUpperCase(),
    alias_columns: stableSortStrings(toArray(row.alias_columns || row.alias_cols).map((entry) => normalizeText(entry).toUpperCase())),
    brand_column: normalizeText(row.brand_column || '').toUpperCase(),
    link_columns: stableSortStrings(toArray(row.link_columns || row.links_columns).map((entry) => normalizeText(entry).toUpperCase())),
    property_columns: stableSortStrings(toArray(row.property_columns || row.props_columns).map((entry) => normalizeText(entry).toUpperCase())),
    row_start: asInt(row.row_start || row.start_row, 2),
    row_end: asInt(row.row_end || row.end_row, 0)
  }));

  return {
    version: asInt(map.version, 1),
    workbook_path: normalizeText(map.workbook_path || ''),
    sheet_roles: sheetRoles.filter((row) => row.sheet),
    key_list: hasKeyList ? keyList : null,
    key_source: hasKeyList
      ? {
        sheet: keyList.sheet,
        source: keyList.source,
        range: keyList.source === 'range' ? keyList.range : `${keyList.column}${keyList.row_start}:${keyList.column}${keyList.row_end}`,
        named_range: keyList.named_range || null,
        column: keyList.column,
        row_start: keyList.row_start,
        row_end: keyList.row_end
      }
      : null,
    product_table: productTable,
    sampling: productTable
      ? {
        sheet: productTable.sheet,
        layout: productTable.layout,
        key_column: productTable.key_column,
        first_key_row: productTable.data_row_start,
        value_start_column: productTable.value_col_start,
        sample_columns: productTable.sample_columns,
        brand_row: productTable.brand_row,
        model_row: productTable.model_row,
        variant_row: productTable.variant_row
      }
      : null,
    enum_lists: enumLists.filter((row) => row.sheet),
    enum_sources: enumLists
      .filter((row) => row.sheet)
      .map((row) => ({
        sheet: row.sheet,
        bucket: row.field,
        column: row.value_column,
        header_row: asInt(row.header_row, 0) || null,
        start_row: row.row_start,
        end_row: row.row_end > 0 ? row.row_end : null,
        delimiter: row.delimiter || '',
        normalize: row.normalize
      })),
    component_sheets: componentSheets.filter((row) => row.sheet),
    component_sources: componentSheets
      .filter((row) => row.sheet)
      .map((row) => ({
        sheet: row.sheet,
        type: row.component_type,
        canonical_name_column: row.name_column,
        brand_column: row.brand_column || null,
        alias_columns: row.alias_columns,
        link_columns: row.link_columns,
        property_columns: row.property_columns,
        start_row: row.row_start,
        end_row: row.row_end > 0 ? row.row_end : null
      })),
    expectations: isObject(map.expectations) ? {
      required_fields: stableSortStrings(toArray(map.expectations.required_fields).map((field) => normalizeFieldKey(field))),
      critical_fields: stableSortStrings(toArray(map.expectations.critical_fields).map((field) => normalizeFieldKey(field))),
      expected_easy_fields: stableSortStrings(toArray(map.expectations.expected_easy_fields).map((field) => normalizeFieldKey(field))),
      expected_sometimes_fields: stableSortStrings(toArray(map.expectations.expected_sometimes_fields).map((field) => normalizeFieldKey(field))),
      deep_fields: stableSortStrings(toArray(map.expectations.deep_fields).map((field) => normalizeFieldKey(field)))
    } : {
      required_fields: [],
      critical_fields: [],
      expected_easy_fields: [],
      expected_sometimes_fields: [],
      deep_fields: []
    },
    selected_keys: stableSortStrings(toArray(map.selected_keys).map((field) => normalizeFieldKey(field))),
    version_note: normalizeText(map.version_note || ''),
    field_overrides: isObject(map.field_overrides) ? map.field_overrides : {},
    ui_defaults: isObject(map.ui_defaults) ? map.ui_defaults : {},
    identity: isObject(map.identity) ? {
      min_identifiers: asInt(map.identity.min_identifiers, 2),
      anti_merge_rules: toArray(map.identity.anti_merge_rules)
    } : {
      min_identifiers: 2,
      anti_merge_rules: []
    }
  };
}

function isEmptyArrayValue(value) {
  return !Array.isArray(value) || value.length === 0;
}

function isEmptyExpectations(expectations = {}) {
  if (!isObject(expectations)) {
    return true;
  }
  return isEmptyArrayValue(expectations.required_fields)
    && isEmptyArrayValue(expectations.critical_fields)
    && isEmptyArrayValue(expectations.expected_easy_fields)
    && isEmptyArrayValue(expectations.expected_sometimes_fields)
    && isEmptyArrayValue(expectations.deep_fields);
}

function mergeWorkbookMapDefaults(baseMap = {}, suggestedMap = {}) {
  const base = normalizeWorkbookMap(baseMap);
  const suggested = normalizeWorkbookMap(suggestedMap);
  const merged = {
    ...base
  };

  if (!normalizeText(merged.workbook_path) && normalizeText(suggested.workbook_path)) {
    merged.workbook_path = suggested.workbook_path;
  }
  if (!merged.key_list && suggested.key_list) {
    merged.key_list = suggested.key_list;
    merged.key_source = suggested.key_source;
  }
  if (!merged.product_table && suggested.product_table) {
    merged.product_table = suggested.product_table;
    merged.sampling = suggested.sampling;
  }
  if (isEmptyArrayValue(merged.enum_lists) && !isEmptyArrayValue(suggested.enum_lists)) {
    merged.enum_lists = suggested.enum_lists;
    merged.enum_sources = suggested.enum_sources;
  }
  if (isEmptyArrayValue(merged.component_sheets) && !isEmptyArrayValue(suggested.component_sheets)) {
    merged.component_sheets = suggested.component_sheets;
    merged.component_sources = suggested.component_sources;
  }
  if (isEmptyArrayValue(merged.selected_keys) && !isEmptyArrayValue(suggested.selected_keys)) {
    merged.selected_keys = suggested.selected_keys;
  }
  if (isEmptyExpectations(merged.expectations) && !isEmptyExpectations(suggested.expectations)) {
    merged.expectations = suggested.expectations;
  }

  return normalizeWorkbookMap(merged);
}

export function validateWorkbookMap(map = {}, options = {}) {
  const normalized = normalizeWorkbookMap(map);
  const errors = [];
  const warnings = [];
  const sheetNames = new Set(toArray(options.sheetNames).map((name) => normalizeText(name)));
  const checkSheet = (sheet, label) => {
    if (!sheet) {
      return;
    }
    if (sheetNames.size > 0 && !sheetNames.has(sheet)) {
      errors.push(`${label}: unknown sheet '${sheet}'`);
    }
  };

  if (!normalized.key_list || !normalized.key_list.sheet) {
    errors.push('key_list: sheet is required');
  } else {
    checkSheet(normalized.key_list.sheet, 'key_list');
    const keySource = normalized.key_list.source === 'table_column'
      ? 'column_range'
      : normalized.key_list.source;
    normalized.key_list.source = keySource;
    if (!['column_range', 'range', 'named_range'].includes(keySource)) {
      errors.push(`key_list: unsupported source '${normalized.key_list.source}'`);
    }
    if (keySource === 'range' && !parseRange(normalized.key_list.range)) {
      errors.push('key_list: invalid A1 range');
    }
    if (keySource === 'named_range' && !normalizeText(normalized.key_list.named_range)) {
      errors.push('key_list: named_range is required when source=named_range');
    }
    if (keySource === 'column_range') {
      if (!colToIndex(normalized.key_list.column)) {
        errors.push('key_list: invalid column for column_range');
      }
      if (normalized.key_list.row_start <= 0 || normalized.key_list.row_end < normalized.key_list.row_start) {
        errors.push('key_list: invalid row_start/row_end for column_range');
      }
    }
  }

  if (normalized.product_table && normalized.product_table.sheet) {
    checkSheet(normalized.product_table.sheet, 'product_table');
    if (!['matrix', 'rows'].includes(normalized.product_table.layout)) {
      errors.push(`product_table: unsupported layout '${normalized.product_table.layout}'`);
    }
    if (normalized.product_table.layout === 'matrix' && !colToIndex(normalized.product_table.value_col_start)) {
      errors.push('product_table: value_col_start is required for matrix layout');
    }
  }

  const seenRoles = new Set();
  for (const row of normalized.sheet_roles) {
    checkSheet(row.sheet, 'sheet_roles');
    if (!['product_table', 'field_key_list', 'enum_list', 'component_db', 'notes', 'ignore'].includes(row.role)) {
      errors.push(`sheet_roles: invalid role '${row.role}' for sheet '${row.sheet}'`);
    }
    const key = `${row.sheet}::${row.role}`;
    if (seenRoles.has(key)) {
      warnings.push(`sheet_roles: duplicate role assignment '${row.role}' for '${row.sheet}'`);
    }
    seenRoles.add(key);
  }

  for (const row of normalized.enum_lists) {
    checkSheet(row.sheet, 'enum_lists');
    if (!row.field) {
      errors.push(`enum_lists: field is required for sheet '${row.sheet}'`);
    }
    if (!colToIndex(row.value_column)) {
      errors.push(`enum_lists: invalid value_column '${row.value_column}' for sheet '${row.sheet}'`);
    }
    if (row.row_start <= 0) {
      errors.push(`enum_lists: row_start must be > 0 for sheet '${row.sheet}'`);
    }
  }

  for (const row of normalized.component_sheets) {
    checkSheet(row.sheet, 'component_sheets');
    if (!row.component_type) {
      errors.push(`component_sheets: component_type is required for sheet '${row.sheet}'`);
    }
    if (!colToIndex(row.name_column)) {
      errors.push(`component_sheets: invalid name_column '${row.name_column}' for sheet '${row.sheet}'`);
    }
    if (row.row_start <= 0) {
      errors.push(`component_sheets: row_start must be > 0 for sheet '${row.sheet}'`);
    }
  }

  if (toArray(normalized.selected_keys).length > 0) {
    const invalid = toArray(normalized.selected_keys).filter((field) => !normalizeFieldKey(field));
    if (invalid.length > 0) {
      errors.push('selected_keys: contains invalid field keys');
    }
  } else {
    warnings.push('selected_keys: empty (compiler will include all extracted keys)');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    normalized
  };
}

function sheetByName(workbook, sheetName) {
  return workbook?.sheetMap?.get(String(sheetName || '')) || null;
}

function pullKeyRowsFromMap(workbook, map) {
  const keyList = map.key_list || {};
  let sheet = sheetByName(workbook, keyList.sheet);
  if (!sheet) {
    // continue for named ranges where sheet can be resolved from range metadata
    if (keyList.source !== 'named_range') {
      return [];
    }
  }
  const out = [];
  const pushKey = (rowIndex, labelValue) => {
    const label = normalizeText(labelValue);
    const key = normalizeFieldKey(label);
    if (!label || !key) {
      return;
    }
    out.push({
      row: rowIndex,
      label,
      key
    });
  };

  if (keyList.source === 'named_range') {
    const namedRanges = isObject(workbook?.namedRanges) ? workbook.namedRanges : {};
    const requestedName = normalizeText(keyList.named_range || '');
    let named = null;
    if (requestedName) {
      for (const [name, entry] of Object.entries(namedRanges)) {
        if (name.localeCompare(requestedName, undefined, { sensitivity: 'accent' }) === 0) {
          named = entry;
          break;
        }
      }
    }
    if (!named || !named.sheet || !named.startColumn || !named.endColumn || !named.startRow || !named.endRow) {
      return out;
    }
    sheet = sheetByName(workbook, named.sheet);
    if (!sheet) {
      return out;
    }
    const startCol = colToIndex(named.startColumn);
    const endCol = colToIndex(named.endColumn);
    const colIndex = startCol && endCol ? Math.min(startCol, endCol) : startCol;
    const colLabel = indexToCol(colIndex || 1);
    const rowStart = Math.min(asInt(named.startRow, 1), asInt(named.endRow, 1));
    const rowEnd = Math.max(asInt(named.startRow, 1), asInt(named.endRow, 1));
    for (let row = rowStart; row <= rowEnd; row += 1) {
      pushKey(row, getCell(sheet, colLabel, row));
    }
  } else if (keyList.source === 'range') {
    const range = parseRange(keyList.range);
    if (!range) {
      return out;
    }
    const startCol = colToIndex(range.startColumn);
    const endCol = colToIndex(range.endColumn);
    const colIndex = startCol && endCol ? Math.min(startCol, endCol) : startCol;
    const colLabel = indexToCol(colIndex || 1);
    for (let row = range.startRow; row <= range.endRow; row += 1) {
      pushKey(row, getCell(sheet, colLabel, row));
    }
  } else {
    const column = keyList.column || 'A';
    const rowStart = keyList.row_start || 1;
    const rowEnd = keyList.row_end || Math.max(rowStart, sheet.maxRow);
    for (let row = rowStart; row <= rowEnd; row += 1) {
      pushKey(row, getCell(sheet, column, row));
    }
  }

  const seen = new Set();
  const unique = [];
  for (const row of out) {
    if (seen.has(row.key)) {
      continue;
    }
    seen.add(row.key);
    unique.push(row);
  }
  return unique;
}

function pullMatrixSamples(workbook, map, keyRows) {
  const productTable = map.product_table || {};
  const sheet = sheetByName(workbook, productTable.sheet);
  if (!sheet) {
    return {
      byField: {},
      columns: []
    };
  }
  const startCol = colToIndex(productTable.value_col_start || 'C') || 3;
  const endColRaw = colToIndex(productTable.value_col_end || '') || sheet.maxCol;
  const sampleColumns = Math.max(1, asInt(productTable.sample_columns, 24));
  const endCol = Math.min(Math.max(startCol, endColRaw), startCol + sampleColumns - 1);

  const byField = {};
  const productColumns = [];
  for (let col = startCol; col <= endCol; col += 1) {
    const column = indexToCol(col);
    const brand = getCell(sheet, column, productTable.brand_row || 3);
    const model = getCell(sheet, column, productTable.model_row || 4);
    const variant = getCell(sheet, column, productTable.variant_row || 5);
    if (!brand && !model) {
      continue;
    }
    productColumns.push({
      column,
      brand,
      model,
      variant
    });
    for (const keyRow of keyRows) {
      const value = getCell(sheet, column, keyRow.row);
      if (!value) {
        continue;
      }
      if (!byField[keyRow.key]) {
        byField[keyRow.key] = [];
      }
      byField[keyRow.key].push(value);
    }
  }
  return {
    byField,
    columns: productColumns
  };
}

function pullRowTableSamples(workbook, map, keyRows) {
  const productTable = map.product_table || {};
  const sheet = sheetByName(workbook, productTable.sheet);
  if (!sheet) {
    return {
      byField: {},
      columns: []
    };
  }
  const headerRow = productTable.header_row || 1;
  const dataRowStart = productTable.data_row_start || (headerRow + 1);
  const headerByCol = {};
  const colLimit = Math.max(1, sheet.maxCol);
  for (let col = 1; col <= colLimit; col += 1) {
    const colLabel = indexToCol(col);
    const header = normalizeText(getCell(sheet, colLabel, headerRow));
    if (header) {
      headerByCol[colLabel] = normalizeFieldKey(header);
    }
  }
  const keySet = new Set(keyRows.map((row) => row.key));
  const byField = {};
  for (let row = dataRowStart; row <= sheet.maxRow; row += 1) {
    let anyValue = false;
    for (const [column, headerKey] of Object.entries(headerByCol)) {
      if (!keySet.has(headerKey)) {
        continue;
      }
      const value = getCell(sheet, column, row);
      if (!value) {
        continue;
      }
      anyValue = true;
      if (!byField[headerKey]) {
        byField[headerKey] = [];
      }
      byField[headerKey].push(value);
    }
    if (!anyValue && row > (dataRowStart + 2000)) {
      break;
    }
  }
  return {
    byField,
    columns: []
  };
}

function normalizeEnumValue(value, mode = 'lower_trim') {
  const text = normalizeText(value);
  if (!text) {
    return '';
  }
  if (mode === 'raw') {
    return text;
  }
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function pullEnumLists(workbook, map) {
  const out = {};
  for (const row of toArray(map.enum_lists)) {
    const sheet = sheetByName(workbook, row.sheet);
    if (!sheet || !row.field) {
      continue;
    }
    const valueSet = new Set();
    const rowStart = row.row_start || 2;
    const rowEnd = row.row_end > 0 ? row.row_end : sheet.maxRow;
    for (let idx = rowStart; idx <= rowEnd; idx += 1) {
      const value = getCell(sheet, row.value_column || 'A', idx);
      if (!value) {
        continue;
      }
      const tokens = row.delimiter
        ? value.split(row.delimiter).map((item) => normalizeEnumValue(item, row.normalize))
        : [normalizeEnumValue(value, row.normalize)];
      for (const token of tokens) {
        if (token) {
          valueSet.add(token);
        }
      }
    }
    out[row.field] = stableSortStrings([...valueSet]);
  }
  return out;
}

function pullComponentDbs(workbook, map) {
  const out = {};
  for (const row of toArray(map.component_sheets)) {
    const sheet = sheetByName(workbook, row.sheet);
    if (!sheet) {
      continue;
    }
    const componentType = row.component_type || 'component';
    if (!out[componentType]) {
      out[componentType] = [];
    }
    const rowStart = row.row_start || 2;
    const rowEnd = row.row_end > 0 ? row.row_end : sheet.maxRow;
    for (let idx = rowStart; idx <= rowEnd; idx += 1) {
      const name = normalizeText(getCell(sheet, row.name_column || 'A', idx));
      if (!name) {
        continue;
      }
      const aliases = stableSortStrings(
        toArray(row.alias_columns).map((col) => getCell(sheet, col, idx))
      ).filter((alias) => alias.toLowerCase() !== name.toLowerCase());
      const brand = row.brand_column ? normalizeText(getCell(sheet, row.brand_column, idx)) : '';
      const links = stableSortStrings(
        toArray(row.link_columns).map((col) => normalizeText(getCell(sheet, col, idx)))
      ).filter((value) => /^https?:\/\//i.test(value));
      const properties = {};
      for (const col of toArray(row.property_columns)) {
        const key = normalizeFieldKey(col);
        const value = normalizeText(getCell(sheet, col, idx));
        if (key && value) {
          properties[key] = value;
        }
      }
      out[componentType].push({
        name,
        aliases,
        brand,
        links,
        properties
      });
    }
    out[componentType] = out[componentType]
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return out;
}

function inferUnitByField(key) {
  const token = normalizeFieldKey(key);
  if (token === 'weight' || token.endsWith('_weight')) return 'g';
  if (token === 'dpi' || token.endsWith('_dpi') || token.endsWith('_cpi')) return 'dpi';
  if (token.includes('polling') || token === 'hz' || token.endsWith('_hz')) return 'hz';
  if (token === 'lngth' || token === 'length' || token === 'width' || token === 'height' || token.endsWith('_length') || token.endsWith('_width') || token.endsWith('_height')) return 'mm';
  if (token.includes('price')) return 'usd';
  if (token.includes('battery') && token.includes('hour')) return 'hours';
  return '';
}

function inferParseTemplate({ key, type, shape, enumValues = [], componentType = '' }) {
  const token = normalizeFieldKey(key);
  if (componentType) {
    return 'component_reference';
  }
  if (type === 'boolean') {
    return 'boolean_yes_no_unknown';
  }
  if (shape === 'range') {
    return 'range_number';
  }
  if (shape === 'list' && type === 'number') {
    return 'list_of_numbers_with_unit';
  }
  if (shape === 'list' && type === 'string') {
    const enumSet = new Set(enumValues.map((value) => normalizeToken(value)));
    if (enumSet.has('wired') || enumSet.has('wireless') || enumSet.has('hybrid') || token.includes('connect')) {
      return 'mode_tagged_list';
    }
    return 'list_of_tokens_delimited';
  }
  if (type === 'number') {
    if (inferUnitByField(token)) {
      return 'number_with_unit';
    }
    return 'integer_with_unit';
  }
  return 'list_of_tokens_delimited';
}

function inferFromSamples(key, samples = []) {
  const normalized = toArray(samples).map((sample) => normalizeText(sample)).filter(Boolean).slice(0, 200);
  const numericCount = normalized.filter((value) => /^-?\d+(\.\d+)?$/.test(value)).length;
  const boolCount = normalized.filter((value) => /^(yes|no|true|false|0|1)$/i.test(value)).length;
  const rangeCount = normalized.filter((value) => /\d+\s*[-to]{1,3}\s*\d+/i.test(value)).length;
  const listCount = normalized.filter((value) => /[,/|;+]/.test(value)).length;

  const ratio = (count) => (normalized.length ? count / normalized.length : 0);
  const numericRatio = ratio(numericCount);
  const boolRatio = ratio(boolCount);
  const rangeRatio = ratio(rangeCount);
  const listRatio = ratio(listCount);

  let type = 'string';
  let shape = 'scalar';
  if (boolRatio >= 0.75) {
    type = 'boolean';
  } else if (rangeRatio >= 0.4) {
    type = 'number';
    shape = 'range';
  } else if (numericRatio >= 0.75) {
    type = 'number';
  } else if (listRatio >= 0.6) {
    type = 'string';
    shape = 'list';
  }

  const keyToken = normalizeFieldKey(key);
  if (keyToken.endsWith('_link') || keyToken.endsWith('_url')) {
    type = 'string';
    shape = 'scalar';
  }
  if (keyToken.includes('date')) {
    type = 'date';
    shape = 'scalar';
  }
  if (keyToken === 'colors' || keyToken.includes('color')) {
    type = 'string';
    shape = 'list';
  }
  if (keyToken === 'polling_rate') {
    type = 'number';
    shape = 'list';
  }
  if (keyToken === 'dpi') {
    type = 'number';
    shape = numericRatio >= 0.8 ? 'scalar' : 'list';
  }
  if (keyToken === 'connection' || keyToken.includes('connect')) {
    type = 'string';
    shape = 'list';
  }

  return {
    type,
    shape
  };
}

function inferGroup(key) {
  const token = normalizeFieldKey(key);
  if (token.includes('sensor') || token.includes('dpi') || token.includes('polling') || token.includes('acceleration')) return 'performance';
  if (token.includes('weight') || token.includes('length') || token.includes('lngth') || token.includes('width') || token.includes('height') || token.includes('size')) return 'dimensions';
  if (token.includes('connection') || token.includes('wireless') || token.includes('bluetooth')) return 'connectivity';
  if (token.includes('button') || token.includes('switch')) return 'controls';
  if (token.includes('battery') || token.includes('charge')) return 'power';
  if (token.includes('color') || token.includes('rgb')) return 'appearance';
  return 'general';
}

function inferDifficulty({ type, shape, key }) {
  const token = normalizeFieldKey(key);
  if (INSTRUMENTED_HARD_FIELDS.has(token)) {
    return 'hard';
  }
  if (token.includes('edition') || token.includes('variant')) {
    return 'hard';
  }
  if (shape === 'range' || shape === 'object') {
    return 'hard';
  }
  if (shape === 'list' || type === 'date') {
    return 'medium';
  }
  return 'easy';
}

function effortFromDifficulty(difficulty) {
  if (difficulty === 'easy') return 3;
  if (difficulty === 'medium') return 6;
  return 9;
}

function inferRequiredLevel(key, expectations) {
  const token = normalizeFieldKey(key);
  if (expectations.required_fields.includes(token)) return 'required';
  if (expectations.critical_fields.includes(token)) return 'critical';
  if (expectations.expected_easy_fields.includes(token)) return 'expected';
  if (expectations.expected_sometimes_fields.includes(token)) return 'expected';
  if (expectations.deep_fields.includes(token)) return 'rare';
  if (DEFAULT_REQUIRED_FIELDS.has(token)) return 'required';
  if (INSTRUMENTED_HARD_FIELDS.has(token)) return 'optional';
  return 'expected';
}

function inferAvailability(key, expectations) {
  const token = normalizeFieldKey(key);
  if (expectations.expected_easy_fields.includes(token)) return 'expected';
  if (expectations.deep_fields.includes(token)) return 'rare';
  if (DEFAULT_REQUIRED_FIELDS.has(token)) return 'expected';
  if (INSTRUMENTED_HARD_FIELDS.has(token)) return 'sometimes';
  return 'sometimes';
}

function normalizeValueForm(value, shape = 'scalar') {
  const token = normalizeToken(value);
  const normalizedShape = normalizeToken(shape || 'scalar');
  if (token === 'single' || token === 'scalar') {
    return normalizedShape === 'list' ? 'set' : 'single';
  }
  if (token === 'set' || token === 'list') {
    return normalizedShape === 'scalar' ? 'single' : 'set';
  }
  if (token === 'range') {
    return (normalizedShape === 'list') ? 'mixed' : 'range';
  }
  if (token === 'mixed' || token === 'mixed_values_and_ranges' || token === 'list_ranges') {
    return normalizedShape === 'scalar' ? 'single' : 'mixed';
  }
  if (normalizedShape === 'list') return 'set';
  if (normalizedShape === 'range' || normalizedShape === 'object') return 'range';
  return 'single';
}

function parseEnumSource(sourceRaw, fallbackField = '') {
  if (isObject(sourceRaw)) {
    const sourceType = normalizeToken(sourceRaw.type);
    const sourceRef = normalizeText(sourceRaw.ref || fallbackField);
    if (sourceType && sourceRef) {
      return {
        type: sourceType,
        ref: sourceRef
      };
    }
    return null;
  }
  const sourceText = normalizeText(sourceRaw);
  if (!sourceText) {
    return null;
  }
  const dotIndex = sourceText.indexOf('.');
  if (dotIndex > 0) {
    const sourceType = normalizeToken(sourceText.slice(0, dotIndex));
    const sourceRef = normalizeText(sourceText.slice(dotIndex + 1));
    if (sourceType && sourceRef) {
      return {
        type: sourceType,
        ref: sourceRef
      };
    }
  }
  return null;
}

function sourceRefToString(source = null) {
  if (!isObject(source)) {
    return null;
  }
  const sourceType = normalizeToken(source.type);
  const sourceRef = normalizeText(source.ref);
  if (!sourceType || !sourceRef) {
    return null;
  }
  return `${sourceType}.${sourceRef}`;
}

function roundTokenToContract(roundToken = '') {
  const token = normalizeToken(roundToken);
  if (token === 'int') {
    return {
      decimals: 0,
      mode: 'nearest'
    };
  }
  if (token === '1dp') {
    return {
      decimals: 1,
      mode: 'nearest'
    };
  }
  if (token === '2dp') {
    return {
      decimals: 2,
      mode: 'nearest'
    };
  }
  return null;
}

function sampleValueFormFromInternal(valueForm = '', shape = 'scalar') {
  const token = normalizeValueForm(valueForm, shape);
  if (token === 'single') return 'scalar';
  if (token === 'set') return 'list';
  if (token === 'range') return 'range';
  return 'mixed_values_and_ranges';
}

function buildSearchHints({
  key = '',
  requiredLevel = 'optional',
  availability = 'sometimes',
  difficulty = 'medium',
  parseTemplate = '',
  enumSource = null
} = {}) {
  const hints = {
    priority_weight: requiredLevel === 'identity'
      ? 1
      : (requiredLevel === 'required' ? 0.95 : (requiredLevel === 'critical' ? 0.9 : 0.75)),
    availability_bias: availability,
    difficulty_bias: difficulty
  };
  if (normalizeText(parseTemplate)) {
    hints.parse_template = normalizeToken(parseTemplate);
  }
  if (isObject(enumSource) && normalizeText(enumSource.type) && normalizeText(enumSource.ref)) {
    hints.enum_source = {
      type: normalizeToken(enumSource.type),
      ref: normalizeText(enumSource.ref)
    };
  }
  if (key.includes('link') || key.endsWith('_url')) {
    hints.query_bias = ['manual', 'datasheet', 'spec'];
  } else if (key.includes('sensor') || key.includes('switch') || key.includes('encoder')) {
    hints.query_bias = ['component', 'spec', 'pdf'];
  } else {
    hints.query_bias = ['spec', 'manual'];
  }
  return hints;
}

function buildWorkbookTabsSummary({
  workbook,
  map
} = {}) {
  const summary = {};
  const rolesBySheet = new Map();
  for (const row of toArray(map?.sheet_roles)) {
    if (!isObject(row)) {
      continue;
    }
    const sheetName = normalizeText(row.sheet);
    const role = normalizeToken(row.role || 'ignore');
    if (!sheetName) {
      continue;
    }
    rolesBySheet.set(sheetName, role || 'ignore');
  }
  for (const sheet of toArray(workbook?.sheets)) {
    const sheetName = normalizeText(sheet?.name);
    if (!sheetName) {
      continue;
    }
    const role = rolesBySheet.get(sheetName) || 'ignore';
    summary[sheetName] = {
      role,
      notes: role === 'field_key_list'
        ? 'Primary key list source for field contract generation.'
        : role === 'product_table'
          ? 'Product sampling source used for parse/template inference.'
          : role === 'enum_list'
            ? 'Known values source used for enum buckets.'
            : role === 'component_db'
              ? 'Component entity source used for component bindings.'
              : role === 'notes'
                ? 'Optional guidance/docs source.'
                : 'Not currently used by compile mapping.'
    };
  }
  return sortDeep(summary);
}

function buildEnumBucketSummary({
  map,
  enumLists
} = {}) {
  const out = {};
  for (const row of toArray(map?.enum_lists)) {
    if (!isObject(row)) {
      continue;
    }
    const bucket = normalizeFieldKey(row.field || row.bucket || '');
    if (!bucket) {
      continue;
    }
    out[bucket] = {
      excel: {
        sheet: normalizeText(row.sheet),
        column: normalizeText(row.value_column || row.column || ''),
        header_row: asInt(row.header_row, null),
        start_row: asInt(row.row_start, null)
      },
      values: stableSortStrings(toArray(enumLists?.[bucket]))
    };
  }
  for (const [bucket, values] of Object.entries(enumLists || {})) {
    const normalizedBucket = normalizeFieldKey(bucket);
    if (!normalizedBucket || out[normalizedBucket]) {
      continue;
    }
    out[normalizedBucket] = {
      excel: {
        sheet: '',
        column: '',
        header_row: null,
        start_row: null
      },
      values: stableSortStrings(toArray(values))
    };
  }
  return sortDeep(out);
}

function buildComponentSourceSummary({
  map,
  componentDb
} = {}) {
  const out = {};
  for (const row of toArray(map?.component_sheets)) {
    if (!isObject(row)) {
      continue;
    }
    const componentType = normalizeFieldKey(row.component_type || row.type || '');
    if (!componentType) {
      continue;
    }
    out[componentType] = {
      excel: {
        sheet: normalizeText(row.sheet),
        name_column: normalizeText(row.name_column || ''),
        alias_columns: stableSortStrings(toArray(row.alias_columns || [])),
        brand_column: normalizeText(row.brand_column || ''),
        link_columns: stableSortStrings(toArray(row.link_columns || [])),
        property_columns: stableSortStrings(toArray(row.property_columns || [])),
        start_row: asInt(row.row_start, null)
      },
      entity_count: toArray(componentDb?.[componentType]).length
    };
  }
  return sortDeep(out);
}

function buildGlobalContractMetadata() {
  return {
    unknown_reasons: [
      'not_found_after_search',
      'not_publicly_disclosed',
      'blocked_by_robots_or_tos',
      'conflicting_sources_unresolved',
      'identity_ambiguous',
      'parse_failure',
      'budget_exhausted'
    ],
    required_levels: ['identity', 'required', 'critical', 'expected', 'optional', 'rare'],
    availability_levels: ['expected', 'sometimes', 'rare'],
    difficulty_levels: ['easy', 'medium', 'hard'],
    enum_policies: ['closed', 'open_prefer_known', 'open', 'closed_with_curation'],
    conflict_policies: ['resolve_by_tier_else_unknown'],
    tier_order: ['tier1', 'tier2', 'tier3']
  };
}

function buildParseTemplateCatalog() {
  return {
    boolean_yes_no_unk: {
      description: 'Parse yes/no/true/false variants into boolean, else unk.',
      tests: [
        { raw: 'Yes', expected: true },
        { raw: 'No', expected: false },
        { raw: 'unk', expected: 'unk' }
      ]
    },
    number_with_unit: {
      description: 'Parse scalar numeric value with unit normalization.',
      tests: [
        { raw: '80 g', expected: 80 },
        { raw: '4.5 in', expected: 114.3 }
      ]
    },
    integer_with_unit: {
      description: 'Parse integer numeric value with unit normalization.',
      tests: [
        { raw: '1000 hz', expected: 1000 }
      ]
    },
    list_of_tokens_delimited: {
      description: 'Parse token list separated by known delimiters.',
      tests: [
        { raw: 'wired, wireless', expected: ['wired', 'wireless'] }
      ]
    },
    list_numbers_or_ranges_with_unit: {
      description: 'Parse mixed numeric sets and ranges with optional unit conversion.',
      tests: [
        { raw: '1-3, 4', expected: [{ min: 1, max: 3 }, { min: 4, max: 4 }] }
      ]
    },
    latency_list_modes_ms: {
      description: 'Parse mixed latency measurements into structured list entries {mode, ms}.',
      tests: [
        { raw: '14 wireless, 16 wired', expected: [{ mode: 'wireless', ms: 14 }, { mode: 'wired', ms: 16 }] }
      ]
    },
    list_of_numbers_with_unit: {
      description: 'Parse list of numeric values sharing one unit.',
      tests: [
        { raw: '8000, 4000, 1000 hz', expected: [8000, 4000, 1000] }
      ]
    },
    mode_tagged_values: {
      description: 'Parse enumerated mode/value combinations.',
      tests: [
        { raw: 'wired/wireless', expected: ['wired', 'wireless'] }
      ]
    },
    mode_tagged_list: {
      description: 'Parse enumerated mode/value combinations.',
      tests: [
        { raw: 'wired/wireless', expected: ['wired', 'wireless'] }
      ]
    },
    url_field: {
      description: 'Parse and validate URL-like values.',
      tests: [
        { raw: 'https://example.com/spec.pdf', expected: 'https://example.com/spec.pdf' }
      ]
    },
    date_field: {
      description: 'Parse date strings into normalized precision-aware format.',
      tests: [
        { raw: '2024-06', expected: '2024-06' }
      ]
    },
    component_reference: {
      description: 'Resolve component names against component DB aliases/canonical names.',
      tests: [
        { raw: 'PAW3395', expected: 'PAW3395' }
      ]
    }
  };
}

function flattenSampleStyleOverride(overrideRaw = {}, baseRule = {}) {
  if (!isObject(overrideRaw)) {
    return {};
  }
  const hasNestedShape = (
    isObject(overrideRaw.priority)
    || isObject(overrideRaw.contract)
    || isObject(overrideRaw.parse)
    || isObject(overrideRaw.enum)
    || isObject(overrideRaw.component)
  );
  if (!hasNestedShape) {
    return { ...overrideRaw };
  }
  const out = { ...overrideRaw };
  const priority = isObject(overrideRaw.priority) ? overrideRaw.priority : {};
  const contract = isObject(overrideRaw.contract) ? overrideRaw.contract : {};
  const parse = isObject(overrideRaw.parse) ? overrideRaw.parse : {};
  const enumObj = isObject(overrideRaw.enum) ? overrideRaw.enum : {};
  const evidence = isObject(overrideRaw.evidence) ? overrideRaw.evidence : {};
  const component = isObject(overrideRaw.component) ? overrideRaw.component : {};

  if (!normalizeText(out.required_level) && normalizeText(priority.required_level)) {
    out.required_level = normalizeToken(priority.required_level);
  }
  if (!normalizeText(out.availability) && normalizeText(priority.availability)) {
    out.availability = normalizeToken(priority.availability);
  }
  if (!normalizeText(out.difficulty) && normalizeText(priority.difficulty)) {
    out.difficulty = normalizeToken(priority.difficulty);
  }
  if (out.effort === undefined && priority.effort !== undefined) {
    out.effort = asInt(priority.effort, asInt(baseRule.effort, 5));
  }
  if (out.publish_gate === undefined && priority.publish_gate !== undefined) {
    out.publish_gate = priority.publish_gate === true;
  }
  if (out.block_publish_when_unk === undefined && priority.block_publish_when_unk !== undefined) {
    out.block_publish_when_unk = priority.block_publish_when_unk === true;
  }

  const contractType = normalizeToken(contract.type);
  if (!normalizeText(out.type) && contractType) {
    out.type = contractType;
  }
  const contractShape = normalizeToken(contract.shape);
  if (!normalizeText(out.shape) && contractShape) {
    out.shape = contractShape;
  }
  const contractUnit = normalizeText(contract.unit);
  if (!normalizeText(out.unit) && contractUnit) {
    out.unit = contractUnit;
  }
  if (!normalizeText(out.round) && isObject(contract.rounding)) {
    const decimals = asInt(contract.rounding.decimals, null);
    if (decimals === 0) out.round = 'int';
    else if (decimals === 1) out.round = '1dp';
    else if (decimals === 2) out.round = '2dp';
    else out.round = 'none';
  }
  if (!isObject(out.validate) && isObject(contract.range)) {
    const min = asNumber(contract.range.min);
    const max = asNumber(contract.range.max);
    if (min !== null || max !== null) {
      out.validate = {
        kind: 'number_range',
        ...(min !== null ? { min } : {}),
        ...(max !== null ? { max } : {})
      };
    }
  }
  if (!isObject(out.list_rules) && isObject(contract.list_rules)) {
    out.list_rules = { ...contract.list_rules };
  }
  if (!isObject(out.object_schema) && isObject(contract.object_schema)) {
    out.object_schema = { ...contract.object_schema };
  }

  if (!normalizeText(out.parse_template) && normalizeText(parse.template)) {
    out.parse_template = normalizeToken(parse.template);
  }
  if (!isObject(out.parse_rules)) {
    out.parse_rules = {};
  }
  if (normalizeText(parse.unit) && !normalizeText(out.parse_rules.unit)) {
    out.parse_rules.unit = normalizeText(parse.unit);
  }
  if (Array.isArray(parse.unit_accepts) && parse.unit_accepts.length > 0) {
    out.parse_rules.unit_accepts = orderedUniqueStrings(parse.unit_accepts);
  }
  if (isObject(parse.unit_conversions)) {
    out.parse_rules.unit_conversions = { ...parse.unit_conversions };
  }
  if (Array.isArray(parse.delimiters) && parse.delimiters.length > 0) {
    out.parse_rules.delimiters = orderedUniqueStrings(parse.delimiters);
  }
  if (Array.isArray(parse.range_separators) && parse.range_separators.length > 0) {
    out.parse_rules.separators = orderedUniqueStrings(parse.range_separators);
  }
  if (parse.strict_unit_required !== undefined && out.strict_unit_required === undefined) {
    out.strict_unit_required = parse.strict_unit_required === true;
  }
  if (normalizeText(parse.component_type)) {
    out.parse_rules.component_type = normalizeFieldKey(parse.component_type);
  }
  for (const [parseKey, parseValue] of Object.entries(parse)) {
    if (['template', 'unit', 'strict_unit_required', 'unit_accepts', 'unit_conversions', 'delimiters', 'range_separators', 'component_type'].includes(parseKey)) {
      continue;
    }
    if (parseValue !== undefined) {
      out.parse_rules[parseKey] = parseValue;
    }
  }

  if (!normalizeText(out.enum_policy) && normalizeText(enumObj.policy)) {
    out.enum_policy = normalizeToken(enumObj.policy);
  }
  const enumSource = parseEnumSource(enumObj.source, normalizeFieldKey(out.key || ''));
  if (!isObject(out.enum_source) && enumSource) {
    out.enum_source = enumSource;
  }
  if (!isObject(out.new_value_policy) && isObject(enumObj.new_value_policy)) {
    out.new_value_policy = { ...enumObj.new_value_policy };
  }
  if (!isObject(out.vocab)) {
    out.vocab = {};
  }
  if (!normalizeText(out.vocab.mode) && normalizeText(out.enum_policy)) {
    out.vocab.mode = normalizeToken(out.enum_policy);
  }
  if (out.vocab.allow_new === undefined) {
    out.vocab.allow_new = !['closed', 'closed_with_curation'].includes(normalizeToken(out.enum_policy));
  }

  if (component && !isObject(out.enum_source)) {
    const componentSource = parseEnumSource(component.source || `component_db.${component.type || ''}`);
    if (componentSource) {
      out.enum_source = componentSource;
    }
  }
  if (component && !normalizeText(out.parse_template) && normalizeText(component.type)) {
    out.parse_template = 'component_reference';
  }
  if (component && out.strict_unit_required === undefined && component.require_identity_evidence !== undefined) {
    out.require_component_identity_evidence = component.require_identity_evidence === true;
  }

  if (evidence.required !== undefined && out.evidence_required === undefined) {
    out.evidence_required = evidence.required !== false;
  }
  if (evidence.min_evidence_refs !== undefined && out.min_evidence_refs === undefined) {
    out.min_evidence_refs = asInt(evidence.min_evidence_refs, 1);
  }
  if (!isObject(out.evidence) && isObject(evidence)) {
    out.evidence = { ...evidence };
  }

  const valueFormSource = normalizeText(overrideRaw.value_form);
  const resolvedShape = normalizeToken(out.shape || baseRule.shape || 'scalar');
  const valueFormSeed = valueFormSource || out.value_form || (hasNestedShape ? '' : baseRule.value_form);
  out.value_form = normalizeValueForm(
    valueFormSeed,
    resolvedShape
  );
  return out;
}

function mergeFieldOverride(baseRule, overrideRaw = {}) {
  if (!isObject(overrideRaw)) {
    return baseRule;
  }
  const override = flattenSampleStyleOverride(overrideRaw, baseRule);
  if (Array.isArray(override.aliases)) {
    override.aliases = stableSortStrings(override.aliases);
  }
  if (isObject(override.ui)) {
    override.ui = {
      ...baseRule.ui,
      ...override.ui
    };
  }
  if (isObject(override.parse_rules)) {
    override.parse_rules = {
      ...baseRule.parse_rules,
      ...override.parse_rules
    };
  }
  if (isObject(override.vocab)) {
    override.vocab = {
      ...baseRule.vocab,
      ...override.vocab
    };
  }
  if (!normalizeText(override.value_form)) {
    override.value_form = normalizeValueForm(baseRule.value_form, normalizeToken(override.shape || baseRule.shape || 'scalar'));
  } else {
    override.value_form = normalizeValueForm(override.value_form, normalizeToken(override.shape || baseRule.shape || 'scalar'));
  }
  return {
    ...baseRule,
    ...override
  };
}

function parseRulesForTemplate(template, { unit = '', enumValues = [], componentType = '' } = {}) {
  if (template === 'boolean_yes_no_unknown') {
    return {
      truthy: ['yes', 'true', '1'],
      falsy: ['no', 'false', '0'],
      unknown: ['unk', 'n/a', 'na', 'unknown']
    };
  }
  if (template === 'number_with_unit' || template === 'integer_with_unit') {
    return {
      unit: unit || '',
      allow_unitless: true
    };
  }
  if (template === 'list_of_tokens_delimited') {
    return {
      delimiters: [',', '/', '|', ';']
    };
  }
  if (template === 'list_of_numbers_with_unit') {
    return {
      delimiters: [',', '/', '|', ';'],
      unit: unit || ''
    };
  }
  if (template === 'latency_list_modes_ms') {
    return {
      delimiters: [',', ';', '|', '/'],
      mode_aliases: {
        wired: ['wired', 'usb', 'cable'],
        wireless: ['wireless', '2.4g', '2.4', 'dongle'],
        bluetooth: ['bluetooth', 'bt']
      },
      accept_bare_numbers_as_mode: 'unknown',
      strict_unit_required: false,
      unit_accepts: ['ms']
    };
  }
  if (template === 'list_numbers_or_ranges_with_unit') {
    return {
      delimiters: [',', '/', '|', ';'],
      separators: ['-', 'to', '–'],
      unit: unit || ''
    };
  }
  if (template === 'mode_tagged_list' || template === 'mode_tagged_values') {
    return {
      modes: stableSortStrings(enumValues.length ? enumValues : ['wired', 'wireless', 'hybrid', 'bluetooth'])
    };
  }
  if (template === 'range_number') {
    return {
      separators: ['-', 'to', '–'],
      unit: unit || ''
    };
  }
  if (template === 'url_field') {
    return {
      require_scheme: true
    };
  }
  if (template === 'date_field') {
    return {
      accepted_formats: ['YYYY-MM-DD', 'YYYY-MM', 'YYYY']
    };
  }
  if (template === 'component_reference') {
    return {
      component_type: componentType || 'component',
      exact_or_alias_match: true
    };
  }
  return {};
}

function buildFieldRuleDraft({
  key,
  label,
  samples = [],
  enumValues = [],
  componentType = '',
  tooltipEntry = null,
  expectations,
  order = 0,
  uiDefaults = {}
}) {
  const inferred = inferFromSamples(key, samples);
  const inferredUnit = inferUnitByField(key);
  const unit = inferredUnit || (inferred.type === 'number' ? 'none' : '');
  const aliases = stableSortStrings([key, label, titleFromKey(key)]);
  const requiredLevel = inferRequiredLevel(key, expectations);
  const availability = inferAvailability(key, expectations);
  const isInstrumentedField = INSTRUMENTED_HARD_FIELDS.has(normalizeFieldKey(key));
  const difficulty = inferDifficulty({
    key,
    type: inferred.type,
    shape: inferred.shape
  });
  const effort = isInstrumentedField ? 9 : effortFromDifficulty(difficulty);
  const enumPolicy = enumValues.length > 0 ? 'open_prefer_known' : 'open';
  const parseTemplate = inferParseTemplate({
    key,
    type: inferred.type,
    shape: inferred.shape,
    enumValues,
    componentType
  });
  const parseRules = parseRulesForTemplate(parseTemplate, { unit, enumValues, componentType });
  const valueForm = normalizeValueForm('', inferred.shape);

  const validate = {};
  if (inferred.type === 'number') {
    validate.kind = 'number_range';
    if (key === 'weight') {
      validate.min = 1;
      validate.max = 500;
    } else if (key === 'dpi') {
      validate.min = 50;
      validate.max = 100000;
    } else if (key === 'polling_rate') {
      validate.min = 10;
      validate.max = 10000;
    }
  }

  const ui = {
    label: label || titleFromKey(key),
    group: inferGroup(key),
    order,
    tooltip_md: normalizeText(uiDefaults.tooltip_md || tooltipEntry?.markdown || ''),
    short_label: null,
    prefix: null,
    suffix: unit && unit !== 'none' ? unit : null,
    examples: [],
    placeholder: 'unk',
    input_control: inferred.shape === 'list' ? 'list_editor' : 'text',
    tooltip_key: normalizeText(tooltipEntry?.key || '') || null,
    tooltip_source: normalizeText(tooltipEntry?.source || '') || null,
    display_mode: key === 'polling_rate' ? 'high' : 'all',
    display_decimals: inferred.type === 'number' ? 1 : 0
  };

  return {
    key,
    canonical_key: key,
    aliases,
    type: inferred.type,
    shape: inferred.shape,
    value_form: valueForm,
    unit,
    round: inferred.type === 'number' ? 'int' : 'none',
    required_level: requiredLevel,
    availability,
    difficulty,
    effort,
    enum_policy: enumPolicy,
    strict_unit_required: Boolean(unit && unit !== 'none'),
    parse_template: parseTemplate,
    parse_rules: parseRules,
    array_handling: 'none',
    new_value_policy: {
      accept_if_evidence: true,
      mark_needs_curation: true,
      suggestion_target: '_suggestions/enums.json'
    },
    vocab: {
      mode: enumPolicy,
      allow_new: enumPolicy !== 'closed',
      known_values: enumValues
    },
    evidence: {
      required: true,
      min_evidence_refs: requiredLevel === 'identity' || requiredLevel === 'required' ? 2 : 1,
      tier_preference: isInstrumentedField ? ['tier2', 'tier1', 'tier3'] : ['tier1', 'tier2', 'tier3'],
      conflict_policy: 'resolve_by_tier_else_unknown'
    },
    publish_gate: (requiredLevel === 'identity' || requiredLevel === 'required') && !isInstrumentedField,
    publish_gate_reason: requiredLevel === 'identity' ? 'missing_identity' : (requiredLevel === 'required' ? 'missing_required' : ''),
    block_publish_when_unk: (requiredLevel === 'identity' || requiredLevel === 'required') && !isInstrumentedField,
    surfaces: {
      hub_cards: false,
      xxl: false,
      filters: false,
      versus: false,
      radar: false,
      spec_table: true,
      hide_if_unk: true
    },
    ui,
    validate
  };
}

function fieldTypeForContract(rule = {}) {
  if (rule.shape === 'list') return 'list';
  if (rule.type === 'number' || rule.type === 'integer') return 'number';
  if (rule.type === 'boolean') return 'boolean';
  if (rule.type === 'date') return 'date';
  if (rule.type === 'url') return 'string';
  if (rule.type === 'object') return 'string';
  return 'string';
}

function buildStudioFieldRule({
  key,
  rule = {},
  row = {},
  map = {},
  samples = [],
  enumLists = {},
  componentDb = {}
} = {}) {
  const source = parseEnumSource(rule.enum_source, key);
  const sourceRef = sourceRefToString(source);
  const policy = normalizeToken(rule.enum_policy || 'open_prefer_known');
  const parseTemplate = normalizeToken(rule.parse_template || '');
  const contractType = normalizeToken(rule.type || 'string');
  const contractShape = normalizeToken(rule.shape || 'scalar');
  const valueForm = sampleValueFormFromInternal(rule.value_form, contractShape);
  const ui = isObject(rule.ui) ? rule.ui : {};
  const vocab = isObject(rule.vocab) ? rule.vocab : {};
  const evidence = isObject(rule.evidence) ? rule.evidence : {};
  const parseRules = isObject(rule.parse_rules) ? rule.parse_rules : {};
  const validate = isObject(rule.validate) ? rule.validate : {};

  const nestedContract = isObject(rule.contract) ? { ...rule.contract } : {};
  nestedContract.unknown_token = normalizeText(
    nestedContract.unknown_token || rule.unknown_token || 'unk'
  ) || 'unk';
  nestedContract.unknown_reason_required = nestedContract.unknown_reason_required !== false;
  nestedContract.type = normalizeToken(nestedContract.type || contractType || 'string') || 'string';
  nestedContract.shape = normalizeToken(nestedContract.shape || contractShape || 'scalar') || 'scalar';
  if (contractType === 'date') {
    nestedContract.format = 'date';
  } else if (contractType === 'url') {
    nestedContract.format = 'uri';
  }
  if (!normalizeText(nestedContract.unit) && normalizeText(rule.unit)) {
    nestedContract.unit = normalizeText(rule.unit);
  }
  const rounding = roundTokenToContract(rule.round || '') || roundTokenToContract(nestedContract.rounding || '');
  if (rounding && !isObject(nestedContract.rounding)) {
    nestedContract.rounding = rounding;
  }
  if (!isObject(nestedContract.range) && validate.kind === 'number_range') {
    const min = asNumber(validate.min);
    const max = asNumber(validate.max);
    if (min !== null || max !== null) {
      nestedContract.range = {
        ...(min !== null ? { min } : {}),
        ...(max !== null ? { max } : {})
      };
    }
  }
  if (nestedContract.shape === 'list' && !isObject(nestedContract.list_rules) && isObject(rule.list_rules)) {
    nestedContract.list_rules = {
      dedupe: rule.list_rules.dedupe !== false,
      sort: normalizeToken(rule.list_rules.sort || 'none') || 'none',
      min_items: asInt(rule.list_rules.min_items, 0),
      max_items: asInt(rule.list_rules.max_items, 100)
    };
  }
  if (nestedContract.shape === 'object' && !isObject(nestedContract.object_schema) && isObject(rule.object_schema)) {
    nestedContract.object_schema = sortDeep(rule.object_schema);
  }
  if (valueForm === 'mixed') {
    nestedContract.item_union = [
      contractType === 'integer' ? 'integer' : 'number',
      {
        type: 'object',
        schema: {
          min: {
            type: contractType === 'integer' ? 'integer' : 'number'
          },
          max: {
            type: contractType === 'integer' ? 'integer' : 'number'
          }
        }
      }
    ];
  }

  const nestedParse = isObject(rule.parse) ? { ...rule.parse } : {};
  nestedParse.template = normalizeToken(nestedParse.template || parseTemplate || '') || '';
  if (!Object.prototype.hasOwnProperty.call(nestedParse, 'unit')) {
    const candidateUnit = normalizeText(parseRules.unit || rule.unit || '');
    if (candidateUnit) {
      nestedParse.unit = candidateUnit;
    }
  }
  if (!Object.prototype.hasOwnProperty.call(nestedParse, 'strict_unit_required')) {
    nestedParse.strict_unit_required = rule.strict_unit_required === true;
  }
  if (Array.isArray(parseRules.unit_accepts) && parseRules.unit_accepts.length > 0) {
    nestedParse.unit_accepts = toArray(parseRules.unit_accepts).map((value) => normalizeText(value)).filter(Boolean);
  }
  if (isObject(parseRules.unit_conversions) && Object.keys(parseRules.unit_conversions).length > 0) {
    nestedParse.unit_conversions = sortDeep(parseRules.unit_conversions);
  }
  if (Array.isArray(parseRules.delimiters) && parseRules.delimiters.length > 0) {
    nestedParse.delimiters = toArray(parseRules.delimiters).map((value) => normalizeText(value)).filter(Boolean);
  }
  if (Array.isArray(parseRules.separators) && parseRules.separators.length > 0) {
    nestedParse.range_separators = toArray(parseRules.separators).map((value) => normalizeText(value)).filter(Boolean);
  }
  for (const [parseRuleKey, parseRuleValue] of Object.entries(parseRules)) {
    if (['unit', 'unit_accepts', 'unit_conversions', 'delimiters', 'separators'].includes(parseRuleKey)) {
      continue;
    }
    if (parseRuleValue !== undefined) {
      nestedParse[parseRuleKey] = parseRuleValue;
    }
  }
  if (parseTemplate === 'date_field' && !Array.isArray(nestedParse.accepted_formats)) {
    nestedParse.accepted_formats = ['YYYY-MM-DD', 'YYYY-MM', 'YYYY'];
  }

  const nestedEnum = {
    policy: policy || 'open_prefer_known',
    source: sourceRef,
    match: {
      strategy: normalizeToken(rule.enum_match_strategy || 'alias') || 'alias'
    },
    new_value_policy: isObject(rule.new_value_policy)
      ? sortDeep(rule.new_value_policy)
      : {
        accept_if_evidence: true,
        mark_needs_curation: true,
        suggestion_target: '_suggestions/enums.json'
      }
  };
  const fuzzy = asNumber(rule.enum_fuzzy_threshold);
  if (fuzzy !== null) {
    nestedEnum.match.fuzzy_threshold = fuzzy;
  }

  const nestedComponent = source?.type === 'component_db'
    ? {
      type: normalizeText(source.ref),
      source: sourceRef,
      require_identity_evidence: rule.require_component_identity_evidence !== false,
      allow_new_components: rule.allow_new_components !== false
    }
    : {};

  const nestedEvidence = isObject(rule.evidence) ? { ...rule.evidence } : {};
  nestedEvidence.required = nestedEvidence.required !== false;
  nestedEvidence.min_evidence_refs = asInt(
    nestedEvidence.min_evidence_refs,
    asInt(rule.min_evidence_refs, 1)
  );
  const evidenceTierPreference = toArray(nestedEvidence.tier_preference || ['tier1', 'tier2', 'tier3'])
    .map((value) => normalizeText(value))
    .filter(Boolean);
  nestedEvidence.tier_preference = evidenceTierPreference.length ? evidenceTierPreference : ['tier1', 'tier2', 'tier3'];
  nestedEvidence.conflict_policy = normalizeToken(
    nestedEvidence.conflict_policy || 'resolve_by_tier_else_unknown'
  ) || 'resolve_by_tier_else_unknown';

  const uiOut = {
    label: normalizeText(ui.label || titleFromKey(key)),
    group: normalizeText(ui.group || inferGroup(key)),
    order: asInt(ui.order, 1),
    tooltip_md: normalizeText(ui.tooltip_md || ''),
    prefix: normalizeText(ui.prefix || '') || null,
    suffix: normalizeText(ui.suffix || '') || null,
    examples: toArray(ui.examples || []).map((value) => normalizeText(value)).filter(Boolean),
    short_label: normalizeText(ui.short_label || '') || null,
    placeholder: normalizeText(ui.placeholder || 'unk') || 'unk',
    input_control: normalizeText(ui.input_control || 'text') || 'text',
    guidance_md: normalizeText(ui.guidance_md || '') || null,
    tooltip_key: normalizeText(ui.tooltip_key || '') || null,
    tooltip_source: normalizeText(ui.tooltip_source || '') || null,
    display_mode: normalizeToken(ui.display_mode || 'all') || 'all',
    display_decimals: asInt(ui.display_decimals, 0),
    array_handling: normalizeToken(rule.array_handling || ui.array_handling || 'none') || 'none'
  };

  const excelHints = {
    key_sheet: normalizeText(map?.key_list?.sheet || ''),
    key_column: normalizeText(map?.key_list?.column || ''),
    key_row: asInt(row.row, 0),
    sample_values: toArray(samples).map((value) => normalizeText(value)).filter(Boolean).slice(0, 10)
  };

  const searchHints = buildSearchHints({
    key,
    requiredLevel: normalizeToken(rule.required_level || 'optional'),
    availability: normalizeToken(rule.availability || 'sometimes'),
    difficulty: normalizeToken(rule.difficulty || 'medium'),
    parseTemplate,
    enumSource: source
  });

  return sortDeep({
    ...rule,
    key,
    canonical_key: normalizeFieldKey(rule.canonical_key || key) || key,
    aliases: stableSortStrings(toArray(rule.aliases || [key])),
    ui: uiOut,
    priority: {
      required_level: normalizeToken(rule.required_level || 'optional'),
      availability: normalizeToken(rule.availability || 'sometimes'),
      difficulty: normalizeToken(rule.difficulty || 'medium'),
      effort: asInt(rule.effort, 5),
      publish_gate: rule.publish_gate === true,
      block_publish_when_unk: rule.block_publish_when_unk === true
    },
    contract: nestedContract,
    parse: nestedParse,
    enum: nestedEnum,
    component: nestedComponent,
    evidence: nestedEvidence,
    excel_hints: excelHints,
    value_form: valueForm,
    search_hints: searchHints
  });
}

function buildCompileValidation({ fields, knownValues, componentDb }) {
  const errors = [];
  const warnings = [];
  const seenKeys = new Set();
  const knownValueFields = new Set(Object.keys(knownValues || {}));
  const componentTypes = new Set(Object.keys(componentDb || {}));
  const validParseTemplates = new Set([
    'boolean_yes_no_unknown',
    'number_with_unit',
    'integer_with_unit',
    'list_of_tokens_delimited',
    'list_of_numbers_with_unit',
    'list_numbers_or_ranges_with_unit',
    'latency_list_modes_ms',
    'mode_tagged_list',
    'mode_tagged_values',
    'range_number',
    'url_field',
    'date_field',
    'component_reference'
  ]);

  for (const [fieldKey, rule] of Object.entries(fields || {})) {
    if (seenKeys.has(fieldKey)) {
      errors.push(`duplicate field key: ${fieldKey}`);
    }
    seenKeys.add(fieldKey);
    if (!rule.key || normalizeFieldKey(rule.key) !== fieldKey) {
      errors.push(`field ${fieldKey}: missing/invalid key`);
    }
    if (!['number', 'integer', 'string', 'boolean', 'date', 'url', 'object'].includes(rule.type)) {
      errors.push(`field ${fieldKey}: invalid type '${rule.type}'`);
    }
    if (!['scalar', 'list', 'range', 'object'].includes(rule.shape)) {
      errors.push(`field ${fieldKey}: invalid shape '${rule.shape}'`);
    }
    const valueForm = normalizeValueForm(rule.value_form, normalizeToken(rule.shape || 'scalar'));
    if (!['single', 'set', 'range', 'mixed'].includes(valueForm)) {
      errors.push(`field ${fieldKey}: invalid value_form '${rule.value_form}'`);
    }
    if (valueForm === 'single' && rule.shape !== 'scalar') {
      errors.push(`field ${fieldKey}: value_form=single requires shape=scalar`);
    }
    if (valueForm === 'set' && rule.shape !== 'list') {
      errors.push(`field ${fieldKey}: value_form=set requires shape=list`);
    }
    if (valueForm === 'range' && !['range', 'object'].includes(rule.shape)) {
      errors.push(`field ${fieldKey}: value_form=range requires shape=range|object`);
    }
    if (valueForm === 'mixed' && rule.shape !== 'list') {
      errors.push(`field ${fieldKey}: value_form=mixed requires shape=list`);
    }
    if (!['identity', 'required', 'critical', 'expected', 'optional', 'rare'].includes(rule.required_level)) {
      errors.push(`field ${fieldKey}: invalid required_level '${rule.required_level}'`);
    }
    if (!['expected', 'sometimes', 'rare'].includes(rule.availability)) {
      errors.push(`field ${fieldKey}: invalid availability '${rule.availability}'`);
    }
    if (!['easy', 'medium', 'hard'].includes(rule.difficulty)) {
      errors.push(`field ${fieldKey}: invalid difficulty '${rule.difficulty}'`);
    }
    const effort = asInt(rule.effort, 0);
    if (effort < 1 || effort > 10) {
      errors.push(`field ${fieldKey}: effort must be 1..10`);
    }
    if (!['open', 'open_prefer_known', 'closed', 'closed_with_curation'].includes(rule.enum_policy)) {
      errors.push(`field ${fieldKey}: enum_policy must be open|open_prefer_known|closed|closed_with_curation`);
    }
    if (!isObject(rule.ui)) {
      errors.push(`field ${fieldKey}: ui object is required`);
    } else {
      if (!normalizeText(rule.ui.label)) {
        errors.push(`field ${fieldKey}: ui.label is required`);
      }
      if (!normalizeText(rule.ui.group)) {
        errors.push(`field ${fieldKey}: ui.group is required`);
      }
      if (asInt(rule.ui.order, 0) <= 0) {
        errors.push(`field ${fieldKey}: ui.order must be > 0`);
      }
      const hasTooltipMdKey = Object.prototype.hasOwnProperty.call(rule.ui, 'tooltip_md');
      const hasTooltipKey = normalizeText(rule.ui.tooltip_key);
      if (!hasTooltipMdKey && !hasTooltipKey) {
        errors.push(`field ${fieldKey}: ui.tooltip_md key or ui.tooltip_key is required`);
      }
    }
    const parseTemplate = normalizeText(rule.parse_template);
    if (!parseTemplate) {
      errors.push(`field ${fieldKey}: parse_template is required`);
    } else if (!validParseTemplates.has(parseTemplate)) {
      errors.push(`field ${fieldKey}: unsupported parse_template '${parseTemplate}'`);
    }
    if (parseTemplate === 'number_with_unit' || parseTemplate === 'integer_with_unit' || parseTemplate === 'list_of_numbers_with_unit' || parseTemplate === 'range_number' || parseTemplate === 'list_numbers_or_ranges_with_unit') {
      if (!normalizeText(rule.unit)) {
        errors.push(`field ${fieldKey}: unit required for ${parseTemplate}`);
      }
      if (!['none', 'int', '1dp', '2dp'].includes(normalizeToken(rule.round || ''))) {
        errors.push(`field ${fieldKey}: numeric parsing requires round value (none|int|1dp|2dp)`);
      }
      if (typeof rule.strict_unit_required !== 'boolean') {
        errors.push(`field ${fieldKey}: strict_unit_required boolean is required for unit-based parsing`);
      }
    } else if (parseTemplate === 'latency_list_modes_ms') {
      if (normalizeToken(rule.shape) !== 'list') {
        errors.push(`field ${fieldKey}: latency_list_modes_ms requires shape=list`);
      }
      if (normalizeToken(rule.type) !== 'object') {
        errors.push(`field ${fieldKey}: latency_list_modes_ms requires type=object`);
      }
      if (!normalizeText(rule.unit)) {
        errors.push(`field ${fieldKey}: latency_list_modes_ms requires unit (ms)`);
      }
      const objectSchema = isObject(rule.object_schema)
        ? rule.object_schema
        : (isObject(rule.contract?.object_schema) ? rule.contract.object_schema : {});
      if (!isObject(objectSchema) || Object.keys(objectSchema).length === 0) {
        errors.push(`field ${fieldKey}: latency_list_modes_ms requires object_schema`);
      }
    } else if ((rule.type === 'number' || rule.type === 'integer') && !normalizeText(rule.unit)) {
      errors.push(`field ${fieldKey}: numeric fields must declare unit`);
    }
    const enumSource = isObject(rule.enum_source) ? rule.enum_source : null;
    const hasInlineKnownValues = toArray(rule.vocab?.known_values).length > 0;
    if ((rule.enum_policy === 'closed' || rule.enum_policy === 'closed_with_curation') && !enumSource && !hasInlineKnownValues) {
      errors.push(`field ${fieldKey}: enum_source is required for ${rule.enum_policy}`);
    }
    if (enumSource) {
      const sourceType = normalizeToken(enumSource.type);
      const sourceRef = normalizeText(enumSource.ref);
      if (sourceType === 'known_values') {
        if (!knownValueFields.has(sourceRef || fieldKey) && !hasInlineKnownValues) {
          errors.push(`field ${fieldKey}: enum_source known_values ref '${sourceRef || fieldKey}' not found`);
        }
      } else if (sourceType === 'component_db') {
        if (!componentTypes.has(sourceRef)) {
          errors.push(`field ${fieldKey}: enum_source component_db ref '${sourceRef}' not found`);
        }
      } else {
        errors.push(`field ${fieldKey}: invalid enum_source type '${sourceType}'`);
      }
    }
    if (rule.enum_policy === 'open' || rule.enum_policy === 'open_prefer_known') {
      if (!isObject(rule.new_value_policy)) {
        errors.push(`field ${fieldKey}: new_value_policy is required for ${rule.enum_policy}`);
      } else {
        if (typeof rule.new_value_policy.accept_if_evidence !== 'boolean') {
          errors.push(`field ${fieldKey}: new_value_policy.accept_if_evidence boolean required`);
        }
        if (typeof rule.new_value_policy.mark_needs_curation !== 'boolean') {
          errors.push(`field ${fieldKey}: new_value_policy.mark_needs_curation boolean required`);
        }
        if (!normalizeText(rule.new_value_policy.suggestion_target)) {
          errors.push(`field ${fieldKey}: new_value_policy.suggestion_target required`);
        }
      }
    }
    if (rule.publish_gate && !normalizeText(rule.publish_gate_reason)) {
      errors.push(`field ${fieldKey}: publish_gate_reason required when publish_gate=true`);
    }
    if (rule.publish_gate && typeof rule.block_publish_when_unk !== 'boolean') {
      errors.push(`field ${fieldKey}: block_publish_when_unk boolean required when publish_gate=true`);
    }
    const evidenceRequired = (rule.evidence_required !== undefined)
      ? rule.evidence_required !== false
      : (isObject(rule.evidence) ? rule.evidence.required !== false : true);
    const minEvidenceRefs = (rule.min_evidence_refs !== undefined)
      ? asInt(rule.min_evidence_refs, 0)
      : asInt(isObject(rule.evidence) ? rule.evidence.min_evidence_refs : 1, 1);
    if (evidenceRequired && minEvidenceRefs <= 0) {
      errors.push(`field ${fieldKey}: min_evidence_refs must be >= 1 when evidence is required`);
    }
    if (isObject(rule.selection_policy)) {
      const sourceField = normalizeFieldKey(rule.selection_policy.source_field || '');
      if (!sourceField) {
        errors.push(`field ${fieldKey}: selection_policy.source_field is required when selection_policy is set`);
      }
      if (rule.selection_policy.tolerance_ms !== undefined) {
        const tolerance = asNumber(rule.selection_policy.tolerance_ms);
        if (tolerance === null || tolerance < 0) {
          errors.push(`field ${fieldKey}: selection_policy.tolerance_ms must be >= 0`);
        }
      }
      if (rule.selection_policy.mode_preference !== undefined && !Array.isArray(rule.selection_policy.mode_preference)) {
        errors.push(`field ${fieldKey}: selection_policy.mode_preference must be an array when provided`);
      }
    }
    if ((rule.shape === 'list') && parseTemplate !== 'list_of_tokens_delimited' && parseTemplate !== 'list_of_numbers_with_unit' && parseTemplate !== 'mode_tagged_list' && parseTemplate !== 'mode_tagged_values' && parseTemplate !== 'latency_list_modes_ms' && parseTemplate !== 'list_numbers_or_ranges_with_unit') {
      warnings.push(`field ${fieldKey}: list shape with parse template '${parseTemplate}' may be inconsistent`);
    }
    if (rule.shape === 'list' && ['list_of_tokens_delimited', 'list_of_numbers_with_unit', 'mode_tagged_list', 'mode_tagged_values', 'latency_list_modes_ms', 'list_numbers_or_ranges_with_unit'].includes(parseTemplate)) {
      const delimiters = toArray(rule.parse_rules?.delimiters);
      if (delimiters.length === 0 && parseTemplate !== 'mode_tagged_list' && parseTemplate !== 'mode_tagged_values') {
        errors.push(`field ${fieldKey}: list parse template requires parse_rules.delimiters`);
      }
    }
    if (isObject(rule.surfaces)) {
      const surfaceEnabled = ['hub_cards', 'xxl', 'filters', 'versus', 'radar', 'spec_table'].some((key) => Boolean(rule.surfaces[key]));
      if (surfaceEnabled && !normalizeText(rule.ui?.label)) {
        warnings.push(`field ${fieldKey}: surfaces enabled but ui.label missing`);
      }
    }
    if (rule.enum_policy === 'open' && (!isObject(rule.parse_rules) || Object.keys(rule.parse_rules).length === 0)) {
      warnings.push(`field ${fieldKey}: enum_policy=open but parse_rules is empty`);
    }
  }
  return {
    errors,
    warnings
  };
}

async function writeJsonStable(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${stableStringify(value)}\n`, 'utf8');
}

async function writeCanonicalFieldRulesPair({
  generatedRoot,
  runtimePayload
}) {
  const canonical = `${stableStringify(runtimePayload)}\n`;
  const canonicalBuffer = Buffer.from(canonical, 'utf8');
  const canonicalHash = hashBuffer(canonicalBuffer);
  const canonicalBytes = canonicalBuffer.length;
  const fieldRulesPath = path.join(generatedRoot, 'field_rules.json');
  const runtimePath = path.join(generatedRoot, 'field_rules.runtime.json');

  await fs.mkdir(generatedRoot, { recursive: true });
  await fs.writeFile(fieldRulesPath, canonicalBuffer);
  await fs.writeFile(runtimePath, canonicalBuffer);

  const [fieldRulesWritten, runtimeWritten] = await Promise.all([
    fs.readFile(fieldRulesPath),
    fs.readFile(runtimePath)
  ]);
  const fieldRulesHash = hashBuffer(fieldRulesWritten);
  const runtimeHash = hashBuffer(runtimeWritten);
  const identical = fieldRulesHash === runtimeHash && fieldRulesHash === canonicalHash;

  return {
    field_rules_path: fieldRulesPath,
    field_rules_runtime_path: runtimePath,
    field_rules_hash: fieldRulesHash,
    field_rules_runtime_hash: runtimeHash,
    expected_hash: canonicalHash,
    bytes: canonicalBytes,
    identical
  };
}

function snapshotVersionId() {
  return nowIso()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

function diffFieldRuleSets(previousRules = {}, currentRules = {}) {
  const previousFields = isObject(previousRules?.fields) ? previousRules.fields : {};
  const currentFields = isObject(currentRules?.fields) ? currentRules.fields : {};
  const previousKeys = stableSortStrings(Object.keys(previousFields));
  const currentKeys = stableSortStrings(Object.keys(currentFields));
  const previousSet = new Set(previousKeys);
  const currentSet = new Set(currentKeys);
  const addedKeys = currentKeys.filter((key) => !previousSet.has(key));
  const removedKeys = previousKeys.filter((key) => !currentSet.has(key));
  const changedKeys = currentKeys.filter((key) => {
    if (!previousSet.has(key)) {
      return false;
    }
    return stableStringify(previousFields[key]) !== stableStringify(currentFields[key]);
  });
  return {
    added_count: addedKeys.length,
    removed_count: removedKeys.length,
    changed_count: changedKeys.length,
    added_keys: addedKeys,
    removed_keys: removedKeys,
    changed_keys: changedKeys
  };
}

async function writeControlPlaneSnapshot({
  controlPlaneRoot,
  workbookMap = null,
  fieldRulesDraft = null,
  fieldRulesFull = null,
  uiFieldCatalogDraft = null,
  note = ''
} = {}) {
  const versionId = snapshotVersionId();
  const versionRoot = path.join(controlPlaneRoot, '_versions', versionId);
  await fs.mkdir(versionRoot, { recursive: true });
  if (isObject(workbookMap)) {
    await writeJsonStable(path.join(versionRoot, 'workbook_map.json'), workbookMap);
  }
  if (isObject(fieldRulesDraft)) {
    await writeJsonStable(path.join(versionRoot, 'field_rules_draft.json'), fieldRulesDraft);
  }
  if (isObject(fieldRulesFull)) {
    await writeJsonStable(path.join(versionRoot, 'field_rules.full.json'), fieldRulesFull);
  }
  if (isObject(uiFieldCatalogDraft)) {
    await writeJsonStable(path.join(versionRoot, 'ui_field_catalog_draft.json'), uiFieldCatalogDraft);
  }
  await writeJsonStable(path.join(versionRoot, 'manifest.json'), {
    version: 1,
    version_id: versionId,
    created_at: nowIso(),
    note: normalizeText(note) || null,
    files: {
      workbook_map: isObject(workbookMap),
      field_rules_draft: isObject(fieldRulesDraft),
      field_rules_full: isObject(fieldRulesFull),
      ui_field_catalog_draft: isObject(uiFieldCatalogDraft)
    }
  });
  return {
    version_id: versionId,
    path: versionRoot
  };
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function loadFieldRulePatch({ categoryRoot }) {
  const candidateFiles = [
    path.join(categoryRoot, 'field_rules.json'),
    path.join(categoryRoot, 'field_rule_sample_v2.json'),
    path.join(categoryRoot, 'field_rules_patch.json')
  ];
  const loadedFiles = [];
  let lastPayload = null;
  let mergedFields = {};
  for (const filePath of candidateFiles) {
    const loaded = await readJsonIfExists(filePath);
    if (!isObject(loaded) || !isObject(loaded.fields)) {
      continue;
    }
    loadedFiles.push(filePath);
    lastPayload = loaded;
    mergedFields = {
      ...mergedFields,
      ...loaded.fields
    };
  }
  if (loadedFiles.length === 0) {
    return null;
  }
  return {
    files: loadedFiles,
    file_path: loadedFiles[loadedFiles.length - 1],
    payload: {
      ...(isObject(lastPayload) ? lastPayload : {}),
      fields: mergedFields
    }
  };
}

export async function loadWorkbookMap({
  category,
  config = {},
  mapPath = null
}) {
  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  const categoryRoot = path.join(helperRoot, category);
  const filePath = mapPath
    ? path.resolve(mapPath)
    : path.join(categoryRoot, '_control_plane', 'workbook_map.json');
  const loaded = await readJsonIfExists(filePath);
  if (!loaded) {
    return null;
  }
  return {
    file_path: filePath,
    map: normalizeWorkbookMap(loaded)
  };
}

export async function saveWorkbookMap({
  category,
  workbookMap,
  config = {},
  mapPath = null
}) {
  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  const categoryRoot = path.join(helperRoot, category);
  const filePath = mapPath
    ? path.resolve(mapPath)
    : path.join(categoryRoot, '_control_plane', 'workbook_map.json');
  const normalized = normalizeWorkbookMap(workbookMap || {});
  await writeJsonStable(filePath, normalized);
  const controlPlaneRoot = path.join(categoryRoot, '_control_plane');
  const snapshot = await writeControlPlaneSnapshot({
    controlPlaneRoot,
    workbookMap: normalized,
    note: 'save-workbook-map'
  });
  return {
    file_path: filePath,
    map_hash: hashJson(normalized),
    workbook_map: normalized,
    version_snapshot: snapshot
  };
}

export async function compileCategoryWorkbook({
  category,
  workbookPath = '',
  workbookMap = null,
  config = {},
  mapPath = null
}) {
  if (!normalizeText(category)) {
    throw new Error('category_required');
  }
  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  const categoryRoot = path.join(helperRoot, category);
  const controlPlaneRoot = path.join(categoryRoot, '_control_plane');
  const generatedRoot = path.join(categoryRoot, '_generated');
  const controlMap = workbookMap
    ? { map: normalizeWorkbookMap(workbookMap), file_path: mapPath ? path.resolve(mapPath) : null }
    : await loadWorkbookMap({ category, config, mapPath });
  if (!controlMap?.map) {
    throw new Error('workbook_map_missing');
  }

  const resolvedWorkbook = normalizeText(workbookPath)
    ? path.resolve(workbookPath)
    : path.resolve(
      controlMap.map.workbook_path || path.join(categoryRoot, `${category}Data.xlsm`)
    );
  if (!(await fileExists(resolvedWorkbook))) {
    throw new Error(`workbook_not_found:${resolvedWorkbook}`);
  }

  const workbook = await introspectWorkbook({
    workbookPath: resolvedWorkbook,
    previewRows: 20,
    previewCols: 10
  });
  const sheetNames = workbook.sheets.map((sheet) => sheet.name);
  const mapValidation = validateWorkbookMap(controlMap.map, { sheetNames });
  if (!mapValidation.valid) {
    return {
      category,
      compiled: false,
      workbook_path: resolvedWorkbook,
      workbook_hash: workbook.workbook_hash,
      map_path: controlMap.file_path,
      map_hash: hashJson(mapValidation.normalized),
      errors: mapValidation.errors,
      warnings: mapValidation.warnings
    };
  }
  const mergedMap = mergeWorkbookMapDefaults(
    mapValidation.normalized,
    workbook?.suggested_map || {}
  );
  const mergedValidation = validateWorkbookMap(mergedMap, { sheetNames });
  if (!mergedValidation.valid) {
    return {
      category,
      compiled: false,
      workbook_path: resolvedWorkbook,
      workbook_hash: workbook.workbook_hash,
      map_path: controlMap.file_path,
      map_hash: hashJson(mergedValidation.normalized),
      errors: mergedValidation.errors,
      warnings: [...mapValidation.warnings, ...mergedValidation.warnings]
    };
  }
  const map = mergedValidation.normalized;
  const mapWarnings = [...mapValidation.warnings, ...mergedValidation.warnings];
  const fieldRulePatch = await loadFieldRulePatch({ categoryRoot });
  const patchFields = isObject(fieldRulePatch?.payload?.fields) ? fieldRulePatch.payload.fields : {};
  const effectiveFieldOverrides = {
    ...patchFields,
    ...(isObject(map.field_overrides) ? map.field_overrides : {})
  };

  const workbookBuffer = await fs.readFile(resolvedWorkbook);
  const entries = readZipEntries(workbookBuffer);
  const descriptors = loadSheetDescriptors({ workbookBuffer, entries });
  const sharedStrings = loadSharedStrings({ workbookBuffer, entries });
  const sheetMap = new Map();
  for (const descriptor of descriptors) {
    const sheetLoaded = loadSheetCellMap({
      workbookBuffer,
      entries,
      sheetPath: descriptor.sheetPath,
      sharedStrings
    });
    sheetMap.set(descriptor.name, {
      name: descriptor.name,
      cells: sheetLoaded.cells,
      maxRow: sheetLoaded.maxRow,
      maxCol: sheetLoaded.maxCol
    });
  }
  const workbookForCompile = {
    sheetMap,
    namedRanges: Object.fromEntries(
      toArray(workbook.named_ranges)
        .filter((row) => isObject(row) && normalizeText(row.name))
        .map((row) => [
          normalizeText(row.name),
          {
            sheet: normalizeText(row.sheet),
            startColumn: normalizeText(row.start_column || row.startColumn).toUpperCase(),
            endColumn: normalizeText(row.end_column || row.endColumn).toUpperCase(),
            startRow: asInt(row.row_start || row.startRow, 0),
            endRow: asInt(row.row_end || row.endRow, 0)
          }
        ])
    )
  };

  const extractedKeyRows = pullKeyRowsFromMap(workbookForCompile, map);
  const selectedKeySet = new Set(toArray(map.selected_keys).map((field) => normalizeFieldKey(field)).filter(Boolean));
  const keyRows = selectedKeySet.size > 0
    ? extractedKeyRows.filter((row) => selectedKeySet.has(normalizeFieldKey(row.key)))
    : extractedKeyRows;
  if (!keyRows.length) {
    return {
      category,
      compiled: false,
      workbook_path: resolvedWorkbook,
      workbook_hash: workbook.workbook_hash,
      map_path: controlMap.file_path,
      map_hash: hashJson(map),
      errors: [selectedKeySet.size > 0 ? 'selected_keys_filtered_all_extracted_keys' : 'no_keys_extracted_from_key_list'],
      warnings: mapValidation.warnings
    };
  }

  let samples = {
    byField: {},
    columns: []
  };
  if (map.product_table?.sheet) {
    if (map.product_table.layout === 'rows') {
      samples = pullRowTableSamples(workbookForCompile, map, keyRows);
    } else {
      samples = pullMatrixSamples(workbookForCompile, map, keyRows);
    }
  }
  const enumLists = pullEnumLists(workbookForCompile, map);
  const componentDb = pullComponentDbs(workbookForCompile, map);
  const tooltipLibrary = await loadTooltipLibrary({ categoryRoot });
  const tooltipEntries = isObject(tooltipLibrary?.entries) ? tooltipLibrary.entries : {};

  const expectations = map.expectations || {
    required_fields: [],
    critical_fields: [],
    expected_easy_fields: [],
    expected_sometimes_fields: [],
    deep_fields: []
  };

  const fieldsRuntime = {};
  const fieldsStudio = {};
  const uiFieldCatalogRows = [];
  const knownValues = {};
  const keyMigrations = {};

  let order = 1;
  for (const row of keyRows) {
    const field = row.key;
    const label = row.label;
    const tooltipEntry = tooltipEntries[field]
      || tooltipEntries[normalizeFieldKey(label)]
      || null;
    const enumValues = stableSortStrings([
      ...toArray(enumLists[field]),
      ...toArray(enumLists[normalizeFieldKey(label)])
    ]);
    if (enumValues.length) {
      knownValues[field] = enumValues;
    }

    let componentType = '';
    const componentTypeMatch = Object.keys(componentDb).find((type) => {
      const token = normalizeFieldKey(type);
      const singular = token.endsWith('s') ? token.slice(0, -1) : token;
      return field === token || field === singular;
    });
    if (componentTypeMatch) {
      componentType = componentTypeMatch;
    }

    const draft = buildFieldRuleDraft({
      key: field,
      label,
      samples: samples.byField[field] || [],
      enumValues,
      componentType,
      tooltipEntry,
      expectations,
      order,
      uiDefaults: map.ui_defaults || {}
    });
    const override = effectiveFieldOverrides?.[field] || effectiveFieldOverrides?.[label] || null;
    const merged = mergeFieldOverride(draft, override);

    if (normalizeFieldKey(merged.canonical_key) && normalizeFieldKey(merged.canonical_key) !== field) {
      keyMigrations[field] = normalizeFieldKey(merged.canonical_key);
    }

    if ((merged.enum_policy === 'closed' || merged.enum_policy === 'closed_with_curation') && (!merged.vocab?.known_values || merged.vocab.known_values.length === 0)) {
      merged.enum_policy = 'open_prefer_known';
      merged.vocab = {
        ...(merged.vocab || {}),
        mode: 'open_prefer_known',
        allow_new: true,
        known_values: []
      };
    }
    if (componentType) {
      merged.enum_source = {
        type: 'component_db',
        ref: componentType
      };
      merged.parse_template = 'component_reference';
      merged.parse_rules = parseRulesForTemplate('component_reference', { componentType });
      merged.enum_policy = 'open_prefer_known';
      merged.vocab = {
        ...(merged.vocab || {}),
        mode: 'open_prefer_known',
        allow_new: true
      };
    } else if (enumValues.length > 0) {
      merged.enum_source = {
        type: 'known_values',
        ref: field
      };
    }
    if ((merged.type === 'boolean' || merged.parse_template === 'boolean_yes_no_unknown') && !toArray(enumLists[field]).length && !toArray(enumLists.yes_no).length) {
      enumLists.yes_no = ['yes', 'no'];
    }
    if ((merged.type === 'boolean' || merged.parse_template === 'boolean_yes_no_unknown')
      && (merged.enum_policy === 'closed' || merged.enum_policy === 'closed_with_curation')
      && (!isObject(merged.enum_source) || !normalizeText(merged.enum_source.ref))) {
      merged.enum_source = {
        type: 'known_values',
        ref: enumLists[field]?.length ? field : 'yes_no'
      };
      if (!toArray(merged.vocab?.known_values).length) {
        merged.vocab = {
          ...(merged.vocab || {}),
          known_values: enumLists[field]?.length
            ? stableSortStrings(enumLists[field])
            : ['yes', 'no']
        };
      }
    }
    if (merged.parse_template === 'latency_list_modes_ms' && (!isObject(merged.object_schema) || Object.keys(merged.object_schema).length === 0)) {
      merged.object_schema = {
        mode: { type: 'string' },
        ms: { type: 'number' },
        source_host: { type: 'string' },
        method: { type: 'string' }
      };
    }
    if (!isObject(merged.ui)) {
      merged.ui = {};
    }
    if (!normalizeText(merged.ui.tooltip_md) && tooltipEntry?.markdown) {
      merged.ui.tooltip_md = tooltipEntry.markdown;
    }
    if (!normalizeText(merged.ui.tooltip_key) && tooltipEntry?.key) {
      merged.ui.tooltip_key = tooltipEntry.key;
    }
    if (!normalizeText(merged.ui.tooltip_source) && tooltipEntry?.source) {
      merged.ui.tooltip_source = tooltipEntry.source;
    }
    if ((merged.enum_policy === 'open' || merged.enum_policy === 'open_prefer_known') && !isObject(merged.new_value_policy)) {
      merged.new_value_policy = {};
    }
    if (merged.enum_policy === 'open' || merged.enum_policy === 'open_prefer_known') {
      merged.new_value_policy = {
        accept_if_evidence: typeof merged.new_value_policy?.accept_if_evidence === 'boolean'
          ? merged.new_value_policy.accept_if_evidence
          : true,
        mark_needs_curation: typeof merged.new_value_policy?.mark_needs_curation === 'boolean'
          ? merged.new_value_policy.mark_needs_curation
          : true,
        suggestion_target: normalizeText(merged.new_value_policy?.suggestion_target)
          || '_suggestions/enums.json'
      };
    }
    if (isObject(merged.selection_policy) && !normalizeText(merged.selection_policy.source_field)) {
      merged.selection_policy = {
        ...merged.selection_policy,
        source_field: field
      };
    }
    if (isObject(merged.enum_source) && normalizeToken(merged.enum_source.type) === 'known_values') {
      const enumRef = normalizeFieldKey(merged.enum_source.ref || field) || field;
      merged.enum_source = {
        type: 'known_values',
        ref: enumRef
      };
      if (!Object.prototype.hasOwnProperty.call(knownValues, enumRef)) {
        knownValues[enumRef] = [];
      }
      const inlineKnownValues = stableSortStrings(toArray(merged.vocab?.known_values));
      if (inlineKnownValues.length > 0) {
        knownValues[enumRef] = stableSortStrings([
          ...toArray(knownValues[enumRef]),
          ...inlineKnownValues
        ]);
      }
      if (enumRef === 'yes_no' && toArray(knownValues[enumRef]).length === 0) {
        knownValues[enumRef] = ['yes', 'no'];
      }
    }

    fieldsRuntime[field] = merged;
    fieldsStudio[field] = buildStudioFieldRule({
      key: field,
      rule: merged,
      row,
      map,
      samples: samples.byField[field] || [],
      enumLists,
      componentDb
    });
    uiFieldCatalogRows.push({
      key: field,
      canonical_key: merged.canonical_key || field,
      label: merged.ui?.label || titleFromKey(field),
      group: merged.ui?.group || 'general',
      order: merged.ui?.order || order,
      tooltip_md: merged.ui?.tooltip_md || '',
      aliases: stableSortStrings(merged.aliases || []),
      short_label: normalizeText(merged.ui?.short_label || '') || null,
      prefix: normalizeText(merged.ui?.prefix || '') || null,
      suffix: normalizeText(merged.ui?.suffix || '') || null,
      placeholder: normalizeText(merged.ui?.placeholder || 'unk') || 'unk',
      input_control: normalizeText(merged.ui?.input_control || 'text') || 'text',
      tooltip_key: normalizeText(merged.ui?.tooltip_key || '') || null,
      tooltip_source: normalizeText(merged.ui?.tooltip_source || '') || null,
      guidance_md: normalizeText(merged.ui?.guidance_md || '') || null,
      display_mode: normalizeToken(merged.ui?.display_mode || 'all') || 'all',
      display_decimals: asInt(merged.ui?.display_decimals, 0),
      array_handling: normalizeToken(merged.array_handling || merged.ui?.array_handling || 'none') || 'none',
      examples: stableSortStrings(toArray(merged.ui?.examples || [])),
      required_level: merged.required_level,
      availability: merged.availability,
      difficulty: merged.difficulty,
      effort: asInt(merged.effort, 5),
      type: merged.type,
      shape: merged.shape,
      unit: merged.unit || '',
      surfaces: isObject(merged.surfaces) ? merged.surfaces : {}
    });
    order += 1;
  }

  const fieldRulesDraft = {
    version: 1,
    category,
    generated_at: DETERMINISTIC_TIMESTAMP,
    workbook_map_hash: hashJson(map),
    selected_keys: stableSortStrings(keyRows.map((row) => row.key)),
    expectations: {
      required_fields: stableSortStrings(toArray(map.expectations?.required_fields)),
      critical_fields: stableSortStrings(toArray(map.expectations?.critical_fields)),
      expected_easy_fields: stableSortStrings(toArray(map.expectations?.expected_easy_fields)),
      expected_sometimes_fields: stableSortStrings(toArray(map.expectations?.expected_sometimes_fields)),
      deep_fields: stableSortStrings(toArray(map.expectations?.deep_fields))
    },
    fields: sortDeep(fieldsStudio)
  };

  const uiFieldCatalogDraft = {
    version: 1,
    category,
    generated_at: DETERMINISTIC_TIMESTAMP,
    fields: uiFieldCatalogRows
      .map((row) => ({
        key: row.key,
        canonical_key: row.canonical_key,
        label: row.label,
        short_label: row.short_label,
        group: row.group,
        order: row.order,
        tooltip_md: row.tooltip_md,
        tooltip_key: row.tooltip_key,
        tooltip_source: row.tooltip_source,
        guidance_md: row.guidance_md,
        prefix: row.prefix,
        suffix: row.suffix,
        placeholder: row.placeholder,
        input_control: row.input_control,
        display_mode: row.display_mode,
        display_decimals: row.display_decimals,
        array_handling: row.array_handling,
        aliases: row.aliases,
        examples: row.examples.length ? row.examples : toArray(samples.byField?.[row.key]).slice(0, 8)
      }))
      .sort((a, b) => (asInt(a.order, 0) - asInt(b.order, 0)) || a.key.localeCompare(b.key))
  };

  const validation = buildCompileValidation({
    fields: fieldsRuntime,
    knownValues,
    componentDb
  });

  const identityKeys = stableSortStrings(Object.keys(fieldsRuntime).filter((field) => fieldsRuntime[field].required_level === 'identity'));
  const requiredKeys = stableSortStrings(Object.keys(fieldsRuntime).filter((field) => fieldsRuntime[field].required_level === 'required'));
  const criticalKeys = stableSortStrings(Object.keys(fieldsRuntime).filter((field) => fieldsRuntime[field].required_level === 'critical'));
  const expectedEasy = stableSortStrings(Object.keys(fieldsRuntime).filter((field) => fieldsRuntime[field].required_level === 'expected' && fieldsRuntime[field].difficulty === 'easy'));
  const expectedSometimes = stableSortStrings(Object.keys(fieldsRuntime).filter((field) => fieldsRuntime[field].required_level === 'expected' && fieldsRuntime[field].difficulty !== 'easy'));
  const deepFields = stableSortStrings(Object.keys(fieldsRuntime).filter((field) => fieldsRuntime[field].required_level === 'optional' || fieldsRuntime[field].required_level === 'rare'));

  const fieldRulesBase = {
    version: 1,
    category,
    generated_at: DETERMINISTIC_TIMESTAMP,
    workbook: {
      path: resolvedWorkbook,
      hash: workbook.workbook_hash
    },
    workbook_map_hash: hashJson(map),
    defaults: {
      missing: {
        sentinels: ['', 'unk', 'n/a', 'na', 'unknown', null]
      },
      vocab: {
        mode_default: 'open',
        allow_new_default: true
      }
    },
    schema: {
      identity_fields: identityKeys,
      required_fields: requiredKeys,
      critical_fields: criticalKeys,
      expected_easy_fields: expectedEasy,
      expected_sometimes_fields: expectedSometimes,
      deep_fields: deepFields,
      include_fields: stableSortStrings(Object.keys(fieldsRuntime)),
      exclude_fields: ['id', 'brand', 'model', 'base_model', 'category', 'sku'],
      preserve_existing_fields: false
    },
    fields: fieldsRuntime
  };

  const keySourceColumn = String(map?.key_list?.column || '').toUpperCase();
  const keySourceRange = normalizeText(
    map?.key_list?.source === 'range'
      ? map?.key_list?.range
      : (map?.key_list?.source === 'named_range'
        ? String(map?.key_list?.named_range || '')
        : `${keySourceColumn}${asInt(map?.key_list?.row_start, 1)}:${keySourceColumn}${asInt(map?.key_list?.row_end, asInt(map?.key_list?.row_start, 1))}`)
  );

  const fieldRulesFull = {
    ...fieldRulesBase,
    meta: {
      category,
      generated_at: DETERMINISTIC_TIMESTAMP,
      source_workbook: path.basename(resolvedWorkbook),
      key_source: {
        sheet: normalizeText(map?.key_list?.sheet || ''),
        range: keySourceRange
      },
      field_rule_patch: fieldRulePatch
        ? {
          files: toArray(fieldRulePatch.files).map((filePath) => path.basename(filePath)),
          version: normalizeText(fieldRulePatch.payload?.version || '') || null,
          field_count: Object.keys(patchFields).length
        }
        : null,
      schema_version: 'field_rules_studio_v3',
      notes: [
        'Generated by Field Rules Studio compiler.',
        'This artifact includes nested contract blocks and runtime-compatible flat keys per field.'
      ]
    },
    workbook_tabs: buildWorkbookTabsSummary({
      workbook,
      map
    }),
    known_values: sortDeep(knownValues),
    enum_buckets: buildEnumBucketSummary({
      map,
      enumLists
    }),
    component_db_sources: buildComponentSourceSummary({
      map,
      componentDb
    }),
    fields: sortDeep(fieldsStudio),
    global: buildGlobalContractMetadata(),
    parse_templates: buildParseTemplateCatalog(),
    key_migrations_suggested: sortDeep(keyMigrations)
  };

  const fieldRulesRuntime = sortDeep({
    ...fieldRulesBase,
    fields: sortDeep(fieldsRuntime)
  });

  const uiFieldCatalog = {
    version: 1,
    category,
    generated_at: DETERMINISTIC_TIMESTAMP,
    fields: uiFieldCatalogRows.sort((a, b) => (asInt(a.order, 0) - asInt(b.order, 0)) || a.key.localeCompare(b.key))
  };

  const knownValuesArtifact = {
    version: 1,
    category,
    generated_at: DETERMINISTIC_TIMESTAMP,
    fields: sortDeep(knownValues)
  };

  const runtimeKeys = stableSortStrings(Object.keys(fieldsRuntime));
  const uiKeys = stableSortStrings(toArray(uiFieldCatalog.fields).map((row) => normalizeFieldKey(row?.key || '')));
  const uiKeySet = new Set(uiKeys);
  for (const key of runtimeKeys) {
    if (!uiKeySet.has(key)) {
      validation.errors.push(`ui_field_catalog missing key '${key}'`);
    }
  }
  const runtimeKeySet = new Set(runtimeKeys);
  for (const key of uiKeys) {
    if (!runtimeKeySet.has(key)) {
      validation.errors.push(`field_rules missing key '${key}'`);
    }
  }

  const previousReport = await readJsonIfExists(path.join(generatedRoot, '_compile_report.json'));
  const previousFieldRulesArtifact = await readJsonIfExists(path.join(generatedRoot, 'field_rules.json'));
  const previousHash = previousReport?.artifacts?.field_rules?.hash || null;
  const currentHash = hashBuffer(Buffer.from(`${stableStringify(fieldRulesRuntime)}\n`, 'utf8'));
  const changed = Boolean(previousHash && previousHash !== currentHash);
  const fieldDiff = diffFieldRuleSets(previousFieldRulesArtifact, fieldRulesRuntime);
  const patchSummary = fieldRulePatch
    ? {
      files: toArray(fieldRulePatch.files).map((filePath) => path.basename(filePath)),
      version: normalizeText(fieldRulePatch.payload?.version || '') || null,
      field_count: Object.keys(patchFields).length
    }
    : null;

  const compileReport = {
    version: 1,
    category,
    compiled_at: nowIso(),
    compiled: validation.errors.length === 0,
    workbook_path: resolvedWorkbook,
    workbook_hash: workbook.workbook_hash,
    workbook_map_path: controlMap.file_path || null,
    workbook_map_hash: hashJson(map),
    counts: {
      fields: Object.keys(fieldsRuntime).length,
      identity: identityKeys.length,
      required: requiredKeys.length,
      critical: criticalKeys.length,
      expected_easy: expectedEasy.length,
      expected_sometimes: expectedSometimes.length,
      deep: deepFields.length,
      enums: Object.keys(knownValues).length,
      component_types: Object.keys(componentDb).length
    },
    warnings: [...mapWarnings, ...validation.warnings],
    errors: validation.errors,
    source_summary: {
      key_rows: keyRows.length,
      sampled_product_columns: toArray(samples.columns).length,
      sampled_values: Object.values(samples.byField || {}).reduce((sum, list) => sum + toArray(list).length, 0),
      enum_lists: toArray(map.enum_lists).length,
      component_sheets: toArray(map.component_sheets).length,
      field_rule_patch: patchSummary
    },
    diff: {
      changed,
      previous_hash: previousHash,
      current_hash: currentHash,
      fields: fieldDiff
    },
    artifacts: {
      field_rules_draft: {
        path: path.join(controlPlaneRoot, 'field_rules_draft.json'),
        hash: hashJson(fieldRulesDraft)
      },
      field_rules_full: {
        path: path.join(controlPlaneRoot, 'field_rules.full.json'),
        hash: hashJson(fieldRulesFull)
      },
      ui_field_catalog_draft: {
        path: path.join(controlPlaneRoot, 'ui_field_catalog_draft.json'),
        hash: hashJson(uiFieldCatalogDraft)
      },
      field_rules: {
        path: path.join(generatedRoot, 'field_rules.json'),
        hash: currentHash,
        changed
      },
      field_rules_runtime: {
        path: path.join(generatedRoot, 'field_rules.runtime.json'),
        hash: currentHash
      },
      ui_field_catalog: {
        path: path.join(generatedRoot, 'ui_field_catalog.json'),
        hash: hashJson(uiFieldCatalog)
      },
      known_values: {
        path: path.join(generatedRoot, 'known_values.json'),
        hash: hashJson(knownValuesArtifact)
      },
      key_migrations: Object.keys(keyMigrations).length
        ? {
          path: path.join(generatedRoot, 'key_migrations.json'),
          hash: hashJson(keyMigrations)
        }
        : null
    }
  };

  await fs.mkdir(controlPlaneRoot, { recursive: true });
  await writeJsonStable(controlMap.file_path || path.join(controlPlaneRoot, 'workbook_map.json'), map);
  await writeJsonStable(path.join(controlPlaneRoot, 'field_rules_draft.json'), fieldRulesDraft);
  await writeJsonStable(path.join(controlPlaneRoot, 'field_rules.full.json'), fieldRulesFull);
  await writeJsonStable(path.join(controlPlaneRoot, 'ui_field_catalog_draft.json'), uiFieldCatalogDraft);
  const controlPlaneSnapshot = await writeControlPlaneSnapshot({
    controlPlaneRoot,
    workbookMap: map,
    fieldRulesDraft,
    fieldRulesFull,
    uiFieldCatalogDraft,
    note: 'category-compile'
  });
  compileReport.artifacts.control_plane_version = {
    path: controlPlaneSnapshot.path,
    version_id: controlPlaneSnapshot.version_id
  };

  if (validation.errors.length > 0) {
    return {
      category,
      compiled: false,
      workbook_path: resolvedWorkbook,
      workbook_hash: workbook.workbook_hash,
      map_path: controlMap.file_path,
      map_hash: hashJson(map),
      selected_key_count: keyRows.length,
      errors: compileReport.errors,
      warnings: compileReport.warnings,
      compile_report: compileReport,
      control_plane_version: controlPlaneSnapshot
    };
  }

  await fs.mkdir(generatedRoot, { recursive: true });
  const canonicalPair = await writeCanonicalFieldRulesPair({
    generatedRoot,
    runtimePayload: fieldRulesRuntime
  });
  if (!canonicalPair.identical) {
    compileReport.errors.push('field_rules.json and field_rules.runtime.json must be byte-identical');
    compileReport.compiled = false;
    await writeJsonStable(path.join(generatedRoot, '_compile_report.json'), compileReport);
    return {
      category,
      compiled: false,
      workbook_path: resolvedWorkbook,
      workbook_hash: workbook.workbook_hash,
      map_path: controlMap.file_path,
      map_hash: hashJson(map),
      selected_key_count: keyRows.length,
      errors: compileReport.errors,
      warnings: compileReport.warnings,
      compile_report: compileReport,
      control_plane_version: controlPlaneSnapshot
    };
  }
  compileReport.artifacts.field_rules.hash = canonicalPair.field_rules_hash;
  compileReport.artifacts.field_rules_runtime.hash = canonicalPair.field_rules_runtime_hash;
  compileReport.artifacts.field_rules_runtime.identical_to_field_rules = true;
  compileReport.artifacts.field_rules_runtime.bytes = canonicalPair.bytes;
  await writeJsonStable(path.join(generatedRoot, 'ui_field_catalog.json'), uiFieldCatalog);
  await writeJsonStable(path.join(generatedRoot, 'known_values.json'), knownValuesArtifact);
  await fs.rm(path.join(generatedRoot, 'schema.json'), { force: true });
  await fs.rm(path.join(generatedRoot, 'required_fields.json'), { force: true });
  if (Object.keys(keyMigrations).length > 0) {
    await writeJsonStable(path.join(generatedRoot, 'key_migrations.json'), keyMigrations);
  } else {
    await fs.rm(path.join(generatedRoot, 'key_migrations.json'), { force: true });
  }

  const componentRoot = path.join(generatedRoot, 'component_db');
  await fs.rm(componentRoot, { recursive: true, force: true });
  await fs.mkdir(componentRoot, { recursive: true });
  const componentTypeOutputName = {
    sensor: 'sensors',
    switch: 'switches',
    encoder: 'encoders',
    mcu: 'mcus',
    material: 'materials'
  };
  for (const [componentType, rows] of Object.entries(componentDb)) {
    const payload = {
      version: 1,
      category,
      component_type: componentType,
      generated_at: DETERMINISTIC_TIMESTAMP,
      items: rows
    };
    const outputName = normalizeText(componentTypeOutputName[normalizeToken(componentType)] || componentType) || componentType;
    await writeJsonStable(path.join(componentRoot, `${outputName}.json`), payload);
  }

  const suggestionsRoot = path.join(categoryRoot, '_suggestions');
  await fs.mkdir(suggestionsRoot, { recursive: true });
  const suggestionDefaults = {
    enums: { version: 1, category, suggestions: [] },
    components: { version: 1, category, suggestions: [] },
    lexicon: { version: 1, category, suggestions: [] },
    constraints: { version: 1, category, suggestions: [] }
  };
  for (const [name, payload] of Object.entries(suggestionDefaults)) {
    const filePath = path.join(suggestionsRoot, `${name}.json`);
    if (!(await fileExists(filePath))) {
      await writeJsonStable(filePath, payload);
    }
  }
  await fs.mkdir(path.join(categoryRoot, '_overrides'), { recursive: true });

  await writeJsonStable(path.join(generatedRoot, '_compile_report.json'), compileReport);

  return {
    category,
    compiled: true,
    workbook_path: resolvedWorkbook,
    workbook_hash: workbook.workbook_hash,
    map_path: controlMap.file_path,
    map_hash: hashJson(map),
    generated_root: generatedRoot,
    field_count: Object.keys(fieldsRuntime).length,
    selected_key_count: keyRows.length,
    warnings: compileReport.warnings,
    errors: [],
    compile_report: compileReport,
    control_plane_version: controlPlaneSnapshot
  };
}
