import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadCategoryConfig } from '../src/categories/loader.js';

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('loadCategoryConfig prefers helper_files/_generated schema and field_rules', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-generated-loader-'));
  const helperRoot = path.join(root, 'helper_files');
  const category = 'mouse';
  try {
    await writeJson(path.join(helperRoot, category, '_generated', 'schema.json'), {
      category,
      field_order: ['connection', 'weight', 'dpi'],
      critical_fields: ['weight'],
      expected_easy_fields: ['dpi'],
      expected_sometimes_fields: [],
      deep_fields: [],
      editorial_fields: []
    });
    await writeJson(path.join(helperRoot, category, '_generated', 'required_fields.json'), [
      'fields.connection'
    ]);
    await writeJson(path.join(helperRoot, category, '_generated', 'field_rules.json'), {
      version: 1,
      schema: {
        required_fields: ['connection'],
        critical_fields: ['weight'],
        expected_easy_fields: ['dpi'],
        expected_sometimes_fields: [],
        deep_fields: []
      },
      fields: {
        connection: {
          type: 'string',
          shape: 'scalar'
        }
      }
    });

    const config = await loadCategoryConfig(category, {
      config: {
        helperFilesRoot: helperRoot
      }
    });
    assert.deepEqual(config.fieldOrder, ['connection', 'weight', 'dpi']);
    assert.equal(config.requiredFields.includes('fields.connection'), true);
    assert.equal(config.criticalFieldSet.has('weight'), true);
    assert.equal(String(config.fieldRules?.__meta?.file_path || '').includes('_generated'), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
