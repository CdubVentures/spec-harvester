import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeHttpUrlList,
  shouldQueueLlmRetry,
  buildNextLlmRetryRows,
  collectPlannerPendingUrls,
  normalizeResumeMode,
  isResumeStateFresh,
  selectReextractSeedUrls,
  buildNextSuccessRows
} from '../src/runtime/indexingResume.js';

test('normalizeHttpUrlList dedupes and keeps http(s) only', () => {
  const rows = normalizeHttpUrlList([
    'https://example.com/a',
    'https://example.com/a',
    'http://example.com/b',
    'mailto:test@example.com',
    'not a url',
    'https://example.com/c'
  ], 10);
  assert.deepEqual(rows, [
    'https://example.com/a',
    'http://example.com/b',
    'https://example.com/c'
  ]);
});

test('shouldQueueLlmRetry only returns true for retryable skip reasons', () => {
  assert.equal(shouldQueueLlmRetry({
    reason: 'runtime_override_disable_llm',
    status: 200,
    discoveryOnly: false
  }), true);
  assert.equal(shouldQueueLlmRetry({
    reason: 'llm_budget_guard_blocked',
    status: 200,
    discoveryOnly: false
  }), true);
  assert.equal(shouldQueueLlmRetry({
    reason: 'http_status_source_unavailable',
    status: 503,
    discoveryOnly: false
  }), true);
  assert.equal(shouldQueueLlmRetry({
    reason: 'http_status_not_extractable',
    status: 404,
    discoveryOnly: false
  }), false);
  assert.equal(shouldQueueLlmRetry({
    reason: 'runtime_override_disable_llm',
    status: 200,
    discoveryOnly: true
  }), false);
});

test('buildNextLlmRetryRows merges previous unresolved and new retries', () => {
  const rows = buildNextLlmRetryRows({
    previousRows: [
      {
        url: 'https://example.com/old',
        first_seen_at: '2026-02-10T00:00:00.000Z',
        last_seen_at: '2026-02-10T00:00:00.000Z',
        last_reason: 'runtime_override_disable_llm',
        retry_count: 2
      },
      {
        url: 'https://example.com/attempted',
        first_seen_at: '2026-02-10T00:00:00.000Z',
        last_seen_at: '2026-02-10T00:00:00.000Z',
        last_reason: 'llm_budget_guard_blocked',
        retry_count: 1
      }
    ],
    newReasonByUrl: new Map([
      ['https://example.com/new', 'llm_budget_guard_blocked'],
      ['https://example.com/attempted', 'runtime_override_disable_llm']
    ]),
    attemptedUrls: new Set(['https://example.com/attempted']),
    nowIso: '2026-02-18T00:00:00.000Z',
    limit: 10
  });

  assert.equal(rows.length, 3);
  const byUrl = new Map(rows.map((row) => [row.url, row]));
  assert.equal(byUrl.has('https://example.com/old'), true);
  assert.equal(byUrl.has('https://example.com/new'), true);
  assert.equal(byUrl.has('https://example.com/attempted'), true);
  assert.equal(byUrl.get('https://example.com/new')?.retry_count, 1);
});

test('collectPlannerPendingUrls flattens planner queues', () => {
  const urls = collectPlannerPendingUrls({
    manufacturerQueue: [{ url: 'https://a.com/1' }],
    queue: [{ url: 'https://a.com/2' }],
    candidateQueue: [{ url: 'https://a.com/3' }]
  });
  assert.deepEqual(urls, ['https://a.com/1', 'https://a.com/2', 'https://a.com/3']);
});

test('normalizeResumeMode maps aliases and defaults to auto', () => {
  assert.equal(normalizeResumeMode('auto'), 'auto');
  assert.equal(normalizeResumeMode('resume'), 'force_resume');
  assert.equal(normalizeResumeMode('fresh'), 'start_over');
  assert.equal(normalizeResumeMode('unknown'), 'auto');
});

test('isResumeStateFresh enforces max age window', () => {
  const now = Date.parse('2026-02-18T12:00:00.000Z');
  assert.equal(isResumeStateFresh('2026-02-18T08:00:00.000Z', 6, now), true);
  assert.equal(isResumeStateFresh('2026-02-17T00:00:00.000Z', 6, now), false);
});

test('selectReextractSeedUrls returns stale successes first', () => {
  const urls = selectReextractSeedUrls({
    successRows: [
      { url: 'https://a.com/new', last_success_at: '2026-02-18T11:30:00.000Z' },
      { url: 'https://a.com/old', last_success_at: '2026-02-16T11:00:00.000Z' },
      { url: 'https://a.com/mid', last_success_at: '2026-02-17T00:00:00.000Z' }
    ],
    afterHours: 24,
    limit: 2,
    nowMs: Date.parse('2026-02-18T12:00:00.000Z')
  });
  assert.deepEqual(urls, ['https://a.com/old', 'https://a.com/mid']);
});

test('buildNextSuccessRows merges and updates success metadata', () => {
  const rows = buildNextSuccessRows({
    previousRows: [
      {
        url: 'https://a.com/old',
        last_success_at: '2026-02-10T00:00:00.000Z',
        success_count: 2,
        last_status: 200
      }
    ],
    newSuccessByUrl: new Map([
      ['https://a.com/new', { last_success_at: '2026-02-18T00:00:00.000Z', status: 200 }],
      ['https://a.com/old', { last_success_at: '2026-02-18T01:00:00.000Z', status: 304 }]
    ]),
    nowIso: '2026-02-18T02:00:00.000Z',
    limit: 10
  });
  const byUrl = new Map(rows.map((row) => [row.url, row]));
  assert.equal(byUrl.get('https://a.com/new')?.success_count, 1);
  assert.equal(byUrl.get('https://a.com/old')?.success_count, 3);
  assert.equal(byUrl.get('https://a.com/old')?.last_status, 304);
});
