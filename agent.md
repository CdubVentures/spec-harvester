# Spec Harvester Agent Runbook

## Purpose
- Produce accurate mouse specs using backend-first extraction and credible sources.
- Enforce wrong-model prevention with identity lock + anchor checks.
- Write full evidence and normalized outputs to S3 for every run.

## Non-Negotiables
- Never guess values. Use `unk` when uncertain and `n/a` only when truly not applicable.
- Keep canonical mouse field order unchanged.
- Do not store cookies, auth headers, or sensitive request content.
- Restrict discovery to allowlisted hosts and keep per-host rate limits.

## S3 Data Contract
- Input object key format:
  - `s3://$S3_BUCKET/$S3_INPUT_PREFIX/mouse/products/{productId}.json`
- Run output prefix format:
  - `s3://$S3_BUCKET/$S3_OUTPUT_PREFIX/mouse/{productId}/runs/{runId}/...`
- Latest output prefix format:
  - `s3://$S3_BUCKET/$S3_OUTPUT_PREFIX/mouse/{productId}/latest/...`

## Required Environment
- `AWS_REGION=us-east-2`
- `S3_BUCKET=my-spec-harvester-data`
- `S3_INPUT_PREFIX=specs/inputs`
- `S3_OUTPUT_PREFIX=specs/outputs`

Optional runtime controls:
- `MAX_URLS_PER_PRODUCT=8`
- `MAX_PAGES_PER_DOMAIN=2`
- `MAX_RUN_SECONDS=180`
- `MAX_JSON_BYTES=2000000`
- `CONCURRENCY=2`
- `PER_HOST_MIN_DELAY_MS=800`
- `USER_AGENT="Mozilla/5.0 (compatible; EGSpecHarvester/1.0; +https://eggear.com)"`

## Identity Lock Rules
- Treat `identityLock` and `anchors` as lock signals, not override values.
- If 99% certainty is not met, run must output:
  - `validated=false`
  - `reason=MODEL_AMBIGUITY_ALERT`
  - minimal identity-only normalized fields

## Source Priority
- Tier 1: manufacturer pages/docs and instrumented labs.
- Tier 2: trusted review/spec databases.
- Tier 3: retailer confirmation only; never sole source.

## Local Validation (Before Cloud Runs)
1. `npm test`
2. `npm run smoke`

## Cloud S3 Integration Test (Reusable)
Use this command to perform a full end-to-end S3 test with a sample mouse fixture:

`npm run test:s3`

What this test does:
1. Uploads sample input job to `specs/inputs/mouse/products/mouse-razer-viper-v3-pro.json`.
2. Runs real pipeline (not local mode) against S3.
3. Verifies required run and latest keys exist.
4. Verifies raw evidence was written (`raw/pages`, `raw/network`).
5. Checks `latest/normalized.json` ACL has no public grants.
6. Prints run ID, summary metrics, and selected mouse fields.

## Scheduled Batch Operation
Run category batch on a cadence:

`node src/cli/run-batch.js --category mouse`

Optional brand-scoped schedule:

`node src/cli/run-batch.js --category mouse --brand Razer`

Example cron (every 6 hours):

`0 */6 * * * cd /path/to/spec-harvester && node src/cli/run-batch.js --category mouse >> /var/log/spec-harvester.log 2>&1`

## S3 Review Checklist Per Run
- `logs/summary.json` exists and `reason` is expected.
- `normalized/mouse.normalized.json` exists and schema is complete.
- `provenance/fields.provenance.json` exists with field evidence.
- `raw/pages/*` and `raw/network/*` exist for captured evidence.
- `latest/*` mirrors current run outputs.

## Failure Handling
- If model ambiguity is flagged, do not force-fill missing fields.
- Fix seed URLs / host allowlist / identity anchors, then rerun.
- Keep evidence artifacts intact for audit and debugging.
