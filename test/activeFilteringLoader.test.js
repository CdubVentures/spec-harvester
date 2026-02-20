import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadActiveFilteringData, discoverCategories } from '../src/catalog/activeFilteringLoader.js';

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'af-loader-'));
}

test('loadActiveFilteringData: reads local cached file', async () => {
  const dir = await tmpDir();
  try {
    const catDir = path.join(dir, 'mouse');
    await fs.mkdir(catDir, { recursive: true });
    await fs.writeFile(path.join(catDir, 'activeFiltering.json'), JSON.stringify([
      { brand: 'Razer', model: 'Viper' }
    ]));

    const data = await loadActiveFilteringData({ helperFilesRoot: dir, category: 'mouse' });
    assert.ok(Array.isArray(data));
    assert.equal(data.length, 1);
    assert.equal(data[0].brand, 'Razer');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('loadActiveFilteringData: returns null when not found locally and S3 unavailable', async () => {
  const dir = await tmpDir();
  try {
    // No local file, S3 will fail (no creds in test env or nonexistent category)
    const data = await loadActiveFilteringData({ helperFilesRoot: dir, category: 'nonexistent-test-category-xyz' });
    assert.equal(data, null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('discoverCategories: finds local dirs and merges known', async () => {
  const dir = await tmpDir();
  try {
    await fs.mkdir(path.join(dir, 'mouse'), { recursive: true });
    await fs.mkdir(path.join(dir, 'keyboard'), { recursive: true });
    await fs.mkdir(path.join(dir, '_global'), { recursive: true });

    const cats = await discoverCategories({ helperFilesRoot: dir, knownCategories: ['headset'] });
    // Should have at least keyboard, mouse, headset (plus anything from S3)
    assert.ok(cats.includes('keyboard'));
    assert.ok(cats.includes('mouse'));
    assert.ok(cats.includes('headset'));
    // _global should be excluded
    assert.ok(!cats.includes('_global'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('discoverCategories: returns known categories even if dir missing', async () => {
  const dir = path.join(os.tmpdir(), 'nonexistent-af-loader-' + Date.now());
  const cats = await discoverCategories({ helperFilesRoot: dir, knownCategories: ['mouse'] });
  assert.ok(cats.includes('mouse'));
});
