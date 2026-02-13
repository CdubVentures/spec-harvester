import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compileRules } from '../src/field-rules/compiler.js';
import { generateTypesForCategory } from '../src/build/generate-types.js';

function mouseWorkbookPath() {
  return path.resolve('helper_files', 'mouse', 'mouseData.xlsm');
}

function buildMouseWorkbookMap(workbookPath) {
  return {
    version: 1,
    workbook_path: workbookPath,
    sheet_roles: [
      { sheet: 'dataEntry', role: 'product_table' },
      { sheet: 'dataEntry', role: 'field_key_list' }
    ],
    key_list: {
      sheet: 'dataEntry',
      source: 'column_range',
      column: 'B',
      row_start: 9,
      row_end: 83
    },
    product_table: {
      sheet: 'dataEntry',
      layout: 'matrix',
      brand_row: 3,
      model_row: 4,
      variant_row: 5,
      value_col_start: 'C',
      value_col_end: '',
      sample_columns: 18
    },
    expectations: {
      required_fields: ['connection', 'weight', 'dpi'],
      critical_fields: ['polling_rate'],
      expected_easy_fields: ['side_buttons'],
      expected_sometimes_fields: ['sensor'],
      deep_fields: ['release_date']
    },
    enum_lists: [],
    component_sheets: [],
    field_overrides: {}
  };
}

test('generateTypesForCategory writes Zod and TS artifacts from field rules', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2-generate-types-'));
  const helperRoot = path.join(root, 'helper_files');
  const categoriesRoot = path.join(root, 'categories');
  const outDir = path.join(root, 'src', 'generated');
  try {
    const workbookPath = mouseWorkbookPath();
    const workbookMap = buildMouseWorkbookMap(workbookPath);
    const compiled = await compileRules({
      category: 'mouse',
      workbookPath,
      workbookMap,
      config: {
        helperFilesRoot: helperRoot,
        categoriesRoot
      }
    });
    assert.equal(compiled.compiled, true);

    const generated = await generateTypesForCategory({
      category: 'mouse',
      outDir,
      config: {
        helperFilesRoot: helperRoot
      }
    });
    assert.equal(generated.generated, true);
    assert.equal(generated.field_count > 0, true);

    const schemaCode = await fs.readFile(generated.schema_file, 'utf8');
    const typesCode = await fs.readFile(generated.types_file, 'utf8');
    assert.equal(schemaCode.includes("import { z } from 'zod';"), true);
    assert.equal(schemaCode.includes('MouseSpecSchema'), true);
    assert.equal(schemaCode.includes('"connection":'), true);
    assert.equal(typesCode.includes('export type MouseSpec = z.infer<typeof MouseSpecSchema>;'), true);
    assert.equal(typesCode.includes('export type MouseFieldKey ='), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
