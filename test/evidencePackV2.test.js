import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidencePackV2, fingerprintEvidenceCandidate } from '../src/evidence/evidencePackV2.js';

test('buildEvidencePackV2 captures definition lists, label-value pairs, and target windows', () => {
  const pack = buildEvidencePackV2({
    source: {
      url: 'https://example.com/mouse',
      host: 'example.com'
    },
    pageData: {
      html: `
        <h2>Specifications</h2>
        <dl>
          <dt>Weight</dt><dd>60 g</dd>
          <dt>Polling Rate</dt><dd>8000 Hz</dd>
        </dl>
        <div>Sensor: Focus Pro 35K</div>
        <div>Connectivity: Wireless + USB-C</div>
      `,
      networkResponses: [],
      ldjsonBlocks: [],
      embeddedState: {}
    },
    adapterExtra: {},
    config: {
      llmMaxEvidenceChars: 4000
    },
    targetFields: ['weight', 'polling_rate', 'sensor']
  });

  const types = new Set((pack.references || []).map((row) => String(row.type || '')));
  assert.equal(types.has('definition'), true);
  assert.equal(types.has('kv'), true);
  assert.equal(types.has('window'), true);
  assert.equal((pack.references || []).length > 0, true);
  assert.equal((pack.snippets || []).length > 0, true);
  assert.equal(typeof pack.meta?.source_id, 'string');
  assert.equal((pack.sources && typeof pack.sources === 'object'), true);
  assert.equal(typeof pack.sources?.example_com?.page_content_hash, 'string');
  assert.equal(pack.sources?.example_com?.page_content_hash?.startsWith('sha256:'), true);
});

test('buildEvidencePackV2 emits snippet hashes and JSON-LD Product snippets', () => {
  const pack = buildEvidencePackV2({
    source: {
      url: 'https://example.com/mouse',
      host: 'example.com',
      sourceId: 'example_source'
    },
    pageData: {
      html: '<html><head><title>Product</title></head><body><table><tr><td>DPI</td><td>26000</td></tr></table></body></html>',
      networkResponses: [],
      ldjsonBlocks: [
        {
          '@type': 'Product',
          name: 'Example Mouse',
          brand: 'Example'
        }
      ],
      embeddedState: {}
    },
    adapterExtra: {},
    config: {
      llmMaxEvidenceChars: 5000
    },
    targetFields: ['dpi']
  });

  const snippet = (pack.snippets || [])[0];
  assert.equal(typeof snippet.id, 'string');
  assert.equal(typeof snippet.normalized_text, 'string');
  assert.equal(snippet.snippet_hash.startsWith('sha256:'), true);
  assert.equal(typeof snippet.retrieved_at, 'string');

  const jsonLdSnippet = (pack.snippets || []).find((row) => row.type === 'json_ld_product');
  assert.equal(Boolean(jsonLdSnippet), true);
  assert.equal(jsonLdSnippet.snippet_hash.startsWith('sha256:'), true);
  assert.equal(jsonLdSnippet.source_id, 'example_source');
});

test('buildEvidencePackV2 binds deterministic candidates to snippet ids', () => {
  const deterministicCandidate = {
    field: 'sensor',
    value: 'Focus Pro 35K',
    method: 'network_json',
    keyPath: 'data.product.sensor'
  };
  const pack = buildEvidencePackV2({
    source: {
      url: 'https://example.com/mouse',
      host: 'example.com',
      sourceId: 'example_source'
    },
    pageData: {
      html: '<html><body><h2>Specifications</h2><table><tr><td>Sensor</td><td>Focus Pro 35K</td></tr></table></body></html>',
      networkResponses: [],
      ldjsonBlocks: [],
      embeddedState: {}
    },
    adapterExtra: {},
    config: {
      llmMaxEvidenceChars: 6000
    },
    targetFields: ['sensor'],
    deterministicCandidates: [deterministicCandidate]
  });

  const fingerprint = fingerprintEvidenceCandidate(deterministicCandidate);
  const snippetId = pack.candidate_bindings?.[fingerprint];
  assert.equal(typeof snippetId, 'string');
  assert.equal(snippetId.length > 0, true);

  const boundSnippet = (pack.snippets || []).find((row) => row.id === snippetId);
  assert.equal(Boolean(boundSnippet), true);
  assert.equal(boundSnippet.type, 'deterministic_candidate');
  assert.equal(boundSnippet.candidate_fingerprint, fingerprint);
  assert.equal(boundSnippet.extraction_method, 'api_fetch');
});
