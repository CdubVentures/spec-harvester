# Deep Spec Harvester â€” Phased Implementation Plan (Accuracyâ€‘Max)

This phase file is written as an **implementation prompt for senior software engineers**.
It includes: exact deliverables, file touchpoints, schemas/events, test strategy, and **GUI proof**.

**Guiding principles**
- Accuracy is the primary objective (95%+ on technical specs).
- Evidence tiers and confidence gates control *what happens next*.
- Discovery is needâ€‘driven (missing/low-confidence/conflict fields) â€” no endless key/alias loops.
- Indexing is deterministic (content_hash dedupe + stable snippet IDs), so results are replayable and auditable.
- The GUI must prove each phase works before moving to the next.

Repo context (from your `src.zip`):
- Pipeline orchestrator: `src/pipeline/runProduct.js`
- Discovery orchestrator: `src/discovery/searchDiscovery.js`
- Search providers: `src/search/searchProviders.js` (includes SearXNG support)
- Frontier / URL health: `src/research/frontierDb.js` + `src/research/frontierSqlite.js`
- LLM extraction + batching: `src/llm/extractCandidatesLLM.js`, `src/llm/fieldBatching.js`
- Validation: `src/llm/validateCandidatesLLM.js`, `src/validator/qualityGate.js`, `src/engine/runtimeGate.js`
- Consensus: `src/scoring/consensusEngine.js`
- GUI server: `src/api/guiServer.js` (WS support + review grid)

---

# Phase 08 â€” Extraction Context Matrix wiring into prompts + extraction dashboard


## Goal
Make extraction **contract + evidence policy aware** by wiring the Extraction Context Matrix into prompt assembly:
- always include normalized evidence policy summary (not just yes/no flags)
- include parse template intent (ID + examples)
- include list rules and enum options
- include component refs (capped)
- include Prime Sources snippets (stable snippet_id)

Also: add an â€œExtractionâ€ dashboard tab that proves extraction is grounded and valid.

## Deliverables
- `ExtractionContextAssembler` module (new or integrated into `extractCandidatesLLM.js`)
- Prompt changes in:
  - `src/llm/extractCandidatesLLM.js`
  - `src/llm/fieldBatching.js` (batch by policy + evidence readiness)
- GUI Extraction tab:
  - batches table
  - schema fail rates
  - dangling snippet ref rate
  - min_refs satisfied rate

## Implementation

### 8.1 Contract assembly
For each field:
- type/shape/unit/range
- list rules (dedupe/order/max_items)
- evidence policy:
  - required? min_refs? tier preference?
  - distinct sources required?
- parse template intent:
  - template id + 1â€“2 examples (avoid raw regex dumps)

### 8.2 Evidence payload
For each field in a batch:
- attach Prime Sources:
  - snippet_id
  - url
  - tier
  - short quote (<= ~300 chars)
- keep batch context compact; do NOT dump entire pages.

### 8.3 Strict output contract
Extraction outputs MUST include:
- value (or unknown)
- snippet_id refs array
- unknown_reason (enum)
Reject on:
- refs referencing unknown snippet_id
- schema mismatch
- enum out of set

### 8.4 GUI proof
Extraction tab panels:
- live batches list (status, model, fields_count, snippets_count)
- metrics:
  - schema_fail_rate
  - evidence_policy_violation_rate
  - dangling_snippet_ref_rate
  - extracted_fields_per_min

Proof steps:
- run a product; click a field; show extracted value + snippet refs and the snippet text.

### 8.5 Field Studio context and unknown policy (overlooked)
- Include ui.label, trimmed ui.tooltip_md, and ai_assist.reasoning_note in extraction prompt context.
- Enforce unknown handling knobs where present: contract.unknown_token, contract.unknown_reason_required, unknown_reason_default.
- Add per-field context trace payload so prompt assembly is inspectable in GUI.

## Exit criteria
- No accepted values without evidence refs that satisfy policy.
- GUI can explain failures (schema vs evidence vs missing).


