# PHASE-08 IMPROVMENT

## What I'd Add
1. Enforce strict extraction context contract including identity/applicability fields.
2. Enforce required unknown reasons (`missing_evidence`, `conflict`, `identity_uncertain`, `blocked_by_policy`).
3. Add provider-normalized structured output parser to handle non-JSON wrappers consistently.
4. Add lane-level payload and response tracing for prompt and output review.
5. Add visual evidence refs (`image_asset_id`, `region_id`) for ambiguous identity/model fields.
6. Add live GUI image preview + download pane for extraction proof.
7. Enforce derivative-only image payloads to LLM (`<= 512KB` per image, no originals).
8. Enforce multi-product identity gate fields on every evidence unit (`page_product_cluster_id`, `target_match_score`, `target_match_passed`).

## What We Should Implement Now
1. Add identity-aware extraction gating in prompt assembly and validation.
2. Reject candidates with dangling or invalid snippet references.
3. Add clear validation error badges in GUI for schema/evidence/identity failures.
4. Gate visual evidence usage by ambiguity level and keep text evidence mandatory.
5. Emit `visual_asset_captured` and `extraction_visual_ref_attached` events for live run proof.
6. Reject candidates with `target_match_passed=false` before acceptance pipeline.

## Definition Of Done
1. No accepted value without valid evidence refs.
2. Identity-unsafe values are downgraded to unknown with reason.
3. Prompt/response traces are readable in GUI for debugging.
4. Ambiguous fields show linked image evidence with preview + download while run is active.
5. Multi-product pages do not leak non-target product evidence into accepted values.
