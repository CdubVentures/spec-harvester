import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  compileRules,
  compileRulesAll,
  discoverCompileCategories,
  initCategory,
  readCompileReport,
  rulesDiff,
  watchCompileRules
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

test('compileRulesAll discovers and compiles initialized categories', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2-compile-all-'));
  const helperRoot = path.join(root, 'helper_files');
  const categoriesRoot = path.join(root, 'categories');
  try {
    const workbookPath = mouseWorkbookPath();
    const workbookMap = buildMouseWorkbookMap(workbookPath);
    const single = await compileRules({
      category: 'mouse',
      workbookPath,
      workbookMap,
      config: { helperFilesRoot: helperRoot, categoriesRoot }
    });
    assert.equal(single.compiled, true);

    const all = await compileRulesAll({
      config: { helperFilesRoot: helperRoot, categoriesRoot }
    });
    assert.equal(all.compiled, true);
    assert.equal(all.count, 1);
    assert.equal(all.categories.includes('mouse'), true);
    assert.equal(all.results.length, 1);
    assert.equal(all.results[0].compiled, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('discoverCompileCategories discovers scaffolded categories', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2-compile-starter-'));
  const helperRoot = path.join(root, 'helper_files');
  const categoriesRoot = path.join(root, 'categories');
  try {
    await initCategory({
      category: 'monitor',
      template: 'electronics',
      config: { helperFilesRoot: helperRoot, categoriesRoot }
    });

    const discovered = await discoverCompileCategories({
      config: { helperFilesRoot: helperRoot, categoriesRoot }
    });
    assert.equal(discovered.categories.includes('monitor'), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('readCompileReport returns report and rulesDiff classifies change safety', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2-report-diff-'));
  const helperRoot = path.join(root, 'helper_files');
  const categoriesRoot = path.join(root, 'categories');
  try {
    const workbookPath = mouseWorkbookPath();
    const workbookMap = buildMouseWorkbookMap(workbookPath);
    const compiled = await compileRules({
      category: 'mouse',
      workbookPath,
      workbookMap,
      config: { helperFilesRoot: helperRoot, categoriesRoot }
    });
    assert.equal(compiled.compiled, true);

    const report = await readCompileReport({
      category: 'mouse',
      config: { helperFilesRoot: helperRoot }
    });
    assert.equal(report.exists, true);
    assert.equal(typeof report.report, 'object');
    assert.equal(typeof report.report.compiled, 'boolean');

    const diff = await rulesDiff({
      category: 'mouse',
      config: { helperFilesRoot: helperRoot, categoriesRoot }
    });
    assert.equal(typeof diff.would_change, 'boolean');
    assert.equal(Array.isArray(diff.changes), true);
    assert.equal(typeof diff.classification, 'object');
    assert.equal(
      ['safe', 'potentially_breaking', 'breaking'].includes(diff.classification.severity),
      true
    );
    assert.equal(typeof diff.classification.breaking, 'boolean');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('compileRules emits key_migrations with semver metadata and migration list', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2-key-migrations-'));
  const helperRoot = path.join(root, 'helper_files');
  const categoriesRoot = path.join(root, 'categories');
  try {
    const workbookPath = mouseWorkbookPath();
    const workbookMap = buildMouseWorkbookMap(workbookPath);
    const compiled = await compileRules({
      category: 'mouse',
      workbookPath,
      workbookMap,
      config: { helperFilesRoot: helperRoot, categoriesRoot }
    });
    assert.equal(compiled.compiled, true);

    const keyMigrationsPath = path.join(helperRoot, 'mouse', '_generated', 'key_migrations.json');
    const keyMigrations = JSON.parse(await fs.readFile(keyMigrationsPath, 'utf8'));
    assert.equal(typeof keyMigrations.version, 'string');
    assert.equal(typeof keyMigrations.previous_version, 'string');
    assert.equal(Array.isArray(keyMigrations.migrations), true);
    assert.equal(typeof keyMigrations.key_map, 'object');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('watchCompileRules runs initial compile and stops on maxEvents', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2-watch-'));
  const helperRoot = path.join(root, 'helper_files');
  const categoriesRoot = path.join(root, 'categories');
  try {
    const workbookPath = mouseWorkbookPath();
    const workbookMap = buildMouseWorkbookMap(workbookPath);
    const compiled = await compileRules({
      category: 'mouse',
      workbookPath,
      workbookMap,
      config: { helperFilesRoot: helperRoot, categoriesRoot }
    });
    assert.equal(compiled.compiled, true);

    const watch = await watchCompileRules({
      category: 'mouse',
      config: { helperFilesRoot: helperRoot, categoriesRoot },
      watchSeconds: 10,
      maxEvents: 1,
      debounceMs: 50
    });

    assert.equal(watch.category, 'mouse');
    assert.equal(watch.compile_count, 1);
    assert.equal(Array.isArray(watch.events), true);
    assert.equal(watch.events.length >= 1, true);
    assert.equal(watch.events[0].trigger, 'initial');
    assert.equal(['max_events_reached', 'watch_timeout'].includes(watch.reason), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
