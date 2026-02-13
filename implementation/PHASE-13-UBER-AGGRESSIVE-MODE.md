# PHASE 13 — UBER AGGRESSIVE MODE (24/7 SEARCH FRONTIER + CONTINUOUS COVERAGE CLOSURE)

> **Positioning:** Phase 10 proved multi‑category production hardening. Phase 11/12 added ChatMock (Cortex sidecar) + aggressive extraction.  
> **Phase 13** turns the system into an **always‑learning “web research machine”** that **systematically expands** the source universe over time, while staying **evidence‑first** and **audit‑friendly**.

---

## ROLE & CONTEXT

You are building a **24/7 autonomous research mode** that:
- starts with “easy” sources (manufacturer + top labs + known trusted registries),
- then continuously expands into the long tail (manuals, regional sites, cached PDFs, distributor docs, spec databases),
- while tracking what has been searched/indexed so it never loops or thrashes.

ChatMock is used as a **search + extraction sidecar**:
- OpenAI‑compatible API powered by your ChatGPT plan citeturn4search0
- Exposes reasoning levels as distinct model IDs via `/v1/models` citeturn4search0turn4search2
- Can enable OpenAI web search tool `--enable-web-search` / `responses_tools: web_search` citeturn4search0turn4search2

---

## MISSION (NON‑NEGOTIABLE)

Build a 24/7, evidence‑first “Spec Factory” that:
1) **finds** the best spec sources (continually),
2) **extracts** all expected fields with citations,
3) **audits** evidence to prevent hallucinations,
4) **improves over time** by learning which domains yield which fields,
5) does this at scale (15–20 products/day) without expensive “high reasoning on everything”.

---

## KEY QUESTION: “CAN CHATMOCK DO GOOGLE SEARCH?”

### Answer: Use ChatMock to **PLAN + RERANK + VERIFY**, but do the actual Google search via API.
For “Google search” you want:
- repeatability (same query → same result list),
- auditable logs (query, provider, results, chosen URLs),
- cost controls and rate controls.

That’s what **Google Programmable Search (Custom Search JSON API)** is for:
- requires `key`, `cx`, `q` and returns JSON results citeturn0search1turn0search5
- query length limit ~2048 characters citeturn0search1
- free tier is limited (e.g., 100 free queries/day; more paid) citeturn0search5

**Important scaling note:** Google’s “Site Restricted JSON API” (the “no daily limit” variant for ≤10 sites) was scheduled to stop serving traffic (Jan 8, 2025) and requires transition planning. citeturn0search0  
So for 24/7 high volume: either pay for Custom Search JSON API, add Bing/SearXNG, or plan for a successor search product.

### Where ChatMock web search fits
ChatMock’s OpenAI web search tool can be enabled (`--enable-web-search`) and invoked via `responses_tools` as `web_search`. citeturn4search0turn4search2  
Use it as:
- a **discovery booster** (seed new domains / niche sources),
- a **cross-check** (“are we missing obvious sources?”),
not as your primary “Google search ledger” because it’s less deterministic and less provider‑explicit.

---

## WHAT THIS PHASE DELIVERS

### Deliverable 13A — Search Frontier DB (Never Repeat, Always Expand)
A persistent, append-only “frontier” that records:
- every query attempted (normalized + hashed),
- every result URL seen (normalized),
- every URL fetched (status, content type, size),
- yield per URL (fields found / confidence),
- cooldown windows (when to retry a domain/page).

**Artifacts**
- `out/_intel/search_frontier/global_frontier.jsonl`
- `out/_intel/search_frontier/product/<product_id>.jsonl`
- `out/_intel/domain_yield/<category>/<domain>.json`
- `out/_intel/field_yield/<category>/<field_key>.json`

**Goal:** Over time, the system builds a memory of “what works” and stops wasting calls.

---

### Deliverable 13B — Uber‑Aggressive Search Orchestrator (Field‑Driven)
Aggressive mode becomes **field-driven** (not “more rounds”).

For each product:
1) Build the **Worklist** = missing expected fields ∪ low-confidence fields ∪ conflicts
2) Generate a **Search Plan** (ChatMock low)
3) Execute searches (Google CSE/Bing/SearXNG) and log everything
4) Rerank results (ChatMock low)
5) Crawl bounded frontier (Playwright + rules)
6) Extract + validate + evidence audit (Phase 12)
7) If critical gaps remain → limited escalation (ChatMock high / xhigh)

**Search Plan JSON**
```jsonc
{
  "product_id": "...",
  "worklist": [{"field":"sensor","priority":"critical"}],
  "queries": [
    {"field":"sensor","q":"<brand> <model> sensor official specification pdf", "weight": 0.9},
    {"field":"sensor","q":"site:<manufacturer> <model> datasheet", "weight": 0.8}
  ],
  "preferred_domains": ["<manufacturer>", "rtings.com", "techpowerup.com"],
  "stop_rules": {"max_queries": 10, "max_new_domains": 3, "diminishing_returns_rounds": 2}
}
```

---

### Deliverable 13C — Multi‑Surface Capture (DOM + APIs + WebSockets + PDFs + Screens)
Uber aggressive means: **capture what sites actually use**.

