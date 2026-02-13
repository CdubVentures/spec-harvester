# PHASE 12 OF 12 — AGGRESSIVE MODE EXTRACTION (SMART ROUTING: GPT‑5 LOW DEFAULT, HIGH ONLY FOR HARD CASES)

## ROLE & CONTEXT

You are a senior ML‑pipeline engineer specializing in **high‑accuracy structured extraction**.

Phase 11 gave you the “Cortex sidecar” (ChatMock) and a routing layer. Phase 12 upgrades extraction to a **smart cascade**:

- **Deterministic + Gemini** do the bulk fast pass.
- **GPT‑5 Low via ChatMock** does the “smart 90%” of aggressive mode:
  - evidence audit
  - DOM structural extraction
  - conflict triage
  - targeted gap-fill from existing evidence
- **GPT‑5 High (“5.2 High” slot)** is used only for:
  - vision (screenshots)
  - deep conflict resolution on **critical** fields
  - web search execution / synthesis for **critical** gaps

This keeps aggressive mode **fast and accurate**, without flooding the deep model.

---

## MISSION (NON‑NEGOTIABLE)

Maximize accuracy and evidence integrity while staying performant 24/7:

1. **Every accepted value must be evidence‑backed** (URL + snippet + quote + quote_span where available).
2. Use **fast models for 90%+** of tasks; use high reasoning only when necessary.
3. Keep a **search ledger** so we never repeat the same exploration forever.
4. Always produce a ProductRecord that is auditable and review‑ready.

---

## WHAT THIS PHASE DELIVERS

### Deliverable 12A: The Smart Four‑Stage Extraction Cascade

```
STAGE 1: DETERMINISTIC PARSING (Phase 5)
  ↓ gaps remain
STAGE 2: FAST LLM EXTRACTION via Gemini 2.5 Flash
  ↓ gaps/conflicts remain
STAGE 3: CORTEX FAST PASS via ChatMock GPT‑5 Low
         (evidence audit + DOM extraction + conflict triage + targeted gap fill)
  ↓ critical gaps remain
STAGE 4: CORTEX DEEP ESCALATION via ChatMock GPT‑5 High
         (vision + deep reasoning + web search for critical gaps)
```

### Deliverable 12B: Evidence Audit Layer (NEW, ALWAYS‑ON)

A strict evidence auditor that:
- verifies that each candidate value is supported by the quoted snippet/span
- rejects hallucinated candidates
- normalizes units/format *only if supported by evidence*
- runs after Stage 2, after Stage 3, and after Stage 4

**Default model:** GPT‑5 Low

### Deliverable 12C: Search Indexing + Frontier Tracking (ALWAYS‑ON)

Persistent state that tracks:
- every query tried
- every URL visited
- yield per URL (which fields found)
- what’s left to try (frontier)

So aggressive mode becomes **systematic**, not random.

---

## DETAILED ARCHITECTURE

### Stage 3: Cortex Fast Pass (GPT‑5 Low)

**Goal:** do the “smart 90%” quickly, using the evidence you already have.

Stage 3 runs these in order:

1) **Evidence Audit (batch)**  
2) **DOM Structural Extraction** (minified DOM, table mapping, non-visual)  
3) **Conflict Triage** (tier preference + tolerance + variant sanity)  
4) **Targeted Gap Fill** (read the dossier looking only for the remaining gaps)

**Escalation triggers to Stage 4:**
- critical field missing after Stage 3
- critical field conflict remains after triage
- evidence audit fails on a critical field
- only-visual spec tables / image-only PDFs

### Stage 4: Deep Escalation (GPT‑5 High)

**Goal:** recover the hardest 5–10%:
- vision extraction from screenshots
- deep reasoning on conflicts
- web search discovery for missing critical fields

Stage 4 is strictly bounded by:
- `AGGRESSIVE_MAX_TIME_PER_PRODUCT_MS`
- `CORTEX_MAX_DEEP_FIELDS_PER_PRODUCT`
- max search queries per round

---

## MODULES (UPDATED)

