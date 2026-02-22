import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { IndexLabRuntimeBridge } from '../src/indexlab/runtimeBridge.js';

async function makeBridge(overrides = {}) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-audit-'));
  const events = [];
  const bridge = new IndexLabRuntimeBridge({
    outRoot: tmpDir,
    onEvent: (ev) => events.push(ev),
    ...overrides
  });
  return { bridge, events, tmpDir };
}

function baseRow(overrides = {}) {
  return {
    runId: 'run-audit-001',
    event: 'run_started',
    ts: '2025-01-01T00:00:00Z',
    category: 'mouse',
    productId: 'mouse-test-01',
    ...overrides
  };
}

async function startRun(bridge) {
  bridge.onRuntimeEvent(baseRow());
  await bridge.queue;
}

test('visual_asset_captured event is emitted by bridge', async () => {
  const { bridge, events } = await makeBridge();
  await startRun(bridge);

  bridge.onRuntimeEvent(baseRow({
    event: 'visual_asset_captured',
    ts: '2025-01-01T00:01:00Z',
    url: 'https://razer.com/viper',
    screenshot_uri: 'screenshots/viper-001.webp',
    quality_score: 0.85,
    width: 1920,
    height: 1080,
    format: 'webp',
    bytes: 45000,
    capture_ms: 320
  }));
  await bridge.queue;

  const captured = events.filter((e) => e.event === 'visual_asset_captured');
  assert.equal(captured.length, 1, 'should emit visual_asset_captured');
  assert.equal(captured[0].payload.url, 'https://razer.com/viper');
  assert.equal(captured[0].payload.screenshot_uri, 'screenshots/viper-001.webp');
  assert.equal(captured[0].stage, 'fetch');
});

test('run_completed event is emitted by bridge', async () => {
  const { bridge, events } = await makeBridge();
  await startRun(bridge);

  bridge.onRuntimeEvent(baseRow({
    event: 'run_completed',
    ts: '2025-01-01T00:10:00Z',
    identity_fingerprint: 'fp-abc',
    identity_lock_status: 'locked',
    dedupe_mode: 'content_hash',
    phase_cursor: 'completed'
  }));
  await bridge.queue;

  const completed = events.filter((e) => e.event === 'run_completed');
  assert.equal(completed.length, 1, 'should emit run_completed');
  assert.equal(completed[0].payload.identity_fingerprint, 'fp-abc');
  assert.equal(completed[0].stage, 'runtime');
});

test('source_processed triggers parse_finished and fetch_finished', async () => {
  const { bridge, events } = await makeBridge();
  await startRun(bridge);

  bridge.onRuntimeEvent(baseRow({
    event: 'source_fetch_started',
    ts: '2025-01-01T00:00:30Z',
    url: 'https://razer.com/viper',
    host: 'razer.com',
    tier: 1
  }));
  await bridge.queue;

  bridge.onRuntimeEvent(baseRow({
    event: 'source_processed',
    ts: '2025-01-01T00:01:00Z',
    url: 'https://razer.com/viper',
    status: 200,
    candidate_count: 5,
    fetch_ms: 300,
    parse_ms: 50,
    host: 'razer.com'
  }));
  await bridge.queue;

  const fetchFinished = events.filter((e) => e.event === 'fetch_finished');
  assert.ok(fetchFinished.length >= 1, 'source_processed should trigger fetch_finished');

  const parseFinished = events.filter((e) => e.event === 'parse_finished');
  assert.equal(parseFinished.length, 1, 'source_processed should trigger parse_finished');
  assert.equal(parseFinished[0].payload.url, 'https://razer.com/viper');
  assert.equal(parseFinished[0].payload.candidate_count, 5);
});

