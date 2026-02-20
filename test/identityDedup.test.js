import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanVariant,
  isFabricatedVariant,
  normalizeProductIdentity
} from '../src/catalog/identityDedup.js';

// --- cleanVariant ---

test('cleanVariant: strips placeholder values', () => {
  assert.equal(cleanVariant(''), '');
  assert.equal(cleanVariant('unk'), '');
  assert.equal(cleanVariant('Unknown'), '');
  assert.equal(cleanVariant('N/A'), '');
  assert.equal(cleanVariant('none'), '');
  assert.equal(cleanVariant('null'), '');
  assert.equal(cleanVariant('-'), '');
  assert.equal(cleanVariant('default'), '');
});

test('cleanVariant: preserves real variant values', () => {
  assert.equal(cleanVariant('Wireless'), 'Wireless');
  assert.equal(cleanVariant('Pro'), 'Pro');
  assert.equal(cleanVariant('M994'), 'M994');
});

test('cleanVariant: handles null/undefined', () => {
  assert.equal(cleanVariant(null), '');
  assert.equal(cleanVariant(undefined), '');
});

// --- isFabricatedVariant ---

test('isFabricatedVariant: "310" is fabricated from "Cestus 310"', () => {
  assert.equal(isFabricatedVariant('Cestus 310', '310'), true);
});

test('isFabricatedVariant: "Pro" is fabricated from "Alienware Pro"', () => {
  assert.equal(isFabricatedVariant('Alienware Pro', 'Pro'), true);
});

test('isFabricatedVariant: "Gladius III" is fabricated from "ROG Gladius III"', () => {
  assert.equal(isFabricatedVariant('ROG Gladius III', 'Gladius III'), true);
});

test('isFabricatedVariant: "M994" is fabricated from "Woki M994"', () => {
  assert.equal(isFabricatedVariant('Woki M994', 'M994'), true);
});

test('isFabricatedVariant: "Wireless" is NOT fabricated from "Viper V3 Pro"', () => {
  assert.equal(isFabricatedVariant('Viper V3 Pro', 'Wireless'), false);
});

test('isFabricatedVariant: empty variant is not fabricated', () => {
  assert.equal(isFabricatedVariant('Viper V3 Pro', ''), false);
  assert.equal(isFabricatedVariant('Viper V3 Pro', null), false);
});

test('isFabricatedVariant: placeholder variant is not fabricated', () => {
  assert.equal(isFabricatedVariant('Viper V3 Pro', 'N/A'), false);
  assert.equal(isFabricatedVariant('Viper V3 Pro', 'unknown'), false);
});

test('isFabricatedVariant: variant is exact model name', () => {
  assert.equal(isFabricatedVariant('G Pro X Superlight', 'G Pro X Superlight'), true);
});

test('isFabricatedVariant: single shared token but variant has unique info', () => {
  // "Pro Max" has "Pro" from model but also "Max" which is new info
  assert.equal(isFabricatedVariant('Viper V3 Pro', 'Pro Max'), false);
});

test('isFabricatedVariant: case insensitive', () => {
  assert.equal(isFabricatedVariant('CESTUS 310', '310'), true);
  assert.equal(isFabricatedVariant('cestus 310', '310'), true);
});

// --- normalizeProductIdentity ---

test('normalizeProductIdentity: strips fabricated variant and builds correct ID', () => {
  const result = normalizeProductIdentity('mouse', 'Acer', 'Cestus 310', '310');
  assert.equal(result.productId, 'mouse-acer-cestus-310');
  assert.equal(result.variant, '');
  assert.equal(result.wasCleaned, true);
  assert.equal(result.reason, 'fabricated_variant_stripped');
});

test('normalizeProductIdentity: keeps real variant', () => {
  const result = normalizeProductIdentity('mouse', 'Razer', 'Viper V3 Pro', 'Wireless');
  assert.equal(result.productId, 'mouse-razer-viper-v3-pro-wireless');
  assert.equal(result.variant, 'Wireless');
  assert.equal(result.wasCleaned, false);
  assert.equal(result.reason, null);
});

test('normalizeProductIdentity: empty variant remains empty, no fabrication flag', () => {
  const result = normalizeProductIdentity('mouse', 'Logitech', 'G Pro X Superlight 2', '');
  assert.equal(result.productId, 'mouse-logitech-g-pro-x-superlight-2');
  assert.equal(result.variant, '');
  assert.equal(result.wasCleaned, false);
});

test('normalizeProductIdentity: placeholder variant cleaned', () => {
  const result = normalizeProductIdentity('mouse', 'Corsair', 'M65 RGB Ultra', 'N/A');
  assert.equal(result.productId, 'mouse-corsair-m65-rgb-ultra');
  assert.equal(result.variant, '');
  assert.equal(result.wasCleaned, false); // placeholder cleaning is not "fabricated"
});

test('normalizeProductIdentity: diacritics handled correctly', () => {
  const result = normalizeProductIdentity('mouse', 'Señor', 'Café Mouse', '');
  assert.equal(result.productId, 'mouse-senor-cafe-mouse');
  assert.equal(result.brand, 'Señor'); // original brand preserved, only slug is NFD-normalized
});

test('normalizeProductIdentity: Redragon Woki M994 fabricated variant', () => {
  const result = normalizeProductIdentity('mouse', 'Redragon', 'Woki M994', 'M994');
  assert.equal(result.productId, 'mouse-redragon-woki-m994');
  assert.equal(result.variant, '');
  assert.equal(result.wasCleaned, true);
});

test('normalizeProductIdentity: null inputs produce empty productId', () => {
  const result = normalizeProductIdentity('mouse', null, null, null);
  assert.equal(result.productId, 'mouse');
  assert.equal(result.brand, '');
  assert.equal(result.model, '');
  assert.equal(result.variant, '');
});
