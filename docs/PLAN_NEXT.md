# PLAN_NEXT

## Repo Scan (Current State)

### Pipeline (`src/pipeline/runProduct.js`)
- Loads job from S3/local key.
- Loads category config (`categories/{category}/*`) and targets.
- Builds source plan, runs Playwright fetch, extracts candidates from:
  - network JSON/GraphQL
  - embedded state
  - ld+json
  - adapter outputs
- Runs identity/anchor checks per source.
- Runs identity gate (`src/validator/identityGate.js`).
- Runs consensus engine (`src/scoring/consensusEngine.js`) for field winning.
- Computes quality metrics and final validation gate.
- Exports run artifacts + latest pointers to S3/local output.

### Source planning (`src/planner/sourcePlanner.js`)
- Uses allowlist from category `sources.json` + job preferred hosts.
- Enforces `MAX_URLS_PER_PRODUCT` and `MAX_PAGES_PER_DOMAIN`.
- Orders by tier (manufacturer/lab first, then db/review, then retailer).
- Discovers links from fetched HTML and enqueues in-scope URLs.

### Extraction (`src/fetcher/*`, `src/extractors/*`)
- `PlaywrightFetcher` captures page HTML + network responses.
- `NetworkRecorder` stores JSON-ish/GraphQL payload evidence.
- `fieldExtractor` flattens payloads and maps aliases -> canonical fields.
- Extractors include:
  - ld+json
  - embedded framework state (`__NEXT_DATA__`, `__NUXT__`, `__APOLLO_STATE__`)
  - DOM fallback

### Aggregation & pass targets
- Previous logic: `src/scoring/fieldAggregator.js` (3/5 pass behavior).
- Current logic: `src/scoring/consensusEngine.js`
  - candidate clustering
  - approved-domain counting
  - per-field pass targets and provenance
  - instrumented-field stricter handling

### Scoring (`src/scoring/qualityScoring.js`)
- Computes:
  - `completeness_required`
  - `coverage_overall`
  - confidence score (identity + provenance + agreement + conflicts)

### Validation (`src/validator/identityGate.js`, `src/validator/qualityGate.js`)
- Identity gate enforces 99% certainty and contradiction checks.
- Quality gate enforces target completeness/confidence and conflict constraints.

### Export contract (`src/exporter/exporter.js`)
- Writes raw evidence (pages/network), normalized output, provenance, logs, summary, latest pointers.
- Uses keys under:
  - `s3://{bucket}/{S3_OUTPUT_PREFIX}/{category}/{productId}/runs/{runId}/...`
  - `.../{category}/{productId}/latest/...`

## Implementation Plan (Next Phase)
1. Tighten validation logic to require identity gate + certainty + anchor + thresholds.
2. Upgrade network recorder with replay metadata (`request_*`, `resource_type`) while storing no sensitive headers.
3. Add approved vs candidate source queues in planner with separate budgets.
4. Upgrade discovery flow to emit both discovery bundle and candidate-domain bundle.
5. Strengthen adapters (manufacturer PDF helper, RTINGS/TPU JSON preference, EloShapes cache export).
6. Improve extraction mapping (host hints, link extraction, candidate dumps per host).
7. Add `spec.js test-s3` command and keep wrappers backward-compatible.
8. Add self-improving learning loop that updates source priorities across runs.
9. Expand tests for recorder redaction and EloShapes safety behavior.
