import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  evaluateIdentityGate,
  loadCanonicalIdentityIndex
} from '../src/catalog/identityGate.js';

async function makeConfig() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'identity-gate-'));
  return { helperFilesRoot: root, _tmp: root };
}

async function cleanup(config) {
  try { await fs.rm(config._tmp, { recursive: true, force: true }); } catch {}
}

async function writeCatalog(config, category, products) {
  const dir = path.join(config.helperFilesRoot, category, '_control_plane');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'product_catalog.json'),
    JSON.stringify({ _version: 1, products }, null, 2),
    'utf8'
  );
}

test('identity gate rejects fabricated variant substring', async () => {
  const config = await makeConfig();
  try {
    await writeCatalog(config, 'mouse', {
      'mouse-acer-cestus-310': { brand: 'Acer', model: 'Cestus 310', variant: '' }
    });
    const canonicalIndex = await loadCanonicalIdentityIndex({ config, category: 'mouse' });
    const gate = evaluateIdentityGate({
      category: 'mouse',
      brand: 'Acer',
      model: 'Cestus 310',
      variant: '310',
      canonicalIndex
    });
    assert.equal(gate.valid, false);
    assert.equal(gate.reason, 'variant_is_model_substring');
    assert.equal(gate.canonicalProductId, 'mouse-acer-cestus-310');
  } finally {
    await cleanup(config);
  }
});

test('identity gate rejects non-empty variant when canonical empty variant exists', async () => {
  const config = await makeConfig();
  try {
    await writeCatalog(config, 'mouse', {
      'mouse-logitech-g-pro-x-superlight-2': {
        brand: 'Logitech',
        model: 'G Pro X Superlight 2',
        variant: ''
      }
    });
    const canonicalIndex = await loadCanonicalIdentityIndex({ config, category: 'mouse' });
    const gate = evaluateIdentityGate({
      category: 'mouse',
      brand: 'Logitech',
      model: 'G Pro X Superlight 2',
      variant: 'Wireless',
      canonicalIndex
    });
    assert.equal(gate.valid, false);
    assert.equal(gate.reason, 'canonical_without_variant_exists');
    assert.equal(gate.canonicalProductId, 'mouse-logitech-g-pro-x-superlight-2');
  } finally {
    await cleanup(config);
  }
});

test('identity gate accepts legitimate variant when variant exists in canonical set', async () => {
  const config = await makeConfig();
  try {
    await writeCatalog(config, 'mouse', {
      'mouse-razer-viper-v3-pro-white': {
        brand: 'Razer',
        model: 'Viper V3 Pro',
        variant: 'White'
      }
    });
    const canonicalIndex = await loadCanonicalIdentityIndex({ config, category: 'mouse' });
    const gate = evaluateIdentityGate({
      category: 'mouse',
      brand: 'Razer',
      model: 'Viper V3 Pro',
      variant: 'White',
      canonicalIndex
    });
    assert.equal(gate.valid, true);
    assert.equal(gate.reason, null);
    assert.equal(gate.canonicalProductId, 'mouse-razer-viper-v3-pro-white');
  } finally {
    await cleanup(config);
  }
});

test('identity gate falls back to activeFiltering when product catalog is missing', async () => {
  const config = await makeConfig();
  try {
    const catDir = path.join(config.helperFilesRoot, 'mouse');
    await fs.mkdir(catDir, { recursive: true });
    await fs.writeFile(
      path.join(catDir, 'activeFiltering.json'),
      JSON.stringify([
        { brand: 'Razer', model: 'Viper V3 Pro', variant: '' }
      ], null, 2),
      'utf8'
    );

    const canonicalIndex = await loadCanonicalIdentityIndex({ config, category: 'mouse' });
    assert.equal(canonicalIndex.source, 'active_filtering');

    const validGate = evaluateIdentityGate({
      category: 'mouse',
      brand: 'Razer',
      model: 'Viper V3 Pro',
      variant: '',
      canonicalIndex
    });
    assert.equal(validGate.valid, true);

    const rejectGate = evaluateIdentityGate({
      category: 'mouse',
      brand: 'Razer',
      model: 'Viper V3 Pro',
      variant: 'Wireless',
      canonicalIndex
    });
    assert.equal(rejectGate.valid, false);
    assert.equal(rejectGate.reason, 'canonical_without_variant_exists');
  } finally {
    await cleanup(config);
  }
});
