# spec-harvester

Backend-first, category-pluggable spec harvester (Node 20 + Playwright + S3).

## Main CLI

Single universal entrypoint:

```bash
node src/cli/spec.js <command>
```

Commands:

- `run-one --s3key <key>`
- `run-ad-hoc <category> <brand> <model> [<variant>] [--profile <standard|thorough|fast>] [--thorough]`
- `run-ad-hoc --category <category> --brand <brand> --model <model> [--profile <standard|thorough|fast>] [--thorough]`
- `run-batch --category mouse [--brand <brand>] [--strategy <explore|exploit|mixed|bandit>]`
- `discover --category mouse [--brand <brand>]`
- `test-s3 [--fixture <path>] [--s3key <key>] [--dry-run]`
- `sources-plan --category mouse`
- `sources-report --category mouse [--top <n>]`
- `benchmark --category mouse [--fixture <path>] [--max-cases <n>]`
- `rebuild-index --category mouse`
- `intel-graph-api --category mouse [--host <host>] [--port <port>]`

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
- `s3://{S3_BUCKET}/{S3_OUTPUT_PREFIX}/{category}/{productId}/runs/{runId}/extracted/{host}/candidates.json`
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

- `s3://{S3_BUCKET}/{S3_INPUT_PREFIX}/_discovery/{category}/{runId}.json`
- `s3://{S3_BUCKET}/{S3_INPUT_PREFIX}/_sources/candidates/{category}/{runId}.json`
- `s3://{S3_BUCKET}/{S3_INPUT_PREFIX}/_sources/overrides/{category}/sources.override.json` (optional runtime source override)

Learning artifacts:

- `s3://{S3_BUCKET}/{S3_OUTPUT_PREFIX}/_learning/{category}/profiles/{profileId}.json`
- `s3://{S3_BUCKET}/{S3_OUTPUT_PREFIX}/{category}/{productId}/runs/{runId}/logs/learning.json`
- `s3://{S3_BUCKET}/{S3_OUTPUT_PREFIX}/_source_intel/{category}/domain_stats.json`
- `s3://{S3_BUCKET}/{S3_OUTPUT_PREFIX}/_source_intel/{category}/promotion_suggestions/YYYY-MM-DD.json`
- `s3://{S3_BUCKET}/{S3_OUTPUT_PREFIX}/_source_intel/{category}/expansion_plans/YYYY-MM-DD.json`
- `s3://{S3_BUCKET}/{S3_OUTPUT_PREFIX}/_source_intel/{category}/expansion_plans/brands/{brand}/YYYY-MM-DD.json`

## Environment Variables

Core:

- `AWS_REGION=us-east-2`
- `S3_BUCKET=my-spec-harvester-data`
- `S3_INPUT_PREFIX=specs/inputs`
- `S3_OUTPUT_PREFIX=specs/outputs`

Budgets/throttles:

- `MAX_URLS_PER_PRODUCT=20`
- `MAX_CANDIDATE_URLS_PER_PRODUCT=50` (also supports `MAX_CANDIDATE_URLS`)
- `MAX_PAGES_PER_DOMAIN=2`
- `MANUFACTURER_DEEP_RESEARCH_ENABLED=true|false` (default `true`)
- `MAX_MANUFACTURER_URLS_PER_PRODUCT=20`
- `MAX_MANUFACTURER_PAGES_PER_DOMAIN=8`
- `MANUFACTURER_RESERVE_URLS=10` (keeps crawl slots for manufacturer URLs)
- `MAX_RUN_SECONDS=300`
- `MAX_JSON_BYTES=2000000`
- `MAX_PDF_BYTES=8000000`
- `CONCURRENCY=2`
- `PER_HOST_MIN_DELAY_MS=900`
- `USER_AGENT="Mozilla/5.0 (compatible; EGSpecHarvester/1.0; +https://eggear.com)"`
- `RUN_PROFILE=standard|thorough|fast` (default `standard`; `thorough` targets deep ~1h runs)
- `HYPOTHESIS_AUTO_FOLLOWUP_ROUNDS=0`
- `HYPOTHESIS_FOLLOWUP_URLS_PER_ROUND=12`
- `ENDPOINT_SIGNAL_LIMIT=30`
- `ENDPOINT_SUGGESTION_LIMIT=12`
- `ENDPOINT_NETWORK_SCAN_LIMIT=600`
- `MAX_NETWORK_RESPONSES_PER_PAGE=1200`
- `PAGE_GOTO_TIMEOUT_MS=30000`
- `PAGE_NETWORK_IDLE_TIMEOUT_MS=6000`
- `POST_LOAD_WAIT_MS=0`
- `AUTO_SCROLL_ENABLED=true|false` (default `false`)
- `AUTO_SCROLL_PASSES=0`
- `AUTO_SCROLL_DELAY_MS=900`
- `MANUFACTURER_BROAD_DISCOVERY=true|false` (default `false`)

