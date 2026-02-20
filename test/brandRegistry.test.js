import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  loadBrandRegistry,
  saveBrandRegistry,
  addBrand,
  updateBrand,
  removeBrand,
  getBrandsForCategory,
  findBrandByAlias,
  seedBrandsFromActiveFiltering,
  seedBrandsFromWorkbook
} from '../src/catalog/brandRegistry.js';

async function tmpConfig() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'brand-reg-'));
  return { helperFilesRoot: dir, _tmpDir: dir };
}

async function cleanup(config) {
  try { await fs.rm(config._tmpDir, { recursive: true, force: true }); } catch {}
}

// --- loadBrandRegistry ---

test('loadBrandRegistry: returns empty registry when file does not exist', async () => {
  const config = await tmpConfig();
  try {
    const reg = await loadBrandRegistry(config);
    assert.equal(reg._version, 1);
    assert.deepEqual(reg.brands, {});
  } finally {
    await cleanup(config);
  }
});

test('loadBrandRegistry: reads existing registry', async () => {
  const config = await tmpConfig();
  try {
    const globalDir = path.join(config.helperFilesRoot, '_global');
    await fs.mkdir(globalDir, { recursive: true });
    await fs.writeFile(path.join(globalDir, 'brand_registry.json'), JSON.stringify({
      _version: 1,
      brands: {
        razer: { canonical_name: 'Razer', aliases: [], categories: ['mouse'], website: '', added_at: '2026-01-01T00:00:00Z', added_by: 'seed' }
      }
    }));
    const reg = await loadBrandRegistry(config);
    assert.equal(Object.keys(reg.brands).length, 1);
    assert.equal(reg.brands.razer.canonical_name, 'Razer');
  } finally {
    await cleanup(config);
  }
});

// --- addBrand ---

test('addBrand: creates a new brand with correct slug', async () => {
  const config = await tmpConfig();
  try {
    const result = await addBrand({
      config,
      name: 'Logitech',
      aliases: ['Logitech G', 'Logi'],
      categories: ['mouse', 'keyboard'],
      website: 'https://www.logitechg.com'
    });

    assert.equal(result.ok, true);
    assert.equal(result.slug, 'logitech');
    assert.equal(result.brand.canonical_name, 'Logitech');
    assert.deepEqual(result.brand.aliases, ['Logitech G', 'Logi']);
    assert.deepEqual(result.brand.categories, ['mouse', 'keyboard']);
    assert.equal(result.brand.added_by, 'gui');

    // Verify persisted
    const reg = await loadBrandRegistry(config);
    assert.equal(reg.brands.logitech.canonical_name, 'Logitech');
  } finally {
    await cleanup(config);
  }
});

test('addBrand: rejects duplicate brand', async () => {
  const config = await tmpConfig();
  try {
    await addBrand({ config, name: 'Razer', categories: ['mouse'] });
    const result = await addBrand({ config, name: 'Razer', categories: ['keyboard'] });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'brand_already_exists');
  } finally {
    await cleanup(config);
  }
});

test('addBrand: rejects empty name', async () => {
  const config = await tmpConfig();
  try {
    const result = await addBrand({ config, name: '', categories: ['mouse'] });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'brand_name_required');
  } finally {
    await cleanup(config);
  }
});

test('addBrand: handles diacritics in brand name', async () => {
  const config = await tmpConfig();
  try {
    const result = await addBrand({ config, name: 'Señor Gaming', categories: ['mouse'] });
    assert.equal(result.ok, true);
    assert.equal(result.slug, 'senor-gaming');
    assert.equal(result.brand.canonical_name, 'Señor Gaming');
  } finally {
    await cleanup(config);
  }
});

// --- updateBrand ---

test('updateBrand: patches categories and aliases', async () => {
  const config = await tmpConfig();
  try {
    await addBrand({ config, name: 'Razer', categories: ['mouse'] });
    const result = await updateBrand({
      config,
      slug: 'razer',
      patch: {
        categories: ['mouse', 'keyboard', 'headset'],
        aliases: ['Razer Inc']
      }
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.brand.categories, ['mouse', 'keyboard', 'headset']);
    assert.deepEqual(result.brand.aliases, ['Razer Inc']);
    assert.ok(result.brand.updated_at);
  } finally {
    await cleanup(config);
  }
});

test('updateBrand: returns error for non-existent brand', async () => {
  const config = await tmpConfig();
  try {
    const result = await updateBrand({ config, slug: 'nonexistent', patch: { website: 'x' } });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'brand_not_found');
  } finally {
    await cleanup(config);
  }
});

