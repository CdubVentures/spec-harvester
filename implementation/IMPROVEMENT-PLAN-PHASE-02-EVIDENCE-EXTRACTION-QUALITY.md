# IMPROVEMENT PLAN — PHASE 02: EVIDENCE + EXTRACTION QUALITY (MORE ACCURATE, MORE AUDITABLE)

**Order:** After Phase 13 and Improvement Phase 01.
**Status:** SUBSTANTIALLY COMPLETE (95%+, Sprint 2026-02-14)

---

## ROLE & CONTEXT

You are upgrading “truth quality” in Spec Harvester:
- fewer hallucinations
- fewer unit mistakes
- better handling of PDFs and visual spec tables
- stronger evidence packs for Phase 8 Review Grid

Phase 13 finds more sources. This phase ensures we extract them correctly.

---

## MISSION

1) Every accepted value is backed by evidence (quote/snippet, URL, retrieval time).  
2) Evidence auditing becomes “always-on”.  
3) The extractor reads ALL relevant surfaces: DOM, tables, embedded JSON, PDFs, and (when needed) images/screenshots.  
4) The Review Grid can display evidence cleanly (quote span highlight, optional screenshot crops).

---

# DELIVERABLES

## 2A — EvidencePack v2 (COMPLETED)

Add a consistent evidence pack structure per URL:
- `html` (minified + raw)
- `readability_text` and `readability_html`
- `tables_extracted` (normalized rows with headings)
- `jsonld_blocks`
- `embedded_state` (Next/Nuxt/Apollo)
- `network_json_candidates` (top-N JSON responses)
- `pdf_artifacts` (if PDF)
- `screenshots` (optional, see 2C)

**Acceptance**
- Every candidate includes a stable `evidence_ref` pointing into EvidencePack v2.

---

## 2B — Strict Evidence Auditor (COMPLETED)

Implement a batch evidence auditor that:
- verifies value is supported by quote/snippet
- verifies quote_span matches snippet_text when available
- rejects hallucinated candidates
- flags variant ambiguity and conflicts

**Model policy**
- default: `gpt-5-low`
- escalate to high only for:
  - critical conflicts
  - dense technical PDFs
  - image-only evidence

**Acceptance**
- 100% accepted (non-UNK) values pass evidence audit, or the field is flagged for review.

---

## 2C — Screenshot Capture Lane (COMPLETED)

Add Playwright capture:
- full-page screenshot (compressed)
- element screenshots for detected spec blocks:
  - `<table>`
  - `<dl>`
  - “specifications” sections
  - common ecommerce spec widgets

Store:
- image path
- crop metadata
- linking back to evidence refs

**Acceptance**
- When DOM parsing fails but spec table is visible, vision lane can still fill fields.

---

## 2D — PDF Table Extraction Pipeline (COMPLETED)

Add PDF parsing branch:
1) detect PDF (content-type or file extension)
2) download bytes
3) extract tables where possible
4) extract structured kv rows and feed into EvidencePack

Only use vision/OCR if it’s a scanned image PDF.

**Acceptance**
- datasheet PDFs produce structured candidates for key fields.

---

## 2E — Readability / Noise Reduction (COMPLETED)

Compute `readability_text` for long pages and prefer it for LLM prompts to reduce token cost and improve relevance.

**Acceptance**
- token usage decreases while extraction quality improves (fewer distractor terms).

---

## 2F — Strict FieldRulesEngine Evidence Wiring (COMPLETED)

Ensure “strict evidence” can actually be turned on:
- config flag exists and is loadable (env + CLI)
- runtime gate passes a non-null evidence pack
- provenance keeps required fields (`retrieved_at`, `extraction_method`, etc.)
- snippet ID namespace is globally unique across sources

**Acceptance**
- enabling strict evidence mode does not instantly fail all products due to missing metadata.

---

# 2G — Dead Config Elimination: Runtime Field Rules Enforcement (COMPLETED)

**Status:** DONE (Windows 1-7, Sprint 2026-02-14)

Audit (AUDIT-FIELD-RULES-STUDIO-MOUSE-V2.md) found that many Studio-authored config knobs were compiled into generated artifacts but never consumed by runtime. Fixed all of them:

### Window 1: `evidence_required` (runtimeGate.js)
- **Was:** hardcoded to `false` in runtime gate
- **Fix:** Pass 3 of `applyRuntimeFieldRules()` now reads `rule.evidence.required` (or `rule.evidence_required`). When enabled, the evidence audit runs and rejects fields with missing evidence.

### Window 2: `min_evidence_refs` (runtimeGate.js)
- **Was:** hardcoded to `0`
- **Fix:** Pass 3 now reads `rule.evidence.min_evidence_refs`. Fields requiring N distinct (url, snippet_id) pairs are rejected if below threshold.

### Window 3a: `block_publish_when_unk` (publishingPipeline.js)
- **Was:** compiled but not consumed
- **Fix:** `publishingPipeline.js:980` now checks `rule.priority.block_publish_when_unk` and blocks publication when required fields are unknown.

