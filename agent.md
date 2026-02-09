# agent.md - spec-harvester (Accuracy-first + LLM-assisted, repeatable)

## Mission
Produce accurate, auditable device specs (mouse first; category-pluggable).

Accuracy over completeness:
- Never guess.
- Use `unk` if unsure, and `n/a` only when truly not applicable.

## Safety and Compliance
- No auth/paywall/captcha bypass.
- Only use data accessible to a normal browser session.
- Respect per-host throttles and budgets.
- Do not store cookies or sensitive headers in S3/logs.
- Never log secrets (AWS keys, search keys, OpenAI key, Elo key).

## Category Configs
All behavior must be category-driven from `categories/{category}/...`:
- `schema.json`
- `sources.json`
- `required_fields.json`
- `anchors.json`
- `search_templates.json`

## Credible Source Policy
- Approved domains count toward confirmations.
- Candidate domains may be fetched for evidence but do not count until approved.
- Candidate tier must remain last (`tier=4`).

## LLM Policy (OpenAI API)
- LLM is optional; core pipeline must work with LLM disabled.
- LLM outputs are candidate-only and must include `evidenceRefs`.
- LLM must never override `identityLock` or anchor-locked fields.
- LLM summaries must only restate validated values and provenance.

## Learning and Source Intelligence
- Persist per-domain stats under `_source_intel/{category}/...`.
- Use stats only to improve source ordering and promotion suggestions.
- Never auto-promote candidate domains without explicit approval.

## Validation Gate
`validated` may be true only if all are true:
- identity certainty >= 0.99
- no major anchor conflicts
- completeness_required >= target
- confidence >= target
- no critical fields below pass target

## Workflow (every Codex task)
- Make minimal, scoped changes.
- Run unit tests and smoke tests before finishing.
- Update docs for behavior/env changes.
