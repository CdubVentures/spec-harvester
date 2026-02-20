import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractIdentityFromPairs,
  extractTablePairs,
  mapPairsToFieldCandidates
} from '../src/adapters/tableParsing.js';

test('tableParsing: extracts rows from html tables', () => {
  const html = `
    <table>
      <tr><th>Weight</th><td>59 g</td></tr>
      <tr><th>Polling Rate</th><td>1000 / 2000 / 4000 / 8000 Hz</td></tr>
      <tr><th>Sensor</th><td>PixArt PAW3395</td></tr>
    </table>
  `;

  const pairs = extractTablePairs(html);
  assert.equal(pairs.length >= 3, true);
  assert.equal(pairs.some((row) => row.key === 'Weight' && row.value.includes('59')), true);
  assert.equal(pairs.some((row) => row.key === 'Sensor' && row.value.includes('PAW3395')), true);
  const weightPair = pairs.find((row) => row.key === 'Weight');
  assert.equal(weightPair?.surface, 'static_table');
  assert.equal(String(weightPair?.path || '').startsWith('table['), true);
});

test('tableParsing: extracts dt/dd definition list pairs', () => {
  const html = `
    <dl>
      <dt>Brand</dt><dd>Razer</dd>
      <dt>Model</dt><dd>Viper V3 Pro</dd>
      <dt>SKU</dt><dd>RZ01-05120100-R3U1</dd>
    </dl>
  `;

  const pairs = extractTablePairs(html);
  assert.equal(pairs.some((row) => row.key === 'Brand' && row.value === 'Razer'), true);
  assert.equal(pairs.some((row) => row.key === 'Model' && row.value.includes('Viper')), true);
  assert.equal(pairs.some((row) => row.key === 'SKU' && row.value.includes('RZ01')), true);
});

test('tableParsing: maps parsed pairs to field candidates', () => {
  const pairs = [
    { key: 'Polling Rate', value: '125/250/500/1000/2000/4000/8000 Hz' },
    { key: 'Weight', value: '47 g' }
  ];

  const candidates = mapPairsToFieldCandidates(pairs, 'html_table');
  const polling = candidates.find((row) => row.field === 'polling_rate');
  const weight = candidates.find((row) => row.field === 'weight');

  assert.equal(Boolean(polling), true);
  assert.equal(String(polling.value).includes('8000'), true);
  assert.equal(weight?.value, '47');
  assert.equal(Boolean(weight?.evidence?.snippet_id), true);
  assert.equal(String(weight?.evidence?.snippet_hash || '').startsWith('sha256:'), true);
  assert.equal(weight?.surface, 'static_table');
  assert.equal(String(weight?.keyPath || '').length > 0, true);
});

test('tableParsing: supports explicit regex fallback mode', () => {
  const html = `
    <table>
      <tr><th>DPI</th><td>26000</td></tr>
    </table>
  `;
  const pairs = extractTablePairs(html, { mode: 'regex_fallback' });
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].key, 'DPI');
  assert.equal(pairs[0].surface, 'static_table');
  assert.equal(String(pairs[0].path || '').startsWith('table_regex.'), true);
});

test('tableParsing: extracts identity candidates from pairs', () => {
  const pairs = [
    { key: 'Manufacturer', value: 'Logitech' },
    { key: 'Model', value: 'G Pro X Superlight 2' },
    { key: 'Part Number', value: '910-006630' }
  ];

  const identity = extractIdentityFromPairs(pairs);
  assert.equal(identity.brand, 'Logitech');
  assert.equal(identity.model, 'G Pro X Superlight 2');
  assert.equal(identity.sku, '910-006630');
});

test('tableParsing: handles rowspan/colspan rows and section inheritance', () => {
  const html = `
    <table>
      <tr><th colspan="3">Dimensions</th></tr>
      <tr><th rowspan="2">Body</th><th>Width</th><td>2.4 in</td></tr>
      <tr><th>Height</th><td>4.1 cm</td></tr>
      <tr><th>Weight</th><td colspan="2">0.14 lb</td></tr>
    </table>
  `;

  const pairs = extractTablePairs(html);
  assert.equal(pairs.some((row) => row.key === 'Width' && row.value.includes('2.4')), true);
  assert.equal(pairs.some((row) => row.key === 'Height' && row.value.includes('4.1')), true);
  assert.equal(pairs.some((row) => row.key === 'Weight' && row.value.includes('0.14')), true);
  const widthPair = pairs.find((row) => row.key === 'Width');
  assert.equal(Boolean(widthPair?.normalized_key?.toLowerCase().includes('dimensions')), true);
  assert.equal(Boolean(widthPair?.row_id), true);
  assert.equal(Boolean(widthPair?.table_id), true);
});

test('tableParsing: normalizes units for dimensions and weight', () => {
  const pairs = [
    { key: 'Width', value: '2.5 in' },
    { key: 'Height', value: '6 cm' },
    { key: 'Weight', value: '0.15 lb' }
  ];

  const candidates = mapPairsToFieldCandidates(pairs, 'html_table');
  const width = candidates.find((row) => row.field === 'width');
  const height = candidates.find((row) => row.field === 'height');
  const weight = candidates.find((row) => row.field === 'weight');

  assert.equal(width?.value, '63.5');
  assert.equal(height?.value, '60');
  assert.equal(weight?.value, '68.04');
});
