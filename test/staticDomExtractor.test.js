import test from 'node:test';
import assert from 'node:assert/strict';
import { extractStaticDomCandidates } from '../src/extractors/staticDomExtractor.js';

test('staticDomExtractor extracts table candidates with deterministic evidence metadata', () => {
  const html = `
    <html>
      <head><title>Razer Viper V3 Pro Specs</title></head>
      <body>
        <h1>Razer Viper V3 Pro</h1>
        <table>
          <tr><th>Weight</th><td>54 g</td></tr>
          <tr><th>Polling Rate</th><td>1000 / 2000 / 4000 / 8000 Hz</td></tr>
        </table>
      </body>
    </html>
  `;
  const extracted = extractStaticDomCandidates({
    html,
    title: 'Razer Viper V3 Pro Specs',
    identityTarget: {
      brand: 'Razer',
      model: 'Viper V3 Pro'
    }
  });

  const weight = extracted.fieldCandidates.find((row) => row.field === 'weight');
  assert.equal(Boolean(weight), true);
  assert.equal(weight?.target_match_passed, true);
  assert.equal(typeof weight?.page_product_cluster_id, 'string');
  assert.equal(String(weight?.evidence?.snippet_id || '').startsWith('sn_'), true);
  assert.equal(String(weight?.evidence?.snippet_hash || '').startsWith('sha256:'), true);
  assert.equal(weight?.evidence?.surface, 'static_table');
  assert.equal(extracted.parserStats.accepted_field_candidates >= 1, true);
});

test('staticDomExtractor identity gate rejects non-target cluster assertions on multi-product pages', () => {
  const html = `
    <html>
      <body>
        <div class="product-card" data-product="viper">
          <h2>Razer Viper V3 Pro</h2>
          <table>
            <tr><th>Weight</th><td>54 g</td></tr>
          </table>
        </div>
        <div class="product-card" data-product="cobra">
          <h2>Razer Cobra Pro</h2>
          <table>
            <tr><th>Weight</th><td>77 g</td></tr>
          </table>
        </div>
      </body>
    </html>
  `;
  const extracted = extractStaticDomCandidates({
    html,
    identityTarget: {
      brand: 'Razer',
      model: 'Viper V3 Pro'
    },
    targetMatchThreshold: 0.52
  });

  const weights = extracted.fieldCandidates
    .filter((row) => row.field === 'weight')
    .map((row) => String(row.value));
  assert.equal(weights.includes('54'), true);
  assert.equal(weights.includes('77'), false);
  assert.equal(extracted.parserStats.rejected_field_candidates >= 1, true);
});
