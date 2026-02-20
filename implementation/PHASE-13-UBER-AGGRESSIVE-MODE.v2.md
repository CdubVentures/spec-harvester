# PHASE 13 — UBER AGGRESSIVE MODE (SEARCH FRONTIER + FIELD-DRIVEN DEEPENING + CHATMOCK INTELLIGENCE)

**Implementation order:** ✅ **Implement Phase 13 first**, then implement **Improvement Plan Phases 1–5** (docs provided separately).

---

## ROLE & CONTEXT

You are building the “always-learning web research engine” for Spec Harvester.

Phases 1–12 already cover:
- field contracts + validation (FieldRulesEngine)
- extraction pipeline + evidence packs
- aggressive mode extraction + ChatMock sidecar routing (low default, high escalation)

**Phase 13** adds the missing production capability for “uber aggressive 24/7”:

- **Search Frontier Memory** (never re-search or re-fetch the same dead ends endlessly)
- **Field‑driven deepening loop** (missing/conflicting fields drive targeted search)
- **Systematic index expansion** over time (start easy → grow coverage and sources)
- **ChatMock used as the intelligence layer**:
  - query planning
  - SERP reranking
  - source expansion suggestions
  - final evidence auditing for critical fields

**Non-goal:** Phase 13 is not “use ChatMock to click Google” like a browser bot.  
We keep search reproducible and logged via API search providers (Google CSE / Bing / SearXNG), while ChatMock improves *what we search* and *how we select URLs*.

---

## MISSION (NON‑NEGOTIABLE)

Run 24/7 and continually improve:

1) **Coverage increases over time** for expected fields (week-over-week).  
2) **Accuracy stays evidence-first**: no value ships without citations + audit pass.  
3) **The system learns**: dead links, low-yield domains, and redundant queries are avoided automatically.  
4) **Search is systematic and auditable**: every query, SERP, chosen URL, and fetch outcome is recorded.  
5) **ChatMock increases intelligence** (better queries, better URL selection, better conflict resolution) without becoming a bottleneck.

---

## WHY YOU’RE SEEING “SO MANY WEBSITE 404s” (AND WHAT PHASE 13 FIXES)

Website 404s are normal. **Repeated** 404s are a system bug.

**Root causes of repeated 404s:**
- stale SERP links re-selected over and over
- no canonicalization (tracking params create “new” URLs that are the same page)
- no persistent “dead URL memory”
- no domain/path-pattern yield stats (so the system keeps trying the same bad sections)

**Phase 13 fixes the repetition** by adding:
- canonical URL normalization
- persistent frontier DB with status + cooldowns
- reranking that penalizes dead patterns
- automatic replacement search when a fetch fails

You will still see *some* new 404s; you will **stop thrashing** the same dead ones.

---

# DELIVERABLES

## Deliverable 13A — Search Frontier DB (the “index memory”)

A persistent store that records three things:

### 1) Query Ledger
For each query attempt:
- normalized query string + hash
- provider used
- timestamp
- top results (URLs + titles + ranks)
- fields targeted
- product identity lock (brand/model)

### 2) URL Ledger
For every URL ever seen:
- canonical_url
- discovered_from (query hash, parent URL, sitemap, etc.)
- fetch outcomes:
  - status code (200/301/404/410/429/5xx)
  - content type (html/pdf/json)
  - final redirected URL
  - content hash (sha256)
  - last fetched timestamp
- yield:
  - fields found
  - confidence and conflict contribution
- cooldown state:
  - next_retry_at
  - retries_count

### 3) Domain & Path Yield Stats
Rolling stats that answer:
- which domains produce which fields reliably
- which path patterns are dead ends
- which domains frequently return 404/403/429
- which domains cause identity ambiguity

**Storage options (pick one):**
- **SQLite** (recommended): robust, fast, easy to query for analytics
- JSONL (append-only) + periodic compaction

