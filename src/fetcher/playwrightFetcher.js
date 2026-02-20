import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { extractLdJsonBlocks } from '../extractors/ldjsonExtractor.js';
import { extractEmbeddedState } from '../extractors/embeddedStateExtractor.js';
import { NetworkRecorder } from './networkRecorder.js';
import { replayGraphqlRequests } from './graphqlReplay.js';
import { wait } from '../utils/common.js';
import { RobotsPolicyCache } from './robotsPolicy.js';
import { resolveDynamicFetchPolicy } from './dynamicFetchPolicy.js';

function fixtureFilenameFromHost(host) {
  return `${host.toLowerCase()}.json`;
}

function isRetryableStatus(statusCode) {
  const status = Number(statusCode || 0);
  return status === 429 || (status >= 500 && status <= 599);
}

function isRetryableFetchError(error) {
  if (!error) {
    return false;
  }
  if (error.retryable === true) {
    return true;
  }
  const message = String(error.message || '').toLowerCase();
  if (!message) {
    return false;
  }
  return /(timeout|timed out|etimedout|econnreset|econnrefused|socket hang up|network error|dns|navigation)/.test(message);
}

function buildTransientStatusError(status) {
  const err = new Error(`transient_status_${status}`);
  err.retryable = true;
  err.status = status;
  return err;
}

function screenshotSelectorsFromConfig(config = {}) {
  const fromEnv = String(config.capturePageScreenshotSelectors || '')
    .split(',')
    .map((row) => String(row || '').trim())
    .filter(Boolean);
  if (fromEnv.length > 0) {
    return fromEnv.slice(0, 12);
  }
  return [
    'table',
    '[data-spec-table]',
    '.specs-table',
    '.spec-table',
    '.specifications'
  ];
}

async function captureScreenshotArtifact(page, config = {}, policy = {}) {
  if (config.capturePageScreenshotEnabled === false) {
    return null;
  }
  const format = String(config.capturePageScreenshotFormat || 'jpeg').trim().toLowerCase() === 'png'
    ? 'png'
    : 'jpeg';
  const quality = Math.max(35, Math.min(95, Number(config.capturePageScreenshotQuality || 62)));
  const selectors = screenshotSelectorsFromConfig(config);
  const maxBytes = Math.max(128_000, Number(config.capturePageScreenshotMaxBytes || 2_200_000));

  const capture = async (selector) => {
    const element = selector ? await page.$(selector) : null;
    if (selector && !element) return null;
    const bytes = element
      ? await element.screenshot({
        type: format,
        ...(format === 'jpeg' ? { quality } : {})
      })
      : await page.screenshot({
        type: format,
        fullPage: Boolean(policy.captureFullPageScreenshot)
      });
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > maxBytes) {
      return null;
    }
    const viewport = page.viewportSize() || {};
    return {
      kind: selector ? 'crop' : 'page',
      format,
      selector: selector || null,
      bytes,
      width: Number(viewport.width || 0) || null,
      height: Number(viewport.height || 0) || null,
      captured_at: new Date().toISOString()
    };
  };

  for (const selector of selectors) {
    try {
      const artifact = await capture(selector);
      if (artifact) return artifact;
    } catch {
      // try next selector
    }
  }
  try {
    return await capture(null);
  } catch {
    return null;
  }
}

