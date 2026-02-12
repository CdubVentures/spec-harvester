import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import zlib from 'node:zlib';
import { XMLParser } from 'fast-xml-parser';
import { toPosixKey } from '../s3/storage.js';
import { nowIso } from '../utils/common.js';
import { upsertQueueProduct } from '../queue/queueState.js';

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeFieldKey(value) {
  const token = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return token;
}

function isIdentityLikeField(field) {
  return new Set(['id', 'brand', 'model', 'base_model', 'category', 'sku']).has(String(field || '').trim());
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseRowRange(value) {
  const text = String(value || '').trim();
  const match = text.match(/^([A-Za-z]+)(\d+)\s*:\s*([A-Za-z]+)(\d+)$/);
  if (!match) {
    return null;
  }
  if (String(match[1]).toUpperCase() !== String(match[3]).toUpperCase()) {
    return null;
  }
  const start = Number.parseInt(match[2], 10);
  const end = Number.parseInt(match[4], 10);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }
  return {
    column: String(match[1]).toUpperCase(),
    start,
    end
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

function colToIndex(column) {
  const text = String(column || '').trim().toUpperCase();
  if (!text) {
    throw new Error('invalid_column');
  }
  let total = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) {
      throw new Error(`invalid_column:${column}`);
    }
    total = (total * 26) + (code - 64);
  }
  if (total <= 0) {
    throw new Error(`invalid_column:${column}`);
  }
  return total;
}

function indexToCol(index) {
  let value = Number.parseInt(String(index), 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`invalid_column_index:${index}`);
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
    throw new Error(`invalid_cell_ref:${ref}`);
  }
  return {
    column: String(match[1]).toUpperCase(),
    row: Number.parseInt(match[2], 10)
  };
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

function loadWorkbookSheetPath({ workbookBuffer, entries, sheet }) {
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
    const relId = String(rel?.Id || '').trim();
    const target = normalizeSheetTarget(rel?.Target || '');
    if (!relId || !target) {
      continue;
    }
    relationships.set(relId, target);
  }

  const sheets = asArray(workbookDoc?.workbook?.sheets?.sheet);
  const targetSheet = sheets.find((row) => String(row?.name || '') === String(sheet || ''))
    || sheets.find((row) => String(row?.name || '').toLowerCase() === String(sheet || '').toLowerCase());
  if (!targetSheet) {
    const sheetNames = sheets
      .map((row) => String(row?.name || '').trim())
      .filter(Boolean);
    throw new Error(`sheet_not_found:${sheet}:${sheetNames.join(',')}`);
  }

  const relId = String(targetSheet?.id || '').trim();
  const sheetPath = relationships.get(relId);
  if (!sheetPath) {
    throw new Error(`sheet_relationship_missing:${sheet}`);
  }
  return sheetPath;
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
  for (const row of asArray(sheetDoc?.worksheet?.sheetData?.row)) {
    for (const cell of asArray(row?.c)) {
      const ref = String(cell?.r || '').trim().toUpperCase();
      if (!ref) {
        continue;
      }
      let value = '';
      if (cell?.is !== undefined) {
        value = xmlText(cell.is);
      } else if (cell?.v !== undefined) {
        const rawValue = xmlText(cell.v);
        if (String(cell?.t || '').trim() === 's') {
          const idx = Number.parseInt(rawValue, 10);
          if (Number.isFinite(idx) && idx >= 0 && idx < sharedStrings.length) {
            value = sharedStrings[idx];
          } else {
            value = rawValue;
          }
        } else {
          value = rawValue;
        }
      }
      const normalized = String(value || '').trim();
      if (!normalized) {
        continue;
      }
      cells.set(ref, normalized);
    }
  }
  return cells;
}

