# PHASE-09 IMPROVMENT

## What I'd Add
1. Add explicit round controller with strict per-round budgets and summaries.
2. Add stop conditions that combine confidence, evidence policy, and identity safety.
3. Add marginal-yield detector with phase-aware termination logic.
4. Add prioritized rediscovery triggers by deficit type.

## What We Should Implement Now
1. Make round execution explicit in runtime events and GUI.
2. Require identity lock before deep-field convergence, with capped fallback path.
3. Add round summary cards: gained fields, confidence delta, fetch cost, LLM cost.

## Definition Of Done
1. Runs terminate deterministically with explainable stop reason.
2. Identity deficits are resolved before deep-field churn.
3. Round-level gains are visible and comparable.
