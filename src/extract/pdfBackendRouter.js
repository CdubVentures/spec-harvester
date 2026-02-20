import { normalizeWhitespace } from '../utils/common.js';

const SUPPORTED_BACKENDS = new Set([
  'auto',
  'pdfplumber',
  'pymupdf',
  'camelot',
  'tabula',
  'legacy'
]);

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toFloat(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const token = String(value).trim().toLowerCase();
  return token === '1' || token === 'true' || token === 'yes' || token === 'on';
}

function normalizeToken(value = '') {
  return String(value || '').trim().toLowerCase();
}

function normalizePath(value = '') {
  return String(value || '').trim().replace(/\s+/g, '');
}

function normalizePdfSurface(value = '', fallback = 'pdf_kv') {
  const token = normalizeToken(value || fallback);
  if (token === 'pdf_table') return 'pdf_table';
  if (token === 'pdf_kv') return 'pdf_kv';
  if (token === 'scanned_pdf_ocr_table') return 'scanned_pdf_ocr_table';
  if (token === 'scanned_pdf_ocr_kv') return 'scanned_pdf_ocr_kv';
  return normalizeToken(fallback) === 'pdf_table' ? 'pdf_table' : 'pdf_kv';
}

function normalizePdfRowBackend(value = '', fallback = 'legacy') {
  const strict = normalizePdfBackend(value, '');
  if (strict !== 'auto') {
    return strict;
  }
  const token = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (token) {
    return token;
  }
  return normalizePdfBackend(fallback || 'legacy', 'legacy');
}

function normalizeBackendAvailability(availableBackends = {}) {
  return {
    pdfplumber: toBool(availableBackends?.pdfplumber, false),
    pymupdf: toBool(availableBackends?.pymupdf, false),
    camelot: toBool(availableBackends?.camelot, false),
    tabula: toBool(availableBackends?.tabula, false)
  };
}

export function normalizePdfBackend(value = '', fallback = 'auto') {
  const token = normalizeToken(value);
  if (SUPPORTED_BACKENDS.has(token)) {
    return token;
  }
  return SUPPORTED_BACKENDS.has(normalizeToken(fallback)) ? normalizeToken(fallback) : 'auto';
}

export function choosePdfBackend({
  requestedBackend = 'auto',
  availableBackends = {},
  fingerprint = {}
} = {}) {
  const requested = normalizePdfBackend(requestedBackend, 'auto');
  const available = normalizeBackendAvailability(availableBackends);
  const pagesScanned = Math.max(0, toInt(fingerprint?.pages_scanned, 0));
  const tablesFound = Math.max(0, toInt(fingerprint?.tables_found, 0));
  const tableDensity = pagesScanned > 0 ? tablesFound / pagesScanned : 0;
  const fallbackOrder = [];

  if (tableDensity >= 0.35) {
    fallbackOrder.push('camelot');
  }
  fallbackOrder.push('pdfplumber', 'pymupdf', 'tabula');
  const ranked = [...new Set(fallbackOrder)];

  const firstAvailable = ranked.find((backend) => available[backend]);
  if (requested !== 'auto') {
    if (requested === 'legacy') {
      return {
        requested_backend: requested,
        selected_backend: 'legacy',
        fallback_used: false,
        reason: 'requested_legacy',
        table_density: Number(tableDensity.toFixed(6)),
        pages_scanned: pagesScanned,
        tables_found: tablesFound,
        available_backends: available
      };
    }
    if (available[requested]) {
      return {
        requested_backend: requested,
        selected_backend: requested,
        fallback_used: false,
        reason: `requested_${requested}`,
        table_density: Number(tableDensity.toFixed(6)),
        pages_scanned: pagesScanned,
        tables_found: tablesFound,
        available_backends: available
      };
    }
    return {
      requested_backend: requested,
      selected_backend: firstAvailable || 'legacy',
      fallback_used: true,
      reason: firstAvailable ? `requested_unavailable_fallback_${firstAvailable}` : 'requested_unavailable_no_backend',
      table_density: Number(tableDensity.toFixed(6)),
      pages_scanned: pagesScanned,
      tables_found: tablesFound,
      available_backends: available
    };
  }

  if (firstAvailable) {
    return {
      requested_backend: requested,
      selected_backend: firstAvailable,
      fallback_used: false,
      reason: tableDensity >= 0.35 && firstAvailable === 'camelot'
        ? 'auto_table_dense'
        : `auto_${firstAvailable}`,
      table_density: Number(tableDensity.toFixed(6)),
      pages_scanned: pagesScanned,
      tables_found: tablesFound,
      available_backends: available
    };
  }

  return {
    requested_backend: requested,
    selected_backend: 'legacy',
    fallback_used: false,
    reason: 'auto_no_backend_available',
    table_density: Number(tableDensity.toFixed(6)),
    pages_scanned: pagesScanned,
    tables_found: tablesFound,
    available_backends: available
  };
}

