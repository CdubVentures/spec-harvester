import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPdfText,
  extractTablesFromPdfText,
  parsePdfSpecTable
} from '../src/extract/pdfTableExtractor.js';

// ---------------------------------------------------------------------------
// IP02-2D — PDF Table Extraction Tests
// ---------------------------------------------------------------------------

const SAMPLE_PDF_TEXT = `
Razer Viper V3 Pro — Technical Specifications

Specification          Value
Weight                 54g
Sensor                 Focus Pro 4K
Max DPI                35000
Polling Rate           4000 Hz
Connectivity           2.4 GHz Wireless
Battery Life           95 hours
Switches               Gen-3 Optical
Shape                  Ambidextrous
Buttons                5

For more information visit razer.com
`;

const MULTI_TABLE_TEXT = `
Product Overview

The Razer Viper V3 Pro is a flagship wireless gaming mouse.

Performance Specifications:
Parameter             Value
Sensor                Focus Pro 4K
Max DPI               35000
Polling Rate          4000 Hz

This section contains no tabular data at all.
Instead it is just prose about the mouse design philosophy.

Physical Specifications:
Feature               Detail
Weight                54g
Dimensions            127 x 64 x 40 mm
Cable Length           1.8m
`;

test('pdf: extractPdfText returns text from simulated PDF content', async () => {
  // Since we can't create a real PDF in tests, we test the text processing
  const text = await extractPdfText({ text: SAMPLE_PDF_TEXT });
  assert.ok(text.includes('Weight'));
  assert.ok(text.includes('54g'));
});

test('pdf: extractTablesFromPdfText finds spec tables', () => {
  const tables = extractTablesFromPdfText(SAMPLE_PDF_TEXT);
  assert.ok(tables.length >= 1);
  assert.ok(tables[0].rows.length >= 5);
});

test('pdf: table rows have key-value structure', () => {
  const tables = extractTablesFromPdfText(SAMPLE_PDF_TEXT);
  const firstRow = tables[0].rows[0];
  assert.ok(firstRow.key);
  assert.ok(firstRow.value);
});

test('pdf: extracts weight from spec table', () => {
  const tables = extractTablesFromPdfText(SAMPLE_PDF_TEXT);
  const allRows = tables.flatMap((t) => t.rows);
  const weightRow = allRows.find((r) => r.key.toLowerCase().includes('weight'));
  assert.ok(weightRow);
  assert.ok(weightRow.value.includes('54'));
});

test('pdf: extracts sensor from spec table', () => {
  const tables = extractTablesFromPdfText(SAMPLE_PDF_TEXT);
  const allRows = tables.flatMap((t) => t.rows);
  const sensorRow = allRows.find((r) => r.key.toLowerCase().includes('sensor'));
  assert.ok(sensorRow);
  assert.ok(sensorRow.value.includes('Focus Pro'));
});

test('pdf: handles multi-table documents', () => {
  const tables = extractTablesFromPdfText(MULTI_TABLE_TEXT);
  assert.ok(tables.length >= 2);
});

test('pdf: parsePdfSpecTable converts to field map', () => {
  const tables = extractTablesFromPdfText(SAMPLE_PDF_TEXT);
  const fieldMap = parsePdfSpecTable(tables);
  assert.ok(fieldMap.weight);
  assert.ok(fieldMap.sensor);
  assert.ok(fieldMap.polling_rate || fieldMap['polling rate']);
});

test('pdf: handles empty text', () => {
  const tables = extractTablesFromPdfText('');
  assert.equal(tables.length, 0);
});

test('pdf: handles text with no tables', () => {
  const tables = extractTablesFromPdfText('Just some random text with no table structure at all.');
  assert.equal(tables.length, 0);
});

test('pdf: ignores non-spec content', () => {
  const tables = extractTablesFromPdfText(SAMPLE_PDF_TEXT);
  const allRows = tables.flatMap((t) => t.rows);
  // "For more information" should not be in any table
  assert.ok(!allRows.some((r) => r.key.toLowerCase().includes('for more information')));
});
