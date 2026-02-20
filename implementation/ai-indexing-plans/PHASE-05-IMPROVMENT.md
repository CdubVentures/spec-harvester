# PHASE-05 IMPROVMENT

## What I'd Add
1. Move from basic concurrency knobs to explicit worker pools (fetch/parse/index/llm lanes).
2. Add host-level in-flight caps and adaptive backoff based on Phase-04 signals.
3. Add startup warm path to reduce first-activity delay after run start.
4. Add queue latency metrics (p50/p95 wait and execution time).

## What We Should Implement Now
1. Consume host budget from Phase-04 before each fetch start.
2. Add explicit skip reasons (`cooldown`, `blocked_budget`, `retry_later`) to events.
3. Add p95 fetch and parse duration cards in the Phase-05 panel.

## Implemented (2026-02-19)
1. Host-budget gating is now applied before fetch start in the run loop.
2. Skip events now emit explicit reasons (`cooldown`, `blocked_budget`, `retry_later`) via `source_fetch_skipped`.
3. Phase-05 GUI now shows p95 fetch + p95 parse latency cards and skip-reason counters.
4. Runtime bridge now forwards timing/budget fields (`fetch_ms`, `parse_ms`, `host_budget_*`, `fetcher_kind`) into IndexLab events so GUI proof is live.
5. Article extraction telemetry is now included in Phase-05 runtime:
   - parse events carry `article_extraction_method`, quality score, char count, low-quality state, and fallback reason.
   - Phase-05 panel now surfaces live article metrics and Event Stream URL rows expose article method/quality columns.

## Definition Of Done
1. Higher useful actions/minute without higher block rate.
2. First visible activity appears quickly and predictably.
3. Throughput bottlenecks are visible per lane.
