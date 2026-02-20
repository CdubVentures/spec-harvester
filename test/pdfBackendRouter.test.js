import test from 'node:test';
import assert from 'node:assert/strict';
import {
  choosePdfBackend,
  normalizePdfBackend,
  normalizePdfPair,
  splitPdfPairsBySurface,
  summarizePdfDoc
} from '../src/extract/pdfBackendRouter.js';

test('pdf backend router chooses camelot for table-dense auto fingerprint when available', () => {
  const decision = choosePdfBackend({
    requestedBackend: 'auto',
    availableBackends: {
      pdfplumber: true,
      camelot: true,
      pymupdf: true
    },
    fingerprint: {
      pages_scanned: 10,
      tables_found: 8
    }
  });
  assert.equal(decision.selected_backend, 'camelot');
  assert.equal(decision.reason, 'auto_table_dense');
});

test('pdf backend router falls back when requested backend is unavailable', () => {
  const decision = choosePdfBackend({
    requestedBackend: 'camelot',
    availableBackends: {
      pdfplumber: true,
      camelot: false
    },
    fingerprint: {
      pages_scanned: 4,
      tables_found: 0
    }
  });
  assert.equal(decision.requested_backend, 'camelot');
  assert.equal(decision.selected_backend, 'pdfplumber');
  assert.equal(decision.fallback_used, true);
});

test('pdf pair normalizer emits stable path/surface and split helper separates kv/table', () => {
  const kv = normalizePdfPair(
    { key: 'Weight', value: '60 g', page: 2, surface: 'pdf_kv' },
    { backend: 'pdfplumber', rowIndex: 0 }
  );
  const table = normalizePdfPair(
    { key: 'Polling Rate', value: '8000 Hz', page: 2, surface: 'pdf_table', table_id: 'p2_t1' },
    { backend: 'pdfplumber', rowIndex: 1 }
  );
  assert.equal(Boolean(kv), true);
  assert.equal(Boolean(table), true);
  const split = splitPdfPairsBySurface([kv, table]);
  assert.equal(split.kvPairs.length, 1);
  assert.equal(split.tablePairs.length, 1);
  assert.equal(String(split.kvPairs[0].path).startsWith('pdf.page[2].kv['), true);
  assert.equal(String(split.tablePairs[0].path).includes('table[p2_t1]'), true);
});

test('pdf summary reports backend and pair totals', () => {
  const summary = summarizePdfDoc({
    backend_selected: 'pdfplumber',
    backend_requested: 'auto',
    backend_fallback_used: false,
    pages_scanned: 3,
    tables_found: 1,
    pairs: [
      normalizePdfPair({ key: 'Weight', value: '60 g', surface: 'pdf_kv' }, { backend: 'pdfplumber', rowIndex: 0 }),
      normalizePdfPair({ key: 'Polling Rate', value: '8000 Hz', surface: 'pdf_table' }, { backend: 'pdfplumber', rowIndex: 1 })
    ]
  });
  assert.equal(summary.backend_selected, 'pdfplumber');
  assert.equal(summary.backend_requested, 'auto');
  assert.equal(summary.pair_count, 2);
  assert.equal(summary.kv_pair_count, 1);
  assert.equal(summary.table_pair_count, 1);
  assert.equal(summary.pages_scanned, 3);
});

test('normalizePdfBackend clamps unknown tokens', () => {
  assert.equal(normalizePdfBackend('tabula', 'auto'), 'tabula');
  assert.equal(normalizePdfBackend('invalid-backend', 'auto'), 'auto');
});
