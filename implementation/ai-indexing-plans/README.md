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


## Files in this bundle
- `PHASE-XX-*.md`: one prompt/spec per phase (0â€“11).
- `ADDENDUM-field-studio-overlooked-items.md`: phase-mapped Field Studio wiring that is high value for accuracy and optimization.
- `sql/schema_v1.sql`: SQLite DDL for EvidenceIndexDb (Phase 6) + supporting tables.
- `docker/docker-compose.observability.yml`: Prometheus + Grafana + Loki + Tempo + (optional) SearXNG.
- `searxng/settings.yml`: baseline SearXNG config tuned for spec discovery.
- `prometheus/prometheus.yml`: scrape config (example).
- `prometheus/alerts.indexlab.yml`: alert rules focused on accuracy + reliability.
- `grafana/dashboards/*.json`: starter dashboards (IndexLab + Extraction + Sources).

Generated: 2026-02-18
