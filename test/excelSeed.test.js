import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildFieldOrderFromExcelSeed, loadCategoryFieldRules } from '../src/ingest/excelSeed.js';

test('buildFieldOrderFromExcelSeed keeps Excel fields and appends include_fields extras', () => {
  const fieldOrder = buildFieldOrderFromExcelSeed({
    fieldRows: [
      { row: 3, field: 'brand' },
      { row: 4, field: 'model' },
      { row: 10, field: 'connection' },
      { row: 20, field: 'weight' }
    ],
    fieldRules: {
      schema: {
        include_fields: ['edition'],
        exclude_fields: ['id', 'brand', 'model', 'base_model', 'category', 'sku']
      }
    },
    existingFieldOrder: ['connection', 'weight']
  });

  assert.deepEqual(fieldOrder, ['connection', 'weight', 'edition']);
});

test('buildFieldOrderFromExcelSeed preserves non-identity existing fields by default', () => {
  const fieldOrder = buildFieldOrderFromExcelSeed({
    fieldRows: [
      { row: 10, field: 'connection' },
      { row: 20, field: 'weight' }
    ],
    fieldRules: {
      schema: {
        exclude_fields: ['id', 'brand', 'model', 'base_model', 'category', 'sku']
      }
    },
    existingFieldOrder: ['connection', 'weight', 'edition', 'brand']
  });

  assert.deepEqual(fieldOrder, ['connection', 'weight', 'edition']);
});

test('buildFieldOrderFromExcelSeed can disable existing-field preservation', () => {
  const fieldOrder = buildFieldOrderFromExcelSeed({
    fieldRows: [
      { row: 10, field: 'connection' },
      { row: 20, field: 'weight' }
    ],
    fieldRules: {
      schema: {
        preserve_existing_fields: false,
        exclude_fields: ['id', 'brand', 'model', 'base_model', 'category', 'sku']
      }
    },
    existingFieldOrder: ['connection', 'weight', 'edition']
  });

  assert.deepEqual(fieldOrder, ['connection', 'weight']);
});

test('loadCategoryFieldRules prefers helper_files category path over categories fallback', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-field-rules-'));
  const category = 'test_category_xyz';
  const helperCategoryDir = path.join(tempRoot, category);
  await fs.mkdir(helperCategoryDir, { recursive: true });
  await fs.writeFile(
    path.join(helperCategoryDir, 'field_rules.json'),
    JSON.stringify({
      version: 1,
      schema: {
        include_fields: ['edition']
      }
    }, null, 2),
    'utf8'
  );

  try {
    const loaded = await loadCategoryFieldRules(category, {
      helperFilesRoot: tempRoot
    });
    assert.equal(Boolean(loaded), true);
    assert.equal(
      String(loaded.file_path || '').replace(/\\/g, '/').endsWith(`/field_rules.json`),
      true
    );
    assert.deepEqual(loaded.value?.schema?.include_fields, ['edition']);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
