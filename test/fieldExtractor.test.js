import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCandidatesFromPage } from '../src/extractors/fieldExtractor.js';

function pickFieldValue(rows = [], field) {
  const hit = rows.find((row) => row.field === field);
  return hit ? String(hit.value) : '';
}

test('extractCandidatesFromPage ignores render/image dimensions for physical size fields', () => {
  const extracted = extractCandidatesFromPage({
    host: 'example.com',
    html: '',
    title: 'Razer Viper V3 Pro',
    ldjsonBlocks: [],
    embeddedState: {},
    networkResponses: [
      {
        jsonFull: {
          image: {
            width: 375,
            height: 812
          },
          product: {
            width: '63',
            height: '39.5',
            length: '124'
          }
        }
      }
    ]
  });

  const width = pickFieldValue(extracted.fieldCandidates, 'width');
  const height = pickFieldValue(extracted.fieldCandidates, 'height');
  const lngth = pickFieldValue(extracted.fieldCandidates, 'lngth');
  assert.equal(width, '63');
  assert.equal(height, '39.5');
  assert.equal(lngth, '124');
});

test('extractCandidatesFromPage includes static DOM table extraction when enabled', () => {
  const extracted = extractCandidatesFromPage({
    host: 'example.com',
    html: `
      <html><body>
        <table>
          <tr><th>Weight</th><td>59 g</td></tr>
          <tr><th>DPI</th><td>30000</td></tr>
        </table>
      </body></html>
    `,
    title: 'Example Mouse',
    ldjsonBlocks: [],
    embeddedState: {},
    networkResponses: [],
    identityTarget: {
      model: 'Example Mouse'
    }
  });

  const weight = pickFieldValue(extracted.fieldCandidates, 'weight');
  const dpi = pickFieldValue(extracted.fieldCandidates, 'dpi');
  assert.equal(weight, '59');
  assert.equal(dpi, '30000');
  assert.equal(
    extracted.fieldCandidates.some((row) => row.field === 'weight' && row.target_match_passed === true),
    true
  );
  assert.equal(extracted.staticDom.parserStats.accepted_field_candidates >= 2, true);
});

test('extractCandidatesFromPage can disable static DOM extractor', () => {
  const extracted = extractCandidatesFromPage({
    host: 'example.com',
    html: '<table><tr><th>Weight</th><td>59 g</td></tr></table>',
    title: 'Example Mouse',
    ldjsonBlocks: [],
    embeddedState: {},
    networkResponses: [],
    staticDomExtractorEnabled: false
  });

  assert.equal(extracted.staticDom.parserStats.accepted_field_candidates, 0);
  assert.equal(
    extracted.fieldCandidates.some((row) => row.field === 'weight' && row.page_product_cluster_id),
    false
  );
});

test('extractCandidatesFromPage merges structured metadata surfaces with target identity gating', () => {
  const extracted = extractCandidatesFromPage({
    host: 'example.com',
    canonicalUrl: 'https://example.com/products/logitech-g-pro-x-superlight-2',
    html: '<html><body><h1>Logitech G Pro X Superlight 2</h1></body></html>',
    title: 'Logitech G Pro X Superlight 2',
    ldjsonBlocks: [],
    embeddedState: {},
    networkResponses: [],
    structuredMetadata: {
      ok: true,
      surfaces: {
        json_ld: [],
        microdata: [
          {
            brand: 'Logitech',
            model: 'G Pro X Superlight 2',
            specs: {
              weight: '60 g',
              dpi: '32000'
            }
          },
          {
            brand: 'Razer',
            model: 'Viper V3 Pro',
            specs: {
              weight: '54 g'
            }
          }
        ],
        rdfa: [],
        microformats: [],
        opengraph: {},
        twitter: {}
      },
      stats: {
        json_ld_count: 0,
        microdata_count: 2,
        rdfa_count: 0,
        microformats_count: 0,
        opengraph_count: 0,
        twitter_count: 0
      },
      errors: []
    },
    identityTarget: {
      brand: 'Logitech',
      model: 'G Pro X Superlight 2'
    },
    staticDomExtractorEnabled: false
  });

  const weights = extracted.fieldCandidates
    .filter((row) => row.field === 'weight')
    .map((row) => String(row.value));
  const dpi = pickFieldValue(extracted.fieldCandidates, 'dpi');
  assert.equal(weights.includes('60'), true);
  assert.equal(weights.includes('54'), false);
  assert.equal(dpi, '32000');
  assert.equal(
    extracted.fieldCandidates.some((row) => row.field === 'weight' && row.method === 'microdata'),
    true
  );
  assert.equal(Number(extracted?.structuredMetadata?.stats?.microdata_count || 0), 2);
  assert.equal(Number(extracted?.structuredMetadata?.stats?.structured_candidates || 0) >= 2, true);
});
