# spec-harvester

Backend-first, category-pluggable spec harvester (Node 20 + Playwright + S3).

## Main CLI

Single universal entrypoint:

```bash
node src/cli/spec.js <command>
```

Commands:

- `run-one --s3key <key>`
- `run-batch --category mouse [--brand <brand>]`
- `discover --category mouse [--brand <brand>]`
- `rebuild-index --category mouse`

## Category Config Layout

Each category is driven by files in `categories/{category}/`:

- `schema.json`
- `sources.json`
- `required_fields.json`
- `search_templates.json`
- `anchors.json`

Current category included: `mouse`.

## S3 Layout

Inputs:

- `s3://{S3_BUCKET}/{S3_INPUT_PREFIX}/{category}/products/{productId}.json`

Run outputs:

- `s3://{S3_BUCKET}/{S3_OUTPUT_PREFIX}/{category}/{productId}/runs/{runId}/raw/pages/{host}/page.html.gz`
- `s3://{S3_BUCKET}/{S3_OUTPUT_PREFIX}/{category}/{productId}/runs/{runId}/raw/pages/{host}/ldjson.json`
- `s3://{S3_BUCKET}/{S3_OUTPUT_PREFIX}/{category}/{productId}/runs/{runId}/raw/pages/{host}/embedded_state.json`
- `s3://{S3_BUCKET}/{S3_OUTPUT_PREFIX}/{category}/{productId}/runs/{runId}/raw/network/{host}/responses.ndjson.gz`
- `s3://{S3_BUCKET}/{S3_OUTPUT_PREFIX}/{category}/{productId}/runs/{runId}/raw/pdfs/{host}/*` (manufacturer PDFs, when found)
- `s3://{S3_BUCKET}/{S3_OUTPUT_PREFIX}/{category}/{productId}/runs/{runId}/raw/adapters/*.json`
- `s3://{S3_BUCKET}/{S3_OUTPUT_PREFIX}/{category}/{productId}/runs/{runId}/normalized/{category}.normalized.json`
- `s3://{S3_BUCKET}/{S3_OUTPUT_PREFIX}/{category}/{productId}/runs/{runId}/normalized/{category}.row.tsv`
- `s3://{S3_BUCKET}/{S3_OUTPUT_PREFIX}/{category}/{productId}/runs/{runId}/provenance/fields.provenance.json`
- `s3://{S3_BUCKET}/{S3_OUTPUT_PREFIX}/{category}/{productId}/runs/{runId}/provenance/fields.candidates.json`
- `s3://{S3_BUCKET}/{S3_OUTPUT_PREFIX}/{category}/{productId}/runs/{runId}/logs/events.jsonl.gz`
- `s3://{S3_BUCKET}/{S3_OUTPUT_PREFIX}/{category}/{productId}/runs/{runId}/logs/summary.json`
- `s3://{S3_BUCKET}/{S3_OUTPUT_PREFIX}/{category}/{productId}/runs/{runId}/summary/{category}.summary.md` (optional)

Latest pointers:

- `.../{category}/{productId}/latest/normalized.json`
- `.../{category}/{productId}/latest/provenance.json`
- `.../{category}/{productId}/latest/summary.json`
- `.../{category}/{productId}/latest/{category}.row.tsv`
- `.../{category}/{productId}/latest/summary.md` (optional)

Discovery candidates (manual approval queue):

- `s3://{S3_BUCKET}/{S3_INPUT_PREFIX}/_sources/candidates/{category}/{runId}.json`

## Environment Variables

Core:

- `AWS_REGION=us-east-2`
- `S3_BUCKET=my-spec-harvester-data`
- `S3_INPUT_PREFIX=specs/inputs`
- `S3_OUTPUT_PREFIX=specs/outputs`

Budgets/throttles:

- `MAX_URLS_PER_PRODUCT=10`
- `MAX_PAGES_PER_DOMAIN=2`
- `MAX_RUN_SECONDS=180`
- `MAX_JSON_BYTES=2000000`
- `CONCURRENCY=2`
- `PER_HOST_MIN_DELAY_MS=900`
- `USER_AGENT="Mozilla/5.0 (compatible; EGSpecHarvester/1.0; +https://eggear.com)"`

Discovery (optional):

- `DISCOVERY_ENABLED=true|false` (default `false`)
- `SEARCH_PROVIDER=bing|google_cse|none` (default `none`)
- `BING_SEARCH_KEY`, `BING_SEARCH_ENDPOINT`
- `GOOGLE_CSE_KEY`, `GOOGLE_CSE_CX`

Local toggles:

- `LOCAL_MODE=true|false`
- `DRY_RUN=true|false`
- `LOCAL_S3_ROOT=fixtures/s3`
- `LOCAL_OUTPUT_ROOT=out`
- `WRITE_MARKDOWN_SUMMARY=true|false`

EloShapes adapter (optional, safe default disabled):

- `ELO_SUPABASE_ANON_KEY=<anon key>`
- `ELO_SUPABASE_ENDPOINT=<public PostgREST endpoint>`

If either value is missing, EloShapes API adapter is skipped.

## Install

```bash
npm install
npx playwright install --with-deps chromium
```

## Run Examples

Run one:

```bash
node src/cli/spec.js run-one --s3key specs/inputs/mouse/products/mouse-razer-viper-v3-pro.json
```

Run batch:

```bash
node src/cli/spec.js run-batch --category mouse
```

Brand-scoped batch:

```bash
node src/cli/spec.js run-batch --category mouse --brand Razer
```

Discovery only:

```bash
DISCOVERY_ENABLED=true SEARCH_PROVIDER=bing node src/cli/spec.js discover --category mouse --brand Razer
```

Rebuild category index:

```bash
node src/cli/spec.js rebuild-index --category mouse
```

## Tests and Smoke

Unit tests:

```bash
npm test
```

Local dry-run smoke:

```bash
npm run smoke
npm run smoke:local
```

S3 integration test:

```bash
npm run test:s3
```

## Domain Approval Workflow

Discovery results do not count toward 3-confirmation until approved.

1. Run `discover` with official API provider enabled.
2. Review candidate file at `.../_sources/candidates/{category}/{runId}.json`.
3. Add approved host to `categories/{category}/sources.json` under correct tier.
4. Re-run `run-one`/`run-batch`.

## How to Add a Category

1. Create `categories/{category}/` and add all 5 config files.
2. Add category sample input under `sample_inputs/specs/inputs/{category}/products/`.
3. Add parser/adapter mappings for category fields.
4. Add tests for field extraction + consensus + validation gate.
5. Run `npm test` and `npm run smoke:local`.

## IAM Least Privilege (example)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
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
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": "arn:aws:s3:::my-spec-harvester-data/specs/inputs/*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": "arn:aws:s3:::my-spec-harvester-data/specs/outputs/*"
    }
  ]
}
```

## Safety

- Accuracy first; never guess.
- No bypassing auth/paywalls/captcha.
- No cookies/auth headers in artifacts.
- Response bodies are size-bounded.
- Discovery is API-only and writes candidates for human approval.
- Unapproved domains never count toward confirmation rules.
