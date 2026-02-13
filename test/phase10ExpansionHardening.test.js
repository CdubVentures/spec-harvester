import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStorage } from '../src/s3/storage.js';
import {
  bootstrapExpansionCategories,
  runFailureInjectionHarness,
  runFuzzSourceHealthHarness,
  runProductionHardeningReport,
  runQueueLoadHarness
} from '../src/phase10/expansionHardening.js';

function makeStorage(tempRoot) {
  return createStorage({
    localMode: true,
    localInputRoot: path.join(tempRoot, 'fixtures'),
    localOutputRoot: path.join(tempRoot, 'out'),
    s3InputPrefix: 'specs/inputs',
    s3OutputPrefix: 'specs/outputs'
  });
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

test('bootstrapExpansionCategories initializes monitor and keyboard scaffolding with golden manifests', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-phase10-bootstrap-'));
  try {
    const helperRoot = path.join(tempRoot, 'helper_files');
    const categoriesRoot = path.join(tempRoot, 'categories');
    const goldenRoot = path.join(tempRoot, 'fixtures', 'golden');

    const result = await bootstrapExpansionCategories({
      config: {
        helperFilesRoot: helperRoot,
        categoriesRoot
      },
      categories: ['monitor', 'keyboard'],
      template: 'electronics',
      goldenRoot
    });

    assert.equal(result.categories_count, 2);
    assert.equal(result.categories.includes('monitor'), true);
    assert.equal(result.categories.includes('keyboard'), true);

    assert.equal(await exists(path.join(helperRoot, 'monitor', '_source', 'field_catalog.xlsx')), true);
    assert.equal(await exists(path.join(helperRoot, 'keyboard', '_source', 'field_catalog.xlsx')), true);
    assert.equal(await exists(path.join(categoriesRoot, 'monitor', 'schema.json')), true);
    assert.equal(await exists(path.join(categoriesRoot, 'keyboard', 'schema.json')), true);
    assert.equal(await exists(path.join(goldenRoot, 'monitor', 'manifest.json')), true);
    assert.equal(await exists(path.join(goldenRoot, 'keyboard', 'manifest.json')), true);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('queue load, failure injection, and fuzz source-health harnesses execute successfully', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-phase10-harness-'));
  const storage = makeStorage(tempRoot);
  try {
    const load = await runQueueLoadHarness({
      storage,
      category: 'monitor',
      productCount: 30,
      selectCycles: 12
    });
    assert.equal(load.category, 'monitor');
    assert.equal(load.select_cycles_completed > 0, true);

    const failure = await runFailureInjectionHarness({
      storage,
      category: 'monitor',
      maxAttempts: 2
    });
    assert.equal(failure.final_status, 'failed');
    assert.equal(failure.passed, true);

    const fuzz = await runFuzzSourceHealthHarness({
      storage,
      category: 'monitor',
      iterations: 80,
      seed: 42
    });
    assert.equal(fuzz.passed, true);
    assert.equal(fuzz.malformed_count > 0, true);
    assert.equal(fuzz.parsed_sources >= 1, true);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('runProductionHardeningReport flags missing docs and insecure gitignore settings', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-phase10-report-'));
  try {
    await fs.writeFile(
      path.join(tempRoot, 'package.json'),
      JSON.stringify({
        name: 'hardening-test',
        version: '1.0.0',
        dependencies: {
          example: '^1.2.3'
        },
        scripts: {
          test: 'node --test'
        }
      }, null, 2),
      'utf8'
    );
    await fs.writeFile(path.join(tempRoot, '.gitignore'), 'node_modules/\n', 'utf8');
    await fs.mkdir(path.join(tempRoot, 'docs'), { recursive: true });
    await fs.writeFile(path.join(tempRoot, 'README.md'), '# test\n', 'utf8');

    const report = await runProductionHardeningReport({
      rootDir: tempRoot
    });

    assert.equal(report.non_exact_dependency_count, 1);
    assert.equal(report.docs_missing_count >= 1, true);
    assert.equal(
      report.issues.some((row) => row.code === 'gitignore_missing_env'),
      true
    );
    assert.equal(report.passed, false);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