function buildExcelPayloadFromCells({
  cells,
  fieldLabelColumn,
  fieldRowStart,
  fieldRowEnd,
  brandRow,
  modelRow,
  variantRow,
  dataColumnStart,
  dataColumnEnd
}) {
  const fieldRows = [];
  for (let rowIndex = fieldRowStart; rowIndex <= fieldRowEnd; rowIndex += 1) {
    const label = String(cells.get(`${fieldLabelColumn}${rowIndex}`) || '').trim();
    if (!label) {
      continue;
    }
    fieldRows.push({
      row: rowIndex,
      label
    });
  }

  if (!fieldRows.length) {
    return {
      field_rows: [],
      products: []
    };
  }

  let maxColumnSeen = colToIndex(dataColumnStart);
  for (const ref of cells.keys()) {
    try {
      const split = splitCellRef(ref);
      maxColumnSeen = Math.max(maxColumnSeen, colToIndex(split.column));
    } catch {
      continue;
    }
  }

  const startColumn = colToIndex(dataColumnStart);
  let endColumn = dataColumnEnd ? colToIndex(dataColumnEnd) : maxColumnSeen;
  endColumn = Math.max(startColumn, Math.min(endColumn, maxColumnSeen));

  const products = [];
  for (let columnIndex = startColumn; columnIndex <= endColumn; columnIndex += 1) {
    const column = indexToCol(columnIndex);
    const brand = String(cells.get(`${column}${brandRow}`) || '').trim();
    const model = String(cells.get(`${column}${modelRow}`) || '').trim();
    if (!brand && !model) {
      continue;
    }
    const variant = variantRow > 0
      ? String(cells.get(`${column}${variantRow}`) || '').trim()
      : '';
    const valuesByLabel = {};
    for (const row of fieldRows) {
      valuesByLabel[row.label] = String(cells.get(`${column}${row.row}`) || '').trim();
    }
    products.push({
      column,
      brand,
      model,
      variant,
      values_by_label: valuesByLabel
    });
  }

  return {
    field_rows: fieldRows,
    products
  };
}

function extractExcelPayloadWithNode({
  workbookPath,
  sheet,
  fieldLabelColumn,
  fieldRowStart,
  fieldRowEnd,
  brandRow,
  modelRow,
  variantRow,
  dataColumnStart,
  dataColumnEnd
}) {
  const workbookBuffer = fsSync.readFileSync(workbookPath);
  const entries = readZipEntries(workbookBuffer);
  const sheetPath = loadWorkbookSheetPath({
    workbookBuffer,
    entries,
    sheet
  });
  const sharedStrings = loadSharedStrings({
    workbookBuffer,
    entries
  });
  const cells = loadSheetCellMap({
    workbookBuffer,
    entries,
    sheetPath,
    sharedStrings
  });
  return buildExcelPayloadFromCells({
    cells,
    fieldLabelColumn,
    fieldRowStart,
    fieldRowEnd,
    brandRow,
    modelRow,
    variantRow,
    dataColumnStart,
    dataColumnEnd
  });
}

function buildProductId({ category, brand, model, variant }) {
  return [slug(category), slug(brand), slug(model), slug(variant)]
    .filter(Boolean)
    .join('-');
}

function helperCategoryDir({ category, config = {} }) {
  return path.resolve(config.helperFilesRoot || 'helper_files', category);
}

