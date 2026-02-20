# PHASE-01 IMPROVMENT

## Implemented Scope
1. Added identity-aware NeedSet context in `computeNeedSet`:
   - identity state: `locked`, `provisional`, `unlocked`, `conflict`
   - publish gate and identity gate metadata
   - source-level identity audit rows
2. Added new NeedSet reasons:
   - `tier_pref_unmet`
   - `identity_unlocked`
   - `blocked_by_identity`
   - `publish_gate_block`
   - existing reasons retained (`missing`, `min_refs_fail`, `conflict`, `low_conf`)
3. Added field-level NeedSet attributes:
   - `blocked_by`
   - `best_identity_match`
   - `quarantined`
   - `effective_confidence`
   - `confidence_capped`
   - `reason_payload` (`why_missing`, `why_low_conf`, `why_blocked`)
4. Added runtime/event persistence of Phase 01 identity payload:
   - `needset.identity_lock_state`
   - `needset.identity_audit_rows`
5. Added catalog-driven ambiguity controls for identity handling:
   - `family_model_count` (brand+model sibling count in catalog)
   - `ambiguity_level` (`easy`, `medium`, `hard`, `very_hard`, `extra_hard`)
   - `extraction_gate_open` (separate from strict publish gate)

## Delivered Behavior
1. NeedSet artifacts (`runs/<id>/analysis/needset.json` and latest) now include:
   - `identity_lock_state`
   - `identity_audit_rows`
   - per-row identity-aware reasons and block metadata
2. `needset_computed` runtime event now emits identity lock state and audit rows.
3. Variant-empty products now use ambiguity level to control extraction strictness:
   - `easy`/`medium` -> extraction gate can open (provisional extraction allowed)
   - `hard`/`very_hard`/`extra_hard` -> extraction remains strictly gated
   - publish gate remains strict and unchanged
4. NeedSet panel now shows:
   - Identity lock state summary (status/confidence/publish gate/blockers)
   - Extraction gate state (`open` / `gated`)
   - Ambiguity state (`level` + `family_model_count`)
   - Identity audit rows table
   - Per-row `blocked by` and `id match` columns
   - Confidence cap badge (`capped`) and quarantine badge (`quarantine`)

## Verification Completed
1. `node --check src/indexlab/needsetEngine.js`
2. `node --check src/pipeline/runProduct.js`
3. `node --check src/indexlab/runtimeBridge.js`
4. `npm --prefix tools/gui-react run -s build`

## Not In This Slice
1. Evidence freshness decay weighting is not implemented yet.
2. Row-level snippet timestamp lineage in the NeedSet table is not implemented yet.

## GUI Proof Steps
1. Run `Run IndexLab` for one product.
2. Open `NeedSet (Phase 01)` for that run.
3. Verify Identity lock state block is populated (status/confidence/gate/publish/blockers/pages).
4. Verify Identity lock state shows ambiguity + family count and extraction gate status.
5. Verify Identity audit rows table is populated for sources.
6. Verify NeedSet row reasons include Phase 01 tags (`blocked_by_identity`, `publish_gate_block`, etc.) when applicable.
7. Verify row columns show `blocked by`, `id match`, and badges (`capped`, `quarantine`) when applicable.