### 12.1 Evidence Auditor (NEW)

#### File: `src/extract/evidenceAudit.js`

```javascript
/**
 * EvidenceAuditor — GPT-5 Low batch audit.
 *
 * Validates that candidates are directly supported by evidence:
 * - quote exists
 * - quote_span matches snippet_text (when present)
 * - value string appears in quote or is explicitly supported
 *
 * Output: per-field audit results + reasons to reject or downscore.
 */
const { PRIORITY } = require('../llm/cortex_router');

class EvidenceAuditor {
  constructor({ cortexRouter, config }) {
    this.router = cortexRouter;
    this.modelAudit = config.CORTEX_MODEL_AUDIT || 'gpt-5-low';
  }

  async auditCandidates({ productId, identity, candidatesByField, evidencePack }) {
    const payload = {
      identity,
      fields: Object.entries(candidatesByField).map(([field, cands]) => ({
        field,
        candidates: cands.slice(0, 6).map(c => ({
          value: c.value,
          confidence: c.confidence,
          source_id: c.source_id,
          snippet_id: c.snippet_id,
          quote: c.quote,
          quote_span: c.quote_span || null
        }))
      })),
      // Provide snippets only as needed (audit must remain bounded)
      snippets: this._collectSnippets(evidencePack, candidatesByField, 1200)
    };

    const result = await this.router.submit({
      type: 'audit',
      priority: PRIORITY.STANDARD,
      productId,
      payload: {
        model: this.modelAudit,
        max_tokens: 4096,
        temperature: 0,
        system: AUDIT_SYSTEM_PROMPT,
        text: JSON.stringify(payload)
      }
    });

    return JSON.parse(result.response.text);
  }

  _collectSnippets(evidencePack, candidatesByField, maxCharsPerSnippet) {
    const need = new Set();
    for (const cands of Object.values(candidatesByField)) {
      for (const c of (cands || []).slice(0, 4)) {
        if (c.snippet_id) need.add(c.snippet_id);
      }
    }
    const out = {};
    for (const id of need) {
      const snp = evidencePack?.snippets?.[id];
      if (!snp?.text) continue;
      out[id] = snp.text.slice(0, maxCharsPerSnippet);
    }
    return out;
  }
}

const AUDIT_SYSTEM_PROMPT = `You are an evidence auditor. You NEVER guess.
You verify that proposed values are supported by the provided quotes/snippets.

Rules:
- If value is not explicitly supported by evidence, mark it REJECT.
- If quote_span exists, verify it is valid for the snippet_text.
- If the evidence is ambiguous or likely a different variant, mark CONFLICT.
Return JSON only:
{ audits: [{ field, best_candidate_index, status, reasons[], confidence_override? }] }`;

module.exports = { EvidenceAuditor };
```

---

### 12.2 DOM Structural Extraction (DEFAULT GPT‑5 LOW)

#### File: `src/extract/aggressiveDom.js` (updated)

Key change: default model becomes **GPT‑5 Low**, with optional escalation:

```javascript
const { PRIORITY } = require('../llm/cortex_router');

class AggressiveDomExtractor {
  constructor({ cortexRouter, fieldRulesEngine, config }) {
    this.router = cortexRouter;
    this.engine = fieldRulesEngine;
    this.modelFast = config.CORTEX_MODEL_DOM || 'gpt-5-low';
    this.modelDeep = config.CORTEX_MODEL_REASONING_DEEP || 'gpt-5-high';
  }

  async extractFromDom(rawHtml, targetFields, identity, sourceMetadata, opts = {}) {
    const model = opts.forceDeep ? this.modelDeep : this.modelFast;

    const result = await this.router.submit({
      type: 'dom',
      priority: PRIORITY.STANDARD,
      productId: identity.productId,
      payload: {
        system: DOM_ANALYSIS_SYSTEM,
        text: this._buildPrompt(rawHtml, targetFields, identity, sourceMetadata),
        model,
        max_tokens: 4096
      }
    });

    return this._parseResponse(result.response.text, targetFields);
  }
}
```

