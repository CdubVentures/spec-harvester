import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('config: parses crawlee env flags', () => {
  const prevEnabled = process.env.DYNAMIC_CRAWLEE_ENABLED;
  const prevHeadless = process.env.CRAWLEE_HEADLESS;
  const prevTimeout = process.env.CRAWLEE_REQUEST_HANDLER_TIMEOUT_SECS;
  try {
    process.env.DYNAMIC_CRAWLEE_ENABLED = 'true';
    process.env.CRAWLEE_HEADLESS = 'false';
    process.env.CRAWLEE_REQUEST_HANDLER_TIMEOUT_SECS = '75';

    const cfg = loadConfig({ runProfile: 'standard' });
    assert.equal(cfg.dynamicCrawleeEnabled, true);
    assert.equal(cfg.crawleeHeadless, false);
    assert.equal(cfg.crawleeRequestHandlerTimeoutSecs, 75);
  } finally {
    if (prevEnabled === undefined) delete process.env.DYNAMIC_CRAWLEE_ENABLED;
    else process.env.DYNAMIC_CRAWLEE_ENABLED = prevEnabled;
    if (prevHeadless === undefined) delete process.env.CRAWLEE_HEADLESS;
    else process.env.CRAWLEE_HEADLESS = prevHeadless;
    if (prevTimeout === undefined) delete process.env.CRAWLEE_REQUEST_HANDLER_TIMEOUT_SECS;
    else process.env.CRAWLEE_REQUEST_HANDLER_TIMEOUT_SECS = prevTimeout;
  }
});
