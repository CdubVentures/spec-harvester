# IMPROVEMENT PLAN — PHASE 01: FOUNDATION HARDENING (24/7 RELIABILITY + URL/LLM CONSISTENCY)

**Order:** Run this after Phase 13 is merged and running.
**Status:** ALL DELIVERABLES COMPLETE (Sprint 2026-02-14)

---

## ROLE & CONTEXT

You are hardening Spec Harvester for true 24/7 reliability:
- fewer crashes
- fewer stalls
- fewer “mystery” failures
- consistent behavior across providers

Phase 13 introduces heavy search and frontier memory. This phase ensures the system remains stable under load.

---

## MISSION

1) Make the app resilient to common production failures (timeouts, provider outages, dead links).  
2) Eliminate configuration footguns (especially LLM base URL `/v1` mismatch).  
3) Improve URL canonicalization and fetch outcome handling so repeated 404s are learned away automatically.  
4) Ensure all “critical toggles” are explicit and observable.

---

# DELIVERABLES

## 1A — LLM Base URL Normalization (COMPLETED)
> eliminate `/v1/v1` forever

### Problem
Different OpenAI-compatible services expect:
- base URL with `/v1` included, OR
- base URL without `/v1`

Spec Harvester must handle both.

### Implementation
Add a single normalizer in the OpenAI-compatible provider:

- If `baseUrl` ends with `/v1`, strip it.
- Always build requests as `${baseUrlNoV1}/v1/<endpoint>`

**Deliverable:** `normalizeOpenAIBaseUrl()` used by every OpenAI-compatible provider module.

**Acceptance**
- Both `http://localhost:8000` and `http://localhost:8000/v1` work for ChatMock and any OpenAI-compatible backend.

---

## 1B — Add `LLM_PROVIDER=chatmock` alias (COMPLETED)

### Goal
Users will set `LLM_PROVIDER=chatmock`. Internally, route to the OpenAI-compatible client, but tag logs as “chatmock”.

**Acceptance**
- All logs/metrics show provider=chatmock and model=gpt-5-low/high, etc.
- No code paths depend on `LLM_PROVIDER=openai` for ChatMock usage.

---

## 1C — Provider Health Gates + Circuit Breakers (COMPLETED)

### Rules
- If a provider fails N times consecutively:
  - trip circuit breaker
  - cool down for T minutes
  - fail over to the next configured provider (or skip LLM and continue deterministic)

### What to build
- `src/ops/circuitBreaker.js`
- `src/ops/providerHealth.js`
- `src/cli/spec.js llm-health` extended to:
  - test `/v1/models` readiness
  - test structured output mode
  - test max timeout tolerance

**Acceptance**
- Daemon continues queue progression even when ChatMock or Google CSE is down.
- Failures are visible in `out/_runtime/events.jsonl`.

---

## 1D — Fetch Outcome Standardization (COMPLETED)

### Build a single FetchResult shape
Every fetch returns:

```jsonc
{
  "url": "...",
  "final_url": "...",
  "status": 200,
  "content_type": "text/html",
  "bytes": 12345,
  "elapsed_ms": 1337,
  "error": null
}
```

### Enforce
- If main-document status is 404/410:
  - do not attempt extraction
  - write to frontier “dead URL” memory with cooldown
  - trigger replacement search if the field worklist still requires it

**Acceptance**
- repeated 404 fetches drop sharply after 1 day of running
- run logs clearly show fetch status outcomes per URL

---

## 1E — URL Canonicalization Utility (COMPLETED)

### Build `src/research/urlNormalize.js` (used everywhere)
- normalize scheme/host case
- strip tracking params
- sort query params
- normalize trailing slash
- store original → canonical mapping for audit

**Acceptance**
- Same page discovered with different tracking params is deduped into one canonical URL.
- Frontier DB shows one canonical URL with multiple origins, not duplicates.

---

## 1F — Observability Basics (COMPLETED)

Add structured metrics per run:
- urls fetched
- 404/410 counts
- provider errors
- LLM calls by model tier
- time per stage

Write to:
- `out/_runtime/metrics.jsonl`
- `out/_runtime/events.jsonl`

**Acceptance**
- You can answer:
  - “Why did this run take 12 minutes?”
  - “Which domains are causing 404 thrash?”
  - “How many high-tier calls happened today?”

---

# 1G — Runtime Field Rules Engine Hardening (COMPLETED)

**Status:** DONE (Sprint 2026-02-14)

The Field Rules Engine (`src/engine/fieldRulesEngine.js`) and Runtime Gate (`src/engine/runtimeGate.js`) were hardened to consume ALL Studio-authored config knobs. Previously, 8 config options were "dead" — authored in the Studio, compiled into generated artifacts, but ignored by the runtime. All 8 have been fixed with 66 new tests and 0 regressions. See `AUDIT-FIELD-RULES-STUDIO-MOUSE-V2.md` and `IMPROVEMENT-PLAN-PHASE-02-EVIDENCE-EXTRACTION-QUALITY.md` (section 2G) for full details.

### New Runtime Pipeline Stages
- **runtimeGate Pass 1.5:** list_rules enforcement (sort + min_items + max_items) between normalization and cross-validation
- **Post-consensus reducers:** selection_policy bonus (consensusEngine.js) + item_union merge (listUnionReducer.js)
- **Per-field thresholds:** enum_fuzzy_threshold consumed by both normalizeCandidate and ComponentResolver

