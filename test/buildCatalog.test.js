import test from 'node:test';
import assert from 'node:assert/strict';

// ── Unit tests for catalog helper logic ─────────────────────────────
// These mirror the helpers defined in src/api/guiServer.js

const VARIANT_PLACEHOLDERS = new Set(['unk', 'unknown', 'na', 'n/a', 'none', 'null', '']);

function cleanVariant(v) {
  const s = String(v ?? '').trim();
  return VARIANT_PLACEHOLDERS.has(s.toLowerCase()) ? '' : s;
}

function normText(v) {
  return String(v ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function catalogKey(brand, model, variant) {
  return `${normText(brand)}|${normText(model)}|${normText(cleanVariant(variant))}`;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildProductIdFromParts(category, brand, model, variant) {
  return [slugify(category), slugify(brand), slugify(model), slugify(cleanVariant(variant))]
    .filter(Boolean)
    .join('-');
}

// ── cleanVariant ────────────────────────────────────────────────────
test('cleanVariant strips placeholder values', () => {
  assert.equal(cleanVariant('unk'), '');
  assert.equal(cleanVariant('unknown'), '');
  assert.equal(cleanVariant('UNK'), '');
  assert.equal(cleanVariant('UNKNOWN'), '');
  assert.equal(cleanVariant('na'), '');
  assert.equal(cleanVariant('N/A'), '');
  assert.equal(cleanVariant('none'), '');
  assert.equal(cleanVariant('null'), '');
  assert.equal(cleanVariant(''), '');
  assert.equal(cleanVariant(null), '');
  assert.equal(cleanVariant(undefined), '');
});

test('cleanVariant preserves legitimate variants', () => {
  assert.equal(cleanVariant('Wireless'), 'Wireless');
  assert.equal(cleanVariant('Wired'), 'Wired');
  assert.equal(cleanVariant('Mini'), 'Mini');
  assert.equal(cleanVariant('Pro'), 'Pro');
  assert.equal(cleanVariant('SE'), 'SE');
  assert.equal(cleanVariant('V2'), 'V2');
  assert.equal(cleanVariant('310'), '310');
});

// ── normText ────────────────────────────────────────────────────────
test('normText normalizes case, whitespace, and trim', () => {
  assert.equal(normText('Razer'), 'razer');
  assert.equal(normText('RAZER'), 'razer');
  assert.equal(normText('  Razer  '), 'razer');
  assert.equal(normText('Cestus  310'), 'cestus 310');
  assert.equal(normText(null), '');
  assert.equal(normText(undefined), '');
});

// ── catalogKey dedup ────────────────────────────────────────────────
test('catalogKey produces same key for case/whitespace variants', () => {
  const k1 = catalogKey('Razer', 'DeathAdder V2', '');
  const k2 = catalogKey('RAZER', 'deathadder  v2', 'unk');
  assert.equal(k1, k2, 'case and whitespace differences + unk variant should match');
});

test('catalogKey distinguishes different products', () => {
  const k1 = catalogKey('Razer', 'DeathAdder V2', '');
  const k2 = catalogKey('Razer', 'DeathAdder V3', '');
  assert.notEqual(k1, k2);
});

test('catalogKey distinguishes real variants', () => {
  const k1 = catalogKey('Razer', 'DeathAdder', 'Wireless');
  const k2 = catalogKey('Razer', 'DeathAdder', 'Wired');
  assert.notEqual(k1, k2, 'real variants should produce different keys');
});

// ── slugify ─────────────────────────────────────────────────────────
test('slugify produces correct slug', () => {
  assert.equal(slugify('Acer'), 'acer');
  assert.equal(slugify('Cestus 310'), 'cestus-310');
  assert.equal(slugify('DeathAdder V2'), 'deathadder-v2');
  assert.equal(slugify(''), '');
  assert.equal(slugify(null), '');
});

// ── buildProductIdFromParts ─────────────────────────────────────────
test('buildProductIdFromParts matches pipeline slug pattern', () => {
  assert.equal(
    buildProductIdFromParts('mouse', 'Acer', 'Cestus 310', ''),
    'mouse-acer-cestus-310'
  );
  assert.equal(
    buildProductIdFromParts('mouse', 'Razer', 'DeathAdder V2', 'Wireless'),
    'mouse-razer-deathadder-v2-wireless'
  );
});

test('buildProductIdFromParts strips placeholder variants', () => {
  assert.equal(
    buildProductIdFromParts('mouse', 'Acer', 'Cestus 310', 'unk'),
    'mouse-acer-cestus-310'
  );
  assert.equal(
    buildProductIdFromParts('mouse', 'Acer', 'Cestus 310', 'unknown'),
    'mouse-acer-cestus-310'
  );
});

test('buildProductIdFromParts does not double the model in id', () => {
  const id = buildProductIdFromParts('mouse', 'Acer', 'Cestus 310', '');
  // Should NOT be mouse-acer-cestus-310-310
  assert.equal(id, 'mouse-acer-cestus-310');
  assert.ok(!id.endsWith('-310-310'), 'should not duplicate trailing model segments');
});

// ── Dedup simulation ────────────────────────────────────────────────
test('dedup map merges activeFiltering + storage entries correctly', () => {
  const seen = new Map();

  // Simulate activeFiltering entry
  const afBrand = 'Acer', afModel = 'Cestus 310', afVariant = '';
  const key1 = catalogKey(afBrand, afModel, afVariant);
  seen.set(key1, {
    productId: buildProductIdFromParts('mouse', afBrand, afModel, afVariant),
    brand: afBrand,
    model: afModel,
    variant: afVariant,
    status: 'pending',
    inActive: true,
  });

  // Simulate storage entry with same product but "unk" variant
  const stBrand = 'Acer', stModel = 'Cestus 310', stVariant = 'unk';
  const key2 = catalogKey(stBrand, stModel, stVariant);

  // key1 and key2 should be the same (unk is stripped)
  assert.equal(key1, key2, 'unk variant entry should dedup with empty variant');
  assert.equal(seen.size, 1, 'only one entry after dedup');

  // The merged row should keep the activeFiltering productId
  const merged = seen.get(key1);
  assert.equal(merged.productId, 'mouse-acer-cestus-310');
  assert.equal(merged.inActive, true);
});
