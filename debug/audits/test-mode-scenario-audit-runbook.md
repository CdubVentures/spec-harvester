# Test Mode Scenario Audit Runbook
Date: 2026-02-17

## Goal
Reproduce a full Test Mode scenario coverage audit against Mapping Studio + Key Navigator, and document what is implemented vs not fully covered.

## Where To Put Outputs
- Primary report: `debug/audits/test-mode-scenario-coverage-audit.md`
- This runbook: `debug/audits/test-mode-scenario-audit-runbook.md`

## Audit Scope
- Test scenario generation and validation logic.
- Test run/validate API behavior.
- Mapping Studio and Key Navigator configuration surfaces.
- Review grid key-navigation and editing workflows.
- Capability registry (`live`, `deferred`, `ui_only`) alignment.

## Step 1: Inventory Relevant Files
Run:

```powershell
rg --files src/testing tools/gui-react/src/pages/test-mode tools/gui-react/src/pages/studio tools/gui-react/src/pages/review tools/gui-react/src/stores | sort
```

Confirm these are present:
- `src/testing/testDataProvider.js`
- `src/testing/testRunner.js`
- `src/api/guiServer.js`
- `tools/gui-react/src/pages/test-mode/TestModePage.tsx`
- `tools/gui-react/src/pages/studio/StudioPage.tsx`
- `tools/gui-react/src/pages/studio/workbench/FieldRulesWorkbench.tsx`
- `tools/gui-react/src/pages/studio/workbench/WorkbenchDrawer.tsx`
- `tools/gui-react/src/pages/review/ReviewPage.tsx`
- `tools/gui-react/src/pages/review/ReviewMatrix.tsx`
- `tools/gui-react/src/stores/reviewStore.ts`
- `src/field-rules/capabilities.json`

## Step 2: Extract Scenario Families
Run:

```powershell
rg -n "buildScenarioDefsFromContract|SCENARIO_DEFS_DEFAULT|buildValidationChecks|scenarioName ===|scenarioName.startsWith" src/testing/testDataProvider.js
```

Record:
- Dynamic scenario creation block location.
- Default/fallback scenarios.
- Validation checks tied to scenario names.

## Step 3: Verify What Test Mode Actually Runs
Run:

```powershell
rg -n "test-mode/run|test-mode/validate|runTestProduct|useLlm|aiReview" src/api/guiServer.js src/testing/testRunner.js tools/gui-react/src/pages/test-mode/TestModePage.tsx
```

Classify:
- Deterministic vs LLM generation path.
- Whether run path is single-pass or multi-round.
- Whether publish/search behavior is exercised in Test Mode.

## Step 4: Map Key Navigator + Workbench Surface Area
Run:

```powershell
rg -n "priority\\.|ai_assist\\.|parse\\.|enum\\.|evidence\\.|ui\\.|search_hints\\.|component\\." tools/gui-react/src/pages/studio/StudioPage.tsx tools/gui-react/src/pages/studio/workbench/FieldRulesWorkbench.tsx tools/gui-react/src/pages/studio/workbench/WorkbenchDrawer.tsx
```

Capture:
- Every configurable knob exposed to users.
- Any coupling logic (for example, parse template changing enum/UI settings).
- Bulk/inline editing pathways.

## Step 5: Map Review Key Navigation Coverage
Run:

```powershell
rg -n "useHotkeys|tab|shift\\+tab|escape|enter|f2|ctrl\\+s|ctrl\\+a|keydown|editing" tools/gui-react/src/pages/review/ReviewPage.tsx tools/gui-react/src/pages/review/ReviewMatrix.tsx tools/gui-react/src/stores/reviewStore.ts
```

Determine whether these workflows are covered by Test Mode scenario assertions (normally they are not).

## Step 6: Cross-Check Capability Status
Run:

```powershell
Get-Content src/field-rules/capabilities.json
```

Classify each important knob:
- `live`: expected to be runtime-testable.
- `deferred`: expected gap until implementation is wired.
- `ui_only`: not a backend scenario target by default.

## Step 7: Gap Classification Rules
Use these labels in report:
- `Covered`: explicit scenario + explicit validation check.
- `Partial`: indirectly exercised or no dedicated assertions.
- `Missing`: exposed/implemented behavior with no scenario validation path.
- `Not testable yet`: capability marked deferred or intentionally out of Test Mode scope.

## Step 8: Write Final Report
Include sections:
- Executive verdict.
- Scope reviewed with file references.
- Covered scenario families.
- High-confidence gaps table.
- Missing scenario inventory (P0/P1/P2).
- Bottom line.

## Quality Gate Before Finalizing
- Every claimed gap has at least one file reference.
- Every “covered” claim points to scenario creation and validation lines.
- Distinguish backend pipeline gaps from UI workflow gaps.
- Do not mark deferred knobs as missing implementation unless they are supposed to be live.

## Optional Reuse Commands

```powershell
rg -n "search_hints" src tools/gui-react/src | sort
rg -n "selection_policy|applySelectionPolicyReducers|applyPolicyBonus" src | sort
rg -n "buildContractEffortPlan|fieldCallCounts|max_calls" src/runner/runUntilComplete.js
rg -n "getRuleDifficulty|resolveBatchModel|maxTokens" src/llm/fieldBatching.js
```

