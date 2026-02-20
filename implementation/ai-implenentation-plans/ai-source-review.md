# AI Source Review

Generated: 2026-02-17
Workbook: `implementation/ai-implenentation-plans/source-performance-review-ai-matrix.xlsx`

## Goal
Define a universal implementation plan for how AI reviews values using source evidence, including:
- model routing
- prompt construction
- payload packaging
- table-linked keys (component data)
- list-linked keys
- prime-source usage
- confidence update behavior

## Universal Send Policy
Route matrix now includes:
- `table_linked_send (component values | component values + prime sources)`
- `list_linked_send (list values | list values prime sources)`
- `enable_websearch (yes/no)` to control `request_options.web_search` per route
- `studio_*` yes/no columns indicating which Field Studio artifacts are sent per review stage.

Use these rules:
- High-stakes route: send `+ prime sources` variant.
- Standard route: send values-only variant.
- If `ai_mode=off`, keep values-only mode (no LLM call).
- If `min_evidence_refs_effective >= 2`:
  - require prime-source packet mode (`table`/`list`/`scalar`),
  - require output min evidence refs = 2,
  - if threshold cannot be met, return `unk`.
- `All Source Data` is route-based (not escalation) using the 4 criteria:
  - `ai_mode`
  - `difficulty`
  - `availability`
  - `effort`
- Distinct-source requirements are separate from min refs (`min_distinct_sources_required`).

High-stakes route conditions:
- route matrix marks `All Source Data = yes` from the 4 criteria combination above.
- route matrix marks `All Source Data = no` for low-risk combinations.

## What "Prime Sources" Means
Prime sources are selected per value using consensus/provenance state.
For each selected value, prime-source packet should include:
- `value`
- `confidence`
- `approved_confirmations`
- `pass_target`
- top evidence refs: `url`, `snippet_id`, `method`, `tier`, `source_id`

This keeps context compact while still evidence-grounded.

## Field Studio Send Mapping (Yes/No Columns)
Field Matrix now includes explicit yes/no columns for:
- key navigation sent to extract review
- contract rules sent to extract review
- required level sent to extract review
- extraction guidance sent to extract review
- tooltip/description sent to extract review
- enum options sent to extract review
- component entity set sent to extract review
- parse template sent directly to extract review
- ai mode/difficulty/effort sent directly to extract review
- evidence policy sent directly to extract review
- variance policy sent to component review
- constraints sent to component review

Route Matrix now includes route-level yes/no summary columns for the same send behavior.
Route Matrix also includes split yes/no columns for:
- required level send
- component entity set send (when component-linked)
- evidence policy direct send
- variance policy send in component review
- constraints send in component review

Current matrix policy values:
- `studio_parse_template_sent_direct_in_extract_review (yes/no) = yes`
- `studio_evidence_policy_sent_direct_in_extract_review (yes/no) = yes`
- `studio_parse_template_sent_direct_to_extract (yes/no) = yes`
- `studio_evidence_policy_sent_direct_to_extract (yes/no) = yes`
- `studio_send_booleans_prompted_to_model (yes/no) = no` (log/audit only, never prompted)
- `insufficient_evidence_action (threshold_unmet) = unk`
- `all_source_escalation_trigger = n/a (route-based upfront)`
- `min_distinct_sources_required (separate rule)` is independent from min evidence refs

## Current Runtime Flow
1. Fetch + parse per source/page.
File: `src/pipeline/runProduct.js`

2. Build per-source evidence pack.
File: `src/pipeline/runProduct.js` (`buildEvidencePack(...)`)

3. LLM extraction runs on scoped evidence batches.
Files:
- `src/llm/extractCandidatesLLM.js`
- `src/llm/fieldBatching.js`

4. Consensus merges candidates across all usable sources and computes provenance/confidence.
File: `src/scoring/consensusEngine.js`

5. Validator LLM runs for uncertain/high-risk fields.
File: `src/llm/validateCandidatesLLM.js`

6. Runtime gate applies normalization, cross-field checks, evidence checks, component review queueing.
Files:
- `src/engine/runtimeGate.js`
- `src/engine/fieldRulesEngine.js`

7. Component review batch sends flagged component decisions to LLM.
Files:
- `src/pipeline/componentReviewBatch.js`
- `src/llm/validateComponentMatches.js`

