import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runAppDiagnostics } from '../src/diagnostics/appDiagnostics.js';

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('runAppDiagnostics reports helper/runtime schema mirror redundancy', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-diagnostic-'));
  const helperRoot = path.join(rootDir, 'helper_files', 'mouse');
  const runtimeRoot = path.join(rootDir, 'categories', 'mouse');
  try {
    await writeJson(path.join(helperRoot, 'schema.json'), {
      category: 'mouse',
      field_order: ['connection', 'weight']
    });
    await writeJson(path.join(runtimeRoot, 'schema.json'), {
      category: 'mouse',
      field_order: ['connection', 'weight']
    });
    await writeJson(path.join(helperRoot, 'field_rules.json'), {
      version: 1,
      fields: {}
    });

    const report = await runAppDiagnostics({
      config: {
        helperFilesRoot: 'helper_files'
      },
      rootDir
    });
    assert.deepEqual(report.selected_categories, ['mouse']);
    assert.equal(report.category_reports.length, 1);
    assert.equal(report.category_reports[0].redundancy.schema_mirror_redundant, true);
    assert.equal(
      report.category_reports[0].runtime_config_strategy.required_fields_file_optional,
      true
    );
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test('runAppDiagnostics prune removes safe temporary folders', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-diagnostic-prune-'));
  try {
    const tempDir = path.join(rootDir, '.specfactory_tmp');
    const pycacheDir = path.join(rootDir, 'tools', 'gui', '__pycache__');
    await fs.mkdir(tempDir, { recursive: true });
    await fs.mkdir(pycacheDir, { recursive: true });
    await fs.writeFile(path.join(tempDir, 'tmp.txt'), 'x', 'utf8');
    await fs.writeFile(path.join(pycacheDir, 'app.pyc'), 'x', 'utf8');

    const report = await runAppDiagnostics({
      config: {
        helperFilesRoot: 'helper_files'
      },
      rootDir,
      prune: true
    });

    assert.equal(report.prune.removed.includes('.specfactory_tmp'), true);
    assert.equal(report.prune.removed.includes('tools/gui/__pycache__'), true);
    assert.equal(report.prune.errors.length, 0);
    assert.equal(await fs.stat(tempDir).then(() => true).catch(() => false), false);
    assert.equal(await fs.stat(pycacheDir).then(() => true).catch(() => false), false);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});