function inferUnitHint(key = '', value = '') {
  const token = `${String(key || '')} ${String(value || '')}`.toLowerCase();
  if (/\b(?:dpi|cpi)\b/.test(token)) return 'dpi';
  if (/\b(?:hz|khz)\b/.test(token)) return 'hz';
  if (/\b(?:mm|cm|inch|inches|in)\b|"/.test(token)) return 'mm';
  if (/\b(?:g|gram|grams|kg|lb|lbs|pound|pounds|oz)\b/.test(token)) return 'g';
  if (/\b(?:mah)\b/.test(token)) return 'mah';
  if (/\b(?:hour|hours|hr|hrs|min|mins|minute|minutes)\b/.test(token)) return 'h';
  return '';
}

function normalizeBbox(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const out = {};
  const fields = ['x0', 'y0', 'x1', 'y1', 'width', 'height'];
  for (const key of fields) {
    const num = toFloat(value[key], NaN);
    if (Number.isFinite(num)) {
      out[key] = num;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function defaultPath({
  page = 0,
  rowIndex = 0,
  tableId = '',
  surface = 'pdf_kv'
} = {}) {
  const pageToken = Math.max(1, toInt(page, 1));
  const rowToken = Math.max(1, toInt(rowIndex, 1));
  if (surface === 'pdf_table' || surface === 'scanned_pdf_ocr_table') {
    const table = String(tableId || '').trim() || `t${pageToken}`;
    if (surface === 'scanned_pdf_ocr_table') {
      return `scanned_pdf.page[${pageToken}].table[${table}].row[${rowToken}]`;
    }
    return `pdf.page[${pageToken}].table[${table}].row[${rowToken}]`;
  }
  if (surface === 'scanned_pdf_ocr_kv') {
    return `scanned_pdf.page[${pageToken}].kv[${rowToken}]`;
  }
  return `pdf.page[${pageToken}].kv[${rowToken}]`;
}

export function normalizePdfPair(row = {}, {
  backend = '',
  rowIndex = 0,
  surfaceFallback = 'pdf_kv'
} = {}) {
  const rawKey = normalizeWhitespace(String(row?.raw_key || row?.key || '')).trim();
  const rawValue = normalizeWhitespace(String(row?.raw_value || row?.value || '')).trim();
  if (!rawKey || !rawValue) {
    return null;
  }

  const normalizedKey = normalizeWhitespace(String(row?.normalized_key || rawKey)).trim() || rawKey;
  const normalizedValue = normalizeWhitespace(String(row?.normalized_value || rawValue)).trim() || rawValue;
  const surface = normalizePdfSurface(row?.surface, surfaceFallback);
  const page = Math.max(1, toInt(row?.page, 1));
  const tableId = String(row?.table_id || '').trim() || null;
  const rowPrefix = (
    surface === 'pdf_table'
      ? 'tr'
      : surface === 'scanned_pdf_ocr_table'
        ? 'ocr_tr'
        : surface === 'scanned_pdf_ocr_kv'
          ? 'ocr_kv'
          : 'kv'
  );
  const rowIdPrefix = surface.startsWith('scanned_pdf_ocr') ? 'sc_pdf' : 'pdf';
  const rowId = String(row?.row_id || '').trim()
    || `${rowIdPrefix}_${String(page).padStart(2, '0')}.${rowPrefix}_${String(Math.max(1, rowIndex + 1)).padStart(4, '0')}`;
  const path = normalizePath(row?.path || '')
    || defaultPath({
      page,
      rowIndex: rowIndex + 1,
      tableId: tableId || '',
      surface
    });
  const bbox = normalizeBbox(row?.bbox);
  const backendToken = normalizePdfRowBackend(row?.backend || backend || 'legacy', 'legacy');
  const sectionHeader = normalizeWhitespace(String(row?.section_header || '')).trim() || null;
  const columnHeader = normalizeWhitespace(String(row?.column_header || '')).trim() || null;
  const unitHint = normalizeWhitespace(String(row?.unit_hint || inferUnitHint(normalizedKey, normalizedValue))).trim() || null;
  const ocrConfidence = toFloat(row?.ocr_confidence, NaN);
  const ocrLowConfidence = toBool(row?.ocr_low_confidence, false);

  return {
    key: rawKey,
    value: rawValue,
    raw_key: rawKey,
    raw_value: rawValue,
    normalized_key: normalizedKey,
    normalized_value: normalizedValue,
    table_id: tableId,
    row_id: rowId,
    section_header: sectionHeader,
    column_header: columnHeader,
    unit_hint: unitHint,
    surface,
    path,
    page,
    bbox,
    backend: backendToken,
    ...(Number.isFinite(ocrConfidence) ? { ocr_confidence: ocrConfidence } : {}),
    ...(ocrLowConfidence ? { ocr_low_confidence: true } : {})
  };
}

export function splitPdfPairsBySurface(rows = []) {
  const allPairs = [];
  const tablePairs = [];
  const kvPairs = [];
  const scannedTablePairs = [];
  const scannedKvPairs = [];
  for (const row of rows || []) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const surface = normalizePdfSurface(row.surface || '', 'pdf_kv');
    allPairs.push(row);
    if (surface === 'pdf_table') {
      tablePairs.push(row);
    } else if (surface === 'scanned_pdf_ocr_table') {
      scannedTablePairs.push(row);
    } else if (surface === 'scanned_pdf_ocr_kv') {
      scannedKvPairs.push(row);
    } else {
      kvPairs.push(row);
    }
  }
  return {
    allPairs,
    tablePairs,
    kvPairs,
    scannedTablePairs,
    scannedKvPairs
  };
}

export function summarizePdfDoc(doc = {}) {
  const pairRows = Array.isArray(doc?.pairs) ? doc.pairs : [];
  const split = splitPdfPairsBySurface(pairRows);
  const pagesScanned = Math.max(
    0,
    toInt(doc?.meta?.pages_scanned, toInt(doc?.pages_scanned, 0))
  );
  const tablesFound = Math.max(
    0,
    toInt(doc?.meta?.tables_found, toInt(doc?.tables_found, 0))
  );
  const backendSelected = normalizePdfBackend(
    doc?.backend_selected
      || doc?.backend?.selected
      || doc?.backend_selected_name
      || doc?.meta?.backend_selected
      || 'legacy',
    'legacy'
  );
  const backendRequested = normalizePdfBackend(
    doc?.backend_requested
      || doc?.backend?.requested
      || doc?.meta?.backend_requested
      || 'auto',
    'auto'
  );
  const backendFallbackUsed = toBool(
    doc?.backend_fallback_used
      ?? doc?.backend?.fallback_used
      ?? doc?.meta?.backend_fallback_used,
    false
  );
  return {
    backend_selected: backendSelected,
    backend_requested: backendRequested,
    backend_fallback_used: backendFallbackUsed,
    pair_count: split.allPairs.length,
    kv_pair_count: split.kvPairs.length,
    table_pair_count: split.tablePairs.length,
    pages_scanned: pagesScanned,
    tables_found: tablesFound
  };
}
