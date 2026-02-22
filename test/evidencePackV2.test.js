import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidencePackV2, fingerprintEvidenceCandidate, stripHtml } from '../src/evidence/evidencePackV2.js';

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
      llmMaxEvidenceChars: 4000,
      articleExtractorDomainPolicyMap: {
        'example.com': {
          mode: 'prefer_fallback',
          minChars: 300,
          minScore: 15
        }
      }
    },
    targetFields: ['weight', 'polling_rate', 'sensor']
  });

  const types = new Set((pack.references || []).map((row) => String(row.type || '')));
  assert.equal(types.has('readability_text'), true);
  assert.equal(types.has('definition'), true);
  assert.equal(types.has('kv'), true);
  assert.equal(types.has('window'), true);
  assert.equal((pack.references || []).length > 0, true);
  assert.equal((pack.snippets || []).length > 0, true);
  assert.equal(typeof pack.meta?.source_id, 'string');
  assert.equal((pack.sources && typeof pack.sources === 'object'), true);
  assert.equal(typeof pack.sources?.example_com?.page_content_hash, 'string');
  assert.equal(pack.sources?.example_com?.page_content_hash?.startsWith('sha256:'), true);
  assert.equal(typeof pack.meta?.article_extraction?.method, 'string');
  assert.equal(typeof pack.meta?.article_extraction?.quality_score, 'number');
  assert.equal(pack.meta?.article_extraction?.policy_mode, 'prefer_fallback');
  assert.equal(pack.meta?.article_extraction?.policy_matched_host, 'example.com');
  assert.equal(pack.meta?.article_extraction?.policy_override_applied, true);
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

test('buildEvidencePackV2 emits compact screenshot metadata without binary payload leakage', () => {
  const pack = buildEvidencePackV2({
    source: {
      url: 'https://example.com/mouse',
      host: 'example.com',
      sourceId: 'example_source'
    },
    pageData: {
      html: '<html><body><h2>Specifications</h2><table><tr><td>Weight</td><td>60 g</td></tr></table></body></html>',
      networkResponses: [],
      ldjsonBlocks: [],
      embeddedState: {},
      screenshot: {
        kind: 'page',
        format: 'jpeg',
        width: 1920,
        height: 1080,
        bytes: Buffer.from('fake-binary-image-data')
      }
    },
    adapterExtra: {},
    config: {
      llmMaxEvidenceChars: 6000
    },
    targetFields: ['weight']
  });

  const screenshotSnippet = (pack.snippets || []).find((row) => row.type === 'screenshot_capture');
  assert.equal(Boolean(screenshotSnippet), true);
  assert.equal(String(screenshotSnippet.text || '').includes('fake-binary-image-data'), false);
  assert.equal(String(screenshotSnippet.text || '').includes('bytes=22'), true);
  assert.equal(Boolean(pack.meta?.visual_artifacts?.screenshot_available), true);
});

test('buildEvidencePackV2 emits structured metadata snippet types from sidecar surfaces', () => {
  const pack = buildEvidencePackV2({
    source: {
      url: 'https://example.com/mouse',
      host: 'example.com',
      sourceId: 'example_source'
    },
    pageData: {
      html: '<html><body><h1>Example Mouse</h1></body></html>',
      networkResponses: [],
      ldjsonBlocks: [],
      embeddedState: {},
      structuredMetadata: {
        ok: true,
        surfaces: {
          json_ld: [],
          microdata: [{ weight: '60 g', dpi: '26000' }],
          rdfa: [{ pollingRate: '8000 Hz' }],
          microformats: [{ battery: '95 hours' }],
          opengraph: { 'product:brand': 'Example', 'product:weight': '60 g' },
          twitter: { 'twitter:title': 'Example Mouse' }
        },
        stats: {
          json_ld_count: 0,
          microdata_count: 1,
          rdfa_count: 1,
          microformats_count: 1,
          opengraph_count: 2,
          twitter_count: 1,
          structured_candidates: 4,
          structured_rejected_candidates: 0
        },
        errors: []
      }
    },
    adapterExtra: {},
    config: {
      llmMaxEvidenceChars: 9000
    },
    targetFields: ['weight', 'dpi', 'polling_rate']
  });

  const snippetTypes = new Set((pack.snippets || []).map((row) => String(row.type || '')));
  assert.equal(snippetTypes.has('microdata_product'), true);
  assert.equal(snippetTypes.has('rdfa_product'), true);
  assert.equal(snippetTypes.has('microformat_product'), true);
  assert.equal(snippetTypes.has('opengraph_product'), true);
  assert.equal(snippetTypes.has('twitter_card_product'), true);
  assert.equal(Number(pack?.meta?.structured_metadata?.microdata_count || 0), 1);
  assert.equal(Number(pack?.meta?.structured_metadata?.opengraph_count || 0), 2);
});

