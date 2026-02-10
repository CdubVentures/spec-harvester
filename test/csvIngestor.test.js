import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStorage } from '../src/s3/storage.js';
import { ingestCsvFile } from '../src/ingest/csvIngestor.js';

test('ingestCsvFile parses rows, creates product jobs, and updates queue state', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-ingest-'));
  const localInputRoot = path.join(tempRoot, 'fixtures');
  const localOutputRoot = path.join(tempRoot, 'out');
  const importsRoot = path.join(tempRoot, 'imports');
  const incomingDir = path.join(importsRoot, 'mouse', 'incoming');
  await fs.mkdir(incomingDir, { recursive: true });

  const csvPath = path.join(incomingDir, 'batch.csv');
  await fs.writeFile(
    csvPath,
    [
      'brand,model,variant,seed_urls,anchors_json,requirements_json',
      '"Logitech","G Pro X Superlight 2","Wireless","https://logitechg.com/specs","{""connection"":""wireless""}","{""targetConfidence"":0.9}"'
    ].join('\n'),
    'utf8'
  );

  const config = {
    localMode: true,
    localInputRoot,
    localOutputRoot,
    s3InputPrefix: 'specs/inputs',
    s3OutputPrefix: 'specs/outputs',
    importsRoot
  };
  const storage = createStorage(config);

  try {
    const result = await ingestCsvFile({
      storage,
      config,
      category: 'mouse',
      csvPath,
      importsRoot
    });

    assert.equal(result.skipped, false);
    assert.equal(result.job_count, 1);
    assert.equal(result.jobs[0].productId, 'mouse-logitech-g-pro-x-superlight-2-wireless');

    const job = await storage.readJson(
      'specs/inputs/mouse/products/mouse-logitech-g-pro-x-superlight-2-wireless.json'
    );
    assert.equal(job.identityLock.brand, 'Logitech');
    assert.equal(job.identityLock.model, 'G Pro X Superlight 2');
    assert.equal(job.identityLock.variant, 'Wireless');
    assert.equal(job.seedUrls.length, 1);
    assert.equal(job.anchors.connection, 'wireless');
    assert.equal(job.requirements.targetConfidence, 0.9);

    const queue = await storage.readJson('specs/outputs/_queue/mouse/state.json');
    const row = queue.products['mouse-logitech-g-pro-x-superlight-2-wireless'];
    assert.equal(row.status, 'pending');
    assert.equal(
      row.s3key,
      'specs/inputs/mouse/products/mouse-logitech-g-pro-x-superlight-2-wireless.json'
    );

    const processedDir = path.join(importsRoot, 'mouse', 'processed');
    const processedFiles = await fs.readdir(processedDir);
    assert.equal(processedFiles.length, 1);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
