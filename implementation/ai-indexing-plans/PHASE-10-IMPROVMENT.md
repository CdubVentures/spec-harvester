# PHASE-10 IMPROVMENT

## What I'd Add
1. Add strict learning acceptance gates: confidence, refs, tier, identity safety.
2. Add separate memory stores for anchors, domain yield, and identity aliases.
3. Add rollback-safe learning suggestions (propose first, accept later).
4. Add decay and expiration for stale or low-yield learned entries.

## What We Should Implement Now
1. Only learn from accepted prime sources with sufficient evidence policy pass.
2. Add Learning Feed rows that show exact source refs and acceptance reason.
3. Add optional identity alias memory keyed by `identity_fingerprint`.

## Definition Of Done
1. Learning improves future runs without contaminating quality.
2. Every learned entry is auditable and reversible.
3. Low-value learned data naturally decays out.