// --- removeBrand ---

test('removeBrand: removes existing brand', async () => {
  const config = await tmpConfig();
  try {
    await addBrand({ config, name: 'Razer', categories: ['mouse'] });
    const result = await removeBrand({ config, slug: 'razer' });
    assert.equal(result.ok, true);
    assert.equal(result.removed, true);

    const reg = await loadBrandRegistry(config);
    assert.equal(reg.brands.razer, undefined);
  } finally {
    await cleanup(config);
  }
});

test('removeBrand: returns error for non-existent brand', async () => {
  const config = await tmpConfig();
  try {
    const result = await removeBrand({ config, slug: 'nonexistent' });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'brand_not_found');
  } finally {
    await cleanup(config);
  }
});

test('removeBrand: warns when products reference the brand', async () => {
  const config = await tmpConfig();
  try {
    await addBrand({ config, name: 'Razer', categories: ['mouse'] });
    const cpDir = path.join(config.helperFilesRoot, 'mouse', '_control_plane');
    await fs.mkdir(cpDir, { recursive: true });
    await fs.writeFile(path.join(cpDir, 'product_catalog.json'), JSON.stringify({
      _version: 1,
      products: {
        'mouse-razer-viper-v3-pro': {
          brand: 'Razer',
          model: 'Viper V3 Pro',
          variant: ''
        }
      }
    }, null, 2), 'utf8');

    const blocked = await removeBrand({ config, slug: 'razer' });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error, 'brand_in_use');
    assert.equal(blocked.total_products, 1);

    const forced = await removeBrand({ config, slug: 'razer', force: true });
    assert.equal(forced.ok, true);
    assert.equal(forced.removed, true);
  } finally {
    await cleanup(config);
  }
});

// --- getBrandsForCategory ---

test('getBrandsForCategory: filters by category', async () => {
  const config = await tmpConfig();
  try {
    await addBrand({ config, name: 'Razer', categories: ['mouse', 'keyboard'] });
    await addBrand({ config, name: 'Logitech', categories: ['mouse'] });
    await addBrand({ config, name: 'Cherry', categories: ['keyboard'] });

    const reg = await loadBrandRegistry(config);
    const mouseBrands = getBrandsForCategory(reg, 'mouse');
    assert.equal(mouseBrands.length, 2);
    assert.deepEqual(mouseBrands.map(b => b.slug), ['logitech', 'razer']);

    const keyboardBrands = getBrandsForCategory(reg, 'keyboard');
    assert.equal(keyboardBrands.length, 2);
    assert.deepEqual(keyboardBrands.map(b => b.slug), ['cherry', 'razer']);
  } finally {
    await cleanup(config);
  }
});

// --- findBrandByAlias ---

test('findBrandByAlias: finds by canonical name', async () => {
  const config = await tmpConfig();
  try {
    await addBrand({ config, name: 'Logitech', aliases: ['Logitech G', 'Logi'] });

    const reg = await loadBrandRegistry(config);
    const found = findBrandByAlias(reg, 'Logitech');
    assert.equal(found.slug, 'logitech');
  } finally {
    await cleanup(config);
  }
});

test('findBrandByAlias: finds by alias (case-insensitive)', async () => {
  const config = await tmpConfig();
  try {
    await addBrand({ config, name: 'Logitech', aliases: ['Logitech G'] });

    const reg = await loadBrandRegistry(config);
    const found = findBrandByAlias(reg, 'logitech g');
    assert.equal(found.slug, 'logitech');
  } finally {
    await cleanup(config);
  }
});

test('findBrandByAlias: returns null for unknown brand', async () => {
  const config = await tmpConfig();
  try {
    const reg = await loadBrandRegistry(config);
    const found = findBrandByAlias(reg, 'unknown');
    assert.equal(found, null);
  } finally {
    await cleanup(config);
  }
});

// --- seedBrandsFromWorkbook ---
// Note: seedBrandsFromWorkbook calls loadWorkbookProducts internally.
// Without a real workbook, it gracefully returns empty results.

test('seedBrandsFromWorkbook: handles empty helper_files gracefully', async () => {
  const config = await tmpConfig();
  try {
    const result = await seedBrandsFromWorkbook({ config });
    assert.equal(result.ok, true);
    assert.equal(result.seeded, 0);
  } finally {
    await cleanup(config);
  }
});

