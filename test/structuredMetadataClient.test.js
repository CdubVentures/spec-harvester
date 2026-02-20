import test from 'node:test';
import assert from 'node:assert/strict';
import { StructuredMetadataClient } from '../src/extract/structuredMetadataClient.js';

test('StructuredMetadataClient fail-open when disabled', async () => {
  const client = new StructuredMetadataClient({
    config: {
      structuredMetadataExtructEnabled: false
    }
  });
  const payload = await client.extract({
    url: 'https://example.com/product',
    html: '<html><body>ok</body></html>',
    contentType: 'text/html'
  });
  assert.equal(payload.ok, false);
  assert.equal(Array.isArray(payload.errors), true);
  assert.equal(payload.errors.includes('structured_metadata_sidecar_disabled'), true);
});

test('StructuredMetadataClient normalizes sidecar payload and uses in-memory cache', async () => {
  let calls = 0;
  const client = new StructuredMetadataClient({
    config: {
      structuredMetadataExtructEnabled: true,
      structuredMetadataExtructUrl: 'http://127.0.0.1:8011/extract/structured',
      structuredMetadataExtructTimeoutMs: 2000,
      structuredMetadataExtructCacheEnabled: true
    },
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: true,
        async json() {
          return {
            ok: true,
            url: 'https://example.com/product',
            html_hash: 'sha256:test',
            surfaces: {
              json_ld: [],
              microdata: [{ weight: '60 g' }],
              rdfa: [],
              microformats: [],
              opengraph: { 'product:brand': 'Example' },
              twitter: {}
            },
            stats: {
              json_ld_count: 0,
              microdata_count: 1,
              rdfa_count: 0,
              microformats_count: 0,
              opengraph_count: 1,
              twitter_count: 0
            },
            errors: []
          };
        }
      };
    }
  });

  const first = await client.extract({
    url: 'https://example.com/product',
    html: '<html><body>ok</body></html>',
    contentType: 'text/html'
  });
  const second = await client.extract({
    url: 'https://example.com/product',
    html: '<html><body>ok</body></html>',
    contentType: 'text/html'
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(calls, 1);
  assert.equal(Boolean(second.cache_hit), true);
  assert.equal(Number(second?.stats?.microdata_count || 0), 1);
});

