import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compileRules } from '../src/field-rules/compiler.js';
import {
  buildAccuracyReport,
  createGoldenFixture,
  createGoldenFromExcel,
  renderAccuracyReportMarkdown,
  validateGoldenFixtures
} from '../src/testing/goldenFiles.js';

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

function makeStorage({ category, productId, fields }) {
  const latestBase = `specs/outputs/${category}/${productId}/latest`;
  const map = new Map([
    [`${latestBase}/normalized.json`, Buffer.from(JSON.stringify({ fields }), 'utf8')],
    [`${latestBase}/summary.json`, Buffer.from(JSON.stringify({ validated: true, confidence: 0.95 }), 'utf8')]
  ]);
  return {
    resolveOutputKey(...parts) {
      return ['specs/outputs', ...parts].join('/');
    },
    async readJsonOrNull(key) {
      const raw = map.get(key);
      return raw ? JSON.parse(raw.toString('utf8')) : null;
    }
  };
}

test('createGoldenFixture writes expected fixture and manifest rows', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2-golden-create-'));
  const goldenRoot = path.join(root, 'fixtures', 'golden');
  try {
    const created = await createGoldenFixture({
      category: 'mouse',
      productId: 'mouse-acme-m100',
      identity: {
        brand: 'Acme',
        model: 'M100',
        variant: 'Wireless'
      },
      fields: {
        weight: 54,
        connection: 'wireless'
      },
      expectedUnknowns: {
        shift_latency: 'not_publicly_disclosed'
      },
      config: {
        goldenRoot
      }
    });

    assert.equal(created.created, true);
    assert.equal(typeof created.expected_path, 'string');
    const manifestPath = path.join(goldenRoot, 'mouse', 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    assert.equal(Array.isArray(manifest.cases), true);
    assert.equal(manifest.cases.length, 1);
    assert.equal(manifest.cases[0].product_id, 'mouse-acme-m100');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('createGoldenFromExcel creates a bounded batch and validateGoldenFixtures passes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2-golden-excel-'));
  const helperRoot = path.join(root, 'helper_files');
  const categoriesRoot = path.join(root, 'categories');
  const goldenRoot = path.join(root, 'fixtures', 'golden');
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

    const created = await createGoldenFromExcel({
      category: 'mouse',
      count: 3,
      config: {
        helperFilesRoot: helperRoot,
        goldenRoot
      }
    });
    assert.equal(created.created_count, 3);
    assert.equal(created.case_count, 3);

    const validation = await validateGoldenFixtures({
      category: 'mouse',
      config: {
        helperFilesRoot: helperRoot,
        goldenRoot
      }
    });
    assert.equal(validation.valid, true);
    assert.equal(validation.case_count, 3);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('buildAccuracyReport computes field-level metrics and markdown rendering', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2-golden-accuracy-'));
  const goldenRoot = path.join(root, 'fixtures', 'golden');
  try {
    await createGoldenFixture({
      category: 'mouse',
      productId: 'mouse-acme-m100',
      identity: {
        brand: 'Acme',
        model: 'M100'
      },
      fields: {
        weight: 54,
        connection: 'wireless',
        sensor: 'PixArt 3395'
      },
      config: {
        goldenRoot
      }
    });

    const storage = makeStorage({
      category: 'mouse',
      productId: 'mouse-acme-m100',
      fields: {
        weight: 54,
        connection: 'wired',
        sensor: 'PixArt 3395'
      }
    });
    const report = await buildAccuracyReport({
      category: 'mouse',
      storage,
      config: { goldenRoot }
    });
    assert.equal(report.products_tested, 1);
    assert.equal(report.by_field.weight.correct, 1);
    assert.equal(report.by_field.connection.incorrect, 1);
    assert.equal(report.by_field.sensor.correct, 1);
    assert.equal(report.overall_accuracy < 1, true);

    const md = renderAccuracyReportMarkdown(report);
    assert.equal(typeof md, 'string');
    assert.equal(md.includes('# Accuracy Report: mouse'), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
