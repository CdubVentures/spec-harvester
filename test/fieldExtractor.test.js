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