export function fieldRulesPathCandidates({ category, config = {} }) {
  return [
    path.join(helperCategoryDir({ category, config }), '_generated', 'field_rules.json'),
    path.join(helperCategoryDir({ category, config }), '_generated', 'field_rules.runtime.json')
  ];
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveWorkbookPath({ category, config = {}, fieldRules = {} }) {
  const excel = isObject(fieldRules.excel) ? fieldRules.excel : {};
  const configured = String(excel.workbook || excel.file || '').trim();
  if (configured) {
    if (path.isAbsolute(configured)) {
      return configured;
    }
    return path.resolve(helperCategoryDir({ category, config }), configured);
  }
  return path.join(helperCategoryDir({ category, config }), `${category}Data.xlsm`);
}

function resolveExcelConfig({ category, config = {}, fieldRules = {} }) {
  const excel = isObject(fieldRules.excel) ? fieldRules.excel : {};
  const schema = isObject(fieldRules.schema) ? fieldRules.schema : {};
  const explicitRange = parseRowRange(
    excel.field_rows_range ||
    schema.field_rows_range ||
    ''
  );
  const rowStart = explicitRange?.start || asInt(excel.field_row_start, 9);
  const rowEnd = explicitRange?.end || asInt(excel.field_row_end, 83);
  const labelColumn = explicitRange?.column || String(excel.field_label_column || 'B').toUpperCase();
  return {
    workbookPath: resolveWorkbookPath({ category, config, fieldRules }),
    sheet: String(excel.sheet || 'dataEntry').trim() || 'dataEntry',
    fieldLabelColumn: labelColumn,
    fieldRowStart: rowStart,
    fieldRowEnd: rowEnd,
    brandRow: asInt(excel.brand_row, 3),
    modelRow: asInt(excel.model_row, 4),
    variantRow: asInt(excel.variant_row, 5),
    dataColumnStart: String(excel.data_column_start || 'C').toUpperCase(),
    dataColumnEnd: String(excel.data_column_end || '').toUpperCase()
  };
}

function normalizeFieldLabelMap(fieldRules = {}) {
  const out = {};
  const candidates = [
    fieldRules.field_map,
    fieldRules.label_to_field,
    fieldRules.field_aliases
  ];
  for (const source of candidates) {
    if (!isObject(source)) {
      continue;
    }
    for (const [label, field] of Object.entries(source)) {
      const l = normalizeFieldKey(label);
      const f = normalizeFieldKey(field);
      if (!l || !f) {
        continue;
      }
      out[l] = f;
    }
  }
  return out;
}

function normalizeFieldRows({ rows = [], fieldRules = {} }) {
  const labelMap = normalizeFieldLabelMap(fieldRules);
  return toArray(rows)
    .map((row) => {
      const label = normalizeText(row?.label);
      const labelKey = normalizeFieldKey(label);
      const mapped = labelMap[labelKey] || labelKey;
      return {
        row: asInt(row?.row, 0),
        label,
        field: mapped
      };
    })
    .filter((row) => row.row > 0 && row.label && row.field);
}

function normalizeProductRows({
  rows = [],
  fieldRows = [],
  category,
  fieldOrder = [],
  fieldRules = {}
}) {
  const fieldSet = new Set(fieldOrder || []);
  const exclude = new Set(
    toArray(fieldRules?.schema?.exclude_fields)
      .map((field) => normalizeFieldKey(field))
      .filter(Boolean)
  );
  const products = [];
  for (const row of toArray(rows)) {
    const brand = normalizeText(row?.brand);
    const model = normalizeText(row?.model);
    if (!brand || !model) {
      continue;
    }
    const variant = normalizeText(row?.variant);
    const valuesByLabel = isObject(row?.values_by_label) ? row.values_by_label : {};
    const canonicalFields = {};
    for (const fieldRow of fieldRows) {
      const field = normalizeFieldKey(fieldRow.field);
      if (!field || isIdentityLikeField(field) || exclude.has(field)) {
        continue;
      }
      if (fieldSet.size > 0 && !fieldSet.has(field)) {
        continue;
      }
      const value = normalizeText(valuesByLabel[fieldRow.label]);
      if (!value) {
        continue;
      }
      canonicalFields[field] = value;
    }
    const sourceColumn = normalizeText(row?.column || '');
    products.push({
      source_column: sourceColumn,
      brand,
      model,
      variant,
      category,
      canonical_fields: canonicalFields
    });
  }
  return products;
}

export async function loadCategoryFieldRules(category, config = {}) {
  for (const filePath of fieldRulesPathCandidates({ category, config })) {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        file_path: filePath,
        value: isObject(parsed) ? parsed : {}
      };
    } catch (error) {
      if (error.code === 'ENOENT') {
        continue;
      }
      throw error;
    }
  }
  return null;
}

