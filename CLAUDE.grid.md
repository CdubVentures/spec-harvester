# CLAUDE.md — Spec Factory / Field Studio Grid

This file is read at session start and after every context compaction.
Keep it up to date as the project evolves.

---

# Field Studio Contract + Review Grid Overview

## Scope
This document covers the Field Studio contract pipeline and the review grid runtime used for item, component, and enum review lanes.

## Project Overview
- Field Studio compiles workbook-driven rules into generated artifacts (`field_rules.json`, `component_db/*.json`, enums, templates, migrations).
- Runtime loads those artifacts, normalizes component identities, and seeds SpecDb tables for item slots, component slots, enum slots, and candidates.
- Review Grid API builds lane payloads from SpecDb and serves mutation routes for accept/confirm actions.
- GUI renders component and enum review tabs, slot drawers, and debug overlays (linked product count and candidate IDs).
- Test Mode creates deterministic contract-driven fixtures so edge cases can be validated end-to-end.

## Tech Stack
- Backend runtime: Node.js (ESM, native `http` server).
- Database: SQLite via `better-sqlite3` (SpecDb).
- API transport: JSON HTTP + WebSocket (`ws`) for live data-change events.
- Contract validation/compile: `ajv` + `ajv-formats`, `exceljs`, `semver`.
- Frontend: React 18 + TypeScript + Vite.
- Frontend data/state: TanStack Query, Zustand.
- Frontend UI: Tailwind CSS + Radix UI primitives.
- Tests: Node built-in runner (`node --test`).

## Directory Structure (Field Studio Contract + Grid)
```text
implementation/
  grid-rules/
    component-slot-fill-rules.md
    COMPONENT-SLOTS-NAMING-SCENARIOS-DEBUG.md
    component-identity-pools-10-tabs.xlsx

src/
  field-rules/
    compiler.js
    loader.js
    migrations.js
  api/
    guiServer.js
    reviewRouteSharedHelpers.js
    reviewMutationResolvers.js
    reviewItemRoutes.js
    reviewComponentMutationRoutes.js
    reviewEnumMutationRoutes.js
  review/
    reviewGridData.js
    componentReviewData.js
    keyReviewState.js
    componentImpact.js
  db/
    specDb.js
    seed.js
  testing/
    testDataProvider.js
    testRunner.js
  utils/
    candidateIdentifier.js
    componentIdentifier.js

tools/gui-react/src/
  pages/component-review/
    ComponentReviewPage.tsx
    ComponentSubTab.tsx
    ComponentReviewDrawer.tsx
    EnumSubTab.tsx
  stores/
    componentReviewStore.ts
  types/
    componentReview.ts
  components/common/
    ReviewValueCell.tsx
    CellDrawer.tsx
    PendingAIReviewSection.tsx
    LinkedProductsList.tsx

test/
  contractDriven.test.js
  componentReviewDataLaneState.test.js
  reviewLaneContractApi.test.js
  reviewLaneContractGui.test.js
  reviewGridData.test.js
  phase1FieldRulesLoader.test.js
```

## Key Source Files (with comments)

### Contract compile/load
- `src/field-rules/compiler.js`: Compiles workbook/contracts into generated runtime artifacts and validates schema packs.
- `src/field-rules/loader.js`: Loads generated artifacts, normalizes component DB payloads, builds alias indexes (`__index`, `__indexAll`), and caches by category.
- `src/field-rules/migrations.js`: Computes key migration plans (rename/merge/breaking change classification) across field-rules versions.

### Runtime API and mutation routing
- `src/api/guiServer.js`: Main API surface for review grid, component review payloads, test-mode create/run/validate, and WebSocket broadcasts.
- `src/api/reviewRouteSharedHelpers.js`: Shared request preparation, seeded DB guards, route matching, and common responders.
- `src/api/reviewMutationResolvers.js`: Strict ID-based context resolution for item/component/enum mutations.
- `src/api/reviewItemRoutes.js`: Item slot mutation routes (accept/confirm/manual actions).
- `src/api/reviewComponentMutationRoutes.js`: Component slot and component identity mutation routes; shared-lane behavior lives here.
- `src/api/reviewEnumMutationRoutes.js`: Enum value/lane mutation routes and enum suggestion state transitions.

### Review payload builders
- `src/review/reviewGridData.js`: Builds item review matrix payload, candidate merges, and review queue summaries.
- `src/review/componentReviewData.js`: Builds component and enum review payloads, linked-product attribution, pending lane state, and fallback gating.
- `src/review/keyReviewState.js`: Central shared-lane state upsert/update logic for `key_review_state`.
- `src/review/componentImpact.js`: Cascade logic when component/enum values change and linked products must be updated.

### Data model and seed path
- `src/db/specDb.js`: SQLite schema, indexes, and query/mutation helpers for candidates, identities, values, links, and review state.
- `src/db/seed.js`: Seeds SpecDb from generated artifacts; maker-aware component link resolution and scoped candidate ID insertion.
- `src/utils/componentIdentifier.js`: Canonical component lane key (`type::name::maker`) used in shared review state.
- `src/utils/candidateIdentifier.js`: Deterministic candidate ID builders (item/component/enum/workbook/pipeline/manual).

### Test-mode generation
- `src/testing/testDataProvider.js`: Contract-driven deterministic test data generation, scenario matrix, strict workbook pool loading.
- `src/testing/testRunner.js`: Runs seeded test products through extraction/review flow for validation.

