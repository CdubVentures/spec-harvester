# 09 - Chart and Graph Extraction

## Goal
Extract chart values without guessing, prioritizing structured sources and minimizing hallucinated numeric data.

## Current State
- Current pipeline can capture network JSON payloads from rendered pages.
- No dedicated SVG/canvas chart extraction workflow.

## Missing But Should Use
- SVG parser path:
  - axis labels
  - legend mapping
  - data point extraction where embedded in DOM/scripts
- Vision fallback for canvas/raster charts only when structured data is unavailable.

## Target Design
- Ordered extraction strategy:
  1. Network data feed capture (JSON/CSV)
  2. Embedded chart config extraction from scripts
  3. SVG DOM parser
  4. OCR/vision fallback for raster charts
- Output contract:
  - `series[]`
  - `x_axis`, `y_axis`, `units`
  - `source_surface`
  - `confidence`

## Implementation Plan
1. Add chart detector in HTML/network pass.
2. Implement network-series adapter for known chart libraries.
3. Add SVG parser for tick/legend/value extraction.
4. Add constrained vision fallback with strict validation.
5. Add chart-source provenance and confidence downgrades for vision path.

## Validation
- Fixtures:
  - chart with downloadable JSON series
  - pure SVG chart
  - raster chart image
- Metrics:
  - numeric extraction accuracy
  - unit consistency rate
  - fallback usage ratio

## Rollout
- Feature flags:
  - `CHART_EXTRACTION_ENABLED=true`
  - `CHART_VISION_FALLBACK_ENABLED=false` (default off)
- Turn on vision fallback only after benchmark validation.