Discovery (optional):

- `DISCOVERY_ENABLED=true|false` (default `false`)
- `FETCH_CANDIDATE_SOURCES=true|false` (default `true`)
- `DISCOVERY_MAX_QUERIES=8`
- `DISCOVERY_RESULTS_PER_QUERY=10`
- `DISCOVERY_MAX_DISCOVERED=120`
- `SEARCH_PROVIDER=bing|google_cse|none` (default `none`)
- `BING_SEARCH_KEY`, `BING_SEARCH_ENDPOINT`
- `GOOGLE_CSE_KEY`, `GOOGLE_CSE_CX`

LLM / OpenAI (optional):

- `LLM_ENABLED=true|false` (default `false`)
- `LLM_WRITE_SUMMARY=true|false` (default `false`)
- `LLM_PLAN_DISCOVERY_QUERIES=true|false` (default `false`)
- `LLM_REASONING_MODE=true|false` (default `false`)
- `LLM_REASONING_BUDGET=2048` (token budget hint for reasoning-mode calls)
- `DEEPSEEK_API_KEY=...` (supported alias for `OPENAI_API_KEY`)
- `OPENAI_API_KEY=...`
- `OPENAI_BASE_URL=...` (default `https://api.openai.com`)
- `OPENAI_MODEL_EXTRACT=...`
- `OPENAI_MODEL_PLAN=...`
- `OPENAI_MODEL_WRITE=...`
- `OPENAI_MAX_INPUT_CHARS=50000`
- `OPENAI_TIMEOUT_MS=40000`

Local toggles:

- `LOCAL_MODE=true|false`
- `DRY_RUN=true|false`
- `LOCAL_S3_ROOT=fixtures/s3`
- `LOCAL_OUTPUT_ROOT=out`
- `WRITE_MARKDOWN_SUMMARY=true|false`
- `ALLOW_BELOW_PASS_TARGET_FILL=true|false` (default `false`)
- `SELF_IMPROVE_ENABLED=true|false` (default `true`)
- `MAX_HYPOTHESIS_ITEMS=50`
- `FIELD_REWARD_HALF_LIFE_DAYS=45` (decay window for field reward memory)
- `BATCH_STRATEGY=explore|exploit|mixed|bandit` (default `bandit`)

EloShapes adapter (optional, safe default disabled):

- `ELO_SUPABASE_ANON_KEY=<anon key>`
- `ELO_SUPABASE_ENDPOINT=<public PostgREST endpoint>`

If either value is missing, EloShapes API adapter is skipped.

Dotenv support:

- CLI auto-loads `.env` by default.
- Override dotenv path with `--env <path>`.
- Existing process env vars win over `.env` values.

## Backend Data Scripts

Primary Python helpers in `scripts/`:

- `fetch_eloshapes_supabase.py`
  - Range-pagination Supabase/PostgREST fetcher
  - retry/backoff support
  - bounded rows/pages and structured `page_trace`
- `extract_pdf_kv.py`
  - PDF table/text key-value extraction
  - pair dedupe, bounds, extraction metadata

Backward-compatible wrappers retained:

- `eloshapes_fetch.py` -> forwards to `fetch_eloshapes_supabase.py`
- `pdf_extract_tables.py` -> forwards to `extract_pdf_kv.py`

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

Run ad-hoc directly from identity inputs:

```bash
node src/cli/spec.js run-ad-hoc --category mouse --brand Razer --model "Viper V3 Pro" --variant Wireless
```

Run ad-hoc in deep/thorough profile:

```bash
node src/cli/spec.js run-ad-hoc mouse Logitech "G Pro X Superlight 2" --thorough
```

Run ad-hoc in one line (positional form):

```bash
node src/cli/spec.js run-ad-hoc mouse Razer "Viper V3 Pro" Wireless
```

Run ad-hoc with seed URLs and explicit key:

