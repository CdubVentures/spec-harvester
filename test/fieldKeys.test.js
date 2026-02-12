import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isIdentityField,
  normalizeFieldList,
  normalizeRequiredFieldPath,
  normalizeRequiredFieldPaths,
  toRawFieldKey
} from '../src/utils/fieldKeys.js';

test('toRawFieldKey normalizes field paths and aliases', () => {
  const fieldOrder = ['weight', 'switches_link', 'polling_rate', 'brand'];
  assert.equal(toRawFieldKey('fields.weight', { fieldOrder }), 'weight');
  assert.equal(toRawFieldKey('identity.brand', { fieldOrder }), 'brand');
  assert.equal(toRawFieldKey('switch_link', { fieldOrder }), 'switches_link');
  assert.equal(toRawFieldKey('fields.polling-rate', { fieldOrder }), 'polling_rate');
});

test('normalizeFieldList de-dupes and keeps canonical fields', () => {
  const fieldOrder = ['weight', 'polling_rate', 'dpi'];
  const out = normalizeFieldList([
    'fields.weight',
    'weight',
    'fields.polling_rate',
    'dpi',
    'identity.brand'
  ], { fieldOrder });
  assert.deepEqual(out, ['weight', 'polling_rate', 'dpi', 'brand']);
});

test('normalizeRequiredFieldPath maps identity and field paths correctly', () => {
  const fieldOrder = ['weight', 'polling_rate', 'brand'];
  assert.equal(normalizeRequiredFieldPath('fields.weight', { fieldOrder }), 'fields.weight');
  assert.equal(normalizeRequiredFieldPath('weight', { fieldOrder }), 'fields.weight');
  assert.equal(normalizeRequiredFieldPath('brand', { fieldOrder }), 'identity.brand');
  assert.equal(normalizeRequiredFieldPath('identity.model', { fieldOrder }), 'identity.model');
});

test('normalizeRequiredFieldPaths normalizes list and removes duplicates', () => {
  const out = normalizeRequiredFieldPaths([
    'fields.weight',
    'weight',
    'identity.brand',
    'brand'
  ], {
    fieldOrder: ['weight', 'brand']
  });
  assert.deepEqual(out, ['fields.weight', 'identity.brand']);
  assert.equal(isIdentityField('brand'), true);
  assert.equal(isIdentityField('weight'), false);
});