export async function extractExcelSeedData({
  category,
  config = {},
  fieldRules = {},
  fieldOrder = []
}) {
  const excel = resolveExcelConfig({ category, config, fieldRules });
  if (!excel.workbookPath || !(await fileExists(excel.workbookPath))) {
    return {
      enabled: false,
      workbook_path: excel.workbookPath,
      sheet: excel.sheet,
      field_rows: [],
      products: [],
      error: excel.workbookPath ? 'workbook_not_found' : 'workbook_not_configured'
    };
  }

  const parserMode = String(config.excelSeedParser || 'auto').trim().toLowerCase();
  let payload = null;
  let parserUsed = 'node';
  let pythonFailure = null;

  if (parserMode !== 'python') {
    try {
      payload = {
        ok: true,
        workbook_path: path.resolve(excel.workbookPath),
        sheet: excel.sheet,
        ...extractExcelPayloadWithNode({
          workbookPath: excel.workbookPath,
          sheet: excel.sheet,
          fieldLabelColumn: excel.fieldLabelColumn,
          fieldRowStart: excel.fieldRowStart,
          fieldRowEnd: excel.fieldRowEnd,
          brandRow: excel.brandRow,
          modelRow: excel.modelRow,
          variantRow: excel.variantRow,
          dataColumnStart: excel.dataColumnStart,
          dataColumnEnd: excel.dataColumnEnd || ''
        })
      };
    } catch (error) {
      if (parserMode === 'node') {
        return {
          enabled: false,
          workbook_path: excel.workbookPath,
          sheet: excel.sheet,
          field_rows: [],
          products: [],
          error: `excel_node_parse_failed: ${error.message}`
        };
      }
      parserUsed = 'python';
      pythonFailure = `excel_node_parse_failed: ${error.message}`;
    }
  }

  if (!payload) {
    const scriptPath = path.resolve('scripts', 'extract_excel_seed.py');
    const args = [
      scriptPath,
      '--workbook',
      excel.workbookPath,
      '--sheet',
      excel.sheet,
      '--field-label-column',
      excel.fieldLabelColumn,
      '--field-row-start',
      String(excel.fieldRowStart),
      '--field-row-end',
      String(excel.fieldRowEnd),
      '--brand-row',
      String(excel.brandRow),
      '--model-row',
      String(excel.modelRow),
      '--variant-row',
      String(excel.variantRow),
      '--data-column-start',
      excel.dataColumnStart
    ];
    if (excel.dataColumnEnd) {
      args.push('--data-column-end', excel.dataColumnEnd);
    }

    const command = String(config.pythonCommand || 'python').trim() || 'python';
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    });
    if (result.error || result.status !== 0) {
      return {
        enabled: false,
        workbook_path: excel.workbookPath,
        sheet: excel.sheet,
        field_rows: [],
        products: [],
        error: result.error?.message || `extract_failed_status_${result.status}`,
        stderr: String(result.stderr || '').trim(),
        fallback_error: pythonFailure
      };
    }

    try {
      payload = JSON.parse(String(result.stdout || '').trim());
    } catch (error) {
      return {
        enabled: false,
        workbook_path: excel.workbookPath,
        sheet: excel.sheet,
        field_rows: [],
        products: [],
        error: `invalid_json_output: ${error.message}`,
        fallback_error: pythonFailure
      };
    }
    parserUsed = 'python';
  }

  if (!payload?.ok) {
    return {
      enabled: false,
      workbook_path: excel.workbookPath,
      sheet: excel.sheet,
      field_rows: [],
      products: [],
      error: String(payload?.error || 'extract_failed'),
      fallback_error: pythonFailure
    };
  }

  const fieldRows = normalizeFieldRows({
    rows: payload.field_rows || [],
    fieldRules
  });
  const products = normalizeProductRows({
    rows: payload.products || [],
    fieldRows,
    category,
    fieldOrder,
    fieldRules
  });

  return {
    enabled: true,
    workbook_path: payload.workbook_path || excel.workbookPath,
    sheet: payload.sheet || excel.sheet,
    field_rows: fieldRows,
    products,
    error: null,
    parser: parserUsed
  };
}

