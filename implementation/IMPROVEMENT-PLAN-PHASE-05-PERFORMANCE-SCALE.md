# IMPROVEMENT PLAN — PHASE 05: PERFORMANCE + SCALE (15–20/DAY, LOW COST, 24/7 STABLE)

**Order:** After Phase 13 + Improvement Phases 01–04.

---

## ROLE & CONTEXT

You are optimizing throughput and cost without sacrificing accuracy.

The system must:
- run 24/7
- stay responsive even under heavy search
- keep deep model usage bounded
- prevent runaway crawling/search loops

---

## MISSION

1) Improve throughput: 15–20 publishable products/day.  
2) Reduce wasted work: fewer redundant fetches, fewer repeated searches.  
3) Keep ChatMock utilization efficient: low tier dominates, high tier is bounded.  
4) Introduce caching and concurrency controls to make everything stable.

---

# DELIVERABLES

## 5A — Worker Pools + Concurrency Limits

Separate concurrency pools:
- crawl/fetch pool (Playwright)
- extraction pool
- LLM pool (Gemini/DeepSeek)
- Cortex pool (ChatMock)

Respect ChatMock scarcity:
- if ChatMock runs with request queue, cap concurrency at 1–2

---

## 5B — Caching: URL Content Hash + Evidence Reuse

Add per-URL caching:
- if content hash unchanged, reuse evidence pack
- use ETag/Last-Modified when available
- avoid re-running extraction when nothing changed

---

## 5C — Token Efficiency: Dossier Builder

Before sending to any model:
- rank evidence snippets by relevance to target fields
- cap payload size
- prefer readability_text and tables over raw HTML

This reduces cost and improves quality.

---

## 5D — Async Deep Jobs (High Tier)

For deep tasks (vision, xhigh reasoning):
- use async submission/poll pattern (so the harvester isn’t blocked by long inference)
- timebox per product and per field

---

## 5E — Metrics + Budget Enforcement

Enforce budgets:
- max urls per product
- max queries per product
- max time per product
- max high-tier calls per product

Expose metrics:
- products/hour
- cost/product
- urls/product
- high-tier utilization %

---

# ACCEPTANCE CRITERIA (PHASE 05)

1) Stable throughput: 15–20/day with predictable runtimes.  
2) High-tier usage bounded by config; low tier ≥85% by call count.  
3) Evidence reuse reduces fetch and token usage without reducing accuracy.  
4) Deep tasks do not block the main queue (async pattern).  
5) Metrics allow daily optimization decisions (not guessing).

