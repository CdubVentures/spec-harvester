# PHASE-03 IMPROVMENT

## What I'd Add
1. Persist SERP applicability fields: `identity_match_level`, `variant_guard_hit`, `multi_model_hint`, `other_model_tokens`.
2. Add deterministic triage score decomposition (tier/doc kind/identity bonuses/penalties).
3. Add clear job-intent emission payload for later scheduler use (`dedupe_hash`, `field_targets`, `doc_hint`).
4. Add duplicate cluster view so near-duplicate URLs are obvious before fetch.

## What We Should Implement Now
1. Add applicability fields to SERP panel columns.
2. Add score reason badges and keep/reject explanations in plain text.
3. Emit triage decisions in scheduler-ready structure without adding scheduling policy here.

## Definition Of Done
1. Users can explain why a URL was selected or skipped.
2. Wrong-model candidates are visibly penalized.
3. Phase-03 artifacts are ready for Phase-06B automation.
