# Adapter Guide

Adapters live in `src/adapters/` and should focus on high-value sources.

## Goals

- Improve extraction precision for trusted domains.
- Reuse deterministic evidence from Playwright capture.
- Keep candidate values auditable with method + keyPath metadata.

## Adapter interface

Each adapter may implement:

- `name`
- `seedUrls({ job, config })`
- `supportsHost({ source, pageData, job })`
- `extractFromPage({ source, pageData, job, config, runId })`
- `runDedicatedFetch({ config, job, runId, logger, storage })`

`extractFromPage` should return:

- `fieldCandidates[]`
- `identityCandidates{}`
- `additionalUrls[]`
- `pdfDocs[]`
- `adapterArtifacts[]`

## NetworkRecorder hints

Network rows are classified in `src/fetcher/networkRecorder.js`:

- `product_payload`
- `variant_matrix`
- `specs`
- `pricing`
- `reviews`
- `unknown`

Adapters should prefer:

1. `specs`, `product_payload`, `variant_matrix`
2. embedded state
3. HTML tables

## Method tagging

Use consistent `method` tags for candidates:

- `network_json`
- `adapter_api`
- `embedded_state`
- `ldjson`
- `html_table`
- `pdf_table`
- `llm_extract`

This feeds consensus weighting and provenance reporting.

## Python helper scripts

Python helpers belong in `scripts/` when they add material value (PDF parsing, API pagination).

Rules:

- never hardcode secrets
- load keys from env
- redact secrets in logs/artifacts
- bound outputs for storage safety

Current helpers:

- `scripts/eloshapes_fetch.py`
- `scripts/pdf_extract_tables.py`

## Safety rules

- Do not bypass auth/paywalls/captcha.
- Do not store cookies or sensitive headers.
- Candidate domains do not count toward confirmation until approved.