### Frontend review grid
- `tools/gui-react/src/pages/component-review/ComponentReviewPage.tsx`: Component review root, tab orchestration, and Debug LP+ID toggle.
- `tools/gui-react/src/pages/component-review/ComponentSubTab.tsx`: Component table rendering and cell interactions.
- `tools/gui-react/src/pages/component-review/ComponentReviewDrawer.tsx`: Slot-level candidate actions (accept/confirm) and drawer-level debug identity context.
- `tools/gui-react/src/pages/component-review/EnumSubTab.tsx`: Enum review table, candidate drawers, and enum mutations.
- `tools/gui-react/src/stores/componentReviewStore.ts`: UI state for selected rows/cells/drawers and edit modes.
- `tools/gui-react/src/types/componentReview.ts`: Typed contract between API payloads and UI rendering.
- `tools/gui-react/src/components/common/ReviewValueCell.tsx`: Cell-level badges and pending indicators.
- `tools/gui-react/src/components/common/CellDrawer.tsx`: Candidate list rendering and action controls.

### Contract and lane tests
- `test/contractDriven.test.js`: End-to-end contract-driven test-mode fixtures and expected lane behavior checks.
- `test/componentReviewDataLaneState.test.js`: Regression tests for component slot lane attribution and pending counts.
- `test/reviewLaneContractApi.test.js`: API-level lane mutation contract tests.
- `test/reviewLaneContractGui.test.js`: GUI behavior tests for lane independence and debug visibility.
- `test/reviewGridData.test.js`: Item review payload and lane summary behavior tests.
- `test/phase1FieldRulesLoader.test.js`: Loader normalization/index behavior tests.

## Current Design Constraints
- Row identity is strict: `component_type + component_name + component_maker`.
- Candidate actions must remain slot-scoped and candidate-scoped.
- Pending AI counts must be computed from actionable candidates for the exact lane.
- Linked-product attribution is authoritative when links exist; fallback lanes should only run when links do not exist.

## Component Slot Candidate Aggregation Rule — AUTHORITATIVE

Every component slot type uses the **same** candidate aggregation logic. There are no exceptions.

For a component row `K = (type, name, maker)` with N linked products:

### Aggregation by slot type
- **`__name` slot**: Collect ALL candidates from ALL N linked products where `field_key` = the component-type field (e.g., `sensor`). If 9 products have 3 sources each and 1 product has 1 source, the drawer shows **28 candidate containers**.
- **`__maker` slot**: Collect ALL candidates from ALL N linked products where `field_key` = the maker field (e.g., `sensor_brand`, `sensor_maker`). Same aggregation — every source from every linked product.
- **Property slots** (e.g., `dpi_max`, `ips`, `actuation_force`): Collect ALL candidates from ALL N linked products where `field_key` = that property key. Same aggregation.
- **`__links` slot**: Aggregated from component identity link data.
- **`__aliases` slot**: Aggregated from component alias data.

### Key invariant
The candidate count for ANY slot is always:
```
C(K, F) = sum over all linked products of (candidate rows where product_id = P and field_key = F)
```
This is **identical** across `__name`, `__maker`, and all property slots. No slot type gets special treatment. No slot type skips linked products. No slot type uses a different aggregation path.

### What this means for the drawer
When you open the drawer for a component property, you see the FULL evidence picture from ALL linked products. Each candidate container shows its source product, source host, tier, and score. This is the foundation of the shared review lane — the user/AI reviews the aggregate evidence, not per-product slices.

### Current known gap
Some component slot columns do not currently aggregate candidates from all linked products uniformly. The `__name` and `__maker` identity slots and some property slots work correctly, but not all columns follow this rule consistently. This must be fixed so every slot type follows the same aggregation path.

---

## Running the Project

```bash
# Run all tests
npm test

# Run a specific test file
node --test test/contractDriven.test.js

# Start GUI API server
npm run gui:api

# Build GUI frontend
npm run gui:build
```


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

### App Section / Feature Organization (Vertical Slicing)

**Organize by Domain, Not by Technical Layer**
App sections and features must be entirely self-contained within their own domain directories. This approach, known as Vertical Slicing, ensures modularity and prevents tangled dependencies.

* **The Rule of Proximity:** Everything required for a specific app feature (validation, pure logic, state transformations, and UI components) must live together in that feature's directory. 
* **No Generic "Junk Drawers":** Directories like `src/utils/`, `src/helpers/`, or `src/services/` are strictly prohibited. If a function belongs to a specific feature, it lives in that feature's folder. If it is genuinely shared across multiple boundaries, it must be extracted into a clearly defined `shared-core/` or `infrastructure/` module.
* **Strict Boundary Enforcement:** One feature cannot directly import internal implementations from another. If "Feature A" needs data from "Feature B", it must communicate through explicitly defined public contracts (`index.js` exports) or a central orchestrator.

**Standardized Feature Directory Structure:**

src/
├── feature-a/               # Self-contained domain boundary
│   ├── index.js             # Explicit public API for this feature
│   ├── transformations.js   # Pure functions and mapping logic
│   ├── validation.js        # Domain-specific schemas
│   └── components/          # UI components (if applicable to the stack)
│
├── feature-b/               # Completely isolated from feature-a
│   ├── index.js
│   ├── core-logic.js
│   └── rules.js
│
└── shared-infrastructure/   # Cross-cutting side effects and external adapters
    ├── network-client.js
    └── logger.js

### Approved Refactoring Techniques

These are the only refactoring patterns used during decomposition. No other approaches.

- **Preparatory Refactoring**: Do not add new features to the core orchestrator module. Refactor and extract logic in preparation for upcoming phases to avoid accumulating technical debt. New capabilities should go into distinct new modules, not into the existing monolith.

- **Extract Method / Composing Method**: Aggressively break down the monolith. Extract isolated logic and domain-specific operations into smaller, pure functions within new, dedicated modules. Replace the original inline code with a single delegating call. The core orchestrator must read like a high-level sequence of named steps, abstracting away all implementation details.

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

---


