# IndexLab Critical Path — Maximum Accuracy, Performance, Optimization

**Created:** 2026-02-20
**Objective:** Convert the IndexLab from a single-pass pipeline into a bounded convergence loop that hits 95%+ accuracy on technical specs.

---

## Diagnosis

The IndexLab architecture is correct. The NeedSet -> Search -> Fetch -> Extract -> Consensus pipeline is the right model for evidence-first spec harvesting. But the system has a critical gap: **it runs once and stops**. NeedSet is computed as a read-only diagnostic at the end of each run — nothing feeds it back into discovery.

A single-pass pipeline can hit ~85-90% on easy fields (weight, DPI, sensor name) because those appear on every manufacturer page. It cannot hit 95% on deep fields (click_latency, encoder_brand, mcu_chip, sensor_latency) that require specific lab sources or teardown data. Targeted re-discovery is the mechanism that closes this gap.

Secondary problem: `runProduct.js` is a 5,249-line god function with 77 internal functions and a single export. Building the convergence loop on top of this monolith is engineering suicide. Minimum decomposition must happen first.

---

## Critical Path (6 Sprints)

### Sprint 1: Minimum Viable Decomposition
**Goal:** Extract just enough from runProduct.js to create a clean orchestrator seam.

| Order | Item | File | Action |
|-------|------|------|--------|
| 1 | Identity helpers | src/utils/identityNormalize.js | Extract 3 duplicated functions, TDD first |
| 2 | RunOrchestrator shell | src/pipeline/runOrchestrator.js | Create class with buildInitialRoundContext + dependency-injected runProductFn, TDD first |
| 3 | Fetch/parse helpers | src/pipeline/fetchParseWorker.js | Extract 9 inline host-budget helpers, TDD first |

**Exit criteria:** All existing tests green. RunOrchestrator can invoke runProduct for round 0 and return results. Three new test files with behavioral coverage.

**Why this order:** Items 1-3 are the minimum seam needed for Phase 09. Items 4-5 from the old plan (consensus + learning export extraction) are deferred — they don't block the convergence loop.

---

### Sprint 2: Phase 09 — Convergence Loop (THE accuracy unlock)
**Goal:** NeedSet drives multi-round targeted discovery. Runs converge and terminate deterministically.

| Order | Item | Action |
|-------|------|--------|
| 4 | Phase 09 TDD | Write failing tests for round controller: round-0 bootstrap, round-N targeted dispatch, each stop condition independently, NeedSet-driven query dispatch |
| 5 | Round controller | Implement explicit rounds in RunOrchestrator. Round 0 bootstraps from url_memory + high-precision search. Round 1..N computes NeedSet then dispatches targeted discovery for remaining deficit fields only |
| 6 | Stop conditions | Halt when: (a) all identity+required fields meet confidence threshold AND evidence policy satisfied AND conflicts resolved, OR (b) max_rounds reached, OR (c) marginal_yield is zero. Each condition independently testable with logged stop_reason |
| 7 | Targeted dispatch | NeedSet tier_deficit triggers Tier-1 doc_hints first (manual/spec/support). Conflict triggers teardown/lab review hints. Hard budget cap on queries and fetched URLs per round |
| 8 | Identity gate in extraction | Enforce multi-product identity gate on every evidence unit in extraction context (Phase 08 item). Every evidence row must carry target_match_passed. Reject candidates from wrong-product pages. **Elevated from old position 40 because convergence loop re-extracts across rounds — wrong-product leakage compounds** |
| 9 | Round events | Emit round_started, round_completed, convergence_stop with NeedSet size, confidence delta, escalation reason, stop reason, fetch/LLM cost per round |
| 10 | Key validation per round | Validate runtime keys against compiled contract before scoring. Apply key_migrations mappings. Reject unknown keys with logged metric |

**Exit criteria:** Run one product known to have missing deep fields. NeedSet shrinks across rounds. Stop reason is logged. Identity deficits resolve before deep-field churn. Total rounds are bounded (max 5 default).

---

### Sprint 3: Evidence Infrastructure (make convergence efficient)
**Goal:** Replace brute-force snippet iteration with indexed retrieval. Make the convergence loop fast.

