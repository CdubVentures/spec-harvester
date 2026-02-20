# Deep Spec Harvester - Phase 06 Evidence Index DB

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