test('buildEvidencePackV2 emits PDF router metadata and row-level PDF snippets', () => {
  const pack = buildEvidencePackV2({
    source: {
      url: 'https://example.com/mouse',
      host: 'example.com',
      sourceId: 'example_source'
    },
    pageData: {
      html: '<html><body><h1>Example Mouse</h1></body></html>',
      networkResponses: [],
      ldjsonBlocks: [],
      embeddedState: {}
    },
    adapterExtra: {
      pdfDocs: [
        {
          url: 'https://example.com/manual.pdf',
          filename: 'manual.pdf',
          textPreview: 'Weight: 60 g\\nPolling Rate: 8000 Hz',
          backend_selected: 'pdfplumber',
          pair_count: 3,
          kv_pair_count: 2,
          table_pair_count: 1,
          pages_scanned: 2,
          tables_found: 1,
          kv_preview_rows: [
            { key: 'Weight', value: '60 g', path: 'pdf.page[1].kv[1]', surface: 'pdf_kv' }
          ],
          table_preview_rows: [
            { key: 'Polling Rate', value: '8000 Hz', path: 'pdf.page[1].table[t1].row[1]', surface: 'pdf_table' }
          ]
        }
      ],
      pdfStats: {
        docs_discovered: 1,
        docs_fetched: 1,
        docs_parsed: 1,
        docs_failed: 0,
        requested_backend: 'auto',
        backend_selected: 'pdfplumber',
        backend_fallback_count: 0,
        pair_count: 3,
        kv_pair_count: 2,
        table_pair_count: 1,
        pages_scanned: 2,
        tables_found: 1,
        error_count: 0,
        errors: []
      }
    },
    config: {
      llmMaxEvidenceChars: 9000
    },
    targetFields: ['weight', 'polling_rate']
  });

  const snippetTypes = new Set((pack.snippets || []).map((row) => String(row.type || '')));
  assert.equal(snippetTypes.has('pdf_doc_meta'), true);
  assert.equal(snippetTypes.has('pdf'), true);
  assert.equal(snippetTypes.has('pdf_kv_row'), true);
  assert.equal(snippetTypes.has('pdf_table_row'), true);
  assert.equal(String(pack?.meta?.pdf_extraction?.backend_selected || ''), 'pdfplumber');
  assert.equal(Number(pack?.meta?.pdf_extraction?.pair_count || 0), 3);
});

