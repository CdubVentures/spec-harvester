import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { extractLdJsonBlocks } from '../extractors/ldjsonExtractor.js';
import { extractEmbeddedState } from '../extractors/embeddedStateExtractor.js';
import { NetworkRecorder } from './networkRecorder.js';
import { replayGraphqlRequests } from './graphqlReplay.js';
import { wait } from '../utils/common.js';

function fixtureFilenameFromHost(host) {
  return `${host.toLowerCase()}.json`;
}

export class PlaywrightFetcher {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.browser = null;
    this.context = null;
    this.hostLastAccess = new Map();
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

  async waitForHostSlot(host) {
    const now = Date.now();
    const last = this.hostLastAccess.get(host) || 0;
    const delta = now - last;
    if (delta < this.config.perHostMinDelayMs) {
      await wait(this.config.perHostMinDelayMs - delta);
    }
    this.hostLastAccess.set(host, Date.now());
  }

  async fetch(source) {
    await this.waitForHostSlot(source.host);
    const page = await this.context.newPage();
    const recorder = new NetworkRecorder({
      maxJsonBytes: this.config.maxJsonBytes,
      maxRows: this.config.maxNetworkResponsesPerPage
    });

    page.on('response', async (response) => {
      await recorder.handleResponse(response);
    });

    let html = '';
    let title = '';
    let status = 0;
    let finalUrl = source.url;

    try {
      const response = await page.goto(source.url, {
        waitUntil: 'domcontentloaded',
        timeout: this.config.pageGotoTimeoutMs || 30_000
      });
      status = response?.status() || 0;
      finalUrl = page.url();

      try {
        await page.waitForLoadState('networkidle', {
          timeout: this.config.pageNetworkIdleTimeoutMs || 6_000
        });
      } catch {
        // Best effort only.
      }

      await this.captureInteractiveSignals(page);

      if (this.config.graphqlReplayEnabled) {
        const replayRows = await replayGraphqlRequests({
          page,
          capturedResponses: recorder.rows,
          maxReplays: this.config.maxGraphqlReplays,
          maxJsonBytes: this.config.maxJsonBytes,
          logger: this.logger
        });
        if (replayRows.length) {
          recorder.rows.push(...replayRows);
        }
      }

      html = await page.content();
      title = await page.title();
    } finally {
      await page.close();
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
      networkResponses: recorder.rows
    };
  }

  async captureInteractiveSignals(page) {
    const autoScrollPasses = Math.max(0, Number(this.config.autoScrollPasses || 0));
    const autoScrollDelayMs = Math.max(100, Number(this.config.autoScrollDelayMs || 900));
    const shouldScroll = Boolean(this.config.autoScrollEnabled && autoScrollPasses > 0);

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

    const postLoadWaitMs = Math.max(0, Number(this.config.postLoadWaitMs || 0));
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
  }

  async start() {}

  async stop() {}

  async waitForHostSlot(host) {
    const now = Date.now();
    const last = this.hostLastAccess.get(host) || 0;
    const delta = now - last;
    if (delta < this.config.perHostMinDelayMs) {
      await wait(this.config.perHostMinDelayMs - delta);
    }
    this.hostLastAccess.set(host, Date.now());
  }

  async fetch(source) {
    await this.waitForHostSlot(source.host);

    let result;
    try {
      result = await fetchTextWithTimeout(
        source.url,
        this.config.pageGotoTimeoutMs || 30_000,
        {
          'user-agent': this.config.userAgent || 'SpecHarvester/1.0',
          accept: '*/*'
        }
      );
    } catch (error) {
      throw new Error(`HTTP fetch failed: ${error.message}`);
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
