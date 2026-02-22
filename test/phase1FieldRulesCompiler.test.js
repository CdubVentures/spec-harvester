import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  compileRules,
  initCategory,
  normalizeFieldRulesForPhase1,
  validateRules
} from '../src/field-rules/compiler.js';

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

function buildMouseWorkbookMapWithOverrides({
  workbookPath,
  fieldOverrides = {},
  expectations = {}
}) {
  const base = buildMouseWorkbookMap(workbookPath);
  return {
    ...base,
    expectations: {
      ...base.expectations,
      ...expectations
    },
    field_overrides: fieldOverrides
  };
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

test('compileRules writes Phase 1 generated artifacts and validateRules passes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase1-compiler-'));
  const helperRoot = path.join(root, 'helper_files');
  const categoriesRoot = path.join(root, 'categories');
  try {
    const workbookPath = mouseWorkbookPath();
    const workbookMap = buildMouseWorkbookMap(workbookPath);
    const compileResult = await compileRules({
      category: 'mouse',
      workbookPath,
      workbookMap,
      config: {
        helperFilesRoot: helperRoot,
        categoriesRoot
      }
    });
    assert.equal(compileResult.compiled, true);
    assert.equal(Array.isArray(compileResult.phase1_artifacts), true);
    assert.equal(compileResult.phase1_artifacts.length >= 8, true);

    const generatedRoot = path.join(helperRoot, 'mouse', '_generated');
    assert.equal(await exists(path.join(generatedRoot, 'field_rules.json')), true);
    assert.equal(await exists(path.join(generatedRoot, 'ui_field_catalog.json')), true);
    assert.equal(await exists(path.join(generatedRoot, 'known_values.json')), true);
    assert.equal(await exists(path.join(generatedRoot, 'parse_templates.json')), true);
    assert.equal(await exists(path.join(generatedRoot, 'cross_validation_rules.json')), true);
    assert.equal(await exists(path.join(generatedRoot, 'field_groups.json')), true);
    assert.equal(await exists(path.join(generatedRoot, 'key_migrations.json')), true);
    assert.equal(await exists(path.join(generatedRoot, 'component_db')), true);

    const validation = await validateRules({
      category: 'mouse',
      config: {
        helperFilesRoot: helperRoot,
        categoriesRoot
      }
    });
    assert.equal(validation.valid, true);
    assert.equal(validation.errors.length, 0);
    assert.equal(validation.stats.field_count > 0, true);
    assert.equal(validation.stats.schema_artifacts_validated >= 5, true);
    assert.equal(validation.schema.valid, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('compileRules dry-run reports no diff after stable compile', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase1-compiler-dry-run-'));
  const helperRoot = path.join(root, 'helper_files');
  const categoriesRoot = path.join(root, 'categories');
  try {
    const workbookPath = mouseWorkbookPath();
    const workbookMap = buildMouseWorkbookMap(workbookPath);
    const first = await compileRules({
      category: 'mouse',
      workbookPath,
      workbookMap,
      config: {
        helperFilesRoot: helperRoot,
        categoriesRoot
      }
    });
    assert.equal(first.compiled, true);

    const dryRun = await compileRules({
      category: 'mouse',
      workbookPath,
      workbookMap,
      dryRun: true,
      config: {
        helperFilesRoot: helperRoot,
        categoriesRoot
      }
    });
    assert.equal(dryRun.dry_run, true);
    assert.equal(dryRun.would_change, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('compileRules dry-run uses existing control-plane map when workbookMap is not provided', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase1-compiler-dry-run-existing-map-'));
  const helperRoot = path.join(root, 'helper_files');
  const categoriesRoot = path.join(root, 'categories');
  try {
    const workbookPath = mouseWorkbookPath();
    const workbookMap = buildMouseWorkbookMap(workbookPath);
    const first = await compileRules({
      category: 'mouse',
      workbookPath,
      workbookMap,
      config: {
        helperFilesRoot: helperRoot,
        categoriesRoot
      }
    });
    assert.equal(first.compiled, true);

    const dryRun = await compileRules({
      category: 'mouse',
      dryRun: true,
      config: {
        helperFilesRoot: helperRoot,
        categoriesRoot
      }
    });
    assert.equal(dryRun.dry_run, true);
    assert.equal(dryRun.would_change, false);
    assert.equal(
      (dryRun.warnings || []).some((row) => String(row).includes('selected_keys: empty')),
      false
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('compileRules enforces critical and identity buckets from expectations and canonical identity keys', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase1-compiler-buckets-'));
  const helperRoot = path.join(root, 'helper_files');
  const categoriesRoot = path.join(root, 'categories');
  try {
    const workbookPath = mouseWorkbookPath();
    const workbookMap = buildMouseWorkbookMapWithOverrides({
      workbookPath,
      fieldOverrides: {
        polling_rate: {
          required_level: 'expected',
          priority: {
            required_level: 'expected'
          }
        },
        sku: {
          required_level: 'expected',
          priority: {
            required_level: 'expected'
          }
        }
      },
      expectations: {
        critical_fields: ['polling_rate']
      }
    });
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

    const generatedRoot = path.join(helperRoot, 'mouse', '_generated');
    const fieldRules = JSON.parse(await fs.readFile(path.join(generatedRoot, 'field_rules.json'), 'utf8'));
    const compileReport = JSON.parse(await fs.readFile(path.join(generatedRoot, '_compile_report.json'), 'utf8'));

    assert.equal(fieldRules.fields.polling_rate.required_level, 'critical');
    assert.equal(fieldRules.fields.polling_rate.priority.required_level, 'critical');
    assert.equal(fieldRules.fields.sku.required_level, 'identity');
    assert.equal(fieldRules.fields.sku.priority.required_level, 'identity');
    assert.equal(Number(compileReport.counts.critical) >= 1, true);
    assert.equal(Number(compileReport.counts.identity) >= 1, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('validateRules reports missing required artifacts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase1-compiler-missing-'));
  const helperRoot = path.join(root, 'helper_files');
  const categoriesRoot = path.join(root, 'categories');
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

    const generatedRoot = path.join(helperRoot, 'mouse', '_generated');
    await fs.rm(path.join(generatedRoot, 'parse_templates.json'), { force: true });

    const validation = await validateRules({
      category: 'mouse',
      config: {
        helperFilesRoot: helperRoot,
        categoriesRoot
      }
    });
    assert.equal(validation.valid, false);
    assert.equal(
      validation.errors.some((row) => String(row).includes('parse_templates.json')),
      true
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('validateRules fails when artifact violates shared JSON schema', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase1-compiler-schema-invalid-'));
  const helperRoot = path.join(root, 'helper_files');
  const categoriesRoot = path.join(root, 'categories');
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

    const generatedRoot = path.join(helperRoot, 'mouse', '_generated');
    await fs.writeFile(
      path.join(generatedRoot, 'parse_templates.json'),
      `${JSON.stringify({ category: 'mouse', templates: 'invalid-type' }, null, 2)}\n`,
      'utf8'
    );

    const validation = await validateRules({
      category: 'mouse',
      config: {
        helperFilesRoot: helperRoot,
        categoriesRoot
      }
    });
    assert.equal(validation.valid, false);
    assert.equal(validation.schema.valid, false);
    assert.equal(
      validation.errors.some((row) => String(row).includes('schema validation failed: parse_templates.json')),
      true
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('validateRules reports missing required per-field metadata', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase1-compiler-metadata-invalid-'));
  const helperRoot = path.join(root, 'helper_files');
  const categoriesRoot = path.join(root, 'categories');
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

    const generatedRoot = path.join(helperRoot, 'mouse', '_generated');
    const fieldRulesPath = path.join(generatedRoot, 'field_rules.json');
    const fieldRules = JSON.parse(await fs.readFile(fieldRulesPath, 'utf8'));
    fieldRules.fields.connection.required_level = '';
    fieldRules.fields.connection.priority.required_level = '';
    await fs.writeFile(fieldRulesPath, `${JSON.stringify(fieldRules, null, 2)}\n`, 'utf8');

    const validation = await validateRules({
      category: 'mouse',
      config: {
        helperFilesRoot: helperRoot,
        categoriesRoot
      }
    });
    assert.equal(validation.valid, false);
    assert.equal(validation.stats.fields_with_incomplete_metadata > 0, true);
    assert.equal(
      validation.errors.some((row) => String(row).includes("metadata validation failed: field 'connection'")),
      true
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('initCategory creates category scaffolding in helper_files and categories roots', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase1-init-category-'));
  const helperRoot = path.join(root, 'helper_files');
  const categoriesRoot = path.join(root, 'categories');
  try {
    const initResult = await initCategory({
      category: 'monitor',
      template: 'electronics',
      config: {
        helperFilesRoot: helperRoot,
        categoriesRoot
      }
    });
    assert.equal(initResult.created, true);
    assert.equal(await exists(path.join(helperRoot, 'monitor', '_source')), true);
    assert.equal(await exists(path.join(helperRoot, 'monitor', '_generated')), true);
    assert.equal(await exists(path.join(helperRoot, 'monitor', '_suggestions')), true);
    assert.equal(await exists(path.join(helperRoot, 'monitor', '_overrides')), true);
    assert.equal(await exists(path.join(categoriesRoot, 'monitor', 'schema.json')), true);
    assert.equal(await exists(path.join(categoriesRoot, 'monitor', 'sources.json')), true);
    assert.equal(await exists(path.join(categoriesRoot, 'monitor', 'required_fields.json')), true);
    assert.equal(await exists(path.join(categoriesRoot, 'monitor', 'search_templates.json')), true);
    assert.equal(await exists(path.join(categoriesRoot, 'monitor', 'anchors.json')), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('normalizeFieldRulesForPhase1 backfills required schema blocks for sparse fields', () => {
  const normalized = normalizeFieldRulesForPhase1({
    category: 'mouse',
    fields: {
      switches_link: {
        data_type: 'string',
        output_shape: 'scalar',
        required_level: 'optional',
        availability: 'sometimes',
        difficulty: 'medium',
        effort: 5,
        evidence_required: false
      }
    }
  });

  const row = normalized?.fields?.switches_link || {};
  assert.equal(typeof row.contract, 'object');
  assert.equal(row.contract.type, 'string');
  assert.equal(row.contract.shape, 'scalar');
  assert.equal(typeof row.priority, 'object');
  assert.equal(row.priority.required_level, 'optional');
  assert.equal(typeof row.parse, 'object');
  assert.equal(typeof row.evidence, 'object');
  assert.equal(row.evidence.required, false);
});
