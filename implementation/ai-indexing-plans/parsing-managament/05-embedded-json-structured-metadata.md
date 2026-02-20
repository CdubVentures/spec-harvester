# 05 - Embedded JSON and Structured Metadata

## Goal
Maximize high-confidence field extraction from structured payloads before relying on weak text inference.

## Status
- Implemented now (2026-02-20 baseline):
  - Added FastAPI `extruct` sidecar:
    - `tools/structured-metadata-sidecar/app.py`
    - `tools/structured-metadata-sidecar/requirements.txt`
    - `tools/structured-metadata-sidecar/run.ps1`
  - Added runtime client + fail-open/cached sidecar integration:
    - `src/extract/structuredMetadataClient.js`
    - wired in `src/pipeline/runProduct.js`
  - Added structured merger + identity-gated candidate lane:
    - `src/extract/structuredMetadataMerger.js`
    - wired in `src/extractors/fieldExtractor.js`
  - Extended evidence pack + deterministic parser support for structured surfaces:
    - `src/evidence/evidencePackV2.js`
    - `src/extract/deterministicParser.js`
  - Added structured counters + snippet preview proof in GUI panels:
    - `tools/gui-react/src/pages/indexing/IndexingPage.tsx`
  - Added runtime env knobs:
    - `STRUCTURED_METADATA_EXTRUCT_ENABLED`
    - `STRUCTURED_METADATA_EXTRUCT_URL`
    - `STRUCTURED_METADATA_EXTRUCT_TIMEOUT_MS`
    - plus max/cache knobs in `src/config.js`

## Current State
- Primary code paths:
  - `src/extractors/ldjsonExtractor.js`
  - `src/extractors/embeddedStateExtractor.js`
  - `src/fetcher/networkRecorder.js`
  - adapter payload flattening in `src/adapters/rtingsAdapter.js`, `src/adapters/techPowerUpAdapter.js`
  - `src/extract/structuredMetadataClient.js`
  - `src/extract/structuredMetadataMerger.js`
- Strengths:
  - Strong JSON-LD and app-state capture.
  - Good network JSON payload ingestion.
  - Sidecar-backed Microdata/OpenGraph/RDFa/Microformats ingestion is now wired.
- Weaknesses:
  - Structured coverage quality still depends on source markup quality and domain tuning.
  - Sidecar availability/timeouts still require monitoring in production.

## Missing But Should Use
- Domain-level allowlist/override policy for structured promotion confidence.
- Additional malformed-schema repair heuristics for noisy publisher pages.

## Target Design
- Structured extraction priority:
  1. Network payloads
  2. Embedded app state
  3. JSON-LD
  4. Microdata/OG/microformats
- Unified structured artifact:
  - `method`
  - `key_path`
  - `value`
  - `confidence_base`
  - `source_ref`
  - `source_surface` (`network_json`, `embedded_state`, `json_ld`, `microdata`, `opengraph`, `microformat`, `rdfa`)

## Multi-Product Identity Gate (Required)
- Structured payloads on catalog/search pages can contain multiple products.
- For each structured assertion:
  - map to `page_product_cluster_id` (or structured product node id)
  - compute `target_match_score`
  - set `target_match_passed`
- Reject or holdout structured rows that do not match target identity.

## Architecture (Implemented Baseline)
### A) Python sidecar service (FastAPI)
- Service folder:
  - `tools/structured-metadata-sidecar/`
- Endpoint:
  - `POST /extract/structured`
- Request:
```json
{
  "url": "https://example.com/product",
  "html": "<html>...</html>",
  "content_type": "text/html",
  "max_items_per_surface": 200
}
```
- Response:
```json
{
  "ok": true,
  "url": "https://example.com/product",
  "html_hash": "sha256:...",
  "surfaces": {
    "json_ld": [],
    "microdata": [],
    "rdfa": [],
    "microformats": [],
    "opengraph": {},
    "twitter": {}
  },
  "stats": {
    "json_ld_count": 0,
    "microdata_count": 0,
    "rdfa_count": 0,
    "microformats_count": 0,
    "opengraph_count": 0
  },
  "errors": []
}
```

