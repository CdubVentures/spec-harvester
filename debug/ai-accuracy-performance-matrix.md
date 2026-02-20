# AI Accuracy + Performance Matrix

- Generated: 2026-02-17T19:52:03Z
- Workbook: `C:\Users\Chris\Desktop\spec-harvester - claude\debug\ai-accuracy-performance-matrix.xlsx`
- LLM Lab docs read: `C:\Users\Chris\Desktop\LLM Lab\app\README.md`
- LLM Lab env read: `C:\Users\Chris\Desktop\LLM Lab\.env`
- Runtime env read: `C:\Users\Chris\Desktop\spec-harvester - claude\.env`
- Mouse rules source: `C:\Users\Chris\Desktop\spec-harvester - claude\helper_files\mouse\_generated\field_rules.runtime.json`
- Mouse data source: `C:\Users\Chris\Desktop\spec-harvester - claude\helper_files\mouse\mouseData.xlsm`

## Executive Policy
- Use scoped evidence for first-pass extraction on each source/batch.
- Do not send full all-sources corpus on every call.
- Escalate to merged multi-source context for unresolved required/critical keys.
- Send all-sources only for final critical/hard adjudication.
- Keep strict JSON schema + parse/enum/unit/evidence gates.

## Why This Is Optimal
- Accuracy: judge/planner routes put hard and required/critical fields on reasoning models with validator/verify passes.
- Performance: easy/advisory paths stay fast and scoped.
- Stability: recommended slot map keeps strong defaults and clear fallback pathways.
- Format correctness: deterministic parser + schema + evidence refs prevent malformed values.

## Inputs Used
- Mouse dataEntry products (brand+model): **342**
- Mouse field rules: **75** fields
- Required-level distribution: `{'expected': 52, 'optional': 8, 'required': 13, 'critical': 1, 'identity': 1}`
- Difficulty distribution: `{'easy': 53, 'medium': 16, 'hard': 6}`
- Effort-band distribution: `{'1-3': 43, '4-6': 22, '7-10': 10}`
- Min evidence refs distribution: `{'1': 67, '2': 8}`

## Tabs In Workbook
- `README`
- `Model Inventory`
- `Current Runtime Slots`
- `Recommended Slots`
- `Mouse Rule Profile`
- `Route Matrix`
- `Field Matrix`
- `Context Scope`
- `Confidence Updates`
- `Format Guardrails`
- `Payload Examples`

## Model Ladder Update (2026-02-17)
- Route matrix now uses expanded model ladder, not only two models.
- Primary choices now include: `gpt-5.1-low`, `gpt-5.1-medium`, `gpt-5.1-high`, `gpt-5.2-medium`, `gpt-5.2-high`, `gpt-5.2-xhigh`.
- Added tab: `Expanded Model Ladder`.
- Added Route Matrix column: `model_ladder_today (primary -> escalation)`.

## Route Matrix 4-Factor Update (2026-02-17)
- Model selection now uses all 4 factors: `ai_mode`, `difficulty`, `availability`, `effort`.
- Added/updated column: `model_used_today (2026-02-17, 4-factor)`.
- Added column: `model_selection_factors (ai_mode+difficulty+availability+effort)`.
- Added column: `all_sources_confidence_repatch (yes/no)`.
- Expanded ladder explicitly includes: gpt-5-minimal, gpt-5-low, gpt-5.2-low, gpt-5.1-low, gpt-5-medium, gpt-5.1-medium, gpt-5, gpt-5-high, gpt-5.1, gpt-5.2-medium, gpt-5.1-high, gpt-5.2, gpt-5.2-high, gpt-5.2-xhigh.
