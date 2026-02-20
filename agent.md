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

## Field Rules Contract
All field behavior is driven by compiled `field_rules.json` under `helper_files/{category}/_generated/`:
- Each field has a contract (type, shape, unit, range), enum config (policy, source), component reference, parse template, evidence requirements, priority level, and UI metadata.
- `normalizeFieldContract()` exposes a compact 6-property summary to the review grid: `type`, `required`, `units`, `enum_name`, `component_type`, `enum_source`.
- See `docs/PHASE-01-FIELD-RULES-AUTHORING.md` for full details.

## Data Lists (Enum Values)
- Defined in Excel `data_lists` sheet, compiled to `known_values.json`.
- Runtime mutations (add/remove/rename) cascade to all affected items.
- Remove: clears `item_field_state.value`, marks products stale with `priority=1`.
- Rename: atomically updates values in SQLite + filesystem, re-points list links.
- List values carry source provenance (workbook, pipeline, manual) with candidates.

## Component Databases
- Components (sensor, switch, encoder, material) are compiled from Excel sheets to JSON + SQLite.
- Each property has a variance policy: `authoritative`, `upper_bound`, `lower_bound`, `range`, `override_allowed`.
- Changes cascade to linked products: authoritative pushes values directly; bound policies flag violations.
- Constraints (e.g., `sensor_date <= release_date`) evaluated independently.

## Source Registry and Evidence
- `source_registry` tracks every crawled URL per product per run.
- `source_assertions` normalize candidates into claims (assertion_id = candidate_id).
- `source_evidence_refs` store specific quotes/snippets backing each assertion.
- Full lineage: candidates -> source_registry -> source_assertions -> source_evidence_refs.

## Two-Lane AI Review Model
- **Primary lane** (teal): per-product field value correctness. Applies to ALL fields.
- **Shared lane** (purple): component DB or enum list consistency. Applies to fields with `component_type` or `enum_source`.
- Each lane tracks: AI confirm status, confidence, user accept status, user override.
- Missing `key_review_state` row = pending (AI review never ran).
- API: `POST /review/{cat}/key-review-confirm`, `POST /review/{cat}/key-review-accept`.

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

## Documentation
- `implementation/SpecFactory Ecosystem Data Managament/architecture.md` — principal architecture reference (60+ endpoints, data flow, SpecDb, key review, propagation)
- `implementation/SpecFactory Ecosystem Data Managament/source-schema-key-review-split.md` — source/key-review schema design (DDL, ownership boundaries, implementation status)
- `implementation/SpecFactory Ecosystem Data Managament/specdb-source-capture-and-sharing.md` — SpecDb source capture, sharing model, source registry, two-lane AI review wiring
- `implementation/PHASE-01-FIELD-RULES-AUTHORING.md` — field rules contract, compilation pipeline, list/component sources, variance policies, propagation behavior, two-lane AI review model
- `implementation/SpecFactory Ai validation/architecture.md` — component AI validation, three-tier resolution, variance policies, TypeScript types
- `docs/SPECFACTORY_ECOSYSTEM_DATA_MANAGEMENT.md` — condensed data management reference
- `docs/PHASE-01-FIELD-RULES-AUTHORING.md` — condensed field rules reference