export class PlaywrightFetcher {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.browser = null;
    this.context = null;
    this.hostLastAccess = new Map();
    this.policyLogSeen = new Set();
    this.robotsPolicy = new RobotsPolicyCache({
      timeoutMs: Number(this.config.robotsTxtTimeoutMs || 6000),
      logger
    });
  }

  async start() {
    if (this.browser) {
      return;
    }
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({
      userAgent: this.config.userAgent
    });
  }

  async stop() {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async waitForHostSlot(host, minDelayMs = this.config.perHostMinDelayMs) {
    const now = Date.now();
    const last = this.hostLastAccess.get(host) || 0;
    const delta = now - last;
    const delayMs = Math.max(0, Number(minDelayMs || this.config.perHostMinDelayMs || 0));
    if (delta < delayMs) {
      await wait(delayMs - delta);
    }
    this.hostLastAccess.set(host, Date.now());
  }

  async enforceRobots(source) {
    if (this.config.robotsTxtCompliant === false || source?.robotsTxtCompliant === false) {
      return null;
    }

    let decision;
    try {
      decision = await this.robotsPolicy.canFetch({
        url: source.url,
        userAgent: this.config.userAgent || '*'
      });
    } catch (error) {
      this.logger?.warn?.('robots_policy_check_failed', {
        url: source.url,
        message: error.message
      });
      return null;
    }

    if (decision?.allowed !== false) {
      return null;
    }

    return {
      url: source.url,
      finalUrl: source.url,
      status: 451,
      title: '',
      html: '',
      ldjsonBlocks: [],
      embeddedState: {},
      networkResponses: [],
      blockedByRobots: true,
      robotsDecision: decision
    };
  }

  async fetch(source) {
    const fetchPolicy = resolveDynamicFetchPolicy(this.config, source);
    if (fetchPolicy.overrideApplied && fetchPolicy.host && !this.policyLogSeen.has(fetchPolicy.host)) {
      this.policyLogSeen.add(fetchPolicy.host);
      this.logger?.info?.('dynamic_fetch_policy_applied', {
        host: fetchPolicy.host,
        matched_host: fetchPolicy.matchedHost,
        page_goto_timeout_ms: fetchPolicy.pageGotoTimeoutMs,
        page_network_idle_timeout_ms: fetchPolicy.pageNetworkIdleTimeoutMs,
        per_host_delay_ms: fetchPolicy.perHostMinDelayMs,
        post_load_wait_ms: fetchPolicy.postLoadWaitMs,
        auto_scroll_enabled: fetchPolicy.autoScrollEnabled,
        auto_scroll_passes: fetchPolicy.autoScrollPasses,
        graphql_replay_enabled: fetchPolicy.graphqlReplayEnabled,
        max_graphql_replays: fetchPolicy.maxGraphqlReplays,
        retry_budget: fetchPolicy.retryBudget,
        retry_backoff_ms: fetchPolicy.retryBackoffMs
      });
    }

    const robotsBlocked = await this.enforceRobots(source);
    if (robotsBlocked) {
      this.logger?.warn?.('source_blocked_by_robots', {
        url: source.url,
        host: source.host,
        robots_url: robotsBlocked.robotsDecision?.robots_url,
        matched_rule: robotsBlocked.robotsDecision?.matched_rule || null
      });
      return robotsBlocked;
    }

    const maxAttempts = Math.max(1, Number(fetchPolicy.retryBudget || 0) + 1);

    let html = '';
    let title = '';
    let status = 0;
    let finalUrl = source.url;
    let networkResponses = [];
    let screenshot = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await this.waitForHostSlot(
        source.host,
        source?.crawlConfig?.rate_limit_ms ?? fetchPolicy.perHostMinDelayMs
      );

      const page = await this.context.newPage();
      const recorder = new NetworkRecorder({
        maxJsonBytes: this.config.maxJsonBytes,
        maxRows: this.config.maxNetworkResponsesPerPage
      });

      page.on('response', async (response) => {
        await recorder.handleResponse(response);
      });

      try {
        const response = await page.goto(source.url, {
          waitUntil: 'domcontentloaded',
          timeout: fetchPolicy.pageGotoTimeoutMs || this.config.pageGotoTimeoutMs || 30_000
        });
        status = response?.status() || 0;
        finalUrl = page.url();

        if (isRetryableStatus(status) && attempt < maxAttempts) {
          throw buildTransientStatusError(status);
        }

        try {
          await page.waitForLoadState('networkidle', {
            timeout: fetchPolicy.pageNetworkIdleTimeoutMs || this.config.pageNetworkIdleTimeoutMs || 6_000
          });
        } catch {
          // Best effort only.
        }

        await this.captureInteractiveSignals(page, fetchPolicy);

        if (fetchPolicy.graphqlReplayEnabled) {
          const replayRows = await replayGraphqlRequests({
            page,
            capturedResponses: recorder.rows,
            maxReplays: fetchPolicy.maxGraphqlReplays,
            maxJsonBytes: this.config.maxJsonBytes,
            logger: this.logger
          });
          if (replayRows.length) {
            recorder.rows.push(...replayRows);
          }
        }

        html = await page.content();
        title = await page.title();
        screenshot = await captureScreenshotArtifact(page, this.config, fetchPolicy);
        networkResponses = recorder.rows;
        await page.close();
        break;
      } catch (error) {
        await page.close();
        const shouldRetry = attempt < maxAttempts && isRetryableFetchError(error);
        if (!shouldRetry) {
          throw error;
        }
        this.logger?.warn?.('dynamic_fetch_retry', {
          host: source.host,
          url: source.url,
          attempt,
          max_attempts: maxAttempts,
          reason: String(error?.message || 'retryable_error')
        });
        const retryBackoffMs = Math.max(0, Number(fetchPolicy.retryBackoffMs || 0));
        if (retryBackoffMs > 0) {
          await wait(retryBackoffMs);
        }
      }
    }

    const ldjsonBlocks = extractLdJsonBlocks(html);
    const embeddedState = extractEmbeddedState(html);

    return {
      url: source.url,
      finalUrl,
      status,
      title,
      html,
      ldjsonBlocks,
      embeddedState,
      networkResponses,
      screenshot
    };
  }

  async captureInteractiveSignals(page, policy = null) {
    const activePolicy = policy || this.config;
    const autoScrollPasses = Math.max(0, Number(activePolicy.autoScrollPasses || 0));
    const autoScrollDelayMs = Math.max(100, Number(activePolicy.autoScrollDelayMs || 900));
    const shouldScroll = Boolean(activePolicy.autoScrollEnabled && autoScrollPasses > 0);

    if (shouldScroll) {
      for (let i = 0; i < autoScrollPasses; i += 1) {
        try {
          await page.evaluate(() => {
            const maxY = Math.max(
              document.body?.scrollHeight || 0,
              document.documentElement?.scrollHeight || 0
            );
            window.scrollTo(0, maxY);
          });
        } catch {
          break;
        }
        await page.waitForTimeout(autoScrollDelayMs);
      }

      try {
        await page.evaluate(() => window.scrollTo(0, 0));
      } catch {
        // ignore
      }
    }

    const postLoadWaitMs = Math.max(0, Number(activePolicy.postLoadWaitMs || 0));
    if (postLoadWaitMs > 0) {
      await page.waitForTimeout(postLoadWaitMs);
    }
  }
}

