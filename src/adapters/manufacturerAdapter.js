import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mapPairsToFieldCandidates, extractTablePairs, extractIdentityFromPairs } from './tableParsing.js';
import {
  choosePdfBackend,
  normalizePdfBackend,
  normalizePdfPair,
  splitPdfPairsBySurface,
  summarizePdfDoc
} from '../extract/pdfBackendRouter.js';
import { normalizeWhitespace } from '../utils/common.js';

function filenameFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const base = path.basename(pathname) || 'document.pdf';
    return base.replace(/[^a-zA-Z0-9._-]/g, '_');
  } catch {
    return 'document.pdf';
  }
}

function findPdfUrls(html, baseUrl) {
  const urls = [];
  for (const match of String(html || '').matchAll(/href\s*=\s*["']([^"']+\.pdf(?:\?[^"']*)?)["']/gi)) {
    try {
      urls.push(new URL(match[1], baseUrl).toString());
    } catch {
      // ignore invalid
    }
  }
  return [...new Set(urls)];
}

function findSupportLikeUrls(html, baseUrl) {
  const urls = [];
  const regex = /href\s*=\s*["']([^"']+)["'][^>]*>/gi;
  for (const match of String(html || '').matchAll(regex)) {
    const href = match[1];
    if (!/support|manual|spec|specsheet|datasheet|documentation|technical/i.test(href)) {
      continue;
    }
    try {
      const absolute = new URL(href, baseUrl).toString();
      urls.push(absolute);
    } catch {
      // ignore invalid links
    }
  }
  return [...new Set(urls)];
}

function sameDomainFamily(sourceHost, targetUrl) {
  try {
    const host = new URL(targetUrl).hostname.toLowerCase();
    return (
      host === sourceHost
      || host.endsWith(`.${sourceHost}`)
      || sourceHost.endsWith(`.${host}`)
    );
  } catch {
    return false;
  }
}

