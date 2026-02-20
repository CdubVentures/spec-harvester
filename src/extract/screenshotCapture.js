/**
 * Screenshot Capture Lane (IP02-2C).
 *
 * Playwright-based screenshot capture for visual spec tables.
 * Provides a queue system for async capture with element selectors.
 *
 * The actual Playwright browser interaction is in captureScreenshot().
 * The rest of the module (config, parsing, queue) works without Playwright.
 */

let _captureCounter = 0;

/**
 * Build a validated screenshot config.
 */
export function buildScreenshotConfig({
  url = '',
  selector = null,
  viewport = {},
  format = 'png',
  timeoutMs = 30_000,
  waitForSelector = null,
  fullPage = false
} = {}) {
  const normalizedUrl = String(url || '').trim();
  if (!normalizedUrl) {
    return { valid: false, error: 'URL is required', url: '' };
  }

  return {
    valid: true,
    url: normalizedUrl,
    selector: selector || null,
    viewport: {
      width: Number(viewport.width) || 1920,
      height: Number(viewport.height) || 1080
    },
    format: format === 'jpeg' ? 'jpeg' : 'png',
    timeoutMs: Math.max(5000, Number(timeoutMs) || 30_000),
    waitForSelector: waitForSelector || selector || null,
    fullPage: Boolean(fullPage)
  };
}

/**
 * Parse a screenshot capture result into a standard format.
 */
export function parseScreenshotResult({
  url = '',
  buffer = null,
  error = null,
  elapsedMs = 0,
  selector = null
} = {}) {
  return {
    ok: Boolean(buffer && !error),
    url: String(url || ''),
    selector: selector || null,
    bytes: buffer ? buffer.length : 0,
    elapsedMs: Number(elapsedMs) || 0,
    error: error ? String(error) : null,
    capturedAt: new Date().toISOString()
  };
}

/**
 * Capture a screenshot using Playwright.
 * Requires Playwright to be installed.
 */
export async function captureScreenshot(config) {
  const { chromium } = await import('playwright');
  const startMs = Date.now();
  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: config.viewport
    });
    const page = await context.newPage();
    await page.goto(config.url, {
      waitUntil: 'networkidle',
      timeout: config.timeoutMs
    });

    if (config.waitForSelector) {
      await page.waitForSelector(config.waitForSelector, {
        timeout: Math.min(config.timeoutMs, 10_000)
      });
    }

    let buffer;
    if (config.selector) {
      const element = await page.$(config.selector);
      if (!element) {
        return parseScreenshotResult({
          url: config.url,
          error: `Element not found: ${config.selector}`,
          elapsedMs: Date.now() - startMs,
          selector: config.selector
        });
      }
      buffer = await element.screenshot({ type: config.format });
    } else {
      buffer = await page.screenshot({
        type: config.format,
        fullPage: config.fullPage
      });
    }

    return parseScreenshotResult({
      url: config.url,
      buffer,
      elapsedMs: Date.now() - startMs,
      selector: config.selector
    });
  } catch (err) {
    return parseScreenshotResult({
      url: config.url,
      error: err.message,
      elapsedMs: Date.now() - startMs,
      selector: config.selector
    });
  } finally {
    if (browser) await browser.close();
  }
}

// --- Queue ---

class ScreenshotJob {
  constructor(config) {
    this.id = `ss-${++_captureCounter}-${Date.now()}`;
    this.config = config;
    this.status = 'pending';
    this.result = null;
    this.error = null;
    this._createdAt = Date.now();
  }

  complete(buffer, elapsedMs) {
    this.status = 'completed';
    this.result = parseScreenshotResult({
      url: this.config.url,
      buffer,
      elapsedMs,
      selector: this.config.selector
    });
  }

  fail(error) {
    this.status = 'failed';
    this.error = String(error || 'unknown');
    this.result = parseScreenshotResult({
      url: this.config.url,
      error: this.error,
      elapsedMs: Date.now() - this._createdAt,
      selector: this.config.selector
    });
  }
}

export class ScreenshotQueue {
  constructor() {
    this._jobs = [];
  }

  submit(configParams) {
    const config = buildScreenshotConfig(configParams);
    const job = new ScreenshotJob(config);
    this._jobs.push(job);
    return job;
  }

  poll() {
    for (const job of this._jobs) {
      if (job.status === 'pending') {
        job.status = 'running';
        return job;
      }
    }
    return null;
  }

  forUrl(url) {
    const normalized = String(url || '').trim();
    return this._jobs.filter((j) => j.config.url === normalized);
  }

  stats() {
    let pending = 0, running = 0, completed = 0, failed = 0;
    for (const job of this._jobs) {
      if (job.status === 'pending') pending += 1;
      else if (job.status === 'running') running += 1;
      else if (job.status === 'completed') completed += 1;
      else if (job.status === 'failed') failed += 1;
    }
    return { total: this._jobs.length, pending, running, completed, failed };
  }
}