function extractHtmlTitle(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? String(match[1] || '').trim() : '';
}

async function fetchTextWithTimeout(url, timeoutMs, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1_000, Number(timeoutMs || 30_000)));
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers,
      signal: controller.signal
    });
    const bodyText = await response.text();
    return {
      response,
      bodyText
    };
  } finally {
    clearTimeout(timeout);
  }
}

export class HttpFetcher {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.hostLastAccess = new Map();
    this.policyLogSeen = new Set();
    this.robotsPolicy = new RobotsPolicyCache({
      timeoutMs: Number(this.config.robotsTxtTimeoutMs || 6000),
      logger
    });
  }

  async start() {}

  async stop() {}

  async waitForHostSlot(host, minDelayMs = this.config.perHostMinDelayMs) {
    const now = Date.now();
    const last = this.hostLastAccess.get(host) || 0;
    const delta = now - last;
    const delayMs = Math.max(0, Number(minDelayMs || this.config.perHostMinDelayMs || 0));
    if (delta < delayMs) {
      await wait(delayMs - delta);
    }
    this.hostLastAccess.set(host, Date.now());
  }

  async enforceRobots(source) {
    if (this.config.robotsTxtCompliant === false || source?.robotsTxtCompliant === false) {
      return null;
    }
    let decision;
    try {
      decision = await this.robotsPolicy.canFetch({
        url: source.url,
        userAgent: this.config.userAgent || '*'
      });
    } catch (error) {
      this.logger?.warn?.('robots_policy_check_failed', {
        url: source.url,
        message: error.message
      });
      return null;
    }

    if (decision?.allowed !== false) {
      return null;
    }

    return {
      url: source.url,
      finalUrl: source.url,
      status: 451,
      title: '',
      html: '',
      ldjsonBlocks: [],
      embeddedState: {},
      networkResponses: [],
      blockedByRobots: true,
      robotsDecision: decision
    };
  }

  async fetch(source) {
    const fetchPolicy = resolveDynamicFetchPolicy(this.config, source);
    if (fetchPolicy.overrideApplied && fetchPolicy.host && !this.policyLogSeen.has(fetchPolicy.host)) {
      this.policyLogSeen.add(fetchPolicy.host);
      this.logger?.info?.('dynamic_fetch_policy_applied', {
        host: fetchPolicy.host,
        matched_host: fetchPolicy.matchedHost,
        page_goto_timeout_ms: fetchPolicy.pageGotoTimeoutMs,
        per_host_delay_ms: fetchPolicy.perHostMinDelayMs,
        retry_budget: fetchPolicy.retryBudget,
        retry_backoff_ms: fetchPolicy.retryBackoffMs
      });
    }

    const robotsBlocked = await this.enforceRobots(source);
    if (robotsBlocked) {
      this.logger?.warn?.('source_blocked_by_robots', {
        url: source.url,
        host: source.host,
        robots_url: robotsBlocked.robotsDecision?.robots_url,
        matched_rule: robotsBlocked.robotsDecision?.matched_rule || null
      });
      return robotsBlocked;
    }

    const maxAttempts = Math.max(1, Number(fetchPolicy.retryBudget || 0) + 1);
    let result;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await this.waitForHostSlot(
        source.host,
        source?.crawlConfig?.rate_limit_ms ?? fetchPolicy.perHostMinDelayMs
      );

      try {
        result = await fetchTextWithTimeout(
          source.url,
          fetchPolicy.pageGotoTimeoutMs || this.config.pageGotoTimeoutMs || 30_000,
          {
            'user-agent': this.config.userAgent || 'SpecHarvester/1.0',
            accept: '*/*'
          }
        );

        const status = Number(result?.response?.status || 0);
        if (isRetryableStatus(status) && attempt < maxAttempts) {
          this.logger?.warn?.('dynamic_fetch_retry', {
            host: source.host,
            url: source.url,
            attempt,
            max_attempts: maxAttempts,
            reason: `status_${status}`
          });
          const retryBackoffMs = Math.max(0, Number(fetchPolicy.retryBackoffMs || 0));
          if (retryBackoffMs > 0) {
            await wait(retryBackoffMs);
          }
          continue;
        }
        break;
      } catch (error) {
        const shouldRetry = attempt < maxAttempts && isRetryableFetchError(error);
        if (!shouldRetry) {
          throw new Error(`HTTP fetch failed: ${error.message}`);
        }
        this.logger?.warn?.('dynamic_fetch_retry', {
          host: source.host,
          url: source.url,
          attempt,
          max_attempts: maxAttempts,
          reason: String(error?.message || 'retryable_error')
        });
        const retryBackoffMs = Math.max(0, Number(fetchPolicy.retryBackoffMs || 0));
        if (retryBackoffMs > 0) {
          await wait(retryBackoffMs);
        }
      }
    }

    const { response, bodyText } = result;
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const finalUrl = response.url || source.url;
    const status = response.status || 0;
    const html = bodyText || '';
    const title = contentType.includes('text/html') ? extractHtmlTitle(html) : '';
    const ldjsonBlocks = extractLdJsonBlocks(html);
    const embeddedState = extractEmbeddedState(html);

    const isJsonPayload =
      contentType.includes('application/json') ||
      contentType.includes('+json') ||
      finalUrl.toLowerCase().endsWith('.json');

    const networkResponses = [];
    if (isJsonPayload || finalUrl.toLowerCase().includes('/graphql')) {
      let jsonFull;
      let jsonPreview = '';
      try {
        jsonFull = JSON.parse(bodyText);
      } catch {
        jsonPreview = String(bodyText || '').slice(0, 8_000);
      }
      networkResponses.push({
        ts: new Date().toISOString(),
        url: finalUrl,
        status,
        contentType: contentType || 'application/json',
        isGraphQl: finalUrl.toLowerCase().includes('/graphql'),
        classification: 'fetch_json',
        boundedByteLen: Buffer.byteLength(String(bodyText || ''), 'utf8'),
        truncated: false,
        request_url: source.url,
        request_method: 'GET',
        resource_type: 'fetch',
        jsonFull,
        jsonPreview
      });
    }

    return {
      url: source.url,
      finalUrl,
      status,
      title,
      html,
      ldjsonBlocks,
      embeddedState,
      networkResponses
    };
  }
}

