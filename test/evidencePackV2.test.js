import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidencePackV2 } from '../src/evidence/evidencePackV2.js';

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
});
