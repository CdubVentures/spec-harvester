# 04 - HTML Spec Table Extraction

## Goal
Extract accurate spec rows from HTML tables and bind them to product identity context.

## Current State
- Primary code paths:
  - `src/adapters/tableParsing.js`
  - adapter-level extraction in `src/adapters/*.js`
- Strengths:
  - Works for simple two-column tables.
- Weaknesses:
  - Limited support for merged cells, nested rows, section headers.
  - Weak context binding between table and product identity block.
  - Inconsistent handling of units and aliases.

## Missing But Should Use
- DOM table walker using Cheerio/JSDOM.
- Row normalization framework:
  - header inheritance
  - unit normalization
  - per-row evidence references

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
1. Add `htmlTableExtractorV2` with DOM traversal.
2. Implement row normalization and unit parser helpers.
3. Bind top-page identity block to table extraction context.
4. Add host templates for known retail/manufacturer patterns.
5. Replace regex-first behavior with V2-first and legacy fallback.

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