test('buildEvidencePackV2 output includes chunk_data array with expected fields', () => {
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
        </dl>
      `,
      networkResponses: [],
      ldjsonBlocks: [],
      embeddedState: {}
    },
    adapterExtra: {},
    config: {
      llmMaxEvidenceChars: 4000,
      articleExtractorDomainPolicyMap: {
        'example.com': { mode: 'prefer_fallback', minChars: 300, minScore: 15 }
      }
    },
    targetFields: ['weight']
  });

  assert.equal(Array.isArray(pack.chunk_data), true);
  assert.equal(pack.chunk_data.length > 0, true);
  assert.equal(pack.chunk_data.length, pack.snippets.length);

  const first = pack.chunk_data[0];
  assert.equal(typeof first.contentHash, 'string');
  assert.equal(typeof first.normalizedText, 'string');
  assert.equal(typeof first.text, 'string');
  assert.equal(typeof first.type, 'string');
  assert.equal(typeof first.extractionMethod, 'string');
  assert.equal(Array.isArray(first.fieldHints), true);
  assert.equal(typeof first.chunkIndex, 'number');
});

test('buildEvidencePackV2 produces sn_ prefixed snippet IDs instead of index-based IDs', () => {
  const pack = buildEvidencePackV2({
    source: {
      url: 'https://example.com/mouse',
      host: 'example.com'
    },
    pageData: {
      html: `
        <dl><dt>Weight</dt><dd>60 g</dd></dl>
        <table><tr><td>DPI</td><td>26000</td></tr></table>
      `,
      networkResponses: [],
      ldjsonBlocks: [],
      embeddedState: {}
    },
    adapterExtra: {},
    config: {
      llmMaxEvidenceChars: 4000,
      articleExtractorDomainPolicyMap: {
        'example.com': { mode: 'prefer_fallback', minChars: 300, minScore: 15 }
      }
    },
    targetFields: ['weight', 'dpi']
  });

  for (const snippet of pack.snippets) {
    assert.equal(snippet.id.startsWith('sn_'), true,
      `Snippet ID "${snippet.id}" should start with "sn_"`);
    assert.equal(snippet.id.length, 3 + 16,
      `Snippet ID "${snippet.id}" should be 19 chars (sn_ + 16 hex)`);
  }

  for (const ref of pack.references) {
    assert.equal(ref.id.startsWith('sn_'), true,
      `Reference ID "${ref.id}" should start with "sn_"`);
  }
});

test('buildEvidencePackV2 produces deterministic IDs — same content indexed twice gives same IDs', () => {
  const args = {
    source: {
      url: 'https://example.com/stable',
      host: 'example.com'
    },
    pageData: {
      html: '<dl><dt>Sensor</dt><dd>Focus Pro 35K</dd></dl>',
      networkResponses: [],
      ldjsonBlocks: [],
      embeddedState: {}
    },
    adapterExtra: {},
    config: { llmMaxEvidenceChars: 3000 },
    targetFields: ['sensor']
  };

  const pack1 = buildEvidencePackV2(args);
  const pack2 = buildEvidencePackV2(args);

  assert.equal(pack1.snippets.length, pack2.snippets.length);
  for (let i = 0; i < pack1.snippets.length; i += 1) {
    assert.equal(pack1.snippets[i].id, pack2.snippets[i].id,
      `Snippet at index ${i} should have identical IDs across runs`);
  }
});

test('buildEvidencePackV2 candidate_bindings use sn_ prefixed IDs', () => {
  const pack = buildEvidencePackV2({
    source: {
      url: 'https://example.com/mouse',
      host: 'example.com'
    },
    pageData: {
      html: '<table><tr><td>Weight</td><td>60g</td></tr></table>',
      networkResponses: [],
      ldjsonBlocks: [],
      embeddedState: {}
    },
    adapterExtra: {},
    config: { llmMaxEvidenceChars: 3000 },
    targetFields: ['weight'],
    deterministicCandidates: [
      { field: 'weight', value: '60g', method: 'html_table', keyPath: 'table.weight' }
    ]
  });

  const bindings = pack.candidate_bindings;
  assert.equal(Object.keys(bindings).length > 0, true);
  for (const snippetId of Object.values(bindings)) {
    assert.equal(snippetId.startsWith('sn_'), true,
      `Candidate binding snippet ID "${snippetId}" should start with "sn_"`);
  }
});

test('stripHtml removes script, style, and noscript block tags', () => {
  assert.equal(stripHtml('<script>alert("xss")</script>hello'), 'hello');
  assert.equal(stripHtml('<style>.x{color:red}</style>world'), 'world');
  assert.equal(stripHtml('<noscript>Enable JS</noscript>text'), 'text');
  assert.equal(stripHtml('<SCRIPT type="text/javascript">var x=1;</SCRIPT>ok'), 'ok');
});

test('stripHtml removes HTML comments', () => {
  assert.equal(stripHtml('before<!-- comment -->after'), 'beforeafter');
  assert.equal(stripHtml('<!-- multi\nline\ncomment -->text'), 'text');
});

test('stripHtml removes remaining HTML tags', () => {
  assert.equal(stripHtml('<p>paragraph</p>'), 'paragraph');
  assert.equal(stripHtml('<div class="x"><span>nested</span></div>'), 'nested');
  assert.equal(stripHtml('<br/>line<br>break'), 'line break');
});

test('stripHtml decodes all 6 HTML entities', () => {
  assert.equal(stripHtml('&nbsp;'), '');
  assert.equal(stripHtml('&amp;'), '&');
  assert.equal(stripHtml('&lt;'), '<');
  assert.equal(stripHtml('&gt;'), '>');
  assert.equal(stripHtml('&quot;'), '"');
  assert.equal(stripHtml('&#39;'), "'");
  assert.equal(stripHtml('a&amp;b&lt;c&gt;d&quot;e&#39;f'), 'a&b<c>d"e\'f');
});

test('stripHtml normalizes whitespace and trims', () => {
  assert.equal(stripHtml('  hello   world  '), 'hello world');
  assert.equal(stripHtml('\n\t  spaced  \n\t'), 'spaced');
});

test('stripHtml handles empty and null input', () => {
  assert.equal(stripHtml(''), '');
  assert.equal(stripHtml(null), '');
  assert.equal(stripHtml(undefined), '');
});

test('stripHtml handles complex nested content', () => {
  const html = '<div><script>evil()</script><p>Weight: 49&nbsp;g &amp; more</p><style>.x{}</style></div>';
  assert.equal(stripHtml(html), 'Weight: 49 g & more');
});
