import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const cliPath = path.resolve('src/cli/spec.js');

async function runCli(args, { cwd } = {}) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [cliPath, ...args],
    { cwd: cwd || process.cwd(), env: process.env }
  );
  return JSON.parse(stdout);
}

function baseCliArgs({ inputRoot, outputRoot, importsRoot }) {
  return [
    '--local',
    '--output-mode', 'local',
    '--local-input-root', inputRoot,
    '--local-output-root', outputRoot,
    '--imports-root', importsRoot
  ];
}

test('queue CLI supports add/list/stats/pause/retry/clear lifecycle', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-queue-cli-'));
  const inputRoot = path.join(tempRoot, 'fixtures');
  const outputRoot = path.join(tempRoot, 'out');
  const importsRoot = path.join(tempRoot, 'imports');

  try {
    const add = await runCli([
      'queue', 'add',
      '--category', 'mouse',
      '--brand', 'Logitech',
      '--model', 'G Pro X Superlight 2',
      '--variant', 'Wireless',
      '--priority', '2',
      ...baseCliArgs({ inputRoot, outputRoot, importsRoot })
    ]);
    assert.equal(add.command, 'queue');
    assert.equal(add.action, 'add');
    assert.equal(add.product.status, 'pending');
    const productId = add.product.productId;

    const list = await runCli([
      'queue', 'list',
      '--category', 'mouse',
      ...baseCliArgs({ inputRoot, outputRoot, importsRoot })
    ]);
    assert.equal(list.count, 1);
    assert.equal(list.products[0].productId, productId);

    const stats = await runCli([
      'queue', 'stats',
      '--category', 'mouse',
      ...baseCliArgs({ inputRoot, outputRoot, importsRoot })
    ]);
    assert.equal(stats.total_products, 1);
    assert.equal(stats.status.pending, 1);

    const paused = await runCli([
      'queue', 'pause',
      '--category', 'mouse',
      '--product-id', productId,
      ...baseCliArgs({ inputRoot, outputRoot, importsRoot })
    ]);
    assert.equal(paused.product.status, 'paused');

    const retried = await runCli([
      'queue', 'retry',
      '--category', 'mouse',
      '--product-id', productId,
      ...baseCliArgs({ inputRoot, outputRoot, importsRoot })
    ]);
    assert.equal(retried.product.status, 'pending');
    assert.equal(retried.product.retry_count, 0);

    const cleared = await runCli([
      'queue', 'clear',
      '--category', 'mouse',
      '--status', 'pending',
      ...baseCliArgs({ inputRoot, outputRoot, importsRoot })
    ]);
    assert.equal(cleared.removed_count, 1);

    const afterClear = await runCli([
      'queue', 'list',
      '--category', 'mouse',
      ...baseCliArgs({ inputRoot, outputRoot, importsRoot })
    ]);
    assert.equal(afterClear.count, 0);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('queue add-batch imports csv and writes queue rows', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-queue-cli-batch-'));
  const inputRoot = path.join(tempRoot, 'fixtures');
  const outputRoot = path.join(tempRoot, 'out');
  const importsRoot = path.join(tempRoot, 'imports');
  const csvPath = path.join(tempRoot, 'batch.csv');

  try {
    await fs.mkdir(tempRoot, { recursive: true });
    await fs.writeFile(
      csvPath,
      [
        'brand,model,variant,seed_urls',
        'Razer,Viper V3 Pro,Wireless,https://www.razer.com',
        'Logitech,G Pro X Superlight 2,Wireless,https://www.logitechg.com'
      ].join('\n'),
      'utf8'
    );

    const batch = await runCli([
      'queue', 'add-batch',
      '--category', 'mouse',
      '--file', csvPath,
      ...baseCliArgs({ inputRoot, outputRoot, importsRoot })
    ]);
    assert.equal(batch.command, 'queue');
    assert.equal(batch.action, 'add-batch');
    assert.equal(batch.job_count, 2);

    const list = await runCli([
      'queue', 'list',
      '--category', 'mouse',
      '--limit', '10',
      ...baseCliArgs({ inputRoot, outputRoot, importsRoot })
    ]);
    assert.equal(list.count >= 2, true);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