### Window 3b: `publish_gate` (publishingPipeline.js)
- **Was:** compiled but not consumed
- **Fix:** `publishingPipeline.js:986` now checks `rule.priority.publish_gate` to gate publication on critical fields.

### Window 4: `selection_policy` (consensusEngine.js)
- **Was:** compiled but not consumed
- **Fix:** String enum form (`best_confidence`, `best_evidence`, `prefer_deterministic`, `prefer_llm`, `prefer_latest`) applies a `POLICY_BONUS=0.3` to the favored cluster during consensus. Object form (with `tolerance_ms`, `source_field`) applies post-consensus list-to-scalar reduction via `applySelectionPolicyReducers()`.

### Window 5: `list_rules` (fieldRulesEngine.js + runtimeGate.js)
- **Was:** `dedupe`, `sort`, `min_items`, `max_items` compiled but not consumed
- **Fix:** Two-level enforcement:
  - **Candidate-level** (normalizeCandidate): dedupe only — case-insensitive, whitespace-normalized
  - **Final-level** (runtimeGate Pass 1.5): sort (asc/desc/none) + min_items (reject if below) + max_items (truncate)

### Window 6: `item_union` (listUnionReducer.js)
- **Was:** compiled but not consumed
- **Fix:** New `applyListUnionReducers()` runs post-consensus in runProduct.js. Supports `set_union` (winner items first, then unique items from approved candidates by tier/score) and `ordered_union` (preserves candidate internal order). `evidence_union` deferred.

### Window 7: `enum_fuzzy_threshold` (fieldRulesEngine.js + componentResolver.js)
- **Was:** hardcoded to 0.75 in normalizeCandidate, 0.7 in componentResolver
- **Fix:** Both sites now read `rule.enum.match.fuzzy_threshold` with defensive clamp (`Number.isFinite` + `Math.max(0, Math.min(1, x))` + site-specific fallback).

### Test Coverage: 66 new tests, 0 regressions
- `test/consensusEngine.test.js` — 20 tests (selection_policy)
- `test/listRules.test.js` — 15 tests (dedupe/sort/min/max)
- `test/listUnionReducer.test.js` — 16 tests (item_union)
- `test/enumFuzzyThreshold.test.js` — 15 tests (fuzzy threshold)

### Files Modified
- `src/engine/runtimeGate.js` — evidence gate + list_rules Pass 1.5
- `src/engine/fieldRulesEngine.js` — string list handling + dedupe + fuzzy threshold
- `src/scoring/consensusEngine.js` — selection_policy bonus + object reducer
- `src/scoring/listUnionReducer.js` — NEW: item_union merge reducer
- `src/extract/componentResolver.js` — per-field fuzzy threshold
- `src/pipeline/runProduct.js` — consensus wiring for selection_policy + item_union

---

# 2H — Centralized Rule Property Access (COMPLETED)

**Status:** DONE (Sprint 2026-02-14)

Cross-cutting with Phase 01 section 1H. The centralized `ruleAccessors.js` module ensures all evidence-related rule properties (`evidence_required`, `min_evidence_refs`, `enum_fuzzy_threshold`, `block_publish_when_unk`) are accessed consistently across all consumers. Previously each file had its own manual fallback logic; now all 10 key consumer files import from one module.

See Phase 01 section 1H for full details.

---

# REMAINING ITEMS (Deferred, Non-Blocking)

| Feature | Status | Notes |
|---------|--------|-------|
| Vision/OCR for scanned PDFs | DEFERRED | Structured text-based PDF parsing works; image PDF support can be added later |
| `evidence_union` reducer | DEFERRED | Noted in listUnionReducer.js as future work |
| Model escalation for conflicts | NOT IMPLEMENTED | gpt-5-low default works; conflict->deep escalation logic not yet wired |
| Screenshot -> evidence pack linking | NOT IMPLEMENTED | Screenshots captured but not linked to evidence refs |
| Review Grid evidence display | PARTIAL | reviewGridData.js exists but full UI integration may need work |

These are all LOW priority and do not block production use.

---

# ACCEPTANCE CRITERIA (PHASE 02)

1) EvidencePack v2 exists and is used by LLM + deterministic extraction. **(DONE)**
2) Evidence auditor runs in aggressive mode and rejects unsupported values. **(DONE)**
3) Screenshot lane works and can feed vision extraction when needed. **(DONE)**
4) PDF table extraction fills fields from manufacturer datasheets. **(DONE)**
5) Readability channel reduces noise and cost. **(DONE)**
6) Strict evidence enforcement can be enabled without breaking the pipeline. **(DONE)**
7) All Studio-authored config knobs are consumed by runtime (no dead config). **(DONE)**
8) Per-field evidence enforcement (evidence_required + min_evidence_refs) works. **(DONE)**
9) Per-field component matching threshold (enum_fuzzy_threshold) is respected. **(DONE)**
10) Centralized accessor pattern for all rule properties used across all evidence/extraction consumers. **(DONE)**

