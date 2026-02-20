# Phase 04 - URL Health and Self-Healing

## Canonical Status
- This is the single canonical file for this phase.
- Consolidated on 2026-02-20 from split planning plus improvement docs.
- Includes implemented status and remaining work from merged sources.
- Keep all unfinished items active until code plus GUI proof confirms completion.

## Merged Source Files
- PHASE-04-url-health-self-healing.md
- PHASE-04-IMPROVMENT.md

## Full Merged Spec

### Source: PHASE-04-url-health-self-healing.md

> Original header: Deep Spec Harvester - Phase 04 URL Health and Self-Healing


## Goal
Stop 404/410/403/429 churn and make discovery self-healing with:
- cooldown-aware URL skip behavior
- repair query emission for dead links
- blocked-domain suppression
- repeated dead-path detection
- GUI proof for all of the above

## Implemented Status (2026-02-19)

### 1) Pipeline wiring is active
Phase 04 checks now run in the main fetch loop.

File touchpoints:
- `src/pipeline/runProduct.js`
- `src/research/frontierDb.js`
- `src/research/frontierSqlite.js`

Runtime flow:
1. Pre-fetch: `frontierDb.shouldSkipUrl(source.url)`
2. If skip: emit `url_cooldown_applied` and continue
3. Fetch attempt runs
4. Post-fetch: `frontierDb.recordFetch(...)`
5. For `404/410`: emit one repair query per domain per run
6. For repeated blocked outcomes (`403/429` or blocked-like errors): apply host block in planner

### 2) Repair query emission (404/410)
Implemented event:
- `repair_query_enqueued`

Current payload fields:
- `domain`
- `query`
- `status`
- `reason`
- `source_url`
- `cooldown_until`
- `provider`
- `doc_hint` (`manual_or_spec`)
- `field_targets` (top required fields)

Current template:
- `site:{domain} "{brand} {model} {variant}" (spec OR manual OR pdf OR "user guide")`

Dedupe rule:
- one emitted repair query per domain per run

### 3) Blocked-domain cooldown behavior
Implemented event:
- `blocked_domain_cooldown_applied`

Trigger:
- repeated blocked outcomes for same domain (`403`, `429`, or blocked-like fetch errors)

Effect:
- planner host block via `planner.blockHost(...)`
- emits event with threshold and removed queue count

### 4) bad_url_patterns behavior
Implemented in both Frontier backends:
- JSON backend: path pattern skip in `src/research/frontierDb.js`
- SQLite backend: sibling path pattern skip in `src/research/frontierSqlite.js`

Skip reason:
- `path_dead_pattern`

How it is learned:
- repeated 404s for same `(domain, path_sig)` with no successful fetches

### 5) Config knobs (active)
Added in `src/config.js`:
- `FRONTIER_COOLDOWN_403_BASE` (default `1800` seconds)
- `FRONTIER_BLOCKED_DOMAIN_THRESHOLD` (default `2`)
- `FRONTIER_REPAIR_SEARCH_ENABLED` (default `true`)

Also used:
- existing 404/410/429 and path-threshold frontier knobs remain effective

### 6) API and GUI proof surfaces
Domain checklist API now includes:
- `repair_queries`
- `bad_url_patterns`
- normalized `outcome_counts` per domain
- `host_budget_score`, `host_budget_state`, and `cooldown_seconds_remaining`

File touchpoint:
- `src/api/guiServer.js` (`buildIndexingDomainChecklist`)

GUI panel implemented:
- `URL Health & Repair (Phase 04)` in `tools/gui-react/src/pages/indexing/IndexingPage.tsx`

Panel sections:
- summary counters (404/410, blocked, cooldowns, repair queries, bad patterns)
- host budget summary (average budget + blocked/backoff host counts)
- domain health table
- repair queries table
- bad URL patterns table

Pipeline/overview integration:
- `phase 04` state chip in pipeline stage row
- session metric `URL Cooldowns Active` now backed by real phase-04 data

### 7) Test coverage
Phase 04 behavior covered by:
- `test/frontierDb.test.js`
- `test/frontierSqlite.test.js`
- `test/indexingDomainChecklistApi.test.js`

## GUI Proof Checklist
Use one run and verify:
1. Start IndexLab run with discovery enabled.
2. In `URL Health & Repair (Phase 04)`, confirm domain rows appear.
3. Trigger or observe dead URL(s) and confirm:
   - `url_cooldown_applied` effects in next retry values
   - `404 / 410` and repeat counters increase
4. Confirm repair queries appear in `Repair Queries Fired`.
5. Confirm repeated dead patterns appear in `Bad URL Patterns`.
6. Confirm session metric `URL Cooldowns Active` is non-placeholder and updates.

## Exit Criteria
- Cooldown skips are visible and deterministic.
- 404/410 trigger repair query intents once per domain per run.
- Repeated blocked domains are suppressed after threshold.
- bad URL path patterns are learned and skipped.
- GUI proves all signals for the selected run.

## Hand-off to Next Phase
Phase 04 is now the URL-health signal producer.
Phase 05 should focus on parallel fetch/parse throughput while preserving these cooldown and repair protections.

### Source: PHASE-04-IMPROVMENT.md

> Original header: PHASE-04 IMPROVMENT


## Implemented Status (2026-02-19)
This improvement slice is now wired in runtime + API + GUI.

1. Fetch outcome taxonomy is normalized and emitted in runtime events.
2. Domain checklist API computes host budget score/state and cooldown countdown seconds.
3. URL Health panel now shows host budget, budget state, and live cooldown clocks.
4. Repair remains signal-only in Phase 04; scheduling policy remains deferred to Phase 06B.

## Code Touchpoints
1. `src/pipeline/runProduct.js`
- Added `classifyFetchOutcome(...)`.
- `source_fetch_failed` now emits `status` + `outcome`.
- `source_processed` now emits normalized `outcome`.

2. `src/api/guiServer.js`
- Added outcome normalization fallback `classifyFetchOutcomeFromEvent(...)` for older events.
- Added per-domain `outcome_counts` aggregation.
- Added `host_budget_score`, `host_budget_state`, `cooldown_seconds_remaining` to checklist rows.

3. `tools/gui-react/src/pages/indexing/IndexingPage.tsx`
- Extended Phase 04 cards with average host budget and blocked/backoff host counts.
- Extended Domain Health table with `budget`, `budget state`, and `cooldown` columns.
- Cooldown column now renders live countdown based on `next_retry_at`.

4. `test/indexingDomainChecklistApi.test.js`
- Added shape checks for new Phase 04 row fields.
- Added coverage for outcome counters + cooldown countdown output.

## GUI Proof Checklist
1. Run IndexLab with discovery enabled.
2. Open `URL Health & Repair (Phase 04)`.
3. Confirm Domain Health rows show:
- `budget`
- `budget state`
- `cooldown`
4. Confirm summary cards show:
- `avg host budget`
- `hosts blocked/backoff`
5. Trigger/observe failed fetches and verify `blocked`, `404/410`, and cooldown counters move.

## Not In Scope (Deferred)
1. Full refetch automation scheduler policy (Phase 06B).
2. Cross-run canonical memory replay policy.
3. Aggressive host-level queue throttling policy loops.