```bash
node src/cli/spec.js run-ad-hoc --category mouse --brand Logitech --model "G Pro X Superlight 2" --seed-urls "https://www.logitechg.com/en-us/products/gaming-mice/pro-x-superlight-2.910-006628.html,https://www.rtings.com/mouse/reviews/logitech/g-pro-x-superlight-2" --s3key specs/inputs/mouse/products/mouse-logitech-g-pro-x-superlight-2.json
```

Run batch:

```bash
node src/cli/spec.js run-batch --category mouse
```

Run batch with scheduling strategy:

```bash
node src/cli/spec.js run-batch --category mouse --strategy bandit
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

S3 integration test through the main CLI:

```bash
node src/cli/spec.js test-s3
```

Source intelligence report:

```bash
node src/cli/spec.js sources-report --category mouse --top 30
```

Source expansion plan generation:

```bash
node src/cli/spec.js sources-plan --category mouse
```

Run golden benchmark checks:

```bash
node src/cli/spec.js benchmark --category mouse
```

Start intel graph API (for agent consumption):

```bash
node src/cli/spec.js intel-graph-api --category mouse --port 8787
```

Example graph query:

```bash
curl -s http://127.0.0.1:8787/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"query Q($limit:Int){ topDomains }","variables":{"limit":10}}'
```

Supported graph operations (query string can include one or multiple):

- `topDomains` (vars: `category`, `limit`, `topPaths`)
- `domainStats` / `hostStats` (vars: `category`, `rootDomain`, `topPaths`)
- `product` (vars: `category`, `productId`)
- `missingCriticalFields` (vars: `category`, `productId`)
- `bestEvidence` (vars: `category`, `productId`, `field`, `limit`)
- `whyFieldRejected` (vars: `category`, `productId`, `field`)
- `nextBestUrls` (vars: `category`, `productId`, `field`, `limit`)
- `conflictGraph` (vars: `category`, `productId`, `limit`)

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

## Scheduling

Run a repeatable batch on a cadence (cron, GitHub Actions, ECS scheduled task, etc):

```bash
node src/cli/spec.js run-batch --category mouse
```

Optional brand-scoped scheduled run:

```bash
node src/cli/spec.js run-batch --category mouse --brand Razer
```

Each run updates learning profiles and latest pointers while preserving strict validation gates.

## One-Line Cloud First Run

If your `.env` is set for cloud (`LOCAL_MODE=false`, `DRY_RUN=false`, valid AWS creds), this is the fastest first-run command:

```bash
node src/cli/spec.js run-ad-hoc <category> <brand> "<model>" [variant]
```

For a deep cloud run (long budget + aggressive backend data capture), use:

```bash
node src/cli/spec.js run-ad-hoc <category> <brand> "<model>" [variant] --thorough
```

Example:

```bash
node src/cli/spec.js run-ad-hoc mouse Logitech "G Pro X Superlight 2" Wireless
```

Behavior:

- validates that `categories/<category>/` schema/config files exist
- creates/updates the product input JSON at `specs/inputs/<category>/products/`
- runs full crawl+extraction pipeline
- writes run outputs and latest pointers to `s3://{S3_BUCKET}/{S3_OUTPUT_PREFIX}/...`

## Self-Improving Accuracy Loop

Each run records reusable learning artifacts:

- host yield stats (`identityMatchRate`, conflicts, candidate yield)
- preferred URLs for the exact brand/model/variant
- unknown-field rate trend

On the next run, the planner reuses high-yield URLs first, so evidence quality improves over time without relaxing validation or safety controls.
Set `FETCH_CANDIDATE_SOURCES=true` for wider evidence crawl while keeping candidate domains non-counting until approved.
LLM remains optional and candidate-only; it never bypasses validation gates or anchor locks.

Manufacturer-first behavior:

- official manufacturer pages are queued and processed before labs/databases/retailers
- manufacturer deep seeds are auto-added each run (`search/support/manual/spec/download` patterns)
- reserved URL capacity prevents non-manufacturer pages from crowding out manufacturer research

## Domain Approval Workflow

Discovery results do not count toward 3-confirmation until approved.

1. Run `discover` with official API provider enabled.
2. Review candidate file at `.../_sources/candidates/{category}/{runId}.json`.
3. Add approved host to `categories/{category}/sources.json` under correct tier,
   or to `specs/inputs/_sources/overrides/{category}/sources.override.json` for runtime override.
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
