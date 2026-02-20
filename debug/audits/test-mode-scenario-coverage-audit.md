# Test Mode Scenario Coverage Audit (Mapping Studio + Key Navigator)
Date: 2026-02-17

## Executive Verdict
- Test Mode does **not** currently cover every use case/scenario/variance exposed in Mapping Studio + Key Navigator.
- Coverage is strong for core contract-driven deterministic pipeline behavior.
- Coverage is incomplete for AI-assist permutations, publish/search behavior, and UI/key-navigation workflows.

## Scope Reviewed
- Test scenario generation and validation:
  - `src/testing/testDataProvider.js:371`
  - `src/testing/testDataProvider.js:2268`
- Test-mode run/validate API and execution path:
  - `src/api/guiServer.js:2121`
  - `src/api/guiServer.js:2197`
  - `src/testing/testRunner.js:109`
- Mapping Studio + Key Navigator surfaces:
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:227`
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:2836`
  - `tools/gui-react/src/pages/studio/StudioPage.tsx:3320`
  - `tools/gui-react/src/pages/studio/workbench/FieldRulesWorkbench.tsx:214`
  - `tools/gui-react/src/pages/studio/workbench/WorkbenchBulkBar.tsx:26`
- Review key navigation behavior:
  - `tools/gui-react/src/pages/review/ReviewPage.tsx:326`
  - `tools/gui-react/src/pages/review/ReviewMatrix.tsx:71`
  - `tools/gui-react/src/stores/reviewStore.ts:91`
- Capabilities registry (live/deferred/ui_only):
  - `src/field-rules/capabilities.json`

## What Is Covered Today
Current dynamic scenarios cover these families:
- `happy_path`
- `new_*` / `similar_*` component discovery + alias
- `new_enum_values`, `similar_enum_values`, `closed_enum_reject`
- `range_violations`, `cross_validation`, `component_constraints`, `variance_policies`
- `min_evidence_refs`, `tier_preference_override`, `preserve_all_candidates`
- `missing_required`, `multi_source_consensus`, `list_fields_dedup`

Evidence:
- Scenario creation logic: `src/testing/testDataProvider.js:371`
- Scenario-specific validations: `src/testing/testDataProvider.js:2268`

## High-Confidence Gaps (Not Fully Included)

