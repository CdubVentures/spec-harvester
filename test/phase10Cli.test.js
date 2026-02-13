import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const cliPath = path.resolve('src/cli/spec.js');

async function runCli(args, { env = {} } = {}) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [cliPath, ...args],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...env
      }
    }
  );
  return JSON.parse(stdout);
}

function localArgs({ inputRoot, outputRoot, importsRoot }) {
  return [
    '--local',
    '--output-mode', 'local',
    '--local-input-root', inputRoot,
    '--local-output-root', outputRoot,
    '--imports-root', importsRoot
  ];
}

async function ensureFile(filePath, content = '') {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, String(content), 'utf8');
}

test('phase10 bootstrap/harness/report CLI commands execute with expected outputs', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-phase10-cli-'));
  const inputRoot = path.join(tempRoot, 'fixtures');
  const outputRoot = path.join(tempRoot, 'out');
  const importsRoot = path.join(tempRoot, 'imports');
  const helperRoot = path.join(tempRoot, 'helper_files');
  const categoriesRoot = path.join(tempRoot, 'categories');
  const goldenRoot = path.join(tempRoot, 'fixtures', 'golden');
  const complianceRoot = path.join(tempRoot, 'compliance_repo');

  try {
    const bootstrap = await runCli([
      'phase10-bootstrap',
      '--categories', 'monitor,keyboard',
      '--helper-root', helperRoot,
      '--categories-root', categoriesRoot,
      '--golden-root', goldenRoot,
      ...localArgs({ inputRoot, outputRoot, importsRoot })
    ]);
    assert.equal(bootstrap.command, 'phase10-bootstrap');
    assert.equal(bootstrap.categories_count, 2);
    assert.equal(Array.isArray(bootstrap.rows), true);

    const harness = await runCli([
      'hardening-harness',
      '--category', 'monitor',
      '--products', '25',
      '--cycles', '10',
      '--fuzz-iterations', '60',
      '--seed', '17',
      '--failure-attempts', '2',
      ...localArgs({ inputRoot, outputRoot, importsRoot })
    ]);
    assert.equal(harness.command, 'hardening-harness');
    assert.equal(harness.passed, true);
    assert.equal(harness.queue_load.select_cycles_completed > 0, true);
    assert.equal(harness.failure_injection.passed, true);
    assert.equal(harness.fuzz_source_health.passed, true);

    await ensureFile(path.join(complianceRoot, 'README.md'), '# hardening report\n');
    await ensureFile(path.join(complianceRoot, '.gitignore'), '.env\nnode_modules/\n');
    await ensureFile(
      path.join(complianceRoot, 'package.json'),
      JSON.stringify({
        name: 'compliance-pass',
        version: '1.0.0',
        engines: { node: '>=20' },
        dependencies: { example: '1.2.3' },
        scripts: { test: 'node --test' }
      }, null, 2)
    );
    await ensureFile(path.join(complianceRoot, 'package-lock.json'), '{}\n');
    await ensureFile(path.join(complianceRoot, 'docs', 'ARCHITECTURE.md'), '# a\n');
    await ensureFile(path.join(complianceRoot, 'docs', 'NEW-CATEGORY-GUIDE.md'), '# a\n');
    await ensureFile(path.join(complianceRoot, 'docs', 'RUNBOOK.md'), '# a\n');
    await ensureFile(path.join(complianceRoot, 'docs', 'API-REFERENCE.md'), '# a\n');

    const report = await runCli([
      'hardening-report',
      '--root-dir', complianceRoot,
      ...localArgs({ inputRoot, outputRoot, importsRoot })
    ]);
    assert.equal(report.command, 'hardening-report');
    assert.equal(report.passed, true);
    assert.equal(report.docs_missing_count, 0);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
