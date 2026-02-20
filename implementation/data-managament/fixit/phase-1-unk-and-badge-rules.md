# Phase 1 UNK and Badge Rules

## Unknown (`unk`) Rules
1. `unk`/`unknown`/empty are non-meaningful values.
2. Non-meaningful values cannot be accepted or confirmed.
3. `unk` must not appear as an actionable candidate row.
4. If a slot has only unknown data, show gray state + review flag context, not actionable AI buttons.

## Candidate Actionability
A candidate is actionable only when all are true:
1. `candidate_id` is present.
2. Candidate value is meaningful (not `unk`-like).
3. Candidate is not `is_synthetic_selected`.

Synthetic selected candidates exist only to keep drawer parity with current value source and are display-only.

## Badge Rules
1. `AI` cell badge:
   - Show only if slot lane is pending and has actionable candidate target(s).
   - Never show from synthetic-only candidate lists.
2. `Accepted` badge:
   - Show on accepted candidate id.
   - Matching same-value candidates can inherit accepted green background, but only one row shows `Accepted`.
3. Pending badges:
   - `AI Item`/`AI Shared Pending` only on candidate rows targeted by pending lane ids.
4. Source index star:
   - Mark the candidate row currently backing slot top value with `*`.
   - Manual override slots do not show source star.

## Candidate Background Rules
1. Green:
   - Accepted candidate row.
   - Same-value candidates as accepted value (lighter green).
2. Orange/Purple tint:
   - Only when that exact row is pending lane target.
3. Neutral:
   - Any non-accepted, non-pending-target row.

## Expected UI Behavior
- No AI badge without actionable candidates.
- No confirm buttons attached to synthetic-only rows.
- No `unk` candidate accepts/confirms.
