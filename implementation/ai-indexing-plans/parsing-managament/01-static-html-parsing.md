# 01 - Static HTML Parsing

## Goal
Improve fast, non-browser parsing for static HTML pages with higher DOM accuracy and lower extraction drift.

## Status
- Implemented now:
  - DOM-first table and `dl` extraction via `cheerio` in `src/adapters/tableParsing.js`.
  - Legacy regex fallback retained.
  - Unit coverage added in `test/tableParsing.test.js`.
  - Dedicated static DOM extractor added: `src/extractors/staticDomExtractor.js`.
  - Identity-gated cluster scoring for multi-product pages with per-assertion metadata:
    - `page_product_cluster_id`
    - `target_match_score`
    - `target_match_passed`
    - `identity_reject_reason` on rejected rows
  - Deterministic evidence snippet metadata on static assertions:
    - `snippet_id`
    - `snippet_hash`
    - `surface`
    - `key_path`
  - Parser mode + rollout flags wired:
    - `STATIC_DOM_EXTRACTOR_ENABLED`
    - `STATIC_DOM_MODE` (`cheerio` or `regex_fallback`)
    - `STATIC_DOM_TARGET_MATCH_THRESHOLD`
    - `STATIC_DOM_MAX_EVIDENCE_SNIPPETS`
  - Runtime integration:
    - `src/extractors/fieldExtractor.js` calls static extractor (configurable).
    - `src/pipeline/runProduct.js` passes identity target + static parser config.
  - Unit coverage added:
    - `test/staticDomExtractor.test.js`
    - `test/fieldExtractor.test.js` static path assertions.

## Why This Is Better
- Accuracy:
  - DOM parsing handles real nested table structure better than regex-only parsing.
  - `dl/dt/dd` parsing captures spec blocks that were previously missed.
- Performance:
  - Keeps static parsing lightweight (no browser rendering required for these surfaces).
  - Better extraction quality reduces wasted retries and downstream LLM calls.
- Safety:
  - Regex fallback remains in place, so failure risk is low during rollout.

## Current State
- Primary code paths:
  - `src/fetcher/playwrightFetcher.js` (`HttpFetcher` path for plain HTTP fetch)
  - `src/adapters/tableParsing.js` (regex-style table parsing)
  - `src/extract/readabilityFilter.js` (heuristic cleanup)
- Strengths:
  - Fast for simple pages.
  - Low overhead compared to browser rendering.
- Weaknesses:
  - Regex table parsing fails on nested DOM structures.
  - Limited semantic selection for labels/headers/context blocks.
  - Harder to maintain per-site exceptions.

## Missing But Should Use
- `cheerio` for selector-based DOM parsing in Node.
- `jsdom` only where browser-like DOM APIs are required.

## Remaining Gap (For Later)
- Host-specific selector registry is still generic/default-first (not yet domain-tuned).
- Canary rollout controls and runtime metrics dashboards are not yet added.

## Target Design
- Parser selection:
  - `static_dom_mode=cheerio` (default)
  - `static_dom_mode=regex_fallback` (legacy fallback)
- Extraction surfaces:
  - Product identity block (`h1`, title, hero metadata)
  - Spec tables (`table`, `dl`, key-value rows)
  - Metadata blocks near technical sections
- Output contract:
  - `identity_candidates[]`
  - `field_candidates[]`
  - `evidence_snippets[]` with `snippet_id`, `surface`, `quote`

## Multi-Product Identity Gate (Required)
- On list/comparison pages, cluster DOM into product blocks first.
- Attach to every static assertion/evidence:
  - `page_product_cluster_id`
  - `target_match_score` (0..1)
  - `target_match_passed` (bool)
- Only pass `target_match_passed=true` rows to downstream extraction/review.
- Rejected rows stay audit-only with `identity_reject_reason` (for example `related_product`, `cluster_mismatch`).

## Implementation Plan
1. Add `src/extractors/staticDomExtractor.js` using Cheerio.
2. Move regex table extractor behind fallback flag.
3. Add host-specific selector registry for known domains.
4. Emit deterministic snippet IDs for static surfaces.
5. Wire parser stats into runtime metrics.

## Validation
- Unit tests:
  - Complex nested table fixture extraction.
  - Key-value extraction from `dl` and mixed table rows.
- Integration tests:
  - Static product pages across 5+ domains.
- Success metrics:
  - +20% `field_candidates` yield on static pages.
  - -50% malformed key-value rows.
  - No regression in fetch throughput.

## Rollout
- Feature flag: `STATIC_DOM_EXTRACTOR_ENABLED=true`.
- Canary on 10% of runs.
- Auto-fallback to legacy regex parser on parser exceptions.
