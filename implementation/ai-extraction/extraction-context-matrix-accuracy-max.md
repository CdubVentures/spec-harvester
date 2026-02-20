# Extraction Context Matrix (Accuracy-Max)

This document describes how to build an **Extraction Context Matrix** that is:
- **Accuracy-first** (cost is not a constraint)
- Consistent across **all categories / items / fields**
- Compatible with your current runtime flow (evidence → extraction → consensus → validate → runtime gate → component review)
- Designed to support **parallel crawl + LLM extraction** without sacrificing evidence quality.

It is aligned with the “Universal Send Policy” and “Prime Sources” definitions in `ai-source-review.md`. fileciteturn0file0

---

## Core idea

The Extraction Context Matrix is **not** just “what gets sent to the LLM”.
It is the contract that tells your pipeline:

1) **Which Field Studio artifacts are relevant** for each field + route
2) **How to normalize them into a stable prompt payload** (contracts/policies)
3) **When to trigger extraction** (based on evidence availability + missing/confidence)
4) **How to keep prompts small but more accurate**, even when cost is unlimited

**Important:** Unlimited $ does *not* mean “send everything”.
It means:
- collect more evidence (more sources, deeper indexing),
- do more verification (more passes, ensembles),
- but still **select compact, high-signal context** (prime sources) to avoid confusion.

---

## Inputs (what you already have)

### Field Studio artifacts (category-generated)
These map directly to prompt inputs:

- `field_rules.json` → contract + priority + parse + evidence settings
- `ui_field_catalog.json` → group/section/ordering + display labels (optional but useful)
- `anchors.json` → per-field synonyms/cues
- `known_values.json` → per-field enum expansion
- component DBs → canonical component entity sets

### Runtime state (per item)
- current best value
- confidence
- evidence count + source/tier distribution
- conflicts / disagreement
- publish-gate status

### Route policy (Matrix #3 you’re confident in)
- High-stakes route conditions (required/critical/identity, judge/planner, effort>=7, min_evidence_refs>=2)
- Standard route otherwise
- Prime sources payload for high-stakes modes fileciteturn0file0

---

## What the Extraction Context Matrix controls

### A) The payload shape (what the LLM sees)
You want a stable payload like:

- `targetFields[]`
- `contracts.{field}` (normalized contract + policy)
- `enumOptions.{field}[]` (if any)
- `componentRefs.{field}` (if component_ref)
- `anchors.{field}[]` (if any)
- `golden_examples[]` (small cap)
- `references[]` and `snippets[]` (evidence pack)
- `prime_sources.{field}[]` (high-stakes only)
- `state.{field}` (repair passes only)

### B) Per-field “format requirements”
For every field, the LLM should be able to answer:
- what type/shape should I output?
- what unit? what rounding?
- what is allowed/forbidden (enum/range/list rules)?
- what counts as valid evidence?

### C) Per-field “evidence requirements”
For every field, the LLM should see:
- evidence required (true/false)
- min evidence refs
- tier preference (manufacturer/official vs third-party)
- (optional) min distinct sources if you enforce independence

---

## Accuracy-max send policy

### Always send (for every field in targetFields)
These are small and high-signal:

- `data_type`, `output_shape`
- `required_level`
- `description / tooltip`
- `unit` (if set)
- `evidence.required` and `evidence.min_refs`
- `enumOptions` (if any; capped)
- `component known_entities` (if component_ref; capped / prefiltered)

### Send when present (recommended)
- range + rounding
- parse template **as template ID / instructions**, not raw regex
- list rules (only for list fields)
- group/section path (helps disambiguate similar keys)

### High-stakes only (recommended)
- `prime_sources.{field}` (top evidence across sources from consensus/provenance)
- `state.{field}` (current value/confidence/evidence_count) for repair passes
- full constraints slices (especially component constraints)

This matches your “prime sources” definition and avoids prompt bloat. fileciteturn0file0

---

## Parallel crawl + extraction (how to do it without losing accuracy)

### Problem with a naive approach
If you wait for all crawling/indexing to finish, you delay the whole run.
If you extract from the first page you see, you risk:
- wrong identity (variant mismatch),
- missing high-stakes evidence (min refs not satisfied),
- extra rework later.

### Recommended orchestration (job graph)
Run these concurrently with bounded queues:

1) **Search** (Google + SearXNG + url_memory)
2) **Fetch** URLs in parallel (per-host limits + HEAD/redirect first)
3) **Parse** (HTML/PDF/table extraction) in parallel
4) **EvidencePack** build immediately after parse
5) **Extraction pass 1** runs as soon as a source evidence pack is ready
6) **Consensus** runs incrementally as candidates arrive
7) If high-stakes fields remain missing/low-confidence:
   - **Extraction pass 2 (repair)** uses `prime_sources_by_field` across all sources

### Triggering logic (accuracy-max)
- For **identity + publish-gated** fields: prefer waiting until ≥2 good sources are available *or* run pass-1 but treat results as provisional until min refs satisfied.
- For lower-stakes fields: run pass-1 as soon as evidence exists.

### Early stop
Even with unlimited cost, you still want to stop doing useless work:
- if publish gate passes and required coverage meets threshold, cancel remaining low-priority fetches and optional extraction calls.

---

## How this improves over time (without adding prompt noise)

Accuracy climbs as you persist:

- `url_memory` (canonical spec/manual URLs)
- `url_health` (404/410 cooldown + redirect tracking)
- `domain_field_yield` (which sites provide which fields)
- `field_anchors` (synonyms/value patterns that work)

These make future EvidencePacks cleaner → extraction more reliable.

---

## Implementation notes for your current code

Your current extraction payload already sends:
- `contracts` (description/type/shape/required_level/unit/unknown_reason/guidance)
- `enumOptions` (merged from rules + known_values)
- `componentRefs` (known_entities capped)
- `anchors`, `golden_examples`, `references`, `snippets`

The main gaps for an “Extraction Context Matrix” are:
- explicit evidence policy fields in `contracts.{field}.evidence`
- parse_template in a structured form (template ID + examples)
- range/rounding/list_rules
- (optional) constraints slice

Those should be added to `buildPromptFieldContracts(...)` and controlled by the matrix send rules. fileciteturn0file0

---

## Deliverables

- `extraction-context-matrix-accuracy-max.xlsx`
  - Sheet **Context Matrix**: what to send per field class + route level
  - Sheet **Trigger & Parallel**: how to parallelize crawl/LLM while staying evidence-first
  - Sheet **Evidence Selection**: prime snippet rules
  - Sheet **Payload Skeleton**: stable JSON payload keys