**Required schema tables (SQLite)**
- `queries(query_hash, query_text, provider, ts, product_id, fields_json, results_json)`
- `urls(canonical_url, domain, path_sig, first_seen_ts, last_seen_ts, last_status, last_final_url, content_type, content_hash)`
- `fetches(id, canonical_url, ts, status, final_url, bytes, elapsed_ms, error)`
- `yields(canonical_url, field_key, value_hash, confidence, conflict_flag, ts)`
- `cooldowns(canonical_url, next_retry_ts, reason, attempts)`
- `domain_stats(domain, field_key, success_count, conflict_count, notfound_count, avg_confidence, last_seen_ts)`
- `path_stats(domain, path_sig, ok_count, notfound_count, redirect_count, blocked_count, last_seen_ts)`

---

## Deliverable 13B — Uber Aggressive Field‑Driven Loop (gap → search → fetch → extract → verify)

Aggressive mode must become a **worklist engine**.

### Worklist definition
Worklist fields are any fields that are:
- missing expected/required
- below confidence threshold
- in conflict
- failed evidence audit

### Loop
1) Build worklist
2) Ask ChatMock **LOW** to generate a Search Plan (strict JSON)
3) Run deterministic search providers (Google CSE / Bing / SearXNG)
4) Store query + SERP into frontier DB
5) Ask ChatMock **LOW** to rerank + filter results (identity match, field relevance, domain yield)
6) Fetch top-K URLs (respect per-domain and per-product budgets)
7) Extract candidates, validate via FieldRulesEngine
8) Evidence audit (ChatMock low default; high only for critical)
9) Update frontier yields and cooldowns
10) Repeat until stop conditions

### Stop conditions (explicit)
Stop when any condition triggers:
- required/critical fields satisfied AND no conflicts
- no new high-yield URLs discovered for N rounds
- budget/time exceeded
- diminishing returns: <X new fields per round for N rounds

---

## Deliverable 13C — Progressive Deepening Schedule (start easy, go deeper over time)

Phase 13 adds a **time-based deepening policy** so you get maximum results 24/7 without burning resources.

### Ramp tiers
- **Tier 0 (Easy pass):**
  - manufacturer + top trusted labs + already-approved sources
  - minimal search
  - no deep escalation unless identity fails

- **Tier 1 (Gap closure):**
  - targeted per-field search queries
  - bounded new domains
  - reranking uses domain yield stats

- **Tier 2 (Long-tail expansion):**
  - sitemap inventory on high-value domains
  - per-field “best domain discovery”
  - regional/alternate domains (language variants) *only if needed*

- **Tier 3 (Hard mode, bounded):**
  - vision extraction for image-only spec tables
  - deep reasoning for critical contradictions
  - optional “web_search tool” as a discovery booster (not final evidence)

**Scheduling logic**
- new products: Tier 0 → Tier 1 (same day)
- stuck products: Tier 2 nightly / weekly
- long-tail backfill: Tier 2/3 on a background cadence (lowest priority)

---

## Deliverable 13D — Search Planner and SERP Reranker using ChatMock (LOW default)

### Planner: “what should we search next?”
Input:
- identity lock
- missing fields (worklist)
- known good domains + domain yield stats
- frontier DB summary (what has already been tried)

Output (strict JSON):
- queries (ranked)
- preferred domains
- stop rules (max queries, max new domains)
- negative filters (avoid known-dead patterns)
- “sitemap mode recommended” flags

**Model:** ChatMock `gpt-5-low` (default)

### Reranker: “which SERP results are worth fetching?”
Input:
- top SERP results (title, snippet, url)
- identity lock
- domain yield priors
- dead URL priors (path signature stats)

Output (strict JSON):
- keep/drop decision
- reasons
- top-K to fetch

**Model:** ChatMock `gpt-5-low` (default)

---

## Deliverable 13E — Dead URL & Redirect Intelligence (kills repeated 404 thrash)

Implement canonicalization + cooldown rules.

### Canonicalization rules (required)
- strip common tracking params (`utm_*`, `gclid`, `fbclid`, etc.)
- normalize scheme/host casing
- normalize trailing slashes
- sort query parameters
- convert known “share/amp” variants to canonical when possible
- store both original URL and canonical URL (for audit)

### Cooldown policy (recommended defaults)
- HTTP 404: cooldown 72h
- HTTP 404 repeated 3+ times: cooldown 14d (pattern-level penalty)
- HTTP 410: cooldown 90d
- HTTP 429: exponential backoff (15m → 1h → 6h)
- network timeout: retry once, then cooldown 6h

