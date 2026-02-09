import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { extractLdJsonBlocks } from '../extractors/ldjsonExtractor.js';
import { extractEmbeddedState } from '../extractors/embeddedStateExtractor.js';
import { NetworkRecorder } from './networkRecorder.js';
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
    const recorder = new NetworkRecorder({ maxJsonBytes: this.config.maxJsonBytes });

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
        timeout: 30_000
      });
      status = response?.status() || 0;
      finalUrl = page.url();

      try {
        await page.waitForLoadState('networkidle', { timeout: 6_000 });
      } catch {
        // Best effort only.
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
        if (row.jsonFull || row.jsonPreview) {
          return row;
        }
        if (row.body !== undefined) {
          return {
            ...row,
            contentType: row.contentType || row.content_type || 'application/json',
            isGraphQl: row.isGraphQl ?? row.is_graphql ?? false,
            classification: row.classification || 'unknown',
            boundedByteLen: row.boundedByteLen || Buffer.byteLength(JSON.stringify(row.body), 'utf8'),
            jsonFull: typeof row.body === 'object' ? row.body : undefined,
            jsonPreview: typeof row.body === 'string' ? row.body : undefined
          };
        }
        return row;
      })
    };
  }
}