## LLM Routing (How Model Is Chosen)
Role-based routing resolves provider/model/base URL/API key from config/env.
File: `src/llm/routing.js`

Roles:
- `plan`
- `extract`
- `validate`
- `write`

Extraction batch model choice is done by rule-aware batching logic.
File: `src/llm/fieldBatching.js`

Signals used:
- field difficulty mix
- instrumented/hard fields
- per-field AI strategy (`auto|force_fast|force_deep`)
- forced-high fields
- max token guidance from rules

## How Extraction Prompt Is Built
File: `src/llm/extractCandidatesLLM.js`

System prompt enforces:
- target-field focus
- evidence-only extraction
- required evidence refs
- JSON-only output

User payload includes:
- product identity context
- schema field list
- batch target fields
- per-field contracts (type, shape, required level, unit, unknown reason)
- extraction guidance (auto-generated if no explicit rule note)
- enum options from rules + known values
- component reference options (known entities)
- anchors
- golden examples
- scoped references + snippets

Guidance generation source:
- `src/engine/ruleAccessors.js` (`autoGenerateExtractionGuidance(...)`)

## How Validation Prompt Is Built
File: `src/llm/validateCandidatesLLM.js`

System prompt enforces:
- evidence-backed acceptance only
- no guessing
- JSON-only output

User payload includes:
- uncertain fields
- current selected values
- provenance summary per uncertain field (confidence + evidence rows)
- constraints

## How Component Review Prompt Is Built
File: `src/llm/validateComponentMatches.js`

System prompt decides:
- `same_component`
- `new_component`
- `reject`

User payload includes:
- raw component query
- candidate component name
- candidate properties
- candidate variance policies
- candidate constraints
- product attributes
- similarity/match metrics
- top alternatives

## Table-Linked vs List-Linked Payload Plan
Table-linked key (component reference):
- Standard: `component values`
- High-stakes: `component values + prime sources`

List-linked key:
- Standard: `list values`
- High-stakes: `list values prime sources`

Scalar-linked key:
- Standard: `scalar value`
- High-stakes: `scalar value + prime sources`

Recommended payload builders:
- `buildComponentValuePacket(...)`
- `buildComponentValuePrimeSourcesPacket(...)`
- `buildListValuePacket(...)`
- `buildListValuePrimeSourcesPacket(...)`

## Prompt Assembly Contract (Universal)
Every LLM call should follow:
- stable `system` rules per role
- deterministic JSON schema
- compact `user` payload from selected packet builder
- `request_options.web_search` set from route `enable_websearch`
- source refs must map to evidence snippets/ids
- explicit `reason` for route selection

## Confidence Update Behavior
Current consensus already computes value confidence from aggregated multi-source candidates.
File: `src/scoring/consensusEngine.js`

Universal behavior target:
- extraction call context may be scoped
- confidence state must always be recomputed from aggregated evidence set for the key/item
- if new data changes best value or pass-target status, publish updated confidence

## Implementation Steps
1. Keep route-matrix policy as the source of truth for send mode.
2. Build reusable packet builders for table/list send modes.
3. At call-time, choose packet builder from route + key type.
4. Include prime-source packet only when route policy says so.
5. Keep strict schema + evidence ref enforcement.
6. Recompute confidence from aggregated candidates after each round.
7. Persist per-key review artifacts with chosen packet mode for auditability.

## Minimal Pseudocode
```text
for each key:
  route = resolve_route(required_level, difficulty, availability, effort, ai_mode)
  key_type = resolve_key_type(table_linked, list_linked, scalar)

  if key_type == table_linked:
    payload = route.table_linked_send == '+prime' ? component_values_plus_prime_sources : component_values
  else if key_type == list_linked:
    payload = route.list_linked_send == '+prime' ? list_values_plus_prime_sources : list_values
  else:
    payload = scalar_standard_payload

  llm_result = call_with_routing(route, payload, schema)
  update_candidates(llm_result)

recompute_consensus_confidence_from_all_sources()
```

## Notes On Current Gap
Current component review queue builds `product_attributes` values, but not a full per-field prime-source snapshot by default.
Files:
- `src/engine/fieldRulesEngine.js`
- `src/pipeline/runProduct.js`

To fully enforce this plan, add prime-source packet construction before component/list review calls.
