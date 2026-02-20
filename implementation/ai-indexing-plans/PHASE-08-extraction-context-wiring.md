# Phase 08 - Extraction Context Wiring

## Canonical Status
- This is the single canonical file for this phase.
- Consolidated on 2026-02-20 from split planning plus improvement docs.
- Includes implemented status and remaining work from merged sources.
- Keep all unfinished items active until code plus GUI proof confirms completion.

## Merged Source Files
- PHASE-08-extraction-context-wiring.md
- PHASE-08-IMPROVMENT.md

## Full Merged Spec

### Source: PHASE-08-extraction-context-wiring.md

> Original header: Deep Spec Harvester â€” Phased Implementation Plan (Accuracyâ€‘Max)


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
When visual assets exist, extraction context should include image references for ambiguity checks (identity/model/variant).

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
  - visual evidence section (preview + download per image asset)

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
- attach visual references when available:
  - `image_asset_id`
  - `region_id` (optional)
  - `storage_uri` (or API URL) for LLM derivative only (`review_sm/review_lg/region_crop`)
  - `content_hash` / `perceptual_hash` for dedupe and cross-source match checks
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
- visual proof:
  - live image asset strip for active source (thumbnail, surface, hash)
  - click to preview full image
  - one-click download for each image asset
  - image-to-field links (`field_key -> image_asset_id/region_id`)

Proof steps:
- run a product; click a field; show extracted value + snippet refs and the snippet text.
- for ambiguous model/variant fields, show linked screenshot/image and confirm reviewer can open/download it.

### 8.5 Field Studio context and unknown policy (overlooked)
- Include ui.label, trimmed ui.tooltip_md, and ai_assist.reasoning_note in extraction prompt context.
- Enforce unknown handling knobs where present: contract.unknown_token, contract.unknown_reason_required, unknown_reason_default.
- Add per-field context trace payload so prompt assembly is inspectable in GUI.

### 8.6 Phase 08B integration (visual asset capture)
- Consume visual manifests produced by `PHASE-08B-visual-asset-capture-proof.md`.
- Include image cues in extraction prompt only when ambiguity > low or identity gate is uncertain.
- Validation should reject visual claims without resolvable image references.
- Keep text evidence mandatory; visual evidence augments identity/variant confidence.

### 8.7 Multi-product identity gating contract
- For all evidence types, extraction context must carry:
  - `page_product_cluster_id`
  - `target_match_score`
  - `target_match_passed`
- Candidates with `target_match_passed=false` are never accepted and should be downgraded to unknown with `identity_uncertain` or specific reject reason.

## Exit criteria
- No accepted values without evidence refs that satisfy policy.
- GUI can explain failures (schema vs evidence vs missing).
- GUI can prove image-backed extraction with preview + download and source hash lineage.

## Implementation Status (Current)
- Added `src/llm/extractionContext.js` to assemble a Phase 08 context matrix:
  - field contract + evidence policy summary
  - parse-template intent samples
  - enum options + component refs
  - prime snippet packs (stable snippet ids)
- Wired Phase 08 payload context into:
  - `src/llm/extractCandidatesLLM.js` (batch extraction + verify extraction payloads)
  - `src/llm/validateCandidatesLLM.js` (uncertain field validator payloads)
- Added Phase 08 run artifacts in `src/pipeline/runProduct.js`:
  - `analysis/phase08_extraction.json` (run + latest)
  - summary metrics embedded under `summary.phase08`
- Added GUI API endpoint:
  - `GET /api/v1/indexlab/run/:runId/phase08-extraction` in `src/api/guiServer.js`
- Added GUI panel:
  - `Extraction Context Matrix (Phase 08)` in `tools/gui-react/src/pages/indexing/IndexingPage.tsx`
  - includes batch outcomes, fail/violation rates, field context rows, prime snippet rows
- Next slice (Phase 08B integration):
  - add `image_asset_refs` into extraction context payload
  - add extraction visual preview pane + download actions in IndexLab



### Source: PHASE-08-IMPROVMENT.md

> Original header: PHASE-08 IMPROVMENT


## What I'd Add
1. Enforce strict extraction context contract including identity/applicability fields.
2. Enforce required unknown reasons (`missing_evidence`, `conflict`, `identity_uncertain`, `blocked_by_policy`).
3. Add provider-normalized structured output parser to handle non-JSON wrappers consistently.
4. Add lane-level payload and response tracing for prompt and output review.
5. Add visual evidence refs (`image_asset_id`, `region_id`) for ambiguous identity/model fields.
6. Add live GUI image preview + download pane for extraction proof.
7. Enforce derivative-only image payloads to LLM (`<= 512KB` per image, no originals).
8. Enforce multi-product identity gate fields on every evidence unit (`page_product_cluster_id`, `target_match_score`, `target_match_passed`).

## What We Should Implement Now
1. Add identity-aware extraction gating in prompt assembly and validation.
2. Reject candidates with dangling or invalid snippet references.
3. Add clear validation error badges in GUI for schema/evidence/identity failures.
4. Gate visual evidence usage by ambiguity level and keep text evidence mandatory.
5. Emit `visual_asset_captured` and `extraction_visual_ref_attached` events for live run proof.
6. Reject candidates with `target_match_passed=false` before acceptance pipeline.

## Definition Of Done
1. No accepted value without valid evidence refs.
2. Identity-unsafe values are downgraded to unknown with reason.
3. Prompt/response traces are readable in GUI for debugging.
4. Ambiguous fields show linked image evidence with preview + download while run is active.
5. Multi-product pages do not leak non-target product evidence into accepted values.

