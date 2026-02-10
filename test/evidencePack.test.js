import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidencePack } from '../src/llm/evidencePack.js';

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