test('seedBrandsFromWorkbook: scans categories without workbooks gracefully', async () => {
  const config = await tmpConfig();
  try {
    // Create category dirs without workbooks
    const mouseDir = path.join(config.helperFilesRoot, 'mouse');
    const kbDir = path.join(config.helperFilesRoot, 'keyboard');
    await fs.mkdir(path.join(mouseDir, '_control_plane'), { recursive: true });
    await fs.mkdir(path.join(kbDir, '_control_plane'), { recursive: true });

    const result = await seedBrandsFromWorkbook({ config });
    assert.equal(result.ok, true);
    assert.equal(result.seeded, 0);
    assert.equal(result.categories_scanned, 2);
  } finally {
    await cleanup(config);
  }
});

test('seedBrandsFromWorkbook: single category mode only scans that category', async () => {
  const config = await tmpConfig();
  try {
    const mouseDir = path.join(config.helperFilesRoot, 'mouse');
    const kbDir = path.join(config.helperFilesRoot, 'keyboard');
    await fs.mkdir(path.join(mouseDir, '_control_plane'), { recursive: true });
    await fs.mkdir(path.join(kbDir, '_control_plane'), { recursive: true });

    const result = await seedBrandsFromWorkbook({ config, category: 'mouse' });
    assert.equal(result.ok, true);
    assert.equal(result.categories_scanned, 1);
  } finally {
    await cleanup(config);
  }
});

test('seedBrandsFromWorkbook: category=all scans all categories', async () => {
  const config = await tmpConfig();
  try {
    const mouseDir = path.join(config.helperFilesRoot, 'mouse');
    const kbDir = path.join(config.helperFilesRoot, 'keyboard');
    await fs.mkdir(path.join(mouseDir, '_control_plane'), { recursive: true });
    await fs.mkdir(path.join(kbDir, '_control_plane'), { recursive: true });

    const result = await seedBrandsFromWorkbook({ config, category: 'all' });
    assert.equal(result.ok, true);
    assert.equal(result.categories_scanned, 2);
  } finally {
    await cleanup(config);
  }
});

// --- seedBrandsFromActiveFiltering ---

test('seedBrandsFromActiveFiltering: scans activeFiltering across categories', async () => {
  const config = await tmpConfig();
  try {
    const mouseDir = path.join(config.helperFilesRoot, 'mouse');
    const kbDir = path.join(config.helperFilesRoot, 'keyboard');
    await fs.mkdir(mouseDir, { recursive: true });
    await fs.mkdir(kbDir, { recursive: true });
    await fs.writeFile(path.join(mouseDir, 'activeFiltering.json'), JSON.stringify([
      { brand: 'Logitech', model: 'G Pro X Superlight 2', variant: '' },
      { brand: 'Razer', model: 'Viper V3 Pro', variant: '' }
    ], null, 2), 'utf8');
    await fs.writeFile(path.join(kbDir, 'activeFiltering.json'), JSON.stringify([
      { brand: 'Logitech', model: 'G915', variant: '' }
    ], null, 2), 'utf8');

    const result = await seedBrandsFromActiveFiltering({ config, category: 'all' });
    assert.equal(result.ok, true);
    assert.equal(result.seeded, 2);

    const registry = await loadBrandRegistry(config);
    assert.deepEqual(registry.brands.logitech.categories, ['keyboard', 'mouse']);
    assert.deepEqual(registry.brands.razer.categories, ['mouse']);
  } finally {
    await cleanup(config);
  }
});

test('seedBrandsFromActiveFiltering: single category mode only scans target category', async () => {
  const config = await tmpConfig();
  try {
    const mouseDir = path.join(config.helperFilesRoot, 'mouse');
    const kbDir = path.join(config.helperFilesRoot, 'keyboard');
    await fs.mkdir(mouseDir, { recursive: true });
    await fs.mkdir(kbDir, { recursive: true });
    await fs.writeFile(path.join(mouseDir, 'activeFiltering.json'), JSON.stringify([
      { brand: 'Razer', model: 'Viper V3 Pro', variant: '' }
    ], null, 2), 'utf8');
    await fs.writeFile(path.join(kbDir, 'activeFiltering.json'), JSON.stringify([
      { brand: 'Wooting', model: '80HE', variant: '' }
    ], null, 2), 'utf8');

    const result = await seedBrandsFromActiveFiltering({ config, category: 'mouse' });
    assert.equal(result.ok, true);
    assert.equal(result.seeded, 1);

    const registry = await loadBrandRegistry(config);
    assert.equal(Boolean(registry.brands.razer), true);
    assert.equal(Boolean(registry.brands.wooting), false);
  } finally {
    await cleanup(config);
  }
});
