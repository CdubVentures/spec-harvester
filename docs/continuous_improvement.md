# Continuous Improvement Loop

This project runs a schema-driven extraction pipeline with persisted learning artifacts. The goal is to reduce `unk` caused by system weakness while keeping unknowns only when evidence is genuinely unavailable or conflicting.

## Field Availability Model

Per category, the system writes:

`out/_learning/<category>/field_availability.json`

Each field tracks:

- `validated_seen`
- `validated_filled`
- `filled_rate_validated`
- `classification`: `expected | sometimes | rare`
- `unknown_reason_counts`
- `top_domains` (best domains for filling that field)

Classification behavior:

- `expected`: high fill rate on validated runs. The orchestrator spends more search effort.
- `sometimes`: targeted effort based on source yield and discovered domains.
- `rare`: lower effort; faster transition to `not_publicly_disclosed` unless high-yield domains exist.

Runtime usage:

- `run-until-complete` allocates more queries/urls for missing expected fields.
- Unknown reason assignment is availability-aware instead of a fixed source-count threshold.

## LLM Health + Verification

Run LLM connectivity and billing validation:

```bash
node src/cli/spec.js llm-health --provider deepseek --model deepseek-reasoner --local
```

This confirms:

- provider/model/base URL resolution
- JSON schema compatibility/fallback behavior
- token usage + estimated usage flags
- per-call cost logging into billing ledger

Verification mode:

- Enable with `LLM_VERIFY_MODE=true`
- Optional sample rate: `LLM_VERIFY_SAMPLE_RATE=10`

When enabled, sampled runs (or forced missing-required runs) compare extraction behavior across fast/reasoning models and write reports to:

`out/_reports/llm_verify/<YYYY-MM-DD>.json`

## Unknown Reason Interpretation

Field-level reasons are in:

- `summary.field_reasoning`
- `explain-unk` CLI output

Common reasons:

- `not_found_after_search`
- `not_publicly_disclosed`
- `conflicting_sources_unresolved`
- `identity_ambiguous`
- `blocked_by_robots_or_tos`
- `parse_failure`
- `budget_exhausted`

Interpretation:

- `not_publicly_disclosed` should only appear after availability-aware effort has been spent.
- `conflicting_sources_unresolved` indicates contradictory evidence requiring targeted follow-up.
- `identity_ambiguous` means variant/identity lock confidence is still below safe threshold.

## Useful Commands

- Single product multi-round:

```bash
node src/cli/spec.js run-until-complete --s3key <input-key> --mode aggressive --local
```

- Learning summary:

```bash
node src/cli/spec.js learning-report --category <category> --local
```

- Billing summary:

```bash
node src/cli/spec.js billing-report --month 2026-02 --local
```

- Explain unresolved unknown fields:

```bash
node src/cli/spec.js explain-unk --category <category> --brand "<brand>" --model "<model>" --local
```
