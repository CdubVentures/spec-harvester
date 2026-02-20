import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScopedItemCandidateId,
  buildManualOverrideCandidateId,
  buildPipelineEnumCandidateId,
  buildSyntheticComponentCandidateId,
  buildSyntheticGridAttributeCandidateId,
  buildSyntheticGridCandidateId,
  buildWorkbookFieldOverrideCandidateId,
} from '../src/utils/candidateIdentifier.js';

test('candidate identifiers are deterministic for identical input', () => {
  const first = buildSyntheticGridCandidateId({
    productId: 'mouse-logitech-g-pro-x-superlight-2',
    fieldKey: 'sensor',
    value: 'PixArt PAW3395',
  });
  const second = buildSyntheticGridCandidateId({
    productId: 'mouse-logitech-g-pro-x-superlight-2',
    fieldKey: 'sensor',
    value: 'PixArt PAW3395',
  });
  assert.equal(first, second);
  assert.equal(first.startsWith('pl-grid_'), true);
});

test('candidate identifiers differ across contexts for same value', () => {
  const grid = buildSyntheticGridCandidateId({
    productId: 'mouse-logitech-g-pro-x-superlight-2',
    fieldKey: 'sensor',
    value: 'PixArt PAW3395',
  });
  const component = buildSyntheticComponentCandidateId({
    componentType: 'sensor',
    componentName: 'PixArt PAW3395',
    propertyKey: '__name',
    value: 'PixArt PAW3395',
  });
  const enumId = buildPipelineEnumCandidateId({ fieldKey: 'connection', value: '2.4 GHz' });
  assert.notEqual(grid, component);
  assert.notEqual(grid, enumId);
  assert.notEqual(component, enumId);
});

test('manual and workbook candidate identifiers are stable and scoped', () => {
  const manual = buildManualOverrideCandidateId({
    category: 'mouse',
    productId: 'mouse-logitech-g-pro-x-superlight-2',
    fieldKey: 'weight',
    value: '59',
    evidenceUrl: 'https://manufacturer.example/specs',
    evidenceQuote: 'Weight: 59 g',
  });
  const workbook = buildWorkbookFieldOverrideCandidateId({
    productId: 'mouse-logitech-g-pro-x-superlight-2',
    fieldKey: 'weight',
    value: '59',
  });
  const attr = buildSyntheticGridAttributeCandidateId({
    productId: 'mouse-logitech-g-pro-x-superlight-2',
    fieldKey: 'sensor',
    attributeKey: 'sensor_brand',
    value: 'PixArt',
  });

  assert.equal(manual.startsWith('manual-item_'), true);
  assert.equal(workbook.startsWith('wb-item_'), true);
  assert.equal(attr.startsWith('pl-grid-attr_'), true);
  assert.notEqual(manual, workbook);
});

test('scoped item candidate identifiers include product+field scope for raw source ids', () => {
  const weight = buildScopedItemCandidateId({
    productId: 'mouse-logitech-g-pro-x-superlight-2',
    fieldKey: 'weight',
    rawCandidateId: 'cand_shared',
  });
  const dpi = buildScopedItemCandidateId({
    productId: 'mouse-logitech-g-pro-x-superlight-2',
    fieldKey: 'dpi',
    rawCandidateId: 'cand_shared',
  });
  assert.notEqual(weight, dpi);
  assert.equal(weight.includes('weight'), true);
  assert.equal(dpi.includes('dpi'), true);
});

test('scoped item candidate identifiers are deterministic when raw id is missing', () => {
  const first = buildScopedItemCandidateId({
    productId: 'mouse-logitech-g-pro-x-superlight-2',
    fieldKey: 'weight',
    value: '59',
    sourceHost: 'example.com',
    sourceMethod: 'dom',
    index: 1,
    runId: 'run-123',
  });
  const second = buildScopedItemCandidateId({
    productId: 'mouse-logitech-g-pro-x-superlight-2',
    fieldKey: 'weight',
    value: '59',
    sourceHost: 'example.com',
    sourceMethod: 'dom',
    index: 1,
    runId: 'run-123',
  });
  assert.equal(first, second);
  assert.equal(first.startsWith('item-source_'), true);
});
