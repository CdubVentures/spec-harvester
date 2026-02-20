# 04 - HTML Spec Table Extraction

## Goal
Extract accurate spec rows from HTML tables and bind them to product identity context.

## Status
- Implemented now:
  - Added table parser V2 in `src/adapters/tableParsing.js`:
    - merged-cell handling (`rowspan`/`colspan`) with row expansion
    - section-header inheritance for grouped spec blocks
    - per-row metadata (`table_id`, `row_id`, `normalized_key`, `unit_hint`)
    - richer pathing (`table[x].row[y].col[z]`)
  - Added stronger numeric/unit normalization in candidate mapping:
    - dimension conversion to `mm` (`cm`, `in`, `m` supported)
    - weight conversion to `g` (`kg`, `lb`, `oz`, `mg` supported)
    - polling-rate `kHz` normalization and dpi `k` shorthand normalization
  - Added config feature flag:
    - `HTML_TABLE_EXTRACTOR_V2` (default `true`)
    - wired in `src/config.js`
  - Wired V2 usage through extraction paths:
    - static DOM pipeline (`src/extractors/staticDomExtractor.js`)
    - parser orchestrator (`src/extractors/fieldExtractor.js`, `src/pipeline/runProduct.js`)
    - adapter extraction (`src/adapters/manufacturerAdapter.js`, `src/adapters/techPowerUpAdapter.js`, `src/adapters/eloShapesAdapter.js`)
  - Added tests:
    - expanded `test/tableParsing.test.js` for merged-cells and unit conversions

## Current State
- Primary code paths:
  - `src/adapters/tableParsing.js`
  - adapter-level extraction in `src/adapters/*.js`
- Strengths:
  - Works for simple two-column tables.
- Weaknesses:
  - Nested/malformed tables still rely on best-effort fallback behavior.
  - Host-specific templates are still generic and not yet specialized by domain.

## Missing But Should Use
- Host template library for known retail/manufacturer table layouts.
- Optional deeper HTML semantics (ARIA/data-* hints) for pathological table markup.

## Target Design
- Table extraction artifacts:
  - `table_id`, `row_id`, `raw_key`, `raw_value`, `normalized_key`, `normalized_value`
  - `identity_context` attached to row set
- Evidence output:
  - snippet per selected row
  - source offsets where possible

## Multi-Product Identity Gate (Required)
- Comparison tables must be split by product column/row groups into `page_product_cluster_id`.
- For each table assertion:
  - compute `target_match_score`
  - set `target_match_passed`
- Only target-passed rows are promoted; all others are kept as rejected evidence with reason.

## Implementation Plan
1. Add host templates for known retail/manufacturer table patterns.
2. Extend malformed-table repair logic for deeply nested cell structures.
3. Expand coverage fixtures across top domains.

## Validation
- Unit tests:
  - `rowspan/colspan` fixtures
  - mixed key-value and matrix tables
  - malformed table HTML
- Integration:
  - 10 representative domains
- Metrics:
  - row parse accuracy
  - key normalization accuracy
  - reduction in `unk` output from table fields

## Rollout
- Feature flag: `HTML_TABLE_EXTRACTOR_V2=true`.
- Progressive rollout by domain allowlist.
