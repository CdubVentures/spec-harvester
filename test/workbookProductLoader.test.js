import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  loadWorkbookProducts,
  loadWorkbookProductsWithFields,
  discoverCategoriesLocal
} from '../src/catalog/workbookProductLoader.js';

async function tmpDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'wb-loader-'));
}

async function cleanup(dir) {
  try { await fs.rm(dir, { recursive: true, force: true }); } catch {}
}

// --- discoverCategoriesLocal ---

test('discoverCategoriesLocal: lists category directories', async () => {
  const root = await tmpDir();
  try {
    await fs.mkdir(path.join(root, 'mouse'));
    await fs.mkdir(path.join(root, 'keyboard'));
    await fs.mkdir(path.join(root, 'headset'));
    // _ prefixed dirs should be excluded
    await fs.mkdir(path.join(root, '_global'));
    await fs.mkdir(path.join(root, '_generated'));

    const cats = await discoverCategoriesLocal({ helperFilesRoot: root });
    assert.deepEqual(cats, ['headset', 'keyboard', 'mouse']);
  } finally {
    await cleanup(root);
  }
});

test('discoverCategoriesLocal: returns empty for missing root', async () => {
  const cats = await discoverCategoriesLocal({ helperFilesRoot: '/nonexistent/path' });
  assert.deepEqual(cats, []);
});

test('discoverCategoriesLocal: returns empty for empty directory', async () => {
  const root = await tmpDir();
  try {
    const cats = await discoverCategoriesLocal({ helperFilesRoot: root });
    assert.deepEqual(cats, []);
  } finally {
    await cleanup(root);
  }
});

test('discoverCategoriesLocal: excludes files (only directories)', async () => {
  const root = await tmpDir();
  try {
    await fs.mkdir(path.join(root, 'mouse'));
    await fs.writeFile(path.join(root, 'config.json'), '{}');

    const cats = await discoverCategoriesLocal({ helperFilesRoot: root });
    assert.deepEqual(cats, ['mouse']);
  } finally {
    await cleanup(root);
  }
});

// --- loadWorkbookProducts ---

test('loadWorkbookProducts: returns empty for missing category', async () => {
  const products = await loadWorkbookProducts({ category: '', config: {} });
  assert.deepEqual(products, []);
});

test('loadWorkbookProducts: returns empty when no workbook configured', async () => {
  const root = await tmpDir();
  try {
    await fs.mkdir(path.join(root, 'mouse', '_control_plane'), { recursive: true });
    const products = await loadWorkbookProducts({ category: 'mouse', config: { helperFilesRoot: root } });
    assert.deepEqual(products, []);
  } finally {
    await cleanup(root);
  }
});

// --- loadWorkbookProductsWithFields ---

test('loadWorkbookProductsWithFields: returns empty for missing category', async () => {
  const products = await loadWorkbookProductsWithFields({ category: '', config: {} });
  assert.deepEqual(products, []);
});

test('loadWorkbookProductsWithFields: returns empty when no workbook configured', async () => {
  const root = await tmpDir();
  try {
    await fs.mkdir(path.join(root, 'mouse', '_control_plane'), { recursive: true });
    const products = await loadWorkbookProductsWithFields({ category: 'mouse', config: { helperFilesRoot: root } });
    assert.deepEqual(products, []);
  } finally {
    await cleanup(root);
  }
});