export class CrawleeFetcher {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.hostLastAccess = new Map();
    this.policyLogSeen = new Set();
    this.robotsPolicy = new RobotsPolicyCache({
      timeoutMs: Number(this.config.robotsTxtTimeoutMs || 6000),
      logger
    });
    this.crawleeImportPromise = null;
  }

  async ensureCrawlee() {
    if (!this.crawleeImportPromise) {
      this.crawleeImportPromise = import('crawlee');
    }
    return this.crawleeImportPromise;
  }

  async start() {
    await this.ensureCrawlee();
  }

  async stop() {}

  async waitForHostSlot(host, minDelayMs = this.config.perHostMinDelayMs) {
    const now = Date.now();
    const last = this.hostLastAccess.get(host) || 0;
    const delta = now - last;
    const delayMs = Math.max(0, Number(minDelayMs || this.config.perHostMinDelayMs || 0));
    if (delta < delayMs) {
      await wait(delayMs - delta);
    }
    this.hostLastAccess.set(host, Date.now());
  }

  async enforceRobots(source) {
    if (this.config.robotsTxtCompliant === false || source?.robotsTxtCompliant === false) {
      return null;
    }

    let decision;
    try {
      decision = await this.robotsPolicy.canFetch({
        url: source.url,
        userAgent: this.config.userAgent || '*'
      });
    } catch (error) {
      this.logger?.warn?.('robots_policy_check_failed', {
        url: source.url,
        message: error.message
      });
      return null;
    }

    if (decision?.allowed !== false) {
      return null;
    }

    return {
      url: source.url,
      finalUrl: source.url,
      status: 451,
      title: '',
      html: '',
      ldjsonBlocks: [],
      embeddedState: {},
      networkResponses: [],
      blockedByRobots: true,
      robotsDecision: decision
    };
  }

  async captureInteractiveSignals(page, policy = null) {
    const activePolicy = policy || this.config;
    const autoScrollPasses = Math.max(0, Number(activePolicy.autoScrollPasses || 0));
    const autoScrollDelayMs = Math.max(100, Number(activePolicy.autoScrollDelayMs || 900));
    const shouldScroll = Boolean(activePolicy.autoScrollEnabled && autoScrollPasses > 0);

    if (shouldScroll) {
      for (let i = 0; i < autoScrollPasses; i += 1) {
        try {
          await page.evaluate(() => {
            const maxY = Math.max(
              document.body?.scrollHeight || 0,
              document.documentElement?.scrollHeight || 0
            );
            window.scrollTo(0, maxY);
          });
        } catch {
          break;
        }
        await page.waitForTimeout(autoScrollDelayMs);
      }

      try {
        await page.evaluate(() => window.scrollTo(0, 0));
      } catch {
        // ignore
      }
    }

    const postLoadWaitMs = Math.max(0, Number(activePolicy.postLoadWaitMs || 0));
    if (postLoadWaitMs > 0) {
      await page.waitForTimeout(postLoadWaitMs);
    }
  }

  async fetch(source) {
    const fetchPolicy = resolveDynamicFetchPolicy(this.config, source);
    if (fetchPolicy.overrideApplied && fetchPolicy.host && !this.policyLogSeen.has(fetchPolicy.host)) {
      this.policyLogSeen.add(fetchPolicy.host);
      this.logger?.info?.('dynamic_fetch_policy_applied', {
        host: fetchPolicy.host,
        matched_host: fetchPolicy.matchedHost,
        fetcher_kind: 'crawlee',
        page_goto_timeout_ms: fetchPolicy.pageGotoTimeoutMs,
        page_network_idle_timeout_ms: fetchPolicy.pageNetworkIdleTimeoutMs,
        per_host_delay_ms: fetchPolicy.perHostMinDelayMs,
        post_load_wait_ms: fetchPolicy.postLoadWaitMs,
        auto_scroll_enabled: fetchPolicy.autoScrollEnabled,
        auto_scroll_passes: fetchPolicy.autoScrollPasses,
        graphql_replay_enabled: fetchPolicy.graphqlReplayEnabled,
        max_graphql_replays: fetchPolicy.maxGraphqlReplays,
        retry_budget: fetchPolicy.retryBudget,
        retry_backoff_ms: fetchPolicy.retryBackoffMs
      });
    }

    const robotsBlocked = await this.enforceRobots(source);
    if (robotsBlocked) {
      this.logger?.warn?.('source_blocked_by_robots', {
        url: source.url,
        host: source.host,
        robots_url: robotsBlocked.robotsDecision?.robots_url,
        matched_rule: robotsBlocked.robotsDecision?.matched_rule || null
      });
      return robotsBlocked;
    }

    await this.waitForHostSlot(
      source.host,
      source?.crawlConfig?.rate_limit_ms ?? fetchPolicy.perHostMinDelayMs
    );

    const { PlaywrightCrawler, log: crawleeLog } = await this.ensureCrawlee();
    if (crawleeLog?.setLevel && crawleeLog?.LEVELS?.WARNING !== undefined) {
      crawleeLog.setLevel(crawleeLog.LEVELS.WARNING);
    }

    const maxAttempts = Math.max(1, Number(fetchPolicy.retryBudget || 0) + 1);
    const retryBackoffMs = Math.max(0, Number(fetchPolicy.retryBackoffMs || 0));
    const navigationTimeout = fetchPolicy.pageGotoTimeoutMs || this.config.pageGotoTimeoutMs || 30_000;
    const networkIdleTimeout = fetchPolicy.pageNetworkIdleTimeoutMs || this.config.pageNetworkIdleTimeoutMs || 6_000;
    const configuredRequestHandlerTimeout = Number(this.config.crawleeRequestHandlerTimeoutSecs || 0);
    const derivedRequestHandlerTimeout = Math.ceil(
      (navigationTimeout + networkIdleTimeout + Math.max(0, Number(fetchPolicy.postLoadWaitMs || 0)) + 5_000) / 1000
    );
    const requestHandlerTimeoutSecs = Math.max(
      15,
      configuredRequestHandlerTimeout,
      derivedRequestHandlerTimeout
    );

    let result = null;
    let lastError = null;

    const crawler = new PlaywrightCrawler({
      maxRequestsPerCrawl: 1,
      maxRequestRetries: Math.max(0, maxAttempts - 1),
      requestHandlerTimeoutSecs,
      launchContext: {
        launchOptions: {
          headless: this.config.crawleeHeadless !== false
        }
      },
      preNavigationHooks: [
        async ({ request }, gotoOptions) => {
          gotoOptions.waitUntil = 'domcontentloaded';
          gotoOptions.timeout = navigationTimeout;
          if (request.retryCount > 0 && retryBackoffMs > 0) {
            this.logger?.warn?.('dynamic_fetch_retry', {
              host: source.host,
              url: source.url,
              attempt: request.retryCount + 1,
              max_attempts: maxAttempts,
              fetcher_kind: 'crawlee',
              reason: 'crawlee_retry_backoff'
            });
            await wait(retryBackoffMs);
          }
        }
      ],
      requestHandler: async ({ page, request, response }) => {
        const status = response?.status() || 0;
        if (isRetryableStatus(status) && request.retryCount < maxAttempts - 1) {
          throw buildTransientStatusError(status);
        }

        const recorder = new NetworkRecorder({
          maxJsonBytes: this.config.maxJsonBytes,
          maxRows: this.config.maxNetworkResponsesPerPage
        });
        page.on('response', async (resp) => {
          await recorder.handleResponse(resp);
        });

        try {
          await page.waitForLoadState('networkidle', {
            timeout: networkIdleTimeout
          });
        } catch {
          // Best effort only.
        }

        await this.captureInteractiveSignals(page, fetchPolicy);

        if (fetchPolicy.graphqlReplayEnabled) {
          const replayRows = await replayGraphqlRequests({
            page,
            capturedResponses: recorder.rows,
            maxReplays: fetchPolicy.maxGraphqlReplays,
            maxJsonBytes: this.config.maxJsonBytes,
            logger: this.logger
          });
          if (replayRows.length) {
            recorder.rows.push(...replayRows);
          }
        }

        const html = await page.content();
        const title = await page.title();
        const finalUrl = page.url();
        const screenshot = await captureScreenshotArtifact(page, this.config, fetchPolicy);

        result = {
          url: source.url,
          finalUrl,
          status,
          title,
          html,
          ldjsonBlocks: extractLdJsonBlocks(html),
          embeddedState: extractEmbeddedState(html),
          networkResponses: recorder.rows,
          screenshot
        };
      },
      failedRequestHandler: async ({ request, error }) => {
        lastError = error || new Error(`crawlee_failed_${request.url}`);
      },
      errorHandler: async ({ error }) => {
        if (!lastError) {
          lastError = error;
        }
      }
    });

    await crawler.run([source.url]);

    if (result) {
      return result;
    }

    if (lastError) {
      throw new Error(`Crawlee fetch failed: ${String(lastError.message || lastError)}`);
    }
    throw new Error('Crawlee fetch failed: no_result');
  }
}