| Area | Status | Evidence | Gap |
|---|---|---|---|
| AI assist mode matrix (`required_level` x `difficulty` x `effort`) | Missing | `tools/gui-react/src/pages/studio/StudioPage.tsx:2951`, `src/llm/fieldBatching.js:61` | No explicit test scenarios validating all auto-derivation combinations and effective model routing. |
| `ai_assist.max_calls` budget behavior | Missing | `src/runner/runUntilComplete.js:887`, `src/testing/testRunner.js:109` | Test Mode uses `runTestProduct` single-run path; multi-round per-field budget exhaustion is not exercised. |
| `ai_assist.max_tokens` batch-max behavior | Missing | `src/llm/fieldBatching.js:177` | No scenario asserts max-token resolution when mixed fields share a batch. |
| `ai_assist.reasoning_note` prompt injection | Partial | `tools/gui-react/src/pages/studio/StudioPage.tsx:3041`, `src/api/guiServer.js:2166` | UI supports authored/auto guidance; Test Mode UI path runs deterministic source generation (`useLlm` not exposed), so prompt-level behavior is not fully validated. |
| Selection policy variants (string + object reducers) | Partial | `src/scoring/consensusEngine.js:126`, `src/scoring/consensusEngine.js:595` | Engine supports both forms, but no dedicated scenario family targets policy variants/tolerance branches. |
| Publish-gate behavior (`publish_gate`, `block_publish_when_unk`) | Missing | `src/testing/testRunner.js:374` | Test summaries hard-set `publishable:false` with `publish_blockers:['test_mode']`; real publish decision flows are not covered. |
| Search/crawl/index behavior + `search_hints` effects | Missing | `src/testing/testRunner.js:382`, `src/testing/testRunner.js:383`, `src/ingest/categoryCompile.js:3884` | Test Mode summary disables discovery/search; search hints are compiled/configured but not validated against runtime query generation. |
| Parse strictness controls (`allow_unitless`, `allow_ranges`, `strict_unit_required`) | Missing | `tools/gui-react/src/pages/studio/StudioPage.tsx:3187`, `src/ingest/categoryCompile.js:3132` | Controls exist in UI/compile mapping, but no dedicated runtime scenario assertions for these branches. |
| Deferred contract/evidence knobs | Not testable yet | `src/field-rules/capabilities.json:30`, `src/field-rules/capabilities.json:61`, `src/field-rules/capabilities.json:108`, `src/field-rules/capabilities.json:114` | `contract.rounding.mode`, `contract.unknown_token`, `evidence.tier_preference`, `evidence.conflict_policy` are documented as deferred in capabilities; complete scenario coverage is blocked until wired. |
| Component match tuning knobs (`component.match.*`) | Partial | `tools/gui-react/src/pages/studio/StudioPage.tsx:3396` | Component scenarios exist, but no variant matrix over thresholds/weights and acceptance boundaries. |
| Component AI settings (`component.ai.*`) | Missing / likely unwired | `tools/gui-react/src/pages/studio/StudioPage.tsx:3446` | UI exposes component AI controls; no backend consumer hits found under `src/` for `component.ai.*`. |
| Mapping Studio / Key Navigator UI coupling flows | Missing | `tools/gui-react/src/pages/studio/StudioPage.tsx:2643`, `tools/gui-react/src/pages/studio/workbench/FieldRulesWorkbench.tsx:113` | Test Mode validates backend artifacts, not front-end coupling/state transitions (parse->enum->ui control cascades, bulk edit, inline edit). |
| Review key navigation + keyboard flows | Missing | `tools/gui-react/src/pages/review/ReviewPage.tsx:326`, `tools/gui-react/src/pages/review/ReviewMatrix.tsx:71` | Tab/shift-tab/enter/f2/ctrl+s/1-9 navigation and editing flows are not part of Test Mode scenario validation. |

## Specific Missing Scenario Inventory (Recommended Additions)

| Priority | Scenario To Add | Why It Is Needed |
|---|---|---|
| P0 | AI auto-derivation matrix (`required_level` + `difficulty` + `effort` bands) | Verifies effective mode/model/call budget logic used by production AI routing. |
| P0 | Explicit AI override matrix (`mode`, `model_strategy`, `max_calls`, `max_tokens`) | Ensures per-key overrides behave correctly and do not regress silently. |
| P0 | Selection-policy variant suite (string policies + object reducer tolerance pass/fail) | Current scenarios do not directly assert these rule branches. |
| P0 | Publish-gate suite (`publish_gate`, `block_publish_when_unk`) outside test-mode forced blocker | Needed to validate release gating behavior. |
| P1 | Search-hints impact suite (domain/content/query terms influence retrieval/query plan) | Key Navigator exposes these knobs; no runtime assertion currently. |
| P1 | Parse strictness suite (`allow_unitless`, `allow_ranges`, `strict_unit_required`) | UI supports these controls; no dedicated runtime checks today. |
| P1 | Component threshold boundary suite (`fuzzy_threshold`, `auto_accept_score`, `flag_review_score`) | Needed for controlled accept/flag/reject boundary verification. |
| P1 | Evidence policy suite (`conflict_policy` options, tier preference permutations) | Existing scenarios only cover limited branches. |
| P2 | Studio coupling UX tests (parse/enum/component/UI control cascades + bulk/inline) | Prevents regressions in key editor behavior and mapping consistency. |
| P2 | Review keyboard workflow tests | Ensures high-throughput review UX remains stable. |

## Bottom Line
- Core contract-driven deterministic extraction coverage is solid.
- Full coverage across **all Mapping Studio + Key Navigator use cases/scenarios/variances** is **not yet achieved**.
- Biggest risk areas are AI-routing permutations, publish/search behavior, and UI/key-navigation workflows that are currently outside Test Mode assertions.

