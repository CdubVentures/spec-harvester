import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { loadReplayManifest } from '../src/replay/replayManifest.js';
import { ReplayFetcher } from '../src/fetcher/replayFetcher.js';

function toBuffer(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
}

function makeStorage(initial = {}) {
  const map = new Map();
  for (const [key, value] of Object.entries(initial)) {
    map.set(key, toBuffer(value));
  }
  return {
    map,
    resolveOutputKey(...parts) {
      return ['specs/outputs', ...parts].join('/');
    },
    async readObject(key) {
      const row = map.get(key);
      if (!row) {
        const error = new Error(`Missing key: ${key}`);
        error.code = 'ENOENT';
        throw error;
      }
      return row;
    },
    async readObjectOrNull(key) {
      return map.get(key) || null;
    },
    async readText(key) {
      const row = await this.readObject(key);
      return row.toString('utf8');
    },
    async readTextOrNull(key) {
      const row = map.get(key);
      return row ? row.toString('utf8') : null;
    },
    async readJsonOrNull(key) {
      const row = map.get(key);
      if (!row) {
        return null;
      }
      return JSON.parse(row.toString('utf8'));
    },
    async listKeys(prefix) {
      return [...map.keys()]
        .filter((key) => String(key).startsWith(prefix))
        .sort();
    },
    async writeObject(key, body) {
      map.set(key, toBuffer(body));
    }
  };
}

function gzipText(text) {
  return zlib.gzipSync(Buffer.from(text, 'utf8'));
}

test('loadReplayManifest maps source_processed events to artifact keys', async () => {
  const category = 'mouse';
  const productId = 'mouse-logitech-g-pro-x-superlight-2';
  const runId = '20260210-abcd12';
  const runBase = `specs/outputs/${category}/${productId}/runs/${runId}`;
  const events = [
    {
      ts: '2026-02-10T00:00:00.000Z',
      event: 'source_fetch_started',
      url: 'https://example.com/product',
      host: 'example.com',
      tier: 1,
      role: 'manufacturer',
      approved_domain: true
    },
    {
      ts: '2026-02-10T00:00:01.000Z',
      event: 'source_processed',
      url: 'https://example.com/product',
      host: 'example.com',
      status: 200
    },
    {
      ts: '2026-02-10T00:00:02.000Z',
      event: 'source_fetch_started',
      url: 'https://specs.example.net/manual',
      host: 'specs.example.net',
      tier: 2,
      role: 'review',
      approved_domain: true
    },
    {
      ts: '2026-02-10T00:00:03.000Z',
      event: 'source_processed',
      url: 'https://specs.example.net/manual',
      host: 'specs.example.net',
      status: 200
    }
  ];
  const storage = makeStorage({
    [`${runBase}/logs/events.jsonl.gz`]: gzipText(events.map((row) => JSON.stringify(row)).join('\n'))
  });

  const manifest = await loadReplayManifest({
    storage,
    category,
    productId,
    runId
  });

  assert.equal(manifest.source_count, 2);
  assert.deepEqual(
    manifest.source_urls,
    ['https://example.com/product', 'https://specs.example.net/manual']
  );
  assert.equal(manifest.sources[0].artifact_key, 'example.com__0000');
  assert.equal(manifest.sources[1].artifact_key, 'specs.example.net__0001');
});

test('ReplayFetcher replays stored page/network artifacts without network access', async () => {
  const category = 'mouse';
  const productId = 'mouse-logitech-g-pro-x-superlight-2';
  const runId = '20260210-ef9012';
  const runBase = `specs/outputs/${category}/${productId}/runs/${runId}`;
  const events = [
    {
      event: 'source_fetch_started',
      url: 'https://example.com/product',
      host: 'example.com',
      tier: 1,
      role: 'manufacturer',
      approved_domain: true
    },
    {
      event: 'source_processed',
      url: 'https://example.com/product',
      host: 'example.com',
      status: 200
    }
  ];
  const networkRows = [
    {
      url: 'https://example.com/api/specs',
      request_url: 'https://example.com/api/specs',
      request_method: 'GET',
      status: 200
    }
  ];
  const storage = makeStorage({
    [`${runBase}/logs/events.jsonl.gz`]: gzipText(events.map((row) => JSON.stringify(row)).join('\n')),
    [`${runBase}/raw/pages/example.com__0000/page.html.gz`]: gzipText('<html><title>Replay Product</title><body>dpi 26000</body></html>'),
    [`${runBase}/raw/pages/example.com__0000/ldjson.json`]: JSON.stringify([]),
    [`${runBase}/raw/pages/example.com__0000/embedded_state.json`]: JSON.stringify({ product: { dpi: 26000 } }),
    [`${runBase}/raw/network/example.com__0000/responses.ndjson.gz`]: gzipText(networkRows.map((row) => JSON.stringify(row)).join('\n'))
  });
  const fetcher = new ReplayFetcher({
    storage,
    config: {},
    logger: null,
    category,
    productId,
    replayRunId: runId
  });

  await fetcher.start();
  const pageData = await fetcher.fetch({
    url: 'https://example.com/product',
    host: 'example.com'
  });

  assert.equal(pageData.status, 200);
  assert.equal(pageData.title, 'Replay Product');
  assert.equal(pageData.networkResponses.length, 1);
  assert.equal(pageData.embeddedState.product.dpi, 26000);

  const miss = await fetcher.fetch({
    url: 'https://example.com/unknown',
    host: 'example.com'
  });
  assert.equal(miss.status, 404);
});
