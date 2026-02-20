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

# Phase 04 — 404/410/403/429 control loop + repair search + bad_url_patterns


## Goal
Stop 404/blocked churn and make discovery **self-healing**:
- 404/410 → cooldown + repair search
- repeated template failures → bad_url_patterns
- 403/429/blocked pages → domain cooldown + reduced concurrency + alternative sources

## Deliverables
- URL health integration in fetch pipeline
- Repair search job emission
- bad_url_patterns learning
- GUI: URL health table + repair events + repeat-404 list

## Implementation

### 4.1 Use existing Frontier DB hooks
You already have:
- `src/research/frontierDb.js`
- `src/research/frontierSqlite.js`

Wire the fetch pipeline so EVERY fetch does:
- pre-check: `frontierDb.shouldSkipUrl(url)` (cooldown / dead pattern)
- post-record: `frontierDb.recordFetch({url, status, finalUrl, ...})`

If these are already partially wired, make them mandatory in IndexLab mode and the main pipeline.

### 4.2 404/410 behavior
On fetch finish:
- if status in [404,410]:
  - increment fail_count
  - set `cooldown_until = now + backoff(fail_count)`
  - emit `trigger_repair_query(domain, brand, model)` event once per domain per run (dedupe)

Repair query template:
- `site:{domain} "{brand} {model}" (spec OR manual OR pdf OR "user guide")`

### 4.3 Block behavior (403/429/captcha)
Treat as blocked:
- increment blocked_count
- set longer cooldown
- reduce per-host concurrency (Phase 5 introduces concurrency controls)
- switch doc_hint to alternative sources (Tier‑2 lab reviews)

### 4.4 bad_url_patterns
If a pattern repeatedly 404s:
- pattern = normalized path template (e.g., `/support/{model}/downloads`)
- once fail_count>=N for multiple URLs on same domain:
  - `log_bad_url_pattern(domain, pattern)`
  - future `shouldSkipUrl` bypasses it

### 4.5 GUI proof
Add panels:
- URL Health table (url, last_status, fail_count, cooldown_until)
- Repeat 404 list (group by domain+pattern)
- Repair queries fired (with timestamps)

Proof steps:
- Force a known-dead URL
- confirm:
  - it’s cooled down
  - repeated attempts skip
  - repair query fired once

## Exit criteria
- 404 churn drops (repeat hits stop).
- Repair search produces new candidate URLs in the same run.
