import test from 'node:test';
import assert from 'node:assert/strict';
import { selectFetcherMode } from '../src/fetcher/fetcherMode.js';

test('fetcher mode: dryrun wins over other flags', () => {
  const mode = selectFetcherMode({
    dryRun: true,
    preferHttpFetcher: true,
    dynamicCrawleeEnabled: true
  });
  assert.equal(mode, 'dryrun');
});

test('fetcher mode: http wins when preferHttpFetcher is true', () => {
  const mode = selectFetcherMode({
    dryRun: false,
    preferHttpFetcher: true,
    dynamicCrawleeEnabled: true
  });
  assert.equal(mode, 'http');
});

test('fetcher mode: crawlee selected when enabled and http is off', () => {
  const mode = selectFetcherMode({
    dryRun: false,
    preferHttpFetcher: false,
    dynamicCrawleeEnabled: true
  });
  assert.equal(mode, 'crawlee');
});

test('fetcher mode: defaults to playwright', () => {
  const mode = selectFetcherMode({
    dryRun: false,
    preferHttpFetcher: false,
    dynamicCrawleeEnabled: false
  });
  assert.equal(mode, 'playwright');
});
