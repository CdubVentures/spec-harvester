# 06 - Text PDF Extraction

## Goal
Increase PDF extraction fidelity for technical specs, tables, and unit-heavy fields.

## Current State
- Primary code paths:
  - `src/extract/pdfTableExtractor.js` (`pdf-parse` + heuristics)
  - `src/adapters/manufacturerAdapter.js` (Python script invocation)
  - `scripts/extract_pdf_kv.py` (`pdfplumber` extraction)
- Strengths:
  - Existing PDF path already contributes field candidates.
  - Python route is more structured than plain text-only extraction.
- Weaknesses:
  - Heuristic parsing can miss dense technical tables.
  - No dynamic backend selection by PDF layout type.
  - Limited unit/row structure typing.

## Missing But Should Use
- `PyMuPDF` for fast block extraction and rendering metadata.
- `Camelot` or `Tabula` for table-heavy machine PDFs.

## Target Design
- PDF backend selection:
  - text-dense manual -> `pdfplumber`
  - table-grid heavy -> `camelot/tabula`
  - mixed layout fallback -> `pymupdf`
- Standard PDF artifact:
  - `page`
  - `surface` (`text`, `table`, `kv`)
  - `raw_key`, `raw_value`, `normalized_value`
  - `bbox` optional

## Implementation Plan
1. Implement PDF fingerprinting and backend router.
2. Add alternate backends behind optional dependency checks.
3. Normalize extracted rows with unit-aware normalization.
4. Preserve evidence linkage (page, row index, snippet hash).
5. Add parser-level metrics per backend and per domain.

## Validation
- Fixtures:
  - clean text manual
  - spec-sheet with grid tables
  - mixed layout PDF
- Metrics:
  - table row extraction precision
  - numeric/unit parse success rate
  - backend latency and throughput

## Rollout
- Feature flag: `PDF_BACKEND_ROUTER_ENABLED=true`.
- Keep existing `pdfplumber` path as stable fallback.