function runCommand(command, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) {
        return;
      }
      finished = true;
      child.kill('SIGKILL');
      reject(new Error(`Command timeout: ${command}`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr || stdout || `command failed with code ${code}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function createEmptyPdfStats({
  routerEnabled = false,
  requestedBackend = 'auto'
} = {}) {
  return {
    router_enabled: Boolean(routerEnabled),
    requested_backend: normalizePdfBackend(requestedBackend, 'auto'),
    docs_discovered: 0,
    docs_fetched: 0,
    docs_parsed: 0,
    docs_failed: 0,
    backend_selected_counts: {},
    backend_fallback_count: 0,
    pair_count: 0,
    kv_pair_count: 0,
    table_pair_count: 0,
    pages_scanned: 0,
    tables_found: 0,
    scanned_docs_detected: 0,
    scanned_docs_ocr_attempted: 0,
    scanned_docs_ocr_succeeded: 0,
    scanned_ocr_pair_count: 0,
    scanned_ocr_kv_pair_count: 0,
    scanned_ocr_table_pair_count: 0,
    scanned_ocr_low_confidence_pairs: 0,
    scanned_ocr_confidence_sum: 0,
    scanned_ocr_confidence_count: 0,
    scanned_ocr_error_count: 0,
    scanned_ocr_backend_selected_counts: {},
    scanned_ocr_backend_selected: '',
    error_count: 0,
    errors: []
  };
}

function bumpBackendCount(stats, backend = '') {
  const token = normalizePdfBackend(backend, 'legacy');
  stats.backend_selected_counts[token] = Number(stats.backend_selected_counts[token] || 0) + 1;
}

function topBackendFromStats(stats = {}) {
  const rows = Object.entries(stats.backend_selected_counts || {});
  if (rows.length === 0) {
    return '';
  }
  rows.sort((a, b) => (Number(b[1] || 0) - Number(a[1] || 0)) || String(a[0]).localeCompare(String(b[0])));
  return String(rows[0][0] || '').trim();
}

function normalizeOcrBackend(value = '') {
  const token = String(value || '').trim().toLowerCase();
  if (['tesseract', 'paddleocr', 'none', 'auto'].includes(token)) {
    return token;
  }
  return token ? token : 'none';
}

function bumpOcrBackendCount(stats, backend = '') {
  const token = normalizeOcrBackend(backend);
  stats.scanned_ocr_backend_selected_counts[token] =
    Number(stats.scanned_ocr_backend_selected_counts[token] || 0) + 1;
}

function topOcrBackendFromStats(stats = {}) {
  const rows = Object.entries(stats.scanned_ocr_backend_selected_counts || {});
  if (rows.length === 0) {
    return '';
  }
  rows.sort((a, b) => (Number(b[1] || 0) - Number(a[1] || 0)) || String(a[0]).localeCompare(String(b[0])));
  return String(rows[0][0] || '').trim();
}

function normalizePairRows(rows = [], { backend = 'legacy' } = {}) {
  const out = [];
  let index = 0;
  for (const row of rows || []) {
    const normalized = normalizePdfPair(row, {
      backend,
      rowIndex: index,
      surfaceFallback: String(row?.surface || '').includes('table') ? 'pdf_table' : 'pdf_kv'
    });
    if (!normalized) {
      continue;
    }
    out.push(normalized);
    index += 1;
  }
  return out;
}

async function parsePdfViaPython(buffer, config = {}) {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-pdf-'));
  const pdfPath = path.join(tmpRoot, 'input.pdf');
  const outPath = path.join(tmpRoot, 'output.json');
  const routerEnabled = config?.pdfBackendRouterEnabled !== false;
  const requestedBackend = normalizePdfBackend(
    routerEnabled ? (config?.pdfPreferredBackend || 'auto') : 'pdfplumber',
    routerEnabled ? 'auto' : 'pdfplumber'
  );
  const maxPages = Math.max(1, Number.parseInt(String(config?.pdfBackendRouterMaxPages || 60), 10) || 60);
  const maxPairs = Math.max(100, Number.parseInt(String(config?.pdfBackendRouterMaxPairs || 5000), 10) || 5000);
  const maxTextPreviewChars = Math.max(
    1000,
    Number.parseInt(String(config?.pdfBackendRouterMaxTextPreviewChars || 20000), 10) || 20000
  );
  const timeoutMs = Math.max(10_000, Number.parseInt(String(config?.pdfBackendRouterTimeoutMs || 120000), 10) || 120000);
  const scannedOcrEnabled = config?.scannedPdfOcrEnabled === true;
  const scannedOcrBackend = String(config?.scannedPdfOcrBackend || 'auto').trim() || 'auto';
  const scannedOcrMaxPages = Math.max(1, Number.parseInt(String(config?.scannedPdfOcrMaxPages || 8), 10) || 8);
  const scannedOcrMaxPairs = Math.max(50, Number.parseInt(String(config?.scannedPdfOcrMaxPairs || 1200), 10) || 1200);
  const scannedOcrMinCharsPerPage = Math.max(
    0,
    Number.parseInt(String(config?.scannedPdfOcrMinCharsPerPage || 45), 10) || 45
  );
  const scannedOcrMinLinesPerPage = Math.max(
    0,
    Number.parseInt(String(config?.scannedPdfOcrMinLinesPerPage || 3), 10) || 3
  );
  const scannedOcrMinConfidence = Math.max(
    0,
    Math.min(1, Number.parseFloat(String(config?.scannedPdfOcrMinConfidence ?? 0.55)) || 0.55)
  );

  try {
    await fs.writeFile(pdfPath, buffer);
    await runCommand('python', [
      path.resolve('scripts', 'extract_pdf_kv.py'),
      '--pdf',
      pdfPath,
      '--out',
      outPath,
      '--backend',
      requestedBackend,
      '--max-pages',
      String(maxPages),
      '--max-text-preview-chars',
      String(maxTextPreviewChars),
      '--max-pairs',
      String(maxPairs),
      '--enable-scanned-ocr',
      scannedOcrEnabled ? '1' : '0',
      '--scanned-ocr-backend',
      scannedOcrBackend,
      '--scanned-ocr-max-pages',
      String(scannedOcrMaxPages),
      '--scanned-ocr-max-pairs',
      String(scannedOcrMaxPairs),
      '--scanned-ocr-min-chars-per-page',
      String(scannedOcrMinCharsPerPage),
      '--scanned-ocr-min-lines-per-page',
      String(scannedOcrMinLinesPerPage),
      '--scanned-ocr-min-confidence',
      String(scannedOcrMinConfidence)
    ], timeoutMs);

    const parsed = JSON.parse(await fs.readFile(outPath, 'utf8'));
    const backendMeta = parsed?.backend && typeof parsed.backend === 'object'
      ? parsed.backend
      : {};
    const parsedMeta = parsed?.meta && typeof parsed.meta === 'object'
      ? parsed.meta
      : {};
    const availability = backendMeta?.available && typeof backendMeta.available === 'object'
      ? backendMeta.available
      : {};
    const fingerprint = parsedMeta?.pdf_fingerprint && typeof parsedMeta.pdf_fingerprint === 'object'
      ? parsedMeta.pdf_fingerprint
      : {};
    const backendDecision = choosePdfBackend({
      requestedBackend: backendMeta?.requested || requestedBackend,
      availableBackends: availability,
      fingerprint
    });
    const backendSelected = normalizePdfBackend(
      backendMeta?.selected || backendDecision.selected_backend || 'legacy',
      'legacy'
    );
    const rawPairs = Array.isArray(parsed?.pairs) ? parsed.pairs : [];
    const rawKvPairs = Array.isArray(parsed?.kv_pairs) ? parsed.kv_pairs : [];
    const rawTablePairs = Array.isArray(parsed?.table_pairs) ? parsed.table_pairs : [];
    const rawOcrPairs = Array.isArray(parsed?.ocr_pairs) ? parsed.ocr_pairs : [];
    const rawOcrKvPairs = Array.isArray(parsed?.ocr_kv_pairs) ? parsed.ocr_kv_pairs : [];
    const rawOcrTablePairs = Array.isArray(parsed?.ocr_table_pairs) ? parsed.ocr_table_pairs : [];

    const normalizedPairs = normalizePairRows(rawPairs, { backend: backendSelected });
    const normalizedKvPairs = rawKvPairs.length > 0
      ? normalizePairRows(rawKvPairs, { backend: backendSelected })
      : [];
    const normalizedTablePairs = rawTablePairs.length > 0
      ? normalizePairRows(rawTablePairs, { backend: backendSelected })
      : [];
    const split = splitPdfPairsBySurface(normalizedPairs);
    const kvPairs = normalizedKvPairs.length > 0 ? normalizedKvPairs : split.kvPairs;
    const tablePairs = normalizedTablePairs.length > 0 ? normalizedTablePairs : split.tablePairs;
    const ocrBackendSelected = String(parsedMeta?.scanned_pdf_ocr_backend_selected || '').trim() || 'none';
    const normalizedOcrPairs = normalizePairRows(rawOcrPairs, { backend: ocrBackendSelected });
    const normalizedOcrKvPairs = rawOcrKvPairs.length > 0
      ? normalizePairRows(rawOcrKvPairs, { backend: ocrBackendSelected })
      : splitPdfPairsBySurface(normalizedOcrPairs).scannedKvPairs;
    const normalizedOcrTablePairs = rawOcrTablePairs.length > 0
      ? normalizePairRows(rawOcrTablePairs, { backend: ocrBackendSelected })
      : splitPdfPairsBySurface(normalizedOcrPairs).scannedTablePairs;
    const textPreview = normalizeWhitespace(parsed?.text_preview || '').slice(0, 20000);
    const ocrTextPreview = normalizeWhitespace(parsed?.ocr_text_preview || '').slice(0, 20000);
    const pages = Array.isArray(parsed?.pages) ? parsed.pages : [];
    const errors = Array.isArray(parsed?.errors)
      ? parsed.errors.map((row) => normalizeWhitespace(String(row || ''))).filter(Boolean)
      : [];
    return {
      ok: Boolean(parsed?.ok),
      backend: {
        requested: normalizePdfBackend(backendMeta?.requested || requestedBackend, requestedBackend),
        selected: backendSelected,
        fallback_used: Boolean(backendMeta?.fallback_used || backendDecision.fallback_used || false),
        reason: String(backendMeta?.reason || backendDecision.reason || '').trim()
      },
      pairs: normalizedPairs,
      kvPairs,
      tablePairs,
      ocrPairs: normalizedOcrPairs,
      ocrKvPairs: normalizedOcrKvPairs,
      ocrTablePairs: normalizedOcrTablePairs,
      textPreview,
      ocrTextPreview,
      pages,
      meta: {
        ...parsedMeta,
        backend_selected: backendSelected,
        backend_requested: normalizePdfBackend(backendMeta?.requested || requestedBackend, requestedBackend),
        backend_fallback_used: Boolean(backendMeta?.fallback_used || backendDecision.fallback_used || false),
        backend_reason: String(backendMeta?.reason || backendDecision.reason || '').trim(),
        pages_scanned: Number(parsedMeta?.pages_scanned || pages.length || 0),
        tables_found: Number(parsedMeta?.tables_found || 0),
        pairs_after_dedupe: Number(parsedMeta?.pairs_after_dedupe || normalizedPairs.length || 0),
        kv_pairs_count: Number(parsedMeta?.kv_pairs_count || kvPairs.length || 0),
        table_pairs_count: Number(parsedMeta?.table_pairs_count || tablePairs.length || 0),
        scanned_pdf_detected: Boolean(parsedMeta?.scanned_pdf_detected),
        scanned_pdf_ocr_enabled: Boolean(parsedMeta?.scanned_pdf_ocr_enabled),
        scanned_pdf_ocr_attempted: Boolean(parsedMeta?.scanned_pdf_ocr_attempted),
        scanned_pdf_ocr_backend_requested: String(parsedMeta?.scanned_pdf_ocr_backend_requested || '').trim(),
        scanned_pdf_ocr_backend_selected: ocrBackendSelected,
        scanned_pdf_ocr_backend_fallback_used: Boolean(parsedMeta?.scanned_pdf_ocr_backend_fallback_used),
        scanned_pdf_ocr_pair_count: Number(parsedMeta?.scanned_pdf_ocr_pair_count || normalizedOcrPairs.length || 0),
        scanned_pdf_ocr_kv_pair_count: Number(parsedMeta?.scanned_pdf_ocr_kv_pair_count || normalizedOcrKvPairs.length || 0),
        scanned_pdf_ocr_table_pair_count: Number(parsedMeta?.scanned_pdf_ocr_table_pair_count || normalizedOcrTablePairs.length || 0),
        scanned_pdf_ocr_confidence_avg: Number(parsedMeta?.scanned_pdf_ocr_confidence_avg || 0),
        scanned_pdf_ocr_low_confidence_pairs: Number(parsedMeta?.scanned_pdf_ocr_low_confidence_pairs || 0),
        scanned_pdf_ocr_error: String(parsedMeta?.scanned_pdf_ocr_error || '').trim()
      },
      errors
    };
  } catch (error) {
    return {
      ok: false,
      backend: {
        requested: requestedBackend,
        selected: 'legacy',
        fallback_used: true,
        reason: 'python_extract_failed'
      },
      pairs: [],
      kvPairs: [],
      tablePairs: [],
      ocrPairs: [],
      ocrKvPairs: [],
      ocrTablePairs: [],
      textPreview: '',
      ocrTextPreview: '',
      pages: [],
      meta: {
        backend_selected: 'legacy',
        backend_requested: requestedBackend,
        backend_fallback_used: true,
        backend_reason: 'python_extract_failed',
        pages_scanned: 0,
        tables_found: 0,
        pairs_after_dedupe: 0,
        kv_pairs_count: 0,
        table_pairs_count: 0,
        scanned_pdf_detected: false,
        scanned_pdf_ocr_enabled: false,
        scanned_pdf_ocr_attempted: false,
        scanned_pdf_ocr_backend_requested: '',
        scanned_pdf_ocr_backend_selected: 'none',
        scanned_pdf_ocr_backend_fallback_used: false,
        scanned_pdf_ocr_pair_count: 0,
        scanned_pdf_ocr_kv_pair_count: 0,
        scanned_pdf_ocr_table_pair_count: 0,
        scanned_pdf_ocr_confidence_avg: 0,
        scanned_pdf_ocr_low_confidence_pairs: 0,
        scanned_pdf_ocr_error: ''
      },
      errors: [String(error?.message || 'python_extract_failed').slice(0, 220)]
    };
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
}

function mapPdfTextToCandidates(text, method = 'pdf_kv') {
  if (!text) {
    return [];
  }

  const pairs = [];
  const methodToken = String(method || '').trim().toLowerCase();
  const rowSurface = methodToken.includes('scanned_pdf_ocr') ? 'scanned_pdf_ocr_kv' : 'pdf_kv';
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .slice(0, 1200);

  for (const line of lines) {
    const parts = line.split(/[:\-]/);
    if (parts.length < 2) {
      continue;
    }
    const key = parts[0];
    const value = parts.slice(1).join(':').trim();
    if (key && value) {
      pairs.push({
        key,
        value,
        surface: rowSurface
      });
    }
  }

  return mapPairsToFieldCandidates(pairs, method);
}

function compactPdfRows(rows = [], limit = 20) {
  const out = [];
  for (const row of rows.slice(0, limit)) {
    const key = normalizeWhitespace(String(row?.key || '')).trim();
    const value = normalizeWhitespace(String(row?.value || '')).trim();
    if (!key || !value) {
      continue;
    }
    out.push({
      key,
      value,
      path: String(row?.path || '').trim() || null,
      surface: String(row?.surface || '').trim() || null,
      page: Number.parseInt(String(row?.page || 0), 10) || null,
      row_id: String(row?.row_id || '').trim() || null,
      ocr_confidence: Number.isFinite(Number(row?.ocr_confidence))
        ? Number(row.ocr_confidence)
        : null,
      ocr_low_confidence: Boolean(row?.ocr_low_confidence)
    });
  }
  return out;
}

export const manufacturerAdapter = {
  name: 'manufacturer',

  supportsHost({ source }) {
    return source.role === 'manufacturer';
  },

  async extractFromPage({ source, pageData, config }) {
    const pairs = extractTablePairs(pageData.html || '', {
      useV2: config?.htmlTableExtractorV2 !== false
    });
    const fieldCandidates = mapPairsToFieldCandidates(pairs, 'html_table');
    const identityCandidates = extractIdentityFromPairs(pairs);

    const additionalUrls = findSupportLikeUrls(pageData.html, source.url)
      .filter((url) => sameDomainFamily(source.host, url));

    const pdfUrls = findPdfUrls(pageData.html, source.url)
      .filter((url) => sameDomainFamily(source.host, url));

    const pdfDocs = [];
    const pdfFieldCandidates = [];
    const pdfStats = createEmptyPdfStats({
      routerEnabled: config?.pdfBackendRouterEnabled !== false,
      requestedBackend: config?.pdfPreferredBackend || 'auto'
    });
    pdfStats.docs_discovered = pdfUrls.length;
    const scannedOcrPromoteCandidates = config?.scannedPdfOcrEnabled === true
      && config?.scannedPdfOcrPromoteCandidates === true;

    for (const pdfUrl of pdfUrls.slice(0, 4)) {
      try {
        const response = await fetch(pdfUrl, {
          method: 'GET',
          headers: {
            'User-Agent': config.userAgent
          }
        });

        if (!response.ok) {
          pdfStats.docs_failed += 1;
          continue;
        }

        pdfStats.docs_fetched += 1;
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > config.maxPdfBytes) {
          pdfStats.docs_failed += 1;
          pdfStats.error_count += 1;
          pdfStats.errors.push(`pdf_too_large:${pdfUrl}`);
          continue;
        }

        const parsed = await parsePdfViaPython(bytes, config);
        const tableCandidates = mapPairsToFieldCandidates(parsed.tablePairs, 'pdf_table');
        const kvCandidates = mapPairsToFieldCandidates(parsed.kvPairs, 'pdf_kv');
        const textCandidates = mapPdfTextToCandidates(parsed.textPreview, 'pdf_kv');
        pdfFieldCandidates.push(...tableCandidates, ...kvCandidates, ...textCandidates);
        const ocrTableCandidates = scannedOcrPromoteCandidates
          ? mapPairsToFieldCandidates(parsed.ocrTablePairs || [], 'scanned_pdf_ocr_table')
          : [];
        const ocrKvCandidates = scannedOcrPromoteCandidates
          ? mapPairsToFieldCandidates(parsed.ocrKvPairs || [], 'scanned_pdf_ocr_kv')
          : [];
        const ocrTextCandidates = scannedOcrPromoteCandidates
          ? mapPdfTextToCandidates(parsed.ocrTextPreview || '', 'scanned_pdf_ocr_text')
          : [];
        pdfFieldCandidates.push(...ocrTableCandidates, ...ocrKvCandidates, ...ocrTextCandidates);

        const summary = summarizePdfDoc({
          pairs: parsed.pairs,
          backend_selected: parsed?.backend?.selected,
          backend_requested: parsed?.backend?.requested,
          backend_fallback_used: parsed?.backend?.fallback_used,
          pages_scanned: parsed?.meta?.pages_scanned,
          tables_found: parsed?.meta?.tables_found
        });
        pdfStats.docs_parsed += parsed.ok ? 1 : 0;
        pdfStats.docs_failed += parsed.ok ? 0 : 1;
        pdfStats.backend_fallback_count += summary.backend_fallback_used ? 1 : 0;
        pdfStats.pair_count += summary.pair_count;
        pdfStats.kv_pair_count += summary.kv_pair_count;
        pdfStats.table_pair_count += summary.table_pair_count;
        pdfStats.pages_scanned += summary.pages_scanned;
        pdfStats.tables_found += summary.tables_found;
        bumpBackendCount(pdfStats, summary.backend_selected);
        const scannedDetected = Boolean(parsed?.meta?.scanned_pdf_detected);
        const scannedOcrAttempted = Boolean(parsed?.meta?.scanned_pdf_ocr_attempted);
        const scannedOcrPairCount = Number(parsed?.meta?.scanned_pdf_ocr_pair_count || 0);
        const scannedOcrKvPairCount = Number(parsed?.meta?.scanned_pdf_ocr_kv_pair_count || 0);
        const scannedOcrTablePairCount = Number(parsed?.meta?.scanned_pdf_ocr_table_pair_count || 0);
        const scannedOcrLowConfidencePairs = Number(parsed?.meta?.scanned_pdf_ocr_low_confidence_pairs || 0);
        const scannedOcrConfidenceAvg = Number(parsed?.meta?.scanned_pdf_ocr_confidence_avg || 0);
        const scannedOcrError = String(parsed?.meta?.scanned_pdf_ocr_error || '').trim();
        const scannedOcrBackendSelected = String(parsed?.meta?.scanned_pdf_ocr_backend_selected || '').trim() || 'none';
        pdfStats.scanned_docs_detected += scannedDetected ? 1 : 0;
        pdfStats.scanned_docs_ocr_attempted += scannedOcrAttempted ? 1 : 0;
        pdfStats.scanned_docs_ocr_succeeded += scannedOcrPairCount > 0 ? 1 : 0;
        pdfStats.scanned_ocr_pair_count += Math.max(0, scannedOcrPairCount);
        pdfStats.scanned_ocr_kv_pair_count += Math.max(0, scannedOcrKvPairCount);
        pdfStats.scanned_ocr_table_pair_count += Math.max(0, scannedOcrTablePairCount);
        pdfStats.scanned_ocr_low_confidence_pairs += Math.max(0, scannedOcrLowConfidencePairs);
        if (Number.isFinite(scannedOcrConfidenceAvg) && scannedOcrConfidenceAvg > 0) {
          pdfStats.scanned_ocr_confidence_sum += scannedOcrConfidenceAvg;
          pdfStats.scanned_ocr_confidence_count += 1;
        }
        if (scannedOcrError) {
          pdfStats.error_count += 1;
          pdfStats.scanned_ocr_error_count += 1;
          pdfStats.errors.push(`scanned_pdf_ocr:${scannedOcrError}`.slice(0, 220));
        }
        if (scannedOcrAttempted) {
          bumpOcrBackendCount(pdfStats, scannedOcrBackendSelected);
        }
        if (Array.isArray(parsed?.errors) && parsed.errors.length > 0) {
          pdfStats.error_count += parsed.errors.length;
          for (const row of parsed.errors.slice(0, 8)) {
            pdfStats.errors.push(String(row).slice(0, 220));
          }
        }

        pdfDocs.push({
          url: pdfUrl,
          filename: filenameFromUrl(pdfUrl),
          bytes,
          textPreview: parsed.textPreview.slice(0, 8000),
          backend_selected: summary.backend_selected,
          backend_requested: summary.backend_requested,
          backend_fallback_used: summary.backend_fallback_used,
          pair_count: summary.pair_count,
          kv_pair_count: summary.kv_pair_count,
          table_pair_count: summary.table_pair_count,
          pages_scanned: summary.pages_scanned,
          tables_found: summary.tables_found,
          kv_preview_rows: compactPdfRows(parsed.kvPairs, 18),
          table_preview_rows: compactPdfRows(parsed.tablePairs, 18),
          ocr_text_preview: String(parsed.ocrTextPreview || '').slice(0, 8000),
          ocr_kv_preview_rows: compactPdfRows(parsed.ocrKvPairs || [], 18),
          ocr_table_preview_rows: compactPdfRows(parsed.ocrTablePairs || [], 18),
          scanned_pdf_detected: scannedDetected,
          scanned_pdf_ocr_attempted: scannedOcrAttempted,
          scanned_pdf_ocr_backend_selected: scannedOcrBackendSelected,
          scanned_pdf_ocr_backend_requested: String(parsed?.meta?.scanned_pdf_ocr_backend_requested || '').trim(),
          scanned_pdf_ocr_pair_count: Math.max(0, scannedOcrPairCount),
          scanned_pdf_ocr_kv_pair_count: Math.max(0, scannedOcrKvPairCount),
          scanned_pdf_ocr_table_pair_count: Math.max(0, scannedOcrTablePairCount),
          scanned_pdf_ocr_confidence_avg: Number.isFinite(scannedOcrConfidenceAvg) ? scannedOcrConfidenceAvg : 0,
          scanned_pdf_ocr_low_confidence_pairs: Math.max(0, scannedOcrLowConfidencePairs),
          scanned_pdf_ocr_error: scannedOcrError || '',
          meta: parsed.meta || {}
        });
      } catch {
        pdfStats.docs_failed += 1;
      }
    }

    return {
      fieldCandidates: [...fieldCandidates, ...pdfFieldCandidates],
      identityCandidates,
      additionalUrls,
      pdfDocs,
      pdfStats: {
        ...pdfStats,
        scanned_ocr_backend_selected: topOcrBackendFromStats(pdfStats),
        scanned_ocr_confidence_avg: pdfStats.scanned_ocr_confidence_count > 0
          ? Number((pdfStats.scanned_ocr_confidence_sum / pdfStats.scanned_ocr_confidence_count).toFixed(6))
          : 0,
        backend_selected: topBackendFromStats(pdfStats),
        errors: pdfStats.errors.slice(0, 20)
      }
    };
  }
};