**Escalate to deep DOM only if:**
- low pass returns invalid JSON twice, or
- critical fields remain missing, or
- DOM contains multi-product comparison layouts.

---

### 12.3 Reasoning Conflict Resolver (LOW first, HIGH only for critical)

#### File: `src/extract/aggressiveReasoning.js` (updated)

- Non‑critical conflicts → `gpt-5-low`
- Critical conflicts / variant ambiguity → `gpt-5-high`

---

### 12.4 Vision Extraction (HIGH ONLY)

Vision remains **high tier** because it’s used only when evidence is image/table based.

---

### 12.5 Search & Discovery (LOW plans, HIGH executes only for critical gaps)

Search planning:
- `gpt-5-low` creates queries and decides what NOT to repeat.

Search execution:
- `gpt-5-high` only when critical gaps remain **after Stage 3**, and only for a bounded number of queries.

---

## ORCHESTRATION (UPDATED)

#### File: `src/extract/aggressiveOrchestrator.js` (conceptual flow)

```javascript
// Stage 1-2 unchanged: deterministic + Gemini
const standard = await standardExtractor.extract(evidencePack, identity);
const validated = await fieldRulesEngine.validateAll(standard);

// Stage 3: Cortex Low pass
const audited2 = await evidenceAuditor.auditCandidates({ ... });
const lowDom = await domExtractor.extractFromDom(..., { forceDeep: false });
const lowReason = await reasoningExtractor.resolve(..., { forceDeep: false });

// Re-audit after low pass merges
const audited3 = await evidenceAuditor.auditCandidates({ ... });

// Escalate only if critical gaps remain
if (hasCriticalGaps(audited3)) {
  const vision = await visionExtractor.extractFromVision(...);      // high
  const deepReason = await reasoningExtractor.resolve(..., { forceDeep: true }); // high
  const deepSearch = await searchEngine.searchForMissingFields(...); // high (bounded)
}

// Final evidence audit (always low)
const auditedFinal = await evidenceAuditor.auditCandidates({ ... });
return fieldRulesEngine.validateAll(mergeCandidates(auditedFinal));
```

---

## ENVIRONMENT VARIABLES (UPDATED)

```bash
# ── Aggressive Mode Toggle ──
AGGRESSIVE_MODE_ENABLED=true

# ── Model Tiering ──
CORTEX_MODEL_FAST=gpt-5-low
CORTEX_MODEL_AUDIT=gpt-5-low
CORTEX_MODEL_DOM=gpt-5-low
CORTEX_MODEL_REASONING_DEEP=gpt-5-high
CORTEX_MODEL_VISION=gpt-5-high
CORTEX_MODEL_SEARCH_FAST=gpt-5-low
CORTEX_MODEL_SEARCH_DEEP=gpt-5-high

# ── Escalation Controls ──
AGGRESSIVE_CONFIDENCE_THRESHOLD=0.85
CORTEX_MAX_DEEP_FIELDS_PER_PRODUCT=12
AGGRESSIVE_MAX_SEARCH_QUERIES=5

# ── Evidence Audit ──
AGGRESSIVE_EVIDENCE_AUDIT_ENABLED=true
AGGRESSIVE_EVIDENCE_AUDIT_BATCH_SIZE=60

# ── Timing Budgets ──
AGGRESSIVE_MAX_TIME_PER_PRODUCT_MS=600000
```

---

## ACCEPTANCE CRITERIA (UPDATED)

1) **Model efficiency:** ≥85% of Cortex calls use `gpt-5-low` (by count).  
2) **Escalation bounded:** High-tier calls never exceed `CORTEX_MAX_DEEP_FIELDS_PER_PRODUCT`.  
3) **Evidence integrity:** 100% of accepted values have evidence; “audit rejects” do not ship.  
4) **Accuracy:** Critical-field accuracy ≥99.5% when aggressive mode is enabled.  
5) **Performance:** Average aggressive runtime remains bounded (<10 min) while raising coverage.  
6) **Auditability:** Search tracker persists and prevents redundant searching across retries.  

