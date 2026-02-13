import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NORMALIZATION_FUNCTIONS,
  parseDimensionList,
  parseLatencyList,
  parsePollingList,
  normalizeColorList,
  parseDateExcel,
  normalizeBoolean,
  stripUnitSuffix
} from '../src/engine/normalization-functions.js';

test('parsePollingList sorts desc and de-duplicates values', () => {
  const row = parsePollingList('1000, 4000, 2000,1000');
  assert.deepEqual(row, [4000, 2000, 1000]);
});

test('parseDimensionList extracts length/width/height triplet', () => {
  const row = parseDimensionList('133.3 x 77.5 x 49mm');
  assert.deepEqual(row, {
    length: 133.3,
    width: 77.5,
    height: 49
  });
});

test('normalizeColorList lowercases and trims list tokens', () => {
  const row = normalizeColorList('White+Black, gray+black');
  assert.deepEqual(row, ['white+black', 'gray+black']);
});

test('parseLatencyList extracts mode/value tuples', () => {
  const row = parseLatencyList('14 wireless, 16 wired');
  assert.deepEqual(row, [
    { value: 14, mode: 'wireless' },
    { value: 16, mode: 'wired' }
  ]);
});

test('parseDateExcel converts serial dates and keeps string passthrough', () => {
  assert.equal(parseDateExcel(45292), '2024-01-01');
  assert.equal(parseDateExcel('2026-01-01'), '2026-01-01');
});

test('normalizeBoolean follows canonical boolean coercion semantics', () => {
  assert.equal(normalizeBoolean('yes'), true);
  assert.equal(normalizeBoolean('NO'), false);
  assert.equal(normalizeBoolean('unknown'), null);
});

test('stripUnitSuffix strips trailing symbols and keeps numeric prefix', () => {
  assert.equal(stripUnitSuffix('54g'), 54);
  assert.equal(stripUnitSuffix('3.5%'), 3.5);
});

test('conversion helpers convert expected units', () => {
  assert.equal(NORMALIZATION_FUNCTIONS.oz_to_g(3.5), 99);
  assert.equal(NORMALIZATION_FUNCTIONS.lbs_to_g(1), 454);
  assert.equal(NORMALIZATION_FUNCTIONS.inches_to_mm(2), 50.8);
  assert.equal(NORMALIZATION_FUNCTIONS.cm_to_mm(2.5), 25);
});
