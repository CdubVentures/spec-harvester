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

# Phase 01 â€” Field state snapshot + NeedSet engine (tier + confidence aware)


## Goal
Make **tiers + confidence** the control system by computing a per-run **NeedSet**:
- missing fields
- low-confidence fields
- conflicts
- tier deficits (e.g., no Tier-1 evidence yet)
- evidence policy deficits (min refs not met)

This NeedSet decides what discovery/indexing does next.

## Deliverables
- `NeedSetEngine` module
- persisted NeedSet snapshots per run
- GUI â€œNeedSetâ€ panel/table (sortable, with reason badges)

## Implementation

### 1.1 Inputs
Pull per-field state from your existing pipeline outputs (preferred order):
1) latest consensus/selection outputs in `runProduct.js` artifacts
2) SpecDb if you persist field states there (`src/db/specDb.js`)
3) fallback: compute â€œmissingâ€ from normalized output

Field state schema (in-memory):
```ts
type FieldState = {
  field_key: string;
  required_level: 'identity'|'critical'|'required'|'optional';
  confidence: number|null;
  status: 'unknown'|'candidate'|'accepted'|'conflict'|'invalid';
  refs_found: number;
  min_refs: number;
  best_tier_seen: 1|2|3|4|null;
  tier_preference: number[]; // e.g., [1,2]
  conflict: boolean;
}
```

### 1.2 Need score formula (accuracy-max)
Compute:
- `missing_multiplier` = 2.0 if missing/unknown else 1.0
- `conf_term` = (1 - clamp(confidence,0,1)) ; if null treat as 1.0
- `required_weight`: identity=5, critical=4, required=2, optional=1
- `tier_deficit_multiplier`:
  - if tier_preference includes 1 and best_tier_seen > 1 or null: 2.0
  - else 1.0
- `min_refs_deficit_multiplier`:
  - if refs_found < min_refs: 1.5
  - else 1.0
- `conflict_multiplier`: if conflict: 1.5

Final:
`need = missing_multiplier * conf_term * required_weight * tier_deficit_multiplier * min_refs_deficit_multiplier * conflict_multiplier`

Persist reasons as tags:
- `["missing","tier_deficit","min_refs_fail","conflict","low_conf"]`

### 1.3 Where to integrate
- Add `computeNeedSet(...)` at the end of each â€œroundâ€ of your run loop.
- If you donâ€™t have explicit rounds yet, compute once after the first extraction/consensus and again after each discovery+index increment (Phase 9 adds explicit rounds).

Likely touchpoints:
- `src/pipeline/runProduct.js` (after consensus + validation)
- `src/scoring/consensusEngine.js` output integration
- `src/validator/qualityGate.js` (to tag policy deficits)

### 1.4 Persist + expose
Persist:
- `artifacts/<run_id>/needset.json`
- (Optional) to SpecDb: table `needset` (Phase 6 schema)

Expose via GUI:
- `GET /api/indexlab/run/:run_id/needset`

### 1.5 Field Studio policy wiring (overlooked)
- Read evidence.tier_preference, evidence.min_evidence_refs, and priority.publish_gate per field from compiled rules.
- Add NeedSet reason tags for policy gaps: tier_pref_unmet, min_refs_fail, publish_gate_block.
- Persist policy snapshot per row so Phase 09 can explain planner choices deterministically.

## GUI proof
### Required GUI panels
1) **NeedSet table** with:
- field_key
- required_level badge (I/C/R/O)
- confidence
- best_tier_seen
- refs_found / min_refs
- reason badges
- need_score

2) **NeedSet size over time** (sparkline)
- computed each time it changes

### Proof steps
- Run IndexLab on a product known to be missing deep fields.
- Verify NeedSet prioritizes deep fields (sensor_model, polling_rate, switch_model) above optional ones.

## Exit criteria
- NeedSet is computed and stored per run.
- GUI shows NeedSet live and it shrinks when fields get resolved.


