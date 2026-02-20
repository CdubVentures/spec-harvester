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

# Phase 09 â€” Tier/confidence convergence loop + stop conditions (no infinite key/alias loops)


## Goal
Turn the system into a bounded convergence loop:
- compute NeedSet
- attempt internal retrieval + extraction for NeedSet
- if gates fail, dispatch targeted discovery only for remaining NeedSet
- stop early when high-stakes fields satisfied
- stop if marginal yield is low

## Deliverables
- Explicit â€œroundâ€ loop in orchestrator
- Stop conditions
- GUI: round summaries + convergence charts

## Implementation

### 9.1 Add explicit rounds
In `src/pipeline/runProduct.js` (or a new orchestrator wrapper):
- Round 0: bootstrap sources (url_memory + high-precision search)
- Round 1..N: targeted discovery for remaining NeedSet
At end of each round:
- consensus/validate updates field_state
- compute NeedSet
- decide stop vs next actions

### 9.2 Stop conditions
Stop when:
- all identity + publish-gated + required fields:
  - confidence >= thresholds
  - evidence policy met (min_refs, tier)
  - conflicts resolved
OR
- max_rounds reached (configurable)
OR
- marginal_yield below threshold:
  - last X fetched docs contributed 0 new `evidence_used`

### 9.3 Targeted discovery rules
When NeedSet non-empty:
- if tier deficit exists: fire Tierâ€‘1 doc_hints first (manual/spec/support)
- if conflict remains: fire teardown/lab review doc_hints
- cap queries and fetched URLs per round

### 9.4 GUI proof
Round summary panel:
- NeedSet size each round
- confidence delta each round
- escalation reason (tier_deficit, conflict, min_refs_fail)
- stop reason

### 9.5 Key validation and migration guardrails (overlooked)
- Validate all runtime keys against compiled contract each round.
- Apply key_migrations.json mappings before scoring/planning.
- Reject unknown keys by default (log and metric), unless explicit migration/alias rule exists.
## Exit criteria
- Runs converge; they do not loop through keys/aliases endlessly.
- External search happens only for remaining NeedSet fields.

