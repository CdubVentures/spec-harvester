# 03 - Main Article Extraction

## Goal
Extract clean review/article content with high signal-to-noise for downstream retrieval and LLM extraction.

## Status
- Implemented now:
  - Added `Readability + JSDOM` extractor:
    - `src/extract/articleExtractor.js`
  - Added scored fallback routing (Readability vs heuristic text extraction):
    - Uses quality signals: chars, words, heading count, duplicate sentence ratio, title match.
  - Wired article extraction into evidence-pack creation:
    - `src/evidence/evidencePackV2.js`
    - Emits `readability_text` snippets for downstream retrieval/ranking.
    - Emits article extraction diagnostics in `meta.article_extraction`.
  - Wired runtime telemetry + GUI live display:
    - `src/pipeline/runProduct.js` emits `article_*` fields on `source_processed`.
    - `src/indexlab/runtimeBridge.js` forwards these into `parse_finished` payload.
    - `tools/gui-react/src/pages/indexing/IndexingPage.tsx` shows:
      - Phase 05 live article metrics (sampled/readability/fallback/avg score/low-quality).
      - Event Stream `Recent URL Jobs` article columns (method/quality/low-quality/parse ms).
  - Added config/env knobs:
    - `ARTICLE_EXTRACTOR_V2` (default `true`)
    - `ARTICLE_EXTRACTOR_MIN_CHARS` (default `700`)
    - `ARTICLE_EXTRACTOR_MIN_SCORE` (default `45`)
    - `ARTICLE_EXTRACTOR_MAX_CHARS` (default `24000`)
    - `ARTICLE_EXTRACTOR_DOMAIN_POLICY_MAP_JSON` (optional per-domain mode/threshold overrides)
    - Wired in `src/config.js`
  - Added domain-level article extractor policy resolution:
    - `src/extract/articleExtractorPolicy.js`
    - Modes: `auto`, `prefer_readability`, `prefer_fallback`
    - Host matching supports subdomain fallback (`www.example.com` -> `example.com`)
  - Added article policy telemetry through parse runtime:
    - `article_policy_mode`
    - `article_policy_matched_host`
    - `article_policy_override_applied`
  - Added GUI domain quality leaderboard:
    - `tools/gui-react/src/pages/indexing/IndexingPage.tsx`
    - `Parallel Fetch & Parse (Phase 05)` -> `Article Domain Quality Leaderboard`

## Why This Is Better
- Accuracy:
  - Readability isolates main content body better than tag-strip regex alone.
  - Low-quality Readability outputs auto-fall back to deterministic extraction instead of failing hard.
- Performance:
  - Fallback remains lightweight and deterministic when pages do not parse cleanly.
  - Bounded char caps reduce oversized evidence payloads.
- Observability:
  - `meta.article_extraction` now exposes method/score/quality flags for run diagnostics.

## Current State
- Primary code path:
  - `src/extract/articleExtractor.js` (Readability-first extraction with fallback scoring)
  - `src/extract/readabilityFilter.js` (fallback cleanup path)
- Strengths:
  - Better main-body precision on review/blog pages.
  - Deterministic fallback remains available.
- Weaknesses:
  - Extremely JS-heavy pages may still require dynamic render tuning first.
  - We do not yet run a Trafilatura sidecar for difficult edge domains.

## Missing But Should Use
- Optional Trafilatura sidecar for difficult content (future phase).

## Target Design
- Article extraction chain:
  1. Readability pass (implemented)
  2. Heuristic cleanup pass (implemented)
  3. Scored fallback if low quality (implemented)
- Quality signals:
  - char + word sufficiency
  - heading continuity
  - title match
  - duplicate sentence ratio

## Multi-Product Identity Gate (Required)
- For roundup/comparison/editorial pages, segment article text into product-relevant sections.
- Each emitted snippet/assertion must include:
  - `page_product_cluster_id`
  - `target_match_score`
  - `target_match_passed`
- If target match fails, do not promote text evidence to candidate generation.

## Implementation Plan
1. Add optional Trafilatura sidecar mode (Python service path).
2. Extend policy map with per-domain text cleaners if needed.
3. Tune thresholds from leaderboard feedback on top domains.

## Validation
- Test fixtures:
  - long review page
  - content + comments mixed page
  - docs-style page
- Metrics:
  - extraction precision sampled by manual QA
  - average usable chars per page
  - downstream field yield delta

## Rollout
- Feature flag: `ARTICLE_EXTRACTOR_V2=true`.
- Begin on review domains first.
- Maintain fallback to current readability filter on extraction errors.
