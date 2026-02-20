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

# Phase 05 — Parallel fetch/parse (HTTP-first + browser escalation) + per-host backoff


## Goal
Make discovery+indexing fast *without sacrificing accuracy* by:
- parallelizing fetch/parse/index
- using HTTP-first fetch
- escalating to browser only when necessary
- respecting per-host throttles and adaptive backoff on blocks

## Deliverables
- Worker pools (search/fetch/parse/llm)
- HTTP-first fetch strategy (existing `HttpFetcher`)
- Browser escalation (existing `PlaywrightFetcher`)
- Per-host concurrency + backoff
- GUI: workers panel + HTTP vs browser mix + stage waterfall

## Implementation

### 5.1 Worker pools
Implement an internal scheduler with bounded concurrency:
- `search_pool`: 2–4
- `fetch_pool`: 10–20 (global)
- `parse_pool`: CPU-bound 2–8
- `llm_pool`: 5–20 (depends on provider limits)

This can be a simple promise queue per pool.

### 5.2 Per-host concurrency
Maintain a host limiter:
- default `max_inflight_per_host = 2`
- on 429/403: drop to 1 and extend delay
- on repeated blocks: cooldown host via url_health and temporarily skip

### 5.3 HTTP-first + escalation
Fetch decision:
1) Try `HttpFetcher`
2) If response indicates JS-only or blocked/empty:
   - escalate to `PlaywrightFetcher`
3) Persist `fetcher_kind` per fetch and show in GUI.

Heuristics for escalation:
- HTML has <title> “Access denied” or captcha markers
- body text length < threshold AND expected anchors absent
- content-type mismatch / redirect loops

### 5.4 Streaming indexing
As soon as a document parses successfully:
- index it (Phase 6)
- run internal retrieval for the current NeedSet (Phase 7)
- do NOT wait for all fetches to complete

### 5.5 GUI proof
Panels:
- Active jobs by pool
- Queue backlog
- Requests/min
- HTTP vs browser mix over time
- p95 fetch latency

Proof steps:
- Run IndexLab; confirm multiple URLs fetching concurrently.
- Confirm escalation only for sites that need it.

## Exit criteria
- p95 time-to-first-indexed-doc decreases materially.
- Browser usage remains a minority (except for JS-heavy domains).
