import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStorage } from '../src/s3/storage.js';
import {
  applySupportiveFillToResult,
  buildSupportiveSyntheticSources,
  loadHelperCategoryData,
  resolveHelperProductContext,
  syncJobsFromActiveFiltering
} from '../src/helperFiles/index.js';

function mouseCategoryConfig() {
  return {
    category: 'mouse',
    fieldOrder: [
      'id',
      'brand',
      'model',
      'base_model',
      'category',
      'sku',
      'connection',
      'weight',
      'polling_rate',
      'dpi',
      'switches_link'
    ],
    criticalFieldSet: new Set(['connection', 'weight', 'polling_rate', 'dpi'])
  };
}

test('helper files load and provide active helper evidence/fill for matched product', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-helper-load-'));
  const helperRoot = path.join(tempRoot, 'helper_files');
  const categoryDir = path.join(helperRoot, 'mouse');
  await fs.mkdir(categoryDir, { recursive: true });

  await fs.writeFile(
    path.join(categoryDir, 'activeFiltering.json'),
    JSON.stringify([
      {
        brand: 'Logitech',
        model: 'G Pro X Superlight 2',
        variant: 'Wireless',
        url: 'https://www.logitechg.com/specs',
        connection: 'wireless',
        weight: '60 g',
        polling_rate: '4000',
        dpi: '32000',
        switch_link: 'https://www.logitechg.com/switches'
      }
    ], null, 2),
    'utf8'
  );

  try {
    const config = {
      helperFilesEnabled: true,
      helperFilesRoot: helperRoot
    };
    const categoryConfig = mouseCategoryConfig();

    const loaded = await loadHelperCategoryData({
      config,
      category: 'mouse',
      categoryConfig,
      forceRefresh: true
    });
    assert.equal(loaded.active.length, 1);
    assert.equal(loaded.supportive.length, 0);
    assert.equal(loaded.supportive_files.length, 0);

    const job = {
      productId: 'mouse-logitech-g-pro-x-superlight-2-wireless',
      category: 'mouse',
      identityLock: {
        brand: 'Logitech',
        model: 'G Pro X Superlight 2',
        variant: 'Wireless'
      }
    };
    const context = resolveHelperProductContext({
      helperData: loaded,
      job
    });
    assert.equal(Boolean(context.active_match), true);
    assert.equal(context.seed_urls.includes('https://www.logitechg.com/specs'), true);
    assert.equal(context.supportive_matches.length, 0);

    const synthetic = buildSupportiveSyntheticSources({
      helperContext: context,
      job,
      categoryConfig,
      anchors: {},
      maxSources: 4
    });
    assert.equal(synthetic.length >= 1, true);
    assert.equal(synthetic[0].url.startsWith('helper_files://mouse/'), true);
    assert.equal(
      synthetic.some((row) => row.fieldCandidates.some((candidate) => candidate.field === 'weight')),
      true
    );

    const normalized = {
      category: 'mouse',
      fields: {
        id: job.productId,
        brand: 'Logitech',
        model: 'G Pro X Superlight 2',
        base_model: 'G Pro X Superlight 2',
        category: 'mouse',
        sku: 'unk',
        connection: 'unk',
        weight: 'unk',
        polling_rate: 'unk',
        dpi: 'unk',
        switches_link: 'unk'
      }
    };
    const provenance = {};
    const fill = applySupportiveFillToResult({
      helperContext: context,
      normalized,
      provenance,
      fieldsBelowPassTarget: ['connection', 'weight', 'polling_rate', 'dpi'],
      criticalFieldsBelowPassTarget: ['connection', 'weight', 'polling_rate', 'dpi'],
      categoryConfig
    });

    assert.equal(fill.filled_fields.includes('weight'), true);
    assert.equal(normalized.fields.weight !== 'unk', true);
    assert.equal((provenance.weight?.evidence || []).length > 0, true);
    assert.equal(fill.fields_below_pass_target.includes('weight'), false);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('syncJobsFromActiveFiltering creates jobs and queue records once', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-helper-sync-'));
  const helperRoot = path.join(tempRoot, 'helper_files');
  const categoryDir = path.join(helperRoot, 'mouse');
  await fs.mkdir(categoryDir, { recursive: true });

  await fs.writeFile(
    path.join(categoryDir, 'activeFiltering.json'),
    JSON.stringify([
      {
        brand: 'Logitech',
        model: 'G Pro X Superlight 2',
        variant: 'Wireless',
        url: 'https://www.logitechg.com/specs'
      },
      {
        brand: 'Razer',
        model: 'Viper V3 Pro',
        variant: 'Wireless',
        url: 'https://www.razer.com/specs'
      }
    ], null, 2),
    'utf8'
  );

  const localInputRoot = path.join(tempRoot, 'fixtures');
  const localOutputRoot = path.join(tempRoot, 'out');
  const config = {
    localMode: true,
    localInputRoot,
    localOutputRoot,
    s3InputPrefix: 'specs/inputs',
    s3OutputPrefix: 'specs/outputs',
    helperFilesEnabled: true,
    helperAutoSeedTargets: true,
    helperFilesRoot: helperRoot,
    helperActiveSyncLimit: 0
  };
  const storage = createStorage(config);
  const categoryConfig = mouseCategoryConfig();

  try {
    const first = await syncJobsFromActiveFiltering({
      storage,
      config,
      category: 'mouse',
      categoryConfig
    });
    assert.equal(first.created, 2);
    assert.equal(first.skipped_existing, 0);

    const firstJob = await storage.readJson(
      'specs/inputs/mouse/products/mouse-logitech-g-pro-x-superlight-2-wireless.json'
    );
    assert.equal(firstJob.identityLock.brand, 'Logitech');
    assert.equal(firstJob.identityLock.model, 'G Pro X Superlight 2');

    const queue = await storage.readJson('specs/outputs/_queue/mouse/state.json');
    assert.equal(Boolean(queue.products['mouse-logitech-g-pro-x-superlight-2-wireless']), true);
    assert.equal(Boolean(queue.products['mouse-razer-viper-v3-pro-wireless']), true);

    const second = await syncJobsFromActiveFiltering({
      storage,
      config,
      category: 'mouse',
      categoryConfig
    });
    assert.equal(second.created, 0);
    assert.equal(second.skipped_existing, 2);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('resolveHelperProductContext resolves active row by variant match', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-helper-variant-active-'));
  const helperRoot = path.join(tempRoot, 'helper_files');
  const categoryDir = path.join(helperRoot, 'mouse');
  await fs.mkdir(categoryDir, { recursive: true });

  await fs.writeFile(
    path.join(categoryDir, 'activeFiltering.json'),
    JSON.stringify([
      {
        brand: 'Logitech',
        model: 'G Pro X Superlight 2',
        variant: 'SE',
        weight: '60'
      },
      {
        brand: 'Logitech',
        model: 'G Pro X Superlight 2',
        variant: '',
        weight: '60'
      }
    ], null, 2),
    'utf8'
  );

  try {
    const config = {
      helperFilesEnabled: true,
      helperFilesRoot: helperRoot
    };
    const categoryConfig = mouseCategoryConfig();
    const loaded = await loadHelperCategoryData({
      config,
      category: 'mouse',
      categoryConfig,
      forceRefresh: true
    });
    const context = resolveHelperProductContext({
      helperData: loaded,
      job: {
        category: 'mouse',
        identityLock: {
          brand: 'Logitech',
          model: 'G Pro X Superlight 2',
          variant: ''
        }
      }
    });

    assert.equal(context.supportive_matches.length, 0);
    assert.equal(context.active_match?.variant, 'SE');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('syncJobsFromActiveFiltering enforces identity gate against catalog conflicts', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-helper-gate-'));
  const helperRoot = path.join(tempRoot, 'helper_files');
  const categoryDir = path.join(helperRoot, 'mouse');
  const controlDir = path.join(categoryDir, '_control_plane');
  await fs.mkdir(controlDir, { recursive: true });

  await fs.writeFile(
    path.join(categoryDir, 'activeFiltering.json'),
    JSON.stringify([
      {
        brand: 'Acer',
        model: 'Cestus 310',
        variant: '',
        url: 'https://example.com/cestus-310'
      },
      {
        brand: 'Acer',
        model: 'Cestus 310',
        variant: '310',
        url: 'https://example.com/cestus-310-v2'
      }
    ], null, 2),
    'utf8'
  );
  await fs.writeFile(
    path.join(controlDir, 'product_catalog.json'),
    JSON.stringify({
      _version: 1,
      products: {
        'mouse-acer-cestus-310': {
          brand: 'Acer',
          model: 'Cestus 310',
          variant: ''
        }
      }
    }, null, 2),
    'utf8'
  );

  const config = {
    localMode: true,
    localInputRoot: path.join(tempRoot, 'fixtures'),
    localOutputRoot: path.join(tempRoot, 'out'),
    s3InputPrefix: 'specs/inputs',
    s3OutputPrefix: 'specs/outputs',
    helperFilesEnabled: true,
    helperAutoSeedTargets: true,
    helperFilesRoot: helperRoot,
    helperActiveSyncLimit: 0
  };
  const storage = createStorage(config);

  try {
    const sync = await syncJobsFromActiveFiltering({
      storage,
      config,
      category: 'mouse',
      categoryConfig: mouseCategoryConfig()
    });
    assert.equal(sync.created, 1);
    assert.equal(sync.skipped_identity_gate, 1);
    assert.equal(
      await storage.objectExists('specs/inputs/mouse/products/mouse-acer-cestus-310.json'),
      true
    );
    assert.equal(
      await storage.objectExists('specs/inputs/mouse/products/mouse-acer-cestus-310-310.json'),
      false
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
