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

# Phase 10 â€” Safe learning/compounding (lexicon/anchors/url_memory/domain_yield) gated by acceptance


## Goal
Make the system smarter every run **without poisoning**:
- update lexicon/anchors only after downstream acceptance
- learn canonical URLs (url_memory)
- learn domain usefulness per field (domain_field_yield)
- learn bad URL patterns (already in Phase 4)

## Deliverables
- `LearningUpdater` module
- GUI â€œLearning Feedâ€ (what changed this run)
- Guardrails for updates (confidence + evidence refs + tier gates)

## Implementation

### 10.1 Guardrails (must)
Only update learning stores if:
- field status == accepted
- evidence policy satisfied (refs >= min_refs)
- confidence >= threshold (recommend 0.85 for deep fields)
- if component_ref: component review accepted

### 10.2 Updates
- component_lexicon:
  - add normalized component names for sensor/switch/encoder/panel
- field_anchors:
  - add new stable phrases that improved retrieval
- url_memory:
  - store canonical manual/spec/support URLs (with doc_kind and tier)
- domain_field_yield:
  - increment seen_count and used_count when evidence from domain was used in prime sources

### 10.3 GUI proof
Learning feed view:
- â€œAdded anchor X for field Y (from url/snippet_id)â€
- â€œAdded component Z (accepted, confidence=0.93)â€
- â€œSaved canonical manual PDF URLâ€
- â€œDomain yield: rtings.com helped polling_rate +1â€

Proof steps:
- Run two similar products in same category:
  - second run should show fewer external searches and faster Tierâ€‘1 hits.

### 10.4 Feed accepted learning into Studio suggestions (overlooked)
- Emit Studio suggestion artifacts instead of mutating generated rules in-place:
  - field_rules_suggestions.search_hints.json
  - field_rules_suggestions.anchors.json
  - field_rules_suggestions.known_values.json
- Require evidence references and acceptance stats on each suggestion row.

### 10.5 Planned runtime knob (not implemented yet)
- Add a future run-control knob for anchor expansion proposals:
  - `phase 07/10 anchor expansion suggestions` (boolean)
  - model dropdown for suggestion generation model
- Scope:
  - only propose additions for repeatedly missing / low-confidence fields
  - write proposals to suggestion artifacts only
  - do not auto-activate anchors until downstream acceptance
- This knob is intentionally deferred to avoid learning poisoning before acceptance gates are fully wired.

## Exit criteria
- Learning updates are visible and explainable, and improve subsequent runs.

