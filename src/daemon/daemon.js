import fs from 'node:fs/promises';
import path from 'node:path';
import { wait } from '../utils/common.js';
import {
  ingestIncomingCsvs,
  listImportCategories
} from '../ingest/csvIngestor.js';
import {
  loadQueueState,
  selectNextQueueProduct,
  syncQueueFromInputs,
  upsertQueueProduct
} from '../queue/queueState.js';
import { runUntilComplete } from '../runner/runUntilComplete.js';
import { loadCategoryConfig } from '../categories/loader.js';
import { syncJobsFromActiveFiltering } from '../helperFiles/index.js';

async function listConfiguredCategories() {
  const dir = path.resolve('categories');
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function resolveCategories({
  category,
  all = false,
  importsRoot
}) {
  if (category) {
    return [category];
  }
  if (!all) {
    return ['mouse'];
  }

  const fromConfig = await listConfiguredCategories();
  const fromImports = await listImportCategories(importsRoot);
  return [...new Set([...fromConfig, ...fromImports])].sort();
}

async function selectNextRunnableJob({
  storage,
  category
}) {
  await syncQueueFromInputs({ storage, category });
  const loaded = await loadQueueState({ storage, category });
  const next = selectNextQueueProduct(loaded.state);
  if (!next || !next.s3key) {
    return null;
  }
  await upsertQueueProduct({
    storage,
    category,
    productId: next.productId,
    s3key: next.s3key,
    patch: {
      status: 'pending'
    }
  });
  return next;
}

export async function runWatchImports({
  storage,
  config,
  importsRoot = config.importsRoot || 'imports',
  category,
  all = false,
  once = false,
  logger = null
}) {
  let iteration = 0;
  const categories = await resolveCategories({
    category,
    all,
    importsRoot
  });

  if (!categories.length) {
    return {
      mode: 'watch-imports',
      imports_root: path.resolve(importsRoot),
      categories: [],
      iterations: 0,
      runs: []
    };
  }

  const runs = [];
  do {
    iteration += 1;
    for (const cat of categories) {
      const result = await ingestIncomingCsvs({
        storage,
        config,
        category: cat,
        importsRoot
      });
      runs.push(result);
      logger?.info?.('imports_ingested', {
        category: cat,
        discovered_csv_count: result.discovered_csv_count,
        processed_count: result.processed_count,
        failed_count: result.failed_count
      });
    }
    if (once) {
      break;
    }
    await wait(Math.max(1, Number(config.importsPollSeconds || 10)) * 1000);
  } while (true);

  return {
    mode: 'watch-imports',
    imports_root: path.resolve(importsRoot),
    categories,
    iterations: iteration,
    runs
  };
}

export async function runDaemon({
  storage,
  config,
  importsRoot = config.importsRoot || 'imports',
  category,
  all = false,
  mode = config.accuracyMode || 'balanced',
  once = false,
  logger = null
}) {
  let iteration = 0;
  const categories = await resolveCategories({
    category,
    all,
    importsRoot
  });
  if (!categories.length) {
    return {
      mode: 'daemon',
      categories: [],
      iterations: 0,
      runs: []
    };
  }

  const runs = [];
  do {
    iteration += 1;

    for (const cat of categories) {
      const ingest = await ingestIncomingCsvs({
        storage,
        config,
        category: cat,
        importsRoot
      });
      logger?.info?.('daemon_ingest_cycle', {
        category: cat,
        discovered_csv_count: ingest.discovered_csv_count,
        processed_count: ingest.processed_count,
        failed_count: ingest.failed_count
      });

      if (config.helperFilesEnabled && config.helperAutoSeedTargets) {
        try {
          const categoryConfig = await loadCategoryConfig(cat, { storage, config });
          const syncResult = await syncJobsFromActiveFiltering({
            storage,
            config,
            category: cat,
            categoryConfig,
            limit: Math.max(0, Number.parseInt(String(config.helperActiveSyncLimit || 0), 10) || 0),
            logger
          });
          logger?.info?.('daemon_helper_active_sync', {
            category: cat,
            active_rows: syncResult.active_rows,
            created: syncResult.created,
            skipped_existing: syncResult.skipped_existing,
            failed: syncResult.failed
          });
        } catch (error) {
          logger?.warn?.('daemon_helper_active_sync_failed', {
            category: cat,
            message: error.message
          });
        }
      }
    }

    let processedAny = false;
    for (const cat of categories) {
      const nextJob = await selectNextRunnableJob({
        storage,
        category: cat
      });
      if (!nextJob) {
        continue;
      }
      processedAny = true;

      logger?.info?.('daemon_job_started', {
        category: cat,
        productId: nextJob.productId,
        s3key: nextJob.s3key
      });

      const run = await runUntilComplete({
        storage,
        config: {
          ...config,
          accuracyMode: mode
        },
        s3key: nextJob.s3key,
        maxRounds: mode === 'aggressive' ? 8 : 4,
        mode
      });
      runs.push(run);

      logger?.info?.('daemon_job_completed', {
        category: cat,
        productId: nextJob.productId,
        complete: run.complete,
        exhausted: run.exhausted,
        stop_reason: run.stop_reason
      });
    }

    if (once) {
      break;
    }

    if (!processedAny) {
      await wait(Math.max(1, Number(config.importsPollSeconds || 10)) * 1000);
    }
  } while (true);

  return {
    mode: 'daemon',
    imports_root: path.resolve(importsRoot),
    categories,
    iterations: iteration,
    run_count: runs.length,
    runs
  };
}
