import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFetchResult,
  buildFetchError,
  isFetchResultDead,
  shouldExtract,
  summarizeFetchResult
} from '../src/fetcher/fetchResult.js';

// ---------------------------------------------------------------------------
// IP01-1D — Standardized FetchResult Tests
// ---------------------------------------------------------------------------

// =========================================================================
// SECTION 1: buildFetchResult — happy path
// =========================================================================

test('fetchResult: builds normalized result from 200 response', () => {
  const result = buildFetchResult({
    url: 'https://example.com/specs',
    finalUrl: 'https://example.com/specs',
    status: 200,
    contentType: 'text/html; charset=utf-8',
    bytes: 12345,
    elapsedMs: 850
  });
  assert.equal(result.url, 'https://example.com/specs');
  assert.equal(result.final_url, 'https://example.com/specs');
  assert.equal(result.status, 200);
  assert.equal(result.content_type, 'text/html');
  assert.equal(result.bytes, 12345);
  assert.equal(result.elapsed_ms, 850);
  assert.equal(result.error, null);
  assert.equal(result.ok, true);
  assert.equal(result.dead, false);
  assert.equal(result.redirect, false);
  assert.ok(result.fetched_at);
});

test('fetchResult: detects redirect when finalUrl differs', () => {
  const result = buildFetchResult({
    url: 'https://example.com/old',
    finalUrl: 'https://example.com/new',
    status: 200
  });
  assert.equal(result.redirect, true);
});

test('fetchResult: computes bytes from html when bytes not provided', () => {
  const html = '<h1>Hello World</h1>';
  const result = buildFetchResult({
    url: 'https://example.com',
    status: 200,
    html
  });
  assert.equal(result.bytes, Buffer.byteLength(html, 'utf8'));
});

// =========================================================================
// SECTION 2: Dead URL detection
// =========================================================================

test('fetchResult: marks 404 as dead', () => {
  const result = buildFetchResult({
    url: 'https://example.com/gone',
    status: 404
  });
  assert.equal(result.dead, true);
  assert.equal(result.ok, false);
});

test('fetchResult: marks 410 as dead', () => {
  const result = buildFetchResult({
    url: 'https://example.com/removed',
    status: 410
  });
  assert.equal(result.dead, true);
});

test('fetchResult: marks 451 (robots blocked) as dead', () => {
  const result = buildFetchResult({
    url: 'https://example.com/blocked',
    status: 451,
    blockedByRobots: true
  });
  assert.equal(result.dead, true);
  assert.equal(result.blocked_by_robots, true);
});

test('fetchResult: isFetchResultDead works on result object', () => {
  assert.equal(isFetchResultDead(buildFetchResult({ url: 'x', status: 404 })), true);
  assert.equal(isFetchResultDead(buildFetchResult({ url: 'x', status: 200 })), false);
  assert.equal(isFetchResultDead(null), false);
});

// =========================================================================
// SECTION 3: Error handling
// =========================================================================

test('fetchResult: buildFetchError creates error result', () => {
  const result = buildFetchError({
    url: 'https://example.com/timeout',
    error: new Error('ETIMEDOUT'),
    elapsedMs: 30000
  });
  assert.equal(result.url, 'https://example.com/timeout');
  assert.equal(result.status, 0);
  assert.equal(result.error, 'ETIMEDOUT');
  assert.equal(result.ok, false);
  assert.equal(result.elapsed_ms, 30000);
});

test('fetchResult: buildFetchError handles string error', () => {
  const result = buildFetchError({
    url: 'https://example.com',
    error: 'connection_refused'
  });
  assert.equal(result.error, 'connection_refused');
});

// =========================================================================
// SECTION 4: shouldExtract
// =========================================================================

test('fetchResult: shouldExtract true for 200 OK', () => {
  const result = buildFetchResult({ url: 'x', status: 200 });
  assert.equal(shouldExtract(result), true);
});

test('fetchResult: shouldExtract false for 404', () => {
  const result = buildFetchResult({ url: 'x', status: 404 });
  assert.equal(shouldExtract(result), false);
});

test('fetchResult: shouldExtract false for error', () => {
  const result = buildFetchResult({ url: 'x', status: 200, error: 'parse_failed' });
  assert.equal(shouldExtract(result), false);
});

test('fetchResult: shouldExtract false for robots blocked', () => {
  const result = buildFetchResult({ url: 'x', status: 451, blockedByRobots: true });
  assert.equal(shouldExtract(result), false);
});

test('fetchResult: shouldExtract false for null', () => {
  assert.equal(shouldExtract(null), false);
});

// =========================================================================
// SECTION 5: summarizeFetchResult
// =========================================================================

test('fetchResult: summarize extracts key fields', () => {
  const full = buildFetchResult({
    url: 'https://example.com',
    finalUrl: 'https://example.com/final',
    status: 301,
    contentType: 'text/html',
    bytes: 5000,
    elapsedMs: 1200
  });
  const summary = summarizeFetchResult(full);
  assert.equal(summary.url, 'https://example.com');
  assert.equal(summary.final_url, 'https://example.com/final');
  assert.equal(summary.status, 301);
  assert.equal(summary.redirect, true);
  assert.equal(typeof summary.ok, 'boolean');
});

test('fetchResult: summarize handles null', () => {
  const summary = summarizeFetchResult(null);
  assert.equal(summary.url, '');
  assert.equal(summary.ok, false);
});

// =========================================================================
// SECTION 6: Edge cases
// =========================================================================

test('fetchResult: handles missing/undefined fields gracefully', () => {
  const result = buildFetchResult({});
  assert.equal(result.url, '');
  assert.equal(result.status, 0);
  assert.equal(result.ok, false);
  assert.equal(result.bytes, 0);
  assert.equal(result.elapsed_ms, 0);
});

test('fetchResult: content_type strips charset suffix', () => {
  const result = buildFetchResult({
    url: 'x',
    status: 200,
    contentType: 'application/json; charset=utf-8'
  });
  assert.equal(result.content_type, 'application/json');
});

test('fetchResult: 3xx status with no error is ok', () => {
  const result = buildFetchResult({ url: 'x', status: 301 });
  assert.equal(result.ok, true);
  assert.equal(result.dead, false);
});
