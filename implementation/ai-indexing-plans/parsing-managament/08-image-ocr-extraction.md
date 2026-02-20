# 08 - Image OCR Extraction

## Goal
Extract usable specs from screenshots, product images, and image-based spec cards.

## Scope Update (2026-02-20)
- Phase 08 is OCR-only.
- Image/screenshot capture is handled by `11-visual-asset-capture.md`.
- Phase 08 consumes `image_asset_id` inputs from the visual capture phase.

## Current State
- Current code captures screenshots (`src/extract/screenshotCapture.js`).
- No OCR pipeline currently converts image text to structured candidates.

## Missing But Should Use
- `PaddleOCR` as primary OCR engine.
- `tesseract` fallback for clean/simple text.
- OpenCV preprocessing:
  - deskew
  - contrast/threshold
  - region cropping

## Target Design
- Image processing stages:
  1. Load visual assets from Phase 11 (`image_asset_id`, storage URI, metadata)
  2. Region detection (title/spec box/table zones)
  3. OCR extraction
  4. KV/row parsing and normalization
  5. Evidence snippet emission with source image/region references
- Risk controls:
  - image-derived field confidence penalties by default
  - require cross-source confirmation for high-stakes fields
  - enforce `quality_gate_passed=true` before any image is LLM-eligible
  - enforce target identity gate (`page_product_cluster_id`, `target_match_score`, `target_match_passed`)

## Implementation Plan
1. Add image OCR worker endpoint and queue.
2. Read eligible assets from Phase 11 visual manifest.
3. Add preprocessing pipeline with configurable filters.
4. Map OCR text blocks to field-key candidates.
5. Emit traceable evidence (`image_asset_id`, `region_id`, `bbox`, `ocr_confidence`).
6. Surface OCR quality metrics in runtime UI.

## Validation
- Fixtures:
  - clean spec card image
  - noisy screenshot
  - rotated and low-resolution text
- Metrics:
  - OCR char accuracy
  - field extraction precision from images
  - false-positive suppression rate

## Rollout
- Feature flag: `IMAGE_OCR_ENABLED=true`.
- Enable only for missing-field recovery path initially.
