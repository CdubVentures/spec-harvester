# 06 - Text PDF Extraction

## Goal
Increase PDF extraction fidelity for technical specs, tables, and unit-heavy fields.

## Status
- Implemented now (2026-02-20 baseline):
  - Added PDF backend router utility + normalized pair model:
    - `src/extract/pdfBackendRouter.js`
  - Upgraded Python extractor contract with backend metadata and surface split:
    - `scripts/extract_pdf_kv.py`
    - response now includes `backend`, `pairs`, `kv_pairs`, `table_pairs`, and `meta.pdf_fingerprint`
  - Wired manufacturer adapter to emit `pdf_table` + `pdf_kv` candidates:
    - `src/adapters/manufacturerAdapter.js`
  - Added adapter-level PDF stats merge for runtime telemetry:
    - `src/adapters/index.js`
  - Exposed per-source PDF telemetry in runtime events:
    - `src/pipeline/runProduct.js` (`source_processed` payload)
  - Added PDF evidence snippets and packet metadata:
    - `src/evidence/evidencePackV2.js`
  - Fixed packet routing bug so `pdf_table`/`pdf_kv` map to Phase 06 correctly:
    - `src/indexlab/indexingSchemaPackets.js`
  - Added GUI proof counters/columns for PDF extraction:
    - `tools/gui-react/src/pages/indexing/IndexingPage.tsx`
  - Added config knobs:
    - `PDF_BACKEND_ROUTER_ENABLED`
    - `PDF_PREFERRED_BACKEND`
    - `PDF_BACKEND_ROUTER_TIMEOUT_MS`
    - `PDF_BACKEND_ROUTER_MAX_PAGES`
    - `PDF_BACKEND_ROUTER_MAX_PAIRS`
    - `PDF_BACKEND_ROUTER_MAX_TEXT_PREVIEW_CHARS`

## Current State
- Primary code paths:
  - `scripts/extract_pdf_kv.py`
  - `src/adapters/manufacturerAdapter.js`
  - `src/extract/pdfBackendRouter.js`
- Strengths:
  - Backend selection is now explicit and traceable (`requested`, `selected`, `fallback_used`).
  - PDF rows are normalized to stable surfaces (`pdf_kv`, `pdf_table`) and paths.
  - Source telemetry now includes parsed doc counts, pair counts, backend counts, and errors.
- Remaining limits:
  - `camelot`/`tabula`/`pymupdf` still depend on local optional installs.
  - OCR for scanned/image-only PDFs stays in Phase 07.

## Target Design (Delivered)
- PDF backend selection:
  - text-heavy docs -> `pdfplumber`
  - table-dense docs -> `camelot` when available
  - fallback -> `pymupdf` / legacy
- Standard PDF artifact row:
  - `page`
  - `surface` (`pdf_kv`, `pdf_table`)
  - `raw_key`, `raw_value`, `normalized_key`, `normalized_value`
  - `path`, `row_id`, optional `bbox`

## Validation
- Added/updated tests:
  - `test/pdfBackendRouter.test.js`
  - `test/evidencePackV2.test.js` (PDF snippet/metadata checks)
  - `test/indexingSchemaPacketsPdfPhase.test.js` (Phase 06 routing and surfaces)
  - `test/configArticleExtractor.test.js` (PDF router env parsing)
- GUI proof:
  - Event Stream counters now include PDF docs/pairs.
  - Recent URL Jobs now shows PDF docs, backend, and pair counts.
  - Phase 05 runtime panel now shows Phase 06 PDF extraction totals (`docs`, `pairs`, `kv`, `table`, `pages`, `errors`).

## Rollout
- Feature flag: `PDF_BACKEND_ROUTER_ENABLED=true`.
- Keep `pdfplumber` as stable fallback when optional backends are missing.
