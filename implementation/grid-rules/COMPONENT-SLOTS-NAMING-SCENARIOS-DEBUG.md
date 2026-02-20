# Component Slots, Naming, Scenarios, Debug (Recovered Spec)

## Purpose
This is the focused rebuild spec for what we defined around:
- component slot population/counting,
- name+maker identity behavior,
- test scenarios (including edge cases),
- debug toggle behavior in the review grid.

Use this as the implementation contract for the review-grid rework.

## Execution Status
- Phase 1 (`Debug Toggle Behavior`) completed on 2026-02-20.
- Implemented in:
- `tools/gui-react/src/pages/component-review/ComponentReviewPage.tsx`
- `tools/gui-react/src/pages/component-review/ComponentSubTab.tsx`
- `tools/gui-react/src/pages/component-review/ComponentReviewDrawer.tsx`
- `tools/gui-react/src/pages/component-review/EnumSubTab.tsx`
- `tools/gui-react/src/components/common/ReviewValueCell.tsx`
- `tools/gui-react/src/components/common/CellDrawer.tsx`
- `test/reviewLaneContractGui.test.js` (updated to enable debug toggle for candidate-id assertions)
- Validation:
- `npm run build` (GUI) passed.
- `node --test test/reviewLaneContractGui.test.js test/reviewLaneContractApi.test.js test/reviewGridData.test.js` passed.
- Next phase in progress: `Component Slot Population Contract` + `Pending AI Counts`.

## 1) Component Slot Population Contract

### Row Identity
A component review row is uniquely identified by:
- `component_type`
- `component_name`
- `component_maker`

Same `name` with different `maker` is intentionally different rows.

### Linked Products Source of Truth
For each row, linked products come from exact-key matches in `item_component_links`:
- same `component_type`
- same `component_name`
- same `component_maker`

### Slot Candidate Fill Rules
For the row above:
- Name slot (`__name`): candidates from linked products for the link field key.
- Maker slot (`__maker`): candidates from linked products for maker/brand field (`<component_type>_brand` or configured equivalent).
- Property slot (`property_key`): candidates from linked products for that exact property field key.

### Count Rules
- Linked Product Count (`LP`) = number of linked products for exact row key.
- Candidate Count per slot = number of candidate rows from those linked products for that slot field key.
- Never hardcode `3` for counts. If test mode generates 3 sources/product, counts will reflect that naturally.

## 2) Name + Maker Identity Behavior

### Disambiguation Order
When same name exists under multiple makers, resolve using maker hints in this order:
1. `<component_type>_brand`
2. `<component_type>_maker`
3. `<field_key>_brand`
4. `<field_key>_maker`
5. `brand`
6. `maker`

### Duplicate Name Rules
- If incoming `name + maker` matches existing identity: link to existing row, do not create new row.
- If only `name` is known and maker is missing/unknown in an ambiguous set: use unresolved row (`maker=''`).
- When user sets maker and it resolves to existing `name + maker`: merge links into resolved row and remove unresolved visible row.

## 3) Scenario/Test Design We Agreed On

## Core Edge Cases (must exist)
For each relevant component type, include deterministic cases where each lane has at least 2 linked products:
- same name + maker A
- same name + maker B
- same name + no maker (`maker=''`)

And also:
- same name appears twice: one with maker, one without maker (both with >=2 LP).
- same name appears with two different makers (both with >=2 LP).

### Source Volume Rule
- Per-product source rows are determined by configured source generation.
- In default `test_mouse`, expected baseline is typically 3 sources/product.
- Count validation must use real generated source rows, not fixed constants.

### Dataset Realism
- Use realistic brand/name pools (not placeholder `BrandA`, `TestMaker`) for stress fixtures.
- Keep pools unique per component tab to avoid cross-tab collisions.
- `implementation/grid-rules/component-identity-pools-10-tabs.xlsx` is the pool reference artifact.
- Scenario generation must consume those Excel pool values for brand/name assignments in stress fixtures.
- Identity edge-case fixtures must enforce `>= 2` linked products per identity lane (`name+maker`, alternate maker, and no-maker lane).

## 4) Debug Toggle Behavior

### Toggle
Add top-right toggle on Component Review page:
- Label: `Debug LP+ID`
- States: `ON/OFF`

### When ON
- Show `LP {count}` badge in slot cells using row linked product count.
- Show candidate unique IDs in candidate headers inside slot drawers.
- Show identity context for the active row/slot so debugging can map UI to DB lanes:
- component row key (`component_type`, `component_name`, `component_maker`)
- slot identity (`componentValueId` for component properties, `listValueId` for enum values, `itemFieldStateId` for item slots)

### When OFF
- Hide LP badges and candidate IDs.

### Constraints
- Debug mode is display-only.
- Debug mode must not change mutation payloads, lane state, or persistence.

## 5) Action Independence Rules (Critical)

Each action is independent per slot candidate and lane:
- `Accept Item`
- `Confirm AI Item`
- `Accept Shared` (component/enum)
- `Confirm AI Shared`

Expected behavior:
- Clicking one candidate action must not clear/confirm sibling candidates.
- Item lane and shared lane must not auto-overwrite each other.
- `accepted_candidate_id` and pending lane candidate IDs stay per-slot/per-lane.

## 6) Pending AI Counts (Critical)

Counts must align at all levels:
- Header count for pending AI on a slot = actionable pending candidates for that exact slot.
- Drawer pending indicators = same actionable candidate set.
- No AI badge should appear when there is no confirmable pending candidate path for that slot.

## 7) Rebuild Targets (Files)

