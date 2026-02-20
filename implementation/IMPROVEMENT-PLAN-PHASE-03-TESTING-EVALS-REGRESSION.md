# IMPROVEMENT PLAN — PHASE 03: TESTING, EVALS, REGRESSION, ACCURACY SCORECARDS

**Order:** After Phase 13 + Improvement Phases 01–02.

---

## ROLE & CONTEXT

You are building the “proof” layer: automated tests and evals that prevent regressions and measure progress over time.

This phase is how the factory becomes **trustworthy at scale**.

---

## MISSION

1) Create a repeatable benchmark harness for accuracy and coverage.  
2) Add a QA Judge that audits evidence + contract compliance and produces safe patches.  
3) Add regression gates so changes don’t silently degrade output.  
4) Track performance (runtime, LLM cost, URLs fetched) to keep 24/7 throughput stable.

---

# DELIVERABLES

## 3A — Golden Corpus (fixed products + fixed expected fields)

Create a golden dataset:
- `tests/golden/<category>/products.json`
- `tests/golden/<category>/expected.json`
- `tests/golden/<category>/notes.md`

Golden cases should include:
- easy manufacturer pages
- PDF datasheet products
- conflict-heavy products
- “stale URL” products to test replacement search

---

## 3B — QA Judge Command (evidence + contract audit)

Add CLI:
- `node src/cli/spec.js qa-judge --category mouse --product <id>`

It should:
1) load ProductRecord + EvidencePack
2) run judge prompt (ChatMock low default)
3) output:
   - pass/fail/needs_more_research
   - per-field issues
   - safe patch operations (select candidate / set_unk)
   - next-run search plan suggestions

---

## 3C — Benchmark Matrix (balanced vs aggressive vs uber aggressive)

Extend benchmark:
- run each product in:
  - balanced
  - aggressive
  - uber_aggressive (Phase 13)
- record:
  - coverage required/critical
  - conflicts
  - audit failures
  - runtime
  - costs
  - high-tier usage %

Write scorecards:
- `out/_eval/scorecards/<date>/<mode>.json`

---

## 3D — Regression Gates

Add thresholds:
- “expected unknown rate must not increase”
- “critical field accuracy must not drop”
- “audit reject rate must not spike”
- “runtime must not exceed budget envelope”

On failure:
- mark build red (CI)
- write diff report

---

## 3E — Prompt/Model Evaluation Lab (optional but recommended)

Integrate a prompt eval runner:
- compare model variants:
  - gpt-5-low vs gpt-5-high
  - gemini flash vs deepseek
- test prompt changes before deploying

This can run locally or nightly.

---

# ACCEPTANCE CRITERIA (PHASE 03)

1) Golden corpus exists with at least 30 representative products (mouse).  
2) QA Judge runs and produces deterministic JSON outputs.  
3) Scorecards compare modes and highlight deltas.  
4) Regression gates catch accuracy/coverage regressions before deployment.  
5) Performance metrics are tracked (runtime, URLs, model tier usage, cost).

