import zlib from 'node:zlib';
import { extractLdJsonBlocks } from '../extractors/ldjsonExtractor.js';
import { extractEmbeddedState } from '../extractors/embeddedStateExtractor.js';
import { loadReplayManifest } from '../replay/replayManifest.js';

function normalizeUrl(value) {
  const token = String(value || '').trim();
  if (!token) {
    return '';
  }
  try {
    return new URL(token).toString();
  } catch {
    return '';
  }
}

function normalizeHost(value) {
  return String(value || '').trim().toLowerCase().replace(/^www\./, '');
}

function parseJsonOrDefault(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function decodeMaybeGzip(buffer) {
  if (!buffer || buffer.length === 0) {
    return '';
  }
  try {
    return zlib.gunzipSync(buffer).toString('utf8');
  } catch {
    return buffer.toString('utf8');
  }
}

function parseNdjson(text = '') {
  const rows = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    try {
      rows.push(JSON.parse(line));
    } catch {
      // ignore malformed rows
    }
  }
  return rows;
}

function extractHtmlTitle(html = '') {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? String(match[1] || '').trim() : '';
}

function clonePageData(pageData, source) {
  return {
    url: source.url,
    finalUrl: pageData.finalUrl || source.url,
    status: pageData.status || 0,
    title: pageData.title || '',
    html: pageData.html || '',
    ldjsonBlocks: Array.isArray(pageData.ldjsonBlocks) ? pageData.ldjsonBlocks : [],
    embeddedState: pageData.embeddedState || {},
    networkResponses: Array.isArray(pageData.networkResponses) ? pageData.networkResponses : [],
    replayPdfDocs: Array.isArray(pageData.replayPdfDocs) ? pageData.replayPdfDocs : []
  };
}

export class ReplayFetcher {
  constructor({ storage, config, logger, category, productId, replayRunId }) {
    this.storage = storage;
    this.config = config;
    this.logger = logger;
    this.category = category;
    this.productId = productId;
    this.replayRunId = replayRunId;
    this.manifest = null;
    this.queueByUrl = new Map();
    this.queueByHost = new Map();
    this.usedDescriptorIndexes = new Set();
    this.pageDataCache = new Map();
  }

  async start() {
    if (this.manifest) {
      return;
    }
    this.manifest = await loadReplayManifest({
      storage: this.storage,
      category: this.category,
      productId: this.productId,
      runId: this.replayRunId
    });

    for (const descriptor of this.manifest.sources || []) {
      const urlKey = normalizeUrl(descriptor.url);
      if (urlKey) {
        if (!this.queueByUrl.has(urlKey)) {
          this.queueByUrl.set(urlKey, []);
        }
        this.queueByUrl.get(urlKey).push(descriptor);
      }
      const hostKey = normalizeHost(descriptor.host);
      if (hostKey) {
        if (!this.queueByHost.has(hostKey)) {
          this.queueByHost.set(hostKey, []);
        }
        this.queueByHost.get(hostKey).push(descriptor);
      }
    }

    this.logger?.info?.('replay_fetcher_ready', {
      replay_run_id: this.replayRunId,
      replay_source_count: this.manifest.source_count || 0,
      replay_run_base: this.manifest.runBase
    });
  }

  async stop() {}

  takeFromQueue(queue = []) {
    while (queue.length > 0) {
      const descriptor = queue.shift();
      if (!descriptor) {
        continue;
      }
      if (this.usedDescriptorIndexes.has(descriptor.index)) {
        continue;
      }
      this.usedDescriptorIndexes.add(descriptor.index);
      return descriptor;
    }
    return null;
  }

  async loadReplayPdfPreviews(descriptor) {
    const prefix = `${this.manifest.runBase}/raw/pdfs/${descriptor.artifact_key}`;
    const keys = await this.storage.listKeys(prefix);
    const previews = [];
    for (const key of keys) {
      if (!String(key).toLowerCase().endsWith('.json')) {
        continue;
      }
      const row = await this.storage.readJsonOrNull(key);
      if (!row || typeof row !== 'object') {
        continue;
      }
      previews.push({
        url: String(row.url || '').trim(),
        filename: String(row.filename || '').trim(),
        textPreview: String(row.textPreview || '').trim()
      });
    }
    return previews;
  }

  async loadPageData(descriptor) {
    if (this.pageDataCache.has(descriptor.index)) {
      return this.pageDataCache.get(descriptor.index);
    }

    const base = this.manifest.runBase;
    const key = descriptor.artifact_key;
    const htmlBuffer = await this.storage.readObjectOrNull(`${base}/raw/pages/${key}/page.html.gz`);
    const html = decodeMaybeGzip(htmlBuffer);
    const ldjsonBlocks =
      await this.storage.readJsonOrNull(`${base}/raw/pages/${key}/ldjson.json`) ||
      extractLdJsonBlocks(html);
    const embeddedState =
      await this.storage.readJsonOrNull(`${base}/raw/pages/${key}/embedded_state.json`) ||
      extractEmbeddedState(html);
    const networkBuffer = await this.storage.readObjectOrNull(`${base}/raw/network/${key}/responses.ndjson.gz`);
    const networkResponses = parseNdjson(decodeMaybeGzip(networkBuffer));
    const replayPdfDocs = await this.loadReplayPdfPreviews(descriptor);

    const pageData = {
      finalUrl: descriptor.final_url || descriptor.url,
      status: descriptor.status || 0,
      title: extractHtmlTitle(html),
      html,
      ldjsonBlocks: Array.isArray(ldjsonBlocks) ? ldjsonBlocks : parseJsonOrDefault(JSON.stringify(ldjsonBlocks), []),
      embeddedState: embeddedState && typeof embeddedState === 'object' ? embeddedState : {},
      networkResponses,
      replayPdfDocs
    };

    this.pageDataCache.set(descriptor.index, pageData);
    return pageData;
  }

  async fetch(source) {
    const urlKey = normalizeUrl(source.url);
    const hostKey = normalizeHost(source.host);
    const descriptor = this.takeFromQueue(this.queueByUrl.get(urlKey) || []) ||
      this.takeFromQueue(this.queueByHost.get(hostKey) || []);
    if (!descriptor) {
      this.logger?.warn?.('replay_fetch_miss', {
        replay_run_id: this.replayRunId,
        url: source.url,
        host: source.host
      });
      return {
        url: source.url,
        finalUrl: source.url,
        status: 404,
        title: '',
        html: '',
        ldjsonBlocks: [],
        embeddedState: {},
        networkResponses: [],
        replayPdfDocs: []
      };
    }

    const pageData = await this.loadPageData(descriptor);
    return clonePageData(pageData, source);
  }
}
