# Spec Harvester Agent Rules

## Scope
- Primary goal: produce accurate mouse specs using backend-first extraction and credible sources.
- Never guess values. Use "unk" when uncertain.
- Do not change the canonical mouse field order.

## Safety
- Do not store cookies or auth headers.
- Redact any sensitive headers in logs.
- Respect per-host rate limits and allowlists only.

## Data Contracts (S3)
- Inputs: s3://$S3_BUCKET/$S3_INPUT_PREFIX/mouse/products/*.json
- Outputs: s3://$S3_BUCKET/$S3_OUTPUT_PREFIX/mouse/$productId/{runs,latest}/...

## Identity Lock
- Treat identityLock + anchors as high-confidence. Do not override them.
- If identity certainty < 99%: set validated=false, reason=MODEL_AMBIGUITY_ALERT, and do not fill non-anchor specs.

## Source Strategy
- Tier 1: manufacturer + instrumented labs (preferred)
- Tier 2: trusted spec databases/review sites
- Tier 3: retailers (confirmation only)

## Dev Workflow
- Run unit tests and the local smoke test before committing.
- Keep changes minimal and well-scoped; prefer adding modules over refactors.
