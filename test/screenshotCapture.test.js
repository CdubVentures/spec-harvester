import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScreenshotConfig,
  parseScreenshotResult,
  ScreenshotQueue
} from '../src/extract/screenshotCapture.js';

// ---------------------------------------------------------------------------
// IP02-2C — Screenshot Capture Lane Tests
// ---------------------------------------------------------------------------

test('screenshot: buildScreenshotConfig creates valid config', () => {
  const config = buildScreenshotConfig({
    url: 'https://example.com/specs',
    selector: 'table.spec-table',
    viewport: { width: 1280, height: 800 }
  });
  assert.equal(config.url, 'https://example.com/specs');
  assert.equal(config.selector, 'table.spec-table');
  assert.equal(config.viewport.width, 1280);
});

test('screenshot: buildScreenshotConfig applies defaults', () => {
  const config = buildScreenshotConfig({ url: 'https://example.com' });
  assert.equal(config.viewport.width, 1920);
  assert.equal(config.viewport.height, 1080);
  assert.equal(config.format, 'png');
  assert.ok(config.timeoutMs > 0);
});

test('screenshot: buildScreenshotConfig validates URL', () => {
  const config = buildScreenshotConfig({ url: '' });
  assert.equal(config.valid, false);
  assert.ok(config.error.includes('URL'));
});

test('screenshot: parseScreenshotResult creates result from buffer', () => {
  const buffer = Buffer.from('fake-image-data');
  const result = parseScreenshotResult({
    url: 'https://example.com',
    buffer,
    elapsedMs: 1500,
    selector: 'table'
  });
  assert.ok(result.ok);
  assert.equal(result.url, 'https://example.com');
  assert.equal(result.bytes, buffer.length);
  assert.equal(result.elapsedMs, 1500);
  assert.ok(result.capturedAt);
});

test('screenshot: parseScreenshotResult handles error', () => {
  const result = parseScreenshotResult({
    url: 'https://example.com',
    error: 'element not found',
    elapsedMs: 500
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'element not found');
  assert.equal(result.bytes, 0);
});

test('screenshot: queue submits and tracks captures', () => {
  const queue = new ScreenshotQueue();
  queue.submit({ url: 'https://a.com', selector: 'table' });
  queue.submit({ url: 'https://b.com' });
  const stats = queue.stats();
  assert.equal(stats.pending, 2);
  assert.equal(stats.total, 2);
});

test('screenshot: queue poll returns next pending', () => {
  const queue = new ScreenshotQueue();
  queue.submit({ url: 'https://a.com' });
  queue.submit({ url: 'https://b.com' });
  const next = queue.poll();
  assert.equal(next.config.url, 'https://a.com');
  assert.equal(next.status, 'running');
});

test('screenshot: queue complete marks job done', () => {
  const queue = new ScreenshotQueue();
  queue.submit({ url: 'https://a.com' });
  const job = queue.poll();
  job.complete(Buffer.from('data'), 200);
  assert.equal(job.status, 'completed');
  assert.equal(queue.stats().completed, 1);
});

test('screenshot: queue fail marks job failed', () => {
  const queue = new ScreenshotQueue();
  queue.submit({ url: 'https://a.com' });
  const job = queue.poll();
  job.fail('timeout');
  assert.equal(job.status, 'failed');
  assert.equal(queue.stats().failed, 1);
});

test('screenshot: queue forUrl returns jobs for a URL', () => {
  const queue = new ScreenshotQueue();
  queue.submit({ url: 'https://a.com', selector: '.spec' });
  queue.submit({ url: 'https://b.com' });
  const jobs = queue.forUrl('https://a.com');
  assert.equal(jobs.length, 1);
});
