# 07 - Scanned PDF OCR

## Goal
Support scanned/image-only PDFs by adding OCR and structure recovery so these sources are no longer dropped.

## Current State
- No complete scanned-PDF OCR pipeline in runtime.
- Existing PDF extraction assumes selectable text or extractable tables.

## Missing But Should Use
- `ocrmypdf` to add searchable text layers.
- `PaddleOCR` for primary OCR + layout parsing.
- `tesseract` as fallback OCR engine.

## Target Design
- Scan detection:
  - If extracted text is near-empty and page image entropy is high, route to OCR.
- OCR pipeline:
  1. OCR pre-pass (`ocrmypdf`)
  2. Layout parse (heading/table/block segmentation)
  3. KV/table normalization into field candidates
- Confidence handling:
  - OCR confidence threshold gates
  - low-confidence rows flagged for manual review

## Implementation Plan
1. Add scanned-PDF detector in PDF orchestration layer.
2. Add OCR worker service with configurable backends.
3. Normalize OCR output into existing evidence schema.
4. Add low-confidence flags to retrieval and review UI.
5. Add OCR-specific retry/backoff policy.

## Validation
- Fixtures:
  - scanned manuals
  - skewed low-contrast scans
  - mixed scan + selectable text PDFs
- Metrics:
  - OCR recall on known labeled fields
  - OCR confidence distribution
  - false extraction rate vs text PDFs

## Rollout
- Feature flag: `SCANNED_PDF_OCR_ENABLED=true`.
- Start with read-only evidence capture, then promote to candidate generation.