---

## Deliverable 13F — Uber Aggressive Outputs (auditable by design)

Each uber aggressive run must write:
- `out/.../research/search_plan.json`
- `out/.../research/search_journal.jsonl` (append-only)
- `out/.../research/frontier_snapshot.json` (top urls, cooldowns, yields)
- `out/.../research/coverage_delta.json` (fields gained/lost vs last run)
- normal outputs (`spec.json`, `provenance.json`, evidence pack, etc.)

---

# TECHNICAL DESIGN

## New modules (suggested)
- `src/research/frontierDb.js` (SQLite wrapper)
- `src/research/urlNormalize.js`
- `src/research/queryPlanner.js` (ChatMock low)
- `src/research/serpReranker.js` (ChatMock low)
- `src/research/frontierScheduler.js` (tier schedule + cooldown enforcement)
- `src/research/uberAggressiveOrchestrator.js` (the loop)

## Integration points
- `run-until-complete --mode uber_aggressive`
- `daemon --mode uber_aggressive` (nightly deepening tasks enabled)

---

# CONFIG / ENV VARS (PHASE 13)

```bash
# Enable the new mode
UBER_AGGRESSIVE_ENABLED=true

# Frontier DB
FRONTIER_DB_PATH=out/_intel/frontier/frontier.sqlite
FRONTIER_ENABLE_SQLITE=true

# Canonicalization
FRONTIER_STRIP_TRACKING_PARAMS=true

# Search providers
SEARCH_PROVIDER=dual               # existing: google|bing|dual|searxng|none
DISCOVERY_MAX_QUERIES=10
DISCOVERY_MAX_RESULTS_PER_QUERY=10

# Fetch budgets
UBER_MAX_URLS_PER_PRODUCT=25
UBER_MAX_URLS_PER_DOMAIN=6
UBER_MAX_ROUNDS=6

# Cooldowns (seconds)
FRONTIER_COOLDOWN_404=259200       # 72h
FRONTIER_COOLDOWN_404_REPEAT=1209600 # 14d
FRONTIER_COOLDOWN_410=7776000      # 90d
FRONTIER_COOLDOWN_TIMEOUT=21600    # 6h

# ChatMock Cortex (LOW default, HIGH bounded)
CORTEX_BASE_URL=http://localhost:8000/v1
CORTEX_MODEL_SEARCH_FAST=gpt-5-low
CORTEX_MODEL_RERANK_FAST=gpt-5-low
CORTEX_MODEL_AUDIT=gpt-5-low
CORTEX_MODEL_DEEP=gpt-5-high
CORTEX_MAX_DEEP_FIELDS_PER_PRODUCT=12
```

> Note: Phase 1 improvement doc covers baseURL normalization so `/v1` vs no `/v1` never breaks calls.

---

# ACCEPTANCE CRITERIA

1) **Repeat 404 thrash drops**: URLs that returned 404 are not retried until after cooldown.  
2) **Search memory works**: identical (product, query) combinations are not re-issued within cooldown unless forced.  
3) **Coverage climbs**: expected-field unknown rate decreases week-over-week on a fixed corpus.  
4) **Auditability**: search_plan + search_journal exist for every uber aggressive run.  
5) **ChatMock utilization is smart**:
   - ≥85% of ChatMock calls are `gpt-5-low`
   - high tier bounded by `CORTEX_MAX_DEEP_FIELDS_PER_PRODUCT`
6) **24/7 stability**: if ChatMock/search provider is down temporarily, jobs requeue and queue continues (no deadlock).

---

# IMPLEMENTATION CHECKLIST (PHASE 13)

☐ Add new CLI mode `uber_aggressive` and route to `uberAggressiveOrchestrator`  
☐ Implement SQLite frontier with minimal schema + migration  
☐ Add URL canonicalizer + tracking-param stripping  
☐ Record all SERP results + chosen URLs into frontier  
☐ Record fetch outcomes (status/final_url/hash) into frontier  
☐ Add ChatMock planner + reranker (low) returning strict JSON  
☐ Add cooldown enforcement and replacement-query behavior  
☐ Output required research artifacts per run  
☐ Add daily domain/path yield compaction jobs

