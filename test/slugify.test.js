import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify, buildProductId } from '../src/catalog/slugify.js';

// --- slugify ---

test('slugify: basic lowercase + spaces to hyphens', () => {
  assert.equal(slugify('Logitech G Pro'), 'logitech-g-pro');
});

test('slugify: strips diacritics via NFD normalization', () => {
  assert.equal(slugify('Señor Café'), 'senor-cafe');
  assert.equal(slugify('Ülker Çikolata'), 'ulker-cikolata');
});

test('slugify: preserves underscores', () => {
  assert.equal(slugify('viper_v3_pro'), 'viper_v3_pro');
  assert.equal(slugify('G Pro_X Superlight'), 'g-pro_x-superlight');
});

test('slugify: strips special characters', () => {
  assert.equal(slugify('ROG Gladius III (Wireless)'), 'rog-gladius-iii-wireless');
  assert.equal(slugify('G502 X PLUS™'), 'g502-x-plus');
});

test('slugify: collapses sequential hyphens', () => {
  assert.equal(slugify('A  --  B'), 'a-b');
  assert.equal(slugify('---hello---'), 'hello');
});

test('slugify: returns empty string for falsy values', () => {
  assert.equal(slugify(''), '');
  assert.equal(slugify(null), '');
  assert.equal(slugify(undefined), '');
  assert.equal(slugify(0), '');
  assert.equal(slugify(false), '');
});

test('slugify: handles numeric-only input', () => {
  assert.equal(slugify('310'), '310');
  assert.equal(slugify('123 456'), '123-456');
});

test('slugify: handles already-slugified input idempotently', () => {
  const input = 'logitech-g-pro-x-superlight-2';
  assert.equal(slugify(input), input);
});

test('slugify: trims whitespace before processing', () => {
  assert.equal(slugify('  Razer Viper  '), 'razer-viper');
});

test('slugify: handles brands with ampersands and dots', () => {
  // dots are non-alphanumeric so they get stripped; adjacent letters merge
  assert.equal(slugify('Mad Catz R.A.T. 8+'), 'mad-catz-rat-8');
});

// --- buildProductId ---

test('buildProductId: category + brand + model, no variant', () => {
  assert.equal(
    buildProductId('mouse', 'Razer', 'Viper V3 Pro', ''),
    'mouse-razer-viper-v3-pro'
  );
});

test('buildProductId: with variant', () => {
  assert.equal(
    buildProductId('mouse', 'Razer', 'Viper V3 Pro', 'Wireless'),
    'mouse-razer-viper-v3-pro-wireless'
  );
});

test('buildProductId: empty variant is omitted (no trailing hyphen)', () => {
  const id = buildProductId('mouse', 'Logitech', 'G Pro X Superlight 2', '');
  assert.equal(id, 'mouse-logitech-g-pro-x-superlight-2');
  assert.ok(!id.endsWith('-'));
});

test('buildProductId: null/undefined variant omitted', () => {
  assert.equal(
    buildProductId('mouse', 'Acer', 'Cestus 310', null),
    'mouse-acer-cestus-310'
  );
  assert.equal(
    buildProductId('mouse', 'Acer', 'Cestus 310', undefined),
    'mouse-acer-cestus-310'
  );
});

test('buildProductId: diacritics in brand', () => {
  assert.equal(
    buildProductId('mouse', 'Señor Mouse Co', 'Model X', ''),
    'mouse-senor-mouse-co-model-x'
  );
});

test('buildProductId: preserves underscores in model', () => {
  assert.equal(
    buildProductId('mouse', 'Corsair', 'M65_RGB_Ultra', ''),
    'mouse-corsair-m65_rgb_ultra'
  );
});
