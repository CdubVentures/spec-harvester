import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

describe('FetchScheduler config knobs', () => {
  it('fetchSchedulerEnabled defaults to false', () => {
    const config = loadConfig({});
    assert.equal(config.fetchSchedulerEnabled, false);
  });

  it('fetchSchedulerMaxRetries defaults to 1', () => {
    const config = loadConfig({});
    assert.equal(config.fetchSchedulerMaxRetries, 1);
  });

  it('fetchSchedulerFallbackWaitMs defaults to 60000', () => {
    const config = loadConfig({});
    assert.equal(config.fetchSchedulerFallbackWaitMs, 60000);
  });
});
