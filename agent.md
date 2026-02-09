# Agent.md - Spec Harvester Operating Rules

## Mission
Build accurate, auditable product specs with backend-first evidence collection.
Current primary category is `mouse`; all logic must remain category-pluggable.

## Non-negotiables
- Accuracy over completeness.
- Never guess. Use `unk` when uncertain, and `n/a` only when truly not applicable.
- Preserve canonical schema field order exactly as category schema defines.
- Respect identity lock and anchors as do-not-override constraints.

## Domain policy
- Approved domains are defined in `categories/{category}/sources.json`.
- Candidate domains discovered at runtime are evidence-only.
- Candidate domains must never count toward pass-target confirmations.
- Candidate promotion requires explicit human update to category sources config.

## Identity and validation gates
- Mouse identity gate must enforce 99% certainty.
- If identity is ambiguous, output `MODEL_AMBIGUITY_ALERT` behavior and avoid filling specs.
- `validated=true` only when identity gate, confidence threshold, completeness target, and anchor checks all pass.
- Metrics must stay honest:
  - `completeness_required` over required fields only
  - `coverage_overall` over full schema (excluding configured editorial fields)

## Evidence collection and safety
- Prefer extraction methods in this order:
  `network_json` -> `embedded_state` -> `ldjson` -> `html_table` -> `dom`.
- Capture replay-safe request metadata for JSON/GraphQL evidence:
  `request_url`, `request_method`, `request_post_json`, `resource_type`.
- Do not store cookies, Authorization headers, or other sensitive headers.
- Keep payloads bounded by configured byte limits.
- Do not broaden crawling scope beyond planner budgets.

## Confirmation policy
- Default non-anchor fill requires 3 unique approved root domains.
- Commonly wrong fields target 5 confirmations.
- Instrumented-only fields require instrumented evidence and cannot use relaxed fill.
- Optional relaxed mode:
  `ALLOW_BELOW_PASS_TARGET_FILL=true` can fill with 2 confirmations only if:
  - one is Tier 1 manufacturer, and
  - one is Tier <=2 approved source.
  Provenance must still mark `meets_pass_target=false`.

## Self-improving loop
- Each run must persist a learning profile under output `_learning`.
- Learning may refine future seed priorities (preferred URLs, host yield stats).
- Learning must not weaken safety rules, approval rules, or validation gates.
- New domains discovered by search remain candidates until approved.

## Debug and deployment loop
- Every run must emit structured logs and summary reasons for failure analysis.
- Deployment cadence should run `run-batch` on schedule and reuse learning profiles.
- Improvements must come from better source selection, adapter coverage, and approved domain updates, not unsafe crawling.

## Execution standards for Codex tasks
- Keep changes scoped and backward compatible.
- Maintain CLI compatibility wrappers.
- Run tests and smoke checks before finalizing:
  - `npm test`
  - `npm run smoke`
  - `npm run smoke:local`
- For S3 pipeline checks use:
  - `node src/cli/spec.js test-s3`
