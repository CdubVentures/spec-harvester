# 07 - Scanned PDF OCR

## Goal
Support scanned/image-only PDFs by adding OCR and structure recovery so these sources are no longer dropped.

## Status
- Implemented now (2026-02-20 baseline):
  - Added scanned-PDF detection and OCR execution path in PDF extraction:
    - `scripts/extract_pdf_kv.py`
    - `src/adapters/manufacturerAdapter.js`
  - Added OCR backend routing controls:
    - `auto` / `tesseract` / `none`
    - runtime knobs wired through GUI -> API -> env overrides.
  - Added normalized OCR surfaces and candidate emission:
    - `scanned_pdf_ocr_text`
    - `scanned_pdf_ocr_kv`
    - `scanned_pdf_ocr_table`
    - routed in `src/indexlab/indexingSchemaPackets.js` and evidence pack.
  - Added OCR confidence metadata and low-confidence flags:
    - `ocr_confidence`
    - `ocr_low_confidence`
    - aggregate `scanned_pdf_ocr_confidence_avg`
  - Added runtime telemetry + GUI proof:
    - detected/attempted/succeeded docs
    - pair totals (`kv`/`table`)
    - low-confidence/error counts
    - selected OCR backend.
  - Added config/runtime knobs:
    - `SCANNED_PDF_OCR_ENABLED`
    - `SCANNED_PDF_OCR_PROMOTE_CANDIDATES`
    - `SCANNED_PDF_OCR_BACKEND`
    - `SCANNED_PDF_OCR_MAX_PAGES`
    - `SCANNED_PDF_OCR_MAX_PAIRS`
    - `SCANNED_PDF_OCR_MIN_CHARS_PER_PAGE`
    - `SCANNED_PDF_OCR_MIN_LINES_PER_PAGE`
    - `SCANNED_PDF_OCR_MIN_CONFIDENCE`

## Current State
- Strengths:
  - Scanned/image-only PDFs are now detected and passed through OCR extraction.
  - OCR-derived rows are traceable in evidence snippets and runtime telemetry.
  - OCR surfaces are scoring-aware in downstream aggregation/consensus.
- Remaining limits:
  - OCR backend is currently practical with `tesseract` path; advanced engines are not yet integrated.
  - Layout-heavy scan handling still depends on baseline OCR quality.

## Missing But Should Use (Next)
- `ocrmypdf` pre-pass for better text-layer normalization on noisy scans.
- `PaddleOCR`/layout-aware OCR backend for higher table recall.
- Optional image preprocessing pipeline (deskew/denoise/contrast) before OCR.

## Target Design (Delivered Baseline)
- Scan detection:
  - route likely scanned PDFs when extracted text signal is below thresholds.
- OCR pipeline:
  1. OCR attempt by configured backend
  2. KV/table normalization
  3. candidate + evidence emission
  4. confidence + low-confidence tagging
- Confidence handling:
  - confidence thresholds are runtime-configurable.
  - low-confidence rows remain visible for review and can be downweighted.

## Implementation Plan (Remaining)
1. Add optional OCR pre-process pass for skew/noise correction.
2. Add second OCR backend (`PaddleOCR`) with backend auto-selection policy.
3. Add fixture suite for difficult scanned manuals (rotated/low contrast).
4. Add domain/device-class OCR tuning profiles if needed.

## Validation
- Runtime proof in GUI:
  - `Parallel Fetch & Parse` OCR counters and backend selection.
  - `Recent URL Jobs` scanned/OCR columns.
- Existing wiring tests:
  - schema packet mapping + evidence emission + routing paths.
- Remaining tests to add:
  - scanned-PDF fixture accuracy benchmarks (recall/precision by field family).

## Rollout
- Feature flag: `SCANNED_PDF_OCR_ENABLED=true`.
- Candidate promotion flag: `SCANNED_PDF_OCR_PROMOTE_CANDIDATES=true`.
- Keep fail-open behavior: OCR errors should not block full run completion.
