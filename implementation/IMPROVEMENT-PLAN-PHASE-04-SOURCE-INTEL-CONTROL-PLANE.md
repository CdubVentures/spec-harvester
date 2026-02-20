# IMPROVEMENT PLAN — PHASE 04: SOURCE INTEL + INTERNAL INDEX + CONTROL PLANE WORKFLOWS

**Order:** After Phase 13 + Improvement Phases 01–03.

---

## ROLE & CONTEXT

You are upgrading the system from “search the web” to “learn the web.”

This phase makes the harvester:
- faster (less searching)
- more accurate (better sources)
- more stable (less dead links)
- more scalable (internal-first retrieval)

---

## MISSION

1) Build a field-aware source intelligence layer (domain × field yield).  
2) Automate suggestions for source promotion/demotion and new domains.  
3) Build an internal retrieval index of evidence snippets and successful URLs to reduce repeated searching.  
4) Add approval workflows so updates are curated (not self-mutating).

---

# DELIVERABLES

## 4A — Domain × Field Yield Matrix

From frontier + run outputs, compute:
- `out/_intel/domain_field_matrix/<category>.json`

Includes:
- success rate for each field
- conflict rate
- average confidence
- freshness hints

Use it to:
- prioritize sources in reranking
- recommend which domains to inventory via sitemap

---

## 4B — Source Promotion/Demotion Suggestions (curated)

Write suggestions (NOT auto-applied):
- `_source_intel/<category>/promotion_suggestions.json`
- `_source_intel/<category>/demotion_suggestions.json`
- `_sources/candidates/<category>/<date>.json`

Add CLI:
- `sources list-candidates`
- `sources approve --domain ...`
- `sources block --domain ...`

---

## 4C — Internal Retrieval Index (internal-first mode)

Build an internal store of:
- canonical product URLs
- evidence snippets (with hashes)
- extracted key/value rows
- best sources per field

Start simple:
- BM25 index (SQLite FTS or similar)
- then optionally embeddings later

Use it in discovery:
1) query internal index first
2) only go to web search if internal yields insufficient coverage

---

## 4D — Sitemap Inventory Mode (top domains)

For high-yield domains:
- fetch robots.txt → find sitemap
- parse sitemap urls
- collect candidate product/spec pages
- add to frontier with “inventory” origin

---

# ACCEPTANCE CRITERIA (PHASE 04)

1) Domain-field matrix exists and is used by reranker.  
2) Promotion/demotion suggestions are generated and reviewable.  
3) Internal-first retrieval reduces external search volume over time.  
4) Sitemap inventory populates frontier with high-quality candidate URLs.  
5) Source updates remain curated and auditable.

