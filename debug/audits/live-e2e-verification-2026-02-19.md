# Live E2E Verification Report (Parsing 01-03 -> Indexing 01-07)

Date: 2026-02-19
Owner: Codex run audit

## Scope
This audit executed bounded live runs and verified the following:
- Parsing fetch/parse on live URLs
- Dynamic fetch mode behavior (HTTP vs Crawlee)
- LLM payload handoff (prompt + structured response traces)
- Phase 07 prime-source artifact generation
- SQLite persistence for run-level metadata

## Runs Executed
- Run A (review-focused): `20260219214149-e173c2`
- Run B (manufacturer-focused): `20260219214358-4a2564`
- Run C (combined): `20260219213722-57b305`
- Baseline fast-profile comparison: `20260219213221-b21f31`

IndexLab run metadata paths:
- `artifacts/indexlab-e2e/20260219214149-e173c2/run.json`
- `artifacts/indexlab-e2e/20260219214358-4a2564/run.json`
- `artifacts/indexlab-e2e/20260219213722-57b305/run.json`
- `artifacts/indexlab-e2e/20260219213221-b21f31/run.json`

## Key Findings

### 1) Fetch mode behavior is profile-dependent (critical)
- `fast` profile forces HTTP fetcher (`preferHttpFetcher=true`), bypassing Crawlee.
- Code reference: `src/config.js:255`.
- This explains why earlier runs had no dynamic/network capture.

### 2) Crawlee mode works, but reliability is mixed
- In Run C (`standard` profile), fetch events show `fetcher_kind: "crawlee"`.
- Path: `artifacts/indexlab-e2e/20260219213722-57b305/run_events.ndjson`.
- However, A/B runs timed out on `rtings.com` (`requestHandler timed out after 45 seconds`).
- Warning observed in CLI output for both runs.

### 3) Network JSON capture is proven in Crawlee run
- Run C captured 242 network JSON rows for RTINGS.
- Path: `out/specs/outputs/mouse/mouse-corsair-sabre-rgb-pro-indexlab-1771537042326/runs/20260219213722-57b305/raw/network/rtings.com__0000/responses.ndjson.gz`
- Sample includes endpoints like:
  - `https://www.rtings.com/api/v2/safe/app/product_vue_page__page_body`
  - `https://www.rtings.com/api/v2/safe/app/product_vue_page__compared_texts`

### 4) LLM payload handoff is proven
- Full request/response trace with references/snippets survives into runtime trace JSON.
- Path: `out/specs/outputs/specs/outputs/_runtime/traces/runs/20260219213722-57b305/mouse-corsair-sabre-rgb-pro-indexlab-1771537042326/llm/call_000.json`
- Contains:
  - prompt system/user payload
  - evidence references
  - snippet hashes
  - model/provider/usage
  - parsed response content

### 5) Phase 07 currently does not converge (blocking)
- All tested runs report:
  - `fields_with_hits = 0`
  - `refs_selected_total = 0`
- Path example: `out/specs/outputs/mouse/mouse-corsair-sabre-rgb-pro-indexlab-1771537042326/runs/20260219213722-57b305/analysis/phase07_retrieval.json`
- This is currently the main blocker for proving retrieval-to-prime-source quality.

### 6) Screenshot/DOM-snippet artifacts are not present
- No screenshot crop artifacts produced in tested runs.
- No `dom_snippet` artifacts found in run folders.
- This does not satisfy multimodal attachment proof requirements yet.

### 7) SQLite stores run rows, but source-assertion tables are empty in this flow
- `product_runs` rows are inserted with run metadata.
- Path: `.specfactory_tmp/mouse/spec.sqlite`
- `source_registry`, `source_assertions`, and `source_evidence_refs` are empty for tested runs.
- This suggests current live flow is not persisting source-level assertion lineage to those tables.

## Pass/Fail Against Requested Proof
- Parsing live URLs: PASS (with partial failures/timeouts)
- Dynamic JS + network payload capture: PASS (Run C only)
- Prime source retrieval (Phase 07): FAIL (0 hits across tested runs)
- Multimodal attachments (screenshots/dom snippets): FAIL (not emitted)
- LLM payload includes evidence context: PASS
- DB finalized run row: PASS (`product_runs`)

## Most Important Blockers to Fix Next
1. Phase 07 retrieval index/handoff gap (always zero hits).
2. Crawlee timeout tuning for heavy pages (`CRAWLEE_REQUEST_HANDLER_TIMEOUT_SECS=45` is too low for RTINGS on this machine).
3. Emit screenshot crop + dom snippet artifacts and wire them into review payload.
4. Persist source assertion/evidence lineage into `source_registry`/`source_assertions`/`source_evidence_refs` for live runs.

## Proof Bundle
A compact proof bundle is staged here:
- `artifacts/e2e-proof-20260219/`
- Includes:
  - `runC-run.json`
  - `runC-run_events.ndjson`
  - `runC-phase07_retrieval.json`
  - `runC-llm-call_000.json`
  - `runC-rtings-network-responses.ndjson.gz`
  - `runA-run.json`
  - `runB-run.json`