### Remaining Unconsumed Outputs (5, all LOW severity)
- `conflict_policy` — documents intent, runtime uses fixed consensus logic
- `tier_preference` — documents preferred tiers, runtime uses fixed tier weighting
- `unknown_token` — always "unk", runtime hardcodes same
- `unknown_reason_required` — always true, runtime always requires reasons
- `unknown_reason_default` — always "not_found_after_search", runtime hardcodes same

These are intentionally kept as documentation/future-use properties. They will be wired when multi-strategy consensus and configurable tier weights are implemented.

---

# 1H — Field Rules Schema Consolidation: Centralized Accessor Pattern (COMPLETED)

**Status:** DONE (Sprint 2026-02-14)

The field rules schema had 22+ duplicated properties stored 2-3 times each, 10+ orphan properties never consumed, and no centralized accessor pattern — every consumer file did its own manual fallback logic. This was consolidated into a single source of truth.

### What was built

**`src/engine/ruleAccessors.js`** — centralized accessor module exporting 17 functions:

| Category | Functions |
|----------|-----------|
| Priority | `ruleRequiredLevel`, `ruleAvailability`, `ruleDifficulty`, `ruleEffort`, `rulePublishGate`, `ruleBlockPublishUnk` |
| Contract | `ruleType`, `ruleShape`, `ruleUnit`, `ruleRange`, `ruleListRules`, `ruleRounding` |
| Enum | `ruleEnumPolicy`, `ruleEnumSource`, `ruleEnumFuzzyThreshold` |
| Evidence | `ruleEvidenceRequired`, `ruleMinEvidenceRefs` |
| Parse | `ruleParseTemplate` |

All accessors use the pattern: **nested block first -> top-level fallback -> default**.

### Files migrated to use ruleAccessors

| File | What changed |
|------|-------------|
| `src/engine/fieldRulesEngine.js` | Replaced 6 private functions (`parseRuleType/Shape/Unit`, `requiredLevel`, `availabilityLevel`, `difficultyLevel`) with imports |
| `src/runner/runUntilComplete.js` | Replaced `readRuleToken()` and `inferRuleEffort()` with imports |
| `src/review/reviewGridData.js` | Manual `required_level` fallback -> `ruleRequiredLevel()` |
| `src/llm/extractCandidatesLLM.js` | Manual `data_type/shape/unit` fallbacks -> `ruleType()`, `ruleShape()`, `ruleUnit()` |
| `src/llm/fieldBatching.js` | Direct `fromMap.difficulty` (no fallback!) -> `ruleDifficulty()` (fixes latent bug) |
| `src/publish/publishingPipeline.js` | Nested-only `block_publish_when_unk` -> `ruleBlockPublishUnk()` |
| `src/categories/loader.js` | Removed 3 local duplicate functions |
| `src/build/generate-types.js` | Manual `data_type/output_shape` -> `ruleType()`, `ruleShape()` |
| `src/field-rules/compiler.js` | Manual fallback patterns -> imported accessors |
| `src/testing/goldenFiles.js` | `readRequiredLevel` function -> `ruleRequiredLevel` |

### Orphan property stripping

**`src/ingest/categoryCompile.js`** now strips these properties from compiled `field_rules.json` output:
- `parse_rules` — used during compilation but never read by runtime
- `value_form` — internal compilation state, never read by runtime
- `round` — compilation rounding token, never read by runtime
- `canonical_key` — legacy mapping, never read by runtime

`component` was **kept** because runtime code (`fieldRulesEngine.js`, `componentResolver.js`) reads `rule.component.type`.

### Bug fixed

`src/llm/fieldBatching.js` had a latent bug: `getRuleDifficulty()` read `fromMap.difficulty` directly without checking `fromMap.priority.difficulty`. Now uses `ruleDifficulty()` which checks both.

### Remaining manual fallback patterns (known, lower priority)

The architecture audit found 28+ remaining manual fallback patterns that should use ruleAccessors:

| File | Locations | Priority |
|------|-----------|----------|
| `src/ingest/categoryCompile.js` | 15+ locations (no import at all) | HIGH — largest offender |
| `src/field-rules/compiler.js` | 9 locations (imports but bypasses) | MEDIUM |
| `src/engine/fieldRulesEngine.js` | 2 locations (`enum_policy` fallback) | LOW |
| `src/build/generate-types.js` | 1 location (`required_level`) | LOW |
| `src/ingest/excelCategorySync.js` | 1 location (missing contract fallback) | LOW |

These are functional (they produce correct results) but represent maintenance debt. `categoryCompile.js` is the highest-priority target for the next consolidation pass.

### Test results

940/940 relevant tests pass. 13 pre-existing SQLite native module failures (unrelated).

---

# ACCEPTANCE CRITERIA (PHASE 01)

1) No more "/v1/v1" URL construction in any provider. **(DONE)**
2) ChatMock provider alias works (`LLM_PROVIDER=chatmock`). **(DONE)**
3) Provider outages do not stall the daemon; jobs requeue and continue. **(DONE)**
4) Fetch outcomes are standardized and dead URLs are cooldowned. **(DONE)**
5) URL canonicalization dedupes tracking variants. **(DONE)**
6) Metrics exist for stage timing, 404s, and model tier usage. **(DONE)**
7) All critical Studio config knobs are consumed by runtime (8/8 dead configs fixed). **(DONE)**
8) Centralized accessor pattern for all field rule properties (17 functions, 10 files migrated). **(DONE)**
9) Orphan properties stripped from compiled output (4 properties removed). **(DONE)**