export class DryRunFetcher {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.fixtureRoot = path.resolve('fixtures/dryrun');
  }

  async start() {}

  async stop() {}

  async fetch(source) {
    const file = path.join(this.fixtureRoot, fixtureFilenameFromHost(source.host));
    const raw = await fs.readFile(file, 'utf8');
    const fixture = JSON.parse(raw);

    const html = fixture.html || '';
    const ldjsonBlocks = fixture.ldjsonBlocks || extractLdJsonBlocks(html);
    const embeddedState = fixture.embeddedState || extractEmbeddedState(html);

    return {
      url: source.url,
      finalUrl: source.url,
      status: fixture.status || 200,
      title: fixture.title || '',
      html,
      ldjsonBlocks,
      embeddedState,
      networkResponses: (fixture.networkResponses || []).map((row) => {
        const jsonFull =
          row.jsonFull !== undefined
            ? row.jsonFull
            : (typeof row.body === 'object' && row.body !== null ? row.body : undefined);
        const jsonPreview =
          row.jsonPreview !== undefined
            ? row.jsonPreview
            : (typeof row.body === 'string' ? row.body : undefined);

        const boundedByteLen =
          row.boundedByteLen ||
          row.bounded_byte_len ||
          Buffer.byteLength(
            typeof row.body === 'string' ? row.body : JSON.stringify(row.body || jsonFull || jsonPreview || {}),
            'utf8'
          );

        const normalized = {
          ts: row.ts || '2026-02-09T00:00:00.000Z',
          url: row.url || source.url,
          status: row.status || 200,
          contentType: row.contentType || row.content_type || 'application/json',
          isGraphQl: row.isGraphQl ?? row.is_graphql ?? false,
          classification: row.classification || 'unknown',
          boundedByteLen,
          truncated: Boolean(row.truncated),
          request_url: row.request_url || row.url || source.url,
          request_method: row.request_method || row.method || 'GET',
          resource_type: row.resource_type || 'fetch'
        };

        if (row.request_post_json !== undefined) {
          normalized.request_post_json = row.request_post_json;
        }
        if (jsonFull !== undefined) {
          normalized.jsonFull = jsonFull;
        }
        if (jsonPreview !== undefined) {
          normalized.jsonPreview = jsonPreview;
        }

        return normalized;
      })
    };
  }
}
