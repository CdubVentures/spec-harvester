# PHASE-06 IMPROVMENT

## Execution Slot
- Run this after `PHASE-06B-IMPROVMENT.md`.
- Reason: inventory/search surfaces should consume the scheduler/automation artifacts already emitted by Phase 06B.

## Status (2026-02-19)
- Started.
- Implemented first slice:
1. Added run-level API: `GET /api/v1/indexlab/run/:runId/evidence-index`.
2. Added DB-backed inventory summary for `source_registry/source_artifacts/source_assertions/source_evidence_refs`.
3. Added DB-backed evidence search (`field/value/quote/snippet`).
4. Updated GUI panel to `Evidence Index & Dedupe (Phase 06A)` and moved it above `Phase 06B`.
5. Added Phase 06A GUI proof blocks:
   - inventory counters
   - evidence inventory documents table
   - top indexed fields table
   - evidence search input + matches table

## What I'd Add
1. Implement `EvidenceIndexDb` module with documents, chunks, facts, and FTS APIs.
2. Add explicit dedupe outcome fields/events: `dedupe_hit`, `reuse_mode`, `indexed_new`.
3. Add versioned snippet ID generation anchored to content hash + parser/chunker versions.
4. Add applicability metadata per document (`identity_match_level`, `multi_model_detected`, `applies_to_item_score`).

## What We Should Implement Now
1. Keep this first slice stable and verify on multiple runs/categories.
2. Add true FTS-backed search + ranking over chunk/fact rows (not just LIKE fallback).
3. Introduce explicit dedupe outcomes (`dedupe_hit`, `reuse_mode`, `indexed_new`) into run events.
4. Preserve existing candidate lineage while introducing hash reuse (no review breakage).

## Definition Of Done
1. Re-runs on same content show clear dedupe reuse.
2. Indexed evidence is searchable and traceable by snippet IDs.
3. Retrieval consumers can safely use applicability metadata.
