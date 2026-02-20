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

# Phase 07 â€” Tier-aware internal retrieval + Prime Sources builder


## Goal
Use the index to build **tier-acceptable Prime Sources** for the NeedSet fields:
- query facts/FTS first
- rank by tier/doc_kind/anchor proximity
- select minimal snippets to satisfy evidence policy (min_refs, distinct sources if required)

## Deliverables
- `src/retrieve/tierAwareRetriever.js` (new)
- `src/retrieve/primeSourcesBuilder.js` (new)
- GUI: per-field retrieval hits + prime source selection view

## Implementation

### 7.1 Retrieval ranking
Rank candidate snippets/facts by:
- tier weight: tier1=3, tier2=2, tier3=1
- doc_kind alignment: manual/spec > support > lab_review > general
- identity match: brand+model tokens near the snippet
- anchor proximity: field_anchors matched in same snippet or same table row
- recency (optional)

### 7.2 Field anchors usage
For each field_key:
- use `field_anchors` (Phase 10 learns more)
- include unit hints (Hz, mm, g, etc.)
- include component lexicon tokens when relevant (PAW*, Kailh, Huano)

### 7.3 Prime Sources selection
For each field_key:
- pick top snippets until:
  - `min_refs` satisfied
  - if distinct-sources required: ensure different domains/doc_ids
- persist to `prime_sources` table
- ensure snippet_ids exist (no dangling refs)

### 7.4 GUI proof
- Field view shows:
  - retrieval hits (tier/doc_kind/url/snippet preview)
  - selected prime sources and whether min_refs satisfied
  - reason badges (tier_preferred, anchor_match, table_fact)

Proof steps:
- pick a mouse missing polling_rate:
  - retrieval should find â€œ8000 Hzâ€ in manual/spec
  - prime sources should include >=2 refs if required

### 7.5 Field Studio tier preference wiring (overlooked)
- Apply per-field evidence.tier_preference to retrieval ranking weights instead of fixed global tier weights only.
- Include contract unit and parse-template cues in field retrieval query assembly.
- Persist ranking feature contributions so GUI can explain why a snippet won.

### 7.6 Planned runtime knob (not implemented yet)
- Add future run-control knob: `phase 07/10 anchor expansion suggestions`.
- Purpose: when a field repeatedly fails retrieval, generate a small candidate set of natural-language anchors/value patterns for review.
- Constraints:
  - proposals only (no auto-apply),
  - require acceptance workflow before writing to active retrieval hints,
  - cap proposals per field/run to prevent anchor drift.

## Exit criteria
- Prime sources can be built without external search when evidence already exists.
- Evidence policy satisfaction is visible per field.