test('all spec events have handlers: search, fetch, parse, index, llm, needset', async () => {
  const { bridge, events } = await makeBridge();
  await startRun(bridge);

  bridge.onRuntimeEvent(baseRow({
    event: 'discovery_query_started',
    ts: '2025-01-01T00:00:10Z',
    query: 'razer viper specs',
    provider: 'google'
  }));
  await bridge.queue;

  bridge.onRuntimeEvent(baseRow({
    event: 'discovery_query_completed',
    ts: '2025-01-01T00:00:15Z',
    query: 'razer viper specs',
    provider: 'google',
    result_count: 10
  }));
  await bridge.queue;

  const searchStarted = events.filter((e) => e.event === 'search_started' && e.payload.scope === 'query');
  assert.equal(searchStarted.length, 1, 'discovery_query_started → search_started');

  const searchFinished = events.filter((e) => e.event === 'search_finished' && e.payload.scope === 'query');
  assert.equal(searchFinished.length, 1, 'discovery_query_completed → search_finished');

  bridge.onRuntimeEvent(baseRow({
    event: 'source_fetch_started',
    ts: '2025-01-01T00:00:20Z',
    url: 'https://razer.com',
    host: 'razer.com',
    tier: 1
  }));
  await bridge.queue;

  const fetchStartedUrl = events.filter((e) => e.event === 'fetch_started' && e.payload.scope === 'url');
  assert.equal(fetchStartedUrl.length, 1, 'source_fetch_started → fetch_started (url scope)');

  bridge.onRuntimeEvent(baseRow({
    event: 'llm_call_started',
    ts: '2025-01-01T00:00:30Z',
    reason: 'extract_candidates',
    model: 'gpt-4o',
    route_role: 'extract'
  }));
  await bridge.queue;

  const llmStarted = events.filter((e) => e.event === 'llm_started');
  assert.equal(llmStarted.length, 1, 'llm_call_started → llm_started');

  bridge.onRuntimeEvent(baseRow({
    event: 'needset_computed',
    ts: '2025-01-01T00:01:00Z',
    total_fields: 30,
    needset_size: 12,
    needs: []
  }));
  await bridge.queue;

  const needset = events.filter((e) => e.event === 'needset_computed');
  assert.equal(needset.length, 1, 'needset_computed emitted');
});

test('finalize clears fetchByUrl map to prevent memory leak', async () => {
  const { bridge } = await makeBridge();
  await startRun(bridge);

  bridge.onRuntimeEvent(baseRow({
    event: 'source_fetch_started',
    ts: '2025-01-01T00:00:30Z',
    url: 'https://razer.com/viper',
    host: 'razer.com',
    tier: 1
  }));
  await bridge.queue;

  assert.equal(bridge.fetchByUrl.size, 1, 'fetchByUrl should track in-flight fetch');

  await bridge.finalize({ status: 'completed' });

  assert.equal(bridge.fetchByUrl.size, 0, 'fetchByUrl should be cleared after finalize');
});

test('scheduler_fallback_started is emitted under fetch stage', async () => {
  const { bridge, events } = await makeBridge();
  await startRun(bridge);

  bridge.onRuntimeEvent(baseRow({
    event: 'scheduler_fallback_started',
    ts: '2025-01-01T00:02:00Z',
    url: 'https://blocked.com/page',
    from_mode: 'crawlee',
    to_mode: 'playwright',
    outcome: 'blocked',
    attempt: 1
  }));
  await bridge.queue;

  const started = events.filter((e) => e.event === 'scheduler_fallback_started');
  assert.equal(started.length, 1);
  assert.equal(started[0].stage, 'fetch');
  assert.equal(started[0].payload.url, 'https://blocked.com/page');
  assert.equal(started[0].payload.from_mode, 'crawlee');
  assert.equal(started[0].payload.to_mode, 'playwright');
  assert.equal(started[0].payload.outcome, 'blocked');
  assert.equal(started[0].payload.attempt, 1);
});

test('scheduler_fallback_succeeded is emitted under fetch stage', async () => {
  const { bridge, events } = await makeBridge();
  await startRun(bridge);

  bridge.onRuntimeEvent(baseRow({
    event: 'scheduler_fallback_succeeded',
    ts: '2025-01-01T00:02:30Z',
    url: 'https://blocked.com/page',
    mode: 'playwright',
    attempt: 1,
    from_mode: 'crawlee'
  }));
  await bridge.queue;

  const succeeded = events.filter((e) => e.event === 'scheduler_fallback_succeeded');
  assert.equal(succeeded.length, 1);
  assert.equal(succeeded[0].stage, 'fetch');
  assert.equal(succeeded[0].payload.url, 'https://blocked.com/page');
  assert.equal(succeeded[0].payload.mode, 'playwright');
  assert.equal(succeeded[0].payload.from_mode, 'crawlee');
});

test('scheduler_fallback_exhausted is emitted under fetch stage', async () => {
  const { bridge, events } = await makeBridge();
  await startRun(bridge);

  bridge.onRuntimeEvent(baseRow({
    event: 'scheduler_fallback_exhausted',
    ts: '2025-01-01T00:03:00Z',
    url: 'https://blocked.com/page',
    modes_tried: ['crawlee', 'playwright', 'http'],
    final_outcome: 'blocked'
  }));
  await bridge.queue;

  const exhausted = events.filter((e) => e.event === 'scheduler_fallback_exhausted');
  assert.equal(exhausted.length, 1);
  assert.equal(exhausted[0].stage, 'fetch');
  assert.equal(exhausted[0].payload.url, 'https://blocked.com/page');
  assert.deepEqual(exhausted[0].payload.modes_tried, ['crawlee', 'playwright', 'http']);
  assert.equal(exhausted[0].payload.final_outcome, 'blocked');
});
