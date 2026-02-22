import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyFallbackAction,
  resolveFallbackModes,
  buildFallbackDecision,
  FETCH_OUTCOME_KEYS,
  FALLBACK_ACTIONS,
  FETCHER_MODES
} from '../src/concurrency/fallbackPolicy.js';

describe('classifyFallbackAction', () => {
  it('ok → action none', () => {
    assert.equal(classifyFallbackAction('ok'), 'none');
  });

  it('not_found → action skip', () => {
    assert.equal(classifyFallbackAction('not_found'), 'skip');
  });

  it('blocked (403) → action try_alternate_fetcher', () => {
    assert.equal(classifyFallbackAction('blocked'), 'try_alternate_fetcher');
  });

  it('bot_challenge → action try_alternate_fetcher', () => {
    assert.equal(classifyFallbackAction('bot_challenge'), 'try_alternate_fetcher');
  });

  it('rate_limited (429) → action wait_and_retry_same', () => {
    assert.equal(classifyFallbackAction('rate_limited'), 'wait_and_retry_same');
  });

  it('server_error (5xx) → action try_alternate_fetcher', () => {
    assert.equal(classifyFallbackAction('server_error'), 'try_alternate_fetcher');
  });

  it('network_timeout → action try_alternate_fetcher', () => {
    assert.equal(classifyFallbackAction('network_timeout'), 'try_alternate_fetcher');
  });

  it('fetch_error → action try_alternate_fetcher', () => {
    assert.equal(classifyFallbackAction('fetch_error'), 'try_alternate_fetcher');
  });

  it('bad_content → action skip', () => {
    assert.equal(classifyFallbackAction('bad_content'), 'skip');
  });

  it('login_wall → action skip', () => {
    assert.equal(classifyFallbackAction('login_wall'), 'skip');
  });

  it('unknown outcome → action skip', () => {
    assert.equal(classifyFallbackAction('some_unknown'), 'skip');
  });
});

describe('resolveFallbackModes', () => {
  it('returns correct ladder from crawlee', () => {
    const modes = resolveFallbackModes({ currentMode: 'crawlee', exhaustedModes: [] });
    assert.deepEqual(modes, ['playwright', 'http']);
  });

  it('respects exhausted set', () => {
    const modes = resolveFallbackModes({
      currentMode: 'crawlee',
      exhaustedModes: ['playwright']
    });
    assert.deepEqual(modes, ['http']);
  });

  it('returns empty when all modes exhausted', () => {
    const modes = resolveFallbackModes({
      currentMode: 'crawlee',
      exhaustedModes: ['playwright', 'http']
    });
    assert.deepEqual(modes, []);
  });

  it('returns correct ladder from playwright', () => {
    const modes = resolveFallbackModes({ currentMode: 'playwright', exhaustedModes: [] });
    assert.deepEqual(modes, ['http', 'crawlee']);
  });

  it('returns correct ladder from http', () => {
    const modes = resolveFallbackModes({ currentMode: 'http', exhaustedModes: [] });
    assert.deepEqual(modes, ['crawlee', 'playwright']);
  });
});

describe('buildFallbackDecision', () => {
  it('composes outcome + mode + exhausted for try_alternate', () => {
    const d = buildFallbackDecision({
      outcome: 'blocked',
      currentMode: 'crawlee',
      exhaustedModes: [],
      retryCount: 0,
      maxRetries: 2
    });
    assert.equal(d.action, 'try_alternate_fetcher');
    assert.equal(d.nextMode, 'playwright');
    assert.equal(d.shouldWait, false);
    assert.equal(d.waitMs, 0);
    assert.equal(d.exhausted, false);
  });

  it('wait_and_retry_same for rate_limited', () => {
    const d = buildFallbackDecision({
      outcome: 'rate_limited',
      currentMode: 'crawlee',
      exhaustedModes: [],
      retryCount: 0,
      maxRetries: 2,
      waitMs: 5000
    });
    assert.equal(d.action, 'wait_and_retry_same');
    assert.equal(d.nextMode, 'crawlee');
    assert.equal(d.shouldWait, true);
    assert.equal(d.waitMs, 5000);
    assert.equal(d.exhausted, false);
  });

  it('exhausted when all modes tried', () => {
    const d = buildFallbackDecision({
      outcome: 'blocked',
      currentMode: 'crawlee',
      exhaustedModes: ['playwright', 'http'],
      retryCount: 0,
      maxRetries: 2
    });
    assert.equal(d.action, 'try_alternate_fetcher');
    assert.equal(d.exhausted, true);
    assert.equal(d.nextMode, null);
    assert.ok(d.reason.includes('exhausted'));
  });

  it('exhausted when maxRetries reached', () => {
    const d = buildFallbackDecision({
      outcome: 'blocked',
      currentMode: 'crawlee',
      exhaustedModes: [],
      retryCount: 2,
      maxRetries: 2
    });
    assert.equal(d.exhausted, true);
    assert.equal(d.nextMode, null);
    assert.ok(d.reason.includes('max_retries'));
  });

  it('skip action passes through directly', () => {
    const d = buildFallbackDecision({
      outcome: 'not_found',
      currentMode: 'crawlee',
      exhaustedModes: [],
      retryCount: 0,
      maxRetries: 2
    });
    assert.equal(d.action, 'skip');
    assert.equal(d.nextMode, null);
    assert.equal(d.exhausted, false);
  });

  it('none action passes through directly', () => {
    const d = buildFallbackDecision({
      outcome: 'ok',
      currentMode: 'crawlee',
      exhaustedModes: [],
      retryCount: 0,
      maxRetries: 2
    });
    assert.equal(d.action, 'none');
    assert.equal(d.nextMode, null);
    assert.equal(d.exhausted, false);
  });
});

describe('constants exported', () => {
  it('FETCH_OUTCOME_KEYS contains expected keys', () => {
    assert.ok(FETCH_OUTCOME_KEYS.includes('ok'));
    assert.ok(FETCH_OUTCOME_KEYS.includes('blocked'));
    assert.ok(FETCH_OUTCOME_KEYS.includes('rate_limited'));
    assert.ok(FETCH_OUTCOME_KEYS.includes('not_found'));
  });

  it('FALLBACK_ACTIONS contains expected values', () => {
    assert.ok(FALLBACK_ACTIONS.includes('none'));
    assert.ok(FALLBACK_ACTIONS.includes('skip'));
    assert.ok(FALLBACK_ACTIONS.includes('try_alternate_fetcher'));
    assert.ok(FALLBACK_ACTIONS.includes('wait_and_retry_same'));
  });

  it('FETCHER_MODES contains expected modes', () => {
    assert.ok(FETCHER_MODES.includes('crawlee'));
    assert.ok(FETCHER_MODES.includes('playwright'));
    assert.ok(FETCHER_MODES.includes('http'));
  });
});