Backend:
- `src/api/reviewMutationResolvers.js`
- `src/api/reviewComponentMutationRoutes.js`
- `src/api/reviewEnumMutationRoutes.js`
- `src/review/componentReviewData.js`

Frontend:
- `tools/gui-react/src/pages/component-review/ComponentReviewPage.tsx`
- `tools/gui-react/src/pages/component-review/ComponentSubTab.tsx`
- `tools/gui-react/src/pages/component-review/ComponentReviewDrawer.tsx`
- `tools/gui-react/src/pages/component-review/EnumSubTab.tsx`
- `tools/gui-react/src/components/common/ReviewValueCell.tsx`
- `tools/gui-react/src/components/common/CellDrawer.tsx`

Test/data:
- `src/testing/testDataProvider.js`
- review-grid and lane contract tests under `test/`

## 8) Acceptance Criteria
- Component row/slot counts match linked-product-derived candidate data.
- Duplicate-name/maker identity resolution follows rules above.
- All four actions are fully independent per candidate/slot/lane.
- Pending AI counts are consistent between header, cell, and drawer.
- Debug toggle exposes LP and candidate IDs exactly as specified.
- Debug toggle exposes row/slot identity context needed to trace each action to exact DB IDs.
- Stress fixtures use Excel brand/name pools and satisfy the `>= 2 linked products` core edge-case rule.
















## Core Development Philosophy

### TEST-DRIVEN DEVELOPMENT IS NON-NEGOTIABLE

Every single line of production code must be written in response to a failing test.
No exceptions. This is the fundamental practice that enables all other principles.

**RED → GREEN → REFACTOR**
- **RED**: Write the failing test first. Zero production code without a failing test.
- **GREEN**: Write the minimum code to make the test pass.
- **REFACTOR**: Improve only if it adds real value. Keep increments small and always working.

Wait for explicit commit approval before every commit.

### Decomposition Safety Rule — NON-NEGOTIABLE

When decomposing, extracting, or refactoring existing code, **existing functionality must never break**.

The protocol is:
1. **Tests must be green before touching anything.** Run the full test suite and confirm it passes. If tests are already failing, stop and fix them before refactoring.
2. **Write characterization tests first** for any code that lacks coverage before moving it. These tests capture the current behavior — they are the safety net for the extraction.
3. **Move in the smallest possible increments.** Extract one function or one responsibility at a time. Run tests after every single move. Never batch multiple extractions into one step.
4. **The extracted module must produce identical outputs** to the inline code it replaced, on the same inputs. If behavior changes during extraction, that is a bug, not a feature.
5. **No behavior changes during a refactor step.** Refactor means structure changes, behavior stays identical. If you want to change behavior, do it in a separate commit with its own failing test.
6. **If tests go red at any point during extraction, revert the extraction, not the tests.** The tests are the source of truth. A red test during refactor means the extraction broke something.
7. **The pipeline must run end-to-end successfully** on at least one product before a decomposition step is considered complete.

### Approved Refactoring Techniques

These are the only refactoring patterns used during decomposition. No other approaches.

- **Preparatory Refactoring**: Do not add new features to the core orchestrator module (`runProduct.js` / `RunOrchestrator`). Refactor and extract phases *in preparation* for Phase 09 to avoid accumulating technical debt. New capabilities go into the new modules, not into the monolith.

- **Extract Method / Composing Method**: Aggressively break down the monolith. Extract isolated logic (e.g., SearchProfile building, Consensus scoring, FetchParseWorker) into smaller, pure functions in new dedicated modules, then replace the original inline code with a single delegating call. The orchestrator should read like a sequence of named steps, not implementation detail.

- **Moving Features Between Modules**: Shift non-orchestration responsibilities out of the main loop and into dedicated domain modules. Billing belongs in the billing module. Telemetry formatting belongs in the runtime bridge. Extraction state belongs in the extraction phase module. The orchestrator owns sequencing only.

- **Red-Green-Refactor Pipeline for Extraction**: When extracting a module, write a failing test for the new standalone component first. Make it pass using the extracted logic. Then wire the new module back into the orchestrator as a replacement for the inline code. Run the full suite. Green = done.

### Testing Principles
- Test behavior, not implementation. 100% coverage through business behavior.
- Test through the public API exclusively.
- Use factory functions for test data (no `let`/`beforeEach` mutation).
- Tests must document expected business behavior.
- No 1:1 mapping between test files and implementation files required.
- Test runner: `node --test` (NOT Jest/Vitest — this project uses the built-in runner).
- Tests live in `test/` directory.

### Code Style (Functional)
- No data mutation — immutable data structures only.
- Pure functions wherever possible.
- No nested if/else — use early returns or composition.
- No comments — code should be self-documenting.
- Prefer options objects over positional parameters.
- Use array methods (`map`, `filter`, `reduce`) over loops.
- Small, focused functions. Avoid premature abstractions.

### JavaScript Conventions (this is a JS project, not TypeScript)
- All source files are `.js` ESM (`import`/`export`).
- GUI frontend (`tools/gui-react/`) is TypeScript + React.
- Use `zod` or `ajv` for schema validation at trust boundaries.
- Avoid `any` equivalents — validate at boundaries, trust internals.

### Guiding Principles (IndexLab Specific)
- **Accuracy first**: 95%+ on technical specs is the objective.
- **Evidence tiers + confidence gates** control what happens next.
- **Need-driven discovery**: NeedSet drives search — no endless alias loops.
- **Deterministic indexing**: `content_hash` dedupe + stable `snippet_id`s = replayable, auditable.
- **GUI must prove each phase**: no phase is "done" until GUI proof checklist is complete.