### B) Node client integration
- New module:
  - `src/extract/structuredMetadataClient.js`
- Behavior:
  - call sidecar with strict timeout (default 2000 ms)
  - fail open (never block run if sidecar fails)
  - optional in-memory hash cache to avoid duplicate parsing per `html_hash`

### C) Structured merger
- New module:
  - `src/extract/structuredMetadataMerger.js`
- Responsibility:
  - normalize sidecar output + existing JSON-LD/app-state/network surfaces
  - dedupe by `(normalized_key_path, normalized_value, canonical_url)`
  - assign deterministic evidence snippet rows
  - output candidate rows with provenance

### D) Evidence pack integration
- Extend:
  - `src/evidence/evidencePackV2.js`
- Add snippet types:
  - `microdata_product`
  - `opengraph_product`
  - `microformat_product`
  - `rdfa_product`
- Keep `json_ld_product` and structured JSON rows first-class.

### E) Ranking policy
- Candidate confidence base:
  - `network_json`: 0.96
  - `embedded_state`: 0.93
  - `json_ld`: 0.90
  - `microdata`: 0.88
  - `opengraph`: 0.80
  - `microformat/rdfa`: 0.78
- Promote structured candidates before text regex/window candidates in consensus input.

## Implementation Plan
1. Sidecar bootstrap
  - Add FastAPI service with `extruct` parser and schema-validated response.
  - Add docker/dev launch script for local + Windows workflow.
2. Runtime client wiring
  - Add `STRUCTURED_METADATA_EXTRUCT_ENABLED`.
  - Add sidecar URL/timeout envs:
    - `STRUCTURED_METADATA_EXTRUCT_URL`
    - `STRUCTURED_METADATA_EXTRUCT_TIMEOUT_MS`
3. Merger + normalization
  - Normalize keys/values and canonical URLs.
  - Dedupe structured rows across surfaces.
  - Attach `source_surface`, `method`, `key_path`, `value`, `evidence_ref`.
4. Evidence pack + extraction wiring
  - Inject structured snippets into EvidencePack.
  - Ensure deterministic parser and LLM extraction can consume them.
5. GUI proof
  - Add structured counters:
    - `json_ld_count`, `microdata_count`, `opengraph_count`, `structured_candidates`.
  - Add recent structured snippet rows in Phase 05/06 panels.
6. Guardrails
  - fail-open on sidecar timeout/invalid response
  - max payload limits and truncation
  - skip binary/non-html content

## Validation
- Fixtures:
  - JSON-LD only page
  - Microdata-only page
  - OG-heavy commerce page
  - mixed Microdata + JSON-LD page
  - malformed schema payload page
- Metrics:
  - structured coverage by domain
  - structured-to-final adoption ratio
  - confidence uplift over text-only candidates
  - sidecar timeout/error rate
  - candidate dedupe collision rate

## Rollout
- Feature flag: `STRUCTURED_METADATA_EXTRUCT_ENABLED=true`.
- Stage 1: read-only capture + telemetry (no candidate promotion).
- Stage 2: candidate promotion for `json_ld/microdata`.
- Stage 3: enable full surface promotion and confidence weighting.
- Stage 4: add GUI gating alarm if structured coverage drops on known domains.

## Why This Is Better
- Accuracy:
  - pulls standardized schema directly from page metadata, reducing heuristic guesswork
  - improves field precision for identity/spec fields without extra LLM calls
- Performance:
  - structured parse is cheap compared to heavy browser retries
  - sidecar fail-open avoids pipeline stalls
- Auditability:
  - every promoted structured value carries surface + key path + evidence ref
  - easier to prove where each value came from in GUI and review lanes
