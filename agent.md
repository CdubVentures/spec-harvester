# AGENT.md  EG Spec Harvester Rules

## Core Rules
- Preserve category schema field order exactly as defined in `categories/{category}/schema.json`.
- Never guess values.
- Use `unk` when uncertain and `n/a` only when truly not applicable.
- Keep crawling scope narrow (allowlisted domains, limited page budgets, host throttling).

## Security and Compliance
- Do not bypass auth, paywalls, or captcha.
- Do not store cookies, Authorization headers, or sensitive request headers in logs/artifacts.
- Keep response artifacts bounded by configured size limits.
- Collect only what a normal browser session can access.

## Source Confirmation Policy
- Non-anchor fields require at least 3 credible confirmations from unique approved root domains.
- Unapproved/newly discovered domains are candidates only and must never count toward confirmation totals.
- Retailer/marketplace sources are confirmation-only (not sole authority).

## Identity and Anchors
- `identityLock` and anchor values are do-not-override.
- Any major anchor conflict downgrades trust and blocks validation.
- If identity confidence < 0.99, mark run as model ambiguity and withhold non-locked spec filling.

## Category-Driven Structure
All category behavior must come from:
- `categories/{category}/schema.json`
- `categories/{category}/sources.json`
- `categories/{category}/required_fields.json`
- `categories/{category}/search_templates.json`
- `categories/{category}/anchors.json`

## Required Execution Flow for Agent Changes
1. Make minimal scoped changes.
2. Run `npm test`.
3. Run `npm run smoke` and `npm run smoke:local`.
4. If S3 behavior changed, run `npm run test:s3`.
5. Update README and AGENT.md when behavior/contracts change.

## Discovery and Domain Approval
- Use official search APIs only (`bing` or `google_cse`) when discovery is enabled.
- Write discovery output to `s3://$S3_BUCKET/$S3_INPUT_PREFIX/_sources/candidates/{category}/{runId}.json`.
- Human approval is required before domains are moved into `categories/{category}/sources.json`.

## Main CLI
Use the single main entrypoint:
- `node src/cli/spec.js run-one --s3key ...`
- `node src/cli/spec.js run-batch --category ... [--brand ...]`
- `node src/cli/spec.js discover --category ... [--brand ...]`
- `node src/cli/spec.js rebuild-index --category ...`
