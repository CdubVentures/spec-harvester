# Phase 06 - Evidence Index Database

## Canonical Status
- This is the single canonical file for this phase.
- Consolidated on 2026-02-20 from split planning plus improvement docs.
- Includes implemented status and remaining work from merged sources.
- Keep all unfinished items active until code plus GUI proof confirms completion.

## Merged Source Files
- PHASE-06-evidence-index-db.md
- PHASE-06-IMPROVMENT.md

## Full Merged Spec

### Source: PHASE-06-evidence-index-db.md

> Original header: Deep Spec Harvester - Phase 06 Evidence Index DB


## Execution note (current)
- Phase 06 improvement expansion runs after Phase 06B in the current sequence.
- This phase consumes scheduler/refetch signals and deepens deterministic evidence indexing/search.

## Goal
Build deterministic evidence indexing signals around content hash identity so repeated documents are visible and dedupe behavior is provable in GUI.

## Scope
Phase 06 is started in this change set with runtime payload wiring and GUI proof for:
- content hash visibility per processed source
- dedupe hit counting
- parse/index completion alignment
- repeated hash inventory for quick audits

Full EvidenceIndexDb tables (`documents/chunks/facts/fts`) remain in progress.

## Implemented Starter Status (2026-02-19)

### 1) Source processed events now emit Phase 06 fields
`source_processed` payload now includes:
- `final_url`
- `content_type`
- `content_hash`
- `bytes`

File:
- `src/pipeline/runProduct.js`

### 2) New Phase 06 panel in IndexLab
Added:
- `Evidence Index & Dedupe (Phase 06)` panel

Panel shows:
- sources processed
- unique content hashes
- dedupe hits
- hash coverage percent
- parse finished count
- index finished count
- payload bytes
- missing hash rows
- repeated content hash table (hits/host/content type/bytes/url/last seen)

File:
- `tools/gui-react/src/pages/indexing/IndexingPage.tsx`

### 3) Session summary now uses real dedupe value
Replaced placeholder:
- `Content Hash Dedupe Hits` now reads from Phase 06 runtime (`source_processed.content_hash` aggregation).

File:
- `tools/gui-react/src/pages/indexing/IndexingPage.tsx`

### 4) Container and pipeline status integration
Added Phase 06 state tokens to:
- top container status strip (`Evidence Index`)
- pipeline chip row (`phase 06`)

File:
- `tools/gui-react/src/pages/indexing/IndexingPage.tsx`

## Remaining Phase 06 Work
- Add `src/index/evidenceIndexDb.js` with SQLite lifecycle and query APIs.
- Persist deterministic `documents/chunks/facts` rows and FTS indexes.
- Add stable `snippet_id` generation and snippet hash lineage.
- Add index inventory + search endpoint(s) in `src/api/guiServer.js`.
- Add GUI search box for chunk/fact retrieval proof.

## GUI Proof Checklist (starter)
1. Run IndexLab once and confirm `Evidence Index & Dedupe (Phase 06)` shows processed docs and hash coverage.
2. Run the same product again and confirm dedupe hits increase.
3. Confirm repeated hash rows appear when identical content is encountered.
4. Confirm `Content Hash Dedupe Hits` in Session Crawled matches Phase 06 panel.

## Exit Criteria For This Starter Slice
- Phase 06 panel has live, non-placeholder dedupe/indexing telemetry.
- Runtime emits content hash metadata on processed sources.
- Session summary reflects actual dedupe hits for selected run.

### Source: PHASE-06-IMPROVMENT.md

> Original header: PHASE-06 IMPROVMENT


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

