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