export function buildFieldOrderFromExcelSeed({
  fieldRows = [],
  fieldRules = {},
  existingFieldOrder = []
}) {
  const includeExtras = new Set(
    toArray(fieldRules?.schema?.include_fields)
      .map((field) => normalizeFieldKey(field))
      .filter(Boolean)
  );
  const exclude = new Set(
    toArray(fieldRules?.schema?.exclude_fields || ['id', 'brand', 'model', 'base_model', 'category', 'sku'])
      .map((field) => normalizeFieldKey(field))
      .filter(Boolean)
  );
  const preserveExistingFields = fieldRules?.schema?.preserve_existing_fields !== false;
  const seen = new Set();
  const out = [];
  for (const row of toArray(fieldRows)) {
    const field = normalizeFieldKey(row?.field);
    if (!field || isIdentityLikeField(field) || exclude.has(field)) {
      continue;
    }
    if (seen.has(field)) {
      continue;
    }
    seen.add(field);
    out.push(field);
  }

  const appendFields = (values = []) => {
    for (const value of values) {
      const field = normalizeFieldKey(value);
      if (!field || isIdentityLikeField(field) || exclude.has(field)) {
        continue;
      }
      if (seen.has(field)) {
        continue;
      }
      seen.add(field);
      out.push(field);
    }
  };

  appendFields([...includeExtras]);
  if (preserveExistingFields) {
    appendFields(toArray(existingFieldOrder));
  }
  return out;
}

export async function syncJobsFromExcelSeed({
  storage,
  config,
  category,
  fieldOrder = [],
  fieldRules = {},
  limit = 0
}) {
  const extracted = await extractExcelSeedData({
    category,
    config,
    fieldRules,
    fieldOrder
  });
  if (!extracted.enabled) {
    return {
      enabled: false,
      category,
      workbook_path: extracted.workbook_path || null,
      error: extracted.error || null,
      created: 0,
      skipped_existing: 0,
      products_seen: 0
    };
  }

  const selected = limit > 0 ? extracted.products.slice(0, limit) : extracted.products;
  let created = 0;
  let skippedExisting = 0;

  for (const product of selected) {
    const productId = buildProductId({
      category,
      brand: product.brand,
      model: product.model,
      variant: product.variant
    });
    if (!productId) {
      continue;
    }
    const s3key = toPosixKey(config.s3InputPrefix, category, 'products', `${productId}.json`);
    const exists = await storage.objectExists(s3key);
    if (exists) {
      skippedExisting += 1;
      continue;
    }
    const job = {
      productId,
      category,
      identityLock: {
        brand: product.brand,
        model: product.model,
        variant: product.variant
      },
      seedUrls: [],
      anchors: {},
      requirements: {
        requiredFields: toArray(fieldRules?.required_fields)
      },
      seed: {
        source: 'excel',
        workbook_path: extracted.workbook_path,
        sheet: extracted.sheet,
        source_column: product.source_column,
        source_type: 'user_helper_seed',
        captured_at: nowIso()
      }
    };

    await storage.writeObject(
      s3key,
      Buffer.from(`${JSON.stringify(job, null, 2)}\n`, 'utf8'),
      { contentType: 'application/json' }
    );
    await upsertQueueProduct({
      storage,
      category,
      productId,
      s3key,
      patch: {
        status: 'pending',
        next_action_hint: 'fast_pass'
      }
    });
    created += 1;
  }

  return {
    enabled: true,
    category,
    workbook_path: extracted.workbook_path,
    sheet: extracted.sheet,
    products_seen: extracted.products.length,
    created,
    skipped_existing: skippedExisting,
    field_count: extracted.field_rows.length
  };
}
