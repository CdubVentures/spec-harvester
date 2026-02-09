# Plan: Current Repo Scan + Upgrade Path

## Current CLI entrypoints and job loading
- `src/cli/run-one.js`
  - Loads config via `loadConfig`.
  - Loads one job key from `--s3key` (defaulting to mouse sample key).
  - Uses `createStorage(config)` and calls `runProduct({ storage, config, s3Key })`.
- `src/cli/run-batch.js`
  - Lists input keys via `storage.listInputKeys(category)`.
  - Optional `--brand` filter by reading each job and matching `identityLock.brand`.
  - Runs jobs concurrently and calls `runProduct` for each key.

## Where completeness/confidence/validated are computed
- Pipeline: `src/pipeline/runProduct.js`
  - Completeness currently from `computeCompleteness(...)` in `src/scoring/qualityScoring.js`.
  - Confidence currently from `computeConfidence(...)` in `src/scoring/qualityScoring.js`.
  - `validated` currently follows `identityGate.validated` from `src/validator/identityGate.js` and is not strictly tied to target completeness/confidence.
- Known issue in current behavior:
  - Completeness can appear high if required fields list is too small.
  - Validation is currently identity-centric and does not enforce all quality thresholds.

## Where extraction currently happens
- Browser fetch + response capture:
  - `src/fetcher/playwrightFetcher.js`
  - `src/fetcher/networkRecorder.js`
- Extraction stages:
  - `application/ld+json`: `src/extractors/ldjsonExtractor.js`
  - embedded framework state (`__NEXT_DATA__`, `__NUXT__`, `__APOLLO_STATE__`): `src/extractors/embeddedStateExtractor.js`
  - flatten/mapping to field candidates + identity candidates: `src/extractors/fieldExtractor.js`
  - DOM fallback patterns: `src/extractors/domFallbackExtractor.js`

## Where normalized schema lives
- Mouse field order is hardcoded in `src/constants.js` as `MOUSE_FIELD_ORDER`.
- Anchors and many validation constants are also currently hardcoded there.

## Where S3 input/output keys are defined
- Storage and key handling:
  - `src/s3/storage.js`
  - `S3Storage.listInputKeys(category)` uses `{S3_INPUT_PREFIX}/{category}/products/...`
  - `storage.resolveOutputKey(...)` uses `{S3_OUTPUT_PREFIX}/...`
- Export output paths:
  - `src/exporter/exporter.js` currently writes mouse-specific output paths under run/latest.

## Implementation plan for next step changes
1. Introduce category config files under `categories/{category}/` and loader utilities.
2. Build one universal CLI `src/cli/spec.js` with commands: run-one, run-batch, discover, rebuild-index.
3. Upgrade quality metrics:
   - `completeness_required`
   - `coverage_overall`
   - strict validated gate with explicit reasons and missing required fields.
4. Replace/upgrade consensus logic to a candidate-store-driven 3-confirmation engine for non-anchor fields.
5. Strengthen backend-first recorder with response classification and bounded payload storage shape.
6. Add adapter system (`manufacturer`, `eloshapes`, `techpowerup`, `rtings`) and integrate in pipeline.
7. Add safe optional discovery using official APIs only and store candidates under S3 input `_sources/candidates/...`.
8. Expand tests for metrics and consensus; add local smoke runner with explicit validation assertions.
9. Update docs (`README.md`, `agent.md`) for repeatable behavior and domain approval workflow.
