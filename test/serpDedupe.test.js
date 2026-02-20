import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeSerpResults } from '../src/search/serpDedupe.js';

// ---------------------------------------------------------------------------
// Phase 13 — Cross-provider SERP Deduplication Tests
// ---------------------------------------------------------------------------

// =========================================================================
// SECTION 1: Basic deduplication
// =========================================================================

test('serp dedupe: removes duplicate URLs across providers', () => {
  const results = [
    { url: 'https://rtings.com/mouse/reviews/razer-viper-v3-pro', provider: 'google', query: 'razer viper v3 pro specs' },
    { url: 'https://rtings.com/mouse/reviews/razer-viper-v3-pro', provider: 'bing', query: 'razer viper v3 pro review' },
    { url: 'https://razer.com/mice/razer-viper-v3-pro', provider: 'google', query: 'razer viper v3 pro specs' }
  ];
  const { deduped, stats } = dedupeSerpResults(results);
  assert.equal(deduped.length, 2);
  assert.equal(stats.duplicates_removed, 1);
  assert.equal(stats.total_input, 3);
});

test('serp dedupe: keeps best-ranked entry', () => {
  const results = [
    { url: 'https://example.com/low-rank', provider: 'google', title: 'Low rank' },
    { url: 'https://rtings.com/review', provider: 'bing', title: 'Bing found first' },
    { url: 'https://rtings.com/review', provider: 'google', title: 'Google found second' }
  ];
  const { deduped } = dedupeSerpResults(results);
  const rtings = deduped.find((r) => r.canonical_url.includes('rtings'));
  assert.equal(rtings.provider, 'bing'); // bing had lower index
  assert.equal(rtings.title, 'Bing found first');
});

test('serp dedupe: tracks all providers that found the URL', () => {
  const results = [
    { url: 'https://example.com/page', provider: 'google' },
    { url: 'https://example.com/page', provider: 'bing' },
    { url: 'https://example.com/page', provider: 'duckduckgo' }
  ];
  const { deduped } = dedupeSerpResults(results);
  assert.equal(deduped.length, 1);
  assert.deepEqual(deduped[0].seen_by_providers.sort(), ['bing', 'duckduckgo', 'google']);
  assert.equal(deduped[0].cross_provider_count, 3);
});

// =========================================================================
// SECTION 2: URL normalization for dedupe
// =========================================================================

test('serp dedupe: strips tracking params for comparison', () => {
  const results = [
    { url: 'https://example.com/page?utm_source=google&q=test', provider: 'google' },
    { url: 'https://example.com/page?utm_source=bing&q=test', provider: 'bing' }
  ];
  const { deduped } = dedupeSerpResults(results);
  assert.equal(deduped.length, 1);
});

test('serp dedupe: normalizes trailing slashes', () => {
  const results = [
    { url: 'https://example.com/page/', provider: 'google' },
    { url: 'https://example.com/page', provider: 'bing' }
  ];
  const { deduped } = dedupeSerpResults(results);
  assert.equal(deduped.length, 1);
});

test('serp dedupe: case-insensitive host comparison', () => {
  const results = [
    { url: 'https://Example.COM/page', provider: 'google' },
    { url: 'https://example.com/page', provider: 'bing' }
  ];
  const { deduped } = dedupeSerpResults(results);
  assert.equal(deduped.length, 1);
});

// =========================================================================
// SECTION 3: Query tracking
// =========================================================================

test('serp dedupe: merges queries from different providers', () => {
  const results = [
    { url: 'https://example.com/page', provider: 'google', query: 'query one' },
    { url: 'https://example.com/page', provider: 'bing', query: 'query two' }
  ];
  const { deduped } = dedupeSerpResults(results);
  assert.deepEqual(deduped[0].seen_in_queries.sort(), ['query one', 'query two']);
});

// =========================================================================
// SECTION 4: Stats
// =========================================================================

test('serp dedupe: stats track all providers seen', () => {
  const results = [
    { url: 'https://a.com', provider: 'google' },
    { url: 'https://b.com', provider: 'bing' },
    { url: 'https://c.com', provider: 'searxng' }
  ];
  const { stats } = dedupeSerpResults(results);
  assert.deepEqual(stats.providers_seen.sort(), ['bing', 'google', 'searxng']);
  assert.equal(stats.duplicates_removed, 0);
});

// =========================================================================
// SECTION 5: Edge cases
// =========================================================================

test('serp dedupe: handles empty input', () => {
  const { deduped, stats } = dedupeSerpResults([]);
  assert.equal(deduped.length, 0);
  assert.equal(stats.total_input, 0);
});

test('serp dedupe: handles null input', () => {
  const { deduped } = dedupeSerpResults(null);
  assert.equal(deduped.length, 0);
});

test('serp dedupe: skips entries with no URL', () => {
  const results = [
    { url: 'https://example.com', provider: 'google' },
    { provider: 'bing', title: 'no url' },
    { url: '', provider: 'bing' }
  ];
  const { deduped } = dedupeSerpResults(results);
  assert.equal(deduped.length, 1);
});

test('serp dedupe: preserves original result order (by rank)', () => {
  const results = [
    { url: 'https://first.com', provider: 'google' },
    { url: 'https://second.com', provider: 'google' },
    { url: 'https://third.com', provider: 'google' }
  ];
  const { deduped } = dedupeSerpResults(results);
  assert.equal(deduped[0].url, 'https://first.com');
  assert.equal(deduped[1].url, 'https://second.com');
  assert.equal(deduped[2].url, 'https://third.com');
});

test('serp dedupe: strips fbclid and gclid params', () => {
  const results = [
    { url: 'https://example.com/page?fbclid=abc123', provider: 'google' },
    { url: 'https://example.com/page?gclid=xyz789', provider: 'bing' }
  ];
  const { deduped } = dedupeSerpResults(results);
  assert.equal(deduped.length, 1);
});
