# spec-harvester

Backend-first spec harvester for **mouse** products using Node 20 + Playwright + S3.

## Features

- Reads one-job-per-product JSON from S3 (`specs/inputs/mouse/products/{productId}.json`)
- Deterministic source planning with tier ordering (manufacturer -> reviews/databases -> retailers)
- Backend-first extraction priority:
  1. network JSON / GraphQL
  2. embedded state (`__NEXT_DATA__`, `window.__NUXT__`, `window.__APOLLO_STATE__`)
  3. `application/ld+json`
  4. limited DOM fallback
- Mandatory identity lock + anchor conflict checks
- 99% certainty gate: aborts with `MODEL_AMBIGUITY_ALERT` when identity is unresolved
- Canonical mouse schema output + TSV row output
- Field-level provenance + raw evidence + structured logs
- Run one product or batch across category/brand
- Dry-run mode for CI/local smoke tests without AWS creds

## Environment Variables

Required (defaults included):

- `AWS_REGION=us-east-2`
- `S3_BUCKET=my-spec-harvester-data`
- `S3_INPUT_PREFIX=specs/inputs`
- `S3_OUTPUT_PREFIX=specs/outputs`

Budgets / throttles:

- `MAX_URLS_PER_PRODUCT=8`
- `MAX_PAGES_PER_DOMAIN=2`
- `MAX_RUN_SECONDS=180`
- `MAX_JSON_BYTES=2000000`
- `CONCURRENCY=2`
- `PER_HOST_MIN_DELAY_MS=800`
- `USER_AGENT="Mozilla/5.0 (compatible; EGSpecHarvester/1.0; +https://eggear.com)"`

Local/dry-run toggles:

- `LOCAL_MODE=true|false`
- `DRY_RUN=true|false`
- `LOCAL_S3_ROOT=fixtures/s3`
- `LOCAL_OUTPUT_ROOT=out`
- `WRITE_MARKDOWN_SUMMARY=true|false`

## S3 Data Contract

Input key format:

- `s3://{S3_BUCKET}/{S3_INPUT_PREFIX}/mouse/products/{productId}.json`

Run output base:

- `s3://{S3_BUCKET}/{S3_OUTPUT_PREFIX}/mouse/{productId}/runs/{runId}/...`

Latest output base:

- `s3://{S3_BUCKET}/{S3_OUTPUT_PREFIX}/mouse/{productId}/latest/...`

Run artifacts written:

- `raw/pages/{host}/page.html.gz`
- `raw/pages/{host}/ldjson.json`
- `raw/pages/{host}/embedded_state.json`
- `raw/network/{host}/responses.ndjson.gz`
- `normalized/mouse.normalized.json`
- `normalized/mouse.row.tsv`
- `provenance/fields.provenance.json`
- `logs/events.jsonl.gz`
- `logs/summary.json`
- `summary/mouse.summary.md` (optional)

Latest pointers written:

- `latest/normalized.json`
- `latest/provenance.json`
- `latest/summary.json`
- `latest/summary.md` (optional)
- `latest/mouse.row.tsv`

Objects are written without public ACL configuration (private by default).

## Install

```bash
npm install
npx playwright install --with-deps chromium
```

## Run

Single product from S3:

```bash
node src/cli/run-one.js --s3key specs/inputs/mouse/products/mouse-razer-viper-v3-pro.json
```

Batch by category:

```bash
node src/cli/run-batch.js --category mouse
```

Batch by category + brand:

```bash
node src/cli/run-batch.js --category mouse --brand Razer
```

Local dry-run smoke test (no AWS required, writes to `./out`):

```bash
node src/cli/run-one.js --local --dry-run --s3key specs/inputs/mouse/products/mouse-razer-viper-v3-pro.json
```

NPM shortcuts:

```bash
npm run test
npm run smoke
```

## Docker

Build:

```bash
docker build -t spec-harvester .
```

Run batch in container:

```bash
docker run --rm \
  -e AWS_REGION=us-east-2 \
  -e S3_BUCKET=my-spec-harvester-data \
  -e S3_INPUT_PREFIX=specs/inputs \
  -e S3_OUTPUT_PREFIX=specs/outputs \
  spec-harvester
```

## Scheduling / Cadence

Use cron, CI scheduler, EventBridge, or any job runner to invoke:

```bash
node src/cli/run-batch.js --category mouse
```

Example cron (hourly):

```cron
0 * * * * cd /path/to/spec-harvester && node src/cli/run-batch.js --category mouse
```

## IAM Least-Privilege Policy (Example)

Replace `my-spec-harvester-data` with your bucket name.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListInputOutputPrefixes",
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::my-spec-harvester-data",
      "Condition": {
        "StringLike": {
          "s3:prefix": [
            "specs/inputs/*",
            "specs/outputs/*"
          ]
        }
      }
    },
    {
      "Sid": "ReadInputs",
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": "arn:aws:s3:::my-spec-harvester-data/specs/inputs/*"
    },
    {
      "Sid": "WriteOutputs",
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": "arn:aws:s3:::my-spec-harvester-data/specs/outputs/*"
    }
  ]
}
```

## Testing

Unit tests cover:

- `ld+json` extraction
- embedded state extraction
- anchor mismatch severity logic

Run:

```bash
npm test
```

## Add a New Category Checklist

1. Add category field order/constants and validation rules.
2. Add category-specific normalizer and pass targets.
3. Add category-specific anchor mismatch evaluator.
4. Add extraction aliases for category fields.
5. Add sample input + dry-run fixtures.
6. Add/update CLI category routing.
7. Add unit tests for extractors + validator rules.
8. Update README with new category contract.

## Safety Notes

- Rate limits per host are enforced (`PER_HOST_MIN_DELAY_MS`).
- Discovery stays inside allowlisted hosts.
- No cookies or sensitive auth headers are persisted.
- JSON response capture is size bounded (`MAX_JSON_BYTES`).
- If identity certainty cannot reach 99%, output is intentionally restricted and marked `MODEL_AMBIGUITY_ALERT`.
