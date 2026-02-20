# PHASE-07 IMPROVMENT

## What I'd Add
1. Add tier-aware retrieval with explicit applicability-aware ranking.
2. Add hard filters for identity-sensitive fields when identity is unresolved.
3. Add retrieval trace objects showing query, scoring factors, and chosen prime sources.
4. Add per-field retrieval diagnostics for misses (`no_anchor`, `tier_deficit`, `identity_mismatch`).

## What We Should Implement Now
1. Apply per-field tier preference and min refs directly in retriever scoring.
2. Add retrieval hit table columns for identity/applicability.
3. Persist prime source packs with deterministic snippet IDs.

## Implemented Now (2026-02-19)
1. Added `src/retrieve/tierAwareRetriever.js` for tier/doc-kind/anchor/identity weighted internal hit ranking.
2. Added `src/retrieve/primeSourcesBuilder.js` to select per-field prime sources with min-ref and distinct-source checks.
3. Wired Phase 07 in `src/pipeline/runProduct.js`:
   - writes `analysis/phase07_retrieval.json` (run + latest)
   - emits `phase07_prime_sources_built` proof event.
4. Added GUI API endpoint: `GET /api/v1/indexlab/run/:runId/phase07-retrieval`.
5. Added GUI panel: `Tier Retrieval & Prime Sources (Phase 07)` with:
   - field-level pass/fail against min refs
   - selected prime source rows
   - top retrieval hit rows and selected-state proof.

## Definition Of Done
1. Prime source selection is explainable for each field.
2. Identity-unsafe snippets are not selected for critical fields.
3. Min refs and distinct-source rules are visibly satisfied or failed.