| Order | Item | Action |
|-------|------|--------|
| 11 | Phase 06A TDD | Write failing tests for EvidenceIndexDb: document insert, chunk insert, FTS query, snippet_id generation, dedupe hit detection |
| 12 | Core schema | Implement src/index/evidenceIndexDb.js with SQLite lifecycle, documents/chunks/facts tables, write APIs. No FTS yet |
| 13 | FTS | Implement FTS5 virtual table over chunks and facts with ranked query API. Replace LIKE fallback in Phase 07 retriever |
| 14 | Stable snippet_ids | Anchored to content_hash + parser_version + chunker_version. Deterministic IDs that survive re-runs on unchanged content |
| 15 | Phase 06B durable queue | SQLite-backed persistence for automation queue. Phase 09 convergence dispatches to this queue — jobs must survive restart |
| 16 | Consensus LLM weight tuning | Raise llm_extract score from 0.2 to ~0.6 for Tier-1 sources. TDD: prove Tier-1 LLM beats Tier-3 deterministic on conflict |
| 17 | Structured output parser | Normalize non-JSON wrappers (markdown fences, reasoning prefix) across all LLM providers before extraction parsing. Prevents silent extraction failures |

**Exit criteria:** Phase 07 retriever uses FTS instead of fallback pool (evidence_pool_fallback_used: false). Snippet IDs are stable across re-runs. Automation queue persists across restart.

---

### Sprint 4: Retrieval + Accuracy Hardening
**Goal:** Per-field retrieval precision. Identity safety. Extraction tracing for debugging.

| Order | Item | Action |
|-------|------|--------|
| 18 | Per-field tier_preference | Apply compiled field rules tier_preference to retrieval ranking weights. Replace fixed global tier weights (tier1=3, tier2=2, tier3=1) |
| 19 | Hard identity filter | Suppress snippets from identity-unsafe sources for critical and identity-level fields when identity status is unlocked or conflict |
| 20 | Retrieval trace objects | Persist query, scoring breakdown, selected vs rejected snippets per field. Required for debugging accuracy failures |
| 21 | Miss diagnostics | Per-field miss reason (no_anchor, tier_deficit, identity_mismatch) surfaced in GUI with actionable operator hints |
| 22 | Lane-level tracing | Persist full prompt assembly and raw LLM response per extraction batch in run artifacts. Non-optional for 95% accuracy debugging |
| 23 | SearchProfile upgrade | LLM planner returns full structured SearchProfile object (not flat strings). Unlocks field_target_queries for Phase 09 targeted dispatch |
| 24 | SERP applicability fields | Add identity_match_level, variant_guard_hit, multi_model_hint to SERP candidate rows. Convergence loop needs this to filter wrong-model candidates |

**Exit criteria:** Per-field retrieval traces exist for every extracted field. Identity-unsafe snippets cannot become prime sources. Accuracy on golden-file products improves measurably vs Sprint 2 baseline.

---

### Sprint 5: Learning + Polish
**Goal:** Cross-product compounding. Observability completeness.

| Order | Item | Action |
|-------|------|--------|
| 25 | Phase 10 TDD | Write failing tests for LearningUpdater acceptance gates: reject when confidence below threshold, refs below min_refs, field not accepted, tier criteria not met |
| 26 | LearningUpdater | Implement strict acceptance gates. Only update stores when field status=accepted, confidence>=0.85, refs>=min_refs, tier met |
| 27 | Four learning stores | component_lexicon, field_anchors, url_memory, domain_field_yield. Each with decay/expiration |
| 28 | Studio suggestions | Emit suggestion artifacts (not in-place mutation). Propose first, require explicit acceptance |
| 29 | Evidence freshness decay | Timestamp-based confidence decay for stale evidence rows. Wire into NeedSet effective_confidence |
| 30 | Dedupe outcome events | Emit dedupe_hit, reuse_mode, indexed_new into event stream. Prove index reuses content correctly |
| 31 | Phase 00 event audit | Audit every spec event against runtimeBridge.js. Add missing events/fields. Confirm run.json metadata |
| 32 | Remaining runProduct.js cleanup | Extract consensusPhase.js + learningExportPhase.js. Remove unused imports. Target <800 LOC orchestration |

