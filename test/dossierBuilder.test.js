import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDossier,
  rankSnippets,
  estimateTokenCount
} from '../src/llm/dossierBuilder.js';

// ---------------------------------------------------------------------------
// IP05-5C — Token Efficiency / Dossier Builder Tests
// ---------------------------------------------------------------------------

const SNIPPETS = [
  {
    id: 's1',
    text: 'The mouse weighs 80g and has a HERO 25K sensor.',
    source: 'rtings.com',
    surface: 'readability_text',
    charCount: 48
  },
  {
    id: 's2',
    text: '<table><tr><td>Weight</td><td>80g</td></tr></table>',
    source: 'rtings.com',
    surface: 'table',
    charCount: 52
  },
  {
    id: 's3',
    text: 'Buy now! Free shipping! Click here! Subscribe!',
    source: 'ads.com',
    surface: 'raw_html',
    charCount: 47
  },
  {
    id: 's4',
    text: 'The sensor is the HERO 25K with 25,600 DPI maximum tracking.',
    source: 'logitech.com',
    surface: 'readability_text',
    charCount: 59
  },
  {
    id: 's5',
    text: 'Polling rate: 1000 Hz. Click latency: 0.5ms. Weight: 80 grams without cable.',
    source: 'rtings.com',
    surface: 'readability_text',
    charCount: 75
  }
];

const TARGET_FIELDS = ['weight', 'sensor', 'polling_rate', 'dpi'];

test('dossier: ranks readability_text and table above raw_html', () => {
  const ranked = rankSnippets({ snippets: SNIPPETS, targetFields: TARGET_FIELDS });
  const rawIndex = ranked.findIndex((s) => s.id === 's3');
  const textIndex = ranked.findIndex((s) => s.id === 's1');
  assert.ok(textIndex < rawIndex, 'readability_text should rank above raw_html');
});

test('dossier: snippets with target field keywords rank higher', () => {
  const ranked = rankSnippets({ snippets: SNIPPETS, targetFields: ['polling_rate'] });
  assert.equal(ranked[0].id, 's5'); // contains "polling rate"
});

test('dossier: estimateTokenCount approximates from chars', () => {
  const count = estimateTokenCount('hello world this is a test');
  assert.ok(count > 0);
  assert.ok(count < 20);
});

test('dossier: buildDossier caps payload to maxTokens', () => {
  const result = buildDossier({
    snippets: SNIPPETS,
    targetFields: TARGET_FIELDS,
    maxTokens: 30 // very low cap
  });
  assert.ok(result.snippets.length < SNIPPETS.length);
  assert.ok(result.total_tokens <= 30);
  assert.ok(result.truncated);
});

test('dossier: buildDossier includes all snippets when budget allows', () => {
  const result = buildDossier({
    snippets: SNIPPETS,
    targetFields: TARGET_FIELDS,
    maxTokens: 50_000
  });
  assert.equal(result.snippets.length, SNIPPETS.length);
  assert.equal(result.truncated, false);
});

test('dossier: buildDossier returns metadata', () => {
  const result = buildDossier({
    snippets: SNIPPETS,
    targetFields: TARGET_FIELDS,
    maxTokens: 50_000
  });
  assert.ok(result.total_tokens > 0);
  assert.equal(result.input_count, SNIPPETS.length);
  assert.equal(result.output_count, SNIPPETS.length);
  assert.ok(Array.isArray(result.snippets));
});

test('dossier: buildDossier prefers high-value snippets when truncating', () => {
  const result = buildDossier({
    snippets: SNIPPETS,
    targetFields: TARGET_FIELDS,
    maxTokens: 50 // tight budget
  });
  // raw_html ad snippet should be dropped first
  const ids = result.snippets.map((s) => s.id);
  assert.ok(!ids.includes('s3'), 'ad snippet should be dropped');
});

test('dossier: handles empty snippets', () => {
  const result = buildDossier({ snippets: [], targetFields: TARGET_FIELDS, maxTokens: 1000 });
  assert.equal(result.snippets.length, 0);
  assert.equal(result.total_tokens, 0);
  assert.equal(result.truncated, false);
});

test('dossier: handles empty target fields', () => {
  const ranked = rankSnippets({ snippets: SNIPPETS, targetFields: [] });
  assert.equal(ranked.length, SNIPPETS.length);
});

test('dossier: ranking score is numeric and finite', () => {
  const ranked = rankSnippets({ snippets: SNIPPETS, targetFields: TARGET_FIELDS });
  for (const snippet of ranked) {
    assert.ok(Number.isFinite(snippet._relevanceScore));
  }
});
