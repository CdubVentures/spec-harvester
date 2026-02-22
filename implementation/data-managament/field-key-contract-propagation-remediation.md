# Field Key Contract Propagation Remediation Plan

Generated on: 2026-02-21

## Priority Order

1. P0: Fix draft rehydration in Studio
- Goal: Hard refresh should preserve saved draft contract edits in Studio.
- Change:
  - Update `/studio/:category/payload` to overlay draft `fieldRulesDraft.fields` (Studio scope only), not only `fieldOrder`.
- Acceptance:
  - Save draft contract change, refresh Studio, and confirm edited rule fields persist without compile.

2. P0: Auto-resync SpecDb after successful compile
- Goal: Component/enum SQL-backed views reflect contract changes immediately after compile.
- Change:
  - On successful compile completion (`process-completed` for `category-compile`), run category reseed/resync against latest generated artifacts.
- Acceptance:
  - Change variance/constraint/enum policy, compile once, then verify updated behavior in:
    - Review grid flags
    - Component Review property flags
    - Enum Review policy/value display

3. P1: Align Studio save-drafts invalidation keys
- Goal: Remove stale risk when websocket delivery is delayed.
- Change:
  - In Studio save success handler, invalidate:
    - `['componentReviewData', category]` (or broad key prefix)
    - `['enumReviewData', category]`
  - Remove/replace stale keys:
    - `['componentReview', category]`
    - `['enumReview', category]`
- Acceptance:
  - With websocket disconnected, save-drafts still refreshes component/enum review query data correctly.

4. P1: Add compile warning for selected_keys contract drops
- Goal: Make partial propagation explicit.
- Change:
  - Extend compile report/UI with warning when edited keys are excluded by `selected_keys`.
- Acceptance:
  - Edited key outside selected set produces visible warning and appears in compile report.

5. P2: Unify contract source-of-truth semantics across grid vs component/enum views
- Goal: Reduce cross-tab mismatch.
- Change:
  - Define a single contract snapshot boundary (post-compile + post-resync) and ensure all review builders consume synchronized data version.
- Acceptance:
  - For same category version, grid and component/enum tabs produce consistent review-state semantics.

## Suggested Validation Checklist

1. Draft-only test:
- Edit `enum.policy` + `evidence.min_evidence_refs` in Studio.
- Save drafts, refresh Studio, verify values persist in Key Navigator/Field Contract view.

2. Compile propagation test:
- Compile category once.
- Verify updated label/contract metadata in Review matrix row headers and Product field labels.

3. SQL propagation test:
- After compile, verify component property `variance_policy` and `constraints` are updated in review tables.
- Verify enum field `enum_policy` updates in Enum tab.

4. Flag recalculation test:
- Trigger component value change that should violate variance/constraint.
- Verify `needs_ai_review` and grid flags update consistently.

## Related Issue File
- `implementation/data-managament/field-key-contract-propagation-issues.md`