#### (1) Network APIs & GraphQL/JSON
Already core to your pipeline—Phase 13 strengthens it with:
- service-worker blocking **when network events appear missing** citeturn0search7turn0search4
- WebSocket frame capture (bounded) for sites that stream spec data citeturn0search4turn0search2

#### (2) Readability main-content channel
Add a “clean text” channel from `@mozilla/readability` for token efficiency. citeturn6search1

#### (3) PDF table extraction branch
If the best source is a datasheet/manual PDF:
- parse with `pdfplumber` for text + tables + visual debugging citeturn6search0
- only use vision/OCR when it’s a scanned image PDF.

#### (4) Screenshots (for visual-only spec tables)
Always capture:
- full-page screenshot (compressed)
- element screenshots for “spec blocks” (tables, dl lists, spec sections)
Then Stage 4 (vision) can work reliably.

---

### Deliverable 13D — Sitemap & Robots‑Aware Site Inventory Mode
Before spraying open-web searches, systematically harvest high-yield domains:

- read `robots.txt` for sitemap hints,
- parse nested sitemaps at scale using a streaming parser (handles very large sitemaps efficiently). citeturn5search2turn5search0

This is how you go “far and wide” without re-searching the same domain repeatedly.

---

### Deliverable 13E — Progressive Deepening Schedule (Start Easy, Get Deeper Over Time)
Implement a **difficulty ramp**:

**Tier 0 (Day 0–N): easy pass**
- manufacturer pages + top trusted labs + existing registry
- low model only (ChatMock low) for audit/triage

**Tier 1 (Backfill): missing expected fields**
- targeted search per field
- bounded new domains
- low + limited high escalation

**Tier 2 (Long tail): “eventual completeness”**
- sitemap inventory on manufacturer/distributors
- regional + language variants
- cached manuals / archived PDFs (where allowed)
- periodic re-check for updated spec sheets

**Tier 3 (Hard mode):**
- API/WebSocket capture
- vision extraction (screenshots)
- high reasoning (bounded) only for critical fields

---

### Deliverable 13F — Uber Aggressive QA Loop (Prove It Works)
Every UberAggressive run must produce:
- Search plan + ledger
- Evidence audit report
- Coverage delta report (“what changed vs last attempt”)
- Domain yield updates (“this domain filled these fields”)

---

## MODEL ROUTING (CHATMOCK‑FIRST, BUT SMART)

### Default rule
- 90%+ of LLM work uses **ChatMock `gpt-5-low`**
- `gpt-5-high/xhigh` is only for:
  - vision,
  - persistent critical conflicts,
  - last-mile critical gaps after 2 low passes.

### Why this works
ChatMock exposes reasoning effort as distinct model IDs (easy routing) citeturn4search0turn4search2 and supports web search tool usage when enabled. citeturn4search0turn4search2

---

## SEARCH EXECUTION (GOOGLE + AUDIT)

### Primary: Google Programmable Search (CSE)
Use the Custom Search JSON API:
- endpoint: `https://www.googleapis.com/customsearch/v1`
- required: `key`, `cx`, `q` citeturn0search1turn0search8
- record request/response JSON into your ledger
- dedupe by canonical URL + normalized path + content hash

### Scaling notes
Custom Search JSON API has limited free queries/day; beyond that it’s paid. citeturn0search5  
The site-restricted “no daily limit” variant had a published shutdown notice. citeturn0search0  
Plan accordingly (multi-provider or successor product).

---

## COMPLIANCE & SAFETY (NON‑NEGOTIABLE)
Uber aggressive must still:
- respect robots / ToS constraints
- avoid bypassing paywalls/captchas
- treat web content as data (not instructions) to prevent prompt injection

---

## ACCEPTANCE CRITERIA (PHASE 13)

1) **Search frontier prevents repetition**: identical query+product doesn’t rerun within cooldown unless forced.  
2) **Coverage climbs over time**: expected-field unknown rate decreases week-over-week for the same corpus.  
3) **Evidence audit is always-on**: no non‑UNK value ships without citations and audit pass.  
4) **Multi-surface capture works**: service-worker block option + WebSocket capture available for hard domains. citeturn0search4turn0search7  
5) **Sitemap mode works** for top domains, using a streaming parser and robots hints. citeturn5search2  
6) **PDF tables are extracted** using a dedicated PDF pipeline. citeturn6search0  
7) **Model efficiency**: ≥85% of Cortex calls are `gpt-5-low`; deep tier bounded. citeturn4search0  
8) **Throughput remains 24/7 stable**: queue progresses even if search providers or ChatMock temporarily fail (fallback + requeue).

---

## OPERATOR CONTROLS (RECOMMENDED FLAGS)

- `--mode uber_aggressive`
- `--profile thorough`
- `--max-new-domains 3`
- `--max-search-queries 10`
- `--max-deep-fields 12`
- `--cooldown-hours 72`
- `--sitemap-inventory manufacturer_only`

---

## QUICK START (CHATMOCK SETTINGS FOR UBER AGGRESSIVE)

Run ChatMock with:
- exposed reasoning tiers (so the router can choose low vs high)
- optional OpenAI web search tool enabled

ChatMock supports:
- `/v1` base URL for OpenAI-compatible clients citeturn4search0
- `--enable-web-search` and `responses_tools: web_search` citeturn4search0turn4search2
- `--expose-reasoning-models` for `gpt-5-low/high` selectors citeturn4search0turn4search2
