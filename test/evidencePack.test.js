import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidenceCandidateFingerprint, buildEvidencePack } from '../src/llm/evidencePack.js';

test('buildEvidencePack respects max char bound and emits evidence references', () => {
  const source = {
    url: 'https://example.com/product',
    host: 'example.com'
  };

  const pageData = {
    title: 'Example Mouse',
    html: '<table><tr><td>Sensor</td><td>Focus Pro 35K</td></tr></table>',
    ldjsonBlocks: [{ '@type': 'Product', name: 'Example Mouse' }],
    embeddedState: {
      nextData: {
        props: { pageProps: { sensor: 'Focus Pro 35K' } }
      }
    },
    networkResponses: [
      {
        url: 'https://api.example.com/graphql',
        classification: 'specs',
        jsonFull: {
          product: {
            sensor: 'Focus Pro 35K',
            polling_rate: [1000, 500, 250]
          }
        }
      }
    ]
  };

  const pack = buildEvidencePack({
    source,
    pageData,
    adapterExtra: {
      pdfDocs: [
        {
          url: 'https://example.com/manual.pdf',
          textPreview: 'Sensor: Focus Pro 35K'
        }
      ]
    },
    config: {
      openaiMaxInputChars: 800
    }
  });

  assert.equal((pack.meta?.total_chars || 0) <= 800, true);
  assert.equal(pack.snippets.length > 0, true);
  assert.equal(pack.references.length > 0, true);

  const serialized = JSON.stringify(pack).toLowerCase();
  assert.equal(serialized.includes('authorization'), false);
  assert.equal(serialized.includes('cookie'), false);
});

test('buildEvidencePack exposes deterministic candidate bindings for parser-native citations', () => {
  const deterministicCandidate = {
    field: 'dpi',
    value: '32000',
    method: 'network_json',
    keyPath: 'data.product.dpi'
  };
  const source = {
    url: 'https://example.com/product',
    host: 'example.com',
    sourceId: 'example_source'
  };
  const pageData = {
    title: 'Example Mouse',
    html: '<table><tr><td>DPI</td><td>32000</td></tr></table>',
    ldjsonBlocks: [],
    embeddedState: {},
    networkResponses: []
  };

  const pack = buildEvidencePack({
    source,
    pageData,
    adapterExtra: {},
    config: {
      llmMaxEvidenceChars: 6000
    },
    deterministicCandidates: [deterministicCandidate]
  });

  const fingerprint = buildEvidenceCandidateFingerprint(deterministicCandidate);
  const snippetId = pack.candidate_bindings?.[fingerprint];
  assert.equal(typeof snippetId, 'string');
  assert.equal(snippetId.length > 0, true);

  const snippet = (pack.snippets || []).find((row) => row.id === snippetId);
  assert.equal(Boolean(snippet), true);
  assert.equal(snippet.type, 'deterministic_candidate');
});