**Exit criteria:** Run two similar products in sequence. Second run shows fewer external searches and faster Tier-1 hits. Learning Feed GUI proves improvements.

---

### Sprint 6: Scale + Throughput
**Goal:** Multi-product batch execution. Worker controls. 15-20 products/day.

| Order | Item | Action |
|-------|------|--------|
| 33 | Multi-pool scheduler | Per-lane worker queues (search/fetch/parse/llm) with per-host in-flight caps |
| 34 | Dual-source resilience | Fallback fetch ladder (Crawlee -> Playwright -> Http). Bounded retry envelope with per-attempt reason codes |
| 35 | Phase 11 worker controls | WORKERS_SEARCH/FETCH/PARSE/LLM config. TDD for pool sizing. Workers GUI panel |
| 36 | Phase 12 batch state machine | Durable SQLite queue. TDD for state transitions. Resume after restart |
| 37 | Batch lifecycle APIs | POST plan/start/pause/resume/stop. GET status/items. Stable IDs |
| 38 | Batch GUI | Product grid with bulk selection. Brand priority controls. Live status counters |

**Exit criteria:** 15-20 products/day throughput. Batch runs survive restart. Workers GUI shows per-pool metrics.

---

### Deferred (not blocking accuracy or throughput)

| Item | Why Deferred |
|------|-------------|
| Parsing 07 OCR preprocess | Affects <5% of evidence surfaces for peripherals |
| Parsing 08 image OCR pipeline | Depends on Phase 08B visual assets. Low yield vs effort |
| Parsing 09 chart/graph extraction | Network payloads cover most cases. SVG/vision is niche |
| Parsing 10 office doc ingestion | Rare for gaming peripherals |
| Parsing 11 visual capture control-plane | Screenshots work. Full control-plane is optimization |
| Phase 08B visual asset capture proof | Visual evidence augments but doesn't replace text evidence |
| Phase 04 repair-to-06B handoff | Repair works in convergence loop via targeted dispatch |
| Phase 04 domain checklist hardening | Dashboard polish, not accuracy blocker |
| Phase 03 triage score decomposition | Auditability improvement, not accuracy blocker |
| Phase 11 knob governance | Useful but deferred until worker controls are stable |

---

## Key Architectural Decisions

### 1. Convergence loop wraps runProduct, doesn't replace it
RunOrchestrator calls runProduct per round with an evolving roundContext. runProduct remains the single-round executor. This avoids rewriting the entire pipeline.

### 2. Identity gate is Sprint 2, not Sprint 4
The old plan had identity gate at position 40 (Sprint 4 territory). In a convergence loop, wrong-product evidence compounds across rounds — a single bad extraction in round 1 poisons NeedSet calculations for rounds 2-5. Identity gate must ship with the convergence loop.

### 3. Phase 06A FTS is Sprint 3, not Sprint 2
The convergence loop can work with the brute-force fallback pool initially. It's slower and less precise, but functional. FTS makes it efficient, not possible. This avoids blocking Sprint 2 on a database schema project.

### 4. Phase 06B durable queue moves to Sprint 3
In Sprint 2, the convergence loop dispatches work synchronously within the same process. Durable queue persistence matters when runs span restarts, which becomes important for batch execution (Sprint 6). Sprint 3 is early enough.

### 5. Learning (Phase 10) is Sprint 5, not Sprint 3
Learning without a working convergence loop compounds bad signals. The loop must prove correct first, then learning can safely compound across products.

---

## Metrics to Track

| Metric | Sprint 2 Target | Sprint 4 Target | Sprint 6 Target |
|--------|----------------|----------------|----------------|
| Required field accuracy | 92% | 96% | 97% |
| Critical field accuracy | 88% | 94% | 95% |
| Expected field accuracy | 80% | 88% | 90% |
| Avg rounds per product | 2.5 | 2.0 | 1.8 |
| Avg cost per product | $0.25 | $0.18 | $0.15 |
| Products per day | 5-8 | 10-15 | 15-20 |
| Evidence pool fallback rate | 100% | 0% | 0% |
| Wrong-product extraction rate | unknown | <2% | <1% |
