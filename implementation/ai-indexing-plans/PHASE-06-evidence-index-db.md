# Deep Spec Harvester — Phased Implementation Plan (Accuracy‑Max)

This phase file is written as an **implementation prompt for senior software engineers**.
It includes: exact deliverables, file touchpoints, schemas/events, test strategy, and **GUI proof**.

**Guiding principles**
- Accuracy is the primary objective (95%+ on technical specs).
- Evidence tiers and confidence gates control *what happens next*.
- Discovery is need‑driven (missing/low-confidence/conflict fields) — no endless key/alias loops.
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

# Phase 06 — EvidenceIndexDb (SQLite): docs + chunks + facts + FTS + stable snippet_id


## Goal
Create the deterministic **EvidenceIndexDb** so every fetched artifact is reusable and searchable:
- content_hash dedupe prevents rework
- stable snippet IDs enable evidence refs
- FTS + facts tables enable fast lookup for missing fields

## Deliverables
- SQLite DDL: `sql/schema_v1.sql` (included in this bundle)
- `src/index/evidenceIndexDb.js` (new)
- Parsing adapters emit:
  - chunks (text snippets)
  - facts (table/KV rows)
- GUI: “Indexed docs inventory” + “Index search box”

## Implementation

### 6.1 Create EvidenceIndexDb module
Create `src/index/evidenceIndexDb.js`:
- open SQLite connection (WAL mode)
- initialize schema (run DDL)
- methods:
  - `upsertItem(...)`
  - `createRun(...)`
  - `recordSearchQuery(...)`
  - `recordUrlCandidate(...)`
  - `recordFetch(...)`
  - `recordDocument(...)`
  - `indexChunks(doc_id, chunks[])`
  - `indexFacts(doc_id, facts[])`
  - `searchChunksFTS(query, opts)`
  - `searchFactsFTS(query, opts)`

### 6.2 Stable snippet_id rules
snippet_id must be deterministic:
- `snippet_id = sha1(final_url + ":" + start_offset + ":" + end_offset + ":" + text_hash_prefix)`
Store both `snippet_id` and `text_hash`.

### 6.3 Parsing integration
Hook parsing outputs:
- For HTML:
  - headings + paragraphs as chunks
  - table rows → facts
- For PDFs:
  - page blocks as chunks
  - detected tables → facts

Adaptors:
- You already have adapters in `src/adapters/` and table parsing helpers.

### 6.4 Dedupe
Before parsing/indexing:
- if `content_hash` exists and parsed_ok=true:
  - skip parse+index and link the existing doc to the new run (optional)
- Always still update url_health and url_memory stats (Phase 10).

### 6.5 GUI proof
- Index inventory table:
  - doc_kind, tier, domain, chunks_count, facts_count, parsed_ok
- Index search box:
  - query “PAW3395” and get hits with snippet previews and links.

Proof steps:
- run IndexLab twice on same item:
  - second run should show high dedupe hits and much faster indexing.

## Exit criteria
- EvidenceIndexDb stores docs/chunks/facts and supports FTS queries.
- Re-runs skip re-indexing unchanged content.
