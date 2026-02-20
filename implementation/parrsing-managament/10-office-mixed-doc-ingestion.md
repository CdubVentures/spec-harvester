# 10 - Office and Mixed Document Ingestion

## Goal
Handle DOCX/XLSX/PPTX and mixed artifacts with a unified parse-to-evidence path.

## Current State
- Existing support is mostly internal XLSX workflows (`exceljs` based tooling).
- No broad, unified ingestion for mixed enterprise document formats.

## Missing But Should Use
- `Unstructured` or `Apache Tika` for broad file-type parsing.
- Optional `MarkItDown` style conversion path for markdown normalization.

## Target Design
- Ingestion router:
  - detect mime/file type
  - dispatch to parser backend
  - normalize into common content blocks
- Common normalized block schema:
  - `type` (`title`, `paragraph`, `table`, `list`, `kv`)
  - `text`
  - `metadata` (`page`, `sheet`, `slide`, `section`)
  - `source_ref`

## Implementation Plan
1. Add mixed-doc ingestion service wrapper.
2. Implement file-type routing and parser backend registration.
3. Normalize parsed outputs into evidence block schema.
4. Feed normalized blocks into retrieval/index pipeline.
5. Add parser provenance and confidence weighting per source type.

## Validation
- Fixtures:
  - DOCX product brief
  - XLSX spec workbook
  - PPTX launch deck
  - zipped/mixed archive
- Metrics:
  - parse success rate by file type
  - normalized block quality
  - downstream field yield contribution

## Rollout
- Feature flag: `MIXED_DOC_INGEST_ENABLED=true`.
- Start with read-only indexing, then enable candidate extraction.
