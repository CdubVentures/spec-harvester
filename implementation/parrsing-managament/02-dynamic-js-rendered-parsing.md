# 02 - Dynamic JS-Rendered Parsing

## Goal
Increase reliability and throughput of JS-rendered extraction while keeping network/API payload capture first-class.

## Status
- Started now:
  - Added optional Crawlee fetch backend (`CrawleeFetcher`) and wired runtime fetcher selection.
  - Added per-domain dynamic fetch policy resolution in `src/fetcher/dynamicFetchPolicy.js`.
  - Wired policy application into Playwright and HTTP fetchers in `src/fetcher/playwrightFetcher.js`.
  - Added domain-aware retry budget and retry backoff controls for transient failures.
  - Added config support for `DYNAMIC_FETCH_POLICY_MAP_JSON` in `src/config.js`.
  - Added global retry env knobs:
    - `DYNAMIC_FETCH_RETRY_BUDGET`
    - `DYNAMIC_FETCH_RETRY_BACKOFF_MS`
  - Added tests:
    - `test/dynamicFetchPolicy.test.js`
    - `test/configDynamicFetchPolicy.test.js`
    - `test/fetcherRetry.test.js`
  - Added GUI runtime knobs (with tooltips) under `Runtime Settings -> Phase 02 dynamic parsing knobs`:
    - `crawlee enabled` (default: on)
    - `crawlee headless` (default: on)
    - `retry budget` (default: 1)
    - `retry backoff ms` (default: 500)
    - `handler timeout s` (default: 45)
    - `domain policy json (advanced)` (optional per-run JSON override)

## Why This Is Better
- Accuracy:
  - Domain-specific waits/timeouts reduce partial renders and missed JSON payloads on JS-heavy sites.
- Performance:
  - Fast domains can use tighter timeouts while slow domains get targeted budget, improving overall throughput.
- Stability:
  - Per-domain replay caps and delays reduce noisy failures and avoid global over-tuning.
  - Retry budgets recover transient `timeout` / `429` / `5xx` failures without over-retrying.
  - Crawlee backend gives cleaner path to scale orchestration without replacing extraction logic.

## Quick Config Example
```json
{
  "example.com": {
    "perHostMinDelayMs": 250,
    "pageGotoTimeoutMs": 12000,
    "pageNetworkIdleTimeoutMs": 3000,
    "postLoadWaitMs": 500,
    "autoScrollEnabled": true,
    "autoScrollPasses": 1,
    "autoScrollDelayMs": 600,
    "graphqlReplayEnabled": true,
    "maxGraphqlReplays": 3,
    "retryBudget": 1,
    "retryBackoffMs": 500
  }
}
```
- Put this JSON into env var: `DYNAMIC_FETCH_POLICY_MAP_JSON`.
- Enable Crawlee backend with env:
  - `DYNAMIC_CRAWLEE_ENABLED=true`

## Current State
- Primary code paths:
  - `src/fetcher/playwrightFetcher.js`
  - `src/fetcher/networkRecorder.js`
  - `src/fetcher/graphqlReplay.js`
- Strengths:
  - Captures post-render DOM.
  - Captures XHR/GraphQL JSON responses.
  - Replays GraphQL requests for deeper payload retrieval.
- Weaknesses:
  - Browser cost can dominate runtime.
  - Session orchestration is custom and limited for scale.
  - Limited retry/session/proxy policy controls.

## Missing But Should Use
- `crawlee` for:
  - Queue orchestration
  - Session pools
  - Retry/backoff strategies
  - Proxy rotation policy support

## Target Design
- Render stack:
  - Playwright remains renderer.
  - Crawlee becomes orchestration layer for scale mode.
- Multi-surface capture:
  - Rendered HTML
  - Network JSON payloads
  - GraphQL replay payloads
- Output contract:
  - `page_data` + `network_payloads` + `replay_payloads`
  - Unified payload scoring for evidence pack ingestion.

## Implementation Plan
1. Add `dynamicCrawlerService` wrapper with optional Crawlee backend.
2. Preserve existing Playwright fetcher as non-scale fallback.
3. Add per-domain policy profile:
  - timeout
  - waits
  - max replays
  - retry budget
4. Add lifecycle telemetry: navigation, render wait, payload capture, replay.
5. Add domain-level performance dashboards.

## Validation
- Unit tests:
  - Response capture classification.
  - Replay dedupe and redaction behavior.
- Integration tests:
  - JS-heavy product pages with delayed payloads.
- Success metrics:
  - +25% useful payload coverage on JS pages.
  - No increase in fetch error rate at same concurrency.

## Rollout
- Feature flag: `DYNAMIC_CRAWLEE_ENABLED=true`.
- Start with 1 domain pilot.
- Revert automatically to current Playwright mode on repeated failures.
