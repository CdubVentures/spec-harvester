# AI Component Review - Implementation Notes

## Where The Component Matrix Is

- `implementation/ai-implenentation-plans/component-review-llm-matrix.xlsx`
- Existing broader matrix (field + component + list):
  - `implementation/ai-implenentation-plans/source-performance-review-ai-matrix.route-based-4-criteria.xlsx`

## Where The AI Component MD Is

- `implementation/ai-implenentation-plans/ai-component-review.md` (this file)

## What Was Implemented

### 1) SQLite Control Plane

A new route-matrix table was added for category-scoped LLM routing and payload policy:

- `src/db/specDb.js` (`llm_route_matrix` schema)
- Includes component controls:
  - `scope`
  - 4 criteria: `required_level`, `difficulty`, `availability`, `effort` (+ `effort_band`)
  - source packet knobs: `single_source_data`, `all_source_data`, `enable_websearch`
  - model routing: `model_ladder_today`
  - confidence behavior: `all_sources_confidence_repatch`
  - token budget: `max_tokens`
  - component packet shape: `component_values_send`
  - evidence minimum: `llm_output_min_evidence_refs_required`
  - fallback action: `insufficient_evidence_action`
  - studio context flags (`studio_*`)

Default component routes were seeded in `buildDefaultLlmRoutes(category)`:

- critical/hard/expected (high budget, all source data enabled)
- expected/medium/expected
- optional/easy/sometimes

### 2) API Endpoints

Category-scoped endpoints were added to manage the matrix:

- `GET /api/v1/llm-settings/:category/routes`
- `PUT /api/v1/llm-settings/:category/routes`
- `POST /api/v1/llm-settings/:category/routes/reset`

Implemented in:

- `src/api/guiServer.js`

### 3) GUI Tab Before Live Runtime

A new tab and route were added:

- tab nav: `tools/gui-react/src/components/layout/TabNav.tsx`
- route: `tools/gui-react/src/App.tsx`
- page: `tools/gui-react/src/pages/llm-settings/LlmSettingsPage.tsx`

Component scope support in UI:

- scope tabs: Field Keys / Component Review / List Review
- component-specific send policy: `Component Values Send`
- source packet toggles: Single Source Data, All Source Data, Enable Web Search
- model ladder and token budget
- evidence minimum and insufficient-evidence action
- advanced `studio_*` context flags

## Current Component Defaults

From seeded DB defaults:

1. high-risk component route
   - model: `gpt-5.2-high -> gpt-5.2-medium`
   - all source data: yes
   - component send: `component values + prime sources`
   - min evidence refs: 2

2. medium route
   - model: `gpt-5.1-medium -> gpt-5.2-medium`
   - all source data: no
   - component send: `component values + prime sources`
   - min evidence refs: 1

3. low-risk route
   - model: `gpt-5-low -> gpt-5-medium`
   - all source data: no
   - component send: `component values`
   - min evidence refs: 1

## Important Scope Note

This implementation provides the SQL + API + GUI control plane. 
Runtime consumption of these route rows by every extraction/review call is the next wiring step.
