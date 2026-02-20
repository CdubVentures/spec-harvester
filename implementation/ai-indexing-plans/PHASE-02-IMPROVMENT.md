# PHASE-02 IMPROVMENT

## Selected Scope Implemented
1. Added deterministic SearchProfile generation in discovery:
   - `buildDeterministicAliases()` with normalized alias variants (capped),
   - `buildSearchProfile()` with `identity_aliases`, `focus_fields`, `query_rows`, `field_target_queries`, `doc_hint_queries`, and `hint_source_counts`.
2. Wired Field Studio hints into query generation:
   - `search_hints.query_terms`,
   - `search_hints.preferred_content_types`,
   - `search_hints.domain_hints`,
   - tooltip-derived fallback terms from field rules.
3. Added optional Phase 02 LLM planner:
   - `planDiscoveryQueriesLLM()` with strict JSON schema output (`{ queries: string[] }`),
   - dedupe + cap of returned queries before merge with deterministic query set,
   - explicit runtime knob via GUI and env override.
4. Added SearchProfile artifact lifecycle:
   - write planned profile before provider execution (`status: planned`),
   - write executed profile with per-query stats after execution (`status: executed`),
   - persist to run and latest artifact paths.
5. Added explicit Phase 02 safety/guard outputs:
   - `variant_guard_terms` persisted in SearchProfile artifacts,
   - `alias_reject_log` and `query_reject_log` persisted with reason/stage metadata.
6. Added hard pre-execution identity query guard:
   - rejects off-model queries before provider calls when brand/model token checks fail,
   - rejects missing required model digit groups,
   - rejects likely foreign model tokens (while allowing common units),
   - persists `query_guard` summary (`accepted_query_count`, `rejected_query_count`, guard token sets).
7. Added GUI proof surfaces for Phase 02:
   - run controls: `phase 02 llm searchprofile` + model + token cap,
   - Search Profile panel with alias/query stats, `variant_guard_terms`, guard summary, and reject-log tables,
   - LLM Output Review panel section for SearchProfile aliases/doc_hint/field-target views.
8. Added auditable planner call telemetry:
   - traces/usage include `json_schema_requested`, `retry_without_schema`, and `max_tokens_applied`.

## Delivered Behavior
1. Discovery-enabled runs now produce a deterministic SearchProfile before search calls execute.
2. SearchProfile rows include provenance (`hint_source`, `target_fields`, `doc_hint`, `domain_hint`) and are reused in Phase 03 SERP analysis.
3. Per-query result counts/attempt stats are written back into the executed profile for yield visibility.
4. Phase 02 planner model and token cap are run-time overridable and reflected in artifacts/UI.
5. Query safety auditing is visible and replayable per run (`variant_guard_terms`, alias/query reject logs, guard summary).
6. SearchProfile can be reloaded per selected run via run artifacts/API without re-running the product.

## Verification Completed
1. `node --check src/search/queryBuilder.js`
2. `node --check src/discovery/searchDiscovery.js`
3. `node --test test/queryBuilder.test.js`
4. `node --check src/llm/discoveryPlanner.js`
5. `node --check src/api/guiServer.js`
6. `npm --prefix tools/gui-react run -s build`

## Not In This Slice
1. The planner LLM currently returns query strings only; it does not return a full structured profile object directly.

## GUI Proof Steps
1. Start one run with discovery enabled and provider set, with `phase 02 llm searchprofile` OFF.
2. Open `Search Profile (Phase 02)` and confirm deterministic aliases + query rows are present, with planner shown as off.
3. In the same panel, confirm `variant guard terms` is populated and `query guard summary` shows accepted/rejected counts.
4. Confirm `Query Reject Log` and `Alias Reject Log` tables are visible with reason/stage columns.
5. Start another run with `phase 02 llm searchprofile` ON and pick model/token cap.
5. Confirm Search Profile shows planner enabled + model, and query rows/hit counts populate.
6. Open `LLM Output Review (All Phases)` and confirm the SearchProfile subsection renders aliases, doc hints, and field-target query variants.
