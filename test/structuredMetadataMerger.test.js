import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeStructuredMetadataCandidates } from '../src/extract/structuredMetadataMerger.js';

function pickFieldFromPath(path = '') {
  const token = String(path || '').toLowerCase();
  if (token.includes('weight')) return 'weight';
  if (token.includes('dpi')) return 'dpi';
  if (token.includes('brand')) return 'brand';
  if (token.includes('model')) return 'model';
  return null;
}

function normalizeByField(field = '', value = '') {
  const text = String(value || '').trim();
  if (!text) return 'unk';
  if (field === 'weight') {
    const match = text.match(/\d+(\.\d+)?/);
    return match ? match[0] : 'unk';
  }
  return text;
}

function gatherIdentityCandidates(flattened = []) {
  const out = {};
  for (const row of flattened) {
    const token = String(row?.path || '').toLowerCase();
    const value = String(row?.value || '').trim();
    if (!value) continue;
    if (token.endsWith('brand')) out.brand = value;
    if (token.endsWith('model')) out.model = value;
  }
  return out;
}

test('mergeStructuredMetadataCandidates adds accepted structured rows and rejects non-target rows', () => {
  const merged = mergeStructuredMetadataCandidates({
    baseCandidates: [
      { field: 'dpi', value: '26000', method: 'network_json', keyPath: 'data.specs.dpi' }
    ],
    sidecarResult: {
      ok: true,
      surfaces: {
        json_ld: [],
        microdata: [
          {
            brand: 'Logitech',
            model: 'G Pro X Superlight 2',
            specs: { weight: '60 g' }
          },
          {
            brand: 'Razer',
            model: 'Viper V3 Pro',
            specs: { weight: '54 g' }
          }
        ],
        rdfa: [],
        microformats: [],
        opengraph: {},
        twitter: {}
      },
      stats: {
        microdata_count: 2
      },
      errors: []
    },
    identityTarget: {
      brand: 'Logitech',
      model: 'G Pro X Superlight 2'
    },
    canonicalUrl: 'https://example.com/product',
    pickFieldFromPath,
    normalizeByField,
    gatherIdentityCandidates
  });

  const weights = merged.fieldCandidates.filter((row) => row.field === 'weight').map((row) => row.value);
  assert.equal(weights.includes('60'), true);
  assert.equal(weights.includes('54'), false);
  assert.equal(Number(merged.stats.microdata_count || 0), 2);
  assert.equal(Number(merged.stats.structured_candidates || 0) >= 1, true);
  assert.equal(merged.rejectedFieldCandidates.length >= 1, true);
});

